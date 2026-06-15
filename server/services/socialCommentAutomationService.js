import crypto from "node:crypto";

import db from "../database/db.js";
import { emitToRooms } from "../utils/socket.js";
import { ensureAiSupportLogSchema } from "./aiSupportLogService.js";
import { ensureAiChannelAdapterSchema } from "./aiChannelAdapterService.js";
import { appendAutomationSupportTranscript } from "./aiSupportLogService.js";
import { likeComment, replyToComment, sendPrivateReply } from "./marketingCommentAutomationService.js";
import {
  DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
  getSocialAutomationSettings,
} from "./socialAutomationSettingsService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
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

const buildSocialCommentSuggestedReply = ({ classificationLabel = "", commenterName = "", originalCommentText = "", postPermalink = "" } = {}) => {
  const name = text(commenterName) || "العميل";
  const linkHint = postPermalink ? ` لو تحب تراجع المنشور: ${postPermalink}` : "";
  if (classificationLabel === "lead_price") return `تم تجهيز السعر والتفاصيل يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_size") return `تم تجهيز المقاسات المتاحة يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_shipping") return `تم تجهيز تفاصيل الشحن والتوصيل يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_details") return `تم تجهيز التفاصيل الكاملة يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_inbox") return `تم تجهيز رسالة خاصة تحتوي على التفاصيل المطلوبة يا ${name}.${linkHint}`;
  return `رد مقترح: ${text(originalCommentText) || "تم استلام تعليقك."}${linkHint}`;
};

const socialCommentConversationId = ({ platform = "", rootCommentId = "", commentId = "" } = {}) => {
  const root = text(rootCommentId || commentId);
  const normalizedPlatform = text(platform) === "instagram" ? "instagram" : "facebook";
  return `social_comment:${normalizedPlatform}:${root}`;
};

const socialCommentLeadTemperature = (classificationLabel = "") => COMMENT_LEAD_TEMPERATURE[classificationLabel] || "cold";

const upsertSocialCommentLeadConversation = async ({ tenantId = null, event = {}, suggestedReply = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;
  await ensureAiSupportLogSchema();
  await ensureAiChannelAdapterSchema();

  const platform = text(event.platform || "facebook") === "instagram" ? "instagram" : "facebook";
  const channel = platform === "instagram" ? "instagram_comment" : "facebook_comment";
  const sessionId = socialCommentConversationId({ platform, rootCommentId: event.root_comment_id, commentId: event.comment_id });
  const threadKind = "comment";
  const commentText = text(event.original_comment_text);
  const commenterName = text(event.commenter_name) || "Customer";
  const commenterId = text(event.commenter_id || "");
  const postPermalink = text(event.post_permalink || "");
  const postId = text(event.post_id || "");
  const metadata = {
    thread_kind: threadKind,
    platform,
    post_id: postId,
    post_permalink: postPermalink,
    comment_id: text(event.comment_id || ""),
    root_comment_id: text(event.root_comment_id || event.comment_id || ""),
    parent_comment_id: text(event.parent_comment_id || ""),
    commenter_id: commenterId,
    commenter_name: commenterName,
    commenter_profile_picture_url: text(event.commenter_profile_picture_url || ""),
    original_comment_text: commentText,
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

  const sessionResult = await db.query(
    `
    INSERT INTO ai_support_sessions (
      tenant_id,
      session_id,
      source,
      channel,
      thread_kind,
      customer_name,
      last_message,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      source = EXCLUDED.source,
      channel = EXCLUDED.channel,
      thread_kind = COALESCE(NULLIF(EXCLUDED.thread_kind, ''), ai_support_sessions.thread_kind),
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_sessions.customer_name),
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_sessions.last_message),
      updated_at = NOW()
    RETURNING id
    `,
    [safeTenantId, sessionId, channel, channel, threadKind, commenterName, commentText]
  );

  await db.query(
    `
    INSERT INTO ai_channel_conversations (
      tenant_id,
      channel,
      external_conversation_id,
      external_customer_id,
      thread_kind,
      customer_name,
      last_message,
      metadata,
      last_message_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW())
    ON CONFLICT (tenant_id, channel, external_conversation_id) DO UPDATE SET
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_channel_conversations.external_customer_id),
      thread_kind = COALESCE(NULLIF(EXCLUDED.thread_kind, ''), ai_channel_conversations.thread_kind),
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_channel_conversations.customer_name),
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_channel_conversations.last_message),
      metadata = ai_channel_conversations.metadata || EXCLUDED.metadata,
      last_message_at = NOW(),
      updated_at = NOW()
    `,
    [safeTenantId, channel, sessionId, commenterId, threadKind, commenterName, commentText, JSON.stringify(metadata)]
  );

  const inboundMessage = await db.query(
    `
    INSERT INTO ai_support_messages (
      session_ref_id,
      tenant_id,
      session_id,
      channel,
      customer_name,
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
      insert_source
    )
    VALUES ($1, $2, $3, $4, $5, $6, $6, $6, '', 0.98, TRUE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $7, '', 'comment_inbound', '', 'customer', FALSE, $8, $9, $10, $11)
    ON CONFLICT (tenant_id, session_id, dedupe_key) WHERE dedupe_key <> '' DO UPDATE SET
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_messages.customer_name),
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_messages.last_message),
      message_text = COALESCE(NULLIF(EXCLUDED.message_text, ''), ai_support_messages.message_text),
      customer_message = COALESCE(NULLIF(EXCLUDED.customer_message, ''), ai_support_messages.customer_message)
    RETURNING *
    `,
    [
      sessionResult.rows[0]?.id || null,
      safeTenantId,
      sessionId,
      channel,
      commenterName,
      commentText,
      text(event.classification_label || ""),
      text(event.comment_id || ""),
      text(event.comment_id || ""),
      "social_comment_automation",
      "social_comment_lead",
    ]
  );

  const suggestedMessage = text(suggestedReply || buildSocialCommentSuggestedReply({
    classificationLabel: event.classification_label,
    commenterName,
    originalCommentText: commentText,
    postPermalink,
  }));

  const suggestionResult = await db.query(
    `
    INSERT INTO ai_support_messages (
      session_ref_id,
      tenant_id,
      session_id,
      channel,
      customer_name,
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
    VALUES ($1, $2, $3, $4, $5, $6, $6, '', $7, 0.88, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'comment_suggestion', '', 'comment_suggestion', '', 'ai', FALSE, $8, $9, $10, $11, 'draft')
    ON CONFLICT (tenant_id, session_id, dedupe_key) WHERE dedupe_key <> '' DO UPDATE SET
      ai_answer = COALESCE(NULLIF(EXCLUDED.ai_answer, ''), ai_support_messages.ai_answer),
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_messages.last_message),
      message_text = COALESCE(NULLIF(EXCLUDED.message_text, ''), ai_support_messages.message_text)
    RETURNING *
    `,
    [
      sessionResult.rows[0]?.id || null,
      safeTenantId,
      sessionId,
      channel,
      commenterName,
      commentText,
      suggestedMessage,
      `${text(event.comment_id || "")}:suggested`,
      `${text(event.comment_id || "")}:suggested`,
      "social_comment_automation",
      "social_comment_suggestion",
    ]
  );

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
    metadata,
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

const persistSocialCommentAutomationState = async ({
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
          processed_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, platform, comment_id)
        )
      `);

      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_created ON social_comment_automation_runs (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_platform ON social_comment_automation_runs (tenant_id, platform, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_comment ON social_comment_automation_runs (tenant_id, comment_id)`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS automation_state JSONB NOT NULL DEFAULT '{}'::jsonb`);
    })();
  }

  return socialCommentSchemaReadyPromise;
};

