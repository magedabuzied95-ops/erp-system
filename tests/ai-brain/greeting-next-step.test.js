import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { GREETING_OFFER, greetingReplyFor, greetingReplyParts } from "../../server/utils/greetingReply.js";
import { whatsappReplyParts } from "../../server/services/whatsappGatewayService.js";

/**
 * The owner, 2026-10-19: a greeting is short and in two messages — "وعليكم السلام ورحمة الله",
 * then "تحت أمر حضرتك؟". No "نورتنا", no list of sections. Thanks: "تحت أمر حضرتك ❤️".
 */

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("السلام عليكم is answered in two short messages", () => {
  assert.deepEqual(greetingReplyParts("السلام عليكم"), ["وعليكم السلام ورحمة الله", "تحت أمر حضرتك؟"]);
  assert.equal(greetingReplyFor("السلام عليكم"), "وعليكم السلام ورحمة الله\nتحت أمر حضرتك؟");
});

test("other greetings: the matching greeting back, then the same offer", () => {
  assert.deepEqual(greetingReplyParts("صباح الخير"), ["صباح النور", GREETING_OFFER]);
  assert.deepEqual(greetingReplyParts("مساء الخير"), ["مساء النور", GREETING_OFFER]);
  assert.deepEqual(greetingReplyParts("هاي"), ["أهلاً بيك يا فندم", GREETING_OFFER]);
  assert.deepEqual(greetingReplyParts("عامل ايه"), ["الحمد لله يا فندم", GREETING_OFFER]);
});

test("thanks get تحت أمر حضرتك with a heart, nothing more", () => {
  assert.deepEqual(greetingReplyParts("شكرا"), ["تحت أمر حضرتك ❤️"]);
  assert.deepEqual(greetingReplyParts("متشكر جدا"), ["تحت أمر حضرتك ❤️"]);
});

test("none of the greetings carries the words the owner cut", () => {
  for (const message of ["السلام عليكم", "صباح الخير", "مساء الخير", "هاي", "شكرا"]) {
    const reply = greetingReplyFor(message);
    assert.doesNotMatch(reply, /نورتنا|أساعدك|رجالي|حريمي|أطفال|موديل/, `${message}: ${reply}`);
  }
});

test("WhatsApp sends each part as its own message, unless a guard rewrote the text", () => {
  const aiPayload = { reply_parts: ["وعليكم السلام ورحمة الله", "تحت أمر حضرتك؟"] };
  assert.deepEqual(whatsappReplyParts({ aiPayload, finalText: "وعليكم السلام ورحمة الله\nتحت أمر حضرتك؟" }), aiPayload.reply_parts);
  assert.deepEqual(whatsappReplyParts({ aiPayload, finalText: "وعليكم السلام ورحمة الله، أهلاً" }), [], "a rewritten reply goes as one message");
  assert.deepEqual(whatsappReplyParts({ aiPayload: { reply_parts: ["تحت أمر حضرتك ❤️"] }, finalText: "تحت أمر حضرتك ❤️" }), [], "one part is one message anyway");
  const gateway = read("../../server/services/whatsappGatewayService.js");
  assert.match(gateway, /const replyParts = whatsappReplyParts\(\{ aiPayload: generated\.aiPayload, finalText: safeText \}\);/);
  // An order answer with a tracking button is sent first; a greeting's parts still go one by one.
  assert.match(gateway, /\} else if \(replyParts\.length > 1\) \{\s*for \(const part of replyParts\) \{\s*result = await sendTextMessage\(\{ phone: sendTargetNumber, message: part,/);
});

test("Messenger and Instagram greet with the same parts, the second without a repeated salam", () => {
  const meta = read("../../server/services/metaIntegrationService.js");
  const handler = meta.slice(meta.indexOf("const greetingParts = greetingReplyParts("), meta.indexOf('return { handled: true, reason: "greeting_only" };'));
  assert.match(handler, /for \(const \[partIndex, part\] of greetingParts\.entries\(\)\) \{\s*await sendAndLogMetaText\(\{/);
  assert.match(handler, /text: part,/);
  assert.match(handler, /skipGreetingGuard: partIndex > 0,/);
  assert.match(meta, /if \(!skipGreetingGuard\) safeMessage = applyMetaGreetingGuard\(\{/);
  assert.match(meta, /skipGreetingGuard: metadata\.skipGreetingGuard === true,/);
});

test("brain V2 hands the parts to the channels", async () => {
  const brain = read("../../server/services/aiBrainV2Service.js");
  assert.match(brain, /\.\.\.\(intent === "greeting" \? \{ reply_parts: greetingReplyParts\(originalMessage \|\| message\) \} : \{\}\),/);
  const composer = read("../../server/services/aiSalesReplyComposerService.js");
  assert.match(composer, /SHARED_GREETING_KINDS\.has\(greetingKind\(message\)\)\s*\? greetingReplyFor\(message\)/);
});
