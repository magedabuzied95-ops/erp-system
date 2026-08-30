import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Messenger has a first-party generic-template carousel (image + title + subtitle + buttons, ≤10
// elements). The colour cards go out as that carousel, each with a postback button carrying
// choose_color:<variant_id> — the same structured tap the WhatsApp path already uses. Instagram
// runs the identical template and is guarded separately in instagram-color-carousel.test.js.

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
  assert.match(branch, /metaCarouselChannels\.includes\(normalized\) && productCards\.length >= 2/, "only for the Meta channels, only for a batch");
  assert.match(branch, /template_type: "generic"/, "uses the official generic template");
  assert.match(branch, /type: "postback", title: "اطلب اللون ده ✅", payload: `choose_color:\$\{variantId\}`/, "each card carries a variant postback");
  assert.match(branch, /i \+= 10/, "chunked at Messenger's 10-element cap");
});

test("the carousel branch is Meta-only — WhatsApp and Telegram keep their own transports", () => {
  const list = adapter.slice(adapter.indexOf("const metaCarouselChannels = "), adapter.indexOf("const PRODUCT_CARD_BATCH_SIZE"));
  assert.match(list, /FACEBOOK_MESSENGER/, "Messenger rides the generic template");
  assert.match(list, /INSTAGRAM/, "so does Instagram");
  assert.ok(!/WHATSAPP|TELEGRAM/.test(list), "no other channel is routed into the Meta template");
  // and the per-card loop is skipped only when the carousel actually went out
  assert.match(adapter, /if \(productCards\.length && !metaCarouselHandled\)/);
});

test("a Messenger carousel failure falls back to the per-card loop", () => {
  const branch = adapter.slice(adapter.indexOf("let metaCarouselHandled = false"), adapter.indexOf("if (productCards.length && !metaCarouselHandled)"));
  assert.match(branch, /catch \(carouselError\)/);
  assert.ok(!branch.includes("throw carouselError"), "the carousel is never a new way to lose the message");
});

test("colour expansion covers WhatsApp + Messenger, still excludes Telegram", () => {
  const gate = routes.slice(routes.indexOf("const supportsColorCarousel ="), routes.indexOf("const productCards = supportsColorCarousel"));
  assert.match(gate, /conversationKey\.startsWith\("whatsapp"\)/);
  assert.match(gate, /conversationKey\.startsWith\("facebook_messenger"\)/);
  assert.ok(!gate.includes('startsWith("telegram")'), "Telegram has no carousel transport here");
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
  assert.match(meta, /const buildMetaCarouselElement = /, "an element builder exists");
  assert.match(meta, /let metaCarouselDone = false/, "the group branch exists");
  const branch = meta.slice(meta.indexOf("let metaCarouselDone = false"), meta.indexOf("if (cards.length && !metaCarouselDone)"));
  assert.match(branch, /cards\.length >= 2 && metaCarouselChannels\.includes\(normalizedChannel\)/, "a Meta channel + a batch");
  assert.ok(branch.includes('template_type: "generic"') && branch.includes("elements.slice(i, i + 10)"), "a multi-element generic template, chunked at 10");
  assert.match(branch, /catch \(carouselError\)/, "failure falls through to the per-card loop");
  assert.match(meta, /if \(cards\.length && !metaCarouselDone\)/, "per-card loop runs only when the carousel did not");
});

test("a colour element carries a variant postback, a plain one keeps عرض المنتج", () => {
  const el = meta.slice(meta.indexOf("const buildMetaCarouselElement"), meta.indexOf("const buildMessengerCarouselPayload"));
  assert.match(el, /type: "postback", title: "اطلب اللون ده ✅", payload: `choose_color:\$\{variantId\}`/);
  assert.match(el, /type: "web_url", url: productUrl, title: "عرض المنتج"/);
});

test("the carousel frames a square image so the whole product shows", () => {
  // a square frame + a padded square photo = the whole shoe, not a tall centre-crop
  const branch = meta.slice(meta.indexOf("let metaCarouselDone = false"), meta.indexOf("if (cards.length && !metaCarouselDone)"));
  assert.match(branch, /image_aspect_ratio: "square"/, "the generic template requests a square frame");
  const expand = routes.slice(routes.indexOf("const expandProductCardsByColor"), routes.indexOf('router.post("/conversations/:conversationId/product-card/send"'));
  assert.match(expand, /ensureSquareCardImageUrl\(rawImage\)/, "the colour photos are padded to a square canvas");
  assert.match(expand, /image_url: squared \|\| flatCard\.image_url/, "a failed square keeps the original photo");
});

test("the colour carousel is not capped at 6 — the route hands the real card count", () => {
  // sendMetaInboxOutboundMessage defaults productCardLimit to 6; a 10-colour product would then
  // silently drop 4 colours (live: 10 expanded, only 6 reached the sender, 2026-08-28). The route
  // sends the expanded count so every colour rides the carousel.
  const send = routes.slice(routes.indexOf("sendResult = await sendMetaInboxOutboundMessage({", routes.indexOf("FACEBOOK_MESSENGER || normalizedChannel === AI_AGENT_CHANNELS.INSTAGRAM")), routes.indexOf("deliveryStatus = sendResult?.delivery_status || (sendResult.sent ? \"sent\" : \"failed\");"));
  assert.match(send, /productCardLimit: Math\.max\(6, productCards\.length\)/, "the Meta send is given the full expanded card count, not the default 6");
  assert.match(meta, /productCardLimit = 6/, "the default that the route must override still exists (guards the reason for the override)");
});

test("the lead line lands ABOVE the carousel, not after the cards", () => {
  // The general message body is otherwise sent last; for a carousel that lead ("اختار اللون 👇")
  // must precede the cards. It is sent before the elements loop and the trailing send is skipped.
  const branch = meta.slice(meta.indexOf("let metaCarouselDone = false"), meta.indexOf("if (cards.length && !metaCarouselDone)"));
  assert.match(branch, /leadTextSentBeforeCarousel = true/, "the lead text is sent inside the carousel branch, before the cards");
  const leadIdx = branch.indexOf("messageText: safeMessage");
  const loopIdx = branch.indexOf("for (let i = 0; i < elements.length; i += 10)");
  assert.ok(leadIdx > -1 && loopIdx > -1 && leadIdx < loopIdx, "the lead send precedes the carousel element loop");
  // and the trailing body send is guarded so the lead is not repeated under the cards
  assert.match(meta, /if \(!leadTextSentBeforeCarousel\) \{\s*meta = await postMetaMessage\(/, "the trailing body send is skipped once the lead already went out");
});

test("the card layout: bold big colour+price title, sizes on their own line", () => {
  // Messenger gives no font control on the subtitle, so the price rides the TITLE (which Messenger
  // renders bold and larger) and the sizes get a labelled line of their own (owner request).
  const el = meta.slice(meta.indexOf("const buildMetaCarouselElement"), meta.indexOf("const buildMessengerCarouselPayload"));
  assert.match(el, /const headline = \[text\(title\), priceText\]\.filter\(Boolean\)\.join\(" — "\)/, "colour and price share the bold title");
  assert.match(el, /المقاسات المتاحة:\n/, "the sizes label sits on its own line above the sizes");
  assert.ok(!/join\(" • "\)/.test(el), "the old single-line joined subtitle is gone");
});
