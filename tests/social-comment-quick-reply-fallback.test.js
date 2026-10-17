import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// When Meta refuses a sales-flow message that carries quick replies, the flow re-sends the same
// text without them. The refused attempt has already stored that text's outbound signature for
// this inbound tap, so the re-send used to be skipped as a duplicate of itself — the customer
// tapped "اطلب اللون ده" and never heard back (Instagram, 2026-10-16). These guards keep the
// fallback past the dedupe and keep the options readable once the buttons are gone.

const meta = fs.readFileSync(
  new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8"
);

const fallback = meta.slice(
  meta.indexOf("const sendSocialCommentSalesFlowText = async ({"),
  meta.indexOf("const handleSocialCommentMessengerQuickReplySelection = async ({")
);

test("the fallback send bypasses the outbound dedupe its own refused attempt armed", () => {
  assert.ok(fallback.length > 0, "sendSocialCommentSalesFlowText not found");
  const retry = fallback.slice(fallback.indexOf("social_comment_quick_reply_fallback: true"));
  assert.match(retry.slice(0, 200), /bypass_outbound_dedupe:\s*true/);
});

test("sendAndLogMetaText honours the bypass flag", () => {
  assert.match(meta, /const bypassOutboundDedupe = metadata\?\.bypass_outbound_dedupe === true;/);
});

test("the fallback text lists the options the dropped buttons offered", () => {
  assert.match(fallback, /quickReplies\.map\(\(reply\) => text\(reply\?\.title \|\| ""\)\)/);
  assert.match(fallback, /optionTitles\.join\(" - "\)/);
});
