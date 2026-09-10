import test from "node:test";
import assert from "node:assert/strict";

import { buildSocialCommentMentionMessage } from "../server/services/marketingCommentAutomationService.js";

/* The mention used to be sent as a `message_tags` parameter. That field is read-only on the Graph
   API — Meta accepted the reply and dropped the tag without a word, so every public reply carried
   the customer's name as flat text. A mention only exists if it is written into `message`. */

test("Facebook writes the mention into the message as @[page-scoped id]", () => {
  const message = "منورنا يا Maged Abuzied 🙏\nتم الرد عليك في الخاص";
  const result = buildSocialCommentMentionMessage({
    platform: "facebook",
    message,
    commenterId: "5036593356360590",
    commenterName: "Maged Abuzied",
  });

  assert.equal(result.mentionApplied, true);
  assert.equal(result.message, "منورنا يا @[5036593356360590] 🙏\nتم الرد عليك في الخاص");
  assert.equal(result.message.includes("Maged Abuzied"), false, "the name is replaced, not appended");
  assert.equal(result.message_tags, undefined, "the dead parameter must not come back");
});

test("Facebook refuses a bracket mention it cannot resolve", () => {
  // Identity falls back to a username or the comment id often enough that this matters: "@[maged]"
  // would reach the customer with the brackets showing.
  const result = buildSocialCommentMentionMessage({
    platform: "facebook",
    message: "منورنا يا maged.abuzied 🙏",
    commenterId: "maged.abuzied",
    commenterName: "maged.abuzied",
  });

  assert.equal(result.mentionApplied, false);
  assert.equal(result.message, "منورنا يا maged.abuzied 🙏");
});

test("Instagram mentions the handle, and swaps a display name for it", () => {
  const result = buildSocialCommentMentionMessage({
    platform: "instagram",
    message: "منورنا يا Maged Abuzied 🙏",
    commenterId: "17841400000000000",
    commenterName: "Maged Abuzied",
    commenterUsername: "maged.abuzied",
  });

  assert.equal(result.mentionApplied, true);
  assert.equal(result.message, "منورنا يا @maged.abuzied 🙏");
});

test("Instagram will not mention a display name as if it were a handle", () => {
  // "@Maged Abuzied" is not a mention, it is three words with an @ in front of them.
  const result = buildSocialCommentMentionMessage({
    platform: "instagram",
    message: "منورنا يا Maged Abuzied 🙏",
    commenterName: "Maged Abuzied",
  });

  assert.equal(result.mentionApplied, false);
  assert.equal(result.message, "منورنا يا Maged Abuzied 🙏");
});

test("a reply that never says the customer's name stays exactly as written", () => {
  const result = buildSocialCommentMentionMessage({
    platform: "facebook",
    message: "أهلاً بحضرتك",
    commenterId: "5036593356360590",
    commenterName: "Maged Abuzied",
  });

  assert.equal(result.mentionApplied, false);
  assert.equal(result.message, "أهلاً بحضرتك");
});
