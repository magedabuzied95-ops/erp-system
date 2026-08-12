// Phase 12 polish — Instagram concise product-share formatter. Instagram customer-facing product output must be
// minimal (name + customer price + canonical URL, colour optional) and must NEVER leak sizes list, stock count,
// SKU, cost/wholesale, supplier, or a duplicate CTA. Messenger/WhatsApp keep the canonical productCardReplyText.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { instagramProductShareText, productCardReplyText } from "../../server/services/aiProductCards.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "../../", rel), "utf8");
const metaSrc = read("server/services/metaIntegrationService.js");
const inboxSrc = read("src/modules/aiSupport/pages/AiInbox.jsx");

// A grounded card carrying EVERYTHING the formatter must be able to see but must NOT emit.
const CARD = {
  name: "Air Jordan 4  Sneakers for Men",
  color: "Black&white",
  price: 1550,
  display_price: 1550,
  cost_price: 1250,
  wholesale_price: 1300,
  supplier: "ACME Distribution",
  sku: "AJ4-BW-45",
  stock: 3,
  available_sizes: ["41", "44", "45"],
  sizes: ["41", "44", "45"],
  product_url: "https://m1store-egy.com/shop/product/air-jordan-4-sneakers-men",
  storefront_url: "https://m1store-egy.com/shop/product/air-jordan-4-sneakers-men",
};

test("payload contains canonical name, customer price, and canonical URL", () => {
  const out = instagramProductShareText(CARD);
  assert.match(out, /Air Jordan 4 {2}Sneakers for Men/);
  assert.match(out, /السعر: 1550 جنيه/);
  assert.match(out, /عرض المنتج:/);
  assert.match(out, /https:\/\/m1store-egy\.com\/shop\/product\/air-jordan-4-sneakers-men/);
});

test("payload does NOT contain the available-sizes list", () => {
  const out = instagramProductShareText(CARD);
  assert.doesNotMatch(out, /المتاح|المقاسات|41، 44، 45|41, 44, 45/);
});

test("payload does NOT contain a stock count", () => {
  const out = instagramProductShareText(CARD);
  assert.doesNotMatch(out, /قطع|مخزون|\b3\b/);
});

test("payload does NOT contain a duplicate CTA (the approved reply owns the CTA)", () => {
  const out = instagramProductShareText(CARD);
  assert.doesNotMatch(out, /تحب أحجزهولك|تحب أجهزلك|تحب أحجزه/);
});

test("cost / wholesale / supplier / SKU never leak", () => {
  const out = instagramProductShareText(CARD);
  assert.doesNotMatch(out, /1250|1300|ACME|AJ4-BW-45|تكلفة|جملة|مورد/);
});

test("colour is included only when present", () => {
  assert.match(instagramProductShareText(CARD), /اللون: Black&white/);
  assert.doesNotMatch(instagramProductShareText({ ...CARD, color: "" }), /اللون:/);
});

test("product changed → the newly selected canonical product/link is what renders", () => {
  const other = { name: "Jordan 4", price: 450, product_url: "https://m1store-egy.com/shop/product/nike-jordan-4" };
  const out = instagramProductShareText(other);
  assert.match(out, /Jordan 4/);
  assert.match(out, /السعر: 450 جنيه/);
  assert.match(out, /nike-jordan-4/);
  assert.doesNotMatch(out, /air-jordan-4-sneakers-men/);
});

test("Messenger/other channels keep the canonical productCardReplyText (unchanged, richer block)", () => {
  // productCardReplyText still emits the full block (sizes line + CTA) — proves we did NOT touch shared behavior
  const out = productCardReplyText(CARD);
  assert.match(out, /المتاح|المقاسات/);
  assert.match(out, /تحب أحجزهولك|تحب أجهزلك/);
});

test("wiring: ONLY Instagram swaps to the concise formatter (Messenger text fallback + others unchanged)", () => {
  assert.match(metaSrc, /const cardReplyText = normalizedChannel === AI_AGENT_CHANNELS\.INSTAGRAM\s*\n\s*\? instagramProductShareText\(product\)\s*\n\s*: productCardReplyText\(product\);/);
});

test("preview parity: the AI Inbox preview mirrors the server formatter field-for-field", () => {
  // same 5-part shape: name, optional colour, `السعر: <rounded> جنيه`, `عرض المنتج:`, url — guards drift.
  assert.match(inboxSrc, /const instagramShareText = \(card = \{\}\) => \{/);
  assert.match(inboxSrc, /color \? `اللون: \$\{color\}` : ""/);
  assert.match(inboxSrc, /`السعر: \$\{Math\.round\(Number\(price\)\)\} جنيه`/);
  assert.match(inboxSrc, /url \? "عرض المنتج:" : ""/);
  // and it is actually rendered for Instagram delivery in the product-to-send preview
  assert.match(inboxSrc, /instagramDelivery \? \([\s\S]*?instagramShareText\(card\)/);
});

test("product removed → approved text only (no share block); handled by existing removed branch", () => {
  // the removed card path renders the text-only notice and no product preview — unchanged behavior
  assert.match(inboxSrc, /تم حذف كارت المنتج — هيتبعت الرد بس\./);
});
