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

test("the REAL messenger sender groups cards into one horizontal carousel", () => {
  // The AI-Inbox messenger product-card send runs through sendMetaInboxOutboundMessage, NOT
  // sendMetaPageReply — so the first carousel branch never fired and cards stacked vertically as
  // one single-element template each (live, 2026-08-28). The carousel now lives in the right sender.
  const svc = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  assert.match(svc, /const buildMessengerCarouselElement = /, "an element builder exists");
  assert.match(svc, /let messengerCarouselDone = false/, "the group branch exists");
  const branch = svc.slice(svc.indexOf("let messengerCarouselDone = false"), svc.indexOf("if (cards.length && !messengerCarouselDone)"));
  assert.match(branch, /cards\.length >= 2 && normalizedChannel === AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER/, "Messenger + a batch");
  assert.ok(branch.includes('template_type: "generic"') && branch.includes("elements.slice(i, i + 10)"), "a multi-element generic template, chunked at 10");
  assert.match(branch, /catch \(carouselError\)/, "failure falls through to the per-card loop");
  assert.match(svc, /if \(cards\.length && !messengerCarouselDone\)/, "per-card loop runs only when the carousel did not");
});

test("a colour element carries a variant postback, a plain one keeps عرض المنتج", () => {
  const svc = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  const el = svc.slice(svc.indexOf("const buildMessengerCarouselElement"), svc.indexOf("const buildMessengerCarouselPayload"));
  assert.match(el, /type: "postback", title: "اطلب اللون ده ✅", payload: `choose_color:\$\{variantId\}`/);
  assert.match(el, /type: "web_url", url: productUrl, title: "عرض المنتج"/);
});

test("the carousel frames a square image so the whole product shows", () => {
  const svc = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  // a square frame + a padded square photo = the whole shoe, not a tall centre-crop
  const branch = svc.slice(svc.indexOf("let messengerCarouselDone = false"), svc.indexOf("if (cards.length && !messengerCarouselDone)"));
  assert.match(branch, /image_aspect_ratio: "square"/, "the generic template requests a square frame");
  const routes = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
  const expand = routes.slice(routes.indexOf("const expandProductCardsByColor"), routes.indexOf('router.post("/conversations/:conversationId/product-card/send"'));
  assert.match(expand, /ensureSquareCardImageUrl\(rawImage\)/, "the colour photos are padded to a square canvas");
  assert.match(expand, /image_url: squared \|\| flatCard\.image_url/, "a failed square keeps the original photo");
});

test("the card layout: bold big colour+price title, sizes on their own line", () => {
  // Messenger gives no font control on the subtitle, so the price rides the TITLE (which Messenger
  // renders bold and larger) and the sizes get a labelled line of their own (owner request).
  const svc = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  const el = svc.slice(svc.indexOf("const buildMessengerCarouselElement"), svc.indexOf("const buildMessengerCarouselPayload"));
  assert.match(el, /const headline = \[text\(title\), priceText\]\.filter\(Boolean\)\.join\(" — "\)/, "colour and price share the bold title");
  assert.match(el, /المقاسات المتاحة:\n/, "the sizes label sits on its own line above the sizes");
  assert.ok(!/join\(" • "\)/.test(el), "the old single-line joined subtitle is gone");
});
