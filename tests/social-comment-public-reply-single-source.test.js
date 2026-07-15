import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("legacy marketing automation cannot publish public comment replies", async () => {
  const source = await readSource("server/services/marketingCommentAutomationService.js");
  assert.doesNotMatch(source, /processAutomationEvent\.public_reply/);
  assert.match(source, /public_reply:\s*\{ requested: false, reason: "owned_by_official_social_comment_automation" \}/);
});

test("legacy social comments center has no Meta public reply sender", async () => {
  const source = await readSource("server/services/socialCommentsCenterService.js");
  assert.doesNotMatch(source, /replyToComment\s*\(/);
  assert.match(source, /const replyEnabled = false/);
});

test("official sender renders settings text and checks Meta before publishing", async () => {
  const source = await readSource("server/services/marketingCommentAutomationService.js");
  assert.match(source, /await findExistingPageReply\(\{ platform, commentId, businessId \}\)/);
  assert.match(source, /platform === "instagram"[\s\S]*?\/replies/);
  assert.match(source, /await renderOfficialSocialPublicReply\(/);
  assert.match(source, /reason: "page_reply_already_exists"/);
});

test("webhook processing does not invoke the removed legacy reply runtime", async () => {
  const source = await readSource("server/services/socialCommentAutomationService.js");
  assert.doesNotMatch(source, /legacy_processSocialCommentAutoReply/);
  assert.doesNotMatch(source, /processSocialCommentAutoReply\s*\(/);
});
