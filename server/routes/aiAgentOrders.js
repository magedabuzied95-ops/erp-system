import express from "express";
import db from "../database/db.js";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { emitToRooms } from "../utils/socket.js";
import { debugMessengerProfileForConversation, getAiInboxConversationDebug, sendMetaInboxOutboundMessage, syncMessengerProfileForConversation } from "../services/metaIntegrationService.js";
import { getAIEvents, pushAIEvent } from "../services/aiEventLogger.js";
import { resolveIntent } from "../services/aiIntentResolver.js";
import { buildProductContext, ensureProductLinkInReply } from "../services/aiProductContext.js";
import {
  getConversationMemory,
  clearConversationMemory,
  updateConversationMemory,
} from "../services/aiConversationMemory.js";
import { extractShoeSize } from "../services/aiMessageExtractors.js";
import { guardAIReply } from "../services/aiSafetyGuard.js";
import { detectEscalation } from "../services/aiEscalationDetector.js";
import { buildHumanizedReply } from "../services/aiHumanizedReplies.js";
import { isDuplicateMessage } from "../services/aiMessageDeduplication.js";
import { getAISettings, getAIToneInstruction, updateAISettings, wasAISettingsPersisted } from "../services/aiSettingsService.js";
import { buildSuggestedReplies } from "../services/aiSuggestedReplies.js";
import {
  getAIChannelSettings,
  updateAIChannelSettings,
} from "../services/aiChannelSettingsService.js";
import {
  getSocialAutomationSettings,
  updateSocialAutomationSettings,
} from "../services/socialAutomationSettingsService.js";
import { resolveAIStatus } from "../services/aiStatusResolver.js";
import {
  AI_AGENT_CHANNELS,
  extractMetaWebhookMessages,
  extractWhatsAppWebhookMessages,
  getAiChannelsStatus,
  getChannelSettings,
  linkChannelConversationToCustomerProfile,
  logChannelEvent,
  normalizeOutgoingChannelReply,
  resolveTenantIdForChannelAccount,
  sendMetaPageReply,
  sendWhatsAppCloudReply,
  updateChannelSettings,
  upsertChannelConversationMapping,
  verifyMetaWebhookSignature,
} from "../services/aiChannelAdapterService.js";
import {
  confirmAiOrder,
  createAiOrderDraft,
  listAiOrderDrafts,
  searchAiOrderProducts,
  updateAiOrderStatus,
} from "../services/aiAgentOrderService.js";
import { productCardReplyText } from "../services/aiProductCards.js";
import {
  buildAiSalesCloserPlan,
  buildAiSalesCloserLookupKeys,
  createAiStockReservation,
  cancelAiFollowup,
  completeAiFollowup,
  generateAiInboxReply,
  generateAiSuggestedReplies,
  listAiFollowups,
  loadAiInboxMessages,
  loadAiInboxRecommendations,
  loadAiInbox,
  loadAiSalesAnalytics,
  loadAiShadowAnalytics,
  getLastAiPipelineDebug,
  parseAiSalesCloserIntent,
  sendAiFollowupManual,
  snoozeAiFollowup,
  upsertAiCustomerProfile,
  getAiAgentSettings,
  updateAiAgentSettings,
} from "../services/aiSalesAgentService.js";
import {
  createOrUpdateLeadOpportunity,
  isAllowedLeadStatus,
  loadLeadConversationForAction,
  normalizeLeadStatus,
  resolveLeadSourceLabel,
  syncLeadAssignmentMetadata,
} from "../services/aiInboxLeadActionsService.js";
import {
  listRecentSocialCommentAutomationRuns,
} from "../services/socialCommentAutomationService.js";
import { replyToComment, sendPrivateReply } from "../services/marketingCommentAutomationService.js";
import {
  createCorrection,
  listConversationCorrections,
  normalizeCorrectionTypeValue,
  searchRelevantCorrections,
} from "../services/aiCorrectionMemoryService.js";
import {
  appendManualAiSupportReply,
  clearAiReplySuggestionDraft,
  assignAiSupportConversation,
  getAiSupportConversationState,
  markAiSupportConversationEscalated,
  markAiSupportConversationRead,
  updateAiSupportConversationAiEnabled,
  updateAiSupportConversationState,
} from "../services/aiSupportLogService.js";
import { loadAiReplyTraces } from "../services/aiReplyTraceService.js";
import { buildReplyHarness, getLastReplyHarnessDebug } from "../services/aiReplyHarnessService.js";
import { normalizeArabicForIntent, normalizeArabicIntentPayload, normalizeArabicMessage } from "../utils/arabicTextNormalizer.js";

const router = express.Router();
const ERP_PERF_DEBUG = ["1", "true", "yes", "on"].includes(String(process.env.ERP_PERF_DEBUG || "").toLowerCase());
const perfLog = (...args) => {
  if (ERP_PERF_DEBUG) console.log(...args);
};

router.use((req, res, next) => {
  if (!ERP_PERF_DEBUG) return next();
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log("[erp-perf] ai-agent", {
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      total_ms: Date.now() - startedAt,
    });
  });
  next();
});

const toTenantId = (req) => {
  if (req.user) return isSuperAdminUser(req.user) ? Number(req.query?.tenant_id || req.body?.tenant_id || req.user?.tenant_id || 1) : getTenantId(req, req.user?.tenant_id);
  const parsed = Number(req.body?.tenant_id || req.headers?.["x-tenant-id"]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

const sendError = (res, error, fallback = "AI order request failed") =>
  res.status(error?.status || 500).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "",
    routeName: error?.routeName,
    insertLabel: error?.insertLabel,
    columnsCount: error?.columnsCount,
    paramsCount: error?.paramsCount,
    sqlSnippetLabel: error?.sqlSnippetLabel,
    product: error?.product || null,
  });

const userDisplayName = (user = {}) =>
  String(user.name || user.full_name || user.username || user.email || user.role_name || user.role || "Staff").trim();

const envText = (value = "") => String(value ?? "").trim();
const requestClientRequestId = (req) =>
  envText(
    req.body?.client_request_id ||
      req.body?.clientRequestId ||
      req.headers?.["x-client-request-id"] ||
      req.headers?.["x-idempotency-key"] ||
      ""
  );
const correctionTypeOptions = new Set(["wrong_price", "wrong_stock", "wrong_policy", "bad_tone", "incomplete_answer", "other"]);
const normalizeCorrectionType = (value = "") => {
  const normalized = normalizeCorrectionTypeValue(value);
  return correctionTypeOptions.has(normalized) ? normalized : "other";
};
const normalizeAiReplyDraft = (value = {}) => {
  const draft = value && typeof value === "object" ? value : {};
  return {
    id: envText(draft.id || ""),
    status: envText(draft.status || "not_sent") || "not_sent",
    source: envText(draft.source || "ai_suggestion") || "ai_suggestion",
    message_type: envText(draft.message_type || "text") || "text",
    text: envText(draft.text || draft.answer || draft.message || ""),
    product_cards: Array.isArray(draft.product_cards) ? draft.product_cards : Array.isArray(draft.productCards) ? draft.productCards : [],
    confidence: Number(draft.confidence || 0),
    detected_intent: envText(draft.detected_intent || ""),
    customer_question: envText(draft.customer_question || ""),
    metadata: draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {},
    validation: draft.validation && typeof draft.validation === "object" ? draft.validation : (draft.metadata && typeof draft.metadata === "object" && draft.metadata.validation && typeof draft.metadata.validation === "object" ? draft.metadata.validation : null),
    confidence_engine: draft.confidence_engine && typeof draft.confidence_engine === "object" ? draft.confidence_engine : (draft.metadata && typeof draft.metadata === "object" && draft.metadata.confidence_engine && typeof draft.metadata.confidence_engine === "object" ? draft.metadata.confidence_engine : null),
    pipeline_debug: draft.pipeline_debug && typeof draft.pipeline_debug === "object" ? draft.pipeline_debug : (draft.metadata && typeof draft.metadata === "object" && draft.metadata.pipeline_debug && typeof draft.metadata.pipeline_debug === "object" ? draft.metadata.pipeline_debug : null),
    updated_at: draft.updated_at || null,
  };
};

const normalizePipelineDebugSnapshot = (value = {}) => (value && typeof value === "object" ? value : null);

const resolveDraftText = (draft = {}, conversation = {}) =>
  envText(
    draft.text ||
      draft.answer ||
      draft.message ||
      conversation?.last_ai_reply_draft?.text ||
      conversation?.last_ai_reply_draft?.answer ||
      conversation?.last_ai_reply_draft?.message ||
      conversation?.last_message ||
      ""
  );

const loadAiReplyDebugSnapshot = async ({ tenantId, conversationId, req = null, includeHarness = false } = {}) => {
  const conversation = await getAiSupportConversationState({ tenantId, sessionId: conversationId });
  if (!conversation) return null;
  const draft = normalizeAiReplyDraft(conversation.last_ai_reply_draft || {});
  let harness = getLastReplyHarnessDebug({ tenantId, conversationId }) || null;
  if (!harness && includeHarness) {
    harness = await buildReplyHarness({
      tenantId,
      conversationId,
      conversation,
      latestCustomerMessage: resolveDraftText(draft, conversation),
      sendMode: "debug",
      channel: conversation?.channel || conversation?.source || "web_chat",
      req,
    }).catch(() => null);
  }
  return { conversation, draft, harness };
};
const inferCorrectionTypeFromEditedSuggestion = (draftText = "", finalText = "") => {
  const suggestion = envText(draftText);
  const answer = envText(finalText);
  if (!suggestion || !answer || suggestion === answer) return "other";
  const normalizedSuggestion = suggestion.replace(/\s+/g, " ").trim();
  const normalizedAnswer = answer.replace(/\s+/g, " ").trim();
  if (normalizedAnswer.length < Math.max(24, Math.floor(normalizedSuggestion.length * 0.7))) {
    return "incomplete_answer";
  }
  const toneHints = /(sorry|apolog|عذر|متأسف|آسف|اسف)/i;
  if (toneHints.test(normalizedAnswer) && !toneHints.test(normalizedSuggestion)) {
    return "bad_tone";
  }
  return "other";
};
const correctionMessageLookupKey = (message = {}) =>
  envText(message.id || message.message_id || message.external_message_id || message.external_reply_id || message.dedupe_key || "");
