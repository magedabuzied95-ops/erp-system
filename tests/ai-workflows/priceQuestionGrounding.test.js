// Batch 1A-2 — deterministic price-question grounding.
//
// Phase 14 proved every price turn returned changed=false: the LLM's number reached the operator unchecked. The
// price now comes from the ONE canonical authority (Batch 1A-1) and is read from CURRENT ERP state on every turn.
// The subject may persist across messages; the price never does.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as G from "../../server/services/aiInboxGroundingGate.js";
import { resolveEffectiveCustomerPrice } from "../../src/shared/lib/effectiveCustomerPrice.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const gateSrc = readFileSync(path.join(here, "../../server/services/aiInboxGroundingGate.js"), "utf8");

// Production shape of product 39 (audited): normal 1750, dormant sale 1550, per-record flag ON.
const P39 = { id: 39, name: "Air Jordan 4  Sneakers for Men", product_type: "sneakers",
  selling_price: 1750, price: 1750, regular_price: 1750, sale_price: 1550, sale_price_enabled: true };
const P208 = { id: 208, name: "Air Jordan 4 Retro", product_type: "sneakers", selling_price: 1900, price: 1900 };
const NO_PRICE = { id: 30, name: "Unpriced Sneaker", product_type: "sneakers",
  selling_price: 0, price: 0, regular_price: 0, purchase_selling_price: 0, sale_price: 1200, sale_price_enabled: true, cost_price: 700, wholesale_price: 800 };

const SALE_OFF = { sale_mode_enabled: false };
const SALE_ON = { sale_mode_enabled: true, sale_mode_type: "use_existing_sale_prices_only" };

// deps stand in for the DB: the same canonical resolver the production loader calls.
const deps = ({ products = [P39], saleModeSettings = SALE_OFF, variants = [], subject = null } = {}) => ({
  resolveByBrandModel: async () => products,
  queryProducts: async () => products,
  inventoryFacts: async () => ({ variant_stock: variants }),
  resolveProductSubject: subject ? async () => subject : async () => null,
  resolveProductById: async ({ productId }) => products.find((p) => String(p.id) === String(productId)) || null,
  loadProductPricing: async ({ productId, variantId }) => {
    const product = products.find((p) => String(p.id) === String(productId));
    if (!product) return null;
    const variant = variants.find((v) => String(v.variant_id) === String(variantId)) || null;
    return resolveEffectiveCustomerPrice({ product, variant, saleModeSettings });
  },
});

const ask = (message, opts = {}) =>
  G.applyInboxGroundingGate({ tenantId: 1, sessionId: opts.session || "audit:price", message, deps: deps(opts), reply: opts.reply || null });

// ---------------- explicit product ----------------
test("1/3/8: explicit product price, GLOBAL SALE OFF → the canonical 1750 (never the dormant 1550)", async () => {
  const r = await ask("سعر الجوردن فور كام؟");
  assert.equal(r.changed, true, "the gate must no longer pass a price turn through untouched");
  assert.equal(r.action, "price_grounded");
  assert.match(r.answer, /1750/);
  assert.doesNotMatch(r.answer, /1550/);
  assert.equal(r.price_grounding.active_price, 1750);
  assert.equal(r.price_grounding.price_source, "normal");
  assert.equal(r.price_grounding.price_grounded, true);
});

test("9: GLOBAL SALE ON fixture + valid sale → 1550", async () => {
  const r = await ask("سعر الجوردن فور كام؟", { saleModeSettings: SALE_ON });
  assert.match(r.answer, /1550/);
  assert.equal(r.price_grounding.active_price, 1550);
  assert.equal(r.price_grounding.sale_mode_applied, true);
});

test("21 (MANDATORY): a raw LLM reply quoting the stale 1550 is corrected to 1750", async () => {
  const r = await ask("الجوردن فور بكام؟", { reply: { answer: "سعره 1550 جنيه", suggested_products: [] } });
  assert.match(r.answer, /1750/);
  assert.doesNotMatch(r.answer, /1550/, "the model's number must never survive the gate");
});

test("10/11: the price never persists — the SAME question answers from current Sale state", async () => {
  assert.match((await ask("بكام؟", { subject: { productId: "39", source: "approved_selection", ageSeconds: 30 }, saleModeSettings: SALE_OFF })).answer, /1750/);
  assert.match((await ask("بكام؟", { subject: { productId: "39", source: "approved_selection", ageSeconds: 30 }, saleModeSettings: SALE_ON })).answer, /1550/);
});

