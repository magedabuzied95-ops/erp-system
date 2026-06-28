import crypto from "node:crypto";

import db from "../database/db.js";
import { emitToRooms } from "../utils/socket.js";
import { enqueueJob } from "./jobQueueService.js";
import { ensureAiSupportLogSchema } from "./aiSupportLogService.js";
import { ensureAiChannelAdapterSchema } from "./aiChannelAdapterService.js";
import { upsertAiCustomerProfile } from "./aiSalesAgentService.js";
import { createOrUpdateLeadOpportunity } from "./aiInboxLeadActionsService.js";
import { appendAutomationSupportTranscript } from "./aiSupportLogService.js";
import { likeComment, replyToComment, sendPrivateReply } from "./marketingCommentAutomationService.js";
import { getSocialCommentAutomationConfig, processSocialCommentAutoReply } from "./socialCommentsCenterService.js";
import { resolveStorefrontProductLink } from "./storefrontProductUrlService.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";
import {
  DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
  getSocialAutomationSettings,
} from "./socialAutomationSettingsService.js";
import { ensureAiSalesAgentSchema } from "./aiSalesAgentService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
const isSocialCommentsDebugEnabled = () => String(process.env.DEBUG_SOCIAL_COMMENTS || "").toLowerCase() === "true";
const debugSocialCommentsLog = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.log(...args);
};
const debugSocialCommentsWarn = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.warn(...args);
};
let fetchMetaPostPreviewDetailsLoaderPromise = null;

const normalizeAutomationRunDiagnostics = (value = {}) => {
  const resolvedProductId = Number(value.resolved_product_id ?? value.product_id ?? null);
  return {
    skipped_reason: text(value.skipped_reason || ""),
    matched_config_key: text(value.matched_config_key || ""),
    resolved_post_id: text(value.resolved_post_id || ""),
    resolved_platform_post_id: text(value.resolved_platform_post_id || ""),
    resolved_product_id: Number.isFinite(resolvedProductId) && resolvedProductId > 0 ? Math.trunc(resolvedProductId) : null,
    duplicate_reason: text(value.duplicate_reason || ""),
    config_found: Boolean(value.config_found),
    config_enabled: Boolean(value.config_enabled),
    raw_runtime_context:
      value.raw_runtime_context && typeof value.raw_runtime_context === "object" && !Array.isArray(value.raw_runtime_context)
        ? value.raw_runtime_context
        : {},
  };
};

const logAutomationSkipReason = (payload = {}) => {
  debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_SKIP_REASON", payload);
};

const buildRuntimeContextSnapshot = ({ row = {}, config = null, productContext = null, stepResults = [], summary = null } = {}) => ({
  row: {
    tenant_id: row.tenant_id ?? null,
    platform: text(row.platform || ""),
    channel: text(row.channel || ""),
    post_id: text(row.post_id || ""),
    comment_id: text(row.comment_id || ""),
    commenter_name: text(row.commenter_name || row.customer_name || ""),
    original_comment_text: text(row.original_comment_text || ""),
  },
  config: config
    ? {
        id: config.id ?? null,
        post_id: text(config.post_id || ""),
        platform: text(config.platform || ""),
        template_key: text(config.template_key || ""),
        enabled: Boolean(config.enabled),
        persisted: Boolean(config.persisted),
        product_id: config.product_id ?? null,
      }
    : null,
  product: productContext
    ? {
        found: Boolean(productContext.found),
        product_id: productContext.product_id ?? null,
        product_name: text(productContext.product_name || ""),
        source: text(productContext.source || ""),
      }
    : null,
  summary: summary
    ? {
        status: text(summary.status || ""),
        errorMessage: text(summary.errorMessage || ""),
      }
    : null,
  step_results: asArray(stepResults),
});

const buildAutomationRunDiagnostics = ({
  row = {},
  config = null,
  productContext = null,
  skippedReason = "",
  duplicateReason = "",
  rawRuntimeContext = {},
} = {}) => {
  const resolvedPostId = text(config?.post_id || row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || "");
  const resolvedPlatformPostId = text(row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || config?.post_id || "");
  const resolvedProductId = Number(
    productContext?.product_id ??
    config?.product_id ??
    row.product_id ??
    row.metadata?.product_id ??
    row.raw_payload?.product_id ??
    null
  );
  return normalizeAutomationRunDiagnostics({
    skipped_reason: skippedReason,
    matched_config_key: text(config?.template_key || row.matched_config_key || ""),
    resolved_post_id: resolvedPostId,
    resolved_platform_post_id: resolvedPlatformPostId,
    resolved_product_id: Number.isFinite(resolvedProductId) && resolvedProductId > 0 ? Math.trunc(resolvedProductId) : null,
    duplicate_reason: duplicateReason,
    config_found: Boolean(config?.persisted),
    config_enabled: Boolean(config?.enabled),
    raw_runtime_context: rawRuntimeContext,
  });
};

const loadFetchMetaPostPreviewDetails = async () => {
  if (!fetchMetaPostPreviewDetailsLoaderPromise) {
    fetchMetaPostPreviewDetailsLoaderPromise = import("./metaIntegrationService.js").then((module) => module.fetchMetaPostPreviewDetails);
  }
  return fetchMetaPostPreviewDetailsLoaderPromise;
};
const confidenceFrom = (value, fallback = 0.9) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
};

const COMBINING_MARKS_RE = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const ZERO_WIDTH_RE = /[\u200c\u200d\ufeff]/g;
const NON_TEXT_RE = /[^\p{L}\p{N}\s]+/gu;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\s]+$/u;

const normalizeCommentText = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(COMBINING_MARKS_RE, "")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(NON_TEXT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

const COMMENT_INTENT_RULES = [
  {
    label: "lead_inbox",
    score: 0.98,
    patterns: [
      /\binbox\b/i,
      /\bdm\b/i,
      /\bmsg\b/i,
      /\bmessage\b/i,
      /\bprivate\b/i,
      "خاص",
      "برايفت",
      "رساله خاصه",
      "رسالة خاصة",
    ],
  },
  {
    label: "lead_price",
    score: 0.97,
    patterns: [
      /\bprice\b/i,
      "السعر",
      "السعر كام",
      "بكام",
      "بكم",
      "bkam",
      "bkam",
      "sa3r",
      "s3er",
      "s3r",
      "es3r",
      "kam",
    ],
  },
  {
    label: "lead_availability",
    score: 0.96,
    patterns: [
      /\bavailable\b/i,
      /\bavailability\b/i,
      /\bin\s*stock\b/i,
      /\bstock\b/i,
      "متاح",
      "موجود",
      "موجوده",
      "موجودة",
      "mawjood",
      "mwjod",
      "mawgood",
      "mwgood",
    ],
  },
  {
    label: "lead_size",
    score: 0.95,
    patterns: [
      /\bsize\b/i,
      /\bsizes\b/i,
      "مقاس",
      "مقاسات",
      "سايز",
      "السايز",
      /\bfit\b/i,
    ],
  },
  {
    label: "lead_shipping",
    score: 0.95,
    patterns: [
      /\bshipping\b/i,
      /\bship\b/i,
      /\bshipment\b/i,
      /\bdelivery\b/i,
      /\bdeliver(y|ies)\b/i,
      "شحن",
      "شحنه",
      "شحنة",
      "توصيل",
      "دليفري",
    ],
  },
  {
    label: "lead_details",
    score: 0.94,
    patterns: [
      /\bdetails\b/i,
      /\bdetail\b/i,
      /\binfo\b/i,
      /\binformation\b/i,
      "تفاصيل",
      "معلومات",
      "ابعت",
      "ابعتلي",
      "ابعتي",
      /\bsend\b/i,
      /\bmore\b/i,
      /\bshow\b/i,
      /\btell\s*me\b/i,
    ],
  },
];

const LOW_VALUE_PATTERNS = [
  /^(?:حلو|حلوه|حلوة|جامد|nice|wow|great|awesome|perfect|amazing|super|cool|love\s*it)$/i,
  /^(?:👍|👎|👌|👏|🔥|❤️|❤|😍|🥰|😘|💯|✨)+$/u,
];

const patternMatches = (pattern, { original = "", normalized = "", compact = "" } = {}) => {
  if (!pattern) return false;
  if (typeof pattern === "string") {
    const needle = normalizeCommentText(pattern);
    return Boolean(
      needle &&
      (normalized.includes(needle) || compact.includes(needle.replace(/\s+/g, "")) || original.toLowerCase().includes(pattern.toLowerCase()))
    );
  }
  if (pattern instanceof RegExp) {
    return pattern.test(original) || pattern.test(normalized) || pattern.test(compact);
  }
  return false;
};

export const classifySocialCommentIntent = (commentText = "") => {
  const original = text(commentText);
  const normalized = normalizeCommentText(original);
  const normalizedCompact = normalized.replace(/\s+/g, "");

  if (!original || !normalized) {
    return { label: "ignore", score: 0.99, reason: "empty_comment" };
  }

  if (EMOJI_ONLY_RE.test(original)) {
    return { label: "ignore", score: 0.99, reason: "emoji_only" };
  }

  if (LOW_VALUE_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(normalizedCompact))) {
    return { label: "engagement_only", score: 0.93, reason: "low_value_engagement" };
  }

  const matchedLabels = [];
  for (const rule of COMMENT_INTENT_RULES) {
    if (rule.patterns.some((pattern) => patternMatches(pattern, { original, normalized, compact: normalizedCompact }))) {
      matchedLabels.push(rule.label);
    }
  }

  if (!matchedLabels.length) {
    return { label: "human_review", score: 0.6, reason: "ambiguous_comment" };
  }

  if (matchedLabels.includes("lead_inbox")) {
    return { label: "lead_inbox", score: 0.98, reason: "explicit_inbox_request" };
  }

  if (matchedLabels.length === 2 && matchedLabels.includes("lead_availability")) {
    const primary = matchedLabels.find((label) => label !== "lead_availability");
    const primaryRule = COMMENT_INTENT_RULES.find((rule) => rule.label === primary);
    if (primaryRule) {
      return {
        label: primaryRule.label,
        score: primaryRule.score,
        reason: "availability_modifier",
      };
    }
  }

  if (matchedLabels.length > 1) {
    return { label: "human_review", score: 0.66, reason: "multiple_lead_intents" };
  }

  const matchedRule = COMMENT_INTENT_RULES.find((rule) => rule.label === matchedLabels[0]);
  return {
    label: matchedRule?.label || "human_review",
    score: matchedRule?.score || 0.6,
    reason: matchedRule?.label || "ambiguous_comment",
  };
};

const COMMENT_LEAD_SCORE = {
  lead_price: 70,
  lead_size: 80,
  lead_shipping: 60,
  lead_details: 70,
  lead_inbox: 90,
};

const COMMENT_LEAD_TEMPERATURE = {
  lead_price: "hot",
  lead_size: "warm",
  lead_shipping: "warm",
  lead_details: "hot",
  lead_inbox: "ready_to_buy",
};

const COMMENT_THREAD_LABELS = new Set(Object.keys(COMMENT_LEAD_SCORE));
const COMMENT_AUTOMATION_ELIGIBLE_LABELS = new Set(Object.keys(COMMENT_LEAD_SCORE));
const COMMENT_AUTOMATION_MIN_SCORE = 0.9;
const COMMENT_AUTOMATION_PUBLIC_REPLY_TEXT = "تم إرسال التفاصيل في رسالة خاصة ";

const featureFlagEnabled = (value = "") => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
const socialCommentsDebugEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  featureFlagEnabled(process.env.SOCIAL_COMMENTS_DEBUG || process.env.AI_SUPPORT_SOCIAL_COMMENTS_DEBUG || "");
const socialCommentsLog = (...args) => {
  if (socialCommentsDebugEnabled()) console.info(...args);
};
const socialCommentsError = (...args) => {
  if (socialCommentsDebugEnabled()) console.error(...args);
};

const getSocialCommentAutomationFlags = () => ({
  like: featureFlagEnabled(process.env.SOCIAL_COMMENTS_AUTO_LIKE || "false"),
  publicReply: featureFlagEnabled(process.env.SOCIAL_COMMENTS_AUTO_PUBLIC_REPLY || "false"),
  privateMessage: featureFlagEnabled(process.env.SOCIAL_COMMENTS_AUTO_PRIVATE_MESSAGE || "false"),
});

const parseSocialAutomationEnvSwitch = (value = "") => {
  const normalized = text(value).toLowerCase();
  if (!normalized) {
    return { enabled: null, explicitlyDisabled: false, raw: "" };
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return { enabled: false, explicitlyDisabled: true, raw: normalized };
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return { enabled: true, explicitlyDisabled: false, raw: normalized };
  }
  return { enabled: null, explicitlyDisabled: false, raw: normalized };
};

const getSocialCommentAutomationEnvFlags = () => ({
  like: parseSocialAutomationEnvSwitch(process.env.SOCIAL_COMMENTS_AUTO_LIKE || ""),
  publicReply: parseSocialAutomationEnvSwitch(process.env.SOCIAL_COMMENTS_AUTO_PUBLIC_REPLY || ""),
  privateMessage: parseSocialAutomationEnvSwitch(process.env.SOCIAL_COMMENTS_AUTO_PRIVATE_MESSAGE || ""),
});

const normalizeSocialAutomationSettings = (settings = {}) => ({
  ...DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
  ...(settings && typeof settings === "object" ? settings : {}),
});

const isSocialAutomationEnvDisabled = (flag) =>
  flag === false || flag?.enabled === false || flag?.explicitlyDisabled === true;

const socialCommentAutomationChannelForPlatform = (platform = "") => (text(platform) === "instagram" ? "instagram" : "facebook_messenger");

const socialCommentAutomationStepFinal = (value = "") => ["sent", "failed", "skipped"].includes(text(value).toLowerCase());

const socialCommentAutomationTone = (status = "") => {
  const normalized = text(status).toLowerCase();
  if (normalized === "sent") return "emerald";
  if (normalized === "failed") return "rose";
  if (normalized === "skipped") return "zinc";
  return "amber";
};

const socialCommentAutomationLabel = (messageType = "") => {
  const key = text(messageType);
  if (key === "comment_like") return "Like";
  if (key === "comment_public_reply") return "Public reply";
  if (key === "comment_private_reply") return "Private message";
  if (key === "automation_error") return "Automation error";
  return key || "";
};

export const buildSocialCommentSuggestedReply = ({ classificationLabel = "", commenterName = "", originalCommentText = "", postPermalink = "" } = {}) => {
  const name = text(commenterName) || "العميل";
  const linkHint = postPermalink ? ` لو تحب تراجع المنشور: ${postPermalink}` : "";
  if (classificationLabel === "lead_price") return `تم تجهيز السعر والتفاصيل يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_size") return `تم تجهيز المقاسات المتاحة يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_shipping") return `تم تجهيز تفاصيل الشحن والتوصيل يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_details") return `تم تجهيز التفاصيل الكاملة يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_inbox") return `تم تجهيز رسالة خاصة تحتوي على التفاصيل المطلوبة يا ${name}.${linkHint}`;
  return `رد مقترح: ${text(originalCommentText) || "تم استلام تعليقك."}${linkHint}`;
};

const isSupportedWebhookCommentTrigger = (event = {}) => {
  const rawPayload = event.raw_payload && typeof event.raw_payload === "object" ? event.raw_payload : {};
  const value = rawPayload.value && typeof rawPayload.value === "object" ? rawPayload.value : {};
  const field = text(rawPayload.field || "").toLowerCase();
  const item = text(value.item || "").toLowerCase();
  const verb = text(value.verb || "").toLowerCase();
  const platform = text(event.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  const allowedVerb = ["add", "created", "edited", "edit", ""].includes(verb);
  const source = text(rawPayload.source || "");
  const isFacebookFeedComment = platform === "facebook" && field === "feed" && item === "comment" && allowedVerb;
  const isInstagramComment = platform === "instagram" && ["comments", "mentions"].includes(field) && item === "comment" && allowedVerb;
  return source === "meta_webhook" && (isFacebookFeedComment || isInstagramComment);
};

const buildSocialCommentPrivateReplyMessage = ({ row = {}, settings = {} } = {}) => {
  const template = text(settings.private_message_template || "");
  if (template) {
    return template;
  }
  return buildSocialCommentSuggestedReply({
    classificationLabel: row.classification_label || "",
    commenterName: row.commenter_name || "",
    originalCommentText: row.original_comment_text || "",
    postPermalink: row.post_permalink || row.post_permalink_url || "",
  });
};

const renderSocialCommentTemplateText = (templateText = "", context = {}) =>
  text(templateText).replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = leftKey || rightKey || "";
    return text(context[key] ?? context[key.toLowerCase()] ?? "");
  });

const renderAutomationTemplate = (templateText = "", context = {}) => renderSocialCommentTemplateText(templateText, context);

const buildAutomationPublicUrl = (path = "") => {
  const safePath = text(path || "");
  const base = text(getPublicAppUrl() || "");
  if (!safePath) return base || "";
  if (/^https?:\/\//i.test(safePath)) return safePath;
  const normalizedPath = safePath.startsWith("/") ? safePath : `/${safePath}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
};

const extractTemplatePlaceholders = (templateText = "") => {
  const placeholders = new Set();
  const pattern = /\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g;
  String(templateText || "").replace(pattern, (_match, leftKey, rightKey) => {
    const key = leftKey || rightKey || "";
    if (key) placeholders.add(key);
    return _match;
  });
  return Array.from(placeholders);
};

const detectMissingTemplatePlaceholders = (templateText = "", context = {}) => {
  const placeholders = extractTemplatePlaceholders(templateText);
  return placeholders.filter((key) => !text(context[key] ?? context[key.toLowerCase()] ?? ""));
};

const summarizeAutomationStepResults = (stepResults = []) => {
  const normalized = asArray(stepResults).map((item) => ({
    step: text(item?.step || ""),
    status: text(item?.status || "skipped") || "skipped",
    reason: text(item?.reason || ""),
    message: text(item?.message || ""),
    meta: item?.meta && typeof item.meta === "object" ? item.meta : {},
  }));
  if (!normalized.length) {
    return { status: "skipped", errorMessage: "", normalized };
  }
  const hasFailed = normalized.some((item) => item.status === "failed");
  const hasSent = normalized.some((item) => ["sent", "queued", "created", "linked", "success"].includes(item.status));
  const hasExecuted = normalized.some((item) => ["sent", "queued", "failed", "created", "linked", "success"].includes(item.status));
  const allSkipped = normalized.every((item) => item.status === "skipped");
  const status = allSkipped
    ? "skipped"
    : hasFailed
      ? (hasSent ? "partial_success" : "failed")
      : hasExecuted && normalized.some((item) => item.status === "queued")
        ? "partial_success"
        : "success";
  const errorMessage = normalized.find((item) => item.status === "failed")?.reason || "";
  return { status, errorMessage, normalized };
};

export const upsertSocialCommentAutomationRunSummary = async ({
  tenantId = null,
  platform = "",
  postId = "",
  commentId = "",
  configId = null,
  customerName = "",
  status = "skipped",
  stepResults = [],
  errorMessage = "",
  diagnostics = {},
  row = {},
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const safePostId = text(postId || row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || "");
  const safeCommentId = text(commentId || row.comment_id || "");
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId) return null;
  await ensureSocialCommentAutomationSchema();
  const summary = summarizeAutomationStepResults(stepResults);
  const finalStatus = text(status || summary.status || "skipped") || "skipped";
  const finalErrorMessage = text(errorMessage || summary.errorMessage || "");
  const safeDiagnostics = buildAutomationRunDiagnostics({
    row,
    skippedReason: diagnostics?.skipped_reason || row.skipped_reason || row.metadata?.skipped_reason || "",
    duplicateReason: diagnostics?.duplicate_reason || row.duplicate_reason || row.metadata?.duplicate_reason || "",
    rawRuntimeContext: diagnostics?.raw_runtime_context || {},
    config: diagnostics?.config || null,
    productContext: diagnostics?.product_context || null,
  });
  const result = await db.query(
    `
    INSERT INTO social_comment_automation_runs (
      tenant_id,
      platform,
      channel,
      post_id,
      comment_id,
      commenter_name,
      action_taken,
      public_reply_status,
      dm_status,
      like_status,
      automation_state,
      status,
      step_results,
      config_id,
      skipped_reason,
      matched_config_key,
      resolved_post_id,
      resolved_platform_post_id,
      resolved_product_id,
      duplicate_reason,
      config_found,
      config_enabled,
      error_message,
      processed_at,
      created_at,
      updated_at
    )
    VALUES (
      $1::bigint,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::text,
      $8::text,
      $9::text,
      $10::text,
      $11::jsonb,
      $12::text,
      $13::jsonb,
      $14::bigint,
      $15::text,
      $16::text,
      $17::text,
      $18::text,
      $19::bigint,
      $20::text,
      $21::boolean,
      $22::boolean,
      $23::text,
      CURRENT_TIMESTAMP,
      COALESCE($24::timestamp, CURRENT_TIMESTAMP),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (tenant_id, platform, comment_id) DO UPDATE SET
      post_id = COALESCE(NULLIF(EXCLUDED.post_id, ''), social_comment_automation_runs.post_id),
      commenter_name = COALESCE(NULLIF(EXCLUDED.commenter_name, ''), social_comment_automation_runs.commenter_name),
      action_taken = COALESCE(NULLIF(EXCLUDED.action_taken, ''), social_comment_automation_runs.action_taken),
      public_reply_status = COALESCE(NULLIF(EXCLUDED.public_reply_status, ''), social_comment_automation_runs.public_reply_status),
      dm_status = COALESCE(NULLIF(EXCLUDED.dm_status, ''), social_comment_automation_runs.dm_status),
      like_status = COALESCE(NULLIF(EXCLUDED.like_status, ''), social_comment_automation_runs.like_status),
      automation_state = COALESCE(social_comment_automation_runs.automation_state, '{}'::jsonb) || COALESCE(EXCLUDED.automation_state, '{}'::jsonb),
      status = COALESCE(NULLIF(EXCLUDED.status, ''), social_comment_automation_runs.status),
      step_results = COALESCE(EXCLUDED.step_results, social_comment_automation_runs.step_results),
      config_id = COALESCE(EXCLUDED.config_id, social_comment_automation_runs.config_id),
      skipped_reason = COALESCE(NULLIF(EXCLUDED.skipped_reason, ''), social_comment_automation_runs.skipped_reason),
      matched_config_key = COALESCE(NULLIF(EXCLUDED.matched_config_key, ''), social_comment_automation_runs.matched_config_key),
      resolved_post_id = COALESCE(NULLIF(EXCLUDED.resolved_post_id, ''), social_comment_automation_runs.resolved_post_id),
      resolved_platform_post_id = COALESCE(NULLIF(EXCLUDED.resolved_platform_post_id, ''), social_comment_automation_runs.resolved_platform_post_id),
      resolved_product_id = COALESCE(EXCLUDED.resolved_product_id, social_comment_automation_runs.resolved_product_id),
      duplicate_reason = COALESCE(NULLIF(EXCLUDED.duplicate_reason, ''), social_comment_automation_runs.duplicate_reason),
      config_found = EXCLUDED.config_found,
      config_enabled = EXCLUDED.config_enabled,
      error_message = COALESCE(NULLIF(EXCLUDED.error_message, ''), social_comment_automation_runs.error_message),
      processed_at = COALESCE(social_comment_automation_runs.processed_at, EXCLUDED.processed_at),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *, (xmax = 0) AS inserted
    `,
    [
      safeTenantId,
      text(platform || row.platform || "facebook"),
      text(row.channel || (text(platform || row.platform || "facebook") === "instagram" ? "instagram_comment" : "facebook_comment")),
      safePostId,
      safeCommentId,
      text(customerName || row.commenter_name || row.customer_name || ""),
      text(summary.status === "skipped" ? "automation_skipped" : `automation_${summary.status}`),
      text(row.public_reply_status || row.automation_state?.public_reply_status || ""),
      text(row.dm_status || row.automation_state?.dm_status || ""),
      text(row.like_status || row.automation_state?.like_status || ""),
      JSON.stringify({
        ...(row.automation_state || {}),
        runtime_monitor: {
          post_id: safePostId,
          comment_id: safeCommentId,
          config_id: configId ?? null,
          status: finalStatus,
          step_results: summary.normalized,
          error_message: finalErrorMessage,
          skipped_reason: safeDiagnostics.skipped_reason,
          matched_config_key: safeDiagnostics.matched_config_key,
          resolved_post_id: safeDiagnostics.resolved_post_id,
          resolved_platform_post_id: safeDiagnostics.resolved_platform_post_id,
          resolved_product_id: safeDiagnostics.resolved_product_id,
          duplicate_reason: safeDiagnostics.duplicate_reason,
          config_found: safeDiagnostics.config_found,
          config_enabled: safeDiagnostics.config_enabled,
          product_link: text(row.product_link || row.metadata?.product_link || row.metadata?.website_product_link || ""),
          checkout_link: text(row.checkout_link || row.metadata?.checkout_link || ""),
          guidance_mode: text(row.guidance_mode || row.metadata?.guidance_mode || "website_checkout") || "website_checkout",
          raw_runtime_context: safeDiagnostics.raw_runtime_context,
          updated_at: new Date().toISOString(),
        },
      }),
      finalStatus,
      JSON.stringify(summary.normalized),
      configId ?? null,
      safeDiagnostics.skipped_reason,
      safeDiagnostics.matched_config_key,
      safeDiagnostics.resolved_post_id,
      safeDiagnostics.resolved_platform_post_id,
      safeDiagnostics.resolved_product_id,
      safeDiagnostics.duplicate_reason,
      safeDiagnostics.config_found,
      safeDiagnostics.config_enabled,
      finalErrorMessage,
      row.created_at || null,
    ]
  );
  return result.rows?.[0] || null;
};

