import { buildProductContext, ensureProductLinkInReply } from "./aiProductContext.js";
import { getAIChannelSettings } from "./aiChannelSettingsService.js";
import {
  AI_AGENT_CHANNELS,
  getChannelSettings,
  linkChannelConversationToCustomerProfile,
  logChannelEvent,
  normalizeOutgoingChannelReply,
} from "./aiChannelAdapterService.js";
import { detectEscalation } from "./aiEscalationDetector.js";
import { pushAIEvent } from "./aiEventLogger.js";
import { getAISettings, getAIToneInstruction } from "./aiSettingsService.js";
import {
  appendAiGeneratedSupportReply,
  getAiSupportConversationState,
  markAiSupportConversationEscalated,
} from "./aiSupportLogService.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

const backendPort = () => text(process.env.PORT || process.env.BACKEND_PORT || "8000");

const normalizeBackendBaseUrl = (value = "") => {
  const raw = text(value).replace(/\/+$/g, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const localHost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
    if (localHost && (!url.port || url.port === "80" || url.port === "443")) {
      url.port = backendPort();
    }
    url.pathname = url.pathname.replace(/\/+$/g, "").replace(/\/api$/i, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/g, "");
  } catch {
    return "";
  }
};

const aiSupportBaseUrl = () => {
  const candidates = [
    process.env.INTERNAL_AI_SUPPORT_URL,
    process.env.PUBLIC_BACKEND_URL,
    process.env.API_BASE_URL,
    process.env.BACKEND_URL,
    process.env.API_PUBLIC_URL,
    process.env.VITE_API_BASE_URL,
  ];
  for (const candidate of candidates) {
    const resolved = normalizeBackendBaseUrl(candidate);
    if (resolved) return resolved;
  }
  return `http://127.0.0.1:${backendPort()}`;
};

const errorSummary = (error = {}) => ({
  message: error?.message || String(error),
  causeMessage: error?.cause?.message || "",
  code: error?.code || "",
  status: error?.status || "",
});

const firstProductFromPayload = (payload = {}) => {
  const candidates = [
    payload.product,
    payload.suggested_product,
    payload.selected_product,
    payload.recommended_product,
    payload.product_context,
    ...(Array.isArray(payload.suggested_products) ? payload.suggested_products : []),
    ...(Array.isArray(payload.product_cards) ? payload.product_cards : []),
    ...(Array.isArray(payload.channel_reply?.product_cards) ? payload.channel_reply.product_cards : []),
  ];
  return candidates.find((product) => product?.id || product?.product_id || product?.name || product?.title) || null;
};

const shouldSendChannelReply = (payload = {}) => {
  const status = text(payload?.conversation_status || payload?.detected_intent).toLowerCase();
  if (payload?.auto_response_paused === true) return { ok: false, reason: "auto_response_paused" };
  if (["human_takeover", "closed"].includes(status)) return { ok: false, reason: status };
  if (payload?.needs_human_support === true) return { ok: false, reason: "needs_human_support" };
  if (Number(payload?.confidence) > 0 && Number(payload.confidence) < 0.35) return { ok: false, reason: "low_confidence" };
  return { ok: true, reason: "reply_allowed" };
};

