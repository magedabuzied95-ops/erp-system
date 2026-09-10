import test from "node:test";
import assert from "node:assert/strict";

import { getDisplayPricing, storefrontSellingPrice } from "../../src/shared/lib/storefrontPricing.js";

// Product 30 as the storefront API serialises it: no selling price anywhere, and regular_price /
// custom_compare_price filled with the 2,050 compare price. The page used to show 2,050 as the
// price; with that fallback gone it must say "no price", not "0" with a "-100%" badge.
const product = {
  id: 30,
  current_selling_price: 0,
  selling_price: 0,
  price: 0,
  regular_price: 2050,
  original_price: 2050,
  custom_compare_price: 2050,
  use_custom_compare_price: true,
  sale_price: 0,
};
const variant = { id: 1249, current_selling_price: 0, selling_price: 0, price: 0, sale_price: 0, stock: 0 };

test("a size with no price never borrows the compare price as its selling price", () => {
  assert.equal(storefrontSellingPrice(product, variant), 0);
});

test("a size with no price gets no strikethrough and no discount badge", () => {
  const pricing = getDisplayPricing(product, false, variant);
  assert.equal(pricing.price, 0);
  assert.equal(pricing.comparePrice, null);
  assert.equal(pricing.discountPercent, null);
  assert.equal(pricing.isOnSale, false);
});

test("a priced size keeps its compare price and discount", () => {
  const pricing = getDisplayPricing({ ...product, current_selling_price: 1850 }, false, { ...variant, current_selling_price: 1850 });
  assert.equal(pricing.price, 1850);
  assert.equal(pricing.comparePrice, 2050);
  assert.equal(pricing.discountPercent, 10);
});