const upsertSocialCommentAutomationRunAudit = async ({
  tenantId = null,
  platform = "",
  postId = "",
  commentId = "",
  status = "duplicate_skipped",
  skippedReason = "",
  stepResults = [],
  productLink = "",
  checkoutLink = "",
  diagnostics = {},
  row = {},
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const safePostId = text(postId || row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || "");
  const safeCommentId = text(commentId || row.comment_id || "");
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId) return null;
  await ensureSocialCommentAutomationSchema();
  const safeDiagnostics = buildAutomationRunDiagnostics({
    row,
    skippedReason,
    duplicateReason: diagnostics?.duplicate_reason || skippedReason || "duplicate_comment_automation",
    rawRuntimeContext: diagnostics?.raw_runtime_context || {},
    config: diagnostics?.config || null,
    productContext: diagnostics?.product_context || null,
  });
  const result = await db.query(
    `
    INSERT INTO social_comment_automation_run_audits (
      tenant_id,
      platform,
      post_id,
      comment_id,
      status,
      skipped_reason,
      matched_config_key,
      resolved_post_id,
      resolved_platform_post_id,
      resolved_product_id,
      duplicate_reason,
      config_found,
      config_enabled,
      step_results,
      product_link,
      checkout_link,
      guidance_mode,
      created_at,
      updated_at
    )
    VALUES (
      $1::bigint,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::text,
      $8::text,
      $9::text,
      $10::bigint,
      $11::text,
      $12::boolean,
      $13::boolean,
      $14::jsonb,
      $15::text,
      $16::text,
      $17::text,
      'website_checkout',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    RETURNING *
    `,
    [
      safeTenantId,
      text(platform || row.platform || "facebook"),
      safePostId,
      safeCommentId,
      text(status || "duplicate_skipped") || "duplicate_skipped",
      safeDiagnostics.skipped_reason || text(skippedReason || ""),
      safeDiagnostics.matched_config_key,
      safeDiagnostics.resolved_post_id || safePostId,
      safeDiagnostics.resolved_platform_post_id || safePostId,
      safeDiagnostics.resolved_product_id,
      safeDiagnostics.duplicate_reason || text(skippedReason || "duplicate_comment_automation"),
      safeDiagnostics.config_found,
      safeDiagnostics.config_enabled,
      JSON.stringify(asArray(stepResults)),
      text(productLink || row.product_link || row.metadata?.product_link || ""),
      text(checkoutLink || row.checkout_link || row.metadata?.checkout_link || ""),
      text(row.guidance_mode || "website_checkout") || "website_checkout",
    ]
  );
  return result.rows?.[0] || null;
};

const findSocialCommentAutomationRunByKey = async ({
  tenantId = null,
  platform = "",
  postId = "",
  commentId = "",
} = {}) => {
  const safeTenantId = Number(tenantId || 0);
  const safePostId = text(postId || "");
  const safeCommentId = text(commentId || "");
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId || !safePostId) return null;
  await ensureSocialCommentAutomationSchema();
  const result = await db.query(
    `
    SELECT *
    FROM social_comment_automation_runs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND comment_id = $3::text
      AND post_id = $4::text
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [safeTenantId, text(platform || "facebook"), safeCommentId, safePostId]
  );
  return result.rows?.[0] || null;
};

const loadPostAutomationConfig = async ({ tenantId = null, platform = "", postId = "", row = {} } = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const safePostId = text(postId || row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || "");
  const normalizedPlatform = text(platform || row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  if (!safeTenantId || !safePostId || normalizedPlatform !== "facebook") {
    return null;
  }
  const config = await getSocialCommentAutomationConfig({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: safePostId,
    row,
  }).catch(() => null);
  return config?.persisted ? config : null;
};

const buildAutomationTemplateContext = ({ row = {}, productContext = {}, websiteLinks = {} } = {}) => {
  const customerName = text(row.commenter_name || row.customer_name || row.from?.name || row.metadata?.from?.name || "");
  const productName = text(productContext?.product_name || row.product_name || row.metadata?.product_name || "");
  const price = text(productContext?.price || productContext?.sale_price || productContext?.selling_price || row.product_price || row.sale_price || row.price || "");
  const availableSizesList = asArray(productContext?.sizes || row.sizes || row.product_sizes || [])
    .map((value) => text(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  const availableSizes = availableSizesList.join(", ");
  const color = text(productContext?.color || row.color || "");
  const stockStatus = text(productContext?.stock_status || row.stock_status || (availableSizesList.length ? "in_stock" : "") || "");
  const productLink = text(
    websiteLinks?.product_link ||
      productContext?.product_url ||
      row.product_url ||
      row.metadata?.website_product_link ||
      row.metadata?.product_url ||
      row.post_permalink_url ||
      row.post_permalink ||
      ""
  );
  const checkoutLink = text(
    websiteLinks?.checkout_link ||
      productContext?.checkout_link ||
      row.checkout_link ||
      row.metadata?.checkout_link ||
      buildAutomationPublicUrl("/shop/checkout")
  );
  const productUrl = productLink;
  return {
    customerName,
    customer_name: customerName,
    commenterName: customerName,
    commenter_name: customerName,
    productName,
    product_name: productName,
    price,
    size: text(productContext?.size || row.size || ""),
    color,
    productUrl,
    product_url: productUrl,
    product_link: productLink,
    checkout_link: checkoutLink,
    checkoutLink,
    postPermalink: text(row.post_permalink || row.post_permalink_url || ""),
    post_permalink: text(row.post_permalink || row.post_permalink_url || ""),
    originalCommentText: text(row.original_comment_text || row.comment_text || ""),
    original_comment_text: text(row.original_comment_text || row.comment_text || ""),
    sizes: availableSizes,
    available_sizes: availableSizes,
    availableSizes,
    available_sizes_list: availableSizesList,
    variants: availableSizes,
    stock_status: stockStatus,
    stockStatus,
  };
};

const buildFallbackSocialCommentProductContext = ({ row = {} } = {}) => {
  const fallbackProductLink = buildAutomationPublicUrl("/shop") || buildAutomationPublicUrl("/shop/products");
  return {
    found: false,
    source: "fallback",
    platform: text(row.platform || "facebook") || "facebook",
    post_id: text(row.post_id || row.metadata?.post_id || ""),
    product_id: null,
    product_name: "المنتج",
    price: text(row.product_price || row.price || ""),
    sale_price: text(row.sale_price || row.product_sale_price || ""),
    selling_price: text(row.selling_price || row.product_selling_price || row.product_price || row.price || ""),
    sizes: [],
    available_sizes: [],
    colors: [],
    stock_status: "يرجى مراجعة التوفر من الموقع",
    product_url: fallbackProductLink,
    product_link: fallbackProductLink,
    checkout_link: buildAutomationPublicUrl("/shop/checkout"),
    checkout_url: buildAutomationPublicUrl("/shop/checkout"),
    variant_id: "",
    color: "",
    size: "",
    candidate_post_ids: [],
  };
};

const resolveAutomationCommenterIdentity = (row = {}) => {
  const candidateName = resolveSocialCommentCustomerName(row) || text(row.customer_name || row.commenter_name || row.from?.name || "");
  const commenterName = isGenericSocialCommentDisplayName(candidateName) ? "" : candidateName;
  const commenterAvatarUrl = resolveSocialCommentAvatarUrl(row);
  const commenterId = text(
    row.commenter_id ||
      row.external_customer_id ||
      row.customer_external_id ||
      row.from?.id ||
      row.raw_payload?.value?.from?.id ||
      row.raw_payload?.from?.id ||
      row.metadata?.commenter_id ||
      row.comment_id ||
      ""
  );
  return {
    commenterName,
    commenterAvatarUrl,
    commenterId,
  };
};

const resolveAutomationWebsiteLinks = async ({ tenantId = null, row = {}, productContext = {} } = {}) => {
  const directUrl = text(
    productContext?.product_url ||
      row.product_url ||
      row.metadata?.website_product_link ||
      row.metadata?.product_url ||
      ""
  );
  try {
    const resolved = await resolveStorefrontProductLink({
      tenantId,
      product: {
        id: productContext?.product_id || row.product_id || row.metadata?.product_id || "",
        product_id: productContext?.product_id || row.product_id || row.metadata?.product_id || "",
        name: productContext?.product_name || row.product_name || row.metadata?.product_name || "",
        slug: productContext?.slug || row.product_slug || row.metadata?.product_slug || "",
        canonical_slug: productContext?.canonical_slug || row.product_slug || row.metadata?.product_slug || "",
      },
    }).catch(() => null);
    const resolvedUrl = text(directUrl || resolved?.url || resolved?.product_url || "");
    const selection = [
      ["variant", text(productContext?.variant_id || row.variant_id || row.selected_variant_id || row.matched_variant_id || "")],
      ["color", text(productContext?.color || row.color || row.product_color || "")],
      ["size", text(productContext?.size || row.size || row.product_size || "")],
    ].filter(([, value]) => Boolean(value));
    const appendedUrl = selection.length
      ? `${resolvedUrl || buildAutomationPublicUrl("/shop/products")}${(resolvedUrl || buildAutomationPublicUrl("/shop/products")).includes("?") ? "&" : "?"}${new URLSearchParams(selection).toString().replace(/\+/g, "%20")}`
      : resolvedUrl || buildAutomationPublicUrl("/shop/products");
    return {
      product_link: appendedUrl,
      product_url: appendedUrl,
      checkout_link: buildAutomationPublicUrl("/shop/checkout"),
      checkout_url: buildAutomationPublicUrl("/shop/checkout"),
      available_sizes: asArray(productContext?.sizes || row.sizes || row.product_sizes || []).map((value) => text(value)).filter(Boolean),
      stock_status: text(productContext?.stock_status || row.stock_status || (asArray(productContext?.sizes || row.sizes || row.product_sizes || []).length ? "in_stock" : "")),
    };
  } catch {
    const fallback = buildAutomationPublicUrl("/shop/products");
    return {
      product_link: fallback,
      product_url: fallback,
      checkout_link: buildAutomationPublicUrl("/shop/checkout"),
      checkout_url: buildAutomationPublicUrl("/shop/checkout"),
      available_sizes: asArray(productContext?.sizes || row.sizes || row.product_sizes || []).map((value) => text(value)).filter(Boolean),
      stock_status: text(productContext?.stock_status || row.stock_status || ""),
    };
  }
};

const upsertAutomationInboxConversation = async ({
  tenantId = null,
  platform = "facebook",
  row = {},
  productContext = {},
  websiteProductLink = "",
  checkoutLink = "",
  aiHandling = false,
  leadStatus = "new",
  customerProfileId = null,
  customerName = "",
  customerAvatarUrl = "",
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const normalizedPlatform = text(platform || row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  const channel = text(row.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment"));
  const externalConversationId = text(row.inbox_conversation_id || row.session_id || row.conversation_id || socialCommentConversationId({
    platform: normalizedPlatform,
    postId: row.post_id,
    rootCommentId: row.root_comment_id,
    commentId: row.comment_id,
  }));
  const externalCustomerId = text(resolveAutomationCommenterIdentity(row).commenterId || row.commenter_id || row.external_customer_id || row.comment_id || "");
  const resolvedCustomerName = text(customerName || resolveAutomationCommenterIdentity(row).commenterName || row.customer_name || "");
  const resolvedAvatarUrl = text(customerAvatarUrl || resolveAutomationCommenterIdentity(row).commenterAvatarUrl || row.customer_avatar_url || "");
  if (!safeTenantId || !externalConversationId) return null;
  const metadata = {
    ...(row.metadata || {}),
    source: "comment_automation",
    source_type: "comment_automation",
    platform: normalizedPlatform,
    channel,
    post_id: text(row.post_id || row.metadata?.post_id || ""),
    comment_id: text(row.comment_id || row.metadata?.comment_id || ""),
    product_id: text(productContext?.product_id || row.product_id || row.metadata?.product_id || ""),
    product_name: text(productContext?.product_name || row.product_name || row.metadata?.product_name || ""),
    product_price: text(productContext?.price || productContext?.sale_price || productContext?.selling_price || row.product_price || row.price || ""),
    product_sale_price: text(productContext?.sale_price || row.product_sale_price || ""),
    product_url: websiteProductLink || text(productContext?.product_url || row.product_url || ""),
    website_product_link: websiteProductLink || text(productContext?.product_url || row.product_url || ""),
    product_link: websiteProductLink || text(productContext?.product_url || row.product_url || ""),
    checkout_link: text(checkoutLink || productContext?.checkout_link || row.checkout_link || buildAutomationPublicUrl("/shop/checkout")),
    available_sizes: asArray(productContext?.sizes || row.sizes || row.product_sizes || []).map((value) => text(value)).filter(Boolean),
    stock_status: text(productContext?.stock_status || row.stock_status || ""),
    guidance_mode: "website_checkout",
    ai_follow_up: aiHandling,
    lead_state: aiHandling ? "ai_handling" : "new_lead",
    lead_status: aiHandling ? "ai_handling" : "new_lead",
    customer_name: resolvedCustomerName,
    customer_avatar_url: resolvedAvatarUrl,
  };
  const result = await db.query(
    `
    INSERT INTO ai_channel_conversations (
      tenant_id,
      channel,
      external_conversation_id,
      external_customer_id,
      thread_kind,
      lead_status,
      customer_name,
      customer_avatar_url,
      last_message,
      customer_profile_id,
      metadata,
      last_message_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
    ON CONFLICT (tenant_id, channel, external_conversation_id) DO UPDATE SET
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_channel_conversations.external_customer_id),
      thread_kind = COALESCE(NULLIF(EXCLUDED.thread_kind, ''), ai_channel_conversations.thread_kind),
      lead_status = COALESCE(NULLIF(EXCLUDED.lead_status, ''), ai_channel_conversations.lead_status),
      customer_name = CASE
        WHEN COALESCE(NULLIF(ai_channel_conversations.customer_name, ''), '') = ''
          OR LOWER(ai_channel_conversations.customer_name) IN ('customer', 'unknown', 'guest', 'anonymous', 'عميل', 'العميل')
          THEN COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_channel_conversations.customer_name)
        ELSE ai_channel_conversations.customer_name
      END,
      customer_avatar_url = CASE
        WHEN COALESCE(NULLIF(ai_channel_conversations.customer_avatar_url, ''), '') = ''
          THEN COALESCE(NULLIF(EXCLUDED.customer_avatar_url, ''), ai_channel_conversations.customer_avatar_url)
        ELSE ai_channel_conversations.customer_avatar_url
      END,
      customer_profile_id = COALESCE(EXCLUDED.customer_profile_id, ai_channel_conversations.customer_profile_id),
      metadata = ai_channel_conversations.metadata || EXCLUDED.metadata,
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_channel_conversations.last_message),
      last_message_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    [
      safeTenantId,
      channel,
      externalConversationId,
      externalCustomerId,
      text(row.thread_kind || "comment"),
      text(leadStatus || "new"),
      resolvedCustomerName,
      resolvedAvatarUrl,
      text(row.original_comment_text || row.comment_text || row.last_message || row.comment_id || ""),
      customerProfileId ? Number(customerProfileId) : null,
      JSON.stringify(metadata),
    ]
  );
  return result.rows[0] || null;
};

const buildAutomationProfileMetadata = ({ row = {}, productContext = {}, templateContext = {}, websiteLinks = {} } = {}) => {
  const commenter = resolveAutomationCommenterIdentity(row);
  const availableSizes = asArray(productContext?.sizes || row.sizes || row.product_sizes || []).map((value) => text(value)).filter(Boolean);
  return {
    channel: text(row.channel || (text(row.platform) === "instagram" ? "instagram_comment" : "facebook_comment")),
    customer_phone: text(row.phone || row.customer_phone || ""),
    external_customer_id: commenter.commenterId || text(row.external_customer_id || row.comment_id || ""),
    customer_name: commenter.commenterName || text(row.customer_name || row.commenter_name || ""),
    full_name: commenter.commenterName || text(row.customer_name || row.commenter_name || ""),
    sender_name: commenter.commenterName || text(row.commenter_name || ""),
    contact_name: commenter.commenterName || text(row.commenter_name || ""),
    profile_name: commenter.commenterName || text(row.commenter_name || ""),
    product_name: text(productContext?.product_name || row.product_name || ""),
    product_url: text(productContext?.product_url || row.product_url || ""),
    product_price: text(productContext?.price || productContext?.sale_price || productContext?.selling_price || row.product_price || ""),
    product_link: text(websiteLinks?.product_link || productContext?.product_url || row.product_url || ""),
    checkout_link: text(websiteLinks?.checkout_link || productContext?.checkout_link || row.checkout_link || buildAutomationPublicUrl("/shop/checkout")),
    available_sizes: availableSizes,
    stock_status: text(productContext?.stock_status || row.stock_status || (availableSizes.length ? "in_stock" : "")),
    guidance_mode: "website_checkout",
    post_id: text(row.post_id || ""),
    comment_id: text(row.comment_id || ""),
    post_permalink_url: text(row.post_permalink_url || row.post_permalink || ""),
    conversation_summary: templateContext?.productName ? `Comment automation for ${templateContext.productName}` : text(row.original_comment_text || row.comment_text || ""),
    source_type: "comment_automation",
    source_channel: text(row.channel || (text(row.platform) === "instagram" ? "instagram_comment" : "facebook_comment")),
    messenger_profile: {
      id: commenter.commenterId || "",
      name: commenter.commenterName || "",
      profile_pic: commenter.commenterAvatarUrl || "",
      profile_pic_url: commenter.commenterAvatarUrl || "",
    },
    resolved_customer_id: commenter.commenterId || "",
    website_product_link: text(websiteLinks?.product_link || productContext?.product_url || row.product_url || ""),
  };
};

const executeAutomationStep = async ({
  step = "",
  enabled = false,
  statusField = "",
  run = async () => null,
  onSkipped = "",
  stepResults = [],
  stepData = {},
  persistState = async () => null,
} = {}) => {
  const result = { step, status: "skipped", reason: "", ...stepData };
  if (!enabled) {
    result.reason = onSkipped || "disabled";
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
    return result;
  }
  try {
    const response = await run();
    result.status = text(response?.status || response?.step_status || stepData?.status || "sent") || "sent";
    result.reason = text(response?.reason || "");
    result.meta = response?.meta && typeof response.meta === "object" ? response.meta : response || null;
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
    return result;
  } catch (error) {
    const message = error?.message || `${step} failed`;
    result.status = "failed";
    result.reason = message;
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
    if (statusField) {
      await persistState?.(statusField, "failed", message).catch(() => {});
    }
    return result;
  }
};