const shouldAutoReplyToWhatsapp = async ({ tenantId, conversationId, payload = {} } = {}) => {
  const state = await getAiSupportConversationState({ tenantId, sessionId: conversationId }).catch(() => null);
  const status = text(state?.status || payload?.conversation_status).toLowerCase();
  const globalSettings = await getAISettings();
  const channelAISettings = await getAIChannelSettings(AI_AGENT_CHANNELS.WHATSAPP, AI_AGENT_CHANNELS.WHATSAPP);
  const runtimeSettings = await getChannelSettings({ tenantId, channel: AI_AGENT_CHANNELS.WHATSAPP }).catch(() => ({}));
  const globalMode = text(globalSettings.autoReplyMode || "suggest_only").toLowerCase();
  const channelMode = text(channelAISettings.aiMode || "suggest_only").toLowerCase();
  const runtimeMode = text(runtimeSettings.auto_reply_mode || (runtimeSettings.ai_replies_enabled === true ? "fully_automatic" : "off")).toLowerCase();
  const automaticModes = new Set(["fully_automatic", "automatic"]);
  const runtimeAutomatic = runtimeSettings.ai_replies_enabled === true && automaticModes.has(runtimeMode);
  const globalAutomatic = automaticModes.has(globalMode);
  const channelAutomatic = automaticModes.has(channelMode);
  const effectiveMode = runtimeAutomatic ? "fully_automatic" : globalAutomatic && channelAutomatic ? "fully_automatic" : runtimeMode || channelMode || globalMode || "off";
  const shouldAutoSend = effectiveMode === "fully_automatic";
  const base = {
    tenantId,
    conversationId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    globalMode,
    channelMode,
    runtimeMode,
    effectiveMode,
    shouldAutoSend,
    status,
  };

  if (status === "human_takeover") return { ok: false, reason: "human_takeover", ...base };
  if (status === "closed" || payload?.auto_response_paused === true) return { ok: false, reason: "paused", ...base };
  if (globalMode === "off") return { ok: false, reason: "GLOBAL_OFF", ...base };
  if (channelMode === "off") return { ok: false, reason: "CHANNEL_OFF", ...base };
  if (runtimeSettings.ai_replies_enabled !== true || !automaticModes.has(runtimeMode)) {
    return { ok: false, reason: runtimeMode === "off" ? "AUTO_REPLY_OFF" : "SUGGEST_ONLY", ...base };
  }
  if (!shouldAutoSend) return { ok: false, reason: "SUGGEST_ONLY", ...base };
  return { ok: true, reason: "fully_automatic", settings: { globalSettings, channelAISettings, runtimeSettings }, ...base };
};

const routeWhatsappMessageThroughAi = async ({ tenantId, message = {} } = {}) => {
  const globalSettings = await getAISettings();
  const channelAISettings = await getAIChannelSettings(AI_AGENT_CHANNELS.WHATSAPP, AI_AGENT_CHANNELS.WHATSAPP);
  const effectiveTone = channelAISettings.tone || globalSettings.tone || "casual";
  const resolvedUrl = `${aiSupportBaseUrl().replace(/\/+$/, "")}/api/ai-support/chat`;
  console.info("[whatsapp:ai-generate-url]", { resolvedUrl });
  const response = await fetch(resolvedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": String(tenantId),
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      message: message.message_text || "Customer sent an attachment",
      session_id: message.external_conversation_id,
      metadata: {
        session_id: message.external_conversation_id,
        customer_id: message.external_customer_id,
        customer_phone: message.external_customer_id,
        customer_name: message.customer_name,
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        external_conversation_id: message.external_conversation_id,
        external_customer_id: message.external_customer_id,
        ai_tone: effectiveTone,
        ai_tone_instruction: getAIToneInstruction(effectiveTone),
        attachments: message.attachments || [],
        timestamp: message.timestamp,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload?.message || "AI support flow failed"), { status: response.status, responseBody: payload });
  }
  return payload;
};

