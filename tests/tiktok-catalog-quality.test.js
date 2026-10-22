import { test } from "node:test";
import assert from "node:assert/strict";

import { buildMetaCatalogItem } from "../server/services/metaCatalogFeedService.js";
import {
  NO_PHOTO_LABEL,
  TIKTOK_CATALOG_COLUMNS,
  buildTikTokCatalogFromItems,
  isLogoFallbackImage,
  tiktokCatalogCsv,
  tiktokCatalogRow,
} from "../server/modules/tiktok/tiktokCatalogFeed.js";
import { compareCatalogCoverage, coverageIsHealthy, parseFeedSkuIds } from "../server/modules/tiktok/tiktokCatalogCoverage.js";

const row = (overrides = {}) => ({
  product_id: 794,
  variant_id: 9001,
  variant_sku: "SAU-RUN-BLK-41",
  sku_count: 1,
  product_name: "Saucony Running",
  slug: "saucony-running",
  brand_name: "Saucony",
  variant_stock: 2,
  product_selling_price: 1200,
  color: "Black",
  size: "41",
  ...overrides,
});
const tiktokRow = (overrides) => tiktokCatalogRow(buildMetaCatalogItem(row(overrides))).row;

/* ------------------------------------------------------------------ custom_label_0 = no_photo */

test("a colourway with no photo at any level ships the logo AND is labelled no_photo — through the real Meta builder", () => {
  const photoless = tiktokRow({});
  assert.ok(isLogoFallbackImage(photoless.image_link), "the Meta feed's fallback is the shop logo");
  assert.equal(photoless.custom_label_0, NO_PHOTO_LABEL);
  assert.equal(photoless.sku_id, "SAU-RUN-BLK-41", "the id is unchanged: labelled, never removed");
});

test("a real photo at colour, size or product level is not labelled", () => {
  assert.equal(tiktokRow({ primary_color_image: "/uploads/products/colour.jpg" }).custom_label_0, "");
  assert.equal(tiktokRow({ variant_image_url: "/uploads/products/size.jpg" }).custom_label_0, "");
  assert.equal(tiktokRow({ product_image_url: "/uploads/products/model.png" }).custom_label_0, "");
});

test("custom_label_0 is the last CSV column, and the build counts no_photo rows", () => {
  assert.equal(TIKTOK_CATALOG_COLUMNS.at(-1), "custom_label_0");
  const { csv, stats } = buildTikTokCatalogFromItems([
    buildMetaCatalogItem(row()),
    buildMetaCatalogItem(row({ variant_id: 9002, variant_sku: "SAU-RUN-BLK-42", size: "42", primary_color_image: "/uploads/products/c.jpg" })),
  ]);
  assert.equal(stats.no_photo, 1);
  const lines = csv.trim().split("\n");
  assert.ok(lines[1].endsWith(`,"${NO_PHOTO_LABEL}"`));
  assert.ok(lines[2].endsWith(`,""`));
});

test("logo detection ignores a query string and does not match other branding files", () => {
  assert.equal(isLogoFallbackImage("https://m1store-egy.com/branding/m-one-logo-dark-fixed.png?v=2"), true);
  assert.equal(isLogoFallbackImage("https://m1store-egy.com/branding/other-logo.png"), false);
  assert.equal(isLogoFallbackImage("https://api.m1store-egy.com/uploads/products/shoe.jpg"), false);
});

/* ------------------------------------------------------------------ coverage check */

const feedOf = (...ids) => parseFeedSkuIds(tiktokCatalogCsv(ids.map((id) => ({ sku_id: id }))));
const card = (productId, variants) => ({ id: productId, variants });

test("every shown size present under the pixel's id: healthy, nothing missing", () => {
  const report = compareCatalogCoverage({
    feedIds: feedOf("A-41", "A-42"),
    products: [card(1, [{ id: 11, sku: "A-41", meta_content_id: "A-41", stock: 2, price: 900 }, { id: 12, sku: "A-42", meta_content_id: "A-42", stock: 0, price: 900 }])],
  });
  assert.deepEqual({ shown: report.sizes_shown, missing: report.missing, ratio: report.missing_ratio }, { shown: 2, missing: 0, ratio: 0 });
  assert.equal(coverageIsHealthy(report), true);
});