const executeSocialCommentAutomationRuntime = async ({
  tenantId = null,
  platform = "",
  postId = "",
  commentId = "",
  row = {},
  productContext = null,
  config = null,
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const normalizedPlatform = text(platform || row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  const safePostId = text(postId || row.post_id || "");
  const safeCommentId = text(commentId || row.comment_id || "");
  const safeRow = row || {};
  const stepResults = [];
  const currentPrivateReplyStatus = text(safeRow.dm_status || safeRow.automation_state?.private_reply?.status || "").toLowerCase();
  const buildCurrentDiagnostics = ({ skippedReason = "", duplicateReason = "", rawRuntimeContext = null, configOverride = config, productContextOverride = productContext } = {}) =>
    buildAutomationRunDiagnostics({
      row: safeRow,
      config: configOverride || null,
      productContext: productContextOverride || null,
      skippedReason,
      duplicateReason,
      rawRuntimeContext: rawRuntimeContext || buildRuntimeContextSnapshot({
        row: safeRow,
        config: configOverride || null,
        productContext: productContextOverride || null,
        stepResults,
      }),
    });

  if (!safeTenantId) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "invalid_tenant" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "invalid_tenant" }],
      errorMessage: "invalid_tenant",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "invalid_tenant",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: null,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "invalid_tenant",
    });
    return { applied: false, skipped: true, reason: "invalid_tenant", row: safeRow, step_results: stepResults };
  }
  if (!safePostId) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "post_mismatch" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "post_mismatch" }],
      errorMessage: "post_mismatch",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "post_mismatch",
      comment_id: safeCommentId,
      post_id: null,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || ""),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: null,
      comment_id: safeCommentId,
      reason: "missing_post_id",
    });
    return { applied: false, skipped: true, reason: "missing_post_id", row: safeRow, step_results: stepResults };
  }
  if (!safeCommentId) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "missing_comment_id" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "missing_comment_id" }],
      errorMessage: "missing_comment_id",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "missing_comment_id",
      comment_id: null,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: null,
      reason: "missing_comment_id",
    });
    return { applied: false, skipped: true, reason: "missing_comment_id", row: safeRow, step_results: stepResults };
  }
  if (normalizedPlatform !== "facebook") {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "unsupported_platform" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "unsupported_platform" }],
      errorMessage: "unsupported_platform",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "unsupported_platform",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "unsupported_platform",
    });
    return { applied: false, skipped: true, reason: "unsupported_platform", row: safeRow, step_results: stepResults };
  }

  const existingDuplicateRun = await findSocialCommentAutomationRunByKey({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: safePostId,
    commentId: safeCommentId,
  }).catch(() => null);
  if (existingDuplicateRun) {
    const duplicateStepResults = [{
      step: "automation",
      status: "skipped",
      reason: "duplicate_comment_automation",
      meta: {
        post_id: safePostId,
        comment_id: safeCommentId,
      },
    }];
    await upsertSocialCommentAutomationRunAudit({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "duplicate_skipped",
      skippedReason: "duplicate_comment_automation",
      stepResults: duplicateStepResults,
      productLink: text(existingDuplicateRun.metadata?.product_link || existingDuplicateRun.metadata?.website_product_link || ""),
      checkoutLink: text(existingDuplicateRun.metadata?.checkout_link || ""),
      diagnostics: {
        duplicate_reason: "duplicate_comment_automation",
        skipped_reason: "duplicate_comment_automation",
      },
      row: existingDuplicateRun,
    }).catch(() => {});
    const duplicateDiagnostics = buildAutomationRunDiagnostics({
      row: existingDuplicateRun,
      skippedReason: "duplicate_comment_automation",
      duplicateReason: "duplicate_comment_automation",
      rawRuntimeContext: buildRuntimeContextSnapshot({
        row: existingDuplicateRun,
        config: null,
        productContext: null,
        stepResults: duplicateStepResults,
      }),
    });
    logAutomationSkipReason({
      skipped_reason: "duplicate_comment_automation",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(existingDuplicateRun.post_id || existingDuplicateRun.metadata?.post_id || safePostId),
      config_found: duplicateDiagnostics.config_found,
      config_enabled: duplicateDiagnostics.config_enabled,
      resolved_product_id: duplicateDiagnostics.resolved_product_id,
      duplicate_reason: duplicateDiagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "duplicate_comment_automation",
      duplicate_run_id: existingDuplicateRun.id || null,
    });
    debugSocialCommentsWarn("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "duplicate_comment_automation",
    });
    return {
      applied: false,
      skipped: true,
      duplicate_skipped: true,
      reason: "duplicate_comment_automation",
      row: existingDuplicateRun,
      step_results: duplicateStepResults,
    };
  }

  if (!config) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "no_config" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "no_config" }],
      errorMessage: "no_config",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "no_config",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "no_config",
    });
    return { applied: false, skipped: true, reason: "no_config", row: safeRow, step_results: stepResults };
  }

  if (!config.enabled) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "config_disabled" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      configId: config.id ?? null,
      customerName: safeRow.commenter_name || safeRow.customer_name || "",
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "config_disabled" }],
      errorMessage: "config_disabled",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "config_disabled",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "config_disabled",
    });
    return { applied: false, skipped: true, reason: "config_disabled", row: safeRow, step_results: stepResults };
  }

  if (config.lookup_matched_key && config.lookup_matched_key !== "post_id") {
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_LOOKUP_MATCH", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "post_id_mismatch",
      matched_key: config.lookup_matched_key,
      matched_post_id: config.lookup_matched_post_id || text(config.post_id || ""),
      candidate_post_ids: asArray(config.lookup_candidate_post_ids || []),
    });
  }

  const hasProductContext = Boolean(productContext?.found);
  const effectiveProductContext = hasProductContext ? productContext : buildFallbackSocialCommentProductContext({ row: safeRow });
  if (!hasProductContext) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "product_not_found", productContextOverride: effectiveProductContext });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      configId: config.id ?? null,
      customerName: safeRow.commenter_name || safeRow.customer_name || "",
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "product_not_found" }],
      errorMessage: "product_not_found",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "product_not_found",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_CONTEXT_FALLBACK", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "product_not_mapped",
      fallback_product_name: effectiveProductContext.product_name,
      fallback_product_link: effectiveProductContext.product_link,
    });
  }

  const websiteLinks = await resolveAutomationWebsiteLinks({
    tenantId: safeTenantId,
    row: safeRow,
    productContext: effectiveProductContext || {},
  }).catch(() => ({
    product_link: effectiveProductContext?.product_link || buildAutomationPublicUrl("/shop"),
    product_url: effectiveProductContext?.product_url || buildAutomationPublicUrl("/shop"),
    checkout_link: buildAutomationPublicUrl("/shop/checkout"),
    checkout_url: buildAutomationPublicUrl("/shop/checkout"),
    available_sizes: asArray(effectiveProductContext?.sizes || safeRow.sizes || safeRow.product_sizes || []).map((value) => text(value)).filter(Boolean),
    stock_status: text(effectiveProductContext?.stock_status || safeRow.stock_status || ""),
  }));
  const templateContext = buildAutomationTemplateContext({ row: safeRow, productContext: effectiveProductContext || {}, websiteLinks });
  const publicReplyTemplate = text(config.message_templates?.publicReplyTemplate || "");
  const privateReplyTemplate = text(config.message_templates?.privateReplyTemplate || "");
  const aiOpeningPrompt = text(config.message_templates?.aiOpeningPrompt || "");
  const renderedAiOpeningPrompt = renderAutomationTemplate(aiOpeningPrompt, templateContext).trim();
  const renderedPublicReply = renderAutomationTemplate(publicReplyTemplate || "تم الرد على حضرتك في الخاص ✅", templateContext).trim() || "تم الرد على حضرتك في الخاص ✅";
  const renderedPrivateReply = renderSocialCommentTemplateText(privateReplyTemplate || buildSocialCommentSuggestedReply({
    classificationLabel: safeRow.classification_label || "",
    commenterName: templateContext.customerName || "",
    originalCommentText: safeRow.original_comment_text || "",
    postPermalink: templateContext.postPermalink || "",
  }), templateContext).trim();
  const automationCommenter = resolveAutomationCommenterIdentity(safeRow);
  const automationWebsiteProductLink = text(websiteLinks?.product_link || templateContext.product_link || templateContext.productUrl || "");
  const automationWebsiteCheckoutLink = text(websiteLinks?.checkout_link || templateContext.checkout_link || "");
  const websiteCheckoutGuidance = renderAutomationTemplate(
    "أهلًا {{customer_name}}\n{{product_name}} متاح بسعر {{price}}.\nالمقاسات المتاحة: {{available_sizes}}\nاطلبه مباشرة من هنا: {{product_link}}",
    templateContext
  ).trim();
  const automationRuntimeContext = {
    conversation: null,
    profile: null,
    lead: null,
    websiteProductLink: automationWebsiteProductLink || templateContext.productUrl || "",
  };

  console.log("SOCIAL_COMMENT_AUTOMATION_RUNTIME_START", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    comment_id: safeCommentId,
    enabled: true,
    config_enabled: Boolean(config.enabled),
    template_key: text(config.template_key || ""),
    product_id: config.product_id || null,
    product_found: hasProductContext,
    matched_key: config.lookup_matched_key || "post_id",
  });

  const persistedRuntimeState = {
    ...(safeRow.automation_state || {}),
    social_comment_runtime: {
      enabled: true,
      template_key: text(config.template_key || ""),
      product_id: config.product_id || null,
      product_found: hasProductContext,
      post_id: safePostId,
      platform: normalizedPlatform,
      ai_opening_prompt: renderedAiOpeningPrompt || aiOpeningPrompt,
      message_templates: {
        publicReplyTemplate,
        privateReplyTemplate,
        aiOpeningPrompt,
      },
      updated_at: new Date().toISOString(),
    },
    public_reply: {
      ...(safeRow.automation_state?.public_reply || {}),
      template: publicReplyTemplate,
      rendered_reply: renderedPublicReply,
    },
    private_reply: {
      ...(safeRow.automation_state?.private_reply || {}),
      template: privateReplyTemplate,
      rendered_reply: renderedPrivateReply,
    },
  };

  const persistRuntimeState = async (statePatch = {}) => persistSocialCommentAutomationState({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    commentId: safeCommentId,
    sessionId: text(safeRow.inbox_conversation_id || ""),
    channel: text(safeRow.channel || ""),
    dmStatus: statePatch.dmStatus || "",
    likeStatus: statePatch.likeStatus || "",
    publicReplyStatus: statePatch.publicReplyStatus || "",
    errorCode: statePatch.errorCode || "",
    automationState: statePatch.automationState || {},
  });

  let workingRow = {
    ...safeRow,
    automation_state: persistedRuntimeState,
  };

  const likeEnabled = Boolean(config.settings?.likeComment);
  const publicReplyEnabled = Boolean(config.settings?.publicReply);
  const privateReplyEnabled = Boolean(config.settings?.privateReply);
  const aiFollowUpEnabled = Boolean(config.settings?.aiFollowUp);
  const createLeadEnabled = Boolean(config.settings?.createLead);

  if (likeEnabled) {
    await executeAutomationStep({
      step: "likeComment",
      enabled: true,
      stepResults,
      stepData: { status: "sent" },
      persistState: async () => persistRuntimeState({
        likeStatus: "sent",
        automationState: {
          ...persistedRuntimeState,
          like_status: "sent",
        },
      }),
      run: async () => {
        await likeComment(normalizedPlatform, safeCommentId, safeTenantId);
        workingRow.like_status = "sent";
        persistedRuntimeState.like_status = "sent";
        await persistRuntimeState({
          likeStatus: "sent",
          automationState: {
            ...persistedRuntimeState,
            like_status: "sent",
          },
        }).catch(() => {});
        return { ok: true };
      },
    });
  } else {
    const result = { step: "likeComment", status: "skipped", reason: "disabled" };
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
  }

  if (publicReplyEnabled) {
    await executeAutomationStep({
      step: "publicReply",
      enabled: true,
      stepResults,
      run: async () => {
        await replyToComment(normalizedPlatform, safeCommentId, renderedPublicReply, safeTenantId);
        workingRow.public_reply_status = "sent";
        persistedRuntimeState.public_reply = {
          ...(persistedRuntimeState.public_reply || {}),
          status: "sent",
          rendered_reply: renderedPublicReply,
          sent_at: new Date().toISOString(),
        };
        await persistRuntimeState({
          publicReplyStatus: "sent",
          automationState: persistedRuntimeState,
        }).catch(() => {});
        return { ok: true };
      },
    });
  } else {
    const result = { step: "publicReply", status: "skipped", reason: "disabled" };
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
  }

  const privateReplySkippedReason = ["queued", "sending", "sent"].includes(currentPrivateReplyStatus)
    ? `private_reply_status_${currentPrivateReplyStatus}`
    : "";
  if (!privateReplyEnabled) {
    const result = { step: "privateReply", status: "skipped", reason: "disabled" };
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
  } else if (privateReplySkippedReason) {
    const result = { step: "privateReply", status: "skipped", reason: privateReplySkippedReason };
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
  } else {
    const queuedAt = new Date().toISOString();
    workingRow.dm_status = "queued";
    persistedRuntimeState.private_reply = {
      ...(persistedRuntimeState.private_reply || {}),
      status: "queued",
      queued_at: queuedAt,
      template: privateReplyTemplate,
      rendered_reply: renderedPrivateReply,
    };
    await persistRuntimeState({
      dmStatus: "queued",
      automationState: persistedRuntimeState,
    }).catch(() => {});
    await enqueueSocialCommentPrivateReplyJob({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      commentId: safeCommentId,
      postId: safePostId,
      row: workingRow,
    }).catch(() => {});
    stepResults.push({
      step: "privateReply",
      status: "queued",
      reason: "enqueued_to_worker",
      message: renderedPrivateReply,
    });
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", {
      step: "privateReply",
      status: "queued",
      reason: "enqueued_to_worker",
      message: renderedPrivateReply,
    });
  }

  if (aiFollowUpEnabled) {
    const aiFollowUpResult = await executeAutomationStep({
      step: "aiFollowUp",
      enabled: true,
      stepResults,
      stepData: { status: "linked" },
      run: async () => {
        const profileMetadata = buildAutomationProfileMetadata({
          row: {
            ...safeRow,
            commenter_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
            commenter_name: automationCommenter.commenterName || safeRow.commenter_name || "",
            commenter_profile_picture_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
          },
          productContext: effectiveProductContext || {},
          templateContext,
          websiteLinks,
        });
        const aiProfile = await upsertAiCustomerProfile({
          tenantId: safeTenantId,
          sessionId: text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
            platform: normalizedPlatform,
            postId: safePostId,
            rootCommentId: safeRow.root_comment_id || safeCommentId,
            commentId: safeCommentId,
          })),
          metadata: profileMetadata,
          message: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.commenter_name || ""),
          response: {
            answer: text(websiteCheckoutGuidance),
            detected_intent: "comment_automation_follow_up",
            confidence: 0.92,
            suggested_products: hasProductContext ? [productContext] : [],
            ai_order: null,
          },
        });
        const conversationRow = await upsertAutomationInboxConversation({
          tenantId: safeTenantId,
          platform: normalizedPlatform,
          row: {
            ...safeRow,
            channel: text(safeRow.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment")),
            last_message: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.last_message || ""),
            thread_kind: "comment",
            comment_id: safeCommentId,
            post_id: safePostId,
            commenter_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
            commenter_name: automationCommenter.commenterName || safeRow.commenter_name || "",
            commenter_profile_picture_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
            product_id: effectiveProductContext?.product_id || safeRow.product_id || "",
            product_name: effectiveProductContext?.product_name || safeRow.product_name || "",
            product_url: automationWebsiteProductLink || templateContext.productUrl || "",
          },
          productContext: effectiveProductContext || {},
          websiteProductLink: automationWebsiteProductLink || templateContext.productUrl || "",
          checkoutLink: automationWebsiteCheckoutLink || "",
          aiHandling: true,
          leadStatus: "new",
          customerProfileId: aiProfile?.id || null,
          customerName: automationCommenter.commenterName || safeRow.commenter_name || "",
          customerAvatarUrl: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
        });
        automationRuntimeContext.profile = aiProfile || null;
        automationRuntimeContext.conversation = conversationRow || null;
        if (conversationRow?.customer_profile_id && aiProfile?.id && Number(conversationRow.customer_profile_id) !== Number(aiProfile.id)) {
          await db.query(
            `
            UPDATE ai_channel_conversations
            SET customer_profile_id = $4::bigint,
                metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                updated_at = NOW()
            WHERE tenant_id = $1::bigint
              AND channel = $2::text
              AND external_conversation_id = $3::text
            `,
            [
              safeTenantId,
              text(safeRow.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment")),
              text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
                platform: normalizedPlatform,
                postId: safePostId,
                rootCommentId: safeRow.root_comment_id || safeCommentId,
                commentId: safeCommentId,
              })),
              aiProfile.id,
              JSON.stringify({
                ai_follow_up: true,
                ai_follow_up_status: "linked",
                ai_follow_up_conversation_id: text(conversationRow?.external_conversation_id || ""),
                website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
              }),
            ]
          ).catch(() => {});
        }
        return {
          status: conversationRow?.inserted ? "created" : "linked",
          reason: conversationRow?.inserted ? "conversation_created" : "conversation_linked",
          meta: {
            conversation_id: text(conversationRow?.external_conversation_id || ""),
            conversation_db_id: conversationRow?.id || null,
            customer_profile_id: aiProfile?.id || conversationRow?.customer_profile_id || null,
            website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            customer_name: automationCommenter.commenterName || safeRow.commenter_name || "",
          },
        };
      },
    });
  } else {
    const aiFollowUpResult = { step: "aiFollowUp", status: "skipped", reason: "disabled" };
    stepResults.push(aiFollowUpResult);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", aiFollowUpResult);
  }

  if (createLeadEnabled) {
    const createLeadResult = await executeAutomationStep({
      step: "createLead",
      enabled: true,
      stepResults,
      stepData: { status: "created" },
      run: async () => {
        const profileMetadata = buildAutomationProfileMetadata({
          row: {
            ...safeRow,
            commenter_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
            commenter_name: automationCommenter.commenterName || safeRow.commenter_name || "",
            commenter_profile_picture_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
          },
          productContext: effectiveProductContext || {},
          templateContext,
          websiteLinks,
        });
        const leadProfile = automationRuntimeContext.profile || await upsertAiCustomerProfile({
          tenantId: safeTenantId,
          sessionId: text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
            platform: normalizedPlatform,
            postId: safePostId,
            rootCommentId: safeRow.root_comment_id || safeCommentId,
            commentId: safeCommentId,
          })),
          metadata: profileMetadata,
          message: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.commenter_name || ""),
          response: {
            answer: text(websiteCheckoutGuidance),
            detected_intent: "comment_automation_lead",
            confidence: 0.91,
            suggested_products: hasProductContext ? [productContext] : [],
            ai_order: null,
          },
        });
        const conversationForLead = automationRuntimeContext.conversation || {
          tenant_id: safeTenantId,
          channel: text(safeRow.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment")),
          session_id: text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
            platform: normalizedPlatform,
            postId: safePostId,
            rootCommentId: safeRow.root_comment_id || safeCommentId,
            commentId: safeCommentId,
          })),
          external_conversation_id: text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
            platform: normalizedPlatform,
            postId: safePostId,
            rootCommentId: safeRow.root_comment_id || safeCommentId,
            commentId: safeCommentId,
          })),
          external_customer_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
          customer_name: automationCommenter.commenterName || safeRow.commenter_name || "",
          customer_avatar_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
          customer_profile: {
            id: leadProfile?.id || null,
            name: automationCommenter.commenterName || safeRow.commenter_name || "",
            external_customer_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
            avatar_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
          },
          latest_message_preview: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.last_message || ""),
          last_message: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.last_message || ""),
          lead_status: "new_lead",
          channel_metadata: {
            ...(safeRow.metadata || {}),
            source_type: "comment_automation",
            source: "comment_automation",
            platform: normalizedPlatform,
            post_id: safePostId,
            comment_id: safeCommentId,
            product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            checkout_link: automationWebsiteCheckoutLink || "",
            available_sizes: websiteLinks?.available_sizes || [],
            stock_status: websiteLinks?.stock_status || "",
            guidance_mode: "website_checkout",
            website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            lead_state: "new_lead",
            lead_status: "new_lead",
          },
        };
        const leadOpportunity = await createOrUpdateLeadOpportunity({
          tenantId: safeTenantId,
          conversation: conversationForLead,
          profile: leadProfile,
        });
        await db.query(
          `
          UPDATE ai_channel_conversations
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
              lead_status = COALESCE(NULLIF($5::text, ''), lead_status),
              customer_profile_id = COALESCE($6::bigint, customer_profile_id),
              updated_at = NOW()
          WHERE tenant_id = $1::bigint
            AND channel = $2::text
            AND external_conversation_id = $3::text
          `,
          [
            safeTenantId,
            text(conversationForLead.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment")),
            text(conversationForLead.external_conversation_id || ""),
            JSON.stringify({
              lead_opportunity_id: leadOpportunity?.id || null,
              lead_opportunity_status: leadOpportunity?.status || "open",
              lead_status: "new_lead",
              ai_follow_up: Boolean(aiFollowUpEnabled),
              create_lead: true,
              product_link: automationWebsiteProductLink || templateContext.productUrl || "",
              checkout_link: automationWebsiteCheckoutLink || "",
              website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            }),
            "new",
            leadProfile?.id || null,
          ]
        ).catch(() => {});
        automationRuntimeContext.profile = leadProfile || automationRuntimeContext.profile || null;
        automationRuntimeContext.lead = leadOpportunity || null;
        return {
          status: leadOpportunity?.id ? "created" : "linked",
          reason: leadOpportunity?.id ? "lead_created" : "lead_linked",
          meta: {
            lead_id: leadOpportunity?.id || null,
            profile_id: leadProfile?.id || null,
            conversation_id: text(conversationForLead.external_conversation_id || ""),
            lead_status: leadOpportunity?.status || "open",
            website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            customer_name: automationCommenter.commenterName || safeRow.commenter_name || "",
          },
        };
      },
    });
  } else {
    const createLeadResult = { step: "createLead", status: "skipped", reason: "disabled" };
    stepResults.push(createLeadResult);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", createLeadResult);
  }

  const summary = summarizeAutomationStepResults(stepResults);
  const hasExecutedStep = stepResults.some((item) => ["sent", "queued", "failed", "created", "linked", "success"].includes(text(item?.status || "")));
  const finalStatus = !hasProductContext && hasExecutedStep && summary.status === "success"
    ? "partial_success"
    : summary.status;
  await upsertSocialCommentAutomationRunSummary({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: safePostId,
    commentId: safeCommentId,
    configId: config.id ?? null,
    customerName: templateContext.customerName || safeRow.commenter_name || safeRow.customer_name || "",
    status: finalStatus,
    stepResults,
    errorMessage: summary.errorMessage,
    diagnostics: {
      config,
      product_context: effectiveProductContext,
      raw_runtime_context: buildRuntimeContextSnapshot({
        row: safeRow,
        config,
        productContext: effectiveProductContext,
        stepResults,
        summary,
      }),
    },
    row: {
      ...safeRow,
      automation_state: persistedRuntimeState,
      status: finalStatus,
      error_message: summary.errorMessage,
      product_link: automationWebsiteProductLink || templateContext.productUrl || "",
      checkout_link: automationWebsiteCheckoutLink || "",
      guidance_mode: "website_checkout",
      skipped_reason: finalStatus === "skipped" ? text(safeRow.skipped_reason || "") : "",
    },
  }).catch(() => {});

  console.log("SOCIAL_COMMENT_AUTOMATION_RUNTIME_DONE", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    comment_id: safeCommentId,
    step_results: stepResults,
  });

  return {
    applied: true,
    skipped: false,
    row: workingRow,
    step_results: stepResults,
    config,
  };
};

