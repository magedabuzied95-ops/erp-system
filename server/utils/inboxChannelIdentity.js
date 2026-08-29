// Which channel a conversation belongs to — and, more importantly, which stored
// values are allowed to answer that question.
//
// Background: `ai_support_sessions.channel` and `ai_channel_conversations.channel`
// are plain TEXT columns declared `NOT NULL DEFAULT 'web_chat'`. Around a dozen
// admin actions upsert a session (star it, send a staff reply, take it over,
// mark it read, log an internal note) and every one of them used to default a
// missing channel to the literal `"web_chat"` before writing it. Because the
// value is non-empty, `COALESCE(NULLIF(EXCLUDED.channel, ''), …)` does not stop
// it: the default overwrites the real channel and a live WhatsApp thread is
// rebadged "Web Chat" for good — it only heals if the customer happens to send
// another inbound message.
//
// The rule this module encodes: `web_chat` (and its `web` alias, and the empty
// string) is a WEAK value. It is what the schema falls back to, never something
// an ingest path asserts. A weak value must never overwrite a stored channel,
// and must lose to the channel prefix carried by the session id.
//
// The session id is the reliable signal because the ingest paths mint it —
// `whatsapp:<phone>`, `whatsapp:lid:<lid>`, `facebook_messenger:<psid>`,
// `instagram:<igsid>`, `telegram:<chat>` — and nothing rewrites it afterwards.

const text = (value = "") => String(value ?? "").trim();

// The values that mean "nobody told us", not "this is a web chat".
export const WEAK_CONVERSATION_CHANNELS = new Set(["", "web", "web_chat"]);

export const isWeakConversationChannel = (value = "") =>
  WEAK_CONVERSATION_CHANNELS.has(text(value).toLowerCase());

// Ordered: the first prefix that matches wins. `facebook_messenger:` has to be
// tested before `facebook:` would ever be reached, which the single alternation
// below handles by listing the longest alias first.
const SESSION_ID_CHANNEL_PREFIXES = [
  [/^whatsapp:/i, "whatsapp"],
  [/^(?:facebook_messenger|messenger|facebook):/i, "facebook_messenger"],
  [/^instagram:/i, "instagram"],
  [/^telegram:/i, "telegram"],
];

/**
 * The channel stamped into a conversation's session id, or "" when the id
 * carries no recognised prefix (legacy rows, and genuine web-chat sessions,
 * which are keyed by an opaque browser session id).
 */
export const channelFromConversationSessionId = (sessionId = "") => {
  const raw = text(sessionId);
  if (!raw) return "";
  const match = SESSION_ID_CHANNEL_PREFIXES.find(([pattern]) => pattern.test(raw));
  return match ? match[1] : "";
};

/**
 * The channel to trust for a conversation.
 *
 * A specific stored channel always wins — including `facebook_comment` and
 * `instagram_comment`, whose threads are keyed by a messenger-shaped session id
 * and would otherwise be flattened into DMs. Only a weak stored value defers to
 * the session-id prefix.
 */
export const resolveConversationChannel = ({ sessionId = "", storedChannel = "", fallback = "" } = {}) => {
  const stored = text(storedChannel).toLowerCase();
  if (!isWeakConversationChannel(stored)) return stored;
  return channelFromConversationSessionId(sessionId) || stored || text(fallback).toLowerCase();
};

/**
 * The channel to WRITE for a conversation, given whatever the caller knew.
 * Returns "" when nothing is known, so callers can pass an empty string into a
 * `NULLIF(…, '')` guard instead of inventing a `web_chat` that clobbers.
 */
export const writableConversationChannel = ({ sessionId = "", channel = "", fallbackChannel = "" } = {}) => {
  const candidate = text(channel).toLowerCase();
  if (!isWeakConversationChannel(candidate)) return candidate;
  const fromSessionId = channelFromConversationSessionId(sessionId);
  if (fromSessionId) return fromSessionId;
  const fallback = text(fallbackChannel).toLowerCase();
  if (!isWeakConversationChannel(fallback)) return fallback;
  return candidate || fallback;
};

/**
 * Drops the weak channel from a set of channels to fan a write out over, unless
 * it is the only thing we have. Without this, an admin action that never knew
 * the channel mints a phantom `web_chat` row in `ai_channel_conversations`
 * alongside the real one, and the inbox list join can pick the phantom.
 */
export const pruneWeakConversationChannels = (channels = [], sessionId = "") => {
  const list = [...new Set((Array.isArray(channels) ? channels : [channels]).map((value) => text(value).toLowerCase()).filter(Boolean))];
  const strong = list.filter((value) => !isWeakConversationChannel(value));
  if (strong.length) return strong;
  const fromSessionId = channelFromConversationSessionId(sessionId);
  return fromSessionId ? [fromSessionId] : list;
};

// ---------------------------------------------------------------------------
// SQL twins. The read path has to agree with the JS above or the badge, the
// channel chips and the ordering disagree about the same row.
// ---------------------------------------------------------------------------

const WEAK_CHANNEL_SQL_LIST = "('', 'web', 'web_chat')";

/** `true` when the stored channel expression carries no real information. */
export const weakChannelSql = (storedChannelSql) =>
  `lower(COALESCE(${storedChannelSql}, '')) IN ${WEAK_CHANNEL_SQL_LIST}`;

/** The channel implied by a session id column, or '' when it has no prefix. */
export const channelFromSessionIdSql = (sessionIdSql) => `
      CASE
        WHEN ${sessionIdSql} ~* '^whatsapp:' THEN 'whatsapp'
        WHEN ${sessionIdSql} ~* '^(facebook_messenger|messenger|facebook):' THEN 'facebook_messenger'
        WHEN ${sessionIdSql} ~* '^instagram:' THEN 'instagram'
        WHEN ${sessionIdSql} ~* '^telegram:' THEN 'telegram'
        ELSE ''
      END`;

/**
 * SQL twin of resolveConversationChannel: repairs a stored `web_chat` from the
 * session-id prefix, and leaves every specific stored channel untouched.
 *
 * This is the self-healing half of the fix — already-clobbered rows read back
 * correctly without waiting for the repair backfill or a new inbound message.
 */
export const resolvedConversationChannelSql = (storedChannelSql, sessionIdSql) => `
    CASE
      WHEN ${weakChannelSql(storedChannelSql)}
        THEN COALESCE(NULLIF(${channelFromSessionIdSql(sessionIdSql)}, ''), ${storedChannelSql})
      ELSE ${storedChannelSql}
    END`;
