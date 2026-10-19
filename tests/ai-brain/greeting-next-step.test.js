import test from "node:test";
import assert from "node:assert/strict";

import { GREETING_NEXT_STEP, greetingReplyFor, withGreetingNextStep } from "../../server/utils/greetingReply.js";

/**
 * The owner's WhatsApp test, 2026-10-19: "السلام عليكم" got only "وعليكم السلام ورحمة الله، أهلاً
 * بيك يا فندم." — a dead end. A greeting now welcomes the customer and offers the next step
 * (رجالي / حريمي / أطفال or a model) without pushing a product.
 */

test("السلام عليكم gets the salam back, a welcome and the next step", () => {
  const reply = greetingReplyFor("السلام عليكم");
  assert.match(reply, /^وعليكم السلام ورحمة الله، أهلاً بيك يا فندم/);
  assert.match(reply, /رجالي ولا حريمي ولا أطفال، ولا في موديل معين في بالك؟$/);
  assert.doesNotMatch(reply, /جنيه|\d{2}/, "no product, price or size");
});

test("other greetings get a matching opening and the same next step", () => {
  assert.match(greetingReplyFor("صباح الخير"), /^صباح النور يا فندم/);
  assert.match(greetingReplyFor("مساء الخير"), /^مساء النور يا فندم/);
  assert.match(greetingReplyFor("هاي"), /^أهلاً بيك يا فندم/);
  for (const message of ["صباح الخير", "هاي"]) assert.ok(greetingReplyFor(message).endsWith(GREETING_NEXT_STEP));
});

test("thanks is answered as thanks, not as a welcome", () => {
  assert.match(greetingReplyFor("شكرا"), /^العفو يا فندم/);
  assert.doesNotMatch(greetingReplyFor("شكرا"), /نورتنا/);
});

test("an opening that already offers help gets no second question", () => {
  assert.equal(withGreetingNextStep("نورتنا، قولّي أساعدك في إيه."), "نورتنا، قولّي أساعدك في إيه.");
  assert.equal(withGreetingNextStep("صباح الفل يا فندم، تحت أمرك."), `صباح الفل يا فندم، تحت أمرك.\n${GREETING_NEXT_STEP}`);
});

test("the reply composer's greetings go through the same builder", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../../server/services/aiSalesReplyComposerService.js", import.meta.url), "utf8");
  assert.match(source, /const buildGreetingReply = \(message = "", seed = ""\) => \(greetingKind\(message\) === "islamic"\s*\? greetingReplyFor\(message\)\s*: withGreetingNextStep\(buildGreetingOpening\(message, seed\)\)\);/);
  assert.doesNotMatch(source, /return "وعليكم السلام ورحمة الله، أهلاً بيك يا فندم\.";/);
});