export const resolveSocialCommentPublishedProductContext = async ({ tenantId = null, row = {} } = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const platform = text(row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || platform !== "facebook") {
    return {
      found: false,
      source: "unsupported",
      reason: !Number.isFinite(safeTenantId) || safeTenantId <= 0 ? "invalid_tenant" : "non_facebook_platform",
      platform,
      candidate_post_ids: [],
    };
  }

  const candidatePostIds = [...new Set([
    row.post_id,
    row.metadata?.post_id,
    row.raw_payload?.post_id,
    row.raw_payload?.value?.post_id,
    row.raw_payload?.value?.media_id,
    row.raw_payload?.value?.post?.id,
    row.raw_payload?.value?.post?.post_id,
    row.raw_payload?.value?.id,
  ].map(text).filter(Boolean))];

  if (!candidatePostIds.length) {
    return {
      found: false,
      source: "missing_post_id",
      reason: "missing_post_id",
      platform,
      candidate_post_ids: [],
    };
  }

  const buildProductContext = async (productRow = {}, source = "") => {
    if (!productRow) return null;
    const product = {
      id: productRow.product_id || null,
      product_id: productRow.product_id || null,
      name: productRow.product_name || "",
      price: productRow.product_price || "",
      sale_price: productRow.product_sale_price || "",
      selling_price: productRow.product_selling_price || "",
      slug: productRow.product_slug || "",
      canonical_slug: productRow.product_canonical_slug || "",
    };
    const link = await resolveStorefrontProductLink({ tenantId: safeTenantId, product }).catch(() => ({ product_url: "" }));
    const stockCount = Number(productRow.product_stock || 0);
    const sizes = text(productRow.product_sizes || "")
      .split(",")
      .map((value) => text(value))
      .filter(Boolean);
    const colors = text(productRow.product_colors || "")
      .split(",")
      .map((value) => text(value))
      .filter(Boolean);
    return {
      found: true,
      source,
      platform,
      post_id: text(productRow.mapped_post_id || candidatePostIds[0] || ""),
      product_id: text(productRow.product_id || ""),
      product_name: text(productRow.product_name || ""),
      price: text(productRow.product_sale_price || productRow.product_price || ""),
      sale_price: text(productRow.product_sale_price || ""),
      selling_price: text(productRow.product_selling_price || productRow.product_price || ""),
      sizes,
      available_sizes: sizes,
      colors,
      stock_status: stockCount > 0 ? "in_stock" : "out_of_stock",
      product_url: text(link?.product_url || link?.url || ""),
      variant_id: text(productRow.variant_id || row.raw_payload?.variant_id || row.variant_id || ""),
      color: text(productRow.color || row.raw_payload?.color || row.color || ""),
      size: text(productRow.size || row.raw_payload?.size || row.size || ""),
      mapped_media_id: text(productRow.mapped_media_id || ""),
      candidate_post_ids: candidatePostIds,
    };
  };

  const linkResult = await db.query(
    `
    SELECT
      ppl.product_id,
      ppl.post_id AS mapped_post_id,
      ppl.media_id AS mapped_media_id,
      p.name AS product_name,
      p.price AS product_price,
      p.sale_price AS product_sale_price,
      p.selling_price AS product_selling_price,
      COALESCE(p.stock, 0) AS product_stock,
      p.slug AS product_slug,
      p.canonical_slug AS product_canonical_slug,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.size, ''), ', ' ORDER BY NULLIF(v.size, ''))
        FROM product_variants v
        WHERE v.tenant_id = ppl.business_id
          AND v.product_id = ppl.product_id
      ), '') AS product_sizes,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.color, ''), ', ' ORDER BY NULLIF(v.color, ''))
        FROM product_variants v
        WHERE v.tenant_id = ppl.business_id
          AND v.product_id = ppl.product_id
      ), '') AS product_colors
    FROM marketing_post_product_links ppl
    LEFT JOIN products p ON p.id = ppl.product_id
    WHERE ppl.business_id = $1::bigint
      AND ppl.platform = $2::text
      AND ppl.post_id = ANY($3::text[])
    ORDER BY ppl.created_at DESC, ppl.id DESC
    LIMIT 1
    `,
    [safeTenantId, platform, candidatePostIds]
  ).catch(() => ({ rows: [] }));
  const linkedContext = await buildProductContext(linkResult.rows?.[0] || null, "marketing_post_product_links");
  if (linkedContext) return linkedContext;

  const postResult = await db.query(
    `
    SELECT
      mp.product_id,
      COALESCE(NULLIF(mp.platform_post_id, ''), NULLIF(mp.external_post_id, '')) AS mapped_post_id,
      COALESCE(NULLIF(mp.platform_post_id, ''), NULLIF(mp.external_post_id, '')) AS mapped_media_id,
      p.name AS product_name,
      p.price AS product_price,
      p.sale_price AS product_sale_price,
      p.selling_price AS product_selling_price,
      COALESCE(p.stock, 0) AS product_stock,
      p.slug AS product_slug,
      p.canonical_slug AS product_canonical_slug,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.size, ''), ', ' ORDER BY NULLIF(v.size, ''))
        FROM product_variants v
        WHERE v.tenant_id = mp.tenant_id
          AND v.product_id = mp.product_id
      ), '') AS product_sizes,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.color, ''), ', ' ORDER BY NULLIF(v.color, ''))
        FROM product_variants v
        WHERE v.tenant_id = mp.tenant_id
          AND v.product_id = mp.product_id
      ), '') AS product_colors,
      mp.variant_id AS variant_id,
      mp.design_json->>'color' AS color,
      mp.design_json->>'size' AS size
    FROM marketing_posts mp
    LEFT JOIN products p ON p.id = mp.product_id
    WHERE mp.tenant_id = $1::bigint
      AND mp.product_id IS NOT NULL
      AND (
        mp.platform_post_id = ANY($2::text[])
        OR mp.external_post_id = ANY($2::text[])
      )
    ORDER BY mp.updated_at DESC, mp.created_at DESC, mp.id DESC
    LIMIT 1
    `,
    [safeTenantId, candidatePostIds]
  ).catch(() => ({ rows: [] }));
  const postContext = await buildProductContext(postResult.rows?.[0] || null, "marketing_posts");
  if (postContext) return postContext;

  return {
    found: false,
    source: "marketing_post_product_links",
    reason: "product_not_found",
    platform,
    candidate_post_ids: candidatePostIds,
  };
};

export const enqueueSocialCommentPrivateReplyJob = async ({ tenantId = null, platform = "", commentId = "", postId = "", row = {} } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeCommentId = text(commentId || row.comment_id || "");
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId) return null;
  const safePlatform = text(platform || row.platform || "facebook") === "instagram" ? "instagram" : "facebook";
  const dedupeKey = `social-comment-private-reply:${safeTenantId}:${safePlatform}:${safeCommentId}`;
  debugSocialCommentsLog("[social-comments][private-reply] queued", {
    tenant_id: safeTenantId,
    platform: safePlatform,
    post_id: text(postId || row.post_id || ""),
    comment_id: safeCommentId,
    dedupe_key: dedupeKey,
  });
  return enqueueJob(
    "social.comment.private_reply",
    {
      tenantId: safeTenantId,
      platform: safePlatform,
      postId: text(postId || row.post_id || ""),
      commentId: safeCommentId,
      row,
    },
    {
      dedupeKey,
      maxAttempts: 4,
      backoffMs: 2000,
      maxBackoffMs: 30000,
      context: {
        tenantId: safeTenantId,
        platform: safePlatform,
        commentId: safeCommentId,
        postId: text(postId || row.post_id || ""),
      },
    }
  );
};

const parseCommentTimestamp = (row = {}) => {
  const candidates = [
    row.created_at,
    row.processed_at,
    row.updated_at,
    row.raw_payload?.received_at,
    row.raw_payload?.entry?.[0]?.time,
    row.raw_payload?.entry?.[0]?.changes?.[0]?.value?.created_time,
    row.comment_created_time,
  ];
  for (const candidate of candidates) {
    const value = text(candidate || "");
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

const debugParseCommentTimestamp = (row = {}) => {
  const candidates = [
    { key: "created_at", value: row.created_at },
    { key: "processed_at", value: row.processed_at },
    { key: "updated_at", value: row.updated_at },
    { key: "raw_payload.received_at", value: row.raw_payload?.received_at },
    { key: "raw_payload.entry[0].time", value: row.raw_payload?.entry?.[0]?.time },
    { key: "raw_payload.entry[0].changes[0].value.created_time", value: row.raw_payload?.entry?.[0]?.changes?.[0]?.value?.created_time },
    { key: "comment_created_time", value: row.comment_created_time },
  ];
  for (const candidate of candidates) {
    const raw = text(candidate.value || "");
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        raw_created_time: raw,
        parsed_created_time: parsed.toISOString(),
        source_key: candidate.key,
        parse_error: "",
      };
    }
    return {
      raw_created_time: raw,
      parsed_created_time: null,
      source_key: candidate.key,
      parse_error: `invalid_date:${candidate.key}`,
    };
  }
  return {
    raw_created_time: "",
    parsed_created_time: null,
    source_key: "",
    parse_error: "missing_created_time",
  };
};

