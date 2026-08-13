import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const reviewerInboxSource = fs.readFileSync(
  new URL("../../src/modules/aiSupport/pages/MetaReviewerInbox.jsx", import.meta.url),
  "utf8",
);

test("the Meta reviewer receives the modern AI Inbox presentation", () => {
  assert.match(reviewerInboxSource, /data-meta-reviewer-modern-inbox="true"/);
  assert.match(reviewerInboxSource, /AI Social Media Center/);
  assert.match(reviewerInboxSource, /AI Inbox/);
  assert.match(reviewerInboxSource, /ReviewerMessage/);
});

test("the reviewer UI exposes only the two approved Meta messaging channels", () => {
  assert.match(reviewerInboxSource, /id: "messenger"/);
  assert.match(reviewerInboxSource, /id: "instagram"/);
  assert.doesNotMatch(reviewerInboxSource, /whatsapp/i);
  assert.match(reviewerInboxSource, /\/meta-reviewer\/inbox\/channels\/\$\{activeChannel\}/);
});
