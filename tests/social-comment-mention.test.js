import test from "node:test";
import assert from "node:assert/strict";

import { buildFacebookCommentMentionParams } from "../server/services/marketingCommentAutomationService.js";

test("Facebook public replies tag the exact customer name occurrence", () => {
  const message = "منورنا يا Maged Abuzied 🙏\nتم الرد عليك في الخاص";
  const result = buildFacebookCommentMentionParams({
    message,
    commenterId: "5036593356360590",
    commenterName: "Maged Abuzied",
  });

  assert.equal(result.mentionApplied, true);
  assert.equal(result.message, message);
  assert.deepEqual(JSON.parse(result.message_tags), [{
    id: "5036593356360590",
    name: "Maged Abuzied",
    type: "user",
    offset: message.indexOf("Maged Abuzied"),
    length: "Maged Abuzied".length,
  }]);
});

test("Facebook public replies remain plain when the customer identity is incomplete", () => {
  const result = buildFacebookCommentMentionParams({
    message: "أهلاً بحضرتك",
    commenterId: "5036593356360590",
    commenterName: "Maged Abuzied",
  });

  assert.equal(result.mentionApplied, false);
  assert.equal(result.message_tags, undefined);
});
