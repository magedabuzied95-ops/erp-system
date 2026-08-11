const text = (value = "") => String(value ?? "").trim();

const objectValue = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (!text(value)) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const aiInboxOrderMetadata = (order = {}) => objectValue(order.ai_agent_metadata || order.ai_metadata);

export const aiInboxOrderConversationId = (order = {}) => {
  const metadata = aiInboxOrderMetadata(order);
  return text(
    order.ai_agent_conversation_id ||
      order.ai_agent_session_id ||
      metadata.conversation_id ||
      metadata.session_id ||
      metadata.conversation_key
  );
};

export const normalizeAiInboxOrderChannel = (value = "") => {
  const channel = text(value).toLowerCase();
  if (channel.includes("instagram")) return "instagram";
  if (channel.includes("messenger") || channel === "facebook" || channel.startsWith("facebook_")) return "messenger";
  if (channel.includes("whatsapp")) return "whatsapp";
  if (channel.includes("web")) return "web";
  return channel;
};

export const aiInboxOrderChannel = (order = {}) => {
  const metadata = aiInboxOrderMetadata(order);
  return normalizeAiInboxOrderChannel(
    metadata.channel ||
      metadata.source_channel ||
      order.source_channel ||
      order.channel ||
      order.source
  );
};

export const buildAiInboxOrderUrl = (order = {}) => {
  const conversationId = aiInboxOrderConversationId(order);
  if (!conversationId) return "";
  const params = new URLSearchParams({ conversation: conversationId });
  const channel = aiInboxOrderChannel(order);
  if (channel) params.set("channel", channel);
  return `/admin/ai-inbox?${params.toString()}`;
};

