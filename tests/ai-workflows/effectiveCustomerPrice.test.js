// Batch 1A — canonical effective-customer-price authority.
//
// Two jobs:
//   1. POS PARITY (non-negotiable): for identical inputs the shared resolver must return the SAME active price as
//      the live POS helper (getPosEffectivePrice), so migrating the AI paths cannot drift from what POS charges.
//   2. The owner's confirmed pricing contract: global Sale OFF ⇒ dormant sale_price is ignored; compare/cost/
//      wholesale never become the active price; no canonical normal price ⇒ no fabricated price.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveCustomerPrice } from "../../src/shared/lib/effectiveCustomerPrice.js";
import { resolveCurrentSellingPrice } from "../../src/shared/lib/currentSellingPrice.js";
import { getPosEffectivePrice } from "../../src/modules/pos/lib/posPricing.js";

const SALE_OFF = { sale_mode_enabled: false };
const SALE_ON = { sale_mode_enabled: true, sale_mode_type: "use_existing_sale_prices_only" };
const active = (product, variant = null, settings = SALE_OFF) =>
  resolveEffectiveCustomerPrice({ product, variant, saleModeSettings: settings }).active_price;

// Real production shape of product 39 (audited 2026-08-13): normal 1750, dormant sale 1550, per-record flag ON.
const P39 = {
  id: 39, selling_price: 1750, price: 1750, regular_price: 1750, purchase_selling_price: 0,
  sale_price: 1550, sale_price_enabled: true, sale_start_at: null, sale_end_at: null, use_custom_compare_price: true,
};
// Real production shape of the purchase-priced products (e.g. 445, 35, 47): ONLY purchase_selling_price is set.
const PURCHASE_ONLY = {
  id: 445, selling_price: 0, price: 0, regular_price: 0, purchase_selling_price: 1750,
  sale_price: 1600, sale_price_enabled: true,
};

// ---------------- 1. POS PARITY ----------------
const PARITY_CASES = [
  ["sale OFF, dormant sale price", P39, null, SALE_OFF],
  ["sale ON, valid active sale", P39, null, SALE_ON],
  ["sale ON, expired sale", { ...P39, sale_end_at: "2020-01-01T00:00:00Z" }, null, SALE_ON],
  ["sale ON, future sale", { ...P39, sale_start_at: "2999-01-01T00:00:00Z" }, null, SALE_ON],
  ["sale ON, per-record flag OFF", { ...P39, sale_price_enabled: false }, null, SALE_ON],
  ["sale ON, sale >= normal (invalid)", { ...P39, sale_price: 1750 }, null, SALE_ON],
  ["sale ON, sale price missing", { ...P39, sale_price: 0 }, null, SALE_ON],
  ["excluded product", P39, null, { ...SALE_ON, sale_mode_excluded_product_ids: ["39"] }],
  ["excluded category", { ...P39, category_id: 7 }, null, { ...SALE_ON, sale_mode_excluded_category_ids: ["7"] }],
  ["excluded brand", { ...P39, brand_id: 1 }, null, { ...SALE_ON, sale_mode_excluded_brand_ids: ["1"] }],
  ["percentage mode", P39, null, { sale_mode_enabled: true, sale_mode_type: "percentage_discount", sale_mode_value: 10 }],
  ["fixed mode", P39, null, { sale_mode_enabled: true, sale_mode_type: "fixed_discount", sale_mode_value: 200 }],
  ["min-margin floor", { ...P39, cost_price: 1500 }, null, { sale_mode_enabled: true, sale_mode_type: "percentage_discount", sale_mode_value: 50, sale_mode_min_price_protection_enabled: true, sale_mode_min_margin_percent: 10 }],
  ["variant overrides product", P39, { id: 1421, selling_price: 1800, sale_price: 1500, sale_price_enabled: true }, SALE_OFF],
  ["legacy price-only product", { id: 9, price: 900 }, null, SALE_OFF],
  ["offer-forced sale, global ON", { ...P39, is_offer: true }, null, SALE_ON],
  ["offer-forced sale, global OFF", { ...P39, is_offer: true }, null, SALE_OFF],
];

for (const [label, product, variant, settings] of PARITY_CASES) {
  test(`POS parity: ${label}`, () => {
    // The POS helper receives current_selling_price already resolved (the admin/POS API computes it), which is how
    // production feeds it — so parity is asserted on that same shape.
    const normal = resolveCurrentSellingPrice({ product, variant: variant || {} }).value;
    const pos = getPosEffectivePrice({
      product: { ...product, current_selling_price: normal },
      variant: variant ? { ...variant, current_selling_price: normal } : null,
      saleModeSettings: settings,
    });
    const shared = resolveEffectiveCustomerPrice({ product, variant, saleModeSettings: settings });
    assert.equal(shared.active_price, pos.final_price, `${label}: shared ${shared.active_price} vs POS ${pos.final_price}`);
  });
}

