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

test("Products List shows the discount typed on the purchase invoice, read from the size rows like the shop", async () => {
  const { readFileSync } = await import("node:fs");
  const controller = readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
  const listBody = controller.slice(controller.indexOf("export const getProductsAdminList"), controller.indexOf("export const getProducts = "));
  assert.match(listBody, /AD_FEED_PURCHASE_CTES/, "admin-list must price discounts through the shared invoice-line definition");
  assert.match(listBody, /list_sale_prices:/);
  const page = readFileSync(new URL("../src/modules/products/pages/ProductsList.jsx", import.meta.url), "utf8");
  assert.match(page, /row\.list_sale_prices/, "the list card must read the sizes' discounts, not only products.sale_price");
});
