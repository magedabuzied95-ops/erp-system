import test from "node:test";
import assert from "node:assert/strict";

import {
  GOOGLE_PRODUCT_CATEGORIES,
  resolveMetaProductCategories,
} from "../../server/services/metaProductCategoryResolver.js";
import {
  buildMetaCatalogItem,
  metaCatalogItemXml,
} from "../../server/services/metaCatalogFeedService.js";

const baseRow = (overrides = {}) => ({
  product_id: 10,
  variant_id: 20,
  variant_sku: "SKU-20",
  sku_count: 1,
  product_name: "Test product",
  product_type: "Sneakers",
  variant_stock: 3,
  product_selling_price: 500,
  color: "Black",
  size: "42",
  ...overrides,
});

test("maps the supported real product types to official Google taxonomy paths", () => {
  const cases = [
    ["Sneakers", GOOGLE_PRODUCT_CATEGORIES.SNEAKERS],
    ["Slippers", GOOGLE_PRODUCT_CATEGORIES.SLIPPERS],
    ["Bags", GOOGLE_PRODUCT_CATEGORIES.BAGS],
    ["Crocs", GOOGLE_PRODUCT_CATEGORIES.CROCS],
  ];

  for (const [productType, expected] of cases) {
    assert.equal(resolveMetaProductCategories({ product_type: productType }).googleProductCategory, expected);
  }
});

test("matching is case-insensitive, whitespace-tolerant, and supports Arabic aliases", () => {
  for (const value of ["sneakers", "SNEAKERS", " Sneakers ", "كوتشي", "أحذية رياضية"]) {
    assert.equal(resolveMetaProductCategories({ product_type: value }).googleProductCategory, GOOGLE_PRODUCT_CATEGORIES.SNEAKERS);
  }
  assert.equal(resolveMetaProductCategories({ product_type: "شنط" }).googleProductCategory, GOOGLE_PRODUCT_CATEGORIES.BAGS);
  assert.equal(resolveMetaProductCategories({ product_type: "كروكس" }).googleProductCategory, GOOGLE_PRODUCT_CATEGORIES.CROCS);
  assert.equal(resolveMetaProductCategories({ product_type: "شباشب" }).googleProductCategory, GOOGLE_PRODUCT_CATEGORIES.SLIPPERS);
});

test("explicit product category override wins over automatic mapping", () => {
  const custom = "Apparel & Accessories > Shoes > Boots";
  const result = resolveMetaProductCategories({
    product_type: "Sneakers",
    google_product_category: custom,
  });
  assert.equal(result.googleProductCategory, custom);
  assert.equal(result.matchedBy, "product.google_product_category");
});

test("a resolved variant override can replace the parent automatic mapping", () => {
  const variantOverride = "Apparel & Accessories > Shoes > Boots";
  const item = buildMetaCatalogItem(baseRow({
    product_type: "Sneakers",
    google_product_category: variantOverride,
  }));
  assert.equal(item.google_product_category, variantOverride);
});

test("category is used after product_type and bags never fall back to shoes", () => {
  assert.equal(
    resolveMetaProductCategories({ product_type: "", category_name: "Bags" }).googleProductCategory,
    GOOGLE_PRODUCT_CATEGORIES.BAGS
  );
  assert.notEqual(
    resolveMetaProductCategories({ product_type: "Bags" }).googleProductCategory,
    GOOGLE_PRODUCT_CATEGORIES.SHOES
  );
});

test("unknown values emit neither placeholders nor empty XML tags", () => {
  const item = buildMetaCatalogItem(baseRow({
    product_type: "Mirror Original",
    category_name: "Offers",
  }));
  const output = metaCatalogItemXml(item);
  assert.equal(item.google_product_category, "");
  assert.equal(output.includes("google_product_category"), false);
  assert.equal(/undefined|null|غير موجود/i.test(output), false);
});

test("every variant inherits the same parent product category", () => {
  const first = buildMetaCatalogItem(baseRow({ variant_id: 20, size: "41", product_type: "Crocs" }));
  const second = buildMetaCatalogItem(baseRow({ variant_id: 21, size: "42", product_type: "Crocs" }));
  assert.equal(first.google_product_category, GOOGLE_PRODUCT_CATEGORIES.CROCS);
  assert.equal(second.google_product_category, GOOGLE_PRODUCT_CATEGORIES.CROCS);
});

test("XML contains one escaped Google category tag and preserves pricing and content IDs", () => {
  const item = buildMetaCatalogItem(baseRow({
    product_type: "Bags",
    use_custom_compare_price: true,
    custom_compare_price: 700,
  }));
  const output = metaCatalogItemXml(item);

  assert.equal(item.id, "SKU-20");
  assert.equal(item.item_group_id, "10");
  assert.equal(item.price, "700.00 EGP");
  assert.equal(item.sale_price, "500.00 EGP");
  assert.equal((output.match(/<g:google_product_category>/g) || []).length, 1);
  assert.match(
    output,
    /<g:google_product_category>Apparel &amp; Accessories &gt; Handbags, Wallets &amp; Cases &gt; Handbags<\/g:google_product_category>/
  );
  assert.equal(output.includes("Apparel & Accessories >"), false);
  assert.equal(output.includes("<g:fb_product_category>"), false);
});
