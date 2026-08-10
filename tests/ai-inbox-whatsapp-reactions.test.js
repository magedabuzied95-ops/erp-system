import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { extractWhatsappReactionEvent } from "../server/utils/whatsappReaction.js";

const gateway = fs.readFileSync("server/services/whatsappGatewayService.js", "utf8");
const logService = fs.readFileSync("server/services/aiSupportLogService.js", "utf8");
const inbox = fs.readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const transcript = fs.readFileSync("src/modules/aiSupport/components/TranscriptMessage.jsx", "utf8");

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
});

test("ordinary text messages do not show a technical text type badge", () => {
  assert.match(transcript, /!\["text", "conversation"\]\.includes/);
});