const messageQuestionText = (messages = [], index = -1, fallback = "") => {
  if (!Array.isArray(messages) || index < 0) return envText(fallback);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = messages[cursor];
    const question = envText(candidate?.customer_message || candidate?.message_text || candidate?.last_message || "");
    if (question) return question;
  }
  return envText(fallback);
};
const normalizeInboundKeyText = (value = "") => envText(value).toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s]+/gu, "").trim();
const resolveMetaInboundDedupeContext = ({ channel = "", conversationId = "", message = {} } = {}) => {
  const inboundMetaMid = envText(message.external_message_id || message.raw?.event?.message?.mid || message.dedupe_key || "");
  if (inboundMetaMid) {
    const inboundKey = `mid:${inboundMetaMid}`;
    console.log("[meta-send] inboundKey resolved", {
      channel,
      conversation_id: conversationId,
      inbound_key: inboundKey,
      inbound_meta_mid: inboundMetaMid,
      source: "meta_mid",
    });
    return { inboundKey, inboundMetaMid };
  }
  const normalizedText = normalizeInboundKeyText(message.message_text || "").slice(0, 80);
  const timestamp = envText(message.timestamp || "");
  let inboundKey = [
    channel,
    conversationId,
    message.external_customer_id,
    normalizedText,
    timestamp,
  ].map(envText).filter(Boolean).join(":");
  if (!inboundKey) {
    inboundKey = `${channel || "meta"}:${conversationId || "unknown"}:${Date.now()}`;
    console.log("[meta-send] inboundKey missing fallback used", {
      channel,
      conversation_id: conversationId,
      inbound_key: inboundKey,
    });
  }
  console.log("[meta-send] inboundKey resolved", {
    channel,
    conversation_id: conversationId,
    inbound_key: inboundKey,
    inbound_meta_mid: "",
    source: "computed_fallback",
  });
  return { inboundKey, inboundMetaMid: "" };
};
const decodeRouteId = (value = "") => {
  const raw = envText(value);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const resolveSocialCommentReplyTarget = async ({ tenantId = null, commentId = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeCommentId = envText(commentId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId) return null;
  const result = await db.query(
    `
    SELECT *
    FROM social_comment_automation_runs
    WHERE tenant_id = $1::bigint AND comment_id = $2::text
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [Math.trunc(safeTenantId), safeCommentId]
  );
  return result.rows[0] || null;
};

const whatsappEnabled = () => String(process.env.WHATSAPP_ENABLED || "false").toLowerCase() === "true";
const channelEnvEnabled = (channel) => {
  if (channel === AI_AGENT_CHANNELS.INSTAGRAM) return String(process.env.INSTAGRAM_ENABLED || "false").toLowerCase() === "true";
  if (channel === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER) return String(process.env.FACEBOOK_MESSENGER_ENABLED || "false").toLowerCase() === "true";
  return whatsappEnabled();
};

const resolveWhatsappTenantId = async (req, metadata = {}) => {
  const explicit = Number(req.query?.tenant_id || req.body?.tenant_id || metadata?.tenant_id);
  if (Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit);
  const mapped = await resolveTenantIdForChannelAccount({
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    accountId: metadata?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  }).catch(() => null);
  if (mapped) return mapped;
  const parsed = Number(process.env.WHATSAPP_TENANT_ID || 1);
  if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  return null;
};

const resolveMetaTenantId = async (req, accountId = "") => {
  const explicit = Number(req.query?.tenant_id || req.body?.tenant_id);
  if (Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit);
  const mapped = await resolveTenantIdForChannelAccount({
    channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
    accountId: accountId || process.env.META_PAGE_ID || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "",
  }).catch(() => null);
  if (mapped) return mapped;
  const parsed = Number(process.env.META_TENANT_ID || process.env.WHATSAPP_TENANT_ID || 1);
  if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  return null;
};

const aiSupportBaseUrl = (req) =>
  envText(process.env.INTERNAL_AI_SUPPORT_URL) || (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : `${req.protocol || "http"}://${req.get("host")}`);

const routeChannelMessageThroughAi = async ({ req, tenantId, message, channel }) => {
  const globalSettings = await getAISettings();
  const channelAISettings = await getAIChannelSettings(channel, channel);
  const effectiveTone = channelAISettings.tone || globalSettings.tone || "casual";
  const originalMessage = envText(message.original_message || message.message_text || "");
  const intentPayload = normalizeArabicIntentPayload(originalMessage);
  const normalizedMessage = envText(message.normalized_message || intentPayload.normalizedText || normalizeArabicMessage(originalMessage));
  const normalizedForIntent = envText(message.normalized_for_intent || intentPayload.normalizedForIntent || normalizeArabicForIntent(originalMessage));
  console.log("[arabic-normalizer]", {
    channel,
    original: originalMessage,
    normalized: normalizedMessage,
    normalizedForIntent,
    canonicalSignals: intentPayload.canonicalSignals,
  });
  console.log("[arabic-intent-signals]", {
    channel,
    original: originalMessage,
    normalizedText: normalizedMessage,
    normalizedForIntent,
    canonicalSignals: intentPayload.canonicalSignals,
  });
  const response = await fetch(`${aiSupportBaseUrl(req).replace(/\/+$/, "")}/api/ai-support/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": String(tenantId),
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      message: originalMessage || "Customer sent an attachment",
      original_message: originalMessage || "",
      normalized_message: normalizedMessage,
      normalized_for_intent: normalizedForIntent,
      canonical_signals: intentPayload.canonicalSignals,
      intent_tokens: intentPayload.intentTokens,
      session_id: message.external_conversation_id,
      metadata: {
        session_id: message.external_conversation_id,
        customer_id: message.external_customer_id,
        customer_phone: message.external_customer_id,
        customer_name: ["facebook_messenger", "facebook", "messenger"].includes(String(channel || message.channel || "").toLowerCase())
          ? String(message.raw?.messenger_profile?.name || message.raw?.sender_name || message.raw?.profile_name || message.raw?.contact_name || "").trim()
          : message.customer_name,
        channel,
        external_conversation_id: message.external_conversation_id,
        external_customer_id: message.external_customer_id,
        ai_tone: effectiveTone,
        ai_tone_instruction: getAIToneInstruction(effectiveTone),
        attachments: message.attachments || [],
        timestamp: message.timestamp,
        original_message: originalMessage || "",
        normalized_message: normalizedMessage,
        normalized_for_intent: normalizedForIntent,
        canonical_signals: intentPayload.canonicalSignals,
        intent_tokens: intentPayload.intentTokens,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload?.message || "AI support flow failed"), { status: response.status, responseBody: payload });
  }
  return payload;
};

const shouldSendWhatsappReply = (payload = {}) =>
  payload?.auto_response_paused !== true &&
  !["human_takeover", "closed"].includes(String(payload?.conversation_status || payload?.detected_intent || "").toLowerCase());

const shouldSendChannelReply = (channel = "", payload = {}) => {
  const normalizedChannel = envText(channel).toLowerCase();
  const status = String(payload?.conversation_status || payload?.detected_intent || "").toLowerCase();
  const paused = payload?.auto_response_paused === true;
  const blockedStatus = ["human_takeover", "closed"].includes(status);

  if (normalizedChannel === AI_AGENT_CHANNELS.WHATSAPP || normalizedChannel === "whatsapp") {
    if (shouldSendWhatsappReply(payload)) return { ok: true, reason: "whatsapp_reply_allowed" };
    if (paused) return { ok: false, reason: "auto_response_paused" };
    if (blockedStatus) return { ok: false, reason: status };
    return { ok: false, reason: "whatsapp_reply_blocked" };
  }

  if (
    normalizedChannel === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER ||
    normalizedChannel === "facebook" ||
    normalizedChannel === "messenger" ||
    normalizedChannel === AI_AGENT_CHANNELS.INSTAGRAM ||
    normalizedChannel === "instagram"
  ) {
    if (paused) return { ok: false, reason: "auto_response_paused" };
    if (status === "human_takeover") return { ok: false, reason: "human_takeover" };
    if (status === "closed") return { ok: false, reason: "closed" };
    return { ok: true, reason: "channel_reply_allowed" };
  }

  if (paused) return { ok: false, reason: "auto_response_paused" };
  if (blockedStatus) return { ok: false, reason: status };
  return { ok: true, reason: "channel_reply_allowed" };
};

const escalateToHuman = async ({ tenantId, conversationId, channel, message, escalation } = {}) => {
  const conversation = await markAiSupportConversationEscalated({
    tenantId,
    sessionId: conversationId,
    reason: escalation?.reason || "CUSTOMER_RISK_OR_COMPLAINT",
    keyword: escalation?.keyword || "",
    source: "ai_escalation",
  });
  pushAIEvent({
    type: "AI_ESCALATED_TO_HUMAN",
    status: "warning",
    conversationId,
    platform: channel,
    reason: escalation?.reason || "CUSTOMER_RISK_OR_COMPLAINT",
    keyword: escalation?.keyword || "",
  });
  console.log("ai_escalated_to_human", {
    tenant_id: tenantId,
    conversation_id: conversationId,
    channel,
    reason: escalation?.reason || "",
    keyword: escalation?.keyword || "",
  });
  return {
    conversation,
    result: {
      channel,
      external_customer_id: message?.external_customer_id || "",
      conversation_id: conversationId,
      sent: false,
      reason: escalation?.reason || "CUSTOMER_RISK_OR_COMPLAINT",
      keyword: escalation?.keyword || "",
    },
  };
};

const normalizeReturnedToAIConversation = (conversation = {}) => ({
  ...conversation,
  status: "ai_active",
  conversation_status: "ai_active",
  closed: false,
  human_takeover: false,
  ai_paused: false,
  assigned_staff_id: null,
  assigned_user_id: null,
  assigned_user_name: "",
  assigned_user: null,
  takeover_started_at: null,
  taken_over_at: null,
  closed_at: null,
  escalation_reason: null,
  ai_escalation_reason: null,
  last_escalation_keyword: null,
  escalated_at: null,
});

const rememberProduct = (productContext = null) => {
  if (!productContext) return null;
  return {
    id: productContext.id,
    slug: productContext.slug,
    name: productContext.name,
    brand: productContext.brand || "",
    model: productContext.model || "",
    price: productContext.salePrice || productContext.price,
    salePrice: productContext.salePrice,
    imageUrl: productContext.imageUrl || "",
    productUrl: productContext.productUrl || "",
    inStock: productContext.inStock,
    sizes: productContext.sizes || [],
  };
};

const productImageAttachments = (productContext = null) =>
  productContext?.imageUrl
    ? [{ type: "image", url: productContext.imageUrl }]
    : [];

const logProductShareContext = ({ conversationId = "", platform = "", productContext = null, includeImage = false } = {}) => {
  if (!productContext?.id) return;
  if (productContext.productUrl) {
    pushAIEvent({
      type: "PRODUCT_LINK_ATTACHED",
      status: "success",
      conversationId,
      platform,
      productId: productContext.id,
      productUrl: productContext.productUrl,
    });
  }
  if (includeImage && productContext.imageUrl) {
    pushAIEvent({
      type: "PRODUCT_IMAGE_ATTACHED",
      status: "success",
      conversationId,
      platform,
      productId: productContext.id,
    });
  }
};

const commerceReplyForIntent = (intent = "", productContext = null, detectedSize = null) => {
  if (productContext?.name) {
    const price = productContext.salePrice || productContext.price;
    const sizes = Array.isArray(productContext.sizes) ? productContext.sizes.map((size) => String(size)) : [];
    if (detectedSize && sizes.length) {
      return sizes.includes(String(detectedSize))
        ? `أيوه  مقاس ${detectedSize} متاح حاليا في ${productContext.name}.`
        : `للأسف مقاس ${detectedSize} مش ظاهر متاح حاليا في ${productContext.name}.`;
    }
    if (intent === "PRICE_INQUIRY" && price) {
      return `سعر ${productContext.name} حاليا ${price} جنيه `;
    }
    if (intent === "AVAILABILITY_INQUIRY") {
      return productContext.inStock
        ? `أيوه  ${productContext.name} متوفر حاليا.`
        : `للأسف ${productContext.name} غير متوفر حاليا.`;
    }
    if (intent === "SIZE_INQUIRY" && productContext.sizes?.length) {
      return `المقاسات المتاحة حاليا لـ ${productContext.name}: ${productContext.sizes.join(", ")} `;
    }
  }
  switch (intent) {
    case "SIZE_INQUIRY":
      return "أكيد  ابعتلي المقاس اللي بتلبسه عادة أو طول القدم وأنا أساعدك تختار المقاس المناسب.";
    case "PRICE_INQUIRY":
      return "أكيد  هقولك السعر الحالي والمتاح دلوقتي.";
    case "AVAILABILITY_INQUIRY":
      return "ثانية واحدة أتأكدلك من التوفر الحالي والمقاسات المتاحة ";
    default:
      return "";
  }
};

const firstProductFromPayload = (payload = {}) => {
  const candidates = [
    payload?.product_context,
    payload?.reply?.product_context,
    payload?.channel_reply?.product_context,
    ...(Array.isArray(payload?.suggested_products) ? payload.suggested_products : []),
    ...(Array.isArray(payload?.reply?.suggested_products) ? payload.reply.suggested_products : []),
    ...(Array.isArray(payload?.channel_reply?.suggested_products) ? payload.channel_reply.suggested_products : []),
    ...(Array.isArray(payload?.visual_attachments)
      ? payload.visual_attachments.flatMap((item) => Array.isArray(item?.items) ? item.items : [])
      : []),
    ...(Array.isArray(payload?.reply?.visual_attachments)
      ? payload.reply.visual_attachments.flatMap((item) => Array.isArray(item?.items) ? item.items : [])
      : []),
  ];
  return candidates.find((product) => product?.id || product?.product_id || product?.name || product?.title) || null;
};

const shouldAutoReplyToConversation = async ({ tenantId, conversationId, channel, settings = {}, payload = {} } = {}) => {
  const state = await getAiSupportConversationState({ tenantId, sessionId: conversationId, channel }).catch(() => null);
  const status = String(state?.status || payload?.conversation_status || "").toLowerCase();
  const mode = envText(settings.auto_reply_mode || (settings.ai_replies_enabled === true ? "fully_automatic" : "off")).toLowerCase();
  const globalSettings = await getAISettings();
  const globalMode = envText(globalSettings.autoReplyMode || "suggest_only").toLowerCase();
  const channelAISettings = await getAIChannelSettings(channel, channel);
  const channelMode = envText(channelAISettings.aiMode || "suggest_only").toLowerCase();
  const effectiveAutoReplyMode = globalMode !== "fully_automatic" ? globalMode : channelMode || "suggest_only";
  const base = { tenant_id: tenantId, conversation_id: conversationId, channel, mode, global_mode: globalMode, channel_mode: channelMode, effective_mode: effectiveAutoReplyMode, status };
  if (state?.ai_enabled === false) {
    pushAIEvent({
      type: "AI_AUTO_REPLY_SKIPPED",
      status: "warning",
      conversationId,
      platform: channel,
      reason: "CONVERSATION_AI_DISABLED",
    });
    console.log("ai_auto_reply_skipped_conversation_ai_disabled", base);
    return { ok: false, reason: "CONVERSATION_AI_DISABLED", state, mode, channelSettings: channelAISettings };
  }
  if (status === "human_takeover") {
    pushAIEvent({
      type: "HUMAN_TAKEOVER_ACTIVE",
      status: "warning",
      conversationId,
      platform: channel,
    });
    console.log("[AI_AUTO_REPLY_SKIPPED] reason=human_takeover", base);
    return { ok: false, reason: "human_takeover", state, mode };
  }
  if (status === "closed" || payload?.auto_response_paused === true) {
    console.log("ai_auto_reply_skipped_paused", { ...base, auto_response_paused: payload?.auto_response_paused === true });
    return { ok: false, reason: "paused", state, mode };
  }
  if (globalMode === "off") {
    pushAIEvent({
      type: "AI_AUTO_REPLY_SKIPPED",
      status: "warning",
      conversationId,
      platform: channel,
      reason: "GLOBAL_OFF",
    });
    console.log("ai_auto_reply_skipped_global_mode", { ...base, reason: "GLOBAL_OFF" });
    return { ok: false, reason: "GLOBAL_OFF", state, mode, channelSettings: channelAISettings };
  }
  if (globalMode !== "fully_automatic") {
    pushAIEvent({
      type: "AI_AUTO_REPLY_SKIPPED",
      status: "warning",
      conversationId,
      platform: channel,
      reason: "GLOBAL_SUGGEST_ONLY",
    });
    console.log("ai_auto_reply_skipped_global_mode", { ...base, reason: "GLOBAL_SUGGEST_ONLY" });
    return { ok: false, reason: "GLOBAL_SUGGEST_ONLY", state, mode, channelSettings: channelAISettings };
  }
  if (channelMode === "off") {
    pushAIEvent({
      type: "AI_AUTO_REPLY_SKIPPED",
      status: "warning",
      conversationId,
      platform: channel,
      reason: "CHANNEL_OFF",
    });
    console.log("ai_auto_reply_skipped_channel_mode", { ...base, reason: "CHANNEL_OFF" });
    return { ok: false, reason: "CHANNEL_OFF", state, mode, channelSettings: channelAISettings };
  }
  if (effectiveAutoReplyMode !== "fully_automatic") {
    pushAIEvent({
      type: "AI_AUTO_REPLY_SKIPPED",
      status: "warning",
      conversationId,
      platform: channel,
      reason: "CHANNEL_SUGGEST_ONLY",
    });
    console.log("ai_auto_reply_skipped_channel_mode", { ...base, reason: "CHANNEL_SUGGEST_ONLY" });
    return { ok: false, reason: "CHANNEL_SUGGEST_ONLY", state, mode, channelSettings: channelAISettings };
  }
  if (settings.ai_replies_enabled !== true || mode !== "fully_automatic") {
    pushAIEvent({
      type: "AI_AUTO_REPLY_SKIPPED",
      status: "warning",
      conversationId,
      platform: channel,
      reason: mode === "off" ? "AUTO_REPLY_OFF" : "SUGGEST_ONLY",
    });
    console.log("ai_auto_reply_skipped_mode", { ...base, ai_replies_enabled: settings.ai_replies_enabled === true });
    return { ok: false, reason: mode || "off", state, mode };
  }
  console.log("ai_auto_reply_triggered", base);
  return { ok: true, reason: "fully_automatic", state, mode, channelSettings: channelAISettings };
};

const whatsappWebhookUrl = (req) =>
  `${envText(process.env.PUBLIC_BACKEND_URL) || `${req.protocol || "http"}://${req.get("host")}`}/api/ai-agent/channels/whatsapp/webhook`;

const metaWebhookUrl = (req) =>
  `${envText(process.env.PUBLIC_BACKEND_URL) || `${req.protocol || "http"}://${req.get("host")}`}/api/ai-agent/channels/meta/webhook`;

router.get("/test-sales-closer", (req, res) => {
  res.json({
    success: true,
    mounted: true,
    route: "GET /test-sales-closer",
    expected_sales_closer: "GET /conversations/:conversationId/sales-closer",
    prefix: req.baseUrl || "",
    original_url: req.originalUrl || req.url,
  });
});

router.get("/logs", protect, permit("settings", "view"), (req, res) => {
  return res.json({
    success: true,
    logs: getAIEvents(),
  });
});

router.post("/test-reply", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const channelId = envText(req.body?.channelId || req.body?.channel_id || AI_AGENT_CHANNELS.FACEBOOK_MESSENGER);
    const platform = envText(req.body?.platform || channelId);
    const message = envText(req.body?.message);
    const productId = Number(req.body?.productId || req.body?.product_id || 0);
    const globalSettings = await getAISettings();
    const channelSettings = await getAIChannelSettings(channelId, platform);
    const intent = resolveIntent(message);
    const detectedSize = extractShoeSize(message);
    const escalation = detectEscalation(message);
    const effectiveMode = globalSettings.autoReplyMode !== "fully_automatic"
      ? globalSettings.autoReplyMode
      : channelSettings.aiMode || "suggest_only";
    const effectiveTone = channelSettings.tone || globalSettings.tone || "casual";
    const testConversationId = `test:${channelId}`;
    const memory = getConversationMemory(testConversationId) || getConversationMemory(channelId);
    let productContext = null;
    if (productId > 0) {
      const products = await searchAiOrderProducts({
        tenantId,
        message: "",
        metadata: { product_id: productId, matched_product_id: productId },
      }).catch((error) => {
        console.warn("ai_test_playground_product_lookup_failed", {
          tenant_id: tenantId,
          product_id: productId,
          message: error?.message || "Product lookup failed",
        });
        return [];
      });
      const product = products.find((item) => Number(item.id || item.product_id) === productId) || products[0] || null;
      productContext = product ? buildProductContext({
        ...product,
        price: product.product_price || product.price,
        total_stock: product.total_stock,
      }) : null;
    }
    const replyProductContext = productContext || buildProductContext(memory?.lastProduct);
    const humanizedTestReply = buildHumanizedReply({
      intent,
      productContext: replyProductContext,
      detectedSize,
      conversationId: testConversationId,
      customerName: req.body?.customerName || req.body?.customer_name || "",
    });
    const simulatedReply = humanizedTestReply || commerceReplyForIntent(intent, replyProductContext, detectedSize) ||
      "تمام  أقدر أساعدك، ممكن تبعتلي اسم المنتج أو صورته؟";
    const guarded = guardAIReply({
      reply: simulatedReply,
      intent,
      productContext,
      conversationMemory: memory,
      detectedSize,
    });
    logProductShareContext({
      conversationId: testConversationId,
      platform,
      productContext: replyProductContext,
      includeImage: Boolean(replyProductContext?.imageUrl),
    });
    const result = {
      intent,
      effectiveMode,
      effectiveTone,
      productContext,
      memory,
      safetyReason: guarded.reason,
      finalReply: ensureProductLinkInReply(guarded.reply, replyProductContext),
      wouldSendAutomatically: effectiveMode === "fully_automatic" && guarded.allowed !== false,
    };
    pushAIEvent({
      type: "AI_TEST_PLAYGROUND_RUN",
      status: "success",
      channelId,
      intent,
      safetyReason: guarded.reason,
    });
    return res.json({ success: true, result });
  } catch (error) {
    return sendError(res, error, "Failed to test AI reply");
  }
});

const handleAISuggestedReplies = async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = envText(req.body?.conversationId || req.body?.conversation_id);
    const channelId = envText(req.body?.channelId || req.body?.channel_id || AI_AGENT_CHANNELS.FACEBOOK_MESSENGER);
    const platform = envText(req.body?.platform || channelId);
    const message = envText(req.body?.message);
    const productId = Number(req.body?.productId || req.body?.product_id || 0);
    const globalSettings = await getAISettings();
    const channelSettings = await getAIChannelSettings(channelId, platform);
    const intent = resolveIntent(message);
    const detectedSize = extractShoeSize(message);
    const escalation = detectEscalation(message);
    const effectiveMode = globalSettings.autoReplyMode !== "fully_automatic"
      ? globalSettings.autoReplyMode
      : channelSettings.aiMode || "suggest_only";
    const effectiveTone = channelSettings.tone || globalSettings.tone || "casual";
    const memory = getConversationMemory(conversationId) || getConversationMemory(channelId);
    let productContext = null;

    if (productId > 0) {
      const products = await searchAiOrderProducts({
        tenantId,
        message: "",
        metadata: { product_id: productId, matched_product_id: productId },
      }).catch((error) => {
        console.warn("ai_suggested_replies_product_lookup_failed", {
          tenant_id: tenantId,
          product_id: productId,
          message: error?.message || "Product lookup failed",
        });
        return [];
      });
      const product = products.find((item) => Number(item.id || item.product_id) === productId) || products[0] || null;
      productContext = product ? buildProductContext({
        ...product,
        price: product.product_price || product.price,
        total_stock: product.total_stock,
      }) : null;
    }

    const replyProductContext = productContext || buildProductContext(memory?.lastProduct);
    const humanizedSuggestedReply = buildHumanizedReply({
      intent,
      productContext: replyProductContext,
      detectedSize,
      conversationId,
      customerName: req.body?.customerName || req.body?.customer_name || "",
    });
    const baseReply = escalation.shouldEscalate
      ? "واضح إن فيه مشكلة محتاجة متابعة من أحد أفراد الفريق. هحوّل المحادثة لموظف يساعدك فورًا "
      : humanizedSuggestedReply || commerceReplyForIntent(intent, replyProductContext, detectedSize) ||
      "تمام أقدر أساعدك، ممكن تبعتلي اسم المنتج أو صورته؟";
    const guarded = guardAIReply({
      reply: baseReply,
      intent,
      productContext,
      conversationMemory: memory,
      detectedSize,
    });
    logProductShareContext({
      conversationId,
      platform,
      productContext: replyProductContext,
      includeImage: Boolean(replyProductContext?.imageUrl),
    });
    if (!escalation.shouldEscalate && humanizedSuggestedReply) {
      pushAIEvent({
        type: "HUMANIZED_REPLY_USED",
        status: "success",
        conversationId,
        platform,
        intent,
      });
    }
    const suggestions = buildSuggestedReplies(ensureProductLinkInReply(guarded.reply, replyProductContext), {
      productContext: replyProductContext,
      memory,
    });

    if (escalation.shouldEscalate) {
      pushAIEvent({
        type: "AI_ESCALATED_TO_HUMAN",
        status: "warning",
        conversationId,
        platform,
        reason: escalation.reason,
        keyword: escalation.keyword,
      });
    }

    pushAIEvent({
      type: "AI_SUGGESTED_REPLIES_GENERATED",
      status: "success",
      conversationId,
      count: suggestions.length,
      intent,
      escalationReason: escalation.reason || undefined,
    });

    return res.json({
      success: true,
      suggestions,
      meta: {
        intent,
        effectiveMode,
        effectiveTone,
        safetyReason: guarded.reason,
        productContext: replyProductContext,
        escalated: escalation.shouldEscalate,
        escalationReason: escalation.reason,
        escalationKeyword: escalation.keyword,
      },
    });
  } catch (error) {
    return sendError(res, error, "Failed to generate suggested replies");
  }
};

router.post("/suggested-replies", protect, permit("settings", "view"), handleAISuggestedReplies);
router.post("/sugested-replies", protect, permit("settings", "view"), handleAISuggestedReplies);

router.post("/orders/draft", async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await createAiOrderDraft({ ...req.body, tenant_id: tenantId });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to create AI order draft");
  }
});

router.post("/orders/confirm", async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await confirmAiOrder({ ...req.body, tenant_id: tenantId, user_id: req.user?.id || null });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to confirm AI order");
  }
});

router.get("/orders/drafts", protect, permit("orders", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const drafts = await listAiOrderDrafts({ tenantId, limit: req.query?.limit });
    return res.json({ success: true, drafts });
  } catch (error) {
    return sendError(res, error, "Failed to load AI order drafts");
  }
});

router.patch("/orders/:id/status", protect, permit("orders", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const order = await updateAiOrderStatus({ tenantId, orderId: Number(req.params.id), status: String(req.body?.status || "") });
    if (!order) return res.status(404).json({ success: false, message: "AI order not found" });
    return res.json({ success: true, order });
  } catch (error) {
    return sendError(res, error, "Failed to update AI order");
  }
});

router.get("/channels/whatsapp/webhook", (req, res) => {
  const mode = envText(req.query?.["hub.mode"]);
  const token = envText(req.query?.["hub.verify_token"]);
  const challenge = envText(req.query?.["hub.challenge"]);
  const expected = envText(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN);
  if (mode === "subscribe" && expected && token === expected) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Forbidden");
});

router.post("/channels/whatsapp/webhook", async (req, res) => {
  try {
    if (!whatsappEnabled()) {
      console.warn("[ai-agent:whatsapp] webhook received while disabled");
      return res.status(200).json({ success: true, disabled: true });
    }
    const signatureOk = verifyMetaWebhookSignature({
      rawBody: req.rawBody,
      signature: req.headers?.["x-hub-signature-256"],
      appSecret: process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET,
    });
    if (!signatureOk) {
      console.warn("[ai-agent:whatsapp] invalid webhook signature");
      return res.status(403).json({ success: false, message: "Invalid signature" });
    }
    const hasStatuses = req.body?.entry?.some?.((entry) =>
      entry?.changes?.some?.((change) => Array.isArray(change?.value?.statuses) && change.value.statuses.length > 0)
    );
    const metadata = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata || {};
    const tenantId = await resolveWhatsappTenantId(req, metadata);
    if (!tenantId) return res.status(400).json({ success: false, message: "A valid tenant id is required" });
    const messages = extractWhatsAppWebhookMessages({ body: req.body, tenantId });
    if (!messages.length) {
      return res.status(200).json({ success: true, ignored: hasStatuses ? "status_update" : "no_messages" });
    }
    const results = [];
    for (const message of messages) {
      if (!message.message_text && !message.attachments?.length) {
        results.push({ external_customer_id: message.external_customer_id, ignored: "empty_message" });
        continue;
      }
      await logChannelEvent({
        tenantId,
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        direction: "inbound",
        externalCustomerId: message.external_customer_id,
        conversationId: message.external_conversation_id,
        messagePreview: message.message_text || "[attachment]",
        status: "received",
        metadata: { attachment_count: message.attachments?.length || 0 },
      }).catch(() => {});
      await upsertChannelConversationMapping({
        tenantId,
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        externalConversationId: message.external_conversation_id,
        externalCustomerId: message.external_customer_id,
        customerName: ["facebook_messenger", "facebook", "messenger"].includes(String(channel || message.channel || "").toLowerCase())
          ? String(message.raw?.messenger_profile?.name || message.raw?.sender_name || message.raw?.profile_name || message.raw?.contact_name || "").trim()
          : message.customer_name,
        metadata: {
          phone_number_id: metadata.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
          display_phone_number: metadata.display_phone_number || "",
          channel: AI_AGENT_CHANNELS.WHATSAPP,
        },
        lastMessageAt: message.timestamp,
      }).catch((error) => {
        console.warn("[ai-agent:whatsapp] mapping upsert skipped", { tenantId, message: error?.message });
      });
      const intentMessage = envText(message.normalized_for_intent || message.message_text || "");
      const escalation = detectEscalation(intentMessage);
      if (escalation.shouldEscalate) {
        const escalated = await escalateToHuman({
          tenantId,
          conversationId: message.external_conversation_id,
          channel: AI_AGENT_CHANNELS.WHATSAPP,
          message,
          escalation,
        });
        results.push(escalated.result);
        continue;
      }
      const preState = await getAiSupportConversationState({ tenantId, sessionId: message.external_conversation_id, channel: AI_AGENT_CHANNELS.WHATSAPP }).catch(() => null);
      if (preState?.ai_enabled === false) {
        results.push({
          external_customer_id: message.external_customer_id,
          conversation_id: message.external_conversation_id,
          sent: false,
          reason: "conversation_ai_disabled",
        });
        continue;
      }
      let aiPayload = null;
      try {
        aiPayload = await routeChannelMessageThroughAi({ req, tenantId, message, channel: AI_AGENT_CHANNELS.WHATSAPP });
        await linkChannelConversationToCustomerProfile({
          tenantId,
          channel: AI_AGENT_CHANNELS.WHATSAPP,
          externalConversationId: message.external_conversation_id,
          externalCustomerId: message.external_customer_id,
        }).catch((error) => {
          console.warn("[ai-agent:whatsapp] profile mapping skipped", { tenantId, message: error?.message });
        });
      } catch (error) {
        console.error("[ai-agent:whatsapp] AI flow failed", {
          tenantId,
          external_customer_id: message.external_customer_id,
          message: error?.message,
          status: error?.status,
        });
        results.push({ external_customer_id: message.external_customer_id, ai_error: error?.message || "AI flow failed" });
        continue;
      }
      const channelSettings = await getChannelSettings({ tenantId, channel: AI_AGENT_CHANNELS.WHATSAPP }).catch(() => ({}));
      const autoReplyMode = envText(channelSettings.auto_reply_mode || (channelSettings.ai_replies_enabled === true ? "fully_automatic" : "off")).toLowerCase();
      if (channelSettings.ai_replies_enabled !== true || autoReplyMode !== "fully_automatic" || !shouldSendWhatsappReply(aiPayload)) {
        results.push({
          external_customer_id: message.external_customer_id,
          conversation_id: message.external_conversation_id,
          sent: false,
          reason: channelSettings.ai_replies_enabled === true ? autoReplyMode || "ai_paused" : "channel_ai_replies_disabled",
        });
        continue;
      }
      const reply = aiPayload.channel_reply || normalizeOutgoingChannelReply({ channel: AI_AGENT_CHANNELS.WHATSAPP, response: aiPayload });
      const productContext = buildProductContext(firstProductFromPayload(aiPayload));
      const replyProductContext = productContext || buildProductContext(getConversationMemory(message.external_conversation_id)?.lastProduct);
      const whatsappReplyText = ensureProductLinkInReply(reply.text || aiPayload.answer || "", replyProductContext);
      const whatsappReply = {
        ...reply,
        text: whatsappReplyText,
        visual_attachments: [
          ...productImageAttachments(replyProductContext).map((attachment) => ({
            type: "product_image",
            image_url: attachment.url,
            url: attachment.url,
          })),
          ...(Array.isArray(reply.visual_attachments) ? reply.visual_attachments : []),
        ],
      };
      logProductShareContext({
        conversationId: message.external_conversation_id,
        platform: AI_AGENT_CHANNELS.WHATSAPP,
        productContext: replyProductContext,
        includeImage: Boolean(replyProductContext?.imageUrl),
      });
      try {
        const sendResult = await sendWhatsAppCloudReply({
          to: message.external_customer_id,
          reply: whatsappReply,
          messageText: whatsappReplyText,
        });
        results.push({
          external_customer_id: message.external_customer_id,
          conversation_id: message.external_conversation_id,
          sent: sendResult.sent,
        });
        await logChannelEvent({
          tenantId,
          channel: AI_AGENT_CHANNELS.WHATSAPP,
          direction: "outbound",
          externalCustomerId: message.external_customer_id,
          conversationId: message.external_conversation_id,
          messagePreview: whatsappReplyText,
          status: sendResult.sent ? "sent" : "not_sent",
          metadata: { result_count: sendResult.results?.length || 0 },
        }).catch(() => {});
      } catch (error) {
        console.error("[ai-agent:whatsapp] send failed", {
          tenantId,
          to: message.external_customer_id,
          code: error?.code,
          status: error?.status,
          message: error?.message,
        });
        results.push({
          external_customer_id: message.external_customer_id,
          conversation_id: message.external_conversation_id,
          sent: false,
          send_error: error?.message || "WhatsApp send failed",
        });
        await logChannelEvent({
          tenantId,
          channel: AI_AGENT_CHANNELS.WHATSAPP,
          direction: "outbound",
          externalCustomerId: message.external_customer_id,
          conversationId: message.external_conversation_id,
          messagePreview: reply.text || aiPayload.answer || "",
          status: "failed",
          error: error?.message || "WhatsApp send failed",
          metadata: { code: error?.code || "", status: error?.status || "" },
        }).catch(() => {});
      }
    }
    return res.status(200).json({ success: true, processed: results.length, results });
  } catch (error) {
    console.error("[ai-agent:whatsapp] webhook error", { message: error?.message, stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined });
    return res.status(200).json({ success: false, message: "WhatsApp webhook handled with errors" });
  }
});

router.get("/channels/meta/webhook", (req, res) => {
  const mode = envText(req.query?.["hub.mode"]);
  const token = envText(req.query?.["hub.verify_token"]);
  const challenge = envText(req.query?.["hub.challenge"]);
  const expected = envText(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN);
  if (mode === "subscribe" && expected && token === expected) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Forbidden");
});

router.post("/channels/meta/webhook", async (req, res) => {
  try {
    const signatureOk = verifyMetaWebhookSignature({
      rawBody: req.rawBody,
      signature: req.headers?.["x-hub-signature-256"],
      appSecret: process.env.META_APP_SECRET,
    });
    if (!signatureOk) {
      console.warn("[ai-agent:meta] invalid webhook signature");
      return res.status(403).json({ success: false, message: "Invalid signature" });
    }
    const hasOnlyEchoes = req.body?.entry?.some?.((entry) =>
      entry?.messaging?.some?.((event) => event.read || event.delivery || event.message?.is_echo)
    );
    const accountId = req.body?.entry?.[0]?.id || req.body?.entry?.[0]?.messaging?.[0]?.recipient?.id || "";
    const tenantId = await resolveMetaTenantId(req, accountId);
    if (!tenantId) return res.status(400).json({ success: false, message: "A valid tenant id is required" });
    const messages = extractMetaWebhookMessages({ body: req.body, tenantId })
      .filter((message) => message.message_text || message.attachments?.length);
    if (!messages.length) {
      return res.status(200).json({ success: true, ignored: hasOnlyEchoes ? "read_delivery_or_echo" : "no_messages" });
    }
    const results = [];
    for (const message of messages) {
      const channel = message.channel;
      const conversationId = message.external_conversation_id;
      const customerMessage = envText(message.normalized_for_intent || message.message_text || "");
      const messageId = envText(message.external_message_id || message.dedupe_key || "");
      const { inboundKey, inboundMetaMid } = resolveMetaInboundDedupeContext({ channel, conversationId, message });
      if (isDuplicateMessage(messageId)) {
        pushAIEvent({
          type: "DUPLICATE_MESSAGE_SKIPPED",
          status: "warning",
          conversationId,
          platform: channel,
          messageId,
        });
        results.push({
          channel,
          external_customer_id: message.external_customer_id,
          conversation_id: conversationId,
          sent: false,
          duplicate: true,
          reason: "duplicate_message",
        });
        continue;
      }
      const intent = resolveIntent(customerMessage);
      const detectedSize = extractShoeSize(customerMessage);
      updateConversationMemory(conversationId, {
        lastIntent: intent,
        ...(detectedSize ? { lastSize: detectedSize } : {}),
      });
      pushAIEvent({
        type: "MESSAGE_RECEIVED",
        status: "success",
        conversationId,
        platform: channel,
      });
      pushAIEvent({
        type: "INTENT_DETECTED",
        status: "success",
        conversationId,
        platform: channel,
        intent,
      });
      pushAIEvent({
        type: "CONVERSATION_MEMORY_UPDATED",
        status: "success",
        conversationId,
        platform: channel,
        memory: {
          lastIntent: intent,
          lastSize: detectedSize || undefined,
        },
      });
      await logChannelEvent({
        tenantId,
        channel,
        direction: "inbound",
        externalCustomerId: message.external_customer_id,
        conversationId,
        messagePreview: message.message_text || "[attachment]",
        status: "received",
        metadata: { attachment_count: message.attachments?.length || 0, account_id: accountId },
      }).catch(() => {});
      await upsertChannelConversationMapping({
        tenantId,
        channel,
        externalConversationId: conversationId,
        externalCustomerId: message.external_customer_id,
        customerName: ["facebook_messenger", "facebook", "messenger"].includes(String(channel || message.channel || "").toLowerCase())
          ? String(message.raw?.messenger_profile?.name || message.raw?.sender_name || message.raw?.profile_name || message.raw?.contact_name || "").trim()
          : message.customer_name,
        metadata: {
          page_id: process.env.META_PAGE_ID || accountId || "",
          instagram_business_account_id: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "",
          account_id: accountId || "",
          channel,
        },
        lastMessageAt: message.timestamp,
      }).catch((error) => {
        console.warn("[ai-agent:meta] mapping upsert skipped", { tenantId, channel, message: error?.message });
      });
      if (channel === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER) {
        void syncMessengerProfileForConversation({
          tenantId,
          conversationId,
          externalCustomerId: message.external_customer_id,
        }).catch((error) => {
          console.warn("[ai-agent:meta] messenger profile sync deferred", {
            tenantId,
            channel,
            conversation_id: conversationId,
            message: error?.message,
          });
        });
      }
      const escalation = detectEscalation(customerMessage);
      if (escalation.shouldEscalate) {
        const escalated = await escalateToHuman({
          tenantId,
          conversationId,
          channel,
          message,
          escalation,
        });
        results.push(escalated.result);
        continue;
      }
      const preState = await getAiSupportConversationState({ tenantId, sessionId: conversationId, channel }).catch(() => null);
      if (preState?.ai_enabled === false) {
        results.push({
          channel,
          external_customer_id: message.external_customer_id,
          conversation_id: message.external_conversation_id,
          sent: false,
          reason: "conversation_ai_disabled",
        });
        continue;
      }
      if (preState?.status === "human_takeover") {
        pushAIEvent({
          type: "HUMAN_TAKEOVER_ACTIVE",
          status: "warning",
          conversationId: message.external_conversation_id,
          platform: channel,
        });
        console.log("ai_auto_reply_skipped_human_takeover", {
          tenant_id: tenantId,
          conversation_id: message.external_conversation_id,
          channel,
          status: preState.status,
          phase: "before_ai_generation",
        });
        results.push({
          channel,
          external_customer_id: message.external_customer_id,
          conversation_id: message.external_conversation_id,
          sent: false,
          reason: "human_takeover",
        });
        continue;
      }
      if (preState?.status === "closed") {
        console.log("ai_auto_reply_skipped_paused", {
          tenant_id: tenantId,
          conversation_id: message.external_conversation_id,
          channel,
          status: preState.status,
          phase: "before_ai_generation",
        });
        results.push({
          channel,
          external_customer_id: message.external_customer_id,
          conversation_id: message.external_conversation_id,
          sent: false,
          reason: "closed",
        });
        continue;
      }
      let aiPayload = null;
      try {
        aiPayload = await routeChannelMessageThroughAi({ req, tenantId, message, channel });
        pushAIEvent({
          type: "AI_REPLY_GENERATED",
          status: "success",
          conversationId: message.external_conversation_id,
          platform: channel,
        });
        await linkChannelConversationToCustomerProfile({
          tenantId,
          channel,
          externalConversationId: message.external_conversation_id,
          externalCustomerId: message.external_customer_id,
        }).catch((error) => {
          console.warn("[ai-agent:meta] profile mapping skipped", { tenantId, channel, message: error?.message });
        });
      } catch (error) {
        console.error("[ai-agent:meta] AI flow failed", {
          tenantId,
          channel,
          external_customer_id: message.external_customer_id,
          message: error?.message,
          status: error?.status,
        });
        results.push({ channel, external_customer_id: message.external_customer_id, ai_error: error?.message || "AI flow failed" });
        continue;
      }
      const channelSettings = await getChannelSettings({ tenantId, channel }).catch(() => ({}));
      const autoReplyDecision = await shouldAutoReplyToConversation({
        tenantId,
        conversationId: message.external_conversation_id,
        channel,
        settings: channelSettings,
        payload: aiPayload,
      });
      const channelReplyDecision = shouldSendChannelReply(channel, aiPayload);
      console.log("[messenger-send-gate]", {
        tenant_id: tenantId,
        conversation_id: message.external_conversation_id,
        channel,
        decision: autoReplyDecision.ok && channelReplyDecision.ok ? "send" : "skip",
        reason: !autoReplyDecision.ok ? autoReplyDecision.reason : channelReplyDecision.reason,
        auto_reply_ok: autoReplyDecision.ok === true,
        channel_reply_ok: channelReplyDecision.ok === true,
        conversation_status: aiPayload?.conversation_status || "",
        detected_intent: aiPayload?.detected_intent || "",
        auto_response_paused: aiPayload?.auto_response_paused === true,
      });
      if (!autoReplyDecision.ok || !channelReplyDecision.ok) {
        const skipReason = !autoReplyDecision.ok ? autoReplyDecision.reason : channelReplyDecision.reason;
        console.log("[messenger-send-skipped]", {
          tenant_id: tenantId,
          conversation_id: message.external_conversation_id,
          channel,
          reason: skipReason,
          auto_reply_ok: autoReplyDecision.ok === true,
          channel_reply_ok: channelReplyDecision.ok === true,
          sendMetaInboxOutboundMessage_called: false,
        });
        results.push({
          channel,
          external_customer_id: message.external_customer_id,
          conversation_id: message.external_conversation_id,
          sent: false,
          reason: skipReason,
        });
        continue;
      }
      const reply = aiPayload.channel_reply || normalizeOutgoingChannelReply({ channel, response: aiPayload });
      const productContext = buildProductContext(firstProductFromPayload(aiPayload));
      const conversationMemory = getConversationMemory(conversationId);
      const replyProductContext = productContext || buildProductContext(conversationMemory?.lastProduct);
      if (productContext) {
        const lastProduct = rememberProduct(productContext);
        updateConversationMemory(conversationId, { lastProduct });
        pushAIEvent({
          type: "PRODUCT_CONTEXT_ATTACHED",
          status: "success",
          conversationId,
          platform: channel,
          productId: productContext.id,
          productName: productContext.name,
        });
        pushAIEvent({
          type: "CONVERSATION_MEMORY_UPDATED",
          status: "success",
          conversationId,
          platform: channel,
          memory: {
            lastIntent: intent,
            lastSize: detectedSize || conversationMemory?.lastSize || undefined,
            lastProduct: productContext.name,
          },
        });
      }
      const humanizedReply = buildHumanizedReply({
        intent,
        productContext: replyProductContext,
        detectedSize,
        conversationId,
        customerName: ["facebook_messenger", "facebook", "messenger"].includes(String(channel || message.channel || "").toLowerCase())
          ? String(message.raw?.messenger_profile?.name || message.raw?.sender_name || message.raw?.profile_name || message.raw?.contact_name || "").trim()
          : message.customer_name || "",
      });
      const candidateReply = humanizedReply || commerceReplyForIntent(intent, replyProductContext, detectedSize) || reply.text || aiPayload.answer || "";
      if (humanizedReply) {
        pushAIEvent({
          type: "HUMANIZED_REPLY_USED",
          status: "success",
          conversationId,
          platform: channel,
          intent,
        });
      }
      const guarded = guardAIReply({
        reply: candidateReply,
        intent,
        productContext,
        conversationMemory,
        detectedSize,
      });
      const replyText = ensureProductLinkInReply(guarded.reply, replyProductContext);
      const outboundAttachments = productImageAttachments(replyProductContext);
      logProductShareContext({
        conversationId: message.external_conversation_id,
        platform: channel,
        productContext: replyProductContext,
        includeImage: outboundAttachments.length > 0,
      });
      pushAIEvent({
        type: "AI_SAFETY_GUARD",
        status: guarded.reason === "OK" ? "success" : "warning",
        conversationId,
        platform: channel,
        reason: guarded.reason,
      });
      try {
        console.log("[messenger-send] before sendMetaInboxOutboundMessage", {
          tenant_id: tenantId,
          conversation_id: message.external_conversation_id,
          channel,
          recipient_id_present: Boolean(message.external_customer_id),
          page_id_present: Boolean(message.metadata?.page_id || message.page_id),
          instagram_business_account_id_present: Boolean(message.metadata?.instagram_business_account_id || message.instagram_business_account_id),
          message_length: replyText.length,
          attachment_count: outboundAttachments.length,
          product_card_count: (reply.product_cards || aiPayload.suggested_products || []).length,
          sendMetaInboxOutboundMessage_called: false,
        });
        const sendResult = await sendMetaInboxOutboundMessage({
          tenantId,
          channel,
          messageText: replyText,
          recipientId: message.external_customer_id,
          conversationId: message.external_conversation_id,
          attachments: outboundAttachments,
          productCards: reply.product_cards || aiPayload.suggested_products || [],
          facebookPageId: message.metadata?.page_id || message.page_id || "",
          instagramBusinessAccountId: message.metadata?.instagram_business_account_id || message.instagram_business_account_id || "",
          inboundKey,
          inboundMetaMid,
        });
        console.log("[messenger-send] after sendMetaInboxOutboundMessage", {
          tenant_id: tenantId,
          conversation_id: message.external_conversation_id,
          channel,
          sent: sendResult?.sent === true,
          message_id: sendResult?.message_id || "",
          dedupe_skipped: sendResult?.dedupe_skipped === true,
          skip_reason: sendResult?.skip_reason || "",
          sendMetaInboxOutboundMessage_called: true,
        });
        if (sendResult?.dedupe_skipped === true || sendResult?.sent !== true) {
          console.log("[messenger-send-skipped]", {
            tenant_id: tenantId,
            conversation_id: message.external_conversation_id,
            channel,
            reason: sendResult?.skip_reason || (sendResult?.dedupe_skipped === true ? "outbound_dedupe_skipped" : "meta_send_not_sent"),
            sendMetaInboxOutboundMessage_called: true,
          });
        }
        results.push({ channel, external_customer_id: message.external_customer_id, conversation_id: message.external_conversation_id, sent: sendResult.sent });
        pushAIEvent({
          type: "MESSAGE_SENT",
          status: "success",
          conversationId: message.external_conversation_id,
          platform: channel,
        });
        console.log("ai_auto_reply_sent", {
          tenant_id: tenantId,
          conversation_id: message.external_conversation_id,
          channel,
          message_id: sendResult.message_id || "",
        });
        await logChannelEvent({
          tenantId,
          channel,
          direction: "outbound",
          externalCustomerId: message.external_customer_id,
          conversationId: message.external_conversation_id,
          messagePreview: replyText,
          status: sendResult.sent ? "sent" : "not_sent",
          metadata: { result_count: sendResult.results?.length || 0 },
        }).catch(() => {});
      } catch (error) {
        console.error("[ai-agent:meta] send failed", {
          tenantId,
          channel,
          to: message.external_customer_id,
          code: error?.code,
          status: error?.status,
          message: error?.message,
        });
        results.push({ channel, external_customer_id: message.external_customer_id, conversation_id: message.external_conversation_id, sent: false, send_error: error?.message || "Meta send failed" });
        pushAIEvent({
          type: "MESSAGE_SEND_FAILED",
          status: "error",
          conversationId: message.external_conversation_id,
          platform: channel,
          error: error?.message || "Unknown error",
        });
        await logChannelEvent({
          tenantId,
          channel,
          direction: "outbound",
          externalCustomerId: message.external_customer_id,
          conversationId: message.external_conversation_id,
          messagePreview: replyText,
          status: "failed",
          error: error?.message || "Meta send failed",
          metadata: { code: error?.code || "", status: error?.status || "" },
        }).catch(() => {});
      }
    }
    return res.status(200).json({ success: true, processed: results.length, results });
  } catch (error) {
    console.error("[ai-agent:meta] webhook error", { message: error?.message, stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined });
    return res.status(200).json({ success: false, message: "Meta webhook handled with errors" });
  }
});

router.get("/channels/status", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const status = await getAiChannelsStatus({ tenantId });
    const globalSettings = await getAISettings();
    const aiAgentSettings = await getAiAgentSettings({ tenantId }).catch(() => ({}));
    const [whatsappAISettings, instagramAISettings, facebookAISettings] = await Promise.all([
      getAIChannelSettings(AI_AGENT_CHANNELS.WHATSAPP, AI_AGENT_CHANNELS.WHATSAPP),
      getAIChannelSettings(AI_AGENT_CHANNELS.INSTAGRAM, AI_AGENT_CHANNELS.INSTAGRAM),
      getAIChannelSettings(AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, "facebook"),
    ]);
    const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 500 }).catch(() => ({ conversations: [] }));
    const hasHumanOverride = (channel) => (inbox.conversations || []).some((conversation) => {
      const source = envText(conversation.channel || conversation.source || conversation.source_channel).toLowerCase();
      return source === channel && conversation.conversation_status === "human_takeover";
    });
    const withResolvedStatus = (channel, data = {}, aiSettings = {}) => {
      const effectiveMode = globalSettings.autoReplyMode !== "fully_automatic"
        ? globalSettings.autoReplyMode
        : aiSettings.aiMode || "suggest_only";
      const assistantGlobalEnabled = aiAgentSettings.ai_assistant_global_enabled !== false;
      const effectiveTone = aiSettings.tone || globalSettings.tone || "casual";
      const whatsappProvider = envText(data.whatsapp_provider || data.provider).toLowerCase();
      const isEvolutionWhatsapp = channel === AI_AGENT_CHANNELS.WHATSAPP && whatsappProvider === "evolution";
      const isCloudWhatsapp = channel === AI_AGENT_CHANNELS.WHATSAPP && (whatsappProvider === "cloud" || whatsappProvider === "whatsapp_cloud");
      const tokenValid = isEvolutionWhatsapp
        ? data.token_valid === true
        : data.token_valid === true || (
          data.page_access_token_configured === true &&
          !["token_expired", "expired", "invalid", "revoked", "error"].includes(envText(data.token_status || data.token_health_status).toLowerCase())
        ) || (isCloudWhatsapp && data.access_token_configured === true);
      const webhookHealthy = data.webhook_healthy === true || data.live_operational === true || Boolean(data.last_webhook_received_at);
      const connected = data.connected === true || data.live_operational === true || (data.effective_enabled === true && tokenValid && webhookHealthy);
      const messagingActive = data.messaging_active === true || (connected && tokenValid);
      return {
        ...data,
        aiChannelSettings: aiSettings,
        effective_ai_mode: effectiveMode,
        effective_tone: effectiveTone,
        token_valid: tokenValid,
        token_status: tokenValid ? "active" : data.token_status,
        token_health_status: tokenValid ? "active" : data.token_health_status,
        webhook_healthy: webhookHealthy,
        connected,
        messaging_active: messagingActive,
        aiStatus: resolveAIStatus({
          connected,
          aiEnabled: assistantGlobalEnabled && effectiveMode === "fully_automatic",
          humanOverride: hasHumanOverride(channel),
          webhookHealthy,
          tokenValid,
        }),
        ai_assistant_global_enabled: assistantGlobalEnabled,
      };
    };
    return res.json({
      success: true,
      ai_assistant_global_enabled: aiAgentSettings.ai_assistant_global_enabled !== false,
      channels: {
        whatsapp: {
          ...withResolvedStatus(AI_AGENT_CHANNELS.WHATSAPP, status[AI_AGENT_CHANNELS.WHATSAPP], whatsappAISettings),
          webhook_url: whatsappWebhookUrl(req),
          verify_test_ready: status[AI_AGENT_CHANNELS.WHATSAPP].verify_token_configured,
        },
        instagram: {
          ...withResolvedStatus(AI_AGENT_CHANNELS.INSTAGRAM, status[AI_AGENT_CHANNELS.INSTAGRAM], instagramAISettings),
          webhook_url: metaWebhookUrl(req),
          verify_test_ready: status[AI_AGENT_CHANNELS.INSTAGRAM].verify_token_configured,
        },
        facebook_messenger: {
          ...withResolvedStatus(AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, status[AI_AGENT_CHANNELS.FACEBOOK_MESSENGER], facebookAISettings),
          webhook_url: metaWebhookUrl(req),
          verify_test_ready: status[AI_AGENT_CHANNELS.FACEBOOK_MESSENGER].verify_token_configured,
        },
      },
    });
  } catch (error) {
    return sendError(res, error, "Failed to load AI channel status");
  }
});

router.patch("/channels/:channel/settings", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const channel = req.params.channel === "facebook" ? AI_AGENT_CHANNELS.FACEBOOK_MESSENGER : req.params.channel;
    const settings = await updateChannelSettings({
      tenantId,
      channel,
      settings: {
        ai_replies_enabled: req.body?.ai_replies_enabled === true || req.body?.enabled === true,
        auto_reply_mode: req.body?.auto_reply_mode || req.body?.mode || "",
      },
    });
    const status = await getAiChannelsStatus({ tenantId });
    return res.json({ success: true, settings, channels: status });
  } catch (error) {
    return sendError(res, error, "Failed to update channel settings");
  }
});

router.get("/channels/:channelId/settings", protect, permit("settings", "view"), async (req, res) => {
  try {
    const channelId = envText(req.params.channelId === "facebook" ? AI_AGENT_CHANNELS.FACEBOOK_MESSENGER : req.params.channelId);
    const settings = await getAIChannelSettings(channelId, req.query?.platform || channelId);
    return res.json({ success: true, settings });
  } catch (error) {
    return sendError(res, error, "Failed to load AI channel settings");
  }
});

router.put("/channels/:channelId/settings", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const channelId = envText(req.params.channelId === "facebook" ? AI_AGENT_CHANNELS.FACEBOOK_MESSENGER : req.params.channelId);
    const settings = await updateAIChannelSettings(channelId, req.body || {});
    await updateChannelSettings({
      tenantId,
      channel: channelId,
      settings: {
        auto_reply_mode: settings.aiMode,
        ai_replies_enabled: settings.aiMode === "fully_automatic",
      },
    }).catch((error) => {
      console.warn("ai_channel_settings_legacy_sync_failed", {
        tenant_id: tenantId,
        channel: channelId,
        message: error?.message || "Legacy channel settings sync failed",
      });
    });
    const status = await getAiChannelsStatus({ tenantId });
    return res.json({ success: true, settings, channels: status });
  } catch (error) {
    return sendError(res, error, "Failed to update AI channel settings");
  }
});

router.patch("/channels/whatsapp/settings", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const settings = await updateChannelSettings({
      tenantId,
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      settings: {
        ai_replies_enabled: req.body?.ai_replies_enabled === true || req.body?.enabled === true,
        auto_reply_mode: req.body?.auto_reply_mode || req.body?.mode || "",
      },
    });
    const status = await getAiChannelsStatus({ tenantId });
    return res.json({ success: true, settings, whatsapp: { ...status[AI_AGENT_CHANNELS.WHATSAPP], webhook_url: whatsappWebhookUrl(req) } });
  } catch (error) {
    return sendError(res, error, "Failed to update WhatsApp channel settings");
  }
});

router.post("/channels/whatsapp/test-send", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const to = envText(req.body?.to || req.body?.phone || req.body?.external_customer_id);
  const message = envText(req.body?.message || "AI Agent WhatsApp test message.");
  try {
    if (!whatsappEnabled()) {
      throw Object.assign(new Error("WhatsApp is disabled by WHATSAPP_ENABLED=false"), { status: 409, code: "WHATSAPP_DISABLED" });
    }
    const result = await sendWhatsAppCloudReply({
      to,
      reply: { text: message, visual_attachments: [], product_cards: [], suggested_quick_replies: [] },
      messageText: message,
    });
    await logChannelEvent({
      tenantId,
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      direction: "outbound",
      externalCustomerId: to,
      conversationId: `whatsapp:${to}`,
      messagePreview: message,
      status: result.sent ? "test_sent" : "test_not_sent",
      metadata: { test: true, result_count: result.results?.length || 0 },
    }).catch(() => {});
    return res.json({
      success: result?.delivery_status === "sent",
      sent: result?.sent === true,
      delivery_status: result?.delivery_status || (result?.sent ? "sent" : "failed"),
      delivery_error: result?.delivery_error || "",
      result,
    });
  } catch (error) {
    await logChannelEvent({
      tenantId,
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      direction: "outbound",
      externalCustomerId: to,
      conversationId: to ? `whatsapp:${to}` : "",
      messagePreview: message,
      status: "test_failed",
      error: error?.message || "Test send failed",
      metadata: { test: true, code: error?.code || "", status: error?.status || "" },
    }).catch(() => {});
    return sendError(res, error, "Failed to send WhatsApp test message");
  }
});

router.post("/channels/:channel/test-send", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const channel = req.params.channel === "facebook" ? AI_AGENT_CHANNELS.FACEBOOK_MESSENGER : req.params.channel;
  const to = envText(req.body?.to || req.body?.external_customer_id);
  const message = envText(req.body?.message || "AI Agent channel test message.");
  try {
    if (channel === AI_AGENT_CHANNELS.WHATSAPP) {
      const result = await sendWhatsAppCloudReply({ to, reply: { text: message }, messageText: message });
      return res.json({
        success: result?.delivery_status === "sent",
        sent: result?.sent === true,
        delivery_status: result?.delivery_status || (result?.sent ? "sent" : "failed"),
        delivery_error: result?.delivery_error || "",
        result,
      });
    }
    if (![AI_AGENT_CHANNELS.INSTAGRAM, AI_AGENT_CHANNELS.FACEBOOK_MESSENGER].includes(channel)) {
      throw Object.assign(new Error("Unsupported channel"), { status: 400 });
    }
    if (!channelEnvEnabled(channel)) {
      throw Object.assign(new Error(`${channel} is disabled`), { status: 409, code: "META_CHANNEL_DISABLED" });
    }
    const result = await sendMetaPageReply({
      channel,
      to,
      reply: { text: message, visual_attachments: [], product_cards: [], suggested_quick_replies: [] },
      messageText: message,
    });
    await logChannelEvent({
      tenantId,
      channel,
      direction: "outbound",
      externalCustomerId: to,
      conversationId: `${channel}:${to}`,
      messagePreview: message,
      status: result.sent ? "test_sent" : "test_not_sent",
      metadata: { test: true, result_count: result.results?.length || 0 },
    }).catch(() => {});
    return res.json({ success: true, sent: result.sent, result });
  } catch (error) {
    await logChannelEvent({
      tenantId,
      channel,
      direction: "outbound",
      externalCustomerId: to,
      conversationId: to ? `${channel}:${to}` : "",
      messagePreview: message,
      status: "test_failed",
      error: error?.message || "Test send failed",
      metadata: { test: true, code: error?.code || "", status: error?.status || "" },
    }).catch(() => {});
    return sendError(res, error, "Failed to send channel test message");
  }
});

router.get("/inbox", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const inbox = await loadAiInbox({
      tenantId,
      filter: String(req.query?.filter || "all"),
      search: String(req.query?.search || ""),
      limit: req.query?.limit,
      messageLimit: req.query?.message_limit,
    });
    return res.json({ success: true, ...inbox });
  } catch (error) {
    return sendError(res, error, "Failed to load AI inbox");
  }
});

router.get("/conversations", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const inbox = await loadAiInbox({
      tenantId,
      filter: String(req.query?.filter || "all"),
      search: String(req.query?.search || ""),
      limit: req.query?.limit,
      messageLimit: req.query?.message_limit,
      summaryOnly: true,
    });
    return res.json({ success: true, ...inbox });
  } catch (error) {
    return sendError(res, error, "Failed to load AI inbox conversations");
  }
});

router.get("/debug-ping", (req, res) => {
  return res.json({ ok: true, version: "ai-debug-v1" });
});

router.get("/conversations/:conversationId/messages", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = decodeRouteId(req.params.conversationId);
    const payload = await loadAiInboxMessages({
      tenantId,
      conversationId,
      limit: req.query?.limit || 30,
      before: req.query?.before || "",
      beforeId: req.query?.before_id || req.query?.beforeId || "",
    });
    return res.json({ success: true, conversation_id: conversationId, ...payload });
  } catch (error) {
    return sendError(res, error, "Failed to load AI inbox messages");
  }
});

router.get("/social-comments/recent", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 50) || 50));
    console.log("[social-comments] recent request", {
      tenant_id: tenantId,
      user_id: req.user?.id ?? req.user?.user_id ?? null,
      user_role: req.user?.role ?? req.user?.userType ?? null,
      limit,
    });
    const rows = await listRecentSocialCommentAutomationRuns({ tenantId, limit });
    console.log("[social-comments] recent response", {
      tenant_id: tenantId,
      user_id: req.user?.id ?? req.user?.user_id ?? null,
      user_role: req.user?.role ?? req.user?.userType ?? null,
      rows_count: rows.length,
    });
    return res.json({
      success: true,
      items: rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        channel: row.channel,
        post_id: row.post_id,
        post_permalink: row.post_permalink,
        comment_id: row.comment_id,
        commenter_name: row.commenter_name,
        original_comment_text: row.original_comment_text,
        classification_label: row.classification_label,
        classification_score: row.classification_score,
        action_taken: row.action_taken,
        created_at: row.created_at,
        raw_payload: row.raw_payload,
      })),
      total: rows.length,
    });
  } catch (error) {
    return sendError(res, error, "Failed to load recent social comment automation runs");
  }
});

router.post("/comments/:commentId/reply", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const commentId = decodeRouteId(req.params.commentId);
  const replyText = envText(req.body?.reply_text || req.body?.replyText || req.body?.message || "");
  if (!tenantId || !commentId) {
    return sendError(res, Object.assign(new Error("tenant_id and commentId are required"), { status: 400 }), "tenant_id and commentId are required");
  }
  if (!replyText) {
    return sendError(res, Object.assign(new Error("reply_text is required"), { status: 400 }), "reply_text is required");
  }

  const commentRun = await resolveSocialCommentReplyTarget({ tenantId, commentId });
  if (!commentRun) {
    return sendError(res, Object.assign(new Error(`Comment not found for tenant ${tenantId}: ${commentId}`), { status: 404, code: "SOCIAL_COMMENT_NOT_FOUND" }), "Comment not found");
  }

  const platform = envText(commentRun.platform || (commentRun.channel === "instagram_comment" ? "instagram" : "facebook")).toLowerCase().includes("instagram")
    ? "instagram"
    : "facebook";
  const sessionId = envText(commentRun.inbox_conversation_id || `social_comment:${platform}:${commentRun.root_comment_id || commentRun.comment_id}`);
  const replyChannel = envText(commentRun.channel || `${platform}_comment`) || `${platform}_comment`;
  const nowIso = new Date().toISOString();

  try {
    const metaReply = await replyToComment(platform, commentRun.comment_id, replyText, tenantId);
    const externalReplyId = envText(metaReply?.id || metaReply?.comment_id || metaReply?.reply_id || "");
    const message = await appendManualAiSupportReply({
      tenantId,
      sessionId,
      message: replyText,
      messageType: "comment_public_reply",
      staffUserId: req.user?.id || null,
      staffUserName: userDisplayName(req.user),
      source: "ai_inbox_comment_reply",
      channel: replyChannel,
      deliveryStatus: "sent",
      deliveryError: "",
      externalMessageId: externalReplyId,
      externalReplyId,
    });

    await db.query(
      `
      UPDATE social_comment_automation_runs
      SET inbox_conversation_id = COALESCE(NULLIF(inbox_conversation_id, ''), $4::text),
          public_reply_status = 'sent',
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1::bigint AND platform = $2::text AND comment_id = $3::text
      `,
      [tenantId, commentRun.platform || platform, commentRun.comment_id, sessionId]
    ).catch(() => {});

    emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: sessionId, message, at: nowIso });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: sessionId, at: nowIso });

    return res.status(201).json({
      success: true,
      sent: true,
      delivery_status: "sent",
      external_reply_id: externalReplyId,
      comment_id: commentRun.comment_id,
      message,
      reply: metaReply || null,
    });
  } catch (error) {
    const errorMessage = error?.message || "Meta public reply failed";
    const failureCode = !error?.status || /fetch failed|network|timeout|ENOTFOUND|ECONNREFUSED/i.test(errorMessage)
      ? "transport_failed"
      : "meta_reply_failed";
    let failedMessage = null;
    try {
      failedMessage = await appendManualAiSupportReply({
        tenantId,
        sessionId,
        message: replyText,
        messageType: "comment_public_reply",
        staffUserId: req.user?.id || null,
        staffUserName: userDisplayName(req.user),
        source: "ai_inbox_comment_reply",
        channel: replyChannel,
        deliveryStatus: "failed",
        deliveryError: errorMessage,
        externalMessageId: "",
        externalReplyId: "",
      });
    } catch (persistError) {
      console.error("[ai-inbox][comment-reply] failed to persist transcript", {
        tenant_id: tenantId,
        comment_id: commentRun.comment_id,
        platform,
        message: persistError?.message || "",
      });
      failedMessage = {
        message_type: "comment_public_reply",
        sender_type: "staff",
        staff_message: replyText,
        delivery_status: "failed",
        delivery_error: errorMessage,
        created_at: nowIso,
      };
    }

    await db.query(
      `
      UPDATE social_comment_automation_runs
      SET inbox_conversation_id = COALESCE(NULLIF(inbox_conversation_id, ''), $5::text),
          public_reply_status = 'failed',
          error_code = COALESCE(NULLIF($4::text, ''), error_code),
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1::bigint AND platform = $2::text AND comment_id = $3::text
      `,
      [tenantId, commentRun.platform || platform, commentRun.comment_id, failureCode, sessionId]
    ).catch(() => {});

    emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: sessionId, message: failedMessage, at: nowIso });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: sessionId, at: nowIso });

    console.error("[ai-inbox][comment-reply] failed", {
      tenant_id: tenantId,
      comment_id: commentRun.comment_id,
      platform,
      code: error?.code || "",
      message: errorMessage,
    });
    return res.status(error?.status || 502).json({
      success: false,
      delivery_status: "failed",
      message: errorMessage,
      code: failureCode,
      comment_id: commentRun.comment_id,
      reply_text: replyText,
    });
  }
});

router.post("/inbox/:conversationId/private-message", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  const rawMessageText = String(req.body?.message ?? req.body?.reply ?? req.body?.text ?? "");
  const messageText = envText(rawMessageText);
  if (!tenantId || !conversationId) {
    return sendError(res, Object.assign(new Error("tenant_id and conversationId are required"), { status: 400 }), "tenant_id and conversationId are required");
  }
  if (!messageText) {
    return sendError(res, Object.assign(new Error("message is required"), { status: 400 }), "message is required");
  }

  const conversation = await loadLeadConversationForAction({ tenantId, conversationId });
  if (!conversation) {
    return sendError(res, Object.assign(new Error(`Conversation not found for tenant ${tenantId}: ${conversationId}`), { status: 404, code: "AI_INBOX_CONVERSATION_NOT_FOUND" }), "Conversation not found");
  }

  const channel = envText(conversation.channel || conversation.source || "");
  const channelMetadata = conversation.channel_metadata || {};
  const isCommentThread = channel.includes("comment") || Boolean(
    conversation.external_comment_id ||
      conversation.comment_id ||
      channelMetadata.comment_id ||
      channelMetadata.lead?.comment_id
  );
  const nowIso = new Date().toISOString();

  try {
    if (isCommentThread) {
      const commentId = envText(
        channelMetadata.comment_id ||
          channelMetadata.lead?.comment_id ||
          conversation.external_comment_id ||
          conversation.comment_id ||
          ""
      );
      if (!commentId) {
        throw Object.assign(new Error("Comment thread is missing a comment id"), { status: 409, code: "COMMENT_ID_MISSING" });
      }
      const platform = channel.includes("instagram") ? "instagram" : "facebook";
      const reply = await sendPrivateReply(platform, commentId, messageText, tenantId);
      const message = await appendManualAiSupportReply({
        tenantId,
        sessionId: conversationId,
        message: messageText,
        messageType: "comment_private_reply",
        staffUserId: req.user?.id || null,
        staffUserName: userDisplayName(req.user),
        source: "ai_inbox_private_message",
        channel: `${platform}_comment`,
        deliveryStatus: "sent",
        deliveryError: "",
        externalMessageId: envText(reply?.id || reply?.message_id || reply?.reply_id || ""),
        externalReplyId: envText(reply?.id || reply?.message_id || reply?.reply_id || ""),
      });

      await db.query(
        `
        UPDATE social_comment_automation_runs
        SET dm_status = 'sent',
            inbox_conversation_id = COALESCE(NULLIF(inbox_conversation_id, ''), $3::text),
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1::bigint
          AND comment_id = $2::text
        `,
        [tenantId, commentId, conversationId]
      ).catch(() => {});

      emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message, at: nowIso });
      emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: nowIso });
      return res.status(201).json({
        success: true,
        sent: true,
        delivery_status: "sent",
        message,
        reply,
      });
    }

    const recipientId = envText(
      channelMetadata.customer_psid ||
        channelMetadata.sender_psid ||
        channelMetadata.resolved_customer_id ||
        conversation.external_customer_id ||
        conversation.customer_id ||
        ""
    );
    if (!recipientId) {
      throw Object.assign(new Error("Conversation has no recipient id"), { status: 409, code: "META_RECIPIENT_MISSING" });
    }

    const sendResult = await sendMetaInboxOutboundMessage({
      tenantId,
      channel,
      recipientId,
      messageText,
      conversationId,
      facebookPageId: channelMetadata.page_id || channelMetadata.facebook_page_id || "",
      instagramBusinessAccountId: channelMetadata.instagram_business_account_id || channelMetadata.instagram_account_id || "",
      replySource: "ai_inbox_private_message",
      replyOwner: "ai_inbox_private_message",
    });

    const message = await appendManualAiSupportReply({
      tenantId,
      sessionId: conversationId,
      message: messageText,
      staffUserId: req.user?.id || null,
      staffUserName: userDisplayName(req.user),
      source: "ai_inbox_private_message",
      channel,
      deliveryStatus: "sent",
      deliveryError: "",
      externalMessageId: sendResult.message_id || "",
      externalReplyId: sendResult.message_id || "",
    });

    await upsertChannelConversationMapping({
      tenantId,
      channel,
      externalConversationId: conversationId,
      externalCustomerId: recipientId,
      customerName: conversation.customer_name || conversation.customer_profile?.name || "",
      customerAvatarUrl: conversation.customer_avatar_url || conversation.customer_profile?.avatar_url || "",
      customerProfileId: conversation.customer_profile?.id || conversation.profile_id || null,
      metadata: {
        ...(channelMetadata || {}),
        source: "ai_inbox_private_message",
        last_private_message_at: nowIso,
      },
      lastMessage: messageText,
      lastMessageAt: nowIso,
    }).catch(() => {});

    emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message, at: nowIso });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: nowIso });
    return res.status(201).json({
      success: true,
      sent: true,
      delivery_status: "sent",
      message,
      meta: sendResult.meta || null,
    });
  } catch (error) {
    const errorMessage = error?.message || "Failed to send private message";
    const failureCode = error?.code || error?.publicCode || error?.response?.data?.code || error?.response?.data?.error_code || (!error?.status || /fetch failed|network|timeout|ENOTFOUND|ECONNREFUSED/i.test(errorMessage)
      ? "transport_failed"
      : "private_message_failed");
    let failedMessage = null;

    try {
      failedMessage = await appendManualAiSupportReply({
        tenantId,
        sessionId: conversationId,
        message: rawMessageText,
        messageType: "private_message",
        staffUserId: req.user?.id || null,
        staffUserName: userDisplayName(req.user),
        source: "ai_inbox_private_message",
        channel,
        deliveryStatus: "failed",
        deliveryError: errorMessage,
        errorCode: failureCode,
        externalMessageId: "",
        externalReplyId: "",
        preserveExactMessage: true,
        upsertSession: false,
      });
    } catch (persistError) {
      console.error("[ai-inbox][private-message] failed to persist transcript", {
        tenant_id: tenantId,
        conversation_id: conversationId,
        channel,
        message: persistError?.message || "",
      });
    }

    if (failedMessage) {
      emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message: failedMessage, at: nowIso });
      emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: nowIso });
    }

    console.error("[ai-inbox][private-message] failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      channel,
      code: error?.code || "",
      message: errorMessage,
    });
    return res.status(error?.status || 502).json({
      success: false,
      delivery_status: "failed",
      delivery_error: errorMessage,
      message: errorMessage,
      code: failureCode,
      error_code: failureCode,
      conversation_id: conversationId,
      attempted_message: rawMessageText,
    });
  }
});

router.get("/conversations/:conversationId/ai-debug", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = decodeRouteId(req.params.conversationId);
    const payload = await getAiInboxConversationDebug({
      tenantId,
      conversationId,
      channel: req.query?.channel || "",
    });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return sendError(res, error, "Failed to load AI debug metadata");
  }
});

router.get("/conversations/:conversationId/ai-trace", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = decodeRouteId(req.params.conversationId);
    const payload = await loadAiReplyTraces({
      tenantId,
      conversationId,
      sessionId: conversationId,
      channel: req.query?.channel || "whatsapp",
      limit: req.query?.limit || 10,
    });
    return res.json({ success: true, conversation_id: conversationId, ...payload });
  } catch (error) {
    return sendError(res, error, "Failed to load AI reply trace");
  }
});

router.post("/conversations/:conversationId/reset-ai-state", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = decodeRouteId(req.params.conversationId);
    if (!tenantId || !conversationId) {
      return res.status(400).json({ success: false, message: "tenant_id and conversation_id are required" });
    }

    const preferenceKeys = [
      "pending_product_search_context",
      "last_ai_question",
      "last_bot_message",
      "last_clarification_type",
      "last_clarification_expected_values",
      "awaiting_customer_action",
      "sales_engine_state",
      "sales_engine_previous_state",
      "sales_engine_reason",
      "sales_engine_next_action",
      "sales_engine_missing_info",
      "currentRequestedModel",
      "currentRequestedModelName",
      "last_product",
      "last_product_id",
      "last_product_name",
      "last_model_family",
      "lastProductCard",
      "last_product_cards",
      "lastRecommendedProductIds",
      "last_recommended_product_ids",
      "lastVisualQuery",
      "lastVisualFeatures",
      "lastVisualMatches",
      "rejectedProductIds",
      "rejectedModelNames",
      "rejectedVisualMatches",
      "selected_product_context",
    ];

    const memoryBefore = getConversationMemory(conversationId);
    clearConversationMemory(conversationId);

    const dbResult = await db.query(
      `
      UPDATE ai_conversation_memories
      SET preferences = COALESCE(preferences, '{}'::jsonb) - $3::text[], updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1 AND session_id = $2
      RETURNING id
      `,
      [tenantId, conversationId, preferenceKeys]
    );

    return res.json({
      success: true,
      conversation_id: conversationId,
      cleared_keys: preferenceKeys,
      runtime_memory_cleared: true,
      persisted_rows_updated: dbResult.rowCount || 0,
      memory_found: Boolean(memoryBefore),
    });
  } catch (error) {
    return sendError(res, error, "Failed to reset conversation AI state");
  }
});

router.post("/conversations/:conversationId/sync-messenger-profile", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = decodeRouteId(req.params.conversationId);
  try {
    const result = await syncMessengerProfileForConversation({
      tenantId,
      conversationId,
      externalCustomerId: req.body?.external_customer_id || req.body?.psid || "",
    });
    const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 1000, messageLimit: 30 });
    const conversation = (inbox.conversations || []).find((item) => item.session_id === conversationId) || null;
    return res.json({ success: true, ...result, conversation });
  } catch (error) {
    return sendError(res, error, "Could not fetch Messenger profile");
  }
});

router.post("/conversations/:conversationId/debug-messenger-profile", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = decodeRouteId(req.params.conversationId);
  try {
    const result = await debugMessengerProfileForConversation({
      tenantId,
      conversationId,
      externalCustomerId: req.body?.external_customer_id || req.body?.psid || "",
    });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, "Could not debug Messenger profile");
  }
});

router.get("/conversations/:conversationId/debug-messenger-profile", protect, permit("settings", "view"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = decodeRouteId(req.params.conversationId);
  try {
    const result = await debugMessengerProfileForConversation({
      tenantId,
      conversationId,
      externalCustomerId: req.query?.external_customer_id || req.query?.psid || "",
    });
    const responseBody = {
      resolved_psid: result.resolved_psid || "",
      resolved_page_id: result.resolved_page_id || "",
      config_id: result.config_id || null,
      token_found: result.token_found === true,
      graph_status: result.graph_status || 200,
      graph_error: result.graph_error || null,
      raw_graph_response: result.raw_graph_response || null,
      first_name: result.first_name || "",
      last_name: result.last_name || "",
      profile_pic: result.profile_pic || "",
      avatar_missing_from_meta_response: result.avatar_missing_from_meta_response === true,
      ai_customer_profiles_profile_pic_url: result.stored_ai_customer_profiles_profile_pic_url || result.stored_profile_pic_url || "",
      ai_support_sessions_customer_avatar_url: result.stored_ai_support_sessions_customer_avatar_url || "",
      ai_channel_conversations_customer_avatar_url: result.stored_ai_channel_conversations_customer_avatar_url || "",
    };
    console.log("messenger_profile_debug_get_response", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      response: responseBody,
    });
    return res.json(responseBody);
  } catch (error) {
    if (error?.debugProfile) {
      console.error("messenger_profile_debug_graph_failed", {
        tenant_id: tenantId,
        conversation_id: conversationId,
        ...error.debugProfile,
      });
      return res.status(500).json({
        success: false,
        message: error.message || "Meta Graph profile request failed",
        ...error.debugProfile,
      });
    }
    return sendError(res, error, "Could not debug Messenger profile");
  }
});

router.get("/conversations/:conversationId/recommendations", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const recommendations = await loadAiInboxRecommendations({
      tenantId,
      conversationId: req.params.conversationId,
      limit: req.query?.limit,
    });
    return res.json({ success: true, ...recommendations });
  } catch (error) {
    return sendError(res, error, "Failed to load AI recommendations");
  }
});

const handleMarkConversationRead = async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const rawConversationId = envText(req.params.conversationId);
    const conversationId = decodeRouteId(rawConversationId);
    const channel = req.body?.channel || req.query?.channel || "";
    if (!conversationId) {
      return res.status(200).json({
        success: true,
        queued: false,
        conversation: null,
        message: "conversation id missing",
      });
    }

    void Promise.resolve()
      .then(() => markAiSupportConversationRead({
        tenantId,
        sessionId: conversationId,
        channel,
      }))
      .then((conversation) => {
        console.log("[ai-inbox][mark-read] background success", {
          tenant_id: tenantId,
          conversation_id: conversationId,
          channel,
          read_at: conversation?.read_at || "",
          read_updated: conversation?.read_updated === true,
        });
      })
      .catch((error) => {
        console.warn("[ai-inbox][mark-read] background failure", {
          tenant_id: tenantId,
          raw_conversation_id: rawConversationId,
          decoded_conversation_id: conversationId,
          channel,
          code: error?.code || "",
          message: error?.message || "",
        });
      });

    return res.status(200).json({
      success: true,
      queued: true,
      conversation: {
        session_id: conversationId,
        channel,
        read_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.warn("[ai-inbox][mark-read] best-effort fallback", {
      tenant_id: toTenantId(req),
      raw_conversation_id: envText(req.params.conversationId),
      decoded_conversation_id: decodeRouteId(req.params.conversationId),
      channel: req.body?.channel || req.query?.channel || "",
      code: error?.code || "",
      message: error?.message || "",
      stack: error?.stack || "",
    });
    return res.status(200).json({
      success: true,
      queued: false,
      conversation: null,
      message: "mark-as-read is best-effort",
    });
  }
};

router.post("/conversations/:conversationId/read", protect, permit("settings", "edit"), handleMarkConversationRead);
router.post("/inbox/:conversationId/read", protect, permit("settings", "edit"), handleMarkConversationRead);

router.get("/conversations/:conversationId/sales-closer", protect, permit("settings", "view"), async (req, res) => {
  const tenantId = toTenantId(req);
  const rawRouteId = envText(req.params.conversationId);
  const conversationId = decodeRouteId(rawRouteId);
  const lookupKeys = buildAiSalesCloserLookupKeys(rawRouteId);
  try {
    perfLog("ai_sales_closer_request", {
      tenant_id: tenantId,
      raw_route_id: rawRouteId,
      decoded_route_id: conversationId,
      sales_closer_lookup_keys: lookupKeys,
      original_url: req.originalUrl || req.url,
    });
    const plan = await buildAiSalesCloserPlan({
      tenantId,
      conversationId: rawRouteId,
    });
    console.log("ai_sales_closer_session_lookup", {
      tenant_id: tenantId,
      raw_route_id: rawRouteId,
      decoded_route_id: conversationId,
      sales_closer_lookup_keys: lookupKeys,
      found: Boolean(plan.conversation),
      matched_session_id: plan.conversation?.session_id || "",
      matched_external_conversation_id: plan.conversation?.external_conversation_id || "",
      matched_external_customer_id: plan.conversation?.external_customer_id ? "***" : "",
      channel: plan.conversation?.channel || plan.conversation?.source || "",
      products: plan.products?.length || 0,
    });
    console.log("ai_sales_closer_response", {
      tenant_id: tenantId,
      conversation_id: plan.conversation_id || conversationId,
      lead: plan.lead?.label || "",
      score: plan.lead?.score || 0,
    });
    return res.json({ success: true, ...plan });
  } catch (error) {
    console.error("ai_sales_closer_response", {
      tenant_id: tenantId,
      raw_route_id: rawRouteId,
      decoded_route_id: conversationId,
      sales_closer_lookup_keys: error?.lookup_keys || lookupKeys,
      status: error?.status || 500,
      code: error?.code || "",
      message: error?.message || "Failed to load AI sales closer plan",
    });
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Failed to load AI sales closer plan",
      code: error?.code || "",
      raw_route_id: rawRouteId,
      decoded_route_id: conversationId,
      sales_closer_lookup_keys: error?.lookup_keys || lookupKeys,
    });
  }
});

const buildDraftOrderPaymentActions = ({ conversation = {}, order = {}, product = {} } = {}) => {
  const orderNumber = envText(order.public_order_number || order.invoice_number || order.id);
  const productName = envText(product.name || product.title || product.product_name || "selected product");
  const amount = Number(order.total_amount || order.total_price || order.total || 0);
  const invoicePath = order.id ? `/orders/${order.id}` : "";
  return [
    {
      key: "send_payment_link",
      label: "Send payment link",
      message: `تمام، ده لينك الدفع للطلب ${orderNumber}: ${invoicePath}`,
      enabled: Boolean(invoicePath),
    },
    {
      key: "cash_on_delivery",
      label: "Cash on delivery",
      message: `تمام، ممكن الدفع عند الاستلام. هجهزلك ${productName}${amount ? ` بإجمالي ${amount} جنيه` : ""}.`,
      enabled: true,
    },
    {
      key: "whatsapp_checkout",
      label: "WhatsApp checkout",
      message: `أقدر أكمّل معاك على واتساب لتأكيد الطلب ${orderNumber}. ابعت رقم الموبايل والعنوان لو مناسب.`,
      enabled: true,
    },
    {
      key: "public_invoice",
      label: "Public invoice",
      message: `فاتورة الطلب ${orderNumber}: ${invoicePath}`,
      enabled: Boolean(invoicePath),
    },
  ];
};

const normalizeSelectedProductCard = (card = {}) => {
  const safeSize = envText(
    card.size ||
      card.selected_size ||
      card.variant_size ||
      card.variant?.size ||
      card.variant?.size_name ||
      card.variant?.variant_size ||
      (Array.isArray(card.sizes) ? card.sizes[0] : "") ||
      ""
  );
  const safePrice = Number(card.price ?? card.final_price ?? card.sale_price ?? card.selling_price ?? card.variant?.price ?? card.variant?.final_price ?? 0);
  const productName = envText(
    card.product_name ||
      card.name ||
      card.title ||
      card.display_name ||
      card.label ||
      card.product?.name ||
      card.product?.title ||
      card.product?.product_name ||
      ""
  );
  const imageUrl = envText(
    card.image_url ||
      card.product_image_url ||
      card.variant_image_url ||
      card.image ||
      card.thumbnail_url ||
      card.media_url ||
      card.main_image ||
      card.color_image ||
      card.color_image_url ||
      card.selected_card_image_url ||
      card.variant?.image_url ||
      card.variant?.variant_image_url ||
      ""
  );
  const productId = envText(card.product_id || card.productId || card.id || card.product?.id || card.product?.product_id || "");
  const variantId = envText(card.variant_id || card.variantId || card.selected_variant_id || card.matched_variant_id || card.variant?.id || card.variant?.variant_id || "");
  const color = envText(card.color || card.display_color || card.variant_color || card.matched_variant_color || card.variant?.color || card.variant?.color_name || card.variant?.variant_color || "");
  const explicitUrl = envText(
    card.storefront_url ||
      card.product_url ||
      card.url ||
      card.share_url ||
      card.shareUrl ||
      card.product?.storefront_url ||
      card.product?.product_url ||
      card.product?.url ||
      ""
  );
  const slug = envText(card.slug || card.canonical_slug || card.product_slug || card.product?.slug || card.product?.canonical_slug || card.product?.product_slug || "");
  const storefrontUrl = explicitUrl || (productId ? `/shop/product/${encodeURIComponent(productId)}` : slug ? `/shop/product/${encodeURIComponent(slug)}` : "");
  return {
    ...card,
    product_id: productId,
    variant_id: variantId,
    product_name: productName,
    name: productName,
    title: productName,
    display_name: productName,
    label: productName,
    image_url: imageUrl,
    product_image_url: envText(card.product_image_url || card.product?.image_url || imageUrl),
    variant_image_url: envText(card.variant_image_url || card.variant?.image_url || card.variant?.variant_image_url || ""),
    thumbnail_url: envText(card.thumbnail_url || imageUrl),
    media_url: envText(card.media_url || card.mediaUrl || ""),
    price: Number.isFinite(safePrice) && safePrice > 0 ? safePrice : null,
    color,
    size: safeSize,
    storefront_url: storefrontUrl,
    product_url: storefrontUrl,
    url: storefrontUrl,
    share_url: envText(card.share_url || card.shareUrl || ""),
  };
};

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

const firstCardImageValue = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstCardImageValue(...value);
      if (nested) return nested;
      continue;
    }
    if (value && typeof value === "object") {
      const nested = firstCardImageValue(
        value.secure_url,
        value.cloudinary_url,
        value.image_url,
        value.main_image,
        value.variant_image,
        value.variant_image_url,
        value.color_image,
        value.color_image_url,
        value.thumbnail_url,
        value.media_url,
        value.url,
        value.path,
        value.src,
        value.preview,
        value.image
      );
      if (nested) return nested;
      continue;
    }
    const safe = envText(value);
    if (safe) return safe;
  }
  return "";
};

const resolveProductCardImageUrl = (product = {}, variant = {}) =>
  firstCardImageValue(
    variant.image_url,
    variant.variant_image_url,
    variant.color_image_url,
    variant.primary_image_url,
    variant.thumbnail_url,
    variant.media_url,
    product.image_url,
    product.image,
    product.main_image,
    product.thumbnail,
    product.product_image_url,
    product.variant_image_url,
    product.color_image_url,
    product.product_images,
    product.images
  );

const resolveProductCardUrl = (card = {}, productContext = null, product = {}) => {
  const explicitUrl = envText(card.storefront_url || card.product_url || card.url || card.share_url || card.shareUrl || "");
  if (explicitUrl) return explicitUrl;
  const contextUrl = envText(productContext?.productUrl || productContext?.product_url || "");
  if (contextUrl) return contextUrl;
  const productSlug = envText(product.slug || product.canonical_slug || product.product_slug || card.slug || card.canonical_slug || card.product_slug || "");
  const productId = envText(product.id || product.product_id || card.product_id || card.id || "");
  if (productSlug) return `/shop/product/${encodeURIComponent(productSlug)}`;
  if (productId) return `/shop/product/${encodeURIComponent(productId)}`;
  return "";
};

const enrichSelectedProductCard = async ({ tenantId = null, card = {} } = {}) => {
  const normalizedCard = normalizeSelectedProductCard(card);
  const hasLookupKey = Boolean(normalizedCard.product_id || normalizedCard.variant_id || normalizedCard.slug);
  if (!hasLookupKey) return normalizedCard;

  const safeTenantId = Number.isFinite(Number(tenantId)) ? Number(tenantId) : null;
  const productId = parsePositiveInt(normalizedCard.product_id);
  const variantId = parsePositiveInt(normalizedCard.variant_id);
  const slug = envText(normalizedCard.slug || normalizedCard.canonical_slug || normalizedCard.product_slug || "");

  try {
    let productRow = null;
    let variantRow = null;

    if (variantId) {
      const variantQuery = `
        SELECT *
        FROM product_variants
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND id = $2::bigint
        LIMIT 1
      `;
      const variantResult = await db.query(variantQuery, [safeTenantId, variantId]).catch(() => ({ rows: [] }));
      variantRow = variantResult.rows?.[0] || null;
    }

    if (!productRow && productId) {
      const productQuery = `
        SELECT *
        FROM products
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND id = $2::bigint
        LIMIT 1
      `;
      const productResult = await db.query(productQuery, [safeTenantId, productId]).catch(() => ({ rows: [] }));
      productRow = productResult.rows?.[0] || null;
    }

    if (!productRow && slug) {
      const slugQuery = `
        SELECT *
        FROM products
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND (
            LOWER(TRIM(COALESCE(slug, ''))) = LOWER(TRIM($2::text))
            OR LOWER(TRIM(COALESCE(canonical_slug, ''))) = LOWER(TRIM($2::text))
            OR LOWER(TRIM(COALESCE(product_slug, ''))) = LOWER(TRIM($2::text))
          )
        LIMIT 1
      `;
      const slugResult = await db.query(slugQuery, [safeTenantId, slug]).catch(() => ({ rows: [] }));
      productRow = slugResult.rows?.[0] || null;
    }

    if (!productRow && variantRow?.product_id) {
      const variantProductId = parsePositiveInt(variantRow.product_id);
      if (variantProductId) {
        const productResult = await db.query(
          `
            SELECT *
            FROM products
            WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
              AND id = $2::bigint
            LIMIT 1
          `,
          [safeTenantId, variantProductId]
        ).catch(() => ({ rows: [] }));
        productRow = productResult.rows?.[0] || null;
      }
    }

    if (!variantRow && productRow?.id) {
      const fallbackVariantResult = await db.query(
        `
          SELECT *
          FROM product_variants
          WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
            AND product_id = $2::bigint
          ORDER BY id ASC
          LIMIT 1
        `,
        [safeTenantId, Number(productRow.id)]
      ).catch(() => ({ rows: [] }));
      variantRow = fallbackVariantResult.rows?.[0] || null;
    }

    if (!productRow && !variantRow) {
      console.warn("[ai-inbox][product-card-send] product card lookup missed", {
        tenant_id: tenantId,
        product_id: normalizedCard.product_id || "",
        variant_id: normalizedCard.variant_id || "",
        slug,
      });
      return normalizedCard;
    }

    const productContext = productRow ? buildProductContext(productRow) : null;
    const productName = envText(
      normalizedCard.product_name ||
        normalizedCard.name ||
        normalizedCard.title ||
        normalizedCard.display_name ||
        normalizedCard.label ||
        productContext?.name ||
        productRow?.name ||
        productRow?.title ||
        productRow?.product_name ||
        variantRow?.product_name ||
        variantRow?.name ||
        variantRow?.title ||
        ""
    );
    const productImageUrl = resolveProductCardImageUrl(productRow || {}, variantRow || {});
    const imageUrl = envText(normalizedCard.image_url || normalizedCard.product_image_url || normalizedCard.variant_image_url || productImageUrl || productContext?.imageUrl || "");
    const variantPrice = Number(
      variantRow?.display_price ??
        variantRow?.final_price ??
        variantRow?.sale_price ??
        variantRow?.selling_price ??
        variantRow?.price ??
        0
    );
    const productPrice = Number(
      productContext?.price ??
        productRow?.display_price ??
        productRow?.final_price ??
        productRow?.sale_price ??
        productRow?.selling_price ??
        productRow?.price ??
        productRow?.product_price ??
        0
    );
    const resolvedPrice = Number(normalizedCard.price || 0) > 0 ? Number(normalizedCard.price) : (Number.isFinite(variantPrice) && variantPrice > 0 ? variantPrice : productPrice);
    const color = envText(
      normalizedCard.color ||
        variantRow?.color ||
        variantRow?.color_name ||
        variantRow?.variant_color ||
        variantRow?.display_color ||
        ""
    );
    const size = envText(
      normalizedCard.size ||
        variantRow?.size ||
        variantRow?.size_name ||
        variantRow?.variant_size ||
        variantRow?.display_size ||
        ""
    );
    const resolvedUrl = resolveProductCardUrl(normalizedCard, productContext, productRow || {});
    const slugValue = envText(
      normalizedCard.slug ||
        normalizedCard.canonical_slug ||
        normalizedCard.product_slug ||
        productRow?.slug ||
        productRow?.canonical_slug ||
        productRow?.product_slug ||
        ""
    );

    return {
      ...normalizedCard,
      product_id: normalizedCard.product_id || envText(productRow?.id || variantRow?.product_id || ""),
      variant_id: normalizedCard.variant_id || envText(variantRow?.id || ""),
      slug: slugValue,
      canonical_slug: envText(normalizedCard.canonical_slug || productRow?.canonical_slug || ""),
      product_slug: envText(normalizedCard.product_slug || productRow?.product_slug || ""),
      product_name: productName,
      name: productName,
      title: productName,
      display_name: productName,
      label: normalizedCard.label || productName,
      image_url: imageUrl,
      image: imageUrl,
      product_image_url: envText(normalizedCard.product_image_url || productImageUrl || imageUrl),
      variant_image_url: envText(normalizedCard.variant_image_url || resolveProductCardImageUrl({}, variantRow || {})),
      thumbnail_url: envText(normalizedCard.thumbnail_url || imageUrl || productImageUrl || ""),
      media_url: envText(normalizedCard.media_url || normalizedCard.mediaUrl || variantRow?.media_url || ""),
      price: Number.isFinite(resolvedPrice) && resolvedPrice > 0 ? resolvedPrice : null,
      color,
      size,
      storefront_url: resolvedUrl,
      product_url: resolvedUrl,
      url: resolvedUrl,
      share_url: envText(normalizedCard.share_url || normalizedCard.shareUrl || resolvedUrl),
      product: normalizedCard.product || productRow || {},
      variant: normalizedCard.variant || variantRow || null,
    };
  } catch (error) {
    console.warn("[ai-inbox][product-card-send] product card enrichment warning", {
      tenant_id: tenantId,
      product_id: normalizedCard.product_id || "",
      variant_id: normalizedCard.variant_id || "",
      slug,
      message: error?.message || "lookup_failed",
    });
    return normalizedCard;
  }
};

const formatProductCardPreviewText = (card = {}) => {
  const name = envText(card.product_name || card.name || card.title || "");
  const price = Number(card.price || 0) > 0 ? `EGP ${Number(card.price).toFixed(2)}` : "";
  return [name, price].filter(Boolean).join(" / ");
};

const buildProductCardFallbackText = (cards = []) =>
  cards
    .map((card, index) =>
      productCardReplyText({
        name: card.product_name || card.name || card.title || `Product ${index + 1}`,
        color: card.color || "",
        available_sizes: card.size ? [card.size] : [],
        sizes: card.size ? [card.size] : [],
        price: card.price || 0,
        product_url: card.storefront_url || card.product_url || card.url || "",
      })
    )
    .filter(Boolean)
    .join("\n\n");

const normalizeProductCardSendChannel = (value = "") => {
  const channel = envText(value).toLowerCase();
  if (!channel) return "";
  if (channel === "facebook" || channel === "facebook_messenger" || channel === "messenger") return AI_AGENT_CHANNELS.FACEBOOK_MESSENGER;
  if (channel === "instagram" || channel === "instagram_dm") return AI_AGENT_CHANNELS.INSTAGRAM;
  if (channel === "whatsapp") return AI_AGENT_CHANNELS.WHATSAPP;
  if (channel === "web" || channel === "web_chat") return AI_AGENT_CHANNELS.WEB_CHAT;
  return channel;
};

const isWhatsAppStoredOnlyIssue = (error = {}) => {
  const code = envText(error?.code || "");
  if ([
    "WHATSAPP_CONFIG_MISSING",
    "WHATSAPP_DISABLED",
    "WHATSAPP_RECIPIENT_REQUIRED",
    "WHATSAPP_PHONE_REQUIRED",
    "WHATSAPP_LID_UNRESOLVED",
    "EVOLUTION_API_URL_MISSING",
    "EVOLUTION_API_KEY_MISSING",
    "EVOLUTION_INSTANCE_MISSING",
    "WHATSAPP_PROVIDER_UNSUPPORTED",
  ].includes(code)) {
    return true;
  }
  const message = envText(error?.message || "");
  return /whatsapp.*(credential|config|token|phone number id|disabled|missing)/i.test(message);
};

let aiChannelConversationHasConversationKeyPromise = null;
const hasAiChannelConversationKeyColumn = async () => {
  if (aiChannelConversationHasConversationKeyPromise) return aiChannelConversationHasConversationKeyPromise;
  aiChannelConversationHasConversationKeyPromise = db
    .query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ai_channel_conversations'
        AND column_name = 'conversation_key'
      LIMIT 1
    `)
    .then((result) => result.rows.length > 0)
    .catch(() => false);
  return aiChannelConversationHasConversationKeyPromise;
};

const resolveProductCardSendConversation = async ({ tenantId, conversationId }) => {
  const safeTenantId = Number(tenantId);
  const safeConversationId = envText(conversationId);
  const hasConversationKeyColumn = await hasAiChannelConversationKeyColumn();
  const lookupFields = [
    "ai_support_sessions.session_id",
    "ai_channel_conversations.external_conversation_id",
    "ai_channel_conversations.external_customer_id",
    ...(hasConversationKeyColumn ? ["ai_channel_conversations.conversation_key"] : []),
  ];

  const sessionResult = await db.query(
    `
    SELECT *
    FROM ai_support_sessions
    WHERE tenant_id = $1
      AND session_id = $2
    LIMIT 1
    `,
    [safeTenantId, safeConversationId]
  );
  let sessionRow = sessionResult.rows[0] || null;

  const channelQuery = `
    SELECT *
    FROM ai_channel_conversations
    WHERE tenant_id = $1
      AND (
        external_conversation_id = $2
        OR external_customer_id = $2
        ${hasConversationKeyColumn ? "OR conversation_key = $2" : ""}
      )
    ORDER BY
      CASE
        WHEN external_conversation_id = $2 THEN 0
        WHEN external_customer_id = $2 THEN 1
        ${hasConversationKeyColumn ? "WHEN conversation_key = $2 THEN 2" : ""}
        ELSE 3
      END,
      updated_at DESC,
      id DESC
    LIMIT 1
  `;
  const channelResult = await db.query(channelQuery, [safeTenantId, safeConversationId]);
  const channelRow = channelResult.rows[0] || null;

  if (!sessionRow && channelRow?.external_conversation_id) {
    const linkedSession = await db.query(
      `
      SELECT *
      FROM ai_support_sessions
      WHERE tenant_id = $1
        AND session_id = $2
      LIMIT 1
      `,
      [safeTenantId, channelRow.external_conversation_id]
    );
    sessionRow = linkedSession.rows[0] || null;
  }

  const conversation = sessionRow || channelRow
    ? {
        ...(sessionRow || {}),
        ...(channelRow || {}),
        session_id: sessionRow?.session_id || channelRow?.external_conversation_id || safeConversationId,
        channel: channelRow?.channel || sessionRow?.channel || sessionRow?.source || channelRow?.source || "",
        source: sessionRow?.source || channelRow?.channel || channelRow?.source || "",
        external_conversation_id: channelRow?.external_conversation_id || sessionRow?.session_id || safeConversationId,
        external_customer_id: channelRow?.external_customer_id || sessionRow?.external_customer_id || "",
        customer_name: channelRow?.customer_name || sessionRow?.customer_name || sessionRow?.session_customer_name || "",
        customer_avatar_url: channelRow?.customer_avatar_url || sessionRow?.customer_avatar_url || sessionRow?.session_customer_avatar_url || "",
        channel_metadata: channelRow?.metadata || sessionRow?.channel_metadata || {},
      }
    : null;

  return { conversation, lookupFields, hasConversationKeyColumn };
};

router.post("/conversations/:conversationId/create-draft-order", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  try {
    console.log("ai_sales_closer_draft_start", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      requested_product_id: req.body?.product_id || req.body?.product?.id || req.body?.product?.product_id || null,
    });
    const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 1000 });
    const conversation = inbox.conversations.find((item) =>
      item.session_id === conversationId ||
      item.external_conversation_id === conversationId ||
      item.external_customer_id === conversationId
    );
    if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
    const recommendations = await loadAiInboxRecommendations({ tenantId, conversationId: conversation.session_id, limit: 8 });
    const latestCustomerMessage = [...(conversation.messages || [])].reverse().find((message) => envText(message.customer_message || message.message_text))?.customer_message ||
      conversation.latest_message_preview ||
      conversation.last_message ||
      "";
    const requestedProductId = Number(req.body?.product_id || req.body?.product?.product_id || req.body?.product?.id || 0);
    const selectedProduct =
      (requestedProductId
        ? recommendations.products.find((product) => Number(product.product_id || product.id) === requestedProductId)
        : null) ||
      req.body?.product ||
      recommendations.products.find((product) => Number(product.total_stock ?? product.stock ?? 0) > 0) ||
      recommendations.products[0] ||
      null;
    if (!selectedProduct) {
      throw Object.assign(new Error("No matched product is available for this conversation yet."), {
        status: 409,
        code: "NO_MATCHED_PRODUCT",
      });
    }
    const intent = parseAiSalesCloserIntent({
      message: latestCustomerMessage,
      products: recommendations.products,
      conversation,
    });
    const productId = Number(selectedProduct.product_id || selectedProduct.id);
    const orderProducts = await searchAiOrderProducts({
      tenantId,
      message: latestCustomerMessage || selectedProduct.name || selectedProduct.title,
      metadata: {
        product_id: productId,
        matched_product_id: productId,
        matched_product_name: selectedProduct.name || selectedProduct.title || "",
      },
    });
    const orderProduct = orderProducts[0];
    if (!orderProduct) {
      throw Object.assign(new Error("Matched product could not be resolved in ERP inventory."), {
        status: 409,
        code: "ERP_PRODUCT_NOT_FOUND",
      });
    }
    const result = await createAiOrderDraft({
      tenant_id: tenantId,
      conversation_id: conversation.session_id,
      session_id: conversation.session_id,
      channel: conversation.channel || conversation.source || "facebook_messenger",
      customer_name: conversation.customer_name || conversation.first_name || "Meta customer",
      customer_phone: req.body?.customer_phone || conversation.customer_profile?.phone || conversation.external_customer_id || "",
      external_customer_id: conversation.external_customer_id || "",
      original_customer_message: latestCustomerMessage,
      message: latestCustomerMessage || selectedProduct.name || selectedProduct.title,
      product: orderProduct,
      quantity: req.body?.quantity || intent.quantity || 1,
      size: req.body?.size || intent.size || "",
      color: req.body?.color || intent.color || "",
      allow_missing_phone: true,
      metadata: {
        source: "ai_inbox_sales_closer",
        channel: conversation.channel || conversation.source || "",
        external_customer_id: conversation.external_customer_id || "",
        selected_product_id: productId,
        selected_product_name: selectedProduct.name || selectedProduct.title || "",
        sales_intent: intent,
        allow_missing_phone: true,
      },
      notes: "AI Sales Closer draft from live Meta inbox",
    });
    let reservation = null;
    if (req.body?.reserve !== false) {
      reservation = await createAiStockReservation({
        tenantId,
        conversationId: conversation.session_id,
        orderId: result.order?.id || null,
        productId: result.product?.id || productId,
        variantId: result.variant?.id || null,
        quantity: req.body?.quantity || intent.quantity || 1,
        minutes: req.body?.reserve_minutes || 20,
        metadata: {
          source: "ai_inbox_sales_closer",
          order_number: result.order?.public_order_number || result.order?.invoice_number || "",
          sales_intent: intent,
        },
      });
    }
    const paymentActions = buildDraftOrderPaymentActions({
      conversation,
      order: result.order || {},
      product: result.product || selectedProduct,
    });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversation.session_id,
      reason: "draft_order_created",
      at: new Date().toISOString(),
    });
    console.log("ai_sales_closer_draft_success", {
      tenant_id: tenantId,
      conversation_id: conversation.session_id,
      order_id: result.order?.id || null,
      product_id: result.product?.id || productId,
      variant_id: result.variant?.id || null,
      reserved: Boolean(reservation),
    });
    return res.status(201).json({
      success: true,
      ...result,
      conversation_id: conversation.session_id,
      sales_intent: intent,
      reservation,
      payment_actions: paymentActions,
    });
  } catch (error) {
    console.error("ai_sales_closer_draft_failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      code: error?.code || "",
      message: error?.message || "Failed to create sales closer draft",
    });
    return sendError(res, error, "Failed to create AI sales closer draft order");
  }
});

