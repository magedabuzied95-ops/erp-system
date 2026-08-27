import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Messenger has a first-party generic-template carousel (image + title + subtitle + buttons, ≤10
// elements). The colour cards go out as that carousel, each with a postback button carrying
// choose_color:<variant_id> — the same structured tap the WhatsApp path already uses. Instagram
// has no button carousel and stays on the per-card path.

const adapter = fs.readFileSync(
  new URL("../server/services/aiChannelAdapterService.js", import.meta.url), "utf8"
);
const routes = fs.readFileSync(
  new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8"
);
const meta = fs.readFileSync(
  new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8"
);

test("Messenger sends a generic-template carousel for a colour batch", () => {
  const branch = adapter.slice(adapter.indexOf("let metaCarouselHandled = false"), adapter.indexOf("if (productCards.length && !metaCarouselHandled)"));
  assert.ok(branch.length > 0, "the messenger carousel branch exists");
  assert.match(branch, /FACEBOOK_MESSENGER && productCards\.length >= 2/, "only for Messenger, only for a batch");
  assert.match(branch, /template_type: "generic"/, "uses the official generic template");
  assert.match(branch, /type: "postback", title: "اطلب اللون ده ✅", payload: `choose_color:\$\{variantId\}`/, "each card carries a variant postback");
  assert.match(branch, /i \+= 10/, "chunked at Messenger's 10-element cap");
});

test("Instagram does not get the button carousel", () => {
  const branch = adapter.slice(adapter.indexOf("let metaCarouselHandled = false"), adapter.indexOf("if (productCards.length && !metaCarouselHandled)"));
  assert.ok(!branch.includes("INSTAGRAM"), "the branch is Messenger-only");
  // and the per-card loop is skipped only when the carousel actually went out
  assert.match(adapter, /if \(productCards\.length && !metaCarouselHandled\)/);
});

test("a Messenger carousel failure falls back to the per-card loop", () => {
  const branch = adapter.slice(adapter.indexOf("let metaCarouselHandled = false"), adapter.indexOf("if (productCards.length && !metaCarouselHandled)"));
  assert.match(branch, /catch \(carouselError\)/);
  assert.ok(!branch.includes("throw carouselError"), "the carousel is never a new way to lose the message");
});

test("colour expansion now covers Messenger, still excludes Instagram/Telegram", () => {
  assert.match(routes, /conversationKey\.startsWith\("whatsapp"\) \|\| conversationKey\.startsWith\("facebook_messenger"\)/);
  assert.match(routes, /supportsColorCarousel/);
});

test("a Messenger colour-card tap is rewritten to catalog wording before the AI sees it", () => {
  assert.match(meta, /const colorTap = metaPostback\.match\(\/\^choose_color:/);
  assert.match(meta, /message\.message_text = rewritten/, "the rewrite replaces the inbound text");
  assert.match(meta, /لون \$\{picked\.color\}/, "colour is spelled exactly as the catalog has it");
  // rewrite happens before the messenger inbound processing logs the text
  const tapIndex = meta.indexOf("const colorTap = metaPostback");
  const rawLogIndex = meta.indexOf("SOCIAL_COMMENT_MESSENGER_INBOUND_RAW");
  assert.ok(tapIndex > -1 && tapIndex < rawLogIndex, "rewrite precedes downstream consumption");
});
