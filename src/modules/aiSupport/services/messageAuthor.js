// Who wrote an outbound inbox message, and which of our WhatsApp numbers it went through.
// Shared by the desktop inbox, the PWA and TranscriptMessage.

const clean = (value = "") => String(value ?? "").trim();
const lower = (value = "") => clean(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);

/*
 * sender_type alone cannot say who wrote a row: chatbot flows, the away auto-reply and every
 * other automation write sender_type 'system'. The writer's marker (source_path / insert_source)
 * names it. Mirrors inboxMessageAuthorKind in server/services/aiSalesAgentService.js; computed
 * here too because a socket event carries the raw row without author_kind.
 *   customer | note | chatbot | campaign | auto_reply | staff | ai | system | ""
 */
export const messageAuthorKind = (message = {}) => {
  const senderType = lower(message.sender_type || message.senderType);
  if (["customer", "user", "client"].includes(senderType)) return "customer";
  if (lower(message.message_type) === "internal_note" || senderType === "note") return "note";
  const marker = `${lower(message.source_path)} ${lower(message.insert_source)}`;
  // detected_intent too: rows a Cloud status tick re-stamped (source_path became
  // whatsapp_cloud_status_webhook) still say the chatbot wrote them there.
  if (marker.includes("wa_chatbot_flow") || lower(message.detected_intent) === "wa_chatbot_flow") return "chatbot";
  // A template campaign's send; the campaign's name rides in staff_user_name.
  if (marker.includes("wa_campaign") || lower(message.detected_intent) === "wa_campaign") return "campaign";
  // The away message only — "whatsapp_ai_auto_reply" / "meta_ai_auto_reply" are the AI's own replies.
  if (marker.includes("wa_official_auto_reply")) return "auto_reply";
  if (["staff", "agent", "human"].includes(senderType)) return "staff";
  if (["ai", "assistant", "bot"].includes(senderType)) return "ai";
  // An AI reply some writers stored as 'system' still names the AI in its marker
  // (whatsapp_ai_auto_reply, meta_ai_auto_reply, ai_send_success, ...).
  if (/(^|[\s_])ai_/.test(marker)) return "ai";
  if (senderType === "system") return "system";
  return lower(message.author_kind);
};

const isCustomerRow = (message = {}) =>
  ["customer", "user", "client"].includes(lower(message.sender_type || message.senderType)) ||
  (lower(message.direction) === "inbound" && message.from_me !== true);

// Label for one of our numbers: the server's mapping, else the instance itself without the
// "cloud:" prefix noise.
// An unmapped non-cloud instance is a WhatsApp Web (Evolution) line; webLabel(name) lets the
// caller say so in the UI language.
export const whatsappNumberLabel = (instance = "", labels = {}, webLabel = null) => {
  const key = clean(instance);
  if (!key) return "";
  const mapped = clean(labels && typeof labels === "object" ? labels[key] : "");
  if (mapped) return mapped;
  if (key.toLowerCase().startsWith("cloud:")) return `Cloud ${key.slice("cloud:".length)}`;
  return typeof webLabel === "function" ? webLabel(key) : key;
};

// Returns fn(message) -> number label, or "" for every message when the thread only ever went
// through one of our numbers (the chip would say nothing new).
export const whatsappNumberLabeler = (messages = [], labels = {}, webLabel = null) => {
  const instances = new Set(asArray(messages).map((message) => clean(message?.whatsapp_instance)).filter(Boolean));
  if (instances.size < 2) return () => "";
  return (message = {}) => whatsappNumberLabel(message.whatsapp_instance, labels, webLabel);
};

// The number a hand reply leaves from, the way the server resolves it: the customer's newest
// inbound row that names a number, else what the server resolved, else the conversation metadata.
export const whatsappReplyInstance = (conversation = {}) => {
  let newest = null;
  let newestAt = -1;
  asArray(conversation?.messages).forEach((message, index) => {
    if (!message || !isCustomerRow(message) || !clean(message.whatsapp_instance)) return;
    // Timestamp first; array position breaks ties and covers a row without one.
    const at = (new Date(message.created_at || 0).getTime() || 0) * 1000 + index;
    if (at > newestAt) {
      newestAt = at;
      newest = message;
    }
  });
  if (newest) return clean(newest.whatsapp_instance);
  const metadata = conversation?.channel_metadata || conversation?.metadata || {};
  return clean(conversation?.reply_whatsapp_instance) || clean(metadata.whatsapp_instance || metadata.instance);
};
