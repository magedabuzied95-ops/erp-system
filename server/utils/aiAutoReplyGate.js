/*
 * When may an automatic AI reply leave — one answer for WhatsApp, Messenger and Instagram.
 *
 * The channels used to read the same switches differently: Meta stopped on a conversation's
 * ai_enabled=false while WhatsApp only logged it; WhatsApp stopped on the global and per-channel
 * "off" modes while Meta never looked at them. And both read the conversation only BEFORE the
 * reply was generated — brain V2 plus the OpenAI rewrite can take 25-75s, long enough for a
 * colleague to take the conversation over and then be talked over by the bot.
 */

const text = (value = "") => String(value ?? "").trim();

// A conversation a person owns, or one the AI was switched off for. Empty when the AI may answer.
export const conversationAutoReplyBlock = (state = null) => {
  if (!state || typeof state !== "object") return "";
  const status = text(state.status).toLowerCase();
  if (status === "human_takeover") return "human_takeover";
  if (status === "closed") return "closed";
  if (state.ai_enabled === false) return "conversation_ai_disabled";
  return "";
};

// The two "off" switches of the AI settings screens: ai_settings.autoReplyMode (every channel)
// and ai_channel_settings.aiMode (this channel). Only an explicit "off" stops a reply here;
// "suggest_only" is left to each channel's own runtime auto-reply switch, as it always was.
export const aiModeSwitchBlock = ({ globalMode = "", channelMode = "" } = {}) => {
  if (text(globalMode).toLowerCase() === "off") return "GLOBAL_OFF";
  if (text(channelMode).toLowerCase() === "off") return "CHANNEL_OFF";
  return "";
};

/*
 * Read the conversation again right before sending. A failed lookup lets the reply through:
 * the gate before generation already passed, and a database blip must not become a new way
 * for a customer to go unanswered.
 */
export const recheckAutoReplyBeforeSend = async ({ loadState } = {}) => {
  let state = null;
  try {
    state = typeof loadState === "function" ? await loadState() : null;
  } catch (error) {
    return { ok: true, reason: "state_lookup_failed", error: error?.message || String(error) };
  }
  const reason = conversationAutoReplyBlock(state);
  return reason ? { ok: false, reason, state } : { ok: true, reason: "", state };
};