router.post("/conversations/:conversationId/ai-reply", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await generateAiInboxReply({
      tenantId,
      conversationId: req.params.conversationId,
      persist: req.body?.persist === true || req.body?.send === true,
    });
    const aiReplyDraft = normalizeAiReplyDraft(result.ai_reply_draft || result.draft || result.suggestion || {});
    return res.status(result.message ? 201 : 200).json({
      success: true,
      ...result,
      draft: aiReplyDraft,
      ai_reply_draft: aiReplyDraft,
      suggestion: aiReplyDraft,
    });
  } catch (error) {
    return sendError(res, error, "Failed to generate AI reply");
  }
});

router.get("/conversations/:conversationId/ai-harness", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = envText(req.params.conversationId);
    const cached = getLastReplyHarnessDebug({ tenantId, conversationId });
    if (cached) {
      return res.json({ success: true, harness: cached, cached: true });
    }

    const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 100, messageLimit: 12, summaryOnly: false });
    const conversation = (inbox.conversations || []).find((item) =>
      item.session_id === conversationId ||
      item.conversation_id === conversationId ||
      item.external_conversation_id === conversationId ||
      item.external_customer_id === conversationId ||
      item.conversation_key === conversationId
    ) || null;
    const latestMessage = conversation?.customer_message || conversation?.message_text || conversation?.latest_message_preview || conversation?.last_message || "";
    const harness = await buildReplyHarness({
      tenantId,
      conversationId,
      conversation,
      latestCustomerMessage: latestMessage,
      sendMode: "debug",
      channel: conversation?.channel || conversation?.source || "web_chat",
      req,
    });
    return res.json({ success: true, harness, cached: false });
  } catch (error) {
    return sendError(res, error, "Failed to load AI harness");
  }
});

