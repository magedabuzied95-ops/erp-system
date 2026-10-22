// Readers shared by QuickConversationThread and its two homes (the mini chat
// dock and the side chat). Kept out of the component file so fast refresh can
// treat that file as components only.

export const clean = (value) => String(value ?? "").trim();

export const isOutbound = (message = {}) => {
  const sender = clean(message.sender_type).toLowerCase();
  if (message.from_me === true || message.fromMe === true) return true;
  if (clean(message.direction).toLowerCase() === "outbound") return true;
  return Boolean(sender) && sender !== "customer" && sender !== "user";
};

// The identities one conversation can arrive under on the socket. WhatsApp rows
// are keyed three ways (session id, conversation key, bare phone) and a realtime
// payload may carry any of them.
const digitsOf = (value = "") => clean(value).replace(/^[a-z_]+:/i, "").replace(/\D/g, "");

export const sameConversation = (item = {}, payload = {}) => {
  const ours = [item.session_id, item.conversation_id, item.conversation_key].map(clean).filter(Boolean);
  const theirs = [payload.session_id, payload.conversation_key, payload.conversation_id, payload.message?.session_id].map(clean).filter(Boolean);
  if (!ours.length || !theirs.length) return false;
  if (theirs.some((candidate) => ours.includes(candidate))) return true;
  const ourDigits = ours.map(digitsOf).filter((digits) => digits.length >= 8);
  return theirs.map(digitsOf).some((digits) => digits.length >= 8 && ourDigits.includes(digits));
};

export const conversationSessionId = (item = {}) => clean(item?.session_id || item?.conversation_id || item?.conversation_key);
