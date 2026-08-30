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
  assert.ok(fn.includes(".slice(0, 30)"), "a multi-product click cannot multiply without bound (chunked downstream)");
});

test("the inbox transcript mirrors the WhatsApp strip", () => {
  // multi-card renders as a horizontal swipe strip with square white-canvas photos - the same
  // thing the customer sees - and shows every card, not the first four.
  assert.match(inboxRenderer, /snap-x snap-mandatory overflow-x-auto/);
  assert.ok(!inboxRenderer.includes("items.slice(0, 4)"), "no hidden card cap");
  assert.match(inboxRenderer, /aspect-square w-full bg-white object-contain/);
  assert.match(inboxRenderer, /chooseColorButton/, "the card footer mirrors the WhatsApp button label");
  // Every colour card of one product carries the SAME product_id, so keying the strip on the
  // product identity alone gave React one key for the whole carousel. An abandoned cart holding
  // the same product in two sizes does it too.
  assert.match(inboxRenderer, /const cardKey = `\$\{clean\(card\.product_id \|\| card\.id\)\}:\$\{clean\(card\.variant_id\)\}:\$\{index\}`/,
    "the card key is unique inside the strip");
});

test("a colour carousel is never narrated twice", () => {
  // The AI's variant-options suggestion text lists every colour with sizes, price and link — the
  // exact content the carousel shows as cards. Sending both made the customer read the same
  // catalogue twice (live complaint, 2026-08-27).
  const routes = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
  assert.match(routes, /expandedToColorCarousel/, "the route knows when it expanded");
  assert.match(routes, /اختار اللون اللي يعجبك 👇/, "an expanded send leads with one line, not the dump");
  const inbox = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
  assert.match(inbox, /variantOptionsLead/, "approve-and-send shrinks the text leg for colour batches");
  assert.match(inbox, /editedText \|\| variantOptionsLead \|\| activeAiSuggestionText/, "a manual edit still wins");
});

test("colour expansion covers the carousel channels, excludes Telegram", () => {
  // WhatsApp (Evolution), Messenger and Instagram all carry a carousel — Messenger and Instagram
  // on the same Meta generic template. Telegram has none here, so it keeps one card per product.
  const routes = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
  const gate = routes.slice(routes.indexOf("const supportsColorCarousel ="), routes.indexOf("const productCards = supportsColorCarousel"));
  for (const channel of ["whatsapp", "facebook_messenger", "instagram"]) {
    assert.ok(gate.includes(`conversationKey.startsWith("${channel}")`), `${channel} expands by colour`);
  }
  assert.ok(!gate.includes('startsWith("telegram")'), "Telegram keeps one card per product");
  assert.ok(routes.includes("supportsColorCarousel"), "gated by an explicit capability flag");
});

test("BOTH approve paths shrink the text for a colour batch - desktop and PWA", () => {
  // The PWA is a separate component with its own approve handler; the desktop-only fix left the
  // PWA sending the full per-colour dump next to the carousel (live complaint, 2026-08-28).
  const desktop = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
  const pwa = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
  assert.match(desktop, /variantOptionsLead/, "desktop shrinks it");
  assert.match(pwa, /اختار اللي يعجبك 👇/, "the PWA shrinks it too");
  const approve = pwa.slice(pwa.indexOf("const handleApproveAiSuggestion"), pwa.indexOf("const handleDismissAiSuggestion"));
  assert.match(approve, /colorChoices\.length >= 2\s*\r?\n?\s*\?/, "gated on an actual colour batch");
  assert.match(approve, /: activeAiSuggestionText/, "a non-batch suggestion keeps its full text");
});

test("the PWA service worker version bumped so stale bundles refresh", () => {
  const sw = fs.readFileSync(new URL("../public/inbox-sw.js", import.meta.url), "utf8");
  assert.match(sw, /const VERSION = "ai-inbox-v14"/, "a bumped version forces the old cached JS out");
});

test("expanded colour cards do not re-expand in the adapter", () => {
  // Each colour card kept the parent's `variants` array, and the adapter re-runs
  // normalizeProductCards on everything it sends — so every colour card expanded AGAIN into all
  // colours: duplicated photos, inflated counts, and overflow spilling out as loose images after
  // the carousel (live, a 23-colour Nike, 2026-08-28).
  const routes = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
  const fn = routes.slice(routes.indexOf("const expandProductCardsByColor"), routes.indexOf('router.post("/conversations/:conversationId/product-card/send"'));
  assert.match(fn, /const \{ variants, variant, product, matched_variant, selected_variant, \.\.\.flatCard \} = colorCard/,
    "the expander strips the re-expansion triggers");
  assert.ok(!/expanded\.push\(\{\s*\r?\n?\s*\.\.\.card,\s*\r?\n?\s*\.\.\.colorCard/.test(fn),
    "it must NOT spread the enriched parent card back in");
});

test("more than ten colours are chunked, not dropped", () => {
  const routes = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
  const fn = routes.slice(routes.indexOf("const expandProductCardsByColor"), routes.indexOf('router.post("/conversations/:conversationId/product-card/send"'));
  assert.match(fn, /\.slice\(0, 30\)/, "the colour cap is high enough for a big palette");
  assert.ok(fn.includes("limit: 30"), "expansion itself is not capped at 10");
  const adapter = fs.readFileSync(new URL("../server/services/aiChannelAdapterService.js", import.meta.url), "utf8");
  assert.match(adapter, /i \+= 10/, "the adapter chunks carousels at Evolution's 10-card limit");
});

test("the colour expansion reads the canonical price columns, never a hand-rolled COALESCE", () => {
  // LIVE 2026-08-30: every colour card of product 764 arrived with NO price on Instagram, and the
  // server logged `stage=product_cards_built { cardsWithMissingPrice: 4 }`. The 850 was there all
  // along — in `purchase_selling_price`, which the expansion's own
  // `COALESCE(NULLIF(selling_price,0), NULLIF(price,0), NULLIF(regular_price,0)) AS price`
  // could never reach. That column is the ONLY normal price for 365 of 751 products in production,
  // so half the catalogue carded priceless on WhatsApp and Messenger too. The canonical precedence
  // lives in src/shared/lib/currentSellingPrice.js and normalizeProductCards reaches it through
  // resolveCustomerDisplayPrice — but only if the variant row carries the columns.
  const routes = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
  const fn = routes.slice(routes.indexOf("const expandProductCardsByColor"), routes.indexOf('router.post("/conversations/:conversationId/product-card/send"'));
  const query = fn.slice(fn.indexOf("FROM product_variants") - 600, fn.indexOf("FROM product_variants"));
  for (const column of ["purchase_selling_price", "manual_selling_price", "manual_price_override_active"]) {
    assert.ok(query.includes(column), `the variant row must carry ${column} for the resolver to see it`);
  }
  assert.ok(!/COALESCE\(NULLIF\(selling_price/.test(fn), "no fresh COALESCE over the price columns — the resolver decides");
  // and the raw legacy columns still ride along as the resolver's last tier
  for (const column of ["selling_price", "price", "regular_price", "sale_price"]) {
    assert.ok(query.includes(column), `the legacy tier still needs ${column}`);
  }
});
