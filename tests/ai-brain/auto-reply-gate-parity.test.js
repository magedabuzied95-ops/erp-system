import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  aiModeSwitchBlock,
  conversationAutoReplyBlock,
  recheckAutoReplyBeforeSend,
} from "../../server/utils/aiAutoReplyGate.js";
import { normalizeChannel } from "../../server/services/aiChannelAdapterService.js";

/**
 * WhatsApp, Messenger and Instagram disagreed on when an automatic AI reply may go out
 * (2026-10-19 review of the customer reply path). The gate rules are tested directly; where
 * they are wired into the 7k/30k-line channel services, the test reads the source and checks
 * the call sits where it has to — each of these fails when its fix is removed.
 */

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const aiInbox = read("../../server/services/aiInboxService.js");
const gateway = read("../../server/services/whatsappGatewayService.js");
const meta = read("../../server/services/metaIntegrationService.js");

const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
};
const indexAfter = (source, needle, from = 0) => {
  const index = source.indexOf(needle, from);
  assert.ok(index >= 0, `not found: ${needle}`);
  return index;
};

// ---- the shared rules ----------------------------------------------------------------------

test("a taken-over, closed or AI-off conversation blocks an automatic reply", () => {
  assert.equal(conversationAutoReplyBlock({ status: "human_takeover", ai_enabled: true }), "human_takeover");
  assert.equal(conversationAutoReplyBlock({ status: "CLOSED" }), "closed");
  assert.equal(conversationAutoReplyBlock({ status: "ai_active", ai_enabled: false }), "conversation_ai_disabled");
  assert.equal(conversationAutoReplyBlock({ status: "ai_active", ai_enabled: true }), "");
  assert.equal(conversationAutoReplyBlock(null), "", "an unknown conversation is a new one, not a paused one");
});

test("only an explicit off on the AI settings screens stops a reply", () => {
  assert.equal(aiModeSwitchBlock({ globalMode: "off", channelMode: "fully_automatic" }), "GLOBAL_OFF");
  assert.equal(aiModeSwitchBlock({ globalMode: "suggest_only", channelMode: "OFF" }), "CHANNEL_OFF");
  assert.equal(aiModeSwitchBlock({ globalMode: "suggest_only", channelMode: "suggest_only" }), "");
  assert.equal(aiModeSwitchBlock({}), "");
});

test("the pre-send re-check reads the conversation NOW and drops a taken-over reply", async () => {
  let reads = 0;
  const blocked = await recheckAutoReplyBeforeSend({
    loadState: async () => {
      reads += 1;
      return { status: "human_takeover" };
    },
  });
  assert.equal(reads, 1);
  assert.deepEqual([blocked.ok, blocked.reason], [false, "human_takeover"]);

  const free = await recheckAutoReplyBeforeSend({ loadState: async () => ({ status: "ai_active", ai_enabled: true }) });
  assert.equal(free.ok, true);
});

test("a failed re-check lookup lets the reply through rather than going silent", async () => {
  const result = await recheckAutoReplyBeforeSend({ loadState: async () => { throw new Error("db down"); } });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "state_lookup_failed");
});

// ---- 1. re-check right before sending --------------------------------------------------------

