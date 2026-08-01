import test from "node:test";
import assert from "node:assert/strict";
import { normalizePurchaseQuantity } from "../src/modules/products/lib/purchaseQuantity.js";

test("an explicitly consumed purchase quantity stays zero instead of falling back to stock", () => {
  assert.equal(normalizePurchaseQuantity(0, undefined, 6, 6), 0);
});

test("a positive saved purchase quantity remains available before purchase consumption", () => {
  assert.equal(normalizePurchaseQuantity(undefined, null, "", 4, 9), 4);
});
