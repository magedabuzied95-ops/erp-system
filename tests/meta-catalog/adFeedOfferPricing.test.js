import test from "node:test";
import assert from "node:assert/strict";

import { buildMetaCatalogItem, resolveMetaCatalogActivePrice, resolveMetaCatalogCurrentPrice } from "../../server/services/metaCatalogFeedService.js";
import { resolveGoogleFeedPricing } from "../../server/services/googleMerchantFeedService.js";

// Product 568 in production: priced only by its purchase invoice, sitting in العروض with a
// stored sale price the shop actually charges, while both feeds advertised the normal price.
const offerRow = (overrides = {}) => ({
  product_id: 568,
  variant_id: 7990,
  variant_sku: "CK-568-39",
  sku_count: 1,
  product_name: "Calvin Klein",
  product_type: "Sneakers",
  color: "Grey",
  size: "39",
  variant_stock: 2,
  product_purchase_selling_price: 650,
  use_custom_compare_price: true,
  custom_compare_price: 700,
  product_sale_price: 550,
  product_is_offer_story: "true",
  ...overrides,
});

test("a curated offer is advertised at the price the shop charges", () => {
  const row = offerRow();
  assert.equal(resolveMetaCatalogActivePrice(row), 550);

  const item = buildMetaCatalogItem(row);
  assert.equal(item.price, "700.00 EGP");
  assert.equal(item.sale_price, "550.00 EGP");

  const google = resolveGoogleFeedPricing(row);
  assert.equal(google.active_price, 550);
  assert.equal(google.sale_price, 550);
  assert.equal(google.price, 700);
});

test("with no compare price the normal price becomes the strikethrough", () => {
  const row = offerRow({ use_custom_compare_price: false, custom_compare_price: 0 });
  const item = buildMetaCatalogItem(row);
  assert.equal(item.price, "650.00 EGP");
  assert.equal(item.sale_price, "550.00 EGP");

  const google = resolveGoogleFeedPricing(row);
  assert.deepEqual(google, { price: 650, sale_price: 550, active_price: 550 });
});

test("a stored sale price on a product that is NOT an offer stays dormant while Sale Mode is off", () => {
  const row = offerRow({ product_is_offer_story: "false" });
  assert.equal(resolveMetaCatalogActivePrice(row), 650);

  const item = buildMetaCatalogItem(row);
  assert.equal(item.price, "700.00 EGP");
  assert.equal(item.sale_price, "650.00 EGP");
  assert.equal(resolveGoogleFeedPricing(row).active_price, 650);
});

test("the same dormant sale price goes live when the global toggle is on", () => {
  // Outside العروض it takes BOTH: the global toggle and the record's own enable flag.
  const row = offerRow({ product_is_offer_story: "false", product_sale_price_enabled: "true" });
  const saleModeSettings = { sale_mode_enabled: true };
  assert.equal(resolveMetaCatalogActivePrice(row, { saleModeSettings }), 550);
  assert.equal(resolveGoogleFeedPricing(row, { saleModeSettings }).active_price, 550);
});

test("a sale price that is not a discount can never raise the advertised price", () => {
  for (const salePrice of [650, 900]) {
    const row = offerRow({ product_sale_price: salePrice });
    assert.equal(resolveMetaCatalogActivePrice(row), 650);
    assert.equal(resolveGoogleFeedPricing(row).active_price, 650);
  }
});

test("the variant's own sale price is read as well as the product's", () => {
  const row = offerRow({ product_sale_price: null, variant_sale_price: 500 });
  assert.equal(resolveMetaCatalogActivePrice(row), 500);
  assert.equal(resolveGoogleFeedPricing(row).active_price, 500);
});

test("the Google item links to the colourway it advertises", async () => {
  const { buildGoogleMerchantItem } = await import("../../server/services/googleMerchantFeedService.js");
  const item = buildGoogleMerchantItem({
    ...offerRow(),
    slug: "louis-vuitton-lv",
    product_name: "Louis Vuitton LV",
    variant_barcode: "",
    variant_article_code: "LV-1",
    brand_name: "LV",
  });
  assert.equal(item.link, "https://m1store-egy.com/product/louis-vuitton-lv?color=Grey");
});

test("the winning invoice line's sale price is the offer price, ahead of the variant column", () => {
  // Product 568: pv.sale_price is 0.00, the invoice that brought the colour in recorded 550
  // against a selling price of 650, and the shop sells at 550. The SQL (adFeedPurchaseLinesSql)
  // hands the row the winning line's sale price, already COALESCEd with the column.
  const row = offerRow({ product_sale_price: 0, variant_sale_price: 0, variant_line_sale_price: 550 });
  assert.equal(resolveMetaCatalogActivePrice(row), 550);
  assert.equal(resolveGoogleFeedPricing(row).active_price, 550);

  const both = offerRow({ product_sale_price: 0, variant_sale_price: 600, variant_line_sale_price: 550 });
  assert.equal(resolveMetaCatalogActivePrice(both), 550);
  assert.equal(resolveGoogleFeedPricing(both).active_price, 550);
});

test("a manual override outranks the purchase-invoice price in BOTH feeds", async () => {
  // Product 707: variants carry purchase 1,100 and a manual override of 1,700; the shop
  // charges 1,700 and the Google feed used to advertise 1,100.
  const row = {
    product_id: 707,
    variant_id: 8833,
    product_name: "Momolly Bag",
    product_type: "Bags",
    color: "Blue & Green",
    size: "16-inch",
    variant_stock: 1,
    variant_purchase_selling_price: 1100,
    variant_manual_selling_price: 1700,
    variant_manual_price_override_active: true,
    use_custom_compare_price: true,
    custom_compare_price: 2300,
  };
  assert.equal(resolveMetaCatalogActivePrice(row), 1700);
  assert.equal(resolveGoogleFeedPricing(row).active_price, 1700);
  assert.equal(resolveGoogleFeedPricing(row).sale_price, 1700);
  assert.equal(resolveGoogleFeedPricing(row).price, 2300);
});

test("a size's own price is advertised, not the product row's", () => {
  // Product 293: the product row says 400, sizes 31/32/34/35 carry their own 650, and since
  // a195289 the storefront charges each size its own price. The Meta feed used to swap a
  // size's legacy price for the product's and advertised 400 on every size.
  const row = {
    product_id: 293,
    variant_id: 5217,
    product_name: "Nike Sneakers",
    product_type: "Sneakers",
    color: "Mint",
    size: "31",
    variant_stock: 1,
    product_selling_price: 400,
    product_price: 650,
    variant_selling_price: 650,
    variant_price: 650,
  };
  assert.equal(resolveMetaCatalogCurrentPrice(row), 650);
  assert.equal(resolveMetaCatalogActivePrice(row), 650);
  assert.equal(resolveGoogleFeedPricing(row).active_price, 650);

  // A size with no price of its own still falls back to the product.
  const priceless = { ...row, variant_selling_price: 0, variant_price: 0 };
  assert.equal(resolveMetaCatalogCurrentPrice(priceless), 400);
  assert.equal(resolveGoogleFeedPricing(priceless).active_price, 400);
});