export const generateWhatsappAiAutoReply = async ({ tenantId, phone, sessionId, customerName = "", messageText = "", timestamp = "" } = {}) => {
  const safeTenantId = number(tenantId, number(process.env.WHATSAPP_TENANT_ID, 1));
  const safePhone = text(phone);
  const safeSessionId = text(sessionId || (safePhone ? `whatsapp:${safePhone}` : ""));
  const body = text(messageText);
  if (!safeTenantId || !safePhone || !safeSessionId || !body) {
    console.info("[whatsapp:ai-skipped]", { reason: "missing_required_input", tenantId: safeTenantId, sessionId: safeSessionId, phoneSuffix: safePhone.slice(-4) });
    return { triggered: false, sent: false, reason: "missing_required_input" };
  }

  const decision = await shouldAutoReplyToWhatsapp({ tenantId: safeTenantId, conversationId: safeSessionId });
  if (!decision.ok) {
    console.info("[whatsapp:ai-skipped]", {
      reason: decision.reason,
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      mode: decision.runtimeMode,
      globalMode: decision.globalMode,
      channelMode: decision.channelMode,
      effectiveMode: decision.effectiveMode,
      shouldAutoSend: decision.shouldAutoSend,
    });
    return { triggered: false, sent: false, reason: decision.reason };
  }

  const escalation = detectEscalation(body);
  if (escalation.shouldEscalate) {
    await markAiSupportConversationEscalated({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      reason: escalation.reason || "CUSTOMER_RISK_OR_COMPLAINT",
      keyword: escalation.keyword || "",
      source: "whatsapp_ai_auto_reply",
    });
    console.info("[whatsapp:ai-skipped]", { reason: escalation.reason || "escalated_to_human", tenantId: safeTenantId, sessionId: safeSessionId, keyword: escalation.keyword || "" });
    return { triggered: false, sent: false, reason: escalation.reason || "escalated_to_human" };
  }

  const message = {
    external_conversation_id: safeSessionId,
    external_customer_id: safePhone,
    customer_name: customerName,
    message_text: body,
    timestamp: timestamp || new Date().toISOString(),
    attachments: [],
  };
  console.info("[whatsapp:ai-trigger]", {
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    phoneSuffix: safePhone.slice(-4),
    messageLength: body.length,
    effectiveMode: decision.effectiveMode,
    shouldAutoSend: decision.shouldAutoSend,
  });
  console.info("[whatsapp:ai-generate-start]", {
    target: "ai-support-chat",
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    phoneSuffix: safePhone.slice(-4),
  });
  let aiPayload = null;
  try {
    aiPayload = await routeWhatsappMessageThroughAi({ tenantId: safeTenantId, message });
  } catch (error) {
    const summary = errorSummary(error);
    console.error("[whatsapp:ai-generate-error]", {
      ...summary,
      target: "ai-support-chat",
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      phoneSuffix: safePhone.slice(-4),
    });
    await appendAiGeneratedSupportReply({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      answer: `WhatsApp AI generation failed: ${summary.message}`,
      confidence: 0,
      detectedIntent: "whatsapp_ai_generation_error",
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      deliveryStatus: "failed",
      deliveryError: summary.causeMessage ? `${summary.message} / cause: ${summary.causeMessage}` : summary.message,
    }).catch(() => {});
    return { triggered: true, sent: false, reason: "ai_generation_failed", error: summary };
  }
  pushAIEvent({
    type: "AI_REPLY_GENERATED",
    status: "success",
    conversationId: safeSessionId,
    platform: AI_AGENT_CHANNELS.WHATSAPP,
  });
  await linkChannelConversationToCustomerProfile({
    tenantId: safeTenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    externalConversationId: safeSessionId,
    externalCustomerId: safePhone,
  }).catch(() => {});

  const replyDecision = shouldSendChannelReply(aiPayload);
  if (!replyDecision.ok) {
    console.info("[whatsapp:ai-skipped]", { reason: replyDecision.reason, tenantId: safeTenantId, sessionId: safeSessionId, confidence: aiPayload?.confidence || 0 });
    return { triggered: true, sent: false, reason: replyDecision.reason, aiPayload };
  }

  const reply = aiPayload.channel_reply || normalizeOutgoingChannelReply({ channel: AI_AGENT_CHANNELS.WHATSAPP, response: aiPayload });
  const productContext = buildProductContext(firstProductFromPayload(aiPayload));
  const replyText = ensureProductLinkInReply(reply.text || aiPayload.answer || "", productContext);
  if (!text(replyText)) {
    console.info("[whatsapp:ai-skipped]", { reason: "empty_ai_reply", tenantId: safeTenantId, sessionId: safeSessionId });
    return { triggered: true, sent: false, reason: "empty_ai_reply", aiPayload };
  }
  console.info("[whatsapp:ai-generated]", {
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    replyLength: replyText.length,
    detectedIntent: aiPayload.detected_intent || "",
    confidence: aiPayload.confidence || 0,
  });
  return { triggered: true, sent: false, replyText, reply, aiPayload, tenantId: safeTenantId, sessionId: safeSessionId, phone: safePhone };
};

export const logWhatsappAiOutbound = async ({ tenantId, phone, sessionId, replyText = "", sent = false, metadata = {} } = {}) => {
  await logChannelEvent({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    direction: "outbound",
    externalCustomerId: phone,
    conversationId: sessionId,
    messagePreview: replyText,
    status: sent ? "sent" : "not_sent",
    metadata: { source: "evolution_api_ai_auto_reply", ...metadata },
  }).catch(() => {});
};

export default {
  generateWhatsappAiAutoReply,
  logWhatsappAiOutbound,
};
