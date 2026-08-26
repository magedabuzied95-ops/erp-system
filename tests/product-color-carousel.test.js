import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// A product with colours goes to the customer as ONE swipeable carousel — a card per colour with
// its photo, price and sizes, and a REPLY button whose id names the exact variant. The tap comes
// back as structured data (choose_color:<variant_id>, proven live), which the webhook rewrites
// into the one sentence the grounding gate resolves deterministically.

const gateway = fs.readFileSync(
  new URL("../server/services/whatsappGatewayService.js", import.meta.url), "utf8"
);
const adapter = fs.readFileSync(
  new URL("../server/services/aiChannelAdapterService.js", import.meta.url), "utf8"
);
const route = fs.readFileSync(
  new URL("../server/routes/whatsappGateway.js", import.meta.url), "utf8"
);

test("the carousel sender accepts reply buttons that carry a structured id", () => {
  const fn = gateway.slice(gateway.indexOf("export const sendCartCarouselMessage"), gateway.indexOf("export const buildOrderConfirmationMessage"));
  assert.match(fn, /type: "reply", displayText: text\(card\?\.buttonText\) \|\| "اختار ده ✅", id: buttonId/);
  assert.match(fn, /card\.buttons\[0\]\.url \|\| card\.buttons\[0\]\.id/, "a card is kept for either button kind");
  // squaring now lives in the sender so no consumer can forget it
  assert.match(fn, /ensureSquareCardImageUrl\(rawImage\)/);
});

test("two or more product cards on Evolution go as one carousel, not N images", () => {
  const branch = adapter.slice(adapter.indexOf("let carouselHandled = false"), adapter.indexOf("if (!carouselHandled)"));
  assert.ok(branch.length > 0, "the carousel branch exists");
  assert.match(branch, /selectedTransport === "evolution" && productCards\.length >= 2/);
  assert.match(branch, /choose_color:\$\{variantId\}/, "each colour card carries its variant id");
  assert.match(branch, /i \+= 10/, "chunked at Evolution's 10-card cap, not truncated");
  // and the per-card loop is skipped only when the carousel actually went out
  assert.match(adapter, /if \(!carouselHandled\)\s*\r?\n\s*for \(let batchIndex = 0/);
});

test("a carousel failure falls back to the proven per-card loop", () => {
  const branch = adapter.slice(adapter.indexOf("let carouselHandled = false"), adapter.indexOf("if (!carouselHandled)"));
  assert.match(branch, /catch \(carouselError\)/);
  assert.ok(!branch.includes("throw carouselError"), "the carousel never becomes a new way to lose the message");
});

test("a card without a variant id still gets a working button", () => {
  const branch = adapter.slice(adapter.indexOf("let carouselHandled = false"), adapter.indexOf("if (!carouselHandled)"));
  assert.match(branch, /storefront_url \|\| product\.product_url/, "it degrades to a product link");
});

test("a colour tap is rewritten into the exact catalog wording before the AI sees it", () => {
  const handler = route.slice(route.indexOf('router.post("/webhook"'), route.indexOf("export default router"));
  const tapIndex = handler.indexOf("choose_color:(");
  const decideIndex = handler.indexOf("mayDecideOrderConfirmation(normalized)");
  const aiIndex = handler.indexOf("triggerWhatsappAiAutoReply(normalized)");
  assert.ok(tapIndex > -1, "the tap is recognised");
  assert.ok(tapIndex < decideIndex && decideIndex < aiIndex, "rewrite happens before anything consumes the text");
  assert.match(handler, /لون \$\{picked\.color\}/, "the rewrite uses the colour exactly as the catalog spells it");
  assert.match(handler, /catch \(colorTapError\)/, "a failed lookup falls through to the original text");
});

// ── the fix for the first live failure: expansion happens SERVER-side ──
const orderRoutes = fs.readFileSync(
  new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8"
);
const inboxRenderer = fs.readFileSync(
  new URL("../src/modules/aiSupport/components/ProductCardMessage.jsx", import.meta.url), "utf8"
);

test("the send route expands colours itself - the FE sends one card per request", () => {
  // Phase 13.4 FE-sequential means the adapter never sees two cards from the inbox, so the
  // carousel branch could not fire; the first live attempt left as a single image because of it.
  assert.match(orderRoutes, /const expandProductCardsByColor = async/);
  const route = orderRoutes.slice(orderRoutes.indexOf('router.post("/conversations/:conversationId/product-card/send"'));
  const expandIndex = route.indexOf("expandProductCardsByColor({ tenantId, cards: enrichedProductCards })");
  const sendIndex = route.indexOf("sendWhatsAppCloudReply({");
  assert.ok(expandIndex > -1, "the route expands after enrichment");
  assert.ok(sendIndex > -1 && expandIndex < sendIndex, "expansion happens before the send");
});

test("expansion failure keeps the original card - an upgrade, never a lost send", () => {
  const fn = orderRoutes.slice(orderRoutes.indexOf("const expandProductCardsByColor"), orderRoutes.indexOf('router.post("/conversations/:conversationId/product-card/send"'));
  assert.match(fn, /catch \(expandError\)/);
  assert.match(fn, /expanded\.push\(card\)/, "the single card survives every failure path");
  assert.match(fn, /colorCards\.length >= 2/, "a one-colour product is not wrapped in a carousel");
  assert.match(fn, /\.slice\(0, 10\)/, "a multi-product click cannot multiply past the carousel cap");
});

test("the inbox transcript mirrors the WhatsApp strip", () => {
  // multi-card renders as a horizontal swipe strip with square white-canvas photos - the same
  // thing the customer sees - and shows every card, not the first four.
  assert.match(inboxRenderer, /snap-x snap-mandatory overflow-x-auto/);
  assert.ok(!inboxRenderer.includes("items.slice(0, 4)"), "no hidden card cap");
  assert.match(inboxRenderer, /aspect-square w-full bg-white object-contain/);
  assert.match(inboxRenderer, /chooseColorButton/, "the card footer mirrors the WhatsApp button label");
});