router.get("/conversations/:conversationId/ai-validation", protect, permit("settings", "view"), async (req, res) => {
  try {
    if (!isSuperAdminUser(req.user)) {
      return sendError(res, Object.assign(new Error("Admin access required"), { status: 403, code: "FORBIDDEN" }), "Admin access required");
    }

    const tenantId = toTenantId(req);
    const conversationId = envText(req.params.conversationId);
    const snapshot = await loadAiReplyDebugSnapshot({ tenantId, conversationId, req, includeHarness: true });
    if (!snapshot) {
      return sendError(res, Object.assign(new Error("Conversation not found"), { status: 404, code: "AI_CONVERSATION_NOT_FOUND" }), "Conversation not found");
    }
    const { conversation, draft: lastDraft, harness } = snapshot;
    const draftText = resolveDraftText(lastDraft, conversation);
    const { validateAiReply } = await import("../services/aiReplyValidatorService.js");
    const validation = await validateAiReply({
      replyText: draftText,
      harness,
    }).catch((error) => ({
      is_valid: true,
      confidence: 0,
      violations: [],
      warnings: [`validateAiReply failed: ${error?.message || String(error)}`],
      suggested_action: "keep_draft",
    }));

    return res.json({
      success: true,
      conversation_id: conversationId,
      harness_summary: {
        tenant_id: harness?.tenant_id || tenantId,
        conversation_id: harness?.conversation_id || conversationId,
        channel: harness?.channel || conversation?.channel || conversation?.source || "",
        send_mode: harness?.send_mode || "",
        latest_customer_message: harness?.latest_customer_message || "",
        trace: harness?.trace || null,
        safety_context: harness?.safety_context || null,
        business_context: harness?.business_context || null,
      },
      tool_context: harness?.tool_context || null,
      validation,
      violations: validation?.violations || [],
      warnings: validation?.warnings || [],
      draft: lastDraft,
    });
  } catch (error) {
    return sendError(res, error, "Failed to load AI validation debug data");
  }
});

