import test from "node:test";
import assert from "node:assert/strict";
import { resolveAdminListCurrentSellingPrice } from "../server/controllers/productsController.js";

test("Products List API resolves a variant manual override instead of returning the old product price or zero", () => {
  const price = resolveAdminListCurrentSellingPrice({
    selling_price: 0,
    purchase_selling_price: 1000,
    list_variant_id: 3114,
    list_variant_purchase_selling_price: 1100,
    list_variant_manual_selling_price: 1200,
    list_variant_manual_price_override_active: true,
  });
  assert.equal(price, 1200);
  assert.notEqual(price, 0);
});

test("Products List API falls back to the selected variant purchase suggestion when no override exists", () => {
  assert.equal(resolveAdminListCurrentSellingPrice({
    selling_price: 0,
    list_variant_id: 3114,
    list_variant_purchase_selling_price: 1100,
  }), 1100);
});
