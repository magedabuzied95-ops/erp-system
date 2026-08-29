import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  channelFromConversationSessionId,
  isWeakConversationChannel,
  pruneWeakConversationChannels,
  resolveConversationChannel,
  resolvedConversationChannelSql,
  writableConversationChannel,
} from "../server/utils/inboxChannelIdentity.js";

import {
  WEAK_CONVERSATION_CHANNELS,
  channelFromConversationSessionId as clientChannelFromSessionId,
} from "../src/modules/aiSupport/services/inboxChannels.js";

const logService = fs.readFileSync(new URL("../server/services/aiSupportLogService.js", import.meta.url), "utf8");
const salesService = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
const inboxSource = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwaSource = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");

// --- the rule ---------------------------------------------------------------

test("web_chat is a weak channel, real channels are not", () => {
  for (const weak of ["", "web", "web_chat", "WEB_CHAT", " Web "]) {
    assert.equal(isWeakConversationChannel(weak), true, `${JSON.stringify(weak)} should be weak`);
  }
  for (const strong of ["whatsapp", "instagram", "facebook_messenger", "telegram", "facebook_comment"]) {
    assert.equal(isWeakConversationChannel(strong), false, `${strong} should be strong`);
  }
});

test("the session id names the channel its ingest path minted", () => {
  assert.equal(channelFromConversationSessionId("whatsapp:201024960585"), "whatsapp");
  assert.equal(channelFromConversationSessionId("whatsapp:lid:123456789012"), "whatsapp");
  assert.equal(channelFromConversationSessionId("facebook_messenger:987654321"), "facebook_messenger");
  assert.equal(channelFromConversationSessionId("messenger:987654321"), "facebook_messenger");
  assert.equal(channelFromConversationSessionId("instagram:17841400000"), "instagram");
  assert.equal(channelFromConversationSessionId("telegram:55512345"), "telegram");
  // A genuine web chat is keyed by an opaque browser session id.
  assert.equal(channelFromConversationSessionId("sess_9f2a4c"), "");
  assert.equal(channelFromConversationSessionId(""), "");
});

test("a stored web_chat defers to the session id, a stored channel never does", () => {
  assert.equal(
    resolveConversationChannel({ sessionId: "whatsapp:201024960585", storedChannel: "web_chat" }),
    "whatsapp",
    "the reported bug: a WhatsApp thread stored as web_chat must read back as WhatsApp"
  );
  assert.equal(resolveConversationChannel({ sessionId: "whatsapp:201024960585", storedChannel: "" }), "whatsapp");
  // Comment threads are keyed by a messenger-shaped id; flattening them into DMs
  // would move them out of the Social Comments section.
  assert.equal(
    resolveConversationChannel({ sessionId: "facebook_messenger:987654321", storedChannel: "facebook_comment" }),
    "facebook_comment"
  );
  // A real web chat stays a web chat.
  assert.equal(resolveConversationChannel({ sessionId: "sess_9f2a4c", storedChannel: "web_chat" }), "web_chat");
});

test("an unknown channel is written as empty, never as an invented web_chat", () => {
  assert.equal(writableConversationChannel({ sessionId: "whatsapp:201024960585", channel: "" }), "whatsapp");
  assert.equal(writableConversationChannel({ sessionId: "whatsapp:201024960585", channel: "web_chat" }), "whatsapp");
  assert.equal(writableConversationChannel({ sessionId: "sess_9f2a4c", channel: "" }), "");
  // A caller that DOES know keeps its answer.
  assert.equal(writableConversationChannel({ sessionId: "sess_9f2a4c", channel: "instagram" }), "instagram");
  // `source`-shaped fallbacks only apply once the session id has nothing to say.
  assert.equal(writableConversationChannel({ sessionId: "whatsapp:201024960585", channel: "", fallbackChannel: "admin_console" }), "whatsapp");
});

test("a defaulted web_chat never joins the channels a toggle fans out over", () => {
  assert.deepEqual(pruneWeakConversationChannels(["whatsapp", "web_chat"], "whatsapp:201024960585"), ["whatsapp"]);
  assert.deepEqual(pruneWeakConversationChannels(["web_chat"], "whatsapp:201024960585"), ["whatsapp"]);
  // Nothing to go on: the weak value is all there is, so it survives.
  assert.deepEqual(pruneWeakConversationChannels(["web_chat"], "sess_9f2a4c"), ["web_chat"]);
  assert.deepEqual(pruneWeakConversationChannels([], "sess_9f2a4c"), []);
});

test("the browser twin agrees with the server on both halves of the rule", () => {
  for (const weak of ["", "web", "web_chat"]) {
    assert.equal(WEAK_CONVERSATION_CHANNELS.has(weak), isWeakConversationChannel(weak));
  }
  for (const sessionId of ["whatsapp:201024960585", "whatsapp:lid:123456789012", "instagram:17841400000", "telegram:55512345", "sess_9f2a4c"]) {
    assert.equal(clientChannelFromSessionId({ session_id: sessionId }), channelFromConversationSessionId(sessionId));
  }
});

// --- the write guards -------------------------------------------------------