router.get("/conversations/:conversationId/ai-confidence", protect, permit("settings", "view"), async (req, res) => {
  try {
    if (!isSuperAdminUser(req.user)) {
      return sendError(res, Object.assign(new Error("Admin access required"), { status: 403, code: "FORBIDDEN" }), "Admin access required");
    }

    const tenantId = toTenantId(req);
    const conversationId = envText(req.params.conversationId);
    const snapshot = await loadAiReplyDebugSnapshot({ tenantId, conversationId, req, includeHarness: true });
    if (!snapshot) {
      return sendError(res, Object.assign(new Error("Conversation not found"), { status: 404, code: "AI_CONVERSATION_NOT_FOUND" }), "Conversation not found");
    }
    const { conversation, draft: lastDraft, harness } = snapshot;
    const draftText = resolveDraftText(lastDraft, conversation);
    const { validateAiReply } = await import("../services/aiReplyValidatorService.js");
    const { buildAiConfidenceEngine } = await import("../services/aiConfidenceEngineService.js");
    const validation = await validateAiReply({
      replyText: draftText,
      harness,
    }).catch((error) => ({
      is_valid: true,
      confidence: 0,
      violations: [],
      warnings: [`validateAiReply failed: ${error?.message || String(error)}`],
      suggested_action: "keep_draft",
    }));
    const confidenceEngine = await buildAiConfidenceEngine({
      harness,
      tool_context: harness?.tool_context || null,
      validation,
      draft: {
        text: draftText,
        detected_intent: lastDraft.detected_intent || "",
        customer_question: lastDraft.customer_question || conversation?.customer_message || "",
        validation,
      },
      correction_context: harness?.correction_context || null,
    }).catch((error) => ({
      confidence_score: 50,
      confidence_level: "medium",
      decision: "review",
      reasons: [`buildAiConfidenceEngine failed: ${error?.message || String(error)}`],
      risk_flags: { engine_error: true },
    }));

    return res.json({
      success: true,
      conversation_id: conversationId,
      harness_summary: {
        tenant_id: harness?.tenant_id || tenantId,
        conversation_id: harness?.conversation_id || conversationId,
        channel: harness?.channel || conversation?.channel || conversation?.source || "",
        send_mode: harness?.send_mode || "",
        latest_customer_message: harness?.latest_customer_message || "",
        trace: harness?.trace || null,
      },
      validation,
      confidence_engine: confidenceEngine,
      tool_context: harness?.tool_context || null,
      draft: lastDraft,
    });
  } catch (error) {
    return sendError(res, error, "Failed to load AI confidence data");
  }
});

