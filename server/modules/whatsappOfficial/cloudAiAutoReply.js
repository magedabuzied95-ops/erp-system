// The AI reply for a message that arrived on an official (Cloud API) number.
//
// It runs the very pipeline the Evolution line runs — whatsappGatewayService.triggerWhatsappAiAutoReply:
// the reply gate (test contacts, takeover, pause), generateWhatsappAiAutoReply (sales agent, memory,
// order lookup, campaign instructions), the pre-send recheck, product cards/photos, the duplicate-reply
// block and the transcript row (sender ai, whatsapp_ai_auto_reply_sent). The only difference is the
// `instance`: "cloud:<phone_number_id>", which every gateway send already routes through Cloud API.
//
// Until 2026-10-21 this number went through a separate, older path instead — a loopback POST to
// /api/ai-support/chat with a website-style payload — which ran none of that and answered the
// owner's "where is my order" with the brain's generic fallback while the Evolution line, in the
// same thread, answered with his real orders.
//
// Everything that precedes the AI in the Cloud webhook handler (inbound row, mapping, ad/campaign
// attribution, the official-number intercept chain, escalation) stays there; this is called only
// for a message none of those took.

const text = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const CLOUD_INSTANCE_PREFIX = "cloud:";

export const cloudInstanceKey = (metadata = {}) => {
  const phoneNumberId = text(metadata?.phone_number_id);
  return phoneNumberId ? `${CLOUD_INSTANCE_PREFIX}${phoneNumberId}` : "";
};

const isImageAttachment = (attachment = {}) => {
  const type = text(attachment?.type || attachment?.media_type).toLowerCase();
  const mime = text(attachment?.mime_type || attachment?.mimeType || attachment?.metadata?.mime_type).toLowerCase();
  return type === "image" || mime.startsWith("image/");
};

/**
 * The marketing stop word ("إلغاء" alone opts the customer out of marketing on every number, as the
 * privacy policy promises), run once for EVERY inbound customer message on an official number —
 * before the intercept chain, so a message a chatbot flow, a campaign reply, the away auto-reply or
 * an escalation takes is still honoured. The AI trigger is told it already ran (see
 * `marketingStopWordHandled` below) so it is never recorded twice. Never throws.
 */
export const runCloudMarketingStopWord = async ({ tenantId, message = {}, handler = null } = {}) => {
  const phone = text(message.external_customer_id);
  const messageText = text(message.message_text);
  if (!phone || !messageText) return { opted_out: false, skipped: true };
  try {
    const run = typeof handler === "function"
      ? handler
      : (await import("../../services/marketingConsentService.js")).handleInboundMarketingStopWord;
    return await run({ tenantId, message: messageText, phone });
  } catch (error) {
    console.warn("[whatsapp:cloud] marketing stop-word check failed", { tenant_id: tenantId, message: error?.message || String(error) });
    return { opted_out: false, error: true };
  }
};

/**
 * The normalized message triggerWhatsappAiAutoReply reads, built from a Cloud webhook message
 * (extractWhatsAppWebhookMessages) and the inbound row the handler already wrote.
 *
 * A Cloud customer is always a real phone number (Graph has no LID), so the reply target is that
 * phone; `fromMe` is always false (our own sends arrive as statuses, never as messages).
 */
export const buildCloudAiAutoReplyMessage = ({ tenantId, message = {}, metadata = {}, inboundRow = null } = {}) => {
  const phone = text(message.external_customer_id);
  const providerMessageId = text(message.external_message_id || message.dedupe_key);
  const sessionId = text(inboundRow?.session_id || message.external_conversation_id || (phone ? `whatsapp:${phone}` : ""));
  const messageText = text(message.message_text);
  const attachments = asArray(message.attachments);
  const photoOnly = !messageText && attachments.some(isImageAttachment);
  return {
    event: "cloud.message",
    provider: "cloud",
    tenant_id: tenantId,
    tenantId,
    raw: { ...(message.raw && typeof message.raw === "object" ? message.raw : {}), tenant_id: tenantId },
    instance: cloudInstanceKey(metadata),
    phone,
    remoteJid: phone ? `${phone}@s.whatsapp.net` : "",
    resolvedPhone: phone,
    message_id: providerMessageId,
    messageId: providerMessageId,
    external_message_id: providerMessageId,
    fromMe: false,
    isGroup: false,
    text: messageText,
    message_text: messageText,
    customer_name: text(message.customer_name),
    senderName: text(message.customer_name),
    timestamp: message.timestamp || new Date().toISOString(),
    received_at: message.timestamp || new Date().toISOString(),
    visualAttachments: attachments,
    media_type: photoOnly ? "image" : "",
    conversationIdentity: sessionId,
    inbox: {
      saved: Boolean(inboundRow),
      duplicate: false,
      reason: photoOnly ? "media_saved" : "saved",
      session_id: sessionId,
      message: inboundRow || null,
    },
    trace_id: null,
    // The Cloud handler already ran the marketing stop word for this message (runCloudMarketingStopWord).
    marketingStopWordHandled: true,
  };
};

/**
 * Hands one Cloud inbound message to the shared WhatsApp AI pipeline. `trigger` and
 * `photoOnlyText` are injectable for tests; production loads the real ones lazily so this module
 * stays free of the database and the gateway at import time.
 */
export const dispatchCloudAiAutoReply = async ({ tenantId, message = {}, metadata = {}, inboundRow = null, trigger = null, photoOnlyText = null } = {}) => {
  const aiInput = buildCloudAiAutoReplyMessage({ tenantId, message, metadata, inboundRow });
  // Without the number it arrived on, the gateway would fall back to the env default transport —
  // the Evolution line — and answer from a different number than the customer wrote to.
  if (!aiInput.instance) return { triggered: false, sent: false, reason: "missing_phone_number_id" };
  const toPhotoQuestion = typeof photoOnlyText === "function"
    ? photoOnlyText
    : (await import("../../services/aiVisualProductRecognitionService.js")).photoOnlyAutoReplyText;
  // A photo with no caption enters as the customer's question about it, exactly as on Evolution.
  const photoQuestion = toPhotoQuestion(aiInput);
  const input = photoQuestion ? { ...aiInput, text: photoQuestion } : aiInput;
  if (!input.text) return { triggered: false, sent: false, reason: "no_text" };
  const run = typeof trigger === "function"
    ? trigger
    : (await import("../../services/whatsappGatewayService.js")).triggerWhatsappAiAutoReply;
  return Promise.resolve()
    .then(() => run(input))
    .catch((error) => ({ triggered: false, sent: false, reason: "ai_auto_reply_failed", error: error?.message || String(error) }));
};
