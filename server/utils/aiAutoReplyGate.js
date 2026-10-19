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
 * Would a reply on this channel leave on its own? The channel-level switches only, in the order
 * the live paths read them — WhatsApp: shouldAutoReplyToWhatsapp (aiInboxService), Meta: the
 * webhook auto-reply loop (metaIntegrationService). The conversation's own state is not part of
 * it. The playground uses this so its "would it be sent" answer is the server's, not a guess
 * from the legacy ai_settings modes alone (those said "no" while the channel replied live).
 */
const AUTOMATIC_RUNTIME_MODES = new Set(["fully_automatic", "automatic"]);
const META_HELD_MODES = new Set(["suggest_only", "auto_reply_after_approval"]);

export const channelAutoSendDecision = ({
  channel = "",
  agentSettings = {},
  globalMode = "",
  channelMode = "",
  runtimeSettings = {},
  whatsappAutoReplyEnv = "",
} = {}) => {
  const isWhatsapp = text(channel).toLowerCase() === "whatsapp";
  const runtimeMode = text(runtimeSettings?.auto_reply_mode || (runtimeSettings?.ai_replies_enabled === true ? "fully_automatic" : "off")).toLowerCase();
  const decide = (automatic, reason) => ({ automatic, reason, runtimeMode });
  if (isWhatsapp && text(whatsappAutoReplyEnv).toLowerCase() === "false") return decide(false, "WHATSAPP_AI_AUTO_REPLY_OFF");
  if (agentSettings?.ai_assistant_global_enabled === false) return decide(false, "AI_ASSISTANT_GLOBAL_PAUSED");
  const modeBlock = aiModeSwitchBlock({ globalMode, channelMode });
  if (modeBlock) return decide(false, modeBlock);
  if (runtimeSettings?.ai_replies_enabled !== true || runtimeMode === "off") return decide(false, "AUTO_REPLY_OFF");
  if (isWhatsapp) {
    return AUTOMATIC_RUNTIME_MODES.has(runtimeMode) ? decide(true, "fully_automatic") : decide(false, "SUGGEST_ONLY");
  }
  return META_HELD_MODES.has(runtimeMode) ? decide(false, "SUGGEST_ONLY") : decide(true, "fully_automatic");
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
