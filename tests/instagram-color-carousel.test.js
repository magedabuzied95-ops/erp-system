import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Instagram runs the SAME Meta generic template as Messenger: up to 10 elements in one message
// render as a horizontally scrollable carousel, with postback and web_url buttons, an 80-character
// title and subtitle. The earlier "Instagram has no button carousel" line in this codebase was our
// assumption, not Meta's rule — Meta's only stated limit is that instagram.com on desktop does not
// render it. These guards keep the three things that make an Instagram carousel actually arrive:
// the colour expansion must run for instagram conversations, the send branch must accept the
// channel, and the POST must go through the helper that knows about graph.instagram.com.

const routes = fs.readFileSync(
  new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8"
);
const meta = fs.readFileSync(
  new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8"
);
const adapter = fs.readFileSync(
  new URL("../server/services/aiChannelAdapterService.js", import.meta.url), "utf8"
);

test("colour expansion runs for instagram conversations", () => {
  // Without this the route sends ONE card and the carousel branch never sees a batch — the exact
  // reason the first live WhatsApp attempt landed as a single image.
  const gate = routes.slice(routes.indexOf("const supportsColorCarousel ="), routes.indexOf("const productCards = supportsColorCarousel"));
  assert.match(gate, /conversationKey\.startsWith\("instagram"\)/, "instagram:<IGSID> keys expand by colour");
});

test("the inbox sender accepts Instagram into the carousel branch", () => {
  const branch = meta.slice(meta.indexOf("let metaCarouselDone = false"), meta.indexOf("if (cards.length && !metaCarouselDone)"));
  assert.match(meta, /const metaCarouselChannels = \[AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS\.INSTAGRAM\]/, "both Meta channels are listed");
  assert.match(branch, /metaCarouselChannels\.includes\(normalizedChannel\)/, "the branch gates on that list, not on Messenger alone");
  assert.match(branch, /template_type: "generic"/, "the same generic template Instagram documents");
  assert.match(branch, /elements\.slice\(i, i \+ 10\)/, "chunked at Instagram's 10-element cap");
});

test("the carousel POST goes through the endpoint-aware helper, not a raw /me/messages fetch", () => {
  // An Instagram Business Login account is addressed on graph.instagram.com/<IG_ID>/messages;
  // graph.facebook.com/me/messages is the Facebook-Login endpoint. postMetaMessageWithThreadControl
  // is the only place that knows which one the resolved config belongs to.
  const branch = meta.slice(meta.indexOf("let metaCarouselDone = false"), meta.indexOf("if (cards.length && !metaCarouselDone)"));
  assert.match(branch, /await postMetaMessageWithThreadControl\(\{/, "the carousel chunks ride the routed sender");
  assert.ok(!branch.includes("GRAPH_BASE_URL"), "no hardcoded graph.facebook.com endpoint in the carousel branch");
  assert.match(meta, /return callInstagramGraph\(\{\s*endpoint: `\/\$\{encodeURIComponent\(instagramAccountId\)\}\/messages`/, "and that helper still routes Instagram Business Login to graph.instagram.com");
});

test("image_aspect_ratio is sent to Messenger only", () => {
  // It is a Messenger template field; Instagram's reference does not carry it. The photos are
  // already padded onto a white square canvas during colour expansion, so nothing is cropped.
  const branch = meta.slice(meta.indexOf("let metaCarouselDone = false"), meta.indexOf("if (cards.length && !metaCarouselDone)"));
  assert.match(
    branch,
    /\.\.\.\(normalizedChannel === AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER \? \{ image_aspect_ratio: "square" \} : \{\}\)/,
    "the square frame is conditional on Messenger"
  );
});

test("an Instagram card tap is rewritten to catalog wording like a Messenger one", () => {
  // Instagram allows postback buttons on the generic template, its webhook subscription already
  // carries messaging_postbacks, and the rewrite block is NOT gated on a channel — so a tap on an
  // Instagram colour card grounds exactly as it does on Messenger and WhatsApp.
  assert.match(meta, /const META_INSTAGRAM_WEBHOOK_SUBSCRIBED_FIELDS = \[[^\]]*"messaging_postbacks"/s, "postbacks are subscribed for Instagram");
  const rewriteStart = meta.indexOf("const metaPostback = text(message?.postback_payload");
  const rewrite = meta.slice(rewriteStart, meta.indexOf('if (text(message?.channel || "") === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER)', rewriteStart));
  assert.ok(rewrite.length > 0 && rewrite.length < 2000, "the rewrite block was located");
  assert.match(rewrite, /const colorTap = metaPostback\.match\(\/\^choose_color:/);
  assert.ok(!rewrite.includes("FACEBOOK_MESSENGER") && !rewrite.includes("INSTAGRAM"), "the rewrite is channel-agnostic — Instagram taps land in it too");
});

test("the autonomous adapter path covers Instagram too", () => {
  const branch = adapter.slice(adapter.indexOf("let metaCarouselHandled = false"), adapter.indexOf("if (productCards.length && !metaCarouselHandled)"));
  assert.match(branch, /metaCarouselChannels\.includes\(normalized\)/, "Instagram is not stranded on the per-card path when autonomy is switched on");
  assert.ok(!branch.includes("image_aspect_ratio"), "no Messenger-only field in the shared payload");
});

test("an Instagram carousel failure still falls back to the per-card send", () => {
  const branch = meta.slice(meta.indexOf("let metaCarouselDone = false"), meta.indexOf("if (cards.length && !metaCarouselDone)"));
  assert.match(branch, /catch \(carouselError\)/, "the carousel is an upgrade, never a new way to lose the message");
  assert.match(meta, /if \(cards\.length && !metaCarouselDone\)/, "the per-card loop still runs when the carousel did not");
  // and that per-card loop keeps Instagram's concise share text
  assert.match(meta, /normalizedChannel === AI_AGENT_CHANNELS\.INSTAGRAM\s*\?\s*instagramProductShareText\(product\)/, "single-card Instagram sends are unchanged");
});
