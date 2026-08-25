// Canonical channel vocabulary + fair per-channel retrieval helpers for the AI
// Inbox. Extracted from AiInbox.jsx so the starvation rules are unit-testable
// and cannot drift between call sites.
//
// Background: /ai-inbox/conversations returns the newest N conversations across
// ALL channels. With one global limit, a large channel evicts the others — in
// production 197 WhatsApp threads filled a 200-row page and the 2nd Messenger
// conversation was never sent to the client at all. The fix is a guaranteed
// window per channel, merged client-side.

const clean = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// loadAiInbox only honours these six values; anything else matches no clause and
// the server silently returns the unfiltered top-N across every channel.
export const AI_INBOX_BACKEND_CHANNEL_FILTERS = new Map([
  ["messenger", "facebook_messenger"],
  ["facebook", "facebook_messenger"],
  ["facebook_messenger", "facebook_messenger"],
  ["instagram", "instagram"],
  ["whatsapp", "whatsapp"],
  ["telegram", "telegram"],
  ["web", "web_chat"],
  ["web_chat", "web_chat"],
  ["facebook_comment", "facebook_comment"],
  ["instagram_comment", "instagram_comment"],
]);

// "" means "no channel filter" — never send a literal "all".
export const backendChannelFilter = (value = "") =>
  AI_INBOX_BACKEND_CHANNEL_FILTERS.get(clean(value).toLowerCase()) || "";

// Message channels the inbox "All" view covers. Comment channels live in the
// separate Social Comments section and are deliberately excluded.
export const AI_INBOX_MESSAGE_CHANNELS = ["whatsapp", "facebook_messenger", "instagram", "telegram", "web_chat"];

// Sized from production: WhatsApp is the only large population (200+);
// Messenger/Instagram/Web are single digits, so 50 is generous headroom. A
// typical merged payload (~150+2+2+0) is smaller than the 200 rows previously
// fetched in one shot, so fairness does not cost bytes.
export const AI_INBOX_CHANNEL_WINDOW = {
  whatsapp: 150,
  facebook_messenger: 50,
  instagram: 50,
  telegram: 50,
  web_chat: 50,
};

export const channelWindow = (backendChannel = "") => AI_INBOX_CHANNEL_WINDOW[backendChannel] || 50;

// Channels a refresh must cover: exactly one request for a selected tab, or one
// bounded request per message channel for "All".
export const channelsForFilter = (uiChannelFilter = "") => {
  const selected = backendChannelFilter(uiChannelFilter);
  return selected ? [selected] : [...AI_INBOX_MESSAGE_CHANNELS];
};

// Which specific ACCOUNT owns a conversation — the WhatsApp number (Evolution
// instance), Facebook page, or Instagram account. The webhook stamps these keys
// into conversation metadata on every inbound message; "" means unknown (old
// rows from before the stamping, or platforms with a single account).
export const conversationAccountKey = (conversation = {}) => {
  const metadata = conversation.channel_metadata || conversation.metadata || {};
  const channel = clean(conversation.channel || conversation.source).toLowerCase();
  if (channel.includes("whatsapp")) return clean(metadata.whatsapp_instance || metadata.instance);
  if (channel.includes("instagram")) {
    return clean(metadata.instagram_business_account_id || metadata.resolved_page_id || metadata.page_id || metadata.recipient_page_id);
  }
  if (channel.includes("facebook") || channel.includes("messenger")) {
    return clean(metadata.resolved_page_id || metadata.page_id || metadata.facebook_page_id || metadata.recipient_page_id);
  }
  return "";
};

export const conversationActivityAt = (conversation = {}) =>
  new Date(
    conversation.last_message_at ||
    conversation.last_activity_at ||
    conversation.updated_at ||
    conversation.created_at ||
    0
  ).getTime() || 0;

// Merge per-channel pages into one chronological list. Identity is the
// channel-scoped conversation_key, so two Messenger threads — or messenger:123
// and instagram:123 — can never collapse into one another. Newest activity wins
// when the same conversation appears in more than one page.
export const mergeConversationPages = (pages = [], keyOf = () => "") => {
  const byKey = new Map();
  for (const page of asArray(pages)) {
    for (const row of asArray(page)) {
      if (!row) continue;
      const key = clean(row.conversation_key) || clean(keyOf(row));
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...row, conversation_key: key });
      } else if (conversationActivityAt(row) >= conversationActivityAt(existing)) {
        byKey.set(key, { ...existing, ...row, conversation_key: key });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => conversationActivityAt(b) - conversationActivityAt(a));
};