export const PRIVATE_REPLY_REQUIRES_WEBHOOK_COMMENT_CONTEXT = ({ row = {} } = {}) => {
  const platform = text(row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  const source = text(row.raw_payload?.source || row.automation_source || row.source || "").toLowerCase();
  const commentId = text(row.comment_id || "");
  const dmStatus = text(row.dm_status || row.automation_state?.private_reply?.status || "").toLowerCase();
  const hasSendingOrSent = ["sending", "sent"].includes(dmStatus);
  const isPollComment = source === "meta_comment_poll";
  const compositeCommentId = Boolean(commentId && commentId.includes("_"));
  const commentTimestampDebug = debugParseCommentTimestamp(row);
  const commentTimestamp = commentTimestampDebug.parsed_created_time ? new Date(commentTimestampDebug.parsed_created_time) : null;
  const ageMs = commentTimestamp ? Date.now() - commentTimestamp.getTime() : Number.POSITIVE_INFINITY;
  const recentEnough = ageMs <= 15 * 60 * 1000;
  const justSavedThisRun = Boolean(Number(row.id || 0)) && recentEnough;
  const allowFromPoll = platform === "facebook" && isPollComment && compositeCommentId && (recentEnough || justSavedThisRun) && !hasSendingOrSent;
  debugSocialCommentsLog("POLL_COMMENT_AGE_DEBUG", {
    comment_id: commentId,
    created_time_raw: commentTimestampDebug.raw_created_time || "",
    parsed_created_time: commentTimestampDebug.parsed_created_time || "",
    now: new Date().toISOString(),
    age_ms: Number.isFinite(ageMs) ? ageMs : null,
    age_seconds: Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : null,
    allowed_max_age_seconds: 15 * 60,
    decision: allowFromPoll ? "allowed" : "rejected",
    source,
    parse_error: commentTimestampDebug.parse_error || "",
    source_key: commentTimestampDebug.source_key || "",
  });
  return {
    platform,
    source,
    commentId,
    dmStatus,
    compositeCommentId,
    recentEnough,
    justSavedThisRun,
    allowFromPoll,
    rejectReason: !isPollComment
      ? "not_poll_comment"
      : platform !== "facebook"
        ? "non_facebook_platform"
      : !compositeCommentId
          ? "non_composite_comment_id"
          : !recentEnough && !justSavedThisRun
            ? "poll_comment_too_old"
            : hasSendingOrSent
              ? "private_reply_already_sending_or_sent"
              : "allowed",
  };
};

export const socialCommentConversationId = ({
  platform = "",
  postId = "",
  commenterId = "",
  rootCommentId = "",
  commentId = "",
} = {}) => {
  const normalizedPlatform = text(platform) === "instagram" ? "instagram" : "facebook";
  const safePostId = text(postId || "");
  if (safePostId) {
    return `${normalizedPlatform}_post:${safePostId}`;
  }
  const fallbackRoot = text(rootCommentId || commentId);
  return `social_comment:${normalizedPlatform}:${fallbackRoot}`;
};

const socialCommentLeadTemperature = (classificationLabel = "") => COMMENT_LEAD_TEMPERATURE[classificationLabel] || "cold";

const isGenericSocialCommentDisplayName = (value = "") => {
  const name = text(value).toLowerCase();
  return !name || ["customer", "unknown", "guest", "anonymous", "عميل", "العميل"].includes(name);
};

const resolveSocialCommentCustomerName = (event = {}) => {
  const candidates = [
    event.commenter_name,
    event.from?.name,
    event.from?.full_name,
    event.raw_payload?.value?.from?.name,
    event.raw_payload?.value?.from?.full_name,
    event.raw_payload?.value?.commenter_name,
    event.raw_payload?.value?.author_name,
    event.raw_payload?.comment?.from?.name,
    event.raw_payload?.comment?.from?.full_name,
    event.raw_payload?.value?.from?.name,
    event.raw_payload?.from?.name,
    event.raw_payload?.value?.comment?.from?.name,
    event.metadata?.commenter_name,
    event.username,
    event.profile_name,
    event.contact_name,
    event.author_name,
  ];
  const preferred = candidates.map(text).find((value) => value && !isGenericSocialCommentDisplayName(value));
  if (preferred) return preferred;
  const fallback = candidates.map(text).find(Boolean);
  return fallback || "";
};

const resolveSocialCommentAvatarUrl = (event = {}) =>
  text(
    event.commenter_profile_picture_url ||
      event.profile_pic_url ||
      event.profile_picture_url ||
      event.avatar_url ||
      event.from?.picture?.data?.url ||
      event.from?.picture?.url ||
      event.from?.picture ||
      event.from?.profile_pic ||
      event.metadata?.commenter_profile_picture_url ||
      event.raw_payload?.value?.from?.picture?.data?.url ||
      event.raw_payload?.value?.from?.picture?.url ||
      event.raw_payload?.value?.from?.profile_pic ||
      event.raw_payload?.value?.from?.picture ||
      event.raw_payload?.value?.comment?.from?.profile_pic ||
      event.raw_payload?.value?.comment?.from?.picture ||
      event.raw_payload?.comment?.from?.profile_pic ||
      event.raw_payload?.comment?.from?.picture ||
      event.raw_payload?.from?.profile_pic ||
      event.raw_payload?.from?.picture ||
      ""
  );

const resolveSocialCommentPostMessage = (event = {}) =>
  text(
    event.post_message ||
      event.post_caption ||
      event.raw_payload?.post?.message ||
      event.raw_payload?.post?.caption ||
      event.raw_payload?.post?.post_message ||
      event.raw_payload?.post?.post_caption ||
      event.raw_payload?.post?.caption ||
      event.raw_payload?.value?.post?.message ||
      event.raw_payload?.value?.post?.caption ||
      ""
  );

const resolveSocialCommentPostFullPicture = (event = {}) =>
  text(
    event.post_full_picture ||
      event.full_picture ||
      event.attachment_image ||
      event.post_thumbnail ||
      event.raw_payload?.post?.full_picture ||
      event.raw_payload?.post?.attachment_image ||
      event.raw_payload?.post?.post_thumbnail ||
      event.raw_payload?.value?.post?.full_picture ||
      event.raw_payload?.value?.post?.attachment_image ||
      event.raw_payload?.value?.post?.post_thumbnail ||
      ""
  );

const resolveSocialCommentPostCreatedTime = (event = {}) =>
  text(
    event.post_created_time ||
      event.raw_payload?.post?.created_time ||
      event.raw_payload?.value?.post?.created_time ||
      event.raw_payload?.post?.updated_time ||
      event.raw_payload?.value?.post?.updated_time ||
      event.comment_created_time ||
      event.raw_payload?.comment?.created_time ||
      event.raw_payload?.value?.created_time ||
      event.processed_at ||
      ""
  );

const resolveSocialCommentPostPermalink = (event = {}) =>
  text(
    event.post_permalink ||
      event.post_permalink_url ||
      event.permalink_url ||
      event.post_url ||
      event.comment_url ||
      event.raw_payload?.post_permalink ||
      event.raw_payload?.post_permalink_url ||
      event.raw_payload?.permalink_url ||
      event.raw_payload?.post_url ||
      event.raw_payload?.comment_url ||
      event.raw_payload?.permalink ||
      ""
  );

const fetchSocialCommentWebhookPostMedia = async ({ tenantId = null, event = {} } = {}) => {
  const postId = text(
    event.post_id ||
    event.metadata?.post_id ||
    event.raw_payload?.post_id ||
    event.raw_payload?.value?.post_id ||
    event.raw_payload?.value?.media_id ||
    ""
  );
  if (!postId) return null;

  const pageId = text(
    event.page_id ||
    event.metadata?.page_id ||
    event.raw_payload?.entry?.id ||
    event.raw_payload?.value?.page_id ||
    event.raw_payload?.value?.metadata?.page_id ||
    ""
  );
  const permalinkUrl = text(event.post_permalink_url || event.post_permalink || event.raw_payload?.post_permalink_url || event.raw_payload?.post_permalink || event.raw_payload?.permalink_url || event.raw_payload?.post_url || event.raw_payload?.comment_url || "");

  try {
    const fetchMetaPostPreviewDetails = await loadFetchMetaPostPreviewDetails();
    const preview = fetchMetaPostPreviewDetails
      ? await fetchMetaPostPreviewDetails({ tenantId, postId, pageId, permalinkUrl }).catch((error) => ({
          error_message: text(error?.message || "Graph fetch failed"),
          thumbnail_url: "",
          post_full_picture: "",
          full_picture: "",
          picture: "",
          media_url: "",
          media_type: "",
          attachments: [],
          post_permalink_url: permalinkUrl,
          media_enrichment_status: "failed",
        }))
      : null;
    const savedThumbnail = text(preview?.thumbnail_url || preview?.post_full_picture || preview?.full_picture || preview?.picture || "");
    const graphMediaFound = Boolean(savedThumbnail);
    const result = {
      post_id: postId,
      thumbnail_url: savedThumbnail,
      post_full_picture: text(preview?.post_full_picture || preview?.full_picture || savedThumbnail || ""),
      full_picture: text(preview?.full_picture || preview?.post_full_picture || savedThumbnail || ""),
      picture: text(preview?.picture || ""),
      media_url: text(preview?.media_url || ""),
      media_type: text(preview?.media_type || ""),
      attachments: asArray(preview?.attachments || []),
      post_permalink_url: text(preview?.post_permalink_url || preview?.permalink_url || permalinkUrl || ""),
      media_enrichment_status: graphMediaFound ? "success" : "failed",
      media_enrichment_error: text(preview?.error_message || preview?.reason_if_missing || (!graphMediaFound ? "no_media_found" : "")),
    };
    console.log("[social-comments:webhook-media-persist]", {
      post_id: postId,
      graph_media_found: graphMediaFound,
      thumbnail_url_saved: result.thumbnail_url,
      status: result.media_enrichment_status,
    });
    return result;
  } catch (error) {
    const result = {
      post_id: postId,
      thumbnail_url: "",
      post_full_picture: "",
      full_picture: "",
      picture: "",
      media_url: "",
      media_type: "",
      attachments: [],
      post_permalink_url: permalinkUrl,
      media_enrichment_status: "failed",
      media_enrichment_error: text(error?.message || "Graph fetch failed"),
    };
    console.log("[social-comments:webhook-media-persist]", {
      post_id: postId,
      graph_media_found: false,
      thumbnail_url_saved: "",
      status: result.media_enrichment_status,
    });
    return result;
  }
};

const applyWebhookPostMediaToEvent = (event = {}, media = null) => {
  if (!media || typeof media !== "object") return event;
  const thumbnailUrl = text(media.thumbnail_url || "");
  const postFullPicture = text(media.post_full_picture || media.full_picture || thumbnailUrl || "");
  const fullPicture = text(media.full_picture || media.post_full_picture || thumbnailUrl || "");
  const picture = text(media.picture || "");
  const mediaUrl = text(media.media_url || "");
  const mediaType = text(media.media_type || "");
  const attachments = asArray(media.attachments || []);
  const postPermalinkUrl = text(media.post_permalink_url || event.post_permalink_url || event.post_permalink || "");
  const mediaEnrichmentStatus = text(media.media_enrichment_status || event.media_enrichment_status || "");
  const mediaEnrichmentError = text(media.media_enrichment_error || event.media_enrichment_error || "");
  const rawPayload = {
    ...(event.raw_payload && typeof event.raw_payload === "object" ? event.raw_payload : {}),
    post_id: text(media.post_id || event.post_id || ""),
    thumbnail_url: thumbnailUrl,
    post_thumbnail: thumbnailUrl,
    post_full_picture: postFullPicture,
    full_picture: fullPicture,
    picture,
    media_url: mediaUrl,
    media_type: mediaType,
    attachments,
    post_permalink_url: postPermalinkUrl,
    media_enrichment_status: mediaEnrichmentStatus,
    media_enrichment_error: mediaEnrichmentError,
  };
  return {
    ...event,
    post_id: text(media.post_id || event.post_id || ""),
    thumbnail_url: thumbnailUrl || text(event.thumbnail_url || ""),
    post_thumbnail: thumbnailUrl || text(event.post_thumbnail || ""),
    post_full_picture: postFullPicture || text(event.post_full_picture || ""),
    full_picture: fullPicture || text(event.full_picture || ""),
    picture: picture || text(event.picture || ""),
    media_url: mediaUrl || text(event.media_url || ""),
    media_type: mediaType || text(event.media_type || ""),
    attachments: attachments.length ? attachments : asArray(event.attachments || []),
    post_permalink_url: postPermalinkUrl || text(event.post_permalink_url || event.post_permalink || ""),
    media_enrichment_status: mediaEnrichmentStatus || text(event.media_enrichment_status || ""),
    media_enrichment_error: mediaEnrichmentError || text(event.media_enrichment_error || ""),
    raw_payload: rawPayload,
  };
};

const resolveSocialCommentCustomerProfileId = async ({ tenantId = null, event = {} } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;

  const commenterId = text(
    event.commenter_id ||
      event.from?.id ||
      event.raw_payload?.value?.from?.id ||
      event.raw_payload?.comment?.from?.id ||
      event.raw_payload?.value?.comment?.from?.id ||
      event.metadata?.commenter_id ||
      ""
  );
  if (!commenterId) return null;

  try {
    await ensureAiSalesAgentSchema();
  } catch (error) {
    socialCommentsError("[social-comments] ensure sales schema failed", {
      tenant_id: safeTenantId,
      commenter_id: commenterId,
      message: error?.message || "",
    });
  }

  const existing = await db.query(
    `
    SELECT id
    FROM ai_customer_profiles
    WHERE tenant_id = $1::bigint
      AND COALESCE(external_customer_id, '') = $2::text
    ORDER BY id ASC
    LIMIT 1
    `,
    [safeTenantId, commenterId]
  ).catch(() => ({ rows: [] }));
  if (existing.rows?.[0]?.id) return existing.rows[0].id;

  const commenterName = resolveSocialCommentCustomerName(event);
  const nameParts = commenterName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || commenterName || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
  const inserted = await db.query(
    `
    INSERT INTO ai_customer_profiles (
      tenant_id,
      first_name,
      last_name,
      source_channel,
      external_customer_id,
      display_name,
      facebook_name,
      messenger_name,
      customer_name,
      last_seen_at,
      updated_at
    )
    VALUES ($1, $2, $3, 'facebook', $4, $5, $5, $5, $5, NOW(), NOW())
    RETURNING id
    `,
    [
      safeTenantId,
      firstName,
      lastName,
      commenterId,
      commenterName,
    ]
  ).catch((error) => {
    socialCommentsError("[social-comments] profile upsert failed", {
      tenant_id: safeTenantId,
      commenter_id: commenterId,
      message: error?.message || "",
    });
    return { rows: [] };
  });
  return inserted.rows?.[0]?.id || null;
};

const upsertSocialCommentLeadConversation = async ({ tenantId = null, event = {}, suggestedReply = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;
  await ensureAiSupportLogSchema();
  await ensureAiChannelAdapterSchema();

  try {
    const platform = text(event.platform || "facebook") === "instagram" ? "instagram" : "facebook";
    const channel = platform === "instagram" ? "instagram_comment" : "facebook_comment";
    const sessionId = socialCommentConversationId({
      platform,
      postId: event.post_id,
      commenterId: event.commenter_id,
      rootCommentId: event.root_comment_id,
      commentId: event.comment_id,
    });
    const threadKind = "comment";
    const commentText = text(event.original_comment_text);
    const commenterName = resolveSocialCommentCustomerName(event);
    const commenterId = text(
      event.commenter_id ||
        event.from?.id ||
        event.raw_payload?.value?.from?.id ||
        event.raw_payload?.comment?.from?.id ||
        event.raw_payload?.value?.comment?.from?.id ||
        event.metadata?.commenter_id ||
        ""
    );
    const commenterProfilePictureUrl = resolveSocialCommentAvatarUrl(event);
    const customerProfileId = bigintOrNull(await resolveSocialCommentCustomerProfileId({ tenantId: safeTenantId, event }));
    const postPermalink = resolveSocialCommentPostPermalink(event);
    const postId = text(event.post_id || "");
    const postMessage = resolveSocialCommentPostMessage(event);
    const postFullPicture = resolveSocialCommentPostFullPicture(event);
    const postCreatedTime = text(resolveSocialCommentPostCreatedTime(event) || "");
    const commentCreatedTime = text(
      event.comment_created_time ||
      event.raw_payload?.comment?.created_time ||
      event.raw_payload?.value?.created_time ||
      event.processed_at ||
      ""
    );
    const commentUrl = text(event.comment_url || event.raw_payload?.comment_url || "");
    const productContext = metadataObject(event.product_context || event.raw_payload?.product_context || {});
    const metadata = {
      thread_kind: threadKind,
      platform,
      channel,
      thread_kind_label: threadKind,
      post_id: postId,
      post_permalink_url: postPermalink,
      post_permalink: postPermalink,
      post_url: postPermalink,
      post_message: postMessage,
      post_caption: text(event.post_caption || ""),
      thumbnail_url: text(event.thumbnail_url || event.post_thumbnail || event.post_full_picture || event.full_picture || event.picture || ""),
      post_thumbnail: text(event.post_thumbnail || event.thumbnail_url || event.post_full_picture || event.full_picture || event.picture || ""),
      post_full_picture: text(event.post_full_picture || event.full_picture || event.thumbnail_url || event.post_thumbnail || ""),
      full_picture: text(event.full_picture || event.post_full_picture || event.thumbnail_url || event.post_thumbnail || ""),
      picture: text(event.picture || ""),
      media_url: text(event.media_url || ""),
      media_type: text(event.media_type || ""),
      attachments: asArray(event.attachments || []),
      post_created_time: postCreatedTime,
      comment_id: text(event.comment_id || ""),
      comment_url: commentUrl || (postPermalink && event.comment_id ? `${postPermalink}${postPermalink.includes("?") ? "&" : "?"}comment_id=${encodeURIComponent(text(event.comment_id || ""))}` : ""),
      comment_created_time: commentCreatedTime,
      root_comment_id: text(event.root_comment_id || event.comment_id || ""),
      parent_comment_id: text(event.parent_comment_id || ""),
      commenter_id: commenterId,
      commenter_name: commenterName,
      commenter_profile_picture_url: text(event.commenter_profile_picture_url || ""),
      customer_profile_id: customerProfileId,
      original_comment_text: commentText,
      media_enrichment_status: text(event.media_enrichment_status || ""),
      media_enrichment_error: text(event.media_enrichment_error || ""),
      product_context: productContext,
      product_id: text(productContext.product_id || event.product_id || ""),
      product_name: text(productContext.product_name || ""),
      product_price: text(productContext.price || ""),
      product_sale_price: text(productContext.sale_price || ""),
      product_url: text(productContext.product_url || ""),
      product_sizes: asArray(productContext.sizes || []),
      product_colors: asArray(productContext.colors || []),
      product_variant_id: text(productContext.variant_id || ""),
      product_color: text(productContext.color || ""),
      product_size: text(productContext.size || ""),
      classification_label: text(event.classification_label || ""),
      classification_score: Number(event.classification_score || 0),
      lead: {
        lead_score: Number(COMMENT_LEAD_SCORE[event.classification_label] || 0),
        lead_temperature: socialCommentLeadTemperature(event.classification_label),
        lead_reasons: [text(event.classification_label || "")].filter(Boolean),
        recommended_sales_action: "continue_conversation",
        suggested_reply: text(suggestedReply || ""),
      },
      automation_state: {
        like_status: text(event.like_status || "skipped") || "skipped",
        public_reply_status: text(event.public_reply_status || "skipped") || "skipped",
        dm_status: text(event.dm_status || "skipped") || "skipped",
        overall_status: text(event.action_taken || "classified_only") || "classified_only",
        updated_at: new Date().toISOString(),
      },
    };

    console.log("META_COMMENT_INBOX_SAVE_START", {
      tenant_id: safeTenantId,
      platform,
      channel,
      post_id: postId,
      comment_id: text(event.comment_id || ""),
      commenter_id: commenterId,
      conversation_id: sessionId,
    });

    const sessionResult = await db.query(
      `
      INSERT INTO ai_support_sessions (
        tenant_id,
      session_id,
      source,
      channel,
      thread_kind,
      customer_name,
      external_customer_id,
      customer_avatar_url,
      last_message,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      source = EXCLUDED.source,
      channel = EXCLUDED.channel,
      thread_kind = COALESCE(NULLIF(EXCLUDED.thread_kind, ''), ai_support_sessions.thread_kind),
      customer_name = CASE
        WHEN COALESCE(NULLIF(ai_support_sessions.customer_name, ''), '') = ''
          OR LOWER(ai_support_sessions.customer_name) IN ('customer', 'unknown', 'guest', 'anonymous', 'عميل', 'العميل')
          THEN COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_sessions.customer_name)
        ELSE ai_support_sessions.customer_name
      END,
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_support_sessions.external_customer_id),
      customer_avatar_url = CASE
        WHEN COALESCE(NULLIF(ai_support_sessions.customer_avatar_url, ''), '') = ''
          THEN COALESCE(NULLIF(EXCLUDED.customer_avatar_url, ''), ai_support_sessions.customer_avatar_url)
        ELSE ai_support_sessions.customer_avatar_url
      END,
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_sessions.last_message),
      updated_at = NOW()
    RETURNING id
    `,
      [safeTenantId, sessionId, channel, channel, threadKind, commenterName, commenterId, commenterProfilePictureUrl, commentText]
    );

    console.log("META_COMMENT_INBOX_CONVERSATION_UPSERTED", {
      tenant_id: safeTenantId,
      platform,
      channel,
      post_id: postId,
      comment_id: text(event.comment_id || ""),
      commenter_id: commenterId,
      conversation_id: sessionId,
      session_ref_id: bigintOrNull(sessionResult.rows[0]?.id),
    });

    debugSocialCommentsLog("[social-comments:conversation-upsert-param-debug]", {
      tenant_id: safeTenantId,
      channel,
      external_conversation_id: sessionId,
      external_customer_id: commenterId,
      thread_kind: threadKind,
      customer_name: commenterName,
      customer_avatar_url: commenterProfilePictureUrl,
      last_message: commentText,
      customer_profile_id: customerProfileId,
      metadata_keys: Object.keys(metadata || {}).slice(0, 20),
      metadata_preview: {
        post_id: metadata.post_id,
        comment_id: metadata.comment_id,
        platform: metadata.platform,
        channel: metadata.channel,
        product_id: metadata.product_id,
        product_name: metadata.product_name,
        media_enrichment_status: metadata.media_enrichment_status,
        classification_label: metadata.classification_label,
      },
    });
    await db.query(
      `
      INSERT INTO ai_channel_conversations (
        tenant_id,
        channel,
      external_conversation_id,
      external_customer_id,
      thread_kind,
      customer_name,
      customer_avatar_url,
      last_message,
      customer_profile_id,
      metadata,
      last_message_at,
      updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())
    ON CONFLICT (tenant_id, channel, external_conversation_id) DO UPDATE SET
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_channel_conversations.external_customer_id),
      thread_kind = COALESCE(NULLIF(EXCLUDED.thread_kind, ''), ai_channel_conversations.thread_kind),
      customer_name = CASE
        WHEN COALESCE(NULLIF(ai_channel_conversations.customer_name, ''), '') = ''
          OR LOWER(ai_channel_conversations.customer_name) IN ('customer', 'unknown', 'guest', 'anonymous', 'عميل', 'العميل')
          THEN COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_channel_conversations.customer_name)
        ELSE ai_channel_conversations.customer_name
      END,
      customer_avatar_url = CASE
        WHEN COALESCE(NULLIF(ai_channel_conversations.customer_avatar_url, ''), '') = ''
          THEN COALESCE(NULLIF(EXCLUDED.customer_avatar_url, ''), ai_channel_conversations.customer_avatar_url)
        ELSE ai_channel_conversations.customer_avatar_url
      END,
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_channel_conversations.last_message),
      customer_profile_id = COALESCE(EXCLUDED.customer_profile_id, ai_channel_conversations.customer_profile_id),
      metadata = ai_channel_conversations.metadata || EXCLUDED.metadata,
      last_message_at = NOW(),
      updated_at = NOW()
      `,
      [
        safeTenantId,
        channel,
        sessionId,
        commenterId,
        threadKind,
        commenterName,
        commenterProfilePictureUrl,
        commentText,
        customerProfileId,
        JSON.stringify({
          thread_kind: metadata.thread_kind,
          platform: metadata.platform,
          channel: metadata.channel,
          post_id: metadata.post_id,
          comment_id: metadata.comment_id,
          customer_profile_id: metadata.customer_profile_id ? "[bigint]" : null,
          media_enrichment_status: metadata.media_enrichment_status,
          classification_label: metadata.classification_label,
        }),
      ]
    );

    const inboundMessage = await db.query(
      `
      INSERT INTO ai_support_messages (
        session_ref_id,
        tenant_id,
        session_id,
        channel,
        customer_name,
        customer_avatar_url,
        last_message,
        message_text,
        customer_message,
        ai_answer,
        confidence,
        needs_human_support,
        sources_used,
        suggested_products,
        visual_attachments,
        suggested_actions,
        detected_intent,
        fallback_reason,
        message_type,
        staff_message,
        sender_type,
        manual_message,
        external_message_id,
        dedupe_key,
        source_path,
        insert_source,
        post_id,
        post_permalink_url,
        post_message,
        post_caption,
        post_full_picture,
        post_created_time,
        comment_id,
        parent_comment_id,
        root_comment_id,
        commenter_id,
        commenter_name,
        commenter_profile_picture_url,
        comment_created_time,
        comment_url,
        platform,
        thread_kind
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, '', 0.98, TRUE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $8, '', 'comment_inbound', '', 'customer', FALSE, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      ON CONFLICT (tenant_id, session_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
      RETURNING *
      `,
      [
        bigintOrNull(sessionResult.rows[0]?.id),
        safeTenantId,
        sessionId,
        channel,
        commenterName,
        commenterProfilePictureUrl,
        commentText,
        text(event.classification_label || ""),
        text(event.comment_id || ""),
        text(event.comment_id || ""),
        "social_comment_automation",
        "social_comment_lead",
      postId,
        postPermalink,
        postMessage,
        text(event.post_caption || ""),
        resolveSocialCommentPostFullPicture(event),
        postCreatedTime,
        text(event.comment_id || ""),
        text(event.parent_comment_id || ""),
        text(event.root_comment_id || event.comment_id || ""),
        commenterId,
        commenterName,
        commenterProfilePictureUrl,
        commentCreatedTime,
        commentUrl || (postPermalink && event.comment_id ? `${postPermalink}${postPermalink.includes("?") ? "&" : "?"}comment_id=${encodeURIComponent(text(event.comment_id || ""))}` : ""),
        platform,
        threadKind,
      ]
    );

    if (inboundMessage.rows[0]) {
      console.log("META_COMMENT_INBOX_MESSAGE_SAVED", {
        tenant_id: safeTenantId,
        platform,
        channel,
        post_id: postId,
        comment_id: text(event.comment_id || ""),
        commenter_id: commenterId,
        conversation_id: sessionId,
        message_id: inboundMessage.rows[0]?.id || null,
      });
    } else {
      console.log("META_COMMENT_INBOX_DUPLICATE", {
        tenant_id: safeTenantId,
        platform,
        channel,
        post_id: postId,
        comment_id: text(event.comment_id || ""),
        commenter_id: commenterId,
        conversation_id: sessionId,
      });
    }

    debugSocialCommentsLog("[social-comments:new-comment-ingest-debug]", {
      source: text(event.raw_payload?.source || "") === "meta_comment_poll" ? "poller" : "webhook",
      post_id: postId,
      comment_id: text(event.comment_id || ""),
      message: commentText,
      inserted_run: Boolean(sessionResult.rows[0]),
      inserted_message: Boolean(inboundMessage.rows[0]),
      conversation_id: sessionId,
    });

    const insertedRun = Boolean(sessionResult.rows[0]);
    let savedRunRow = sessionResult.rows[0] || null;
    const runtimeProductContext = await resolveSocialCommentPublishedProductContext({
      tenantId: safeTenantId,
      row: savedRunRow || {
        ...event,
        tenant_id: safeTenantId,
      },
    }).catch(() => null);
    const automationConfig = await loadPostAutomationConfig({
      tenantId: safeTenantId,
      platform,
      postId,
      row: savedRunRow || {},
    }).catch(() => null);
    const automationRuntimeResult = await executeSocialCommentAutomationRuntime({
      tenantId: safeTenantId,
      platform,
      postId,
      commentId: text(event.comment_id || savedRunRow?.comment_id || ""),
      row: savedRunRow || {},
      productContext: runtimeProductContext,
      config: automationConfig,
    }).catch((error) => {
      console.warn("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
        tenant_id: safeTenantId,
        platform,
        post_id: postId,
        comment_id: text(event.comment_id || savedRunRow?.comment_id || ""),
        reason: "runtime_error",
        message: error?.message || "",
      });
      return null;
    });
    if (automationRuntimeResult?.row) {
      savedRunRow = automationRuntimeResult.row;
    }
    const automationRuntimeApplied = Boolean(automationRuntimeResult?.applied);
    const privateReplyStatus = text(
      savedRunRow?.dm_status ||
      savedRunRow?.automation_state?.private_reply?.status ||
      event.dm_status ||
      event.automation_state?.private_reply?.status ||
      ""
    ).toLowerCase();
    const privateReplyCommentId = text(event.comment_id || savedRunRow?.comment_id || "");
    const privateReplySource = text(event.raw_payload?.source || savedRunRow?.raw_payload?.source || "").toLowerCase();
    const shouldEnqueuePrivateReply =
      text(platform || "").toLowerCase() === "facebook" &&
      Boolean(privateReplyCommentId) &&
      insertedRun &&
      !automationRuntimeApplied &&
      !["queued", "sending", "sent"].includes(privateReplyStatus);

    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_REACHED", {
      tenant_id: safeTenantId,
      platform,
      post_id: postId,
      comment_id: privateReplyCommentId,
      inserted_run: insertedRun,
      saved_run_row: Boolean(savedRunRow),
      private_reply_status: privateReplyStatus || "empty",
      source: privateReplySource,
    });

    if (shouldEnqueuePrivateReply) {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_CALLING", {
        tenant_id: safeTenantId,
        platform,
        post_id: postId,
        comment_id: privateReplyCommentId,
        private_reply_status: privateReplyStatus || "empty",
        source: privateReplySource,
      });
      await enqueueSocialCommentPrivateReplyJob({
        tenantId: safeTenantId,
        platform,
        commentId: privateReplyCommentId,
        postId,
        row: savedRunRow || {
          tenant_id: safeTenantId,
          platform,
          comment_id: privateReplyCommentId,
          post_id: postId,
          raw_payload: event.raw_payload || {},
        },
      }).catch(() => {});
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_CALLED", {
        tenant_id: safeTenantId,
        platform,
        post_id: postId,
        comment_id: privateReplyCommentId,
        private_reply_status: privateReplyStatus || "empty",
        source: privateReplySource,
      });
    } else {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_SKIPPED", {
        tenant_id: safeTenantId,
        platform,
        post_id: postId,
        comment_id: privateReplyCommentId,
        inserted_run: insertedRun,
        saved_run_row: Boolean(savedRunRow),
        private_reply_status: privateReplyStatus || "empty",
        source: privateReplySource,
        reason: text(platform || "").toLowerCase() !== "facebook"
          ? "not_facebook"
          : !privateReplyCommentId
            ? "missing_comment_id"
            : automationRuntimeApplied
              ? "runtime_already_enqueued"
            : !insertedRun
              ? "missing_saved_run"
              : `private_reply_status_${privateReplyStatus || "empty"}`,
      });
    }

    const commentsCountResult = await db.query(
      `
      SELECT COUNT(*)::int AS total_comments
      FROM ai_support_messages
      WHERE tenant_id = $1::bigint
        AND session_id = $2::text
        AND message_type = 'comment_inbound'
      `,
      [safeTenantId, sessionId]
    ).catch(() => ({ rows: [] }));
    const commentsCount = Number(commentsCountResult.rows?.[0]?.total_comments || 0);
    await db.query(
      `
      UPDATE ai_channel_conversations
      SET metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
          updated_at = NOW()
      WHERE tenant_id = $1::bigint
        AND channel = $2::text
        AND external_conversation_id = $3::text
      `,
      [
        safeTenantId,
        channel,
        sessionId,
        JSON.stringify({
          comments_count: commentsCount,
          last_comment_text: commentText,
          last_comment_at: commentCreatedTime,
          last_comment_id: text(event.comment_id || ""),
          last_commenter_name: commenterName,
          last_commenter_id: commenterId,
          post_full_picture: postFullPicture,
        }),
      ]
    ).catch(() => {});

    const suggestedMessage = text(suggestedReply || "");

    let suggestionResult = { rows: [] };
    if (suggestedMessage) {
      suggestionResult = await db.query(
        `
        INSERT INTO ai_support_messages (
          session_ref_id,
          tenant_id,
          session_id,
        channel,
        customer_name,
        customer_avatar_url,
        last_message,
        message_text,
        customer_message,
          ai_answer,
          confidence,
          needs_human_support,
          sources_used,
          suggested_products,
          visual_attachments,
          suggested_actions,
          detected_intent,
          fallback_reason,
          message_type,
          staff_message,
          sender_type,
          manual_message,
          external_message_id,
          dedupe_key,
          source_path,
          insert_source,
          delivery_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7, '', $8, 0.88, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'comment_suggestion', '', 'comment_suggestion', '', 'ai', FALSE, $9, $10, $11, $12, 'draft')
        ON CONFLICT (tenant_id, session_id, dedupe_key) WHERE dedupe_key <> '' DO UPDATE SET
          ai_answer = COALESCE(NULLIF(EXCLUDED.ai_answer, ''), ai_support_messages.ai_answer),
          last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_messages.last_message),
          message_text = COALESCE(NULLIF(EXCLUDED.message_text, ''), ai_support_messages.message_text)
        RETURNING *
        `,
        [
          bigintOrNull(sessionResult.rows[0]?.id),
          safeTenantId,
          sessionId,
          channel,
          commenterName,
          commenterProfilePictureUrl,
          commentText,
          suggestedMessage,
          `${text(event.comment_id || "")}:suggested`,
          `${text(event.comment_id || "")}:suggested`,
          "social_comment_automation",
          "social_comment_suggestion",
        ]
      );
    }

    await db.query(
      `
      UPDATE ai_support_sessions
      SET
        last_message = $3,
        channel = $4,
        thread_kind = $5,
        updated_at = NOW()
      WHERE tenant_id = $1 AND session_id = $2
      `,
      [safeTenantId, sessionId, commentText, channel, threadKind]
    );

    emitToRooms([`tenant:${safeTenantId}`], "ai_inbox:message", {
      tenant_id: safeTenantId,
      session_id: sessionId,
      message: inboundMessage.rows[0] || suggestionResult.rows[0] || null,
      at: new Date().toISOString(),
    });
    emitToRooms([`tenant:${safeTenantId}`], "ai_inbox:refresh", {
      tenant_id: safeTenantId,
      session_id: sessionId,
      at: new Date().toISOString(),
    });

    return {
      session_id: sessionId,
      thread_kind: threadKind,
      channel,
      lead_score: Number(COMMENT_LEAD_SCORE[event.classification_label] || 0),
      suggested_reply: suggestedMessage,
      message: inboundMessage.rows[0] || null,
      suggested_message: suggestionResult.rows[0] || null,
      duplicate: !inboundMessage.rows[0],
      metadata,
    };
  } catch (error) {
    console.error("META_COMMENT_INBOX_SAVE_ERROR", {
      tenant_id: safeTenantId,
      platform: text(event.platform || "facebook"),
      channel: text(event.channel || (text(event.platform) === "instagram" ? "instagram_comment" : "facebook_comment")),
      post_id: text(event.post_id || ""),
      comment_id: text(event.comment_id || ""),
      commenter_id: text(event.commenter_id || ""),
      conversation_id: text(
        socialCommentConversationId({
          platform: event.platform,
          postId: event.post_id,
          commenterId: event.commenter_id,
          rootCommentId: event.root_comment_id,
          commentId: event.comment_id,
        })
      ),
      message: error?.message || String(error),
    });
    throw error;
  }
};