test("no ai_support_sessions upsert can downgrade a stored channel to web_chat", () => {
  // The guard exists…
  assert.match(logService, /const sessionChannelNoDowngradeSql = \(incomingSql\) => `CASE/);
  assert.match(logService, /IN \('', 'web', 'web_chat'\) THEN ai_support_sessions\.channel/);
  // …and every ON CONFLICT branch that writes the column goes through it.
  const guarded = logService.match(/channel = \$\{sessionChannelNoDowngradeSql\(/g) || [];
  assert.ok(guarded.length >= 4, `expected every channel upsert to be guarded, found ${guarded.length}`);
  assert.doesNotMatch(
    logService,
    /channel = COALESCE\(NULLIF\(EXCLUDED\.channel, ''\), ai_support_sessions\.channel\)/,
    "NULLIF only skips the empty string — a defaulted 'web_chat' sails straight through it"
  );
  assert.doesNotMatch(
    logService,
    /channel = COALESCE\(EXCLUDED\.channel, ai_support_sessions\.channel\)/,
    "COALESCE only skips NULL, and this column is NOT NULL"
  );
});

test("starring a conversation cannot invent a channel for it", () => {
  assert.match(logService, /const resolvedChannel = writableConversationChannel\(\{/);
  assert.doesNotMatch(logService, /const resolvedChannel = conversationReference\.channel \|\| safeChannel \|\| "web_chat"/);
  // And the response echoes the STORED channel, not the guess.
  assert.match(logService, /channel: toText\(result\.rows\[0\]\.channel\) \|\| resolvedChannel/);
});

test("deriving whatsapp from the session id cannot drop a message", () => {
  // normalizeCanonicalWhatsappSessionId returns "" for an identity it cannot key,
  // and an empty session id is rejected by the guard further down.
  assert.match(logService, /normalizeCanonicalWhatsappSessionId(sessionId, resolvedPhone || remoteJid || externalMessageId || providerMessageId) || toText(sessionId)/);
});

test("the transcript writer derives an unknown channel instead of defaulting it", () => {
  assert.match(logService, /const safeChannel = writableConversationChannel\(\{ sessionId, channel \}\) \|\| "web_chat"/);
  assert.doesNotMatch(logService, /const safeChannel = toText\(channel \|\| "web_chat"\)/);
  assert.doesNotMatch(logService, /sessionChannel: channel \|\| "web_chat"/);
});

test("a toggle never fans a defaulted web_chat into ai_channel_conversations", () => {
  const pruned = logService.match(/pruneWeakConversationChannels\(\[/g) || [];
  assert.equal(pruned.length, 2, "both AI-state and conversation-state fan-outs must prune");
});

// --- the read path ----------------------------------------------------------

test("the inbox list resolves the channel instead of trusting the stored column", () => {
  assert.match(salesService, /const INBOX_RESOLVED_CHANNEL_SQL = resolvedConversationChannelSql\("COALESCE\(c\.channel, s\.channel, s\.source\)", "s\.session_id"\)/);
  // Clauses, projections and sorts all read the same expression, or the badge
  // and the channel chips disagree about the same row.
  const uses = salesService.match(/\$\{INBOX_RESOLVED_CHANNEL_SQL\}/g) || [];
  assert.ok(uses.length >= 13, `expected every channel site to use it, found ${uses.length}`);
  assert.doesNotMatch(
    salesService.replace(/const INBOX_RESOLVED_CHANNEL_SQL = .*/, ""),
    /COALESCE\(c\.channel, s\.channel, s\.source\)/,
    "no site may read the raw stored channel any more"
  );
});

test("a phantom web_chat conversation row cannot outrank the real one", () => {
  assert.match(
    salesService,
    /CASE WHEN lower\(COALESCE\(channel_conversation\.channel, ''\)\) IN \('web', 'web_chat'\) THEN 1 ELSE 0 END,\s*\r?\n\s*CASE WHEN channel_conversation\.channel = s\.channel THEN 0 ELSE 1 END/
  );
});

test("the resolved-channel SQL repairs only the weak values", () => {
  const sql = resolvedConversationChannelSql("s.channel", "s.session_id");
  assert.match(sql, /IN \('', 'web', 'web_chat'\)/);
  assert.match(sql, /'\^whatsapp:'/);
  assert.match(sql, /'\^\(facebook_messenger\|messenger\|facebook\):'/);
  assert.match(sql, /'\^instagram:'/);
  assert.match(sql, /'\^telegram:'/);
  assert.match(sql, /ELSE s\.channel/);
});

test("both inbox renderers repair a stored web_chat from the session id", () => {
  for (const [name, source] of [["AiInbox.jsx", inboxSource], ["AiInboxPwa.jsx", pwaSource]]) {
    assert.match(source, /WEAK_CONVERSATION_CHANNELS/, `${name} must know which values are weak`);
    assert.match(source, /channelFromConversationSessionId\(conversation\) \|\| stored/, `${name} must repair from the session id`);
  }
});

test("the favorite request carries the channel the way the read toggle does", () => {
  assert.match(inboxSource, /is_favorite: nextFavorite, \.\.\.\(channel \? \{ channel \} : \{\}\)/);
});

// --- the repair backfill ----------------------------------------------------

test("startup repairs conversations already rebadged as Web Chat", () => {
  assert.match(logService, /channel_repair_sessions_by_prefix/);
  assert.match(logService, /channel_repair_sessions_by_message_evidence/);
  assert.match(logService, /channel_repair_channel_conversations_by_prefix/);
  // It runs inside bootstrapStartup, where a throw exits the process, so every
  // statement is caught and none of them can collide on a unique key.
  const repairs = logService.match(/\.catch\(\(error\) => logSqlError\("channel_repair_/g) || [];
  assert.equal(repairs.length, 3);
  assert.match(logService, /AND existing\.channel = repaired\.channel/);
  assert.doesNotMatch(logService, /DELETE FROM ai_channel_conversations/);
});