test("a missing size is classified: no price, not in the feed, or no id at all", () => {
  const report = compareCatalogCoverage({
    feedIds: feedOf("A-41"),
    products: [card(800, [
      { id: 1, sku: "Z-0", meta_content_id: "Z-0", stock: 3, price: 0, selling_price: 0 },
      { id: 2, sku: "NEW-1", meta_content_id: "NEW-1", stock: 1, price: 1200 },
      { id: 3, sku: "A-41", meta_content_id: "A-41", stock: 1, price: 900 },
    ])],
  });
  assert.deepEqual(report.by_reason, { no_price: 1, not_in_feed: 1 });
  assert.equal(report.missing_in_stock, 2);
  assert.deepEqual(report.examples.map((e) => [e.content_id, e.reason]), [["Z-0", "no_price"], ["NEW-1", "not_in_feed"]]);
  assert.equal(report.products_with_missing, 1);
  assert.equal(coverageIsHealthy(report), false, "2 of 3 missing");
});

test("the check uses the pixel's own id: meta_content_id wins over a shared SKU", () => {
  const report = compareCatalogCoverage({
    feedIds: feedOf("10-77"),
    products: [card(10, [{ id: 77, sku: "SHARED", meta_content_id: "10-77", stock: 1, price: 500 }])],
  });
  assert.equal(report.missing, 0);
});

test("a size shown on two cards counts once; examples are capped; nothing shown is never healthy", () => {
  const variant = { id: 5, sku: "X-1", meta_content_id: "X-1", stock: 1, price: 100 };
  const report = compareCatalogCoverage({ feedIds: feedOf(), products: [card(1, [variant]), card(1, [variant])], maxExamples: 0 });
  assert.equal(report.sizes_shown, 1);
  assert.deepEqual(report.examples, []);
  assert.equal(coverageIsHealthy(compareCatalogCoverage({ feedIds: feedOf("X-1"), products: [] })), false);
});

test("the threshold: 1 missing in 200 passes at 1%, 3 in 200 does not", () => {
  const sizes = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, sku: `S-${i}`, meta_content_id: `S-${i}`, stock: 1, price: 100 }));
  const ids = sizes.map((s) => s.meta_content_id);
  assert.equal(coverageIsHealthy(compareCatalogCoverage({ feedIds: feedOf(...ids.slice(1)), products: [card(1, sizes)] })), true);
  assert.equal(coverageIsHealthy(compareCatalogCoverage({ feedIds: feedOf(...ids.slice(3)), products: [card(1, sizes)] })), false);
});

test("feed ids are read back exactly from the CSV the feed writes, quotes included", () => {
  const ids = parseFeedSkuIds(tiktokCatalogCsv([{ sku_id: "NAJ-J1-41" }, { sku_id: 'ODD"ID' }]));
  assert.deepEqual([...ids], ["NAJ-J1-41", 'ODD"ID']);
});

/* ------------------------------------------------------------------ product_type */

test("product_type carries the shop's classification, labelled for a human, through the real Meta builder", () => {
  assert.equal(tiktokRow({ product_type: "sneakers" }).product_type, "Sneakers");
  assert.equal(tiktokRow({ product_type: "winter_collection" }).product_type, "Winter Collection");
  assert.equal(tiktokRow({ product_type: "bags" }).product_type, "Bags");
  assert.equal(tiktokRow({ product_type: "kids_shoes" }).product_type, "Kids Shoes", "an unknown key is title-cased, not dropped");
});

test("a product with no classification falls back to its Google category's last level", () => {
  const withCategory = tiktokCatalogRow({ ...buildMetaCatalogItem(row({})), product_type: "", google_product_category: "Apparel & Accessories > Shoes > Athletic Shoes" }).row;
  assert.equal(withCategory.product_type, "Athletic Shoes");
  assert.equal(tiktokRow({}).product_type, "", "nothing invented when neither exists");
});

test("product_type is a TikTok column and never reaches Meta's XML", async () => {
  assert.ok(TIKTOK_CATALOG_COLUMNS.includes("product_type"));
  const { metaCatalogItemXml } = await import("../server/services/metaCatalogFeedService.js");
  assert.doesNotMatch(metaCatalogItemXml(buildMetaCatalogItem(row({ product_type: "sneakers" }))), /product_type/);
});
