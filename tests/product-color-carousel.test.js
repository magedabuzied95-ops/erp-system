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
