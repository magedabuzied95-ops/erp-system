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
    /const effectiveRenderedPrivateReply = greetingOnly\s*\?\s*tidyGreetingText\(renderAutomationTemplate\(privateReplyTemplate, templateContext\)\)/,
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

test("the tenant's own greeting wins over the env override and the default", () => {
  const match = SOURCE.match(/const resolveGreetingPrivateReplyTemplate = \(settings = \{\}\) =>([\s\S]*?);\r?\n/);
  assert.ok(match, "the resolver must accept the tenant settings");
  const body = match[1];
  const tenantAt = body.indexOf("settings?.greeting_private_message_template");
  const envAt = body.indexOf("process.env.SOCIAL_COMMENT_GREETING_PRIVATE_REPLY");
  const defaultAt = body.indexOf("SOCIAL_COMMENT_GREETING_PRIVATE_REPLY_DEFAULT");
  assert.ok(tenantAt >= 0 && envAt > tenantAt && defaultAt > envAt, "precedence must be tenant → env → default");
  // The runtime must pass the loaded tenant settings in, or the field would never apply.
  assert.match(SOURCE, /resolveGreetingPrivateReplyTemplate\(publicReplyRotationSettings\)/);
});

test("greeting mode replaces the template the worker renders, not just the text", async () => {
  // The private-reply worker re-renders from privateReplyTemplate instead of sending the
  // queued message. Overriding only the rendered text sent a real customer a stripped-down
  // product template: no name, no product line, "المقاسات المتاحة:" + the no-sizes
  // fallback, and a bare /shop link.
  assert.match(
    SOURCE,
    /const privateReplyTemplate = greetingOnly\s*\?\s*resolveGreetingPrivateReplyTemplate\(publicReplyRotationSettings\)/,
    "greeting mode must own the template itself"
  );
  assert.match(SOURCE, /tidyGreetingText\(renderAutomationTemplate\(privateReplyTemplate, templateContext\)\)/);
});

test("the tidy runs as the worker's last step, not only where the template is rendered", () => {
  // The worker re-renders templates itself, so tidying only at render time fixed the run
  // log while the customer still received "أهلاً بحضرتك يا  ❤️".
  const worker = fs.readFileSync("server/services/socialCommentPrivateReplyService.js", "utf8");
  assert.match(worker, /import \{ tidyGreetingText \} from "\.\.\/utils\/greetingText\.js";/);
  assert.match(worker, /return tidyGreetingText\(compacted\.join\("\\n"\)/);
});

test("a missing commenter name does not leave a dangling vocative", async () => {
  const { tidyGreetingText } = await import("../server/utils/greetingText.js");
  // Facebook often omits the commenter name, which rendered as "أهلاً بحضرتك يا  ❤️".
  assert.equal(tidyGreetingText("أهلاً بحضرتك يا  ❤️"), "أهلاً بحضرتك ❤️");
  assert.equal(tidyGreetingText("أهلاً بحضرتك يا "), "أهلاً بحضرتك");
  assert.equal(tidyGreetingText("أهلاً يا \nسطر تاني"), "أهلاً\nسطر تاني");
  // A real name must survive untouched, including before punctuation.
  assert.equal(tidyGreetingText("أهلاً بحضرتك يا ماجد ❤️"), "أهلاً بحضرتك يا ماجد ❤️");
  assert.equal(tidyGreetingText("مرحبا يا محمود، إزيك؟"), "مرحبا يا محمود، إزيك؟");
});

test("the greeting field is persisted like the other templates", () => {
  const settingsService = fs.readFileSync("server/services/socialAutomationSettingsService.js", "utf8");
  for (const anchor of [
    /greeting_private_message_template: null/,                                   // default
    /ADD COLUMN IF NOT EXISTS greeting_private_message_template TEXT NULL/,      // migration
    /greeting_private_message_template = EXCLUDED\.greeting_private_message_template/, // upsert
    /hasOwnProperty\.call\(patch, "greeting_private_message_template"\)/,        // accepted from the API
  ]) {
    assert.match(settingsService, anchor);
  }
});

test("liking still degrades correctly on instagram", () => {
  // Greeting mode must not resurrect the Facebook-only like endpoint for Instagram.
  assert.match(SOURCE, /const likeSupportedOnPlatform = normalizedPlatform === "facebook";/);
  assert.match(SOURCE, /const likeEnabled = Boolean\(config\.settings\?\.likeComment\) && likeSupportedOnPlatform;/);
});
