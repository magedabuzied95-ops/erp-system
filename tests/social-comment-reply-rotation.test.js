import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS,
  selectSocialPublicReplyTemplate,
} from "../server/services/socialAutomationSettingsService.js";

test("social public reply rotation is deterministic for the same comment", () => {
  const input = {
    baseTemplate: "تم الرد عليك في الخاص يا صديقي ❤️",
    openers: DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS,
    rotationEnabled: true,
    postId: "post-1",
    commentId: "comment-99",
  };
  const first = selectSocialPublicReplyTemplate(input);
  const second = selectSocialPublicReplyTemplate(input);
  assert.equal(first, second);
  assert.ok(first.endsWith(input.baseTemplate));
  assert.ok(DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS.some((opener) => first.startsWith(opener)));
});

test("social public reply rotation distributes different comments across openers", () => {
  const replies = Array.from({ length: 50 }, (_, index) => selectSocialPublicReplyTemplate({
    baseTemplate: "النص الثابت",
    openers: DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS,
    rotationEnabled: true,
    postId: "post-1",
    commentId: `comment-${index}`,
  }).split("\n")[0]);
  assert.ok(new Set(replies).size >= 4);
});

test("social public reply rotation can be disabled", () => {
  const baseTemplate = "رد ثابت فقط";
  assert.equal(selectSocialPublicReplyTemplate({
    baseTemplate,
    openers: DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS,
    rotationEnabled: false,
    postId: "post-1",
    commentId: "comment-1",
  }), baseTemplate);
});

test("social public reply opener marker is replaced in place", () => {
  const result = selectSocialPublicReplyTemplate({
    baseTemplate: "قبل\n{{social_reply_opener}}\nبعد",
    openers: ["أهلاً {{customer_name}}"],
    rotationEnabled: true,
    postId: "post-1",
    commentId: "comment-1",
  });
  assert.equal(result, "قبل\nأهلاً {{customer_name}}\nبعد");
});