test("WhatsApp re-reads the conversation after generation and before any send", () => {
  const trigger = between(gateway, "export const triggerWhatsappAiAutoReply", "\n};\n");
  const generatedAt = indexAfter(trigger, "await generateWhatsappAiAutoReply(");
  const recheckAt = indexAfter(trigger, "await recheckWhatsappAutoReplyBeforeSend(");
  assert.ok(recheckAt > generatedAt, "the re-check must run after the (slow) generation");
  for (const send of ["buildWhatsappOutboundPlan(", "sendTextMessage(", "sendImageMessage(", "appendAiGeneratedSupportReply("]) {
    assert.ok(recheckAt < indexAfter(trigger, send, generatedAt), `the re-check must come before ${send}`);
  }
  assert.match(trigger.slice(recheckAt, recheckAt + 1600), /if \(!preSendCheck\.ok\) \{[\s\S]*?return \{ \.\.\.generated, sent: false, reason: preSendCheck\.reason \}/);
  assert.match(aiInbox, /export const recheckWhatsappAutoReplyBeforeSend = [\s\S]{0,200}getAiSupportConversationState\(\{ tenantId, sessionId \}\)/);
});

test("Meta re-reads the conversation after generation and before any send", () => {
  const generatedAt = indexAfter(meta, "aiPayload = await routeMessageThroughAi({ req, message, config });");
  const recheckAt = indexAfter(meta, "await recheckAutoReplyBeforeSend({", generatedAt);
  for (const send of ["sendAndLogMetaText({", "sendMetaInboxOutboundMessage({"]) {
    assert.ok(recheckAt < indexAfter(meta, send, generatedAt), `the re-check must come before the first ${send} after generation`);
  }
  assert.ok(recheckAt < indexAfter(meta, "const reply = aiPayload.channel_reply", generatedAt));
  assert.match(meta.slice(recheckAt, recheckAt + 1400), /channel: message\.channel,[\s\S]*?if \(!preSendCheck\.ok\) \{[\s\S]*?continue;/);
});

// ---- 2. brain V2 throwing on WhatsApp --------------------------------------------------------

test("a brain V2 error on WhatsApp is recorded, not thrown to the webhook route", () => {
  const generate = between(aiInbox, "export const generateWhatsappAiAutoReply", "\nexport const logWhatsappAiOutbound");
  const call = indexAfter(generate, "unifiedDecision = await generateUnifiedConversationDecision(");
  const tryAt = generate.lastIndexOf("try {", call);
  assert.ok(tryAt >= 0 && call - tryAt < 40, "the decision call must be the first thing inside a try block");
  assert.match(generate.slice(call), /^[\s\S]*?\} catch \(error\) \{\s*return recordWhatsappAiGenerationFailure\(/);
  assert.doesNotMatch(aiInbox, /routeWhatsappMessageThroughAi/, "the dead second try/catch and its legacy route are gone");

  const recorder = between(aiInbox, "const recordWhatsappAiGenerationFailure", "\n};\n");
  for (const step of ["appendAiGeneratedSupportReply(", "logAIPersistentEvent(", "failTrace(", 'reason: "ai_generation_failed"']) {
    assert.ok(recorder.includes(step), `the failure must still reach ${step}`);
  }
});

// ---- 3. the same off switches on every channel -----------------------------------------------

test("WhatsApp obeys a conversation's ai_enabled=false", () => {
  const gate = between(aiInbox, "const shouldAutoReplyToWhatsapp", "\n};\n");
  assert.match(gate, /conversationAutoReplyBlock\(state\) === "conversation_ai_disabled"\) return \{ ok: false, reason: "conversation_ai_disabled"/);
  assert.match(gate, /aiModeSwitchBlock\(\{ globalMode, channelMode \}\)/);
});

test("Meta obeys the global and per-channel AI mode off switches", () => {
  const pauseAt = indexAfter(meta, 'reason: "global_pause" });\n      continue;');
  const switchAt = indexAfter(meta, "aiModeSwitchBlock({", pauseAt);
  const lockAt = indexAfter(meta, "await claimAiInboxReplyLock({", pauseAt);
  assert.ok(switchAt < lockAt, "the off switches are read with the other doors, before the reply lock and generation");
  const block = meta.slice(pauseAt, lockAt);
  assert.match(block, /globalMode: globalModeSettings\?\.autoReplyMode/);
  assert.match(block, /channelMode: channelModeSettings\?\.aiMode/);
  assert.match(block, /getAIChannelSettings\(metaAiChannel, alias\)/);
  assert.match(block, /if \(modeSwitchBlock\) \{[\s\S]*?continue;/);
});

// ---- 4. Messenger is not web_chat ------------------------------------------------------------

test("Messenger reaches brain V2 as facebook_messenger, not web_chat", () => {
  assert.equal(normalizeChannel("facebook"), "web_chat", "the alias the old code passed is unknown to the adapter");
  assert.equal(normalizeChannel("facebook_messenger"), "facebook_messenger");
  assert.match(meta, /const metaUnifiedDecisionChannel = \(channel = ""\) => adapterChannel\(channelAlias\(channel\)\);/);
  const calls = meta.split("return generateUnifiedConversationDecision({").slice(1);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.slice(0, 120), /^\s*channel: metaUnifiedDecisionChannel\((channel|alias)\),/);
    assert.match(call, /metadata: \{[\s\S]{0,200}channel: metaUnifiedDecisionChannel\((channel|alias)\),/);
  }
});

// ---- 5. model-name search sent its text twice on Meta -----------------------------------------

test("after the model-name intro is sent, the carousel does not repeat it", () => {
  const block = between(meta, "let introAlreadySent = false;", "if (sendResult?.dedupe_skipped)");
  assert.match(block, /introAlreadySent = Boolean\(introSend\?\.message_id\);/);
  assert.match(block, /sendMetaInboxOutboundMessage\(\{[\s\S]*?messageText: introAlreadySent \? "" : replyTextForSend,/);
});
