import test from "node:test";
import assert from "node:assert/strict";
import { storefrontSellingPrice } from "../src/shared/lib/storefrontPricing.js";

test("selected variant price wins over the product-level price", () => {
  const product = { current_selling_price: 1200, selling_price: 1200 };
  const variant = { id: 502, selling_price: 1450, price: 1450 };

  assert.equal(storefrontSellingPrice(product, variant), 1450);
});

test("selected variant current price wins when present", () => {
  const product = { current_selling_price: 1200 };
  const variant = { id: 503, current_selling_price: 1600, selling_price: 1450 };

  assert.equal(storefrontSellingPrice(product, variant), 1600);
});
