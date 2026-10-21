import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
const inboxSource = fs.readFileSync(new URL("../../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const topBarSource = fs.readFileSync(new URL("../../src/modules/aiSupport/components/InboxTopBar.jsx", import.meta.url), "utf8");
const rbacSource = fs.readFileSync(new URL("../../src/modules/permissions/lib/rbacStore.js", import.meta.url), "utf8");

test("the Meta reviewer uses the real admin AI Inbox instead of a separate page", () => {
  assert.doesNotMatch(appSource, /MetaReviewerInbox/);
  assert.match(appSource, /<AiInbox reviewerMode/);
  assert.match(appSource, /path="admin\/ai-inbox"/);
});

test("review mode uses scoped Meta APIs for Messenger, Instagram and the WhatsApp test number", () => {
  assert.match(inboxSource, /metaReviewerConversationEndpoint/);
  assert.match(inboxSource, /META_REVIEWER_CHANNELS = \["whatsapp", "messenger", "instagram"\]/);
  assert.match(inboxSource, /reviewerMode[\s\S]*META_REVIEWER_CHANNELS/);
  assert.match(inboxSource, /AiInbox\.reviewerConversations/);
  assert.match(inboxSource, /AiInbox\.reviewerMessages/);
  assert.match(inboxSource, /AiInbox\.reviewerSend/);
});

test("the reviewer top bar has only WhatsApp (official), Messenger, Instagram and Meta Ads", () => {
  const block = topBarSource.slice(topBarSource.indexOf("const REVIEWER_MENUS"), topBarSource.indexOf("// Literal keys"));
  const menuKeys = [...block.matchAll(/^\s{2}\{\s*\n?\s*key: "([a-zA-Z]+)"/gm)].map((match) => match[1]);
  assert.deepEqual(menuKeys, ["whatsapp", "messenger", "instagram", "metaAds"]);
  for (const hidden of ["whatsappWeb", "tiktok", "config", "webConnection", "webQueue", "agent", "tiktokConnect"]) {
    assert.doesNotMatch(block, new RegExp(`key: "${hidden}"`), `${hidden} must not be in the reviewer menus`);
  }
  assert.match(topBarSource, /const menus = reviewerMode \? REVIEWER_MENUS : MENUS/);
  assert.match(inboxSource, /availableSections=\{reviewerMode \? META_REVIEWER_SECTIONS : CONTROL_CENTER_SECTIONS\}/);
});

test("the reviewer's ERP sidebar and routes are the inbox and Meta Ads only", () => {
  assert.match(rbacSource, /META_REVIEWER_SIDEBAR_PATHS = Object\.freeze\(\["\/admin\/ai-inbox", "\/meta-ads"\]\)/);
  assert.match(appSource, /isMetaReviewerUser\(\) && location\.pathname !== "\/admin\/ai-inbox" && !\/\^\\\/meta-ads/);
});
