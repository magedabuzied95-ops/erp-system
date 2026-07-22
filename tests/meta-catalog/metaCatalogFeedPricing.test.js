import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMetaCatalogItem,
  metaCatalogItemXml,
  resolveMetaCatalogComparePrice,
  resolveMetaCatalogCurrentPrice,
} from "../../server/services/metaCatalogFeedService.js";

const baseRow = (overrides = {}) => ({
  product_id: 10,
  variant_id: 20,
  variant_sku: "SKU-20",
  sku_count: 1,
  product_name: "Test product",
  variant_stock: 3,
  product_selling_price: 500,
  ...overrides,
});

test("valid compare-at price sends original price and current sale price", () => {
  const row = baseRow({ use_custom_compare_price: true, custom_compare_price: 700 });
  const item = buildMetaCatalogItem(row);
  const xml = metaCatalogItemXml(item);

  assert.equal(resolveMetaCatalogCurrentPrice(row), 500);
  assert.equal(resolveMetaCatalogComparePrice(row), 700);
  assert.equal(item.price, "700.00 EGP");
  assert.equal(item.sale_price, "500.00 EGP");
  assert.match(xml, /<g:price>700\.00 EGP<\/g:price>/);
  assert.match(xml, /<g:sale_price>500\.00 EGP<\/g:sale_price>/);
  assert.equal(xml.includes("<g:sale_price_effective_date>"), false);
});

test("missing or invalid compare-at price sends current price only", () => {
  for (const comparePrice of [undefined, 500, 400]) {
    const row = baseRow({
      use_custom_compare_price: comparePrice !== undefined,
      custom_compare_price: comparePrice,
    });
    const item = buildMetaCatalogItem(row);
    const xml = metaCatalogItemXml(item);
    assert.equal(item.price, "500.00 EGP");
    assert.equal(Object.hasOwn(item, "sale_price"), false);
    assert.equal(xml.includes("<g:sale_price>"), false);
    assert.equal(xml.includes("<g:sale_price_effective_date>"), false);
  }
});

test("Nike stale variant sale 550 cannot override current 650 and compare-at 900", () => {
  const row = baseRow({
    product_name: "Nike Air Jordan 1 Low",
    variant_sku: "NAJ-J1-M-LOC-BLK-32",
    product_selling_price: 650,
    product_regular_price: 650,
    variant_selling_price: 900,
    variant_regular_price: 900,
    variant_sale_price: 550,
    variant_sale_price_enabled: true,
    use_custom_compare_price: true,
    custom_compare_price: 900,
  });
  const item = buildMetaCatalogItem(row);
  const xml = metaCatalogItemXml(item);

  assert.equal(resolveMetaCatalogCurrentPrice(row), 650);
  assert.equal(resolveMetaCatalogComparePrice(row), 900);
  assert.equal(item.id, "NAJ-J1-M-LOC-BLK-32");
  assert.equal(item.price, "900.00 EGP");
  assert.equal(item.sale_price, "650.00 EGP");
  assert.match(xml, /<g:id>NAJ-J1-M-LOC-BLK-32<\/g:id>/);
  assert.match(xml, /<g:price>900\.00 EGP<\/g:price>/);
  assert.match(xml, /<g:sale_price>650\.00 EGP<\/g:sale_price>/);
  assert.equal(xml.includes("550.00 EGP"), false);
  assert.equal(xml.includes("<g:sale_price_effective_date>"), false);
});