const resolveSocialCommentInboxMaterializationState = async ({ tenantId = null, sessionId = "", commentId = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeSessionId = text(sessionId);
  const safeCommentId = text(commentId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeSessionId || !safeCommentId) {
    return {
      tenant_id: safeTenantId || null,
      session_id: safeSessionId,
      comment_id: safeCommentId,
      message_exists: false,
      session_exists: false,
      conversation_exists: false,
      fully_materialized: false,
      last_message: "",
    };
  }

  const [messageResult, sessionResult, conversationResult] = await Promise.all([
    db.query(
      `
      SELECT id, session_id, message_text, customer_message, last_message
      FROM ai_support_messages
      WHERE tenant_id = $1::bigint
        AND session_id = $2::text
        AND (
          external_message_id = $3::text
          OR dedupe_key = $3::text
        )
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [safeTenantId, safeSessionId, safeCommentId]
    ),
    db.query(
      `
      SELECT session_id, last_message
      FROM ai_support_sessions
      WHERE tenant_id = $1::bigint
        AND session_id = $2::text
      LIMIT 1
      `,
      [safeTenantId, safeSessionId]
    ),
    db.query(
      `
      SELECT external_conversation_id, last_message
      FROM ai_channel_conversations
      WHERE tenant_id = $1::bigint
        AND external_conversation_id = $2::text
      LIMIT 1
      `,
      [safeTenantId, safeSessionId]
    ),
  ]);

  const messageRow = messageResult.rows[0] || null;
  const sessionRow = sessionResult.rows[0] || null;
  const conversationRow = conversationResult.rows[0] || null;
  return {
    tenant_id: safeTenantId,
    session_id: safeSessionId,
    comment_id: safeCommentId,
    message_exists: Boolean(messageRow),
    session_exists: Boolean(sessionRow),
    conversation_exists: Boolean(conversationRow),
    fully_materialized: Boolean(messageRow && sessionRow && conversationRow),
    last_message:
      messageRow?.message_text ||
      messageRow?.customer_message ||
      messageRow?.last_message ||
      sessionRow?.last_message ||
      conversationRow?.last_message ||
      "",
  };
};

export const materializeSocialCommentInboxConversation = async ({
  tenantId = null,
  event = {},
  suggestedReply = "",
  updateRunLink = true,
} = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) {
    return {
      tenant_id: null,
      session_id: "",
      comment_id: text(event.comment_id || ""),
      platform: text(event.platform || "facebook") === "instagram" ? "instagram" : "facebook",
      channel: text(event.platform || "facebook") === "instagram" ? "instagram_comment" : "facebook_comment",
      already_materialized: false,
      materialized: false,
      wrote_inbox: false,
      run_link_updated: false,
      reason: "invalid_tenant",
    };
  }

  const platform = text(event.platform || "facebook") === "instagram" ? "instagram" : "facebook";
  const channel = platform === "instagram" ? "instagram_comment" : "facebook_comment";
  const sessionId = socialCommentConversationId({
    platform,
    postId: event.post_id,
    commenterId: event.commenter_id,
    rootCommentId: event.root_comment_id,
    commentId: event.comment_id,
  });
  const commentId = text(event.comment_id || "");
  const state = await resolveSocialCommentInboxMaterializationState({
    tenantId: safeTenantId,
    sessionId,
    commentId,
  });
  const shouldUpsert = true;
  let conversation = null;
  if (shouldUpsert) {
    conversation = await upsertSocialCommentLeadConversation({
      tenantId: safeTenantId,
      event,
      suggestedReply,
    });
  }

  const resolvedSessionId = conversation?.session_id || sessionId;
  let runLinkUpdated = false;
  if (updateRunLink && resolvedSessionId && commentId) {
    const runLinkResult = await db.query(
      `
      UPDATE social_comment_automation_runs
      SET inbox_conversation_id = COALESCE(NULLIF(inbox_conversation_id, ''), $3::text),
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1::bigint
        AND platform = $2::text
        AND comment_id = $4::text
      `,
      [safeTenantId, platform, resolvedSessionId, commentId]
    );
    runLinkUpdated = Number(runLinkResult.rowCount || 0) > 0;
  }

  return {
    ...state,
    tenant_id: safeTenantId,
    session_id: resolvedSessionId,
    platform,
    channel,
    already_materialized: state.fully_materialized,
    materialized: Boolean(shouldUpsert && !state.fully_materialized && conversation?.session_id),
    wrote_inbox: Boolean(shouldUpsert),
    run_link_updated: runLinkUpdated,
    conversation,
    suggested_reply: text(suggestedReply || ""),
  };
};

const resolveSocialCommentTenantAutomationSettings = async ({ tenantId = null } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) {
    return {
      tenant_id: null,
      source: "invalid_tenant",
      persisted: false,
      ...DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
    };
  }

  const settings = await getSocialAutomationSettings(safeTenantId).catch(() => ({ ...DEFAULT_SOCIAL_AUTOMATION_SETTINGS, persisted: false }));
  return {
    tenant_id: safeTenantId,
    ...normalizeSocialAutomationSettings(settings),
    source: settings.persisted === false ? "social_automation_fallback" : "social_automation_settings",
  };
};

const buildSocialCommentAutomationState = ({
  row = {},
  featureFlags = {},
  automationSettings = {},
  overallStatus = "skipped",
  reason = "",
  likeStatus = row.like_status || "skipped",
  publicReplyStatus = row.public_reply_status || "skipped",
  dmStatus = row.dm_status || "skipped",
  errorCode = row.error_code || "",
  commentId = "",
  sessionId = "",
} = {}) => ({
  eligible: COMMENT_AUTOMATION_ELIGIBLE_LABELS.has(text(row.classification_label || "")) && Number(row.classification_score || 0) >= confidenceFrom(automationSettings.min_confidence, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence),
  overall_status: overallStatus,
  reason: text(reason),
  feature_flags: {
    like: Boolean(featureFlags.like?.enabled ?? featureFlags.like),
    public_reply: Boolean(featureFlags.publicReply?.enabled ?? featureFlags.publicReply),
    private_message: Boolean(featureFlags.privateMessage?.enabled ?? featureFlags.privateMessage),
  },
  tenant_settings: {
    auto_like_enabled: Boolean(automationSettings.auto_like_enabled),
    auto_public_reply_enabled: Boolean(automationSettings.auto_public_reply_enabled),
    auto_private_message_enabled: Boolean(automationSettings.auto_private_message_enabled),
    min_confidence: confidenceFrom(automationSettings.min_confidence, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence),
  },
  like_status: text(likeStatus || "skipped") || "skipped",
  public_reply_status: text(publicReplyStatus || "skipped") || "skipped",
  dm_status: text(dmStatus || "skipped") || "skipped",
  error_code: text(errorCode || ""),
  comment_id: text(commentId || row.comment_id || ""),
  session_id: text(sessionId || row.inbox_conversation_id || ""),
  updated_at: new Date().toISOString(),
});

export const persistSocialCommentAutomationState = async ({
  tenantId = null,
  platform = "",
  commentId = "",
  sessionId = "",
  channel = "",
  actionTaken = "",
  publicReplyStatus = "",
  dmStatus = "",
  likeStatus = "",
  errorCode = "",
  automationState = null,
} = {}) => {
  const safeTenantId = Number(tenantId);
  const safeCommentId = text(commentId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId) return null;
  const safeSessionId = text(sessionId);
  const safeChannel = text(channel);
  const safeActionTaken = text(actionTaken);
  const safeAutomationState = automationState && typeof automationState === "object" ? automationState : null;
  const result = await db.query(
    `
    UPDATE social_comment_automation_runs
    SET action_taken = COALESCE(NULLIF($4::text, ''), action_taken),
        public_reply_status = COALESCE(NULLIF($5::text, ''), public_reply_status),
        dm_status = COALESCE(NULLIF($6::text, ''), dm_status),
        like_status = COALESCE(NULLIF($7::text, ''), like_status),
        error_code = COALESCE(NULLIF($8::text, ''), error_code),
        automation_state = CASE
          WHEN $9::jsonb IS NULL THEN automation_state
          ELSE COALESCE(automation_state, '{}'::jsonb) || $9::jsonb
        END,
        inbox_conversation_id = COALESCE(NULLIF($10::text, ''), inbox_conversation_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND comment_id = $3::text
    RETURNING *
    `,
    [
      safeTenantId,
      text(platform || "facebook"),
      safeCommentId,
      safeActionTaken,
      text(publicReplyStatus || ""),
      text(dmStatus || ""),
      text(likeStatus || ""),
      text(errorCode || ""),
      safeAutomationState ? JSON.stringify(safeAutomationState) : null,
      safeSessionId,
    ]
  );

  if (safeSessionId && safeChannel && safeAutomationState) {
    await db.query(
      `
      UPDATE ai_channel_conversations
      SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{automation_state}',
            $4::jsonb,
            true
          ),
          updated_at = NOW()
      WHERE tenant_id = $1::bigint
        AND channel = $2::text
        AND external_conversation_id = $3::text
      `,
      [safeTenantId, safeChannel, safeSessionId, JSON.stringify(safeAutomationState)]
    ).catch(() => {});
  }

  return result.rows[0] || null;
};

const appendSocialCommentAutomationTranscript = async ({
  tenantId = null,
  sessionId = "",
  channel = "",
  messageType = "automation_error",
  message = "",
  deliveryStatus = "",
  deliveryError = "",
  externalMessageId = "",
  externalReplyId = "",
} = {}) => {
  const safeTenantId = Number(tenantId);
  const safeSessionId = text(sessionId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeSessionId || !text(message)) return null;
  return appendAutomationSupportTranscript({
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    message: text(message),
    messageType,
    channel,
    deliveryStatus: text(deliveryStatus),
    deliveryError: text(deliveryError),
    externalMessageId: text(externalMessageId),
    externalReplyId: text(externalReplyId),
    staffUserName: "Social Comment Automation",
    senderType: "staff",
    sourcePath: "social_comment_automation",
    insertSource: "social_comment_automation",
  }).catch((error) => {
    console.error("[social-comments][automation] transcript insert failed", {
      tenant_id: safeTenantId,
      session_id: safeSessionId,
      channel,
      message_type: messageType,
      message: error?.message || "",
    });
    return null;
  });
};

export const buildSocialCommentAutomationDecision = ({
  row = {},
  featureFlags = getSocialCommentAutomationEnvFlags(),
  automationSettings = DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
} = {}) => {
  const label = text(row.classification_label || "");
  const score = Number(row.classification_score || 0);
  const settings = normalizeSocialAutomationSettings(automationSettings);
  const minConfidence = confidenceFrom(settings.min_confidence, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence);
  const eligible = COMMENT_AUTOMATION_ELIGIBLE_LABELS.has(label) && score >= minConfidence;
  const tenantRequested = {
    like: Boolean(settings.auto_like_enabled),
    publicReply: Boolean(settings.auto_public_reply_enabled),
    privateMessage: Boolean(settings.auto_private_message_enabled),
  };
  const requested = {
    like: tenantRequested.like && !isSocialAutomationEnvDisabled(featureFlags.like),
    publicReply: tenantRequested.publicReply && !isSocialAutomationEnvDisabled(featureFlags.publicReply),
    privateMessage: tenantRequested.privateMessage && !isSocialAutomationEnvDisabled(featureFlags.privateMessage),
  };
  const requestedCount = Object.values(requested).filter(Boolean).length;
  const requestedAnyByTenant = Object.values(tenantRequested).some(Boolean);
  const requestedAnyByEnv = Object.values(featureFlags).some((flag) => !isSocialAutomationEnvDisabled(flag));
  const envDisabledAllRequested = requestedAnyByTenant && !requestedCount && Object.entries(tenantRequested).some(([key, enabled]) => enabled && isSocialAutomationEnvDisabled(featureFlags[key]));
  const enabled = eligible && requestedCount > 0;
  const reason = !eligible
    ? (score < minConfidence ? "low_confidence_comment" : "ineligible_comment")
    : !requestedAnyByTenant
      ? "tenant_automation_disabled"
      : requestedCount <= 0
        ? (envDisabledAllRequested ? "feature_flags_disabled" : "tenant_automation_disabled")
        : "";
  return {
    eligible,
    enabled,
    reason,
    requested,
    tenantRequested,
    minConfidence,
    confidenceOk: score >= minConfidence,
    featureFlags,
    automationSettings: settings,
    requestedAnyByTenant,
    requestedAnyByEnv,
  };
};

export const executeSocialCommentAutomation = async ({
  tenantId = null,
  row = {},
  conversation = null,
  featureFlags = getSocialCommentAutomationEnvFlags(),
  automationSettings = null,
  deps = {},
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const safeRow = row || {};
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeRow.comment_id) return { skipped: true, reason: "invalid_input" };
  const effectiveSettings = automationSettings || await resolveSocialCommentTenantAutomationSettings({ tenantId: safeTenantId });
  const decision = buildSocialCommentAutomationDecision({ row: safeRow, featureFlags, automationSettings: effectiveSettings });
  const sessionId = text(safeRow.inbox_conversation_id || conversation?.session_id || `social_comment:${text(safeRow.platform || "facebook")}:${text(safeRow.root_comment_id || safeRow.comment_id)}`);
  const channel = text(safeRow.channel || (text(safeRow.platform) === "instagram" ? "instagram_comment" : "facebook_comment"));
  const appendTranscript = deps.appendTranscriptFn || appendSocialCommentAutomationTranscript;
  const persistState = deps.persistStateFn || persistSocialCommentAutomationState;
  const stageSummary = buildSocialCommentAutomationState({
    row: safeRow,
    featureFlags: decision.featureFlags,
    automationSettings: decision.automationSettings,
    overallStatus: decision.enabled ? "pending" : "skipped",
    reason: decision.reason,
    commentId: safeRow.comment_id,
    sessionId,
  });
  const hasPriorFinalState = [safeRow.like_status, safeRow.public_reply_status, safeRow.dm_status]
    .map((status) => text(status).toLowerCase())
    .some((status) => socialCommentAutomationStepFinal(status))
    || ["completed", "partial", "failed"].includes(text(safeRow.automation_state?.overall_status || safeRow.automation_state?.status || "").toLowerCase());

  if (!decision.enabled) {
    if (hasPriorFinalState) {
      return { skipped: true, reason: decision.reason || "automation_disabled", decision, row: safeRow, preserved: true };
    }
    const skippedRow = await persistState({
      tenantId: safeTenantId,
      platform: safeRow.platform,
      commentId: safeRow.comment_id,
      sessionId,
      channel,
      actionTaken: decision.eligible ? `automation_skipped_${decision.reason || "disabled"}` : "automation_skipped_ineligible",
      likeStatus: "skipped",
      publicReplyStatus: "skipped",
      dmStatus: "skipped",
      errorCode: decision.reason || "",
      automationState: stageSummary,
    });
    return { skipped: true, reason: decision.reason || "automation_disabled", decision, row: skippedRow || safeRow };
  }

  const likeFn = deps.likeCommentFn || likeComment;
  const publicReplyFn = deps.replyToCommentFn || replyToComment;
  const privateReplyFn = deps.sendPrivateReplyFn || sendPrivateReply;
  const publicReplyText = text(decision.automationSettings?.public_reply_template || COMMENT_AUTOMATION_PUBLIC_REPLY_TEXT);
  const privateReplyTemplate = text(decision.automationSettings?.private_message_template || "");
  const replyText = text(privateReplyTemplate || conversation?.suggested_reply || conversation?.metadata?.lead?.suggested_reply || safeRow.suggested_reply || buildSocialCommentSuggestedReply({
    classificationLabel: safeRow.classification_label,
    commenterName: safeRow.commenter_name,
    originalCommentText: safeRow.original_comment_text,
    postPermalink: safeRow.post_permalink,
  }));
  const automationState = {
    ...stageSummary,
    overall_status: "running",
    requested_steps: decision.requested,
  };
  let likeStatus = text(safeRow.like_status || "");
  let publicReplyStatus = text(safeRow.public_reply_status || "");
  let dmStatus = text(safeRow.dm_status || "");
  let errorCode = text(safeRow.error_code || "");
  const requestedAny = Object.values(decision.requested).some(Boolean);
  const currentStatuses = {
    like: likeStatus || "skipped",
    public_reply: publicReplyStatus || "skipped",
    private_message: dmStatus || "skipped",
  };

  const reportState = async ({ actionTaken = "", reason = "" } = {}) => {
    automationState.overall_status = reason ? "partial" : "completed";
    automationState.reason = reason || automationState.reason || "";
    automationState.like_status = likeStatus || automationState.like_status || "skipped";
    automationState.public_reply_status = publicReplyStatus || automationState.public_reply_status || "skipped";
    automationState.dm_status = dmStatus || automationState.dm_status || "skipped";
    automationState.error_code = errorCode || automationState.error_code || "";
    automationState.updated_at = new Date().toISOString();
    return persistState({
      tenantId: safeTenantId,
      platform: safeRow.platform,
      commentId: safeRow.comment_id,
      sessionId,
      channel,
      actionTaken,
      likeStatus,
      publicReplyStatus,
      dmStatus,
      errorCode,
      automationState,
    });
  };

  if (!requestedAny) {
    if (hasPriorFinalState) {
      return { skipped: true, reason: "feature_flags_disabled", decision, row: safeRow, preserved: true };
    }
    automationState.overall_status = "skipped";
    automationState.reason = "feature_flags_disabled";
    const skippedRow = await reportState({ actionTaken: "automation_skipped_feature_flags", reason: "feature_flags_disabled" });
    return { skipped: true, reason: "feature_flags_disabled", decision, row: skippedRow || safeRow };
  }

  const publicReplyNeeded = decision.requested.publicReply && !socialCommentAutomationStepFinal(publicReplyStatus);
  const likeNeeded = decision.requested.like && !socialCommentAutomationStepFinal(likeStatus);
  const privateMessageNeeded = decision.requested.privateMessage && !socialCommentAutomationStepFinal(dmStatus);
  const stepErrors = [];

  const runStep = async ({
    key,
    messageType,
    deliveryStatusValue,
    send,
    message,
    successLabel,
    failureLabel,
    buildExternalId,
  }) => {
    try {
      const response = await send();
      const externalReplyId = text(buildExternalId?.(response) || response?.id || response?.comment_id || response?.reply_id || "");
      await appendTranscript({
        tenantId: safeTenantId,
        sessionId,
        channel,
        messageType,
        message,
        deliveryStatus: deliveryStatusValue,
        deliveryError: "",
        externalMessageId: externalReplyId,
        externalReplyId,
      });
      if (key === "like") likeStatus = "sent";
      if (key === "public_reply") publicReplyStatus = "sent";
      if (key === "private_message") dmStatus = "sent";
      automationState[key === "public_reply" ? "public_reply_status" : key === "private_message" ? "dm_status" : "like_status"] = "sent";
      automationState.last_success = key;
      automationState.last_error = "";
      console.log(`[social-comments][automation] ${successLabel}`, {
        tenant_id: safeTenantId,
        comment_id: safeRow.comment_id,
        session_id: sessionId,
        channel,
      });
      return null;
    } catch (error) {
      const errorMessage = error?.message || `${key} failed`;
      const failureCode = !error?.status || /fetch failed|network|timeout|ENOTFOUND|ECONNREFUSED/i.test(errorMessage)
        ? "transport_failed"
        : "meta_reply_failed";
      if (key === "like") likeStatus = "failed";
      if (key === "public_reply") publicReplyStatus = "failed";
      if (key === "private_message") dmStatus = "failed";
      errorCode = failureCode;
      automationState[key === "public_reply" ? "public_reply_status" : key === "private_message" ? "dm_status" : "like_status"] = "failed";
      automationState.last_error = errorMessage;
      automationState.error_code = failureCode;
      await appendTranscript({
        tenantId: safeTenantId,
        sessionId,
        channel,
        messageType: "automation_error",
        message: errorMessage,
        deliveryStatus: "failed",
        deliveryError: errorMessage,
        externalMessageId: "",
        externalReplyId: "",
      });
      await appendTranscript({
        tenantId: safeTenantId,
        sessionId,
        channel,
        messageType,
        message,
        deliveryStatus: "failed",
        deliveryError: errorMessage,
        externalMessageId: "",
        externalReplyId: "",
      });
      stepErrors.push({ key, message: errorMessage, code: failureCode });
      console.warn(`[social-comments][automation] ${failureLabel}`, {
        tenant_id: safeTenantId,
        comment_id: safeRow.comment_id,
        session_id: sessionId,
        channel,
        code: failureCode,
        message: errorMessage,
      });
      return errorMessage;
    }
  };

  if (likeNeeded) {
    await runStep({
      key: "like",
      messageType: "comment_like",
      deliveryStatusValue: "sent",
      send: () => likeFn(safeRow.platform, safeRow.comment_id, safeTenantId),
      message: "تم عمل لايك على الكومنت",
      successLabel: "like success",
      failureLabel: "like failed",
    });
  } else if (decision.requested.like) {
    likeStatus = socialCommentAutomationStepFinal(likeStatus) ? likeStatus : "skipped";
  }

  if (publicReplyNeeded) {
    await runStep({
      key: "public_reply",
      messageType: "comment_public_reply",
      deliveryStatusValue: "sent",
      send: () => publicReplyFn(safeRow.platform, safeRow.comment_id, publicReplyText, safeTenantId),
      message: publicReplyText,
      successLabel: "public reply success",
      failureLabel: "public reply failed",
      buildExternalId: (response) => response?.id || response?.comment_id || response?.reply_id || "",
    });
  } else if (decision.requested.publicReply) {
    publicReplyStatus = socialCommentAutomationStepFinal(publicReplyStatus) ? publicReplyStatus : "skipped";
  }

  if (privateMessageNeeded) {
    await runStep({
      key: "private_message",
      messageType: "comment_private_reply",
      deliveryStatusValue: "sent",
      send: () => privateReplyFn(safeRow.platform, safeRow.comment_id, replyText || publicReplyText, safeTenantId),
      message: replyText || publicReplyText,
      successLabel: "private message success",
      failureLabel: "private message failed",
      buildExternalId: (response) => response?.id || response?.message_id || response?.reply_id || "",
    });
  } else if (decision.requested.privateMessage) {
    dmStatus = socialCommentAutomationStepFinal(dmStatus) ? dmStatus : "skipped";
  }

  const hasAnySent = [likeStatus, publicReplyStatus, dmStatus].some((status) => text(status).toLowerCase() === "sent");
  const hasAnyFailed = [likeStatus, publicReplyStatus, dmStatus].some((status) => text(status).toLowerCase() === "failed");
  const overallStatus = stepErrors.length
    ? (hasAnySent ? "partial" : "failed")
    : (hasAnyFailed ? (hasAnySent ? "partial" : "failed") : "completed");
  automationState.overall_status = overallStatus;
  automationState.reason = stepErrors.length ? "automation_step_failed" : (hasAnyFailed ? "previous_step_failed" : "");
  automationState.error_code = errorCode || "";
  automationState.like_status = likeStatus || "skipped";
  automationState.public_reply_status = publicReplyStatus || "skipped";
  automationState.dm_status = dmStatus || "skipped";
  automationState.updated_at = new Date().toISOString();

  const finalAction = overallStatus === "completed"
    ? "automation_completed"
    : overallStatus === "partial"
      ? "automation_partial"
      : "automation_failed";
  const updatedRow = await reportState({ actionTaken: finalAction, reason: automationState.reason || "" });
  emitToRooms([`tenant:${safeTenantId}`], "ai_inbox:refresh", {
    tenant_id: safeTenantId,
    session_id: sessionId,
    at: new Date().toISOString(),
  });

  return {
    skipped: false,
    decision,
    row: updatedRow || safeRow,
    session_id: sessionId,
    channel,
    status: overallStatus,
    like_status: likeStatus || "skipped",
    public_reply_status: publicReplyStatus || "skipped",
    dm_status: dmStatus || "skipped",
    error_code: errorCode || "",
    automation_state: automationState,
    errors: stepErrors,
  };
};

let socialCommentSchemaReadyPromise = null;

export const ensureSocialCommentAutomationSchema = async (clientOrPool = db) => {
  if (!socialCommentSchemaReadyPromise) {
    socialCommentSchemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS social_comment_automation_runs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          platform TEXT NOT NULL,
          channel TEXT NOT NULL,
          post_id TEXT NOT NULL DEFAULT '',
          post_permalink TEXT NOT NULL DEFAULT '',
          comment_id TEXT NOT NULL,
          parent_comment_id TEXT NOT NULL DEFAULT '',
          root_comment_id TEXT NOT NULL DEFAULT '',
          commenter_id TEXT NOT NULL DEFAULT '',
          commenter_name TEXT NOT NULL DEFAULT '',
          commenter_profile_picture_url TEXT NOT NULL DEFAULT '',
          original_comment_text TEXT NOT NULL DEFAULT '',
          classification_label TEXT NULL,
          classification_score NUMERIC(6,4) NULL,
          action_taken TEXT NULL,
          public_reply_status TEXT NULL,
          dm_status TEXT NULL,
          like_status TEXT NULL,
          inbox_conversation_id TEXT NULL,
          error_code TEXT NULL,
          automation_state JSONB NOT NULL DEFAULT '{}'::jsonb,
          raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          skipped_reason TEXT NOT NULL DEFAULT '',
          matched_config_key TEXT NOT NULL DEFAULT '',
          resolved_post_id TEXT NOT NULL DEFAULT '',
          resolved_platform_post_id TEXT NOT NULL DEFAULT '',
          resolved_product_id BIGINT NULL,
          duplicate_reason TEXT NOT NULL DEFAULT '',
          config_found BOOLEAN NOT NULL DEFAULT FALSE,
          config_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          processed_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, platform, comment_id)
        )
      `);

      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_created ON social_comment_automation_runs (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_platform ON social_comment_automation_runs (tenant_id, platform, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_comment ON social_comment_automation_runs (tenant_id, comment_id)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_post_platform ON social_comment_automation_runs (tenant_id, post_id, platform, created_at DESC)`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS config_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS status TEXT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS step_results JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS error_message TEXT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS automation_state JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS skipped_reason TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS matched_config_key TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS resolved_post_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS resolved_platform_post_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS resolved_product_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS duplicate_reason TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS config_found BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS config_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS social_comment_automation_run_audits (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          platform TEXT NOT NULL,
          post_id TEXT NOT NULL DEFAULT '',
          comment_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'duplicate_skipped',
          skipped_reason TEXT NOT NULL DEFAULT '',
          matched_config_key TEXT NOT NULL DEFAULT '',
          resolved_post_id TEXT NOT NULL DEFAULT '',
          resolved_platform_post_id TEXT NOT NULL DEFAULT '',
          resolved_product_id BIGINT NULL,
          duplicate_reason TEXT NOT NULL DEFAULT '',
          config_found BOOLEAN NOT NULL DEFAULT FALSE,
          config_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          step_results JSONB NOT NULL DEFAULT '[]'::jsonb,
          product_link TEXT NOT NULL DEFAULT '',
          checkout_link TEXT NOT NULL DEFAULT '',
          guidance_mode TEXT NOT NULL DEFAULT 'website_checkout',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS matched_config_key TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS resolved_post_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS resolved_platform_post_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS resolved_product_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS duplicate_reason TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS config_found BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS config_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_run_audits_tenant_created ON social_comment_automation_run_audits (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_run_audits_tenant_platform_post ON social_comment_automation_run_audits (tenant_id, platform, post_id, created_at DESC)`);
    })();
  }

  return socialCommentSchemaReadyPromise;
};

const normalizedPlatform = (body = {}) => lower(body.object) === "instagram" ? "instagram" : "facebook";
const normalizedChannel = (platform = "") => platform === "instagram" ? "instagram_comment" : "facebook_comment";

const isCommentChange = (body = {}, change = {}) => {
  const field = lower(change.field);
  const value = change.value || {};
  const item = lower(value.item);
  const verb = lower(value.verb);
  const allowedVerb = ["add", "created", "edited", "edit", ""].includes(verb);
  if (body.object === "instagram" && (field === "comments" || field === "mentions") && item === "comment" && allowedVerb) return true;
  if (field === "feed" && item === "comment" && allowedVerb) return true;
  return Boolean(value.comment_id || value.parent_id || value.post_id || value.media_id);
};

const firstText = (...values) => values.map((value) => text(value)).find(Boolean) || "";
const extractGraphPictureUrl = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return text(value);
  return firstText(value.data?.url, value.url, value.source, value.picture?.url, value.picture?.data?.url);
};
const bigintOrNull = (value) => {
  const normalized = text(value || "");
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const deriveCommentId = ({ platform = "", postId = "", parentCommentId = "", commenterId = "", commentText = "", timestamp = "", value = {}, change = {}, entry = {}, body = {} } = {}) => {
  const explicit = firstText(
    value.comment_id,
    value.id,
    value.comment?.id,
    value.commentId,
    value.comment_id_str,
    change.comment_id,
    change.id,
    entry.comment_id,
    entry.id
  );
  if (explicit) return explicit;
  const source = [
    platform,
    postId,
    parentCommentId,
    commenterId,
    commentText,
    timestamp,
    value.permalink_url || value.permalink || value.link || "",
    body.object || "",
  ].join("|");
  return `comment:${crypto.createHash("sha256").update(source).digest("hex")}`;
};

const normalizeCommentWebhookChange = ({ body = {}, entry = {}, change = {}, tenantId = null } = {}) => {
  const value = change.value || {};
  const platform = normalizedPlatform(body);
  const channel = normalizedChannel(platform);
  const postId = firstText(value.post_id, value.media_id, value.id, entry.id);
  const postPermalink = firstText(value.permalink_url, value.post_permalink, value.permalink, value.link, value.url);
  const postMessage = firstText(value.post_message, value.post_caption, value.post?.message, value.post?.caption);
  const postCreatedTime = firstText(value.post_created_time, value.post?.created_time, value.post?.updated_time);
  const commenterId = firstText(value.from?.id, value.from?.username, value.sender_id, value.user_id, value.commenter_id, value.author_id);
  const commenterName = firstText(value.from?.name, value.from?.username, value.username, value.commenter_name, value.author_name, value.from?.full_name);
  const commenterProfilePictureUrl = firstText(
    value.from?.profile_pic,
    value.from?.profile_picture_url,
    value.profile_picture_url,
    value.profile_pic_url,
    value.user_profile_picture,
    extractGraphPictureUrl(value.from?.picture)
  );
  const originalCommentText = firstText(value.message, value.text, value.comment_text, value.caption, value.message_text);
  const timestamp = firstText(value.created_time, value.timestamp, change.created_time, change.timestamp, entry.time, entry.created_time);
  const commentId = deriveCommentId({
    platform,
    postId,
    parentCommentId: firstText(value.parent_id, value.parent_comment_id, value.parent?.id),
    commenterId,
    commentText: originalCommentText,
    timestamp,
    value,
    change,
    entry,
    body,
  });
  const parentCommentId = firstText(value.parent_id, value.parent_comment_id, value.parent?.id);
  const rootCommentId = firstText(value.root_comment_id, value.root_id, value.thread_root_id, value.thread_id, value.parent_id, value.parent_comment_id) || commentId;
  const commentUrl = postPermalink && commentId ? `${postPermalink}${postPermalink.includes("?") ? "&" : "?"}comment_id=${encodeURIComponent(commentId)}` : "";
  const classification = classifySocialCommentIntent(originalCommentText);
  const pageId = firstText(entry.id, value.page_id, value.metadata?.page_id, value.account_id);
  console.log("[COMMENT_EVENT_PARSED]", {
    platform,
    page_id: pageId,
    post_id: postId,
    comment_id: commentId,
    from_id: commenterId,
    text_length: originalCommentText.length,
  });

  return {
    tenant_id: tenantId,
    platform,
    channel,
    post_id: postId,
    post_permalink: postPermalink,
    post_permalink_url: postPermalink,
    post_message: postMessage,
    post_caption: firstText(value.post_caption, value.post?.caption),
    post_created_time: postCreatedTime || "",
    comment_id: commentId,
    comment_created_time: timestamp,
    comment_url: commentUrl,
    parent_comment_id: parentCommentId,
    root_comment_id: rootCommentId,
    commenter_id: commenterId,
    commenter_name: commenterName,
    commenter_profile_picture_url: commenterProfilePictureUrl,
    original_comment_text: originalCommentText,
    classification_label: classification.label,
    classification_score: classification.score,
    action_taken: "classified_only",
    public_reply_status: null,
    dm_status: null,
    like_status: null,
    inbox_conversation_id: null,
    error_code: null,
    automation_state: {},
    raw_payload: {
      source: "meta_webhook",
      body_object: body.object || "",
      entry_id: entry.id || "",
      field: change.field || "",
      item: value.item || "",
      verb: value.verb || "",
      value,
      entry,
      body,
      platform,
      channel,
      comment_id: commentId,
      post_message: postMessage,
      post_caption: firstText(value.post_caption, value.post?.caption),
      post_created_time: postCreatedTime || "",
      comment_created_time: timestamp,
      comment_url: commentUrl,
    },
    processed_at: new Date().toISOString(),
  };
};

export const extractSocialCommentWebhookEvents = ({ body = {}, tenantId = null } = {}) => {
  const events = [];
  asArray(body.entry).forEach((entry) => {
    asArray(entry.changes).forEach((change) => {
      const value = change.value || {};
      console.log("[META_WEBHOOK_CHANGE_DEBUG]", {
        object: text(body.object || ""),
        field: text(change.field || ""),
        item: text(value.item || ""),
        verb: text(value.verb || ""),
        post_id: text(value.post_id || value.media_id || value.id || entry.id || ""),
        comment_id: text(value.comment_id || value.commentId || value.id || ""),
        from_id: text(value.from?.id || value.from?.user_id || value.user_id || ""),
        from_name: text(value.from?.name || value.from?.full_name || value.commenter_name || value.author_name || ""),
        message: text(value.message || value.text || value.comment_text || value.message_text || ""),
        raw_value_keys: Object.keys(value || {}),
      });
      if (!isCommentChange(body, change)) return;
      console.log("[COMMENT_WEBHOOK_HIT]", {
        platform: normalizedPlatform(body),
        field: text(change.field || ""),
        object: text(body.object || ""),
        entry_id: entry.id || "",
      });
      const normalized = normalizeCommentWebhookChange({ body, entry, change, tenantId });
      if (!normalized.comment_id) return;
      events.push(normalized);
    });
  });
  return events;
};

export const storeSocialCommentAutomationRuns = async ({ tenantId = null, events = [] } = {}) => {
  await ensureSocialCommentAutomationSchema();
  const stored = [];
  for (const event of asArray(events)) {
    let normalized = {
      tenant_id: tenantId ?? event.tenant_id,
      platform: text(event.platform || "facebook") || "facebook",
      channel: text(event.channel || (text(event.platform) === "instagram" ? "instagram_comment" : "facebook_comment")) || "facebook_comment",
      post_id: text(event.post_id || ""),
      post_permalink: text(event.post_permalink || ""),
      comment_id: text(event.comment_id || ""),
      parent_comment_id: text(event.parent_comment_id || ""),
      root_comment_id: text(event.root_comment_id || ""),
      commenter_id: text(event.commenter_id || ""),
      commenter_name: text(event.commenter_name || ""),
      commenter_profile_picture_url: text(event.commenter_profile_picture_url || ""),
      original_comment_text: text(event.original_comment_text || ""),
      post_message: text(event.post_message || ""),
      post_caption: text(event.post_caption || ""),
      post_full_picture: text(event.post_full_picture || event.full_picture || ""),
      post_created_time: text(event.post_created_time || ""),
      comment_created_time: text(event.comment_created_time || ""),
      comment_url: text(event.comment_url || ""),
      post_permalink_url: text(event.post_permalink_url || event.post_permalink || ""),
      classification_label: event.classification_label ?? null,
      classification_score: event.classification_score ?? null,
      action_taken: event.action_taken ?? "ingested",
      public_reply_status: event.public_reply_status ?? null,
      dm_status: event.dm_status ?? null,
      like_status: event.like_status ?? null,
      inbox_conversation_id: event.inbox_conversation_id ?? null,
      error_code: event.error_code ?? null,
      automation_state: event.automation_state && typeof event.automation_state === "object" ? event.automation_state : {},
      raw_payload: {
        ...(event.raw_payload && typeof event.raw_payload === "object" ? event.raw_payload : { raw_payload: event.raw_payload ?? null }),
        post_message: text(event.post_message || ""),
        post_caption: text(event.post_caption || ""),
        post_full_picture: text(event.post_full_picture || event.full_picture || ""),
        post_created_time: text(event.post_created_time || ""),
        comment_created_time: text(event.comment_created_time || ""),
        comment_url: text(event.comment_url || ""),
        post_permalink_url: text(event.post_permalink_url || event.post_permalink || ""),
      },
      post_message: text(event.post_message || ""),
      post_caption: text(event.post_caption || ""),
      post_created_time: text(event.post_created_time || ""),
      comment_created_time: text(event.comment_created_time || ""),
      comment_url: text(event.comment_url || ""),
      post_permalink_url: text(event.post_permalink_url || event.post_permalink || ""),
      processed_at: event.processed_at ? new Date(event.processed_at).toISOString() : new Date().toISOString(),
    };

    const insertResult = await db.query(
      `
      INSERT INTO social_comment_automation_runs (
        tenant_id, platform, channel, post_id, post_permalink, comment_id, parent_comment_id, root_comment_id,
        commenter_id, commenter_name, commenter_profile_picture_url, original_comment_text, classification_label,
        classification_score, action_taken, public_reply_status, dm_status, like_status, inbox_conversation_id,
        error_code, automation_state, raw_payload, processed_at, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        $20, $21::jsonb, $22::jsonb, $23::timestamp, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (tenant_id, platform, comment_id) DO UPDATE SET
        channel = EXCLUDED.channel,
        post_id = EXCLUDED.post_id,
        post_permalink = EXCLUDED.post_permalink,
        parent_comment_id = EXCLUDED.parent_comment_id,
        root_comment_id = EXCLUDED.root_comment_id,
        commenter_id = EXCLUDED.commenter_id,
        commenter_name = COALESCE(NULLIF(EXCLUDED.commenter_name, ''), social_comment_automation_runs.commenter_name),
        commenter_profile_picture_url = COALESCE(NULLIF(EXCLUDED.commenter_profile_picture_url, ''), social_comment_automation_runs.commenter_profile_picture_url),
        original_comment_text = COALESCE(NULLIF(EXCLUDED.original_comment_text, ''), social_comment_automation_runs.original_comment_text),
        classification_label = COALESCE(social_comment_automation_runs.classification_label, EXCLUDED.classification_label),
        classification_score = COALESCE(social_comment_automation_runs.classification_score, EXCLUDED.classification_score),
        action_taken = CASE
          WHEN social_comment_automation_runs.action_taken IS NULL OR social_comment_automation_runs.action_taken = 'ingested'
            THEN EXCLUDED.action_taken
          ELSE social_comment_automation_runs.action_taken
        END,
        public_reply_status = COALESCE(social_comment_automation_runs.public_reply_status, EXCLUDED.public_reply_status),
        dm_status = COALESCE(social_comment_automation_runs.dm_status, EXCLUDED.dm_status),
        like_status = COALESCE(social_comment_automation_runs.like_status, EXCLUDED.like_status),
        inbox_conversation_id = COALESCE(social_comment_automation_runs.inbox_conversation_id, EXCLUDED.inbox_conversation_id),
        error_code = COALESCE(social_comment_automation_runs.error_code, EXCLUDED.error_code),
        automation_state = COALESCE(social_comment_automation_runs.automation_state, EXCLUDED.automation_state),
        raw_payload = EXCLUDED.raw_payload,
        processed_at = COALESCE(social_comment_automation_runs.processed_at, EXCLUDED.processed_at),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [
        normalized.tenant_id,
        normalized.platform,
        normalized.channel,
        normalized.post_id,
        normalized.post_permalink,
        normalized.comment_id,
        normalized.parent_comment_id,
        normalized.root_comment_id,
        normalized.commenter_id,
        normalized.commenter_name,
        normalized.commenter_profile_picture_url,
        normalized.original_comment_text,
        normalized.classification_label,
        normalized.classification_score,
        normalized.action_taken,
        normalized.public_reply_status,
        normalized.dm_status,
        normalized.like_status,
        normalized.inbox_conversation_id,
        normalized.error_code,
        JSON.stringify(normalized.automation_state || {}),
        JSON.stringify(normalized.raw_payload || {}),
        normalized.processed_at,
      ]
    );
    let storedRow = insertResult.rows[0] || null;
    if (!storedRow) {
      const existingRowResult = await db.query(
        `
        SELECT *
        FROM social_comment_automation_runs
        WHERE tenant_id = $1::bigint
          AND platform = $2::text
          AND comment_id = $3::text
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
        `,
        [normalized.tenant_id, normalized.platform, normalized.comment_id]
      ).catch(() => ({ rows: [] }));
      storedRow = existingRowResult.rows[0] || {
        ...normalized,
        id: null,
        raw_payload: normalized.raw_payload || {},
      };
    }
    const productContext = await resolveSocialCommentPublishedProductContext({
      tenantId: storedRow.tenant_id,
      row: storedRow,
    }).catch(() => null);
    if (productContext?.found) {
      storedRow.product_context = productContext;
      storedRow.raw_payload = {
        ...(storedRow.raw_payload || {}),
        product_context: productContext,
      };
      console.log("SOCIAL_COMMENT_AUTOMATION_PRODUCT_RESOLVED", {
        tenant_id: storedRow.tenant_id,
        platform: storedRow.platform,
        post_id: text(storedRow.post_id || ""),
        comment_id: text(storedRow.comment_id || ""),
        product_id: text(productContext.product_id || ""),
        product_name: text(productContext.product_name || ""),
        product_url: text(productContext.product_url || ""),
        sizes: asArray(productContext.sizes || []),
        source: text(productContext.source || ""),
      });
    } else {
      console.log("SOCIAL_COMMENT_AUTOMATION_PRODUCT_NOT_FOUND", {
        tenant_id: storedRow.tenant_id,
        platform: storedRow.platform,
        post_id: text(storedRow.post_id || ""),
        comment_id: text(storedRow.comment_id || ""),
        reason: text(productContext?.reason || "product_not_found"),
      });
    }
    const privateReplyTrigger = isSupportedWebhookCommentTrigger(storedRow);
    debugSocialCommentsLog("[social-comments][private-reply] received", {
      tenant_id: storedRow.tenant_id,
      platform: storedRow.platform,
      post_id: text(storedRow.post_id || ""),
      comment_id: text(storedRow.comment_id || ""),
      field: text(storedRow.raw_payload?.field || ""),
      item: text(storedRow.raw_payload?.value?.item || ""),
      verb: text(storedRow.raw_payload?.value?.verb || ""),
      source: text(storedRow.raw_payload?.source || ""),
      trigger: privateReplyTrigger,
    });
    const privateReplyStatus = text(storedRow.dm_status || storedRow.automation_state?.private_reply?.status || "").toLowerCase();
    const privateReplySource = text(storedRow.raw_payload?.source || "").toLowerCase();
    const isFacebookComment = text(storedRow.platform || "").toLowerCase() === "facebook";
    const privateReplyEligible = isFacebookComment && Boolean(text(storedRow.comment_id || ""));
    const shouldQueuePrivateReply = privateReplyEligible && !["queued", "sending", "sent"].includes(privateReplyStatus);
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_REACHED", {
      storedRow_id: storedRow.id || null,
      comment_id: text(storedRow.comment_id || ""),
      conversation_id: text(storedRow.inbox_conversation_id || ""),
      platform: text(storedRow.platform || ""),
      source: privateReplySource,
      private_reply_status: privateReplyStatus || "empty",
      eligible: privateReplyEligible,
    });
    if (shouldQueuePrivateReply) {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_CALLING", {
        storedRow_id: storedRow.id || null,
        comment_id: text(storedRow.comment_id || ""),
        conversation_id: text(storedRow.inbox_conversation_id || ""),
        platform: text(storedRow.platform || ""),
        source: privateReplySource,
        private_reply_status: privateReplyStatus || "empty",
      });
      storedRow.dm_status = storedRow.dm_status || "queued";
      storedRow.automation_state = {
        ...(storedRow.automation_state || {}),
        private_reply: {
          requested: true,
          status: "queued",
          queued_at: new Date().toISOString(),
        },
      };
      await persistSocialCommentAutomationState({
        tenantId: storedRow.tenant_id,
        platform: storedRow.platform,
        commentId: storedRow.comment_id,
        sessionId: storedRow.inbox_conversation_id || "",
        channel: storedRow.channel || "",
          dmStatus: "queued",
          automationState: storedRow.automation_state,
        }).catch(() => {});
      console.log("SOCIAL_COMMENT_SAVED_FOR_PRIVATE_REPLY", {
        storedRow_id: storedRow.id || null,
        comment_id: text(storedRow.comment_id || ""),
        conversation_id: text(storedRow.inbox_conversation_id || ""),
        source: privateReplySource,
        private_reply_status: privateReplyStatus || "empty",
      });
      await enqueueSocialCommentPrivateReplyJob({
        tenantId: storedRow.tenant_id,
        platform: storedRow.platform,
        commentId: storedRow.comment_id,
          postId: storedRow.post_id,
          row: storedRow,
        }).catch(() => {});
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_CALLED", {
        storedRow_id: storedRow.id || null,
        comment_id: text(storedRow.comment_id || ""),
        conversation_id: text(storedRow.inbox_conversation_id || ""),
        platform: text(storedRow.platform || ""),
        source: privateReplySource,
        private_reply_status: text(storedRow.dm_status || storedRow.automation_state?.private_reply?.status || "").toLowerCase() || "empty",
      });
    } else {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_SKIPPED", {
        storedRow_id: storedRow.id || null,
        comment_id: text(storedRow.comment_id || ""),
        conversation_id: text(storedRow.inbox_conversation_id || ""),
        source: privateReplySource,
        private_reply_status: privateReplyStatus || "empty",
        reason: !privateReplyEligible
          ? "not_facebook_comment_or_missing_comment_id"
          : `private_reply_status_${privateReplyStatus || "empty"}`,
      });
    }
    console.log("[COMMENT_EVENT_SAVED]", {
      platform: storedRow.platform,
      page_id: text(storedRow.raw_payload?.entry?.id || storedRow.raw_payload?.value?.page_id || ""),
      post_id: storedRow.post_id || "",
      comment_id: storedRow.comment_id || "",
      from_id: storedRow.commenter_id || "",
      text_length: String(storedRow.original_comment_text || "").length,
    });
    const webhookMedia = await fetchSocialCommentWebhookPostMedia({
      tenantId: storedRow.tenant_id,
      event: storedRow,
    }).catch(() => null);
    storedRow = applyWebhookPostMediaToEvent(storedRow, webhookMedia);
    if (!privateReplyTrigger) {
      try {
        const materialized = await upsertSocialCommentLeadConversation({
          tenantId: storedRow.tenant_id,
          event: storedRow,
          suggestedReply: "",
        });
        if (materialized?.session_id) {
          storedRow.inbox_conversation_id = materialized.session_id;
          await db.query(
            `
            UPDATE social_comment_automation_runs
            SET inbox_conversation_id = $3::text,
                updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $1::bigint AND platform = $2::text AND comment_id = $4::text
            `,
            [storedRow.tenant_id, storedRow.platform, materialized.session_id, storedRow.comment_id]
          );
        }
      } catch (error) {
        socialCommentsError("[social-comments] inbox conversation materialize failed", {
          tenant_id: storedRow.tenant_id,
          platform: storedRow.platform,
          comment_id: storedRow.comment_id,
          message: error?.message || "",
        });
        storedRow.error_code = storedRow.error_code || "comment_inbox_materialization_failed";
      }
      if (!automationRuntimeApplied && COMMENT_THREAD_LABELS.has(storedRow.classification_label)) {
        try {
          const materialized = await upsertSocialCommentLeadConversation({
            tenantId: storedRow.tenant_id,
            event: storedRow,
            suggestedReply: buildSocialCommentSuggestedReply({
              classificationLabel: storedRow.classification_label,
              commenterName: storedRow.commenter_name,
              originalCommentText: storedRow.original_comment_text,
              postPermalink: storedRow.post_permalink,
            }),
          });
          if (materialized?.session_id) {
            storedRow.inbox_conversation_id = materialized.session_id;
            storedRow.action_taken = storedRow.action_taken || "classified_only";
            await db.query(
              `
              UPDATE social_comment_automation_runs
              SET inbox_conversation_id = $3::text,
                  updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = $1::bigint AND platform = $2::text AND comment_id = $4::text
              `,
              [storedRow.tenant_id, storedRow.platform, materialized.session_id, storedRow.comment_id]
            );
          }
          const automationResult = await executeSocialCommentAutomation({
            tenantId: storedRow.tenant_id,
            row: {
              ...storedRow,
              inbox_conversation_id: materialized?.session_id || storedRow.inbox_conversation_id || "",
            },
            conversation: materialized,
          });
          if (automationResult?.row) {
            storedRow.action_taken = automationResult.row.action_taken || storedRow.action_taken;
            storedRow.public_reply_status = automationResult.row.public_reply_status || storedRow.public_reply_status;
            storedRow.dm_status = automationResult.row.dm_status || storedRow.dm_status;
            storedRow.like_status = automationResult.row.like_status || storedRow.like_status;
            storedRow.error_code = automationResult.row.error_code || storedRow.error_code;
            storedRow.automation_state = automationResult.row.automation_state || storedRow.automation_state;
            storedRow.inbox_conversation_id = automationResult.row.inbox_conversation_id || storedRow.inbox_conversation_id;
          }
        } catch (error) {
          socialCommentsError("[social-comments] lead conversation materialize failed", {
            tenant_id: storedRow.tenant_id,
            platform: storedRow.platform,
            comment_id: storedRow.comment_id,
            classification_label: storedRow.classification_label,
            message: error?.message || "",
          });
          storedRow.error_code = storedRow.error_code || "comment_lead_materialization_failed";
          await db.query(
            `
            UPDATE social_comment_automation_runs
            SET error_code = COALESCE(NULLIF($3::text, ''), error_code),
                updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $1::bigint AND platform = $2::text AND comment_id = $4::text
            `,
            [storedRow.tenant_id, storedRow.platform, storedRow.error_code, storedRow.comment_id]
          ).catch(() => {});
        }
      }
      if (!automationRuntimeApplied) {
        try {
          await processSocialCommentAutoReply({
            tenantId: storedRow.tenant_id,
            platform: storedRow.platform,
            postId: storedRow.post_id,
            commentId: storedRow.comment_id,
            comment: storedRow,
            post: storedRow,
            force: false,
          });
        } catch (error) {
          socialCommentsError("[social-comments] auto reply processing failed", {
            tenant_id: storedRow.tenant_id,
            platform: storedRow.platform,
            comment_id: storedRow.comment_id,
            message: error?.message || "",
          });
        }
      }
    }
    console.log("[META_WEBHOOK_COMMENT_STORED]", {
      tenant_id: storedRow.tenant_id,
      source: "webhook",
      post_id: text(storedRow.post_id || ""),
      comment_id: text(storedRow.comment_id || ""),
      from_id: text(storedRow.commenter_id || ""),
      from_name: text(storedRow.commenter_name || ""),
      inserted_run: storedRow.id || null,
      inserted_message: text(storedRow.original_comment_text || ""),
      conversation_id: text(storedRow.inbox_conversation_id || ""),
    });
    stored.push(storedRow);
  }
  return stored;
};

const mapMarketingStatusToClassificationLabel = (row = {}) => {
  const status = text(row.status || "").toLowerCase();
  if (status === "ignored") return "ignore";
  if (status === "failed" || status === "manual_follow_up") return "human_review";
  if (status === "simulated") return "lead_inbox";
  if (status === "processed") return "lead_inbox";
  return "human_review";
};

const mapMarketingLeadScoreToClassificationScore = (row = {}) => {
  const score = text(row.lead_score || "").toLowerCase();
  if (score === "high") return 0.95;
  if (score === "medium") return 0.8;
  if (score === "low") return 0.65;
  return 0.7;
};

const mapMarketingCommentEventToRecentRow = (row = {}) => ({
  id: `marketing:${row.id ?? row.comment_id ?? crypto.randomUUID()}`,
  tenant_id: row.business_id ?? row.tenant_id ?? null,
  platform: text(row.platform || "facebook") || "facebook",
  channel: text(row.platform || "").toLowerCase() === "instagram" ? "instagram_comment" : "facebook_comment",
  post_id: text(row.post_id || ""),
  post_permalink: text(row.raw_payload?.post_permalink || row.raw_payload?.post_url || row.raw_payload?.permalink || ""),
  comment_id: text(row.comment_id || ""),
  commenter_name: text(row.username || row.commenter_name || ""),
  commenter_profile_picture_url: text(row.raw_payload?.profile_picture_url || row.raw_payload?.commenter_profile_picture_url || ""),
  original_comment_text: text(row.message || row.original_comment_text || ""),
  classification_label: mapMarketingStatusToClassificationLabel(row),
  classification_score: mapMarketingLeadScoreToClassificationScore(row),
  action_taken: text(row.status || "ingested"),
  public_reply_status: row.automation_actions?.public_reply?.status || null,
  dm_status: row.automation_actions?.private_reply?.status || null,
  like_status: row.automation_actions?.liked?.status || null,
  inbox_conversation_id: text(row.inbox_conversation_id || row.raw_payload?.inbox_conversation_id || ""),
  error_code: text(row.error_message || row.error_code || ""),
  automation_state: row.automation_actions && typeof row.automation_actions === "object" ? row.automation_actions : {},
  raw_payload: row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : { raw_payload: row.raw_payload ?? null },
  processed_at: row.processed_at || row.updated_at || row.created_at || new Date().toISOString(),
  created_at: row.created_at || row.processed_at || row.updated_at || new Date().toISOString(),
  updated_at: row.updated_at || row.processed_at || row.created_at || new Date().toISOString(),
});

const mapSocialCommentAutomationAuditRowToRecentRow = (row = {}) => {
  const stepResults = Array.isArray(row.step_results) ? row.step_results : [];
  const productLink = text(row.product_link || row.metadata?.product_link || "");
  const checkoutLink = text(row.checkout_link || row.metadata?.checkout_link || "");
  const skippedReason = text(row.skipped_reason || row.error_message || "duplicate_comment_automation");
  const matchedConfigKey = text(row.matched_config_key || row.metadata?.matched_config_key || "");
  const resolvedPostId = text(row.resolved_post_id || row.metadata?.resolved_post_id || row.post_id || "");
  const resolvedPlatformPostId = text(row.resolved_platform_post_id || row.metadata?.resolved_platform_post_id || row.post_id || "");
  const resolvedProductId = row.resolved_product_id ?? row.metadata?.resolved_product_id ?? null;
  const duplicateReason = text(row.duplicate_reason || row.metadata?.duplicate_reason || skippedReason || "");
  return {
    id: `audit:${row.id ?? row.comment_id ?? crypto.randomUUID()}`,
    tenant_id: row.tenant_id ?? null,
    platform: text(row.platform || "facebook") || "facebook",
    channel: text(row.platform || "facebook") === "instagram" ? "instagram_comment" : "facebook_comment",
    post_id: text(row.post_id || ""),
    comment_id: text(row.comment_id || ""),
    config_id: row.config_id ?? null,
    customer_name: text(row.customer_name || row.commenter_name || ""),
    status: text(row.status || "duplicate_skipped") || "duplicate_skipped",
    step_results: stepResults.length ? stepResults : [{
      step: "automation",
      status: "skipped",
      reason: skippedReason,
    }],
    error_message: skippedReason,
    skipped_reason: skippedReason,
    matched_config_key: matchedConfigKey,
    resolved_post_id: resolvedPostId,
    resolved_platform_post_id: resolvedPlatformPostId,
    resolved_product_id: resolvedProductId,
    duplicate_reason: duplicateReason,
    config_found: Boolean(row.config_found),
    config_enabled: Boolean(row.config_enabled),
    product_link: productLink,
    checkout_link: checkoutLink,
    guidance_mode: text(row.guidance_mode || "website_checkout") || "website_checkout",
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || row.created_at || new Date().toISOString(),
    automation_state: {
      runtime_monitor: {
        status: text(row.status || "duplicate_skipped") || "duplicate_skipped",
        skipped_reason: skippedReason,
        matched_config_key: matchedConfigKey,
        resolved_post_id: resolvedPostId,
        resolved_platform_post_id: resolvedPlatformPostId,
        resolved_product_id: resolvedProductId,
        duplicate_reason: duplicateReason,
        config_found: Boolean(row.config_found),
        config_enabled: Boolean(row.config_enabled),
        step_results: stepResults,
        product_link: productLink,
        checkout_link: checkoutLink,
        guidance_mode: text(row.guidance_mode || "website_checkout") || "website_checkout",
        raw_runtime_context: {
          step_results: stepResults,
          post_id: resolvedPostId,
          platform_post_id: resolvedPlatformPostId,
          matched_config_key: matchedConfigKey,
          resolved_product_id: resolvedProductId,
          config_found: Boolean(row.config_found),
          config_enabled: Boolean(row.config_enabled),
          duplicate_reason: duplicateReason,
        },
      },
    },
  };
};

export const listRecentSocialCommentAutomationRuns = async ({ tenantId = null, limit = 50 } = {}) => {
  await ensureSocialCommentAutomationSchema();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const [automationRunsResult, marketingEventsResult] = await Promise.all([
    db.query(
      `
      SELECT *
      FROM social_comment_automation_runs
      WHERE tenant_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [tenantId, safeLimit]
    ),
    db.query(
      `
      SELECT *
      FROM marketing_comment_events
      WHERE business_id = $1::bigint
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [tenantId, safeLimit]
    ).catch((error) => {
      socialCommentsError("[social-comments] marketing events query failed", {
        tenant_id: tenantId,
        message: error?.message || "",
      });
      return { rows: [] };
    }),
  ]);

  const automationRows = automationRunsResult.rows || [];
  const auditRowsResult = await db.query(
    `
    SELECT *
    FROM social_comment_automation_run_audits
    WHERE tenant_id = $1::bigint
    ORDER BY created_at DESC, id DESC
    LIMIT $2
    `,
    [tenantId, safeLimit]
  ).catch(() => ({ rows: [] }));
  const auditRows = (auditRowsResult.rows || []).map(mapSocialCommentAutomationAuditRowToRecentRow);
  const marketingRows = (marketingEventsResult.rows || []).map(mapMarketingCommentEventToRecentRow);
  const combinedRows = [...automationRows, ...auditRows, ...marketingRows];
  socialCommentsLog("[social-comments] recent pipeline counts", {
    tenant_id: tenantId,
    total_rows_before_filters: automationRows.length + auditRows.length + marketingRows.length,
    rows_after_tenant_filter: automationRows.length + auditRows.length + marketingRows.length,
    rows_after_status_channel_filters: combinedRows.length,
    social_runs_rows: automationRows.length,
    audit_rows: auditRows.length,
    marketing_rows: marketingRows.length,
  });

  const deduped = [];
  const seen = new Set();
  for (const row of combinedRows) {
    const dedupeKey = `${text(row.platform || "")}:${text(row.comment_id || "")}`;
    if (!row.comment_id || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(row);
  }

  deduped.sort((a, b) => {
    const timeDelta = new Date(b.created_at || b.processed_at || 0).getTime() - new Date(a.created_at || a.processed_at || 0).getTime();
    if (timeDelta !== 0) return timeDelta;
    return text(String(b.id || "")).localeCompare(text(String(a.id || "")));
  });

  return deduped.slice(0, safeLimit);
};

export const listSocialCommentAutomationRuns = async ({ tenantId = null, platform = "", postId = "", limit = 20 } = {}) => {
  const safeTenantId = Number(tenantId || 0);
  const safePostId = text(postId || "");
  const normalizedPlatform = text(platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safePostId) return [];
  await ensureSocialCommentAutomationSchema();
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const candidatePostIds = Array.from(
    new Set(
      [
        safePostId,
        safePostId.replace(/^facebook_post:/i, ""),
        safePostId.replace(/^instagram_post:/i, ""),
        safePostId.replace(/^social_comment:[^:]+:/i, ""),
      ]
        .map((value) => text(value))
        .filter(Boolean)
    )
  );
  const params = [safeTenantId, normalizedPlatform, ...candidatePostIds];
  const wherePostClause = candidatePostIds
    .map((_, index) => `post_id = $${index + 3}::text`)
    .join(" OR ");
  const [result, auditResult] = await Promise.all([
    db.query(
    `
    SELECT *
    FROM social_comment_automation_runs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND (${wherePostClause})
    ORDER BY created_at DESC, id DESC
    LIMIT $4
    `,
      [...params, safeLimit]
    ),
    db.query(
      `
      SELECT *
      FROM social_comment_automation_run_audits
      WHERE tenant_id = $1::bigint
        AND platform = $2::text
        AND (${wherePostClause})
      ORDER BY created_at DESC, id DESC
      LIMIT $4
      `,
      [...params, safeLimit]
    ).catch(() => ({ rows: [] })),
  ]);
  const automationRows = result.rows || [];
  const auditRows = (auditResult.rows || []).map(mapSocialCommentAutomationAuditRowToRecentRow);
  return [...automationRows, ...auditRows]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, safeLimit);
};

export const testSocialCommentAutomationRuntime = async ({ tenantId = null, platform = "", postId = "" } = {}) => {
  const safeTenantId = Number(tenantId || 0);
  const safePostId = text(postId || "");
  const normalizedPlatform = text(platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safePostId) {
    throw Object.assign(new Error("tenant_id, platform and postId are required"), { status: 400 });
  }
  const config = await getSocialCommentAutomationConfig({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId });
  const post = config?.post || await loadSocialCommentPost({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId });
  const product = metadataObject(config?.product || post?.product || {});
  const websiteLinks = await resolveAutomationWebsiteLinks({
    tenantId: safeTenantId,
    row: post || {},
    productContext: product || {},
  }).catch(() => ({
    product_link: buildAutomationPublicUrl("/shop/products"),
    product_url: buildAutomationPublicUrl("/shop/products"),
    checkout_link: buildAutomationPublicUrl("/shop/checkout"),
    checkout_url: buildAutomationPublicUrl("/shop/checkout"),
    available_sizes: asArray(post?.productSizes || product?.sizes || product?.available_sizes || [])
      .map(text)
      .filter(Boolean),
    stock_status: text(product?.stock_status || post?.stock_status || ""),
  }));
  const templateContext = {
    customerName: "عميل تجريبي",
    customer_name: "عميل تجريبي",
    commenterName: "عميل تجريبي",
    commenter_name: "عميل تجريبي",
    productName: text(product.name || post?.productName || post?.caption || "Linked product"),
    product_name: text(product.name || post?.productName || post?.caption || "Linked product"),
    price: text(product.sale_price || product.price || post?.productSalePrice || post?.productPrice || "0"),
    size: text((post?.productSizes || "").split(",").map((value) => text(value)).filter(Boolean)[0] || "غير محدد"),
    color: text(post?.productColors || product.color || ""),
    productUrl: text(product.storefront_url || product.product_url || post?.productLink || ""),
    product_url: text(product.storefront_url || product.product_url || post?.productLink || ""),
    product_link: text(websiteLinks?.product_link || product.storefront_url || product.product_url || post?.productLink || ""),
    checkout_link: text(websiteLinks?.checkout_link || buildAutomationPublicUrl("/shop/checkout")),
    postPermalink: text(post?.permalinkUrl || post?.post_permalink_url || ""),
    post_permalink: text(post?.permalinkUrl || post?.post_permalink_url || ""),
    originalCommentText: "هذا تعليق تجريبي",
    original_comment_text: "هذا تعليق تجريبي",
    sizes: text(post?.productSizes || ""),
    available_sizes: text(post?.productSizes || product?.available_sizes || product?.sizes || ""),
    availableSizes: text(post?.productSizes || product?.available_sizes || product?.sizes || ""),
    variants: text(post?.productSizes || ""),
    stock_status: text(websiteLinks?.stock_status || product?.stock_status || post?.stock_status || "unknown"),
  };
  const duplicatePostIds = Array.from(new Set([
    safePostId,
    safePostId.replace(/^facebook_post:/i, ""),
    safePostId.replace(/^instagram_post:/i, ""),
    safePostId.replace(/^social_comment:[^:]+:/i, ""),
  ].map((value) => text(value)).filter(Boolean)));
  const duplicateRun = await db.query(
    `
    SELECT id
    FROM social_comment_automation_runs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND post_id = ANY($3::text[])
    LIMIT 1
    `,
    [safeTenantId, normalizedPlatform, duplicatePostIds]
  ).catch(() => ({ rows: [] }));
  const duplicateAuditRun = await db.query(
    `
    SELECT id
    FROM social_comment_automation_run_audits
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND post_id = ANY($3::text[])
    LIMIT 1
    `,
    [safeTenantId, normalizedPlatform, duplicatePostIds]
  ).catch(() => ({ rows: [] }));
  const duplicateExists = Boolean(duplicateRun.rows?.[0] || duplicateAuditRun.rows?.[0]);
  const publicTemplate = text(config?.message_templates?.publicReplyTemplate || "تم الرد على حضرتك في الخاص ✅");
  const privateTemplate = text(config?.message_templates?.privateReplyTemplate || "");
  const warnings = {
    publicReplyTemplate: detectMissingTemplatePlaceholders(publicTemplate, templateContext),
    privateReplyTemplate: detectMissingTemplatePlaceholders(privateTemplate, templateContext),
    aiOpeningPrompt: detectMissingTemplatePlaceholders(text(config?.message_templates?.aiOpeningPrompt || ""), templateContext),
  };
  return {
    success: true,
    dry_run: true,
    config: config || resolveSocialCommentAutomationDefaultConfig({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId }),
    post: post || null,
    product: product || null,
    product_link: text(websiteLinks?.product_link || templateContext.product_link || ""),
    checkout_link: text(websiteLinks?.checkout_link || templateContext.checkout_link || ""),
    would_run: !duplicateExists,
    duplicate_reason: duplicateExists ? "duplicate_comment_automation" : "",
    enabled_steps: {
      likeComment: Boolean(config?.settings?.likeComment),
      publicReply: Boolean(config?.settings?.publicReply),
      privateReply: Boolean(config?.settings?.privateReply),
      aiFollowUp: Boolean(config?.settings?.aiFollowUp),
      createLead: Boolean(config?.settings?.createLead),
    },
    rendered_public_reply: renderAutomationTemplate(publicTemplate, templateContext).trim(),
    rendered_private_reply: renderAutomationTemplate(privateTemplate || "", templateContext).trim(),
    rendered_ai_opening_prompt: renderAutomationTemplate(text(config?.message_templates?.aiOpeningPrompt || ""), templateContext).trim(),
    guidance_mode: "website_checkout",
    placeholder_warnings: warnings,
    mock_context: templateContext,
  };
};