// ---------------- elliptical ----------------
for (const q of ["بكام؟", "ده بكام؟", "سعره كام؟", "السعر كام؟"]) {
  test(`1/2/3: elliptical "${q}" + durable subject → grounded current price`, async () => {
    const r = await ask(q, { subject: { productId: "39", source: "approved_selection", ageSeconds: 30 } });
    assert.equal(r.action, "price_grounded");
    assert.match(r.answer, /1750/);
    assert.equal(r.price_grounding.product_id, 39);
  });
}

test("19: an explicit NEW product overrides the durable subject", async () => {
  const r = await ask("سعر الجوردن فور كام؟", {
    products: [P208], subject: { productId: "39", source: "approved_selection", ageSeconds: 30 },
  });
  assert.equal(r.price_grounding.product_id, 208);
  assert.match(r.answer, /1900/);
});

// ---------------- ambiguity ----------------
test("5: ambiguous identity → NO arbitrary price", async () => {
  const r = await ask("الجوردن فور بكام؟", { products: [P39, P208] });
  assert.equal(r.action, "price_ambiguous");
  assert.equal(r.product_ambiguous, true);
  assert.equal(r.price_grounding, null);
  assert.doesNotMatch(r.answer, /\d{3,}/, "no number at all until identity is resolved");
  assert.ok(r.card_choices.length >= 2, "the operator is given the choices instead");
});

// ---------------- variant ----------------
test("6: a grounded variant prices that exact variant", async () => {
  const variants = [{ variant_id: 1421, size: "43", color: "black", stock: 2 }];
  const r = await ask("الجوردن فور الاسود مقاس 43 بكام؟", { variants });
  assert.equal(r.action, "price_grounded");
  assert.equal(r.price_grounding.variant_id, 1421);
  assert.match(r.answer, /1750/);
});

// ---------------- no canonical price ----------------
test("7/12/13/14: no canonical price → no number, and never sale/compare/cost/wholesale", async () => {
  const r = await ask("سعر ده كام؟", { products: [NO_PRICE] });
  assert.equal(r.action, "price_grounded");
  assert.equal(r.price_grounding.has_price, false);
  assert.match(r.answer, /السعر المؤكد مش متاح/);
  for (const forbidden of ["1200", "700", "800"]) assert.doesNotMatch(r.answer, new RegExp(forbidden));
});

// ---------------- contamination / channel parity ----------------
test("20: a support-fact turn never manufactures a product price", async () => {
  const r = await ask("العنوان ايه؟", { subject: { productId: "39", source: "approved_selection", ageSeconds: 30 } });
  assert.equal(r.action, "support_fact");
  assert.equal(r.price_grounding ?? null, null);
  assert.doesNotMatch(String(r.answer || ""), /1750|1550|جنيه/);
});

test("16/17/18: Messenger / Instagram / WhatsApp ground the same price", async () => {
  const prices = [];
  for (const s of ["messenger:p", "instagram:p", "whatsapp:p"]) {
    const r = await ask("سعر الجوردن فور كام؟", { session: s });
    prices.push(r.price_grounding.active_price);
  }
  assert.deepEqual(prices, [1750, 1750, 1750]);
});

// ---------------- invariants ----------------
test("15: the price answer and the Product-to-Send card share ONE authority", () => {
  // the gate resolves price through the canonical resolver, and card enrichment calls the same one
  assert.match(gateSrc, /resolveEffectiveCustomerPrice/);
  assert.match(gateSrc, /loadTenantSaleModeSettings/);
  const sales = readFileSync(path.join(here, "../../server/services/aiSalesAgentService.js"), "utf8");
  assert.match(sales, /const saleModeSettings = await loadTenantSaleModeSettings\(\{ tenantId \}\)/);
  assert.match(sales, /resolveCustomerDisplayPrice\(\s*\n?\s*\{ \.\.\.prod, variant/);
});

test("Sale Mode logic is NOT duplicated in the gate", () => {
  assert.doesNotMatch(gateSrc, /sale_mode_type|sale_price_enabled|isRealSaleActive/);
});

test("internal price metadata is never phrased into the customer answer", async () => {
  const r = await ask("سعر الجوردن فور كام؟");
  for (const leak of ["price_source", "sale_mode", "normal_price", "compare"]) assert.doesNotMatch(r.answer, new RegExp(leak, "i"));
});

test("availability turns are untouched by price grounding (no regression)", async () => {
  const variants = [{ variant_id: 1421, size: "43", color: "black", stock: 2 }];
  const r = await ask("فيه جوردن فور مقاس 43؟", { variants });
  assert.equal(r.action, "available");
  assert.equal(r.price_grounding ?? null, null);
});
