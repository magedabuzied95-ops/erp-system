import test from "node:test";
import assert from "node:assert/strict";

import { buildMetaCatalogItem } from "../../server/services/metaCatalogFeedService.js";

const baseRow = (overrides = {}) => ({
  product_id: 10,
  variant_id: 20,
  variant_sku: "SKU-20",
  sku_count: 1,
  product_name: "Test product",
  variant_stock: 3,
  variant_selling_price: 500,
  variant_sale_price: 0,
  variant_sale_price_enabled: false,
  ...overrides,
});

test("product without a discount omits Meta sale fields", () => {
  const item = buildMetaCatalogItem(baseRow());
  assert.equal(item.price, "500.00 EGP");
  assert.equal(Object.hasOwn(item, "sale_price"), false);
  assert.equal(Object.hasOwn(item, "sale_price_effective_date"), false);
});

test("a valid original price sends original as price and selling as sale_price", () => {
  const item = buildMetaCatalogItem(baseRow({
    use_custom_compare_price: true,
    custom_compare_price: 700,
  }));
  assert.equal(item.price, "700.00 EGP");
  assert.equal(item.sale_price, "500.00 EGP");
});

test("original price equal to or below selling price is not a discount", () => {
  for (const originalPrice of [500, 400]) {
    const item = buildMetaCatalogItem(baseRow({
      use_custom_compare_price: true,
      custom_compare_price: originalPrice,
    }));
    assert.equal(item.price, "500.00 EGP");
    assert.equal(Object.hasOwn(item, "sale_price"), false);
  }
});

test("variant legacy discount is used only when independently enabled and valid", () => {
  const discounted = buildMetaCatalogItem(baseRow({
    variant_selling_price: 700,
    variant_sale_price: 500,
    variant_sale_price_enabled: true,
  }));
  assert.equal(discounted.price, "700.00 EGP");
  assert.equal(discounted.sale_price, "500.00 EGP");

  for (const variantSale of [700, 800]) {
    const item = buildMetaCatalogItem(baseRow({
      variant_selling_price: 700,
      variant_sale_price: variantSale,
      variant_sale_price_enabled: true,
    }));
    assert.equal(item.price, "700.00 EGP");
    assert.equal(Object.hasOwn(item, "sale_price"), false);
  }

  const disabled = buildMetaCatalogItem(baseRow({
    variant_selling_price: 700,
    variant_sale_price: 500,
    variant_sale_price_enabled: false,
  }));
  assert.equal(Object.hasOwn(disabled, "sale_price"), false);
});

test("product discount applies to variants that do not define an enabled variant discount", () => {
  const item = buildMetaCatalogItem(baseRow({
    variant_selling_price: 700,
    product_sale_price: 500,
    product_sale_price_enabled: true,
  }));
  assert.equal(item.price, "700.00 EGP");
  assert.equal(item.sale_price, "500.00 EGP");
});

test("sale effective date is sent only when both real dates form a valid range", () => {
  const item = buildMetaCatalogItem(baseRow({
    use_custom_compare_price: true,
    custom_compare_price: 700,
    product_sale_start_at: "2026-07-01T00:00:00Z",
    product_sale_end_at: "2026-07-31T23:59:59Z",
  }));
  assert.equal(item.sale_price_effective_date, "2026-07-01T00:00:00.000Z/2026-07-31T23:59:59.000Z");
});