router.get("/conversations/:conversationId/ai-pipeline-debug", protect, permit("settings", "view"), async (req, res) => {
  try {
    if (!isSuperAdminUser(req.user)) {
      return sendError(res, Object.assign(new Error("Admin access required"), { status: 403, code: "FORBIDDEN" }), "Admin access required");
    }

    const tenantId = toTenantId(req);
    const conversationId = envText(req.params.conversationId);
    const cached = getLastAiPipelineDebug({ tenantId, conversationId });
    if (cached) {
      return res.json({
        success: true,
        cached: true,
        conversation_id: conversationId,
        pipeline_debug: cached,
        harness_summary: cached.harness_summary || null,
        auto_reply_shadow: cached.auto_reply_shadow || null,
        audit_report: {
          repeated_db_reads: Boolean(cached.duplicate_work?.repeated_db_reads),
          repeated_correction_lookup: Boolean(cached.duplicate_work?.repeated_correction_lookup),
          repeated_product_lookup: Boolean(cached.duplicate_work?.repeated_product_lookup),
          oversized_harness: Boolean(cached.memory?.oversized_harness),
          oversized_prompt: Boolean(cached.memory?.oversized_prompt),
          duplicate_context_blocks: Boolean(cached.memory?.duplicate_context_blocks),
        },
        optimization_report: cached.optimization_report || null,
      });
    }

    const snapshot = await loadAiReplyDebugSnapshot({ tenantId, conversationId, req, includeHarness: false });
    if (!snapshot) {
      return sendError(res, Object.assign(new Error("Conversation not found"), { status: 404, code: "AI_CONVERSATION_NOT_FOUND" }), "Conversation not found");
    }
    const { conversation, draft, harness } = snapshot;
    const persistedPipelineDebug = normalizePipelineDebugSnapshot(draft.pipeline_debug || draft.metadata?.pipeline_debug || null);
    const draftText = resolveDraftText(draft, conversation);
    return res.json({
      success: true,
      cached: false,
      conversation_id: conversationId,
      pipeline_debug: persistedPipelineDebug || {
        auto_reply_shadow: draft.metadata?.auto_reply_shadow || null,
      },
      reason: "no_generation_cache",
      harness_summary: harness ? {
        tenant_id: harness.tenant_id || tenantId,
        conversation_id: harness.conversation_id || conversationId,
        channel: harness.channel || conversation?.channel || conversation?.source || "",
        send_mode: harness.send_mode || "",
        latest_customer_message: harness.latest_customer_message || draft.customer_question || draftText || "",
        trace: harness.trace || null,
      } : {
        tenant_id: Number(tenantId) || null,
        conversation_id: conversationId,
        channel: conversation?.channel || conversation?.source || "",
        send_mode: "debug",
        latest_customer_message: draft.customer_question || draftText || conversation?.last_message || "",
        trace: {
          harness_version: "fallback_no_cache",
          sources_used: [],
          corrections_count: 0,
          products_loaded: Array.isArray(draft.product_cards) ? draft.product_cards.length : 0,
          tool_warnings_count: 0,
          tools_ms: 0,
          harness_ms: 0,
        },
      },
      current_draft: draft,
      last_ai_reply_draft: draft,
      auto_reply_shadow: draft.metadata?.auto_reply_shadow || persistedPipelineDebug?.auto_reply_shadow || null,
      latest_validation: draft.validation || conversation?.last_ai_reply_draft?.validation || null,
      latest_confidence: draft.confidence_engine || conversation?.last_ai_reply_draft?.confidence_engine || null,
      audit_report: {
        message: persistedPipelineDebug
          ? "No cached pipeline debug found; using persisted draft snapshot."
          : "No cached pipeline debug found. Generate an AI reply to populate timings and audit signals.",
        repeated_db_reads: persistedPipelineDebug?.duplicate_work?.repeated_db_reads ?? null,
        repeated_correction_lookup: persistedPipelineDebug?.duplicate_work?.repeated_correction_lookup ?? null,
        repeated_product_lookup: persistedPipelineDebug?.duplicate_work?.repeated_product_lookup ?? null,
        oversized_harness: persistedPipelineDebug?.memory?.oversized_harness ?? null,
        oversized_prompt: persistedPipelineDebug?.memory?.oversized_prompt ?? null,
        duplicate_context_blocks: persistedPipelineDebug?.memory?.duplicate_context_blocks ?? null,
      },
      optimization_report: persistedPipelineDebug?.optimization_report || null,
    });
  } catch (error) {
    return sendError(res, error, "Failed to load AI pipeline debug data");
  }
});

router.post("/conversations/:conversationId/messages/:messageId/correction", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = envText(req.params.conversationId);
    const messageId = envText(req.params.messageId);
    if (!conversationId || !messageId) {
      return sendError(res, Object.assign(new Error("conversationId and messageId are required"), { status: 400 }), "conversationId and messageId are required");
    }

    const explicitCustomerQuestion = envText(req.body?.customer_question || req.body?.customerQuestion);
    const explicitAiWrongAnswer = envText(req.body?.ai_wrong_answer || req.body?.aiWrongAnswer);
    const explicitEmployeeCorrectAnswer = envText(req.body?.employee_correct_answer || req.body?.employeeCorrectAnswer);
    const explicitProductIdRaw = req.body?.product_id ?? req.body?.productId ?? null;
    const explicitChannel = envText(req.body?.channel || req.body?.source || "");
    const explicitMetadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    const messagesPayload = await loadAiInboxMessages({ tenantId, conversationId, limit: 100 }).catch(() => ({ messages: [] }));
    const messages = Array.isArray(messagesPayload.messages) ? messagesPayload.messages : [];
    const messageIndex = messages.findIndex((item) => correctionMessageLookupKey(item) === messageId || text(item?.id) === messageId);
    const sourceMessage = messageIndex >= 0 ? messages[messageIndex] : null;

    const customerQuestion =
      explicitCustomerQuestion ||
      messageQuestionText(messages, messageIndex, sourceMessage?.customer_message || sourceMessage?.message_text || "");
    const aiWrongAnswer =
      explicitAiWrongAnswer ||
      envText(sourceMessage?.ai_answer || sourceMessage?.staff_message || "");
    const employeeCorrectAnswer = explicitEmployeeCorrectAnswer;
    const correctionType = normalizeCorrectionType(req.body?.correction_type || req.body?.correctionType || "other");
    const productIdRaw = explicitProductIdRaw ?? sourceMessage?.clicked_product_id ?? sourceMessage?.suggested_products?.[0]?.id ?? null;
    const productId = Number.isFinite(Number(productIdRaw)) && Number(productIdRaw) > 0 ? Number(productIdRaw) : null;
    if (!customerQuestion || !aiWrongAnswer || !employeeCorrectAnswer) {
      return sendError(
        res,
        Object.assign(new Error("customer_question, ai_wrong_answer, and employee_correct_answer are required"), { status: 400, code: "EMPTY_CORRECTION" }),
        "customer_question, ai_wrong_answer, and employee_correct_answer are required"
      );
    }

    const correction = await createCorrection({
      tenantId,
      conversationId,
      messageId,
      customerQuestion,
      aiWrongAnswer,
      employeeCorrectAnswer,
      correctionType,
      productId,
      channel: explicitChannel || envText(sourceMessage?.channel || sourceMessage?.source || ""),
      createdBy: req.user?.id || null,
      metadata: {
        ...explicitMetadata,
        source_message_id: sourceMessage?.id || messageId,
        source_sender_type: sourceMessage?.sender_type || "",
        source_message_type: sourceMessage?.message_type || "",
        conversation_status: sourceMessage?.resolution_status || "",
        lookup_fallback_used: !sourceMessage,
      },
    });

    return res.status(201).json({ success: true, correction });
  } catch (error) {
    return sendError(res, error, "Failed to save correction");
  }
});

router.get("/conversations/:conversationId/corrections", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = envText(req.params.conversationId);
    const corrections = await listConversationCorrections({
      tenantId,
      conversationId,
      limit: req.query?.limit || 50,
    });
    return res.json({ success: true, corrections });
  } catch (error) {
    return sendError(res, error, "Failed to load corrections");
  }
});

router.get("/corrections/search", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const query = envText(req.query?.q || req.query?.query || "");
    const corrections = await searchRelevantCorrections({
      tenantId,
      query,
      productId: req.query?.product_id ?? req.query?.productId ?? null,
      correctionType: req.query?.correction_type || req.query?.correctionType || "",
      limit: req.query?.limit || 3,
    });
    return res.json({ success: true, corrections });
  } catch (error) {
    return sendError(res, error, "Failed to search corrections");
  }
});

router.post("/conversations/:conversationId/reply", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const message = await appendManualAiSupportReply({
      tenantId,
      sessionId: req.params.conversationId,
      clientRequestId: requestClientRequestId(req),
      message: req.body?.message || req.body?.reply || "",
      staffUserId: req.user?.id || null,
      staffUserName: userDisplayName(req.user),
    });
    return res.status(201).json({ success: true, message, delivery_status: "internal_note" });
  } catch (error) {
    return sendError(res, error, "Failed to save AI inbox reply");
  }
});

router.post("/conversations/:conversationId/send", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  const messageText = envText(req.body?.message || req.body?.reply || req.body?.text);
  let conversation = null;
  try {
    perfLog("ai_inbox_send_start", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      message_length: messageText.length,
    });
    console.info("[ai-inbox:send-route]", {
      stage: "load_ai_inbox_start",
      tenant_id: tenantId,
      conversation_id: conversationId,
      message_length: messageText.length,
    });
    const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 1000 });
    console.info("[ai-inbox:send-route]", {
      stage: "load_ai_inbox_done",
      tenant_id: tenantId,
      conversation_id: conversationId,
      loaded_count: inbox.conversations.length,
    });
    conversation = inbox.conversations.find((item) =>
      item.session_id === conversationId ||
      item.external_conversation_id === conversationId ||
      item.external_customer_id === conversationId
    ) || null;
    perfLog("ai_inbox_send_session_lookup", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      found: Boolean(conversation),
      loaded_count: inbox.conversations.length,
      matched_session_id: conversation?.session_id || "",
      channel: conversation?.channel || conversation?.source || "",
      recipient_id: conversation?.external_customer_id ? "***" : "",
    });
    if (!conversation) {
      throw Object.assign(new Error(`Conversation not found for tenant ${tenantId}: ${conversationId}`), {
        status: 404,
        code: "AI_INBOX_CONVERSATION_NOT_FOUND",
      });
    }
    const channel = conversation.channel || conversation.source || "";
    const normalizedChannel = normalizeProductCardSendChannel(channel);
    const channelMetadata = conversation.channel_metadata || {};
    const aiReplyDraft = normalizeAiReplyDraft(conversation.last_ai_reply_draft || {});
    const recipientId = envText(
      channelMetadata.customer_psid ||
        channelMetadata.sender_psid ||
        channelMetadata.resolved_customer_id ||
        conversation.external_customer_id ||
        conversation.customer_id
    );
    const isWhatsAppConversation = normalizedChannel === AI_AGENT_CHANNELS.WHATSAPP;
    const isMetaConversation = normalizedChannel === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER || normalizedChannel === AI_AGENT_CHANNELS.INSTAGRAM;
    if (!isWhatsAppConversation && !isMetaConversation) {
      throw Object.assign(new Error("Live sending is only available for WhatsApp, Messenger, and Instagram DM conversations."), {
        status: 409,
        code: "CHANNEL_SEND_UNAVAILABLE",
      });
    }
    if (!recipientId) {
      if (isWhatsAppConversation) {
        const message = await appendManualAiSupportReply({
          tenantId,
          sessionId: conversationId,
          clientRequestId: requestClientRequestId(req),
          message: messageText,
          staffUserId: req.user?.id || null,
          staffUserName: userDisplayName(req.user),
          source: conversation?.channel || conversation?.source || "admin_console",
          channel: conversation?.channel || conversation?.source || "whatsapp",
          deliveryStatus: "stored_only",
          deliveryError: "WhatsApp recipient is missing",
        });
        emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message, at: new Date().toISOString() });
        emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: new Date().toISOString() });
        return res.status(200).json({
          success: true,
          sent: false,
          delivery_status: "stored_only",
          delivery_error: "WhatsApp recipient is missing",
          message,
          reason: "whatsapp_recipient_missing",
        });
      }
      throw Object.assign(new Error("Conversation has no Meta recipient id."), { status: 409, code: "META_RECIPIENT_MISSING" });
    }

    let sendResult = null;
    let deliveryStatus = "sent";
    let deliveryError = "";
    if (isWhatsAppConversation) {
      sendResult = await sendWhatsAppCloudReply({
        to: recipientId,
        reply: { text: messageText },
        messageText,
      });
      deliveryStatus = sendResult?.delivery_status || (sendResult?.sent ? "sent" : "failed");
      if (deliveryStatus === "stored_only") {
        deliveryError = sendResult?.delivery_error || "WhatsApp configuration is missing";
        const message = await appendManualAiSupportReply({
          tenantId,
          sessionId: conversationId,
          clientRequestId: requestClientRequestId(req),
          message: messageText,
          staffUserId: req.user?.id || null,
          staffUserName: userDisplayName(req.user),
          source: conversation?.channel || conversation?.source || "admin_console",
          channel: conversation?.channel || conversation?.source || "whatsapp",
          deliveryStatus: "stored_only",
          deliveryError,
        });
        emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message, at: new Date().toISOString() });
        emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: new Date().toISOString() });
        return res.status(200).json({
          success: true,
          sent: false,
          delivery_status: "stored_only",
          delivery_error: deliveryError,
          message,
          reason: sendResult?.transport ? `whatsapp_${sendResult.transport}_stored_only` : "whatsapp_stored_only",
        });
      }
    } else {
      sendResult = await sendMetaInboxOutboundMessage({
        tenantId,
        channel,
        recipientId,
        messageText,
        conversationId,
        facebookPageId: channelMetadata.page_id || channelMetadata.facebook_page_id || "",
        instagramBusinessAccountId: channelMetadata.instagram_business_account_id || channelMetadata.instagram_account_id || "",
      });
    }
    deliveryStatus = sendResult?.delivery_status || (sendResult?.sent ? "sent" : "failed");
    if (deliveryStatus === "failed" && !deliveryError) {
      deliveryError = sendResult?.delivery_error || sendResult?.message || "Message was not delivered";
    }
    const message = await appendManualAiSupportReply({
      tenantId,
      sessionId: conversationId,
      clientRequestId: requestClientRequestId(req),
      message: messageText,
      staffUserId: req.user?.id || null,
      staffUserName: userDisplayName(req.user),
      source: channel,
      channel,
      deliveryStatus,
      deliveryError,
      externalMessageId: sendResult?.message_id || sendResult?.results?.[0]?.result?.key?.id || "",
      providerMessageId: sendResult?.message_id || sendResult?.results?.[0]?.result?.key?.id || "",
      whatsappInstance: sendResult?.instanceName || sendResult?.instance || "",
      remoteJid: recipientId || "",
      resolvedReplyJid: recipientId || "",
      resolvedPhone: recipientId || "",
    });
    if (deliveryStatus === "sent") {
      if (aiReplyDraft.status === "not_sent" && aiReplyDraft.text && envText(aiReplyDraft.text) !== messageText) {
        const customerQuestion = [...(Array.isArray(conversation.messages) ? conversation.messages : [])]
          .reverse()
          .find((item) => envText(item.customer_message || item.message_text || item.last_message || ""));
        const correctionType = normalizeCorrectionType(
          aiReplyDraft.metadata?.correction_type ||
            inferCorrectionTypeFromEditedSuggestion(aiReplyDraft.text, messageText)
        );
        await createCorrection({
          tenantId,
          conversationId,
          messageId: message.id || sendResult?.message_id || sendResult?.results?.[0]?.result?.key?.id || `sent_${Date.now()}`,
          customerQuestion: envText(customerQuestion?.customer_message || customerQuestion?.message_text || customerQuestion?.last_message || conversation.latest_message_preview || conversation.last_message || ""),
          aiWrongAnswer: aiReplyDraft.text,
          employeeCorrectAnswer: messageText,
          correctionType,
          productId: aiReplyDraft.metadata?.product_id || null,
          channel,
          createdBy: req.user?.id || null,
          metadata: {
            source: "edited_ai_suggestion",
            original_suggestion_id: aiReplyDraft.id || "",
            original_suggestion_status: aiReplyDraft.status || "not_sent",
            sent_message_id: message.id || sendResult?.message_id || sendResult?.results?.[0]?.result?.key?.id || "",
            suggested_message_type: aiReplyDraft.message_type || "text",
            sent_message_type: "text",
            conversation_id: conversationId,
            channel,
          },
        }).catch((error) => {
          console.error("[ai-inbox][auto-correction] failed", {
            tenant_id: tenantId,
            conversation_id: conversationId,
            message_id: message.id || "",
            code: error?.code || "",
            message: error?.message || "",
          });
        });
      }
      await clearAiReplySuggestionDraft({ tenantId, sessionId: conversationId }).catch(() => {});
    }
    await logChannelEvent({
      tenantId,
      channel,
      direction: "outbound",
      externalCustomerId: recipientId,
      conversationId,
      messagePreview: messageText,
      status: deliveryStatus === "sent" ? "sent" : deliveryStatus === "stored_only" ? "stored" : "failed",
      metadata: {
        meta_message_id: sendResult?.message_id || sendResult?.results?.[0]?.result?.key?.id || "",
        config_id: sendResult?.config_id || null,
        source: "ai_inbox_send",
        channel_type: isWhatsAppConversation ? "whatsapp" : "meta",
      },
    }).catch(() => {});
    await upsertChannelConversationMapping({
      tenantId,
      channel,
      externalConversationId: conversationId,
      externalCustomerId: recipientId,
      customerName: conversation.customer_name || "",
      metadata: { channel, source: "ai_inbox_send" },
      lastMessage: messageText,
      lastMessageAt: new Date().toISOString(),
    }).catch(() => {});
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message, at: new Date().toISOString() });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: new Date().toISOString() });
    perfLog("ai_inbox_send_success", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      session_id: conversation.session_id || "",
      channel,
      message_id: sendResult.message_id || "",
    });
    pushAIEvent({
      type: "MESSAGE_SENT",
      status: "success",
      conversationId,
      platform: channel,
    });
    return res.status(200).json({
      success: true,
      sent: deliveryStatus === "sent",
      delivery_status: deliveryStatus,
      message,
      delivery_error: deliveryError,
      meta: sendResult.meta || null,
    });
  } catch (error) {
    pushAIEvent({
      type: "MESSAGE_SEND_FAILED",
      status: "error",
      conversationId,
      platform: conversation?.channel || conversation?.source || "",
      error: error?.message || "Unknown error",
    });
    let failedMessage = null;
    if (tenantId && conversationId && messageText) {
      failedMessage = await appendManualAiSupportReply({
        tenantId,
        sessionId: conversationId,
        clientRequestId: requestClientRequestId(req),
        message: messageText,
        staffUserId: req.user?.id || null,
        staffUserName: userDisplayName(req.user),
        source: conversation?.channel || conversation?.source || "admin_console",
        channel: conversation?.channel || conversation?.source || "",
        deliveryStatus: "failed",
        deliveryError: error?.message || "Meta send failed",
      }).catch(() => null);
      if (failedMessage) {
        emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message: failedMessage, at: new Date().toISOString() });
        emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: new Date().toISOString() });
      }
    }
    await logChannelEvent({
      tenantId,
      channel: conversation?.channel || conversation?.source || AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
      direction: "outbound",
      externalCustomerId: conversation?.external_customer_id || "",
      conversationId,
      messagePreview: messageText,
      status: "failed",
      error: error?.message || "Meta send failed",
      metadata: { code: error?.code || "", status: error?.status || "", source: "ai_inbox_send" },
    }).catch(() => {});
    console.error("ai_inbox_send_failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      found: Boolean(conversation),
      status: error?.status || 500,
      code: error?.code || "",
      message: error?.message || "Meta send failed",
      meta_error: error?.metaResponse?.error || null,
      response_body: error?.responseBody || error?.sendResult?.results?.[0] || null,
    });
    return res.status(error?.status || 502).json({
      success: false,
      delivery_status: "failed",
      delivery_error: error?.message || "Failed to send message",
      message: error?.message || "Failed to send message",
      code: error?.code || "",
      error_code: error?.code || "",
      conversation_id: conversationId,
    });
  }
});

