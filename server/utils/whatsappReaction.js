const clean = (value = "") => String(value ?? "").trim();

const primaryData = (payload = {}) => {
  const data = payload?.data ?? payload?.body?.data ?? payload;
  return Array.isArray(data) ? (data[0] || {}) : (data || {});
};

const reactionCandidates = (payload = {}) => {
  const data = primaryData(payload);
  const message = data?.message || data?.messages?.[0]?.message || payload?.message || payload?.body?.message || {};
  return [
    message?.reactionMessage,
    message?.reaction,
    data?.reactionMessage,
    data?.reaction,
    payload?.reactionMessage,
    payload?.reaction,
    payload?.body?.data?.message?.reactionMessage,
  ];
};

export const extractWhatsappReactionEvent = (payload = {}) => {
  const reaction = reactionCandidates(payload).find((candidate) => candidate && typeof candidate === "object");
  if (!reaction) {
    return { isReaction: false, emoji: "", targetMessageId: "", targetFromMe: null };
  }

  const targetKey = reaction.key || reaction.messageKey || reaction.targetKey || {};
  const rawTargetFromMe = targetKey.fromMe ?? reaction.targetFromMe;
  return {
    isReaction: true,
    emoji: clean(reaction.text ?? reaction.emoji ?? reaction.reaction),
    targetMessageId: clean(targetKey.id || reaction.messageId || reaction.message_id || reaction.targetMessageId),
    targetFromMe: typeof rawTargetFromMe === "boolean" ? rawTargetFromMe : null,
  };
};
