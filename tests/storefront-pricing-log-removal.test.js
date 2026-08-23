import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// resolveCustomerFacingDisplayPrice ran once per variant (3,325× on a cold products
// build) and unconditionally emitted an "[ai-price-source]" log containing wholesale
// and cost price. The census found no consumer. These tests pin its removal and prove
// the pricing arithmetic and return shape were not touched.

const source = fs.readFileSync(
  new URL("../server/controllers/storefrontController.js", import.meta.url),
  "utf8"
);
const fn = source.slice(
  source.indexOf("const resolveCustomerFacingDisplayPrice ="),
  source.indexOf("const storefrontComparePriceFor =")
);

test("the hot-path [ai-price-source] emitter is gone from the storefront controller", () => {
  assert.equal(source.includes("ai-price-source"), false);
  assert.doesNotMatch(fn, /console\.(log|debug|info|error)\(/);
});

test("no console output of any kind remains in the per-variant pricing resolvers", () => {
  const activePrice = source.slice(
    source.indexOf("const resolveStorefrontActivePrice ="),
    source.indexOf("const resolveCustomerFacingDisplayPrice =")
  );
  assert.doesNotMatch(activePrice, /console\./);
  assert.doesNotMatch(fn, /console\./);
});

test("the return value and its field set are unchanged", () => {
  assert.match(
    fn,
    /return \{ selected_display_price, selected_price_source, selling_price: selling, sale_price: sale, wholesale_price, cost_price \};/
  );
});

test("pricing arithmetic is byte-identical to the pre-change implementation", () => {
  assert.match(fn, /const sale = roundMoney\(variant\.sale_price \?\? product\.sale_price \?\? 0\);/);
  assert.match(fn, /const selling = roundMoney\(variant\.selling_price \?\? variant\.price \?\? product\.selling_price \?\? product\.price \?\? product\.regular_price \?\? 0\);/);
  // 2026-08-23: a curated Offer now activates its own sale price without the global toggle, so the gate reads
  // `(explicitSaleMode || forcedOffer)`. The arithmetic around it — the three guards that keep a sale from ever
  // raising a price — is still pinned exactly. See tests/offers-force-sale-price.test.js.
  assert.match(fn, /const forcedOffer = isForcedOfferSale\(product\) \|\| isForcedOfferSale\(variant\);/);
  assert.match(fn, /const saleApplied = \(explicitSaleMode \|\| forcedOffer\) && sale > 0 && selling > 0 && sale < selling;/);
  assert.match(fn, /const selected_display_price = saleApplied \? sale : selling > 0 \? selling : sale;/);
  assert.match(fn, /const selected_price_source = saleApplied \|\| \(selling <= 0 && sale > 0\) \? "sale_price" : "selling_price";/);
  assert.match(fn, /const wholesale_price = roundMoney\(variant\.wholesale_price \?\?/);
  assert.match(fn, /const cost_price = roundMoney\(variant\.cost_price \?\? product\.cost_price \?\? 0\);/);
  // sale-mode branch (object vs null pricingSettings) must be preserved
  assert.match(fn, /const explicitSaleMode = pricingSettings && typeof pricingSettings === "object"/);
});

test("the other [ai-price-source] emitters were deliberately left untouched", () => {
  for (const file of ["../server/utils/customerDisplayPrice.js", "../server/services/metaIntegrationService.js"]) {
    let other;
    try { other = fs.readFileSync(new URL(file, import.meta.url), "utf8"); } catch { continue; }
    assert.ok(other.includes("ai-price-source"), `${file} must keep its emitter in this phase`);
  }
});