router.post("/conversations/:conversationId/product-card/send", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  const rawCards = Array.isArray(req.body?.product_cards)
    ? req.body.product_cards
    : Array.isArray(req.body?.productCards)
      ? req.body.productCards
      : Array.isArray(req.body?.selected_product_cards)
        ? req.body.selected_product_cards
        : [];
  const normalizedProductCards = rawCards.map(normalizeSelectedProductCard).filter((card) =>
    Boolean(card.product_id || card.variant_id || card.product_name || card.image_url || card.storefront_url)
  );
  const productCards = await Promise.all(
    normalizedProductCards.map((card) => enrichSelectedProductCard({ tenantId, card }))
  );
  if (!productCards.length) {
    return sendError(res, Object.assign(new Error("product_cards are required"), { status: 400 }), "product_cards are required");
  }

  let conversation = null;
  try {
    const resolved = await resolveProductCardSendConversation({ tenantId, conversationId });
    conversation = resolved.conversation;
    if (!conversation) {
      console.warn("[ai-inbox][product-card-send] conversation lookup failed", {
        tenantId,
        conversationId,
        acceptedLookupFields: resolved.lookupFields,
        hasConversationKeyColumn: resolved.hasConversationKeyColumn,
      });
      throw Object.assign(new Error(`Conversation not found for tenant ${tenantId}: ${conversationId}`), {
        status: 404,
        code: "AI_INBOX_CONVERSATION_NOT_FOUND",
      });
    }

    const channel = envText(conversation.channel || conversation.source || "");
    const normalizedChannel = normalizeProductCardSendChannel(channel);
    const previewText = formatProductCardPreviewText(productCards[0] || {});
    const fallbackText = buildProductCardFallbackText(productCards);
    const externalCustomerId = envText(conversation.external_customer_id || conversation.customer_id || "");
    const channelMetadata = conversation.channel_metadata || {};
    console.info("[ai-inbox][product-card-send][request]", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      channel,
      normalized_channel: normalizedChannel,
      recipient_present: Boolean(externalCustomerId),
      product_cards: productCards.map((card) => ({
        product_id: card.product_id || card.id || "",
        variant_id: card.variant_id || card.selected_variant_id || "",
        name: card.product_name || card.name || card.title || "",
        color: card.color || "",
        size: card.size || "",
        price: card.price ?? "",
        product_url: card.product_url || card.storefront_url || card.url || "",
        image_url: card.image_url || card.image || "",
      })),
    });
    let sendResult = { sent: true, delivery_status: "stored" };
    let deliveryStatus = "stored";
    let deliveryError = "";
    let externalMessageId = "";
    let storedOnlyReason = "";

    if (normalizedChannel === AI_AGENT_CHANNELS.WEB_CHAT || !normalizedChannel) {
      sendResult = { sent: true, delivery_status: "stored" };
    } else if (normalizedChannel === AI_AGENT_CHANNELS.WHATSAPP) {
      if (!externalCustomerId) {
        console.warn("[ai-inbox][product-card-send] missing WhatsApp recipient id, storing transcript message only", {
          tenantId,
          conversationId,
          channel,
          normalizedChannel,
        });
        sendResult = { sent: true, delivery_status: "stored_only", fallback_only: true };
        deliveryStatus = "stored_only";
        storedOnlyReason = "whatsapp_recipient_missing";
      } else {
        sendResult = await sendWhatsAppCloudReply({
          to: externalCustomerId,
          reply: { text: fallbackText, product_cards: productCards },
          messageText: fallbackText,
        });
        deliveryStatus = sendResult?.delivery_status || (sendResult?.sent === true ? "sent" : "failed");
        if (deliveryStatus === "stored_only") {
          console.warn("[ai-inbox][product-card-send] WhatsApp transport unavailable, storing transcript message only", {
            tenantId,
            conversationId,
            channel,
            normalizedChannel,
            transport: sendResult?.transport || "",
            message: sendResult?.delivery_error || "",
          });
          storedOnlyReason = sendResult?.transport ? `whatsapp_${sendResult.transport}_stored_only` : "whatsapp_config_missing";
        } else if (deliveryStatus === "failed" && !deliveryError) {
          deliveryError = sendResult?.delivery_error || sendResult?.message || "Product card message was not delivered";
        }
        externalMessageId = sendResult?.message_id || "";
      }
    } else if (normalizedChannel === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER || normalizedChannel === AI_AGENT_CHANNELS.INSTAGRAM) {
      if (!externalCustomerId) {
        console.warn("[ai-inbox][product-card-send] missing Meta recipient id, storing transcript message only", {
          tenantId,
          conversationId,
          channel,
          normalizedChannel,
        });
        sendResult = { sent: true, delivery_status: "stored_only", fallback_only: true };
        deliveryStatus = "stored_only";
        storedOnlyReason = "meta_recipient_missing";
      } else {
        sendResult = await sendMetaInboxOutboundMessage({
          tenantId,
          channel: normalizedChannel,
          messageText: fallbackText,
          recipientId: externalCustomerId,
          conversationId,
          pageId: channelMetadata.page_id || channelMetadata.facebook_page_id || "",
          instagramBusinessAccountId: channelMetadata.instagram_business_account_id || channelMetadata.instagram_account_id || "",
        });
        deliveryStatus = sendResult.sent ? "sent" : "failed";
        if (deliveryStatus === "failed" && !deliveryError) {
          deliveryError = sendResult?.message || "Product card message was not delivered";
        }
        externalMessageId = sendResult.message_id || "";
      }
    } else {
      console.warn("[ai-inbox][product-card-send] unsupported channel, storing fallback transcript message only", {
        tenantId,
        conversationId,
        channel,
        normalizedChannel,
        acceptedChannels: [
          AI_AGENT_CHANNELS.WEB_CHAT,
          AI_AGENT_CHANNELS.WHATSAPP,
          AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
          AI_AGENT_CHANNELS.INSTAGRAM,
        ],
      });
      sendResult = { sent: true, delivery_status: "stored_only", fallback_only: true };
      deliveryStatus = "stored_only";
      storedOnlyReason = "unsupported_channel";
    }

    const message = await appendManualAiSupportReply({
      tenantId,
      sessionId: conversationId,
      clientRequestId: requestClientRequestId(req),
      message: fallbackText,
      previewMessage: previewText || fallbackText,
      messageType: "product_card",
      productCards,
      staffUserId: req.user?.id || null,
      staffUserName: userDisplayName(req.user),
      source: "ai_inbox_product_card",
      channel: normalizedChannel || conversation.channel || conversation.source || "web_chat",
      deliveryStatus,
      deliveryError,
      externalMessageId,
      providerMessageId: externalMessageId,
      whatsappInstance: sendResult?.instanceName || sendResult?.instance || "",
      remoteJid: externalCustomerId || "",
      resolvedReplyJid: externalCustomerId || "",
      resolvedPhone: externalCustomerId || "",
    });
    await logChannelEvent({
      tenantId,
      channel: normalizedChannel || conversation.channel || conversation.source || AI_AGENT_CHANNELS.WEB_CHAT,
      direction: "outbound",
      externalCustomerId,
      conversationId,
      messagePreview: previewText || fallbackText,
      status: deliveryStatus === "sent" || deliveryStatus === "stored" ? "sent" : deliveryStatus === "stored_only" ? "stored" : "failed",
      metadata: {
        source: "ai_inbox_product_card",
        product_card_count: productCards.length,
        message_type: "product_card",
      },
    }).catch(() => {});
    await upsertChannelConversationMapping({
      tenantId,
      channel: normalizedChannel || conversation.channel || conversation.source || AI_AGENT_CHANNELS.WEB_CHAT,
      externalConversationId: conversationId,
      externalCustomerId,
      customerName: conversation.customer_name || "",
      metadata: {
        ...channelMetadata,
        source: "ai_inbox_product_card",
        last_message: previewText || fallbackText,
      },
      lastMessage: previewText || fallbackText,
      lastMessageAt: new Date().toISOString(),
    }).catch(() => {});
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message, at: new Date().toISOString() });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: new Date().toISOString() });

    return res.status(201).json({
      success: deliveryStatus !== "failed",
      sent: deliveryStatus === "sent",
      delivery_status: deliveryStatus,
      delivery_error: deliveryStatus === "failed" ? (deliveryError || sendResult?.delivery_error || "") : "",
      fallback_used: sendResult?.fallback_used === true,
      reason: storedOnlyReason || undefined,
      message,
      product_cards: productCards,
      meta: sendResult.meta || null,
    });
  } catch (error) {
    console.error("ai_inbox_product_card_send_failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      channel: conversation?.channel || conversation?.source || "",
      code: error?.code || "",
      message: error?.message || "Meta send failed",
    });
    if (tenantId && conversationId && productCards.length) {
      const fallbackText = buildProductCardFallbackText(productCards);
      const previewText = formatProductCardPreviewText(productCards[0] || {});
      const failedMessage = await appendManualAiSupportReply({
        tenantId,
        sessionId: conversationId,
        clientRequestId: requestClientRequestId(req),
        message: fallbackText,
        previewMessage: previewText || fallbackText,
        messageType: "product_card",
        productCards,
        staffUserId: req.user?.id || null,
        staffUserName: userDisplayName(req.user),
        source: "ai_inbox_product_card",
        channel: conversation?.channel || conversation?.source || "web_chat",
        deliveryStatus: "failed",
        deliveryError: error?.message || "Product card send failed",
      }).catch(() => null);
      if (failedMessage) {
        emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message: failedMessage, at: new Date().toISOString() });
        emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: new Date().toISOString() });
      }
    }
    return res.status(error?.status || 502).json({
      success: false,
      delivery_status: "failed",
      delivery_error: error?.message || "Failed to send product cards",
      message: error?.message || "Failed to send product cards",
      code: error?.code || "",
      error_code: error?.code || "",
      conversation_id: conversationId,
      product_cards: productCards,
    });
  }
});

router.post("/conversations/:conversationId/test-meta-send", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = decodeRouteId(req.params.conversationId);
  const outboundTestMessage = "\u0627\u062e\u062a\u0628\u0627\u0631 \u0625\u0631\u0633\u0627\u0644 \u0645\u0646 \u0627\u0644\u0633\u064a\u0633\u062a\u0645 \u2705";
  let conversation = null;
  try {
    const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 1000 });
    conversation = inbox.conversations.find((item) =>
      item.session_id === conversationId ||
      item.external_conversation_id === conversationId ||
      item.external_customer_id === conversationId
    ) || null;
    if (!conversation) {
      throw Object.assign(new Error(`Conversation not found for tenant ${tenantId}: ${conversationId}`), {
        status: 404,
        code: "AI_INBOX_CONVERSATION_NOT_FOUND",
      });
    }
    const channel = conversation.channel || conversation.source || "";
    if (![AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS.INSTAGRAM].includes(channel)) {
      throw Object.assign(new Error("Test Meta send is only available for Messenger and Instagram DM conversations."), {
        status: 409,
        code: "CHANNEL_SEND_UNAVAILABLE",
      });
    }
    const channelMetadata = conversation.channel_metadata || {};
    const recipientId = envText(
      channelMetadata.customer_psid ||
        channelMetadata.sender_psid ||
        channelMetadata.resolved_customer_id ||
        conversation.external_customer_id ||
        conversation.customer_id
    );
    if (!recipientId) throw Object.assign(new Error("Conversation has no Meta recipient id."), { status: 409, code: "META_RECIPIENT_MISSING" });
    console.log("[meta-send] test endpoint preparing", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      channel,
      recipientId: recipientId ? "***" : "",
    });
    const sendResult = await sendMetaInboxOutboundMessage({
      tenantId,
      channel,
      recipientId,
      messageText: outboundTestMessage,
      conversationId,
      facebookPageId: channelMetadata.page_id || channelMetadata.facebook_page_id || "",
      instagramBusinessAccountId: channelMetadata.instagram_business_account_id || channelMetadata.instagram_account_id || "",
    });
    await logChannelEvent({
      tenantId,
      channel,
      direction: "outbound",
      externalCustomerId: recipientId,
      conversationId,
      messagePreview: outboundTestMessage,
      status: sendResult.sent ? "test_sent" : "not_sent",
      metadata: { meta_message_id: sendResult.message_id || "", source: "ai_inbox_test_meta_send" },
    }).catch(() => {});
    return res.json({
      success: true,
      failure: false,
      sent: sendResult.sent === true,
      message: outboundTestMessage,
      graph_api_response: sendResult.meta || sendResult.results || null,
      recipient_id: sendResult.recipient_id || recipientId,
      page_id: sendResult.page_id || channelMetadata.page_id || channelMetadata.facebook_page_id || "",
      token_present: sendResult.token_present === true,
      error: null,
      result: sendResult,
    });
  } catch (error) {
    await logChannelEvent({
      tenantId,
      channel: conversation?.channel || conversation?.source || AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
      direction: "outbound",
      externalCustomerId: conversation?.external_customer_id || "",
      conversationId,
      messagePreview: outboundTestMessage,
      status: "failed",
      error: error?.message || "Meta test send failed",
      metadata: { code: error?.code || "", status: error?.status || "", source: "ai_inbox_test_meta_send", meta_error: error?.metaResponse?.error || null },
    }).catch(() => {});
    console.error("[meta-send] test endpoint failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      status: error?.status || "",
      code: error?.code || "",
      message: error?.message || "Meta test send failed",
      meta_error: error?.metaResponse?.error || null,
    });
    return res.status(error?.status || 500).json({
      success: false,
      failure: true,
      sent: false,
      graph_api_response: error?.metaResponse || null,
      recipient_id: conversation?.external_customer_id || "",
      page_id: conversation?.channel_metadata?.page_id || conversation?.channel_metadata?.facebook_page_id || "",
      error: {
        message: error?.message || "Failed to send Meta test message",
        code: error?.code || "",
        status: error?.status || 500,
      },
    });
  }
});

router.post("/conversations/:conversationId/force-send-last-ai-reply", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = decodeRouteId(req.params.conversationId);
  let conversation = null;
  try {
    const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 1000, messageLimit: 50 });
    conversation = inbox.conversations.find((item) =>
      item.session_id === conversationId ||
      item.external_conversation_id === conversationId ||
      item.external_customer_id === conversationId
    ) || null;
    if (!conversation) {
      throw Object.assign(new Error(`Conversation not found for tenant ${tenantId}: ${conversationId}`), {
        status: 404,
        code: "AI_INBOX_CONVERSATION_NOT_FOUND",
      });
    }
    const channel = conversation.channel || conversation.source || "";
    if (![AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS.INSTAGRAM].includes(channel)) {
      throw Object.assign(new Error("Force send is only available for Messenger and Instagram DM conversations."), {
        status: 409,
        code: "CHANNEL_SEND_UNAVAILABLE",
      });
    }
    const latestAiReply = [...(Array.isArray(conversation.messages) ? conversation.messages : [])].reverse().find((message) => envText(message.ai_answer));
    const messageText = envText(latestAiReply?.ai_answer);
    if (!messageText) {
      throw Object.assign(new Error("No previous AI reply found for this conversation."), {
        status: 409,
        code: "AI_REPLY_NOT_FOUND",
      });
    }
    const channelMetadata = conversation.channel_metadata || {};
    const recipientId = envText(
      channelMetadata.customer_psid ||
        channelMetadata.sender_psid ||
        channelMetadata.resolved_customer_id ||
        conversation.external_customer_id ||
        conversation.customer_id
    );
    if (!recipientId) throw Object.assign(new Error("Conversation has no Meta recipient id."), { status: 409, code: "META_RECIPIENT_MISSING" });
    const sendResult = await sendMetaInboxOutboundMessage({
      tenantId,
      channel,
      recipientId,
      messageText,
      conversationId,
      facebookPageId: channelMetadata.page_id || channelMetadata.facebook_page_id || "",
      instagramBusinessAccountId: channelMetadata.instagram_business_account_id || channelMetadata.instagram_account_id || "",
      bypassOutboundDedupe: true,
      outboundSignatureOverride: `force:${Date.now()}:${latestAiReply?.id || ""}`,
    });
    await logChannelEvent({
      tenantId,
      channel,
      direction: "outbound",
      externalCustomerId: recipientId,
      conversationId,
      messagePreview: messageText,
      status: sendResult.sent ? "force_sent" : "not_sent",
      metadata: { meta_message_id: sendResult.message_id || "", source: "ai_inbox_force_send_last_ai_reply", ai_message_id: latestAiReply?.id || null },
    }).catch(() => {});
    return res.json({
      success: true,
      sent: sendResult.sent === true,
      forced: true,
      message: messageText,
      graph_api_response: sendResult.meta || sendResult.results || null,
      recipient_id: sendResult.recipient_id || recipientId,
      page_id: sendResult.page_id || channelMetadata.page_id || channelMetadata.facebook_page_id || "",
      token_present: sendResult.token_present === true,
      result: sendResult,
    });
  } catch (error) {
    await logChannelEvent({
      tenantId,
      channel: conversation?.channel || conversation?.source || AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
      direction: "outbound",
      externalCustomerId: conversation?.external_customer_id || "",
      conversationId,
      messagePreview: "force-send-last-ai-reply",
      status: "failed",
      error: error?.message || "Force send failed",
      metadata: { code: error?.code || "", status: error?.status || "", source: "ai_inbox_force_send_last_ai_reply", meta_error: error?.metaResponse?.error || null },
    }).catch(() => {});
    return res.status(error?.status || 500).json({
      success: false,
      sent: false,
      forced: true,
      graph_api_response: error?.metaResponse || null,
      recipient_id: conversation?.external_customer_id || "",
      page_id: conversation?.channel_metadata?.page_id || conversation?.channel_metadata?.facebook_page_id || "",
      error: {
        message: error?.message || "Force send failed",
        code: error?.code || "",
        status: error?.status || 500,
      },
    });
  }
});

router.post("/conversations/:conversationId/takeover", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const channel = envText(req.body?.channel || req.query?.channel || "");
    const conversation = await updateAiSupportConversationState({
      tenantId,
      sessionId: req.params.conversationId,
      channel,
      status: "human_takeover",
      assignedUserId: req.body?.assigned_user_id ?? req.body?.assignedUserId ?? req.user?.id,
      assignedUserName: req.body?.assigned_user_name || req.body?.assignedUserName || userDisplayName(req.user),
      actorUserId: req.user?.id || null,
    });
    return res.json({ success: true, conversation });
  } catch (error) {
    return sendError(res, error, "Failed to take over conversation");
  }
});

router.post("/conversations/:conversationId/return-to-ai", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  const channel = envText(req.body?.channel || req.query?.channel || "");
  try {
    console.log("ai_return_to_ai_start", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      route: "conversations",
    });
    const previousState = await getAiSupportConversationState({ tenantId, sessionId: conversationId, channel }).catch(() => null);
    const hadEscalation = Boolean(envText(previousState?.escalation_reason || previousState?.last_escalation_keyword) || previousState?.escalated_at);
    const conversation = await updateAiSupportConversationState({
      tenantId,
      sessionId: conversationId,
      channel,
      status: "ai_active",
      actorUserId: req.user?.id || null,
    });
    const returnedConversation = normalizeReturnedToAIConversation(conversation);
    pushAIEvent({
      type: "AI_RETURNED_FROM_HUMAN",
      status: "success",
      conversationId,
    });
    if (hadEscalation) {
      pushAIEvent({
        type: "AI_ESCALATION_CLEARED",
        status: "success",
        conversationId,
      });
    }
    console.log("ai_return_to_ai_success", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      status: returnedConversation?.status || "",
      escalation_cleared: hadEscalation,
    });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversationId,
      reason: "return_to_ai",
      at: new Date().toISOString(),
    });
    return res.json({ success: true, conversation: returnedConversation });
  } catch (error) {
    console.error("ai_return_to_ai_failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      route: "conversations",
      code: error?.code || "",
      message: error?.message || "Failed to return conversation to AI",
    });
    return sendError(res, error, "Failed to return conversation to AI");
  }
});