test("POS parity: purchase_selling_price-only product (the 272-product shape)", () => {
  const normal = resolveCurrentSellingPrice({ product: PURCHASE_ONLY, variant: {} }).value;
  assert.equal(normal, 1750, "purchase_selling_price is the canonical normal price when the legacy columns are 0");
  const pos = getPosEffectivePrice({ product: { ...PURCHASE_ONLY, current_selling_price: normal }, saleModeSettings: SALE_OFF });
  assert.equal(resolveEffectiveCustomerPrice({ product: PURCHASE_ONLY, saleModeSettings: SALE_OFF }).active_price, pos.final_price);
});

// ---------------- 2. THE CONFIRMED PRICING CONTRACT ----------------
test("1: product 39 shape + GLOBAL SALE OFF → 1750 (the dormant 1550 is ignored)", () => {
  const r = resolveEffectiveCustomerPrice({ product: P39, saleModeSettings: SALE_OFF });
  assert.equal(r.active_price, 1750);
  assert.equal(r.price_source, "normal");
  assert.equal(r.sale_mode_applied, false);
  assert.equal(r.reason, "global_sale_mode_off");
  assert.equal(r.sale_price, 1550, "the dormant number is still reported as internal metadata");
});

test("2: same shape + GLOBAL SALE ON + valid sale → 1550", () => {
  const r = resolveEffectiveCustomerPrice({ product: P39, saleModeSettings: SALE_ON });
  assert.equal(r.active_price, 1550);
  assert.equal(r.price_source, "sale");
  assert.equal(r.sale_mode_applied, true);
});

test("3: stale sale value + global OFF → normal, whatever the per-record flags claim", () => {
  for (const noise of ["sale_active", "on_sale", "has_sale", "use_sale_price", "discount_enabled", "is_sale_active"]) {
    const r = resolveEffectiveCustomerPrice({ product: { ...P39, [noise]: true }, saleModeSettings: SALE_OFF });
    assert.equal(r.active_price, 1750, `legacy flag ${noise} must not activate a sale`);
  }
});

test("4/5: expired and future sales fall back to normal even with global sale ON", () => {
  assert.equal(active({ ...P39, sale_end_at: "2020-01-01T00:00:00Z" }, null, SALE_ON), 1750);
  assert.equal(active({ ...P39, sale_start_at: "2999-01-01T00:00:00Z" }, null, SALE_ON), 1750);
});

test("6: exclusions fall back to normal", () => {
  assert.equal(active(P39, null, { ...SALE_ON, sale_mode_excluded_product_ids: ["39"] }), 1750);
});

test("7: manual override wins the NORMAL tier", () => {
  const r = resolveEffectiveCustomerPrice({
    product: { ...P39, manual_price_override_active: true, manual_selling_price: 1900 },
    saleModeSettings: SALE_OFF,
  });
  assert.equal(r.active_price, 1900);
  assert.equal(r.normal_price_source, "product_manual_override");
});

test("8: purchase_selling_price-only product resolves a valid normal price", () => {
  const r = resolveEffectiveCustomerPrice({ product: PURCHASE_ONLY, saleModeSettings: SALE_OFF });
  assert.equal(r.active_price, 1750);
  assert.equal(r.normal_price_source, "product_purchase_selling_price");
});

test("9: purchase_selling_price and selling_price both set and equal → same result (the 38-product shape)", () => {
  const both = { id: 5, purchase_selling_price: 1650, selling_price: 1650, price: 1650 };
  assert.equal(active(both), 1650);
});

test("10: NO canonical normal price → no price at all, never the dormant sale/cost/wholesale", () => {
  const r = resolveEffectiveCustomerPrice({
    product: { id: 77, selling_price: 0, price: 0, regular_price: 0, purchase_selling_price: 0, sale_price: 1200, sale_price_enabled: true, cost_price: 800, wholesale_price: 900 },
    saleModeSettings: SALE_ON,
  });
  assert.equal(r.active_price, 0);
  assert.equal(r.has_price, false);
  assert.equal(r.price_source, "none");
  assert.equal(r.reason, "no_canonical_normal_price");
});

test("11: compare price is never the active price", () => {
  const r = resolveEffectiveCustomerPrice({
    product: { id: 8, selling_price: 1200, regular_price: 2000, use_custom_compare_price: true },
    saleModeSettings: SALE_OFF,
  });
  assert.equal(r.active_price, 1200);
  assert.equal(r.compare_price, 2000, "compare is returned as display metadata only");
  assert.notEqual(r.active_price, r.compare_price);
});

test("12: cost/wholesale/purchase cost can never be selected", () => {
  const r = resolveEffectiveCustomerPrice({
    product: { id: 9, selling_price: 1500, cost_price: 400, wholesale_price: 600, purchase_price: 500, last_purchase_price: 450 },
    saleModeSettings: SALE_ON,
  });
  assert.equal(r.active_price, 1500);
  for (const k of Object.keys(r)) assert.doesNotMatch(k, /cost|wholesale|purchase_price/i);
});

test("variant identity: a variant's own price and sale state beat the product's", () => {
  const r = resolveEffectiveCustomerPrice({
    product: P39,
    variant: { id: 1421, purchase_selling_price: 1900, sale_price: 1700, sale_price_enabled: true },
    saleModeSettings: SALE_ON,
  });
  assert.equal(r.normal_price, 1900);
  assert.equal(r.active_price, 1700);
});
