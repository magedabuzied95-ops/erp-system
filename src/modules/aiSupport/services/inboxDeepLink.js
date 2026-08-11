const text = (value = "") => String(value ?? "").trim();

export const normalizeInboxDeepLinkChannel = (value = "") => {
  const channel = text(value).toLowerCase();
  if (channel.includes("instagram")) return "instagram";
  if (channel.includes("messenger") || channel === "facebook" || channel.startsWith("facebook_")) return "messenger";
  if (channel.includes("whatsapp")) return "whatsapp";
  if (channel.includes("web")) return "web";
  return "";
};

const identityWithoutChannel = (value = "") =>
  text(value).replace(/^(?:facebook_messenger|messenger|facebook|instagram|whatsapp|web_chat|web):/i, "");

const conversationChannel = (conversation = {}) =>
  normalizeInboxDeepLinkChannel(conversation.channel || conversation.source || conversation.platform || conversation.provider);

export const findDeepLinkedConversation = (conversations = [], target = "", requestedChannel = "") => {
  const rawTarget = text(target);
  if (!rawTarget) return null;
  const targetIdentity = identityWithoutChannel(rawTarget);
  const channel = normalizeInboxDeepLinkChannel(requestedChannel || rawTarget.split(":")[0]);

  return (Array.isArray(conversations) ? conversations : []).find((conversation) => {
    if (!conversation) return false;
    if (channel && conversationChannel(conversation) && conversationChannel(conversation) !== channel) return false;
    const candidates = [
      conversation.conversation_key,
      conversation.session_id,
      conversation.conversation_id,
      conversation.external_conversation_id,
      conversation.external_customer_id,
      conversation.id,
    ].map(text).filter(Boolean);
    return candidates.some((candidate) => candidate === rawTarget || identityWithoutChannel(candidate) === targetIdentity);
  }) || null;
};