router.post("/conversations/:conversationId/reopen", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  const channel = envText(req.body?.channel || req.query?.channel || "");
  try {
    console.log("ai_conversation_reopen_start", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      route: "conversations",
    });
    const conversation = await updateAiSupportConversationState({
      tenantId,
      sessionId: conversationId,
      channel,
      status: "ai_active",
      assignedUserId: null,
      assignedUserName: "",
      actorUserId: req.user?.id || null,
      source: "admin_console",
      allowClosedReopen: true,
    });
    const reopenedConversation = normalizeReturnedToAIConversation(conversation);
    pushAIEvent({
      type: "AI_CONVERSATION_REOPENED",
      status: "success",
      conversationId,
    });
    console.log("ai_conversation_reopen_success", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      status: reopenedConversation?.status || "",
    });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversationId,
      reason: "reopen_conversation",
      at: new Date().toISOString(),
    });
    return res.json({ success: true, conversation: reopenedConversation });
  } catch (error) {
    console.error("ai_conversation_reopen_failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      route: "conversations",
      code: error?.code || "",
      message: error?.message || "Failed to reopen conversation",
    });
    return sendError(res, error, "Failed to reopen conversation");
  }
});

router.patch("/conversations/:conversationId/ai-enabled", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  const channel = envText(req.body?.channel || req.query?.channel || "");
  try {
    const aiEnabled = req.body?.ai_enabled !== false && req.body?.enabled !== false;
    const conversation = await updateAiSupportConversationAiEnabled({
      tenantId,
      sessionId: conversationId,
      channel,
      aiEnabled,
      actorUserId: req.user?.id || null,
      source: "ai_inbox",
    });
    pushAIEvent({
      type: aiEnabled ? "AI_CONVERSATION_ENABLED" : "AI_CONVERSATION_DISABLED",
      status: "success",
      conversationId,
    });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversationId,
      reason: "ai_enabled_changed",
      at: new Date().toISOString(),
    });
    return res.json({ success: true, conversation });
  } catch (error) {
    return sendError(res, error, "Failed to update conversation AI toggle");
  }
});

router.post("/inbox/:conversationId/takeover", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const channel = envText(req.body?.channel || req.query?.channel || "");
    const conversation = await updateAiSupportConversationState({
      tenantId,
      sessionId: req.params.conversationId,
      channel,
      status: "human_takeover",
      assignedUserId: req.body?.assigned_user_id ?? req.body?.assignedUserId ?? req.user?.id,
      assignedUserName: req.body?.assigned_user_name || req.body?.assignedUserName || userDisplayName(req.user),
      actorUserId: req.user?.id || null,
    });
    return res.json({ success: true, conversation });
  } catch (error) {
    return sendError(res, error, "Failed to take over conversation");
  }
});

router.post("/inbox/:conversationId/return-to-ai", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  const channel = envText(req.body?.channel || req.query?.channel || "");
  try {
    console.log("ai_return_to_ai_start", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      route: "inbox",
    });
    const previousState = await getAiSupportConversationState({ tenantId, sessionId: conversationId, channel }).catch(() => null);
    const hadEscalation = Boolean(envText(previousState?.escalation_reason || previousState?.last_escalation_keyword) || previousState?.escalated_at);
    const conversation = await updateAiSupportConversationState({
      tenantId,
      sessionId: conversationId,
      channel,
      status: "ai_active",
      actorUserId: req.user?.id || null,
    });
    const returnedConversation = normalizeReturnedToAIConversation(conversation);
    pushAIEvent({
      type: "AI_RETURNED_FROM_HUMAN",
      status: "success",
      conversationId,
    });
    if (hadEscalation) {
      pushAIEvent({
        type: "AI_ESCALATION_CLEARED",
        status: "success",
        conversationId,
      });
    }
    console.log("ai_return_to_ai_success", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      status: returnedConversation?.status || "",
      escalation_cleared: hadEscalation,
    });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversationId,
      reason: "return_to_ai",
      at: new Date().toISOString(),
    });
    return res.json({ success: true, conversation: returnedConversation });
  } catch (error) {
    console.error("ai_return_to_ai_failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      route: "inbox",
      code: error?.code || "",
      message: error?.message || "Failed to return conversation to AI",
    });
    return sendError(res, error, "Failed to return conversation to AI");
  }
});

router.post("/inbox/:conversationId/reopen", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  const channel = envText(req.body?.channel || req.query?.channel || "");
  try {
    console.log("ai_conversation_reopen_start", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      route: "inbox",
    });
    const conversation = await updateAiSupportConversationState({
      tenantId,
      sessionId: conversationId,
      channel,
      status: "ai_active",
      assignedUserId: null,
      assignedUserName: "",
      actorUserId: req.user?.id || null,
      source: "admin_console",
      allowClosedReopen: true,
    });
    const reopenedConversation = normalizeReturnedToAIConversation(conversation);
    pushAIEvent({
      type: "AI_CONVERSATION_REOPENED",
      status: "success",
      conversationId,
    });
    console.log("ai_conversation_reopen_success", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      status: reopenedConversation?.status || "",
    });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversationId,
      reason: "reopen_conversation",
      at: new Date().toISOString(),
    });
    return res.json({ success: true, conversation: reopenedConversation });
  } catch (error) {
    console.error("ai_conversation_reopen_failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      route: "inbox",
      code: error?.code || "",
      message: error?.message || "Failed to reopen conversation",
    });
    return sendError(res, error, "Failed to reopen conversation");
  }
});

router.patch("/inbox/:conversationId/ai-enabled", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = toTenantId(req);
  const conversationId = envText(req.params.conversationId);
  const channel = envText(req.body?.channel || req.query?.channel || "");
  try {
    const aiEnabled = req.body?.ai_enabled !== false && req.body?.enabled !== false;
    const conversation = await updateAiSupportConversationAiEnabled({
      tenantId,
      sessionId: conversationId,
      channel,
      aiEnabled,
      actorUserId: req.user?.id || null,
      source: "ai_inbox",
    });
    pushAIEvent({
      type: aiEnabled ? "AI_CONVERSATION_ENABLED" : "AI_CONVERSATION_DISABLED",
      status: "success",
      conversationId,
    });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversationId,
      reason: "ai_enabled_changed",
      at: new Date().toISOString(),
    });
    return res.json({ success: true, conversation });
  } catch (error) {
    return sendError(res, error, "Failed to update conversation AI toggle");
  }
});

router.post("/inbox/:conversationId/reply", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const message = await appendManualAiSupportReply({
      tenantId,
      sessionId: req.params.conversationId,
      clientRequestId: requestClientRequestId(req),
      message: req.body?.message || req.body?.reply || "",
      staffUserId: req.user?.id || null,
      staffUserName: userDisplayName(req.user),
    });
    await updateAiSupportConversationState({
      tenantId,
      sessionId: req.params.conversationId,
      status: "human_takeover",
      actorUserId: req.user?.id || null,
      source: "ai_inbox",
    }).catch(() => {});
    return res.status(201).json({ success: true, message });
  } catch (error) {
    return sendError(res, error, "Failed to send manual reply");
  }
});

router.post("/inbox/:conversationId/suggest-reply", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const suggestions = await generateAiSuggestedReplies({
      tenantId,
      conversationId: req.params.conversationId,
      userId: req.user?.id || null,
    });
    return res.json({ success: true, ...suggestions });
  } catch (error) {
    return sendError(res, error, "Failed to generate suggested replies");
  }
});

router.patch("/inbox/:conversationId/assign", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const assignedUserId = req.body?.assigned_user_id ?? req.body?.assignedUserId ?? null;
    const assignedUserName = req.body?.assigned_user_name || req.body?.assignedUserName || "";
    const conversation = await assignAiSupportConversation({
      tenantId,
      sessionId: req.params.conversationId,
      assignedUserId,
      assignedUserName,
      actorUserId: req.user?.id || null,
    });
    const leadConversation = await loadLeadConversationForAction({
      tenantId,
      conversationId: req.params.conversationId,
    }).catch(() => null);
    const syncedConversation = await syncLeadAssignmentMetadata({
      tenantId,
      conversation: leadConversation || { session_id: req.params.conversationId },
      assignedEmployeeId: assignedUserId,
      assignedEmployeeName: assignedUserName,
      actorUserId: req.user?.id || null,
    }).catch(() => null);
    return res.json({
      success: true,
      conversation: {
        ...conversation,
        channel_metadata: syncedConversation?.metadata || leadConversation?.channel_metadata || conversation.channel_metadata || {},
      },
    });
  } catch (error) {
    return sendError(res, error, "Failed to assign conversation");
  }
});

router.post("/inbox/:conversationId/create-customer", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = envText(req.params.conversationId);
    const conversation = await loadLeadConversationForAction({ tenantId, conversationId });
    if (!conversation) {
      return sendError(res, Object.assign(new Error(`Conversation not found for tenant ${tenantId}: ${conversationId}`), { status: 404, code: "AI_INBOX_CONVERSATION_NOT_FOUND" }), "Conversation not found");
    }

    const metadata = {
      channel: conversation.channel || conversation.source || "",
      customer_phone: conversation.phone || conversation.customer_profile?.phone || conversation.external_customer_id || "",
      external_customer_id: conversation.external_customer_id || conversation.customer_profile?.external_customer_id || "",
      customer_name: conversation.customer_name || conversation.customer_profile?.name || "",
      first_name: conversation.customer_profile?.first_name || conversation.customer_name || "",
      full_name: conversation.customer_profile?.name || conversation.customer_name || "",
      sender_name: conversation.sender_name || conversation.customer_name || "",
      contact_name: conversation.contact_name || conversation.customer_name || "",
      messenger_profile: conversation.channel_metadata?.messenger_profile || {},
      profile_name: conversation.channel_metadata?.messenger_profile?.name || conversation.customer_name || "",
    };

    const profile = await upsertAiCustomerProfile({
      tenantId,
      sessionId: conversationId,
      metadata,
      message: conversation.latest_message_preview || conversation.last_message || "",
      response: {
        answer: conversation.latest_message_preview || conversation.last_message || "",
        confidence: Number(conversation.lead_score || 0) / 100,
        detected_intent: conversation.detected_intent || "",
      },
    });

    if (!profile) {
      return sendError(res, Object.assign(new Error("Lead profile data is incomplete"), { status: 400 }), "Lead profile data is incomplete");
    }
    const profileName = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.first_name || profile.external_customer_id || conversation.customer_name || conversation.external_customer_id || "";
    const profileAvatarUrl = profile.profile_pic_url || conversation.customer_avatar_url || "";

    const syncedConversation = await syncLeadAssignmentMetadata({
      tenantId,
      conversation,
      assignedEmployeeId: conversation.assigned_user_id || null,
      assignedEmployeeName: conversation.assigned_user_name || "",
      actorUserId: req.user?.id || null,
    }).catch(() => null);

    const updatedLeadConversation = await upsertChannelConversationMapping({
      tenantId,
      channel: conversation.channel || conversation.source || "",
      externalConversationId: conversation.session_id || conversation.external_conversation_id || "",
      externalCustomerId: conversation.external_customer_id || profile.external_customer_id || "",
      customerName: profileName,
      customerAvatarUrl: profileAvatarUrl,
      customerProfileId: profile.id,
      metadata: {
        ...(conversation.channel_metadata || {}),
        created_customer_profile_id: profile.id,
        created_customer_at: new Date().toISOString(),
        source: "ai_inbox_create_customer",
      },
      lastMessage: conversation.latest_message_preview || conversation.last_message || "",
      lastMessageAt: conversation.last_message_at || conversation.updated_at || new Date().toISOString(),
    }).catch(() => {});

    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversationId,
      reason: "create_customer",
      at: new Date().toISOString(),
    });

    return res.status(201).json({
      success: true,
      profile,
      conversation: {
        ...conversation,
        channel_metadata: updatedLeadConversation?.metadata || syncedConversation?.metadata || conversation.channel_metadata || {},
        customer_profile: {
          ...(conversation.customer_profile || {}),
          id: profile.id,
          name: profileName || conversation.customer_profile?.name || "",
          first_name: profile.first_name || conversation.customer_profile?.first_name || "",
          last_name: profile.last_name || conversation.customer_profile?.last_name || "",
          phone: profile.phone || conversation.customer_profile?.phone || "",
          external_customer_id: profile.external_customer_id || conversation.customer_profile?.external_customer_id || "",
          source_channel: profile.source_channel || conversation.customer_profile?.source_channel || "",
          avatar_url: profileAvatarUrl || conversation.customer_profile?.avatar_url || "",
          profile_pic_url: profileAvatarUrl || conversation.customer_profile?.profile_pic_url || "",
        },
      },
    });
  } catch (error) {
    return sendError(res, error, "Failed to create customer from lead");
  }
});

router.post("/inbox/:conversationId/create-opportunity", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = envText(req.params.conversationId);
    const conversation = await loadLeadConversationForAction({ tenantId, conversationId });
    if (!conversation) {
      return sendError(res, Object.assign(new Error(`Conversation not found for tenant ${tenantId}: ${conversationId}`), { status: 404, code: "AI_INBOX_CONVERSATION_NOT_FOUND" }), "Conversation not found");
    }

    const profile = await upsertAiCustomerProfile({
      tenantId,
      sessionId: conversationId,
      metadata: {
        channel: conversation.channel || conversation.source || "",
        customer_phone: conversation.phone || conversation.customer_profile?.phone || conversation.external_customer_id || "",
        external_customer_id: conversation.external_customer_id || conversation.customer_profile?.external_customer_id || "",
        customer_name: conversation.customer_name || conversation.customer_profile?.name || "",
        first_name: conversation.customer_profile?.first_name || conversation.customer_name || "",
        full_name: conversation.customer_profile?.name || conversation.customer_name || "",
        sender_name: conversation.sender_name || conversation.customer_name || "",
        contact_name: conversation.contact_name || conversation.customer_name || "",
        messenger_profile: conversation.channel_metadata?.messenger_profile || {},
      },
      message: conversation.latest_message_preview || conversation.last_message || "",
      response: {
        answer: conversation.latest_message_preview || conversation.last_message || "",
        confidence: Number(conversation.lead_score || 0) / 100,
        detected_intent: conversation.detected_intent || "",
      },
    });

    if (!profile) {
      return sendError(res, Object.assign(new Error("Lead profile data is incomplete"), { status: 400 }), "Lead profile data is incomplete");
    }

    const opportunity = await createOrUpdateLeadOpportunity({
      tenantId,
      conversation,
      profile,
    });
    const profileName = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.first_name || profile.external_customer_id || conversation.customer_name || conversation.external_customer_id || "";
    const profileAvatarUrl = profile.profile_pic_url || conversation.customer_avatar_url || "";

    await upsertChannelConversationMapping({
      tenantId,
      channel: conversation.channel || conversation.source || "",
      externalConversationId: conversation.session_id || conversation.external_conversation_id || "",
      externalCustomerId: conversation.external_customer_id || profile.external_customer_id || "",
      customerName: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.first_name || conversation.customer_name || "",
      customerAvatarUrl: profile.profile_pic_url || conversation.customer_avatar_url || "",
      customerProfileId: profile.id,
      metadata: {
        ...(conversation.channel_metadata || {}),
        created_customer_profile_id: profile.id,
        created_customer_at: new Date().toISOString(),
        lead_opportunity_id: opportunity?.id || null,
        lead_opportunity_source: opportunity?.source_label || resolveLeadSourceLabel(conversation),
        source: "ai_inbox_create_opportunity",
      },
      lastMessage: conversation.latest_message_preview || conversation.last_message || "",
      lastMessageAt: conversation.last_message_at || conversation.updated_at || new Date().toISOString(),
    }).catch(() => {});

    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversationId,
      reason: "create_opportunity",
      at: new Date().toISOString(),
    });

    return res.status(201).json({
      success: true,
      profile,
      opportunity,
      source_label: resolveLeadSourceLabel(conversation),
      conversation: {
        ...conversation,
        channel_metadata: {
          ...(conversation.channel_metadata || {}),
          created_customer_profile_id: profile.id,
          lead_opportunity_id: opportunity?.id || null,
          lead_opportunity_source: opportunity?.source_label || resolveLeadSourceLabel(conversation),
        },
        customer_profile: {
          ...(conversation.customer_profile || {}),
          id: profile.id,
          name: profileName,
          first_name: profile.first_name || conversation.customer_profile?.first_name || "",
          last_name: profile.last_name || conversation.customer_profile?.last_name || "",
          phone: profile.phone || conversation.customer_profile?.phone || "",
          external_customer_id: profile.external_customer_id || conversation.customer_profile?.external_customer_id || "",
          source_channel: profile.source_channel || conversation.customer_profile?.source_channel || "",
          avatar_url: profileAvatarUrl,
          profile_pic_url: profileAvatarUrl,
        },
      },
    });
  } catch (error) {
    return sendError(res, error, "Failed to create opportunity from lead");
  }
});

router.patch("/inbox/:conversationId/lead-status", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversationId = envText(req.params.conversationId);
    const nextLeadStatus = normalizeLeadStatus(req.body?.lead_status ?? req.body?.leadStatus ?? "");
    if (!isAllowedLeadStatus(req.body?.lead_status ?? req.body?.leadStatus ?? "")) {
      return sendError(
        res,
        Object.assign(new Error("Invalid lead_status"), {
          status: 400,
          code: "INVALID_LEAD_STATUS",
        }),
        "Invalid lead_status"
      );
    }
    const conversation = await loadLeadConversationForAction({ tenantId, conversationId });
    if (!conversation) {
      return sendError(res, Object.assign(new Error(`Conversation not found for tenant ${tenantId}: ${conversationId}`), { status: 404, code: "AI_INBOX_CONVERSATION_NOT_FOUND" }), "Conversation not found");
    }

    const syncedConversation = await upsertChannelConversationMapping({
      tenantId,
      channel: conversation.channel || conversation.source || "",
      externalConversationId: conversation.session_id || conversation.external_conversation_id || "",
      externalCustomerId: conversation.external_customer_id || conversation.customer_profile?.external_customer_id || "",
      customerName: conversation.customer_name || conversation.customer_profile?.name || "",
      customerAvatarUrl: conversation.customer_avatar_url || conversation.customer_profile?.avatar_url || "",
      customerProfileId: conversation.customer_profile?.id || conversation.profile_id || null,
      leadStatus: nextLeadStatus,
      metadata: {
        ...(conversation.channel_metadata || {}),
        lead_status: nextLeadStatus,
        source: "ai_inbox_lead_status",
      },
      lastMessageAt: conversation.last_message_at || conversation.updated_at || new Date().toISOString(),
    });

    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: conversationId,
      reason: "lead_status_updated",
      at: new Date().toISOString(),
    });

    return res.json({
      success: true,
      lead_status: nextLeadStatus,
      conversation: {
        ...conversation,
        lead_status: nextLeadStatus,
        channel_metadata: {
          ...(conversation.channel_metadata || {}),
          lead_status: nextLeadStatus,
        },
        ...(syncedConversation ? { channel: syncedConversation.channel || conversation.channel } : {}),
      },
    });
  } catch (error) {
    return sendError(res, error, "Failed to update lead status");
  }
});

router.patch("/inbox/:conversationId/close", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const conversation = await updateAiSupportConversationState({
      tenantId,
      sessionId: req.params.conversationId,
      status: "closed",
      actorUserId: req.user?.id || null,
    });
    return res.json({ success: true, conversation });
  } catch (error) {
    return sendError(res, error, "Failed to close conversation");
  }
});

router.get("/followups", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const payload = await listAiFollowups({
      tenantId,
      status: String(req.query?.status || "all"),
      limit: req.query?.limit,
    });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return sendError(res, error, "Failed to load AI follow-ups");
  }
});

router.post("/followups/:id/send-manual", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await sendAiFollowupManual({
      tenantId,
      id: Number(req.params.id),
      message: req.body?.message || "",
      staffUserId: req.user?.id || null,
      staffUserName: userDisplayName(req.user),
      force: req.body?.force === true,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to send AI follow-up manually");
  }
});

router.patch("/followups/:id/snooze", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const followup = await snoozeAiFollowup({
      tenantId,
      id: Number(req.params.id),
      minutes: req.body?.minutes,
      snoozeUntil: req.body?.snooze_until || req.body?.snoozeUntil || "",
      staffUserId: req.user?.id || null,
    });
    return res.json({ success: true, followup });
  } catch (error) {
    return sendError(res, error, "Failed to snooze AI follow-up");
  }
});

router.patch("/followups/:id/cancel", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const followup = await cancelAiFollowup({
      tenantId,
      id: Number(req.params.id),
      reason: req.body?.reason || "",
      staffUserId: req.user?.id || null,
    });
    return res.json({ success: true, followup });
  } catch (error) {
    return sendError(res, error, "Failed to cancel AI follow-up");
  }
});

router.patch("/followups/:id/done", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const followup = await completeAiFollowup({
      tenantId,
      id: Number(req.params.id),
      staffUserId: req.user?.id || null,
    });
    return res.json({ success: true, followup });
  } catch (error) {
    return sendError(res, error, "Failed to mark AI follow-up done");
  }
});

router.get("/settings", protect, permit("settings", "view"), async (req, res) => {
  try {
    const settings = await getAISettings();
    return res.json({ success: true, settings, persisted: wasAISettingsPersisted() });
  } catch (error) {
    return sendError(res, error, "Failed to load AI agent settings");
  }
});

router.put("/settings", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const settings = await updateAISettings(req.body?.settings || req.body || {});
    return res.json({ success: true, settings, persisted: wasAISettingsPersisted() });
  } catch (error) {
    return sendError(res, error, "Failed to update AI agent settings");
  }
});

router.get("/settings/ai-assistant-global", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const settings = await getAiAgentSettings({ tenantId });
    return res.json({
      success: true,
      ai_assistant_global_enabled: settings.ai_assistant_global_enabled !== false,
      settings,
      persisted: true,
    });
  } catch (error) {
    return sendError(res, error, "Failed to load AI assistant global status");
  }
});

router.patch("/settings/ai-assistant-global", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const enabled = req.body?.ai_assistant_global_enabled !== false && req.body?.enabled !== false;
    const current = await getAiAgentSettings({ tenantId });
    const settings = await updateAiAgentSettings({
      tenantId,
      settings: {
        ...current,
        ai_assistant_global_enabled: enabled,
      },
    });
    return res.json({
      success: true,
      ai_assistant_global_enabled: settings.ai_assistant_global_enabled !== false,
      settings,
      persisted: true,
    });
  } catch (error) {
    return sendError(res, error, "Failed to update AI assistant global status");
  }
});

router.get("/social-automation/settings", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const settings = await getSocialAutomationSettings(tenantId);
    return res.json({ success: true, settings, persisted: settings.persisted !== false });
  } catch (error) {
    return sendError(res, error, "Failed to load social automation settings");
  }
});

router.patch("/social-automation/settings", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const settings = await updateSocialAutomationSettings(tenantId, req.body?.settings || req.body || {});
    return res.json({ success: true, settings, persisted: settings.persisted !== false });
  } catch (error) {
    return sendError(res, error, "Failed to update social automation settings");
  }
});

router.get("/analytics", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const analytics = await loadAiSalesAnalytics({
      tenantId,
      fromDate: req.query?.from_date || req.query?.fromDate || "",
      toDate: req.query?.to_date || req.query?.toDate || "",
      branchId: req.query?.branch_id || req.query?.branchId || null,
    });
    return res.json({ success: true, analytics });
  } catch (error) {
    return sendError(res, error, "Failed to load AI sales analytics");
  }
});

router.get("/shadow-analytics", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const analytics = await loadAiShadowAnalytics({
      tenantId,
      fromDate: req.query?.from_date || req.query?.fromDate || "",
      toDate: req.query?.to_date || req.query?.toDate || "",
    });
    return res.json({ success: true, analytics });
  } catch (error) {
    return sendError(res, error, "Failed to load AI shadow analytics");
  }
});

export default router;
