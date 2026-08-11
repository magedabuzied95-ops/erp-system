import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { extractWhatsappReactionEvent, normalizeWhatsappReactionEmoji } from "../server/utils/whatsappReaction.js";

const gateway = fs.readFileSync("server/services/whatsappGatewayService.js", "utf8");
const routes = fs.readFileSync("server/routes/aiAgentOrders.js", "utf8");
const logService = fs.readFileSync("server/services/aiSupportLogService.js", "utf8");
const inbox = fs.readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const pwaInbox = fs.readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8");
const transcript = fs.readFileSync("src/modules/aiSupport/components/TranscriptMessage.jsx", "utf8");
const cacheStore = fs.readFileSync("src/modules/aiSupport/services/inboxCache/inboxCacheStore.js", "utf8");

test("Evolution reactionMessage keeps the emoji and exact target message id", () => {
  const event = extractWhatsappReactionEvent({
    event: "messages.upsert",
    data: {
      key: { id: "reaction-event", fromMe: false },
      message: {
        reactionMessage: {
          key: { id: "target-message", fromMe: true },
          text: "❤️",
        },
      },
    },
  });
  assert.deepEqual(event, {
    isReaction: true,
    emoji: "❤️",
    targetMessageId: "target-message",
    targetFromMe: true,
  });
});

test("an empty reaction is recognized as removal instead of a blank message", () => {
  const event = extractWhatsappReactionEvent({
    data: { message: { reactionMessage: { key: { id: "target-message" }, text: "" } } },
  });
  assert.equal(event.isReaction, true);
  assert.equal(event.emoji, "");
  assert.equal(event.targetMessageId, "target-message");
});

test("a plain heart uses WhatsApp emoji presentation instead of a white text glyph", () => {
  assert.equal(normalizeWhatsappReactionEmoji("❤"), "❤️");
});

test("reaction webhooks use a dedicated persistence route and never reach normal message handling", () => {
  assert.match(gateway, /const reactionEvent = extractWhatsappReactionEvent\(payload\)/);
  assert.match(gateway, /if \(reactionEvent\.isReaction\) \{/);
  assert.match(gateway, /upsertAiSupportMessageReaction\(/);
  assert.match(gateway, /reason: "whatsapp_reaction"/);
  assert.match(logService, /messageType: "reaction"/);
  assert.match(logService, /externalReplyId: safeTargetMessageId/);
  assert.match(logService, /DELETE FROM ai_support_messages[\s\S]*message_type = 'reaction'/);
});

test("AI Inbox attaches reactions to their target bubble and hides raw reaction rows", () => {
  assert.match(inbox, /const reactionsByTarget = new Map\(\)/);
  assert.match(inbox, /external_reply_id/);
  assert.match(inbox, /message_type\)\.toLowerCase\(\) !== "reaction"/);
  assert.match(transcript, /data-ai-message-reactions="true"/);
  assert.match(inbox, /const providerIds = \[\.\.\.new Set\(/);
});

test("AI Inbox and PWA expose the WhatsApp-style quick reaction picker", () => {
  assert.match(transcript, /QUICK_MESSAGE_REACTIONS/);
  assert.match(transcript, /data-ai-message-reaction-picker="true"/);
  assert.match(transcript, /effectiveOwnReaction === emoji \? "" : emoji/);
  assert.match(inbox, /onReact=\{isWhatsappChannel/);
  assert.match(pwaInbox, /onReact=\{isWhatsappChannel/);
  assert.ok(
    transcript.indexOf("setLocalReaction(nextEmoji)") < transcript.indexOf("await onReact({"),
    "the reaction must render optimistically before the provider request finishes",
  );
});

test("outbound WhatsApp reactions use Evolution's reaction endpoint and are persisted", () => {
  assert.match(gateway, /\/message\/sendReaction\/\$\{encodeURIComponent\(current\.instanceName\)\}/);
  assert.match(gateway, /key:\s*\{[\s\S]*remoteJid: safeRemoteJid,[\s\S]*fromMe: targetFromMe === true,[\s\S]*id: safeTargetMessageId/);
  assert.match(gateway, /reaction: safeEmoji/);
  assert.match(routes, /\/conversations\/:conversationId\/reaction/);
  assert.match(routes, /sendWhatsappReaction\(\{ remoteJid, targetMessageId, targetFromMe, emoji \}\)/);
  assert.match(routes, /upsertAiSupportMessageReaction\(\{/);
  assert.doesNotMatch(routes, /SELECT id, provider_message_id, external_message_id, remote_jid, resolved_reply_jid, resolved_phone, direction/);
});

test("ordinary text messages do not show a technical text type badge", () => {
  assert.match(transcript, /!\["text", "conversation"\]\.includes/);
});

test("the transcript cache version drops stale standalone reaction snapshots", () => {
  assert.match(cacheStore, /SCHEMA_VERSION = 2/);
});