const normalizedPlatform = (body = {}) => lower(body.object) === "instagram" ? "instagram" : "facebook";
const normalizedChannel = (platform = "") => platform === "instagram" ? "instagram_comment" : "facebook_comment";

const isCommentChange = (body = {}, change = {}) => {
  const field = lower(change.field);
  const value = change.value || {};
  if (field === "feed" || field.includes("comment")) return true;
  if (body.object === "instagram" && (field === "comments" || field === "mentions")) return true;
  return Boolean(
    value.comment_id ||
    value.parent_id ||
    value.post_id ||
    value.media_id ||
    value.item === "comment"
  );
};

const firstText = (...values) => values.map((value) => text(value)).find(Boolean) || "";

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
  const commenterId = firstText(value.from?.id, value.from?.username, value.sender_id, value.user_id, value.commenter_id, value.author_id);
  const commenterName = firstText(value.from?.name, value.from?.username, value.username, value.commenter_name, value.author_name, value.from?.full_name);
  const commenterProfilePictureUrl = firstText(
    value.from?.profile_pic,
    value.from?.profile_picture_url,
    value.profile_picture_url,
    value.profile_pic_url,
    value.user_profile_picture,
    value.from?.picture
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
  const classification = classifySocialCommentIntent(originalCommentText);

  return {
    tenant_id: tenantId,
    platform,
    channel,
    post_id: postId,
    post_permalink: postPermalink,
    comment_id: commentId,
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
      value,
      entry,
      body,
      platform,
      channel,
      comment_id: commentId,
    },
    processed_at: new Date().toISOString(),
  };
};

export const extractSocialCommentWebhookEvents = ({ body = {}, tenantId = null } = {}) => {
  const events = [];
  asArray(body.entry).forEach((entry) => {
    asArray(entry.changes).forEach((change) => {
      if (!isCommentChange(body, change)) return;
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
    const normalized = {
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
      classification_label: event.classification_label ?? null,
      classification_score: event.classification_score ?? null,
      action_taken: event.action_taken ?? "ingested",
      public_reply_status: event.public_reply_status ?? null,
      dm_status: event.dm_status ?? null,
      like_status: event.like_status ?? null,
      inbox_conversation_id: event.inbox_conversation_id ?? null,
      error_code: event.error_code ?? null,
      automation_state: event.automation_state && typeof event.automation_state === "object" ? event.automation_state : {},
      raw_payload: event.raw_payload && typeof event.raw_payload === "object" ? event.raw_payload : { raw_payload: event.raw_payload ?? null },
      processed_at: event.processed_at ? new Date(event.processed_at).toISOString() : new Date().toISOString(),
    };

    const result = await db.query(
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
    const storedRow = result.rows[0] || normalized;
    if (COMMENT_THREAD_LABELS.has(storedRow.classification_label)) {
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
        console.error("[social-comments] lead conversation materialize failed", {
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
    stored.push(storedRow);
  }
  return stored;
};

export const listRecentSocialCommentAutomationRuns = async ({ tenantId = null, limit = 50 } = {}) => {
  await ensureSocialCommentAutomationSchema();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const result = await db.query(
    `
    SELECT *
    FROM social_comment_automation_runs
    WHERE tenant_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT $2
    `,
    [tenantId, safeLimit]
  );
  return result.rows;
};
