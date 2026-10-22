import { firstUsefulCustomerName } from "../../modules/aiSupport/lib/conversationHelpers.js";

// What a conversation summary row shows outside the inbox page: a name, the
// channel it came on, the last line and the unread count. Small on purpose —
// the inbox page keeps its own richer readers, these only have to agree with
// what a list row of /ai-inbox/conversations carries.

const clean = (value) => String(value ?? "").trim();

export const conversationChannel = (item = {}) => {
  const raw = clean(item?.channel || item?.source || item?.provider || item?.platform).toLowerCase();
  const key = raw || clean(item?.session_id).split(":")[0].toLowerCase();
  if (key.includes("whatsapp")) return "whatsapp";
  if (key.includes("telegram")) return "telegram";
  if (key.startsWith("tiktok")) return "tiktok";
  if (key.includes("instagram_comment")) return "instagram_comment";
  if (key.includes("facebook_comment")) return "facebook_comment";
  if (key.includes("instagram")) return "instagram";
  if (key.includes("messenger") || key.includes("facebook")) return "messenger";
  if (key.includes("web")) return "web";
  return key || "unknown";
};

// Brand names render verbatim (product names, not application chrome).
const CHANNEL_NAMES = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  tiktok: "TikTok",
  instagram: "Instagram",
  instagram_comment: "Instagram",
  messenger: "Messenger",
  facebook_comment: "Facebook",
  web: "Web",
};

export const channelDisplayName = (item = {}) => CHANNEL_NAMES[conversationChannel(item)] || "";

export const CHANNEL_COLORS = {
  whatsapp: "#25d366",
  telegram: "#2aabee",
  tiktok: "#ff0050",
  instagram: "#e1306c",
  instagram_comment: "#e1306c",
  messenger: "#0084ff",
  facebook_comment: "#1877f2",
  web: "#94a3b8",
};

export const conversationDisplayName = (item = {}) => {
  const profile = item?.customer_profile || {};
  const fullName = [item?.first_name || profile.first_name, item?.last_name || profile.last_name].map(clean).filter(Boolean).join(" ");
  return (
    firstUsefulCustomerName(
      item?.customer_name,
      item?.display_name,
      item?.channel_metadata?.commenter_name,
      fullName,
      item?.customer?.name,
      profile.name,
      profile.full_name,
      profile.display_name,
      item?.phone,
      item?.customer_phone
    ) || clean(item?.session_id).replace(/^[a-z_]+:/i, "") || "Customer"
  );
};

export const conversationPreviewText = (item = {}) => {
  const preview = clean(
    item?.latest_message_preview ||
      item?.last_message_preview ||
      item?.latest_message ||
      item?.last_message ||
      item?.last_customer_message ||
      item?.customer_message_preview ||
      item?.customer_message ||
      item?.message_text
  );
  if (preview) return preview.slice(0, 140);
  const messages = Array.isArray(item?.messages) ? item.messages : [];
  const latest = [...messages].reverse().find((message) => clean(message?.customer_message || message?.message_text || message?.text));
  return clean(latest?.customer_message || latest?.message_text || latest?.text).slice(0, 140);
};

export const conversationUnreadCount = (item = {}) => {
  const count = Number(item?.unread_count ?? item?.unread ?? 0);
  if (Number.isFinite(count) && count > 0) return count;
  return item?.manually_unread === true ? 1 : 0;
};

export const conversationActivityAt = (item = {}) =>
  item?.last_message_at || item?.last_activity_at || item?.updated_at || item?.created_at || null;
