import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync("server/services/socialCommentAutomationService.js", "utf8");

test("an unlinked post no longer aborts the automation run", () => {
  // The old behaviour returned early with no_linked_product, so a comment on a freshly
  // published post got no like, no public reply and no DM.
  assert.ok(
    !/return returnWithFlowExit\(\{[^}]*reason: "no_linked_product"[^}]*\}, \{ exitReason: "no_linked_product", exitType: "no_product" \}\)/.test(SOURCE),
    "the no_linked_product early return must be gone from the automation runtime"
  );
  assert.match(SOURCE, /const greetingOnly = !hasProductContext;/);
});

test("greeting mode replaces the product-aware DM", () => {
  assert.match(
    SOURCE,
    /const effectiveRenderedPrivateReply = greetingOnly\s*\?\s*text\(renderAutomationTemplate\(resolveGreetingPrivateReplyTemplate\(\), templateContext\)\)/,
    "the DM must come from the greeting template when there is no linked product"
  );
});

test("the greeting promises nothing it cannot ground", () => {
  const match = SOURCE.match(/const SOCIAL_COMMENT_GREETING_PRIVATE_REPLY_DEFAULT = \[([\s\S]*?)\]\.join\("\\n"\);/);
  assert.ok(match, "the default greeting must exist");
  const body = match[1];
  // No product context exists in this path, so any of these would be an empty promise.
  for (const placeholder of ["{{price}}", "{{product_name}}", "{{product_link}}", "{{available_sizes}}"]) {
    assert.ok(!body.includes(placeholder), `greeting must not use ${placeholder}`);
  }
  assert.ok(body.includes("{{customer_name}}"), "greeting should still address the customer by name");
});

test("the greeting stays overridable per deployment", () => {
  assert.match(SOURCE, /process\.env\.SOCIAL_COMMENT_GREETING_PRIVATE_REPLY/);
});

test("liking still degrades correctly on instagram", () => {
  // Greeting mode must not resurrect the Facebook-only like endpoint for Instagram.
  assert.match(SOURCE, /const likeSupportedOnPlatform = normalizedPlatform === "facebook";/);
  assert.match(SOURCE, /const likeEnabled = Boolean\(config\.settings\?\.likeComment\) && likeSupportedOnPlatform;/);
});
