import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
const inboxSource = fs.readFileSync(new URL("../../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");

test("the Meta reviewer uses the real admin AI Inbox instead of a separate page", () => {
  assert.doesNotMatch(appSource, /MetaReviewerInbox/);
  assert.match(appSource, /<AiInbox reviewerMode/);
  assert.match(appSource, /path="admin\/ai-inbox"/);
});

test("review mode uses scoped Meta APIs and never requests WhatsApp conversations", () => {
  assert.match(inboxSource, /metaReviewerConversationEndpoint/);
  assert.match(inboxSource, /reviewerMode[\s\S]*\["messenger", "instagram"\]/);
  assert.match(inboxSource, /AiInbox\.reviewerConversations/);
  assert.match(inboxSource, /AiInbox\.reviewerMessages/);
  assert.match(inboxSource, /AiInbox\.reviewerSend/);
});
