import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildMetaCatalogItem } from "../server/services/metaCatalogFeedService.js";
import { metaContentIdFor } from "../server/services/metaCatalogContentIdService.js";
import express from "express";
import {
  TIKTOK_CATALOG_COLUMNS,
  buildTikTokCatalogFeed,
  buildTikTokCatalogFromItems,
  clearTikTokCatalogFeedCache,
  createTikTokCatalogFeedHandler,
  tiktokCatalogMinItems,
  tiktokCatalogRow,
} from "../server/modules/tiktok/tiktokCatalogFeed.js";
import { tiktokContentId } from "../shared/tiktokPixelEvent.js";

/* Rows shaped like the Meta feed's query (the real path: DB row -> Meta item -> TikTok row). */
const row = (overrides = {}) => ({
  product_id: 10,
  variant_id: 20,
  variant_sku: "NKV2K-WP-39",
  sku_count: 1,
  product_name: "Nike V2K",
  description: "<p>Light runner.</p>",
  slug: "nike-v2k",
  product_type: "Sneakers",
  brand_name: "Nike",
  variant_stock: 3,
  product_selling_price: 500,
  color: "White & Pink",
  size: "39",
  product_image_url: "/uploads/products/v2k-white.jpg",
  color_gallery: ["/uploads/products/v2k-white-2.jpg", "/uploads/products/v2k-white-3.png"],
  variant_audience: "women",
  ...overrides,
});
const tiktok = (overrides = {}) => tiktokCatalogRow(buildMetaCatalogItem(row(overrides))).row;
const feedOf = (rows) => buildTikTokCatalogFromItems(rows.map((r) => buildMetaCatalogItem(r)));

/* A tiny RFC 4180 reader, independent of the writer under test. */
const readCsv = (csv) => {
  const records = [];
  let field = "";
  let record = [];
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n") { record.push(field); records.push(record); record = []; field = ""; }
    else field += c;
  }
  const [header, ...rows] = records;
  return rows.map((values) => Object.fromEntries(header.map((name, i) => [name, values[i]])));
};

beforeEach(() => clearTikTokCatalogFeedCache());

/* ------------------------------------------------------------------ 1-3: sizes and colours */

test("1. a model with one size: one row, all nine required fields, TikTok's value formats", () => {
  const { csv, stats } = feedOf([row()]);
  const [only] = readCsv(csv);
  assert.equal(stats.items, 1);
  assert.deepEqual(Object.keys(only), [...TIKTOK_CATALOG_COLUMNS]);
  assert.equal(only.sku_id, "NKV2K-WP-39");
  assert.equal(only.title, "Nike V2K - White & Pink", "the size never goes in the title");
  assert.equal(only.description, "Light runner.", "HTML stripped");
  assert.equal(only.availability, "in stock");
  assert.equal(only.condition, "new");
  assert.equal(only.price, "500.00 EGP");
  assert.equal(only.brand, "Nike");
  assert.equal(only.size, "39");
  assert.equal(only.gender, "female");
  assert.equal(only.age_group, "adult");
});

test("2. a model with several sizes: one row per size, all in the colourway's group", () => {
  const { csv } = feedOf(["39", "40", "41"].map((size, i) => row({ size, variant_id: 20 + i, variant_sku: `NKV2K-WP-${size}` })));
  const rows = readCsv(csv);
  assert.deepEqual(rows.map((r) => r.sku_id), ["NKV2K-WP-39", "NKV2K-WP-40", "NKV2K-WP-41"]);
  assert.equal(new Set(rows.map((r) => r.item_group_id)).size, 1);
  assert.equal(rows[0].item_group_id, "10-white-pink");
  assert.equal(new Set(rows.map((r) => r.title)).size, 1, "no size-per-card duplicates of the title");
});

test("3. a model in two colours: separate groups, each with its own photos and landing colour", () => {
  const rows = readCsv(feedOf([
    row(),
    row({ variant_id: 30, variant_sku: "NKV2K-BK-39", color: "Black", product_image_url: "/uploads/products/v2k-black.jpg", color_gallery: [] }),
  ]).csv);
  assert.deepEqual(rows.map((r) => r.item_group_id), ["10-white-pink", "10-black"]);
  assert.match(rows[1].image_link, /v2k-black\.jpg$/);
  assert.match(rows[0].link, /\/product\/nike-v2k\?color=White%20%26%20Pink&variant=20$/);
  assert.match(rows[1].link, /\/product\/nike-v2k\?color=Black&variant=30$/);
  assert.equal(rows[0].additional_image_link.split(",").length, 2);
});

/* ------------------------------------------------------------------ 4-5: stock and price */

test("4. a size in stock and a sold-out size: both listed, the sold-out one marked out of stock", () => {
  const rows = readCsv(feedOf([row(), row({ variant_id: 21, variant_sku: "NKV2K-WP-40", size: "40", variant_stock: 0 })]).csv);
  assert.deepEqual(rows.map((r) => [r.size, r.availability]), [["39", "in stock"], ["40", "out of stock"]]);
});

test("5. a discounted product: price is the strikethrough, sale_price what the shop charges", () => {
  const offer = tiktok({ product_selling_price: undefined, product_purchase_selling_price: 650, use_custom_compare_price: true, custom_compare_price: 700, product_sale_price: 550, product_is_offer_story: "true" });
  assert.equal(offer.price, "700.00 EGP");
  assert.equal(offer.sale_price, "550.00 EGP");
  const plain = tiktok();
  assert.equal(plain.sale_price, "", "no sale_price when nothing is discounted");
});

/* ------------------------------------------------------------------ 6: hidden, unpublished, wholesale */

test("6. hidden, unpublished and deleted rows never reach TikTok: the feed reads only the Meta feed's published rows", () => {
  const meta = fs.readFileSync(new URL("../server/services/metaCatalogFeedService.js", import.meta.url), "utf8");
  for (const filter of [
    "p.is_active IS DISTINCT FROM FALSE",
    "COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') = 'active'",
    "p.is_storefront_visible IS DISTINCT FROM FALSE",
    "pv.is_active IS DISTINCT FROM FALSE",
    "COALESCE(pv.is_storefront_visible, TRUE) = TRUE",
    "pv.deleted_at IS NULL",
  ]) assert.ok(meta.includes(filter), filter);
  const feed = fs.readFileSync(new URL("../server/modules/tiktok/tiktokCatalogFeed.js", import.meta.url), "utf8");
  assert.ok(!/db\.query|from "\.\.\/\.\.\/database/.test(feed), "no query of its own: it cannot widen what Meta publishes");
  // A size with no price anywhere is dropped by the Meta build (active_price > 0) before TikTok sees it.
  assert.ok(meta.includes(".filter((item) => item.active_price > 0)"));
});

/* ------------------------------------------------------------------ 7-8: changes reach TikTok */

const metaFeedOf = (rows, generatedAt) => async () => ({ generatedAt, items: rows.map((r) => buildMetaCatalogItem(r)) });

test("7. a price change reaches the TikTok feed with the next Meta build, and only then", async () => {
  const first = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf([row()], 1), minItems: 1 });
  assert.equal(readCsv(first.csv)[0].price, "500.00 EGP");
  const sameBuild = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf([row({ product_selling_price: 450 })], 1), minItems: 1 });
  assert.equal(sameBuild, first, "same Meta build -> the cached CSV, no rework");
  const repriced = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf([row({ product_selling_price: 450 })], 2), minItems: 1 });
  assert.equal(readCsv(repriced.csv)[0].price, "450.00 EGP");
});

test("8. a new product appears with the next Meta build", async () => {
  await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf([row()], 1), minItems: 1 });
  const next = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf([row(), row({ product_id: 11, variant_id: 40, variant_sku: "NEW-40", product_name: "Adidas Samba", slug: "adidas-samba", brand_name: "Adidas" })], 2), minItems: 1 });
  assert.deepEqual(readCsv(next.csv).map((r) => r.sku_id), ["NKV2K-WP-39", "NEW-40"]);
});

/* ------------------------------------------------------------------ 9: ids match the pixel */

test("9. sku_id is exactly the content_id the TikTok Pixel and Events API send", () => {
  // The storefront stamps meta_content_id on each size from the set of SKUs taken twice.
  const duplicateSkus = new Set(["shared-sku"]);
  const unique = row();
  const shared = row({ variant_id: 77, variant_sku: "SHARED-SKU", sku_count: 2 });
  for (const r of [unique, shared]) {
    const variant = { id: r.variant_id, sku: r.variant_sku, meta_content_id: metaContentIdFor({ productId: r.product_id, variantId: r.variant_id, sku: r.variant_sku }, duplicateSkus) };
    const pixelContentId = tiktokContentId({ id: r.product_id }, variant);
    assert.equal(tiktok(r).sku_id, pixelContentId);
  }
  assert.equal(tiktok(unique).sku_id, "NKV2K-WP-39");
  assert.equal(tiktok(shared).sku_id, "10-77", "a SKU two live sizes share falls back to product-variant on both sides");
});

/* ------------------------------------------------------------------ 10: links, images, file */

test("10. links and images are https; only JPG/PNG reach TikTok; the CSV survives commas, quotes and Arabic", () => {
  const webpOnly = buildTikTokCatalogFromItems([buildMetaCatalogItem(row({ product_image_url: "/uploads/products/x.webp", color_gallery: [] }))]);
  assert.equal(webpOnly.stats.items, 0);
  assert.deepEqual(webpOnly.stats.skipped, { image_not_jpg_png: 1 });

  const mixed = tiktok({ color_gallery: ["/uploads/a.webp", "/uploads/b.jpg", "/uploads/c.gif"] });
  assert.ok(mixed.additional_image_link.split(",").every((url) => /\.(jpe?g|png)$/.test(url)));

  const tricky = readCsv(feedOf([row({ product_name: 'Crocs "Classic", Clog', description: "خفيف ومريح,\nللمشي 🔥 يوميًا", color: "أسود" })]).csv)[0];
  assert.equal(tricky.title, 'Crocs "Classic", Clog - أسود');
  assert.equal(tricky.description, "خفيف ومريح, للمشي يوميًا", "newline and emoji removed, comma kept");
  assert.match(tricky.link, /^https:\/\/m1store-egy\.com\/product\//);
  assert.match(tricky.image_link, /^https:\/\/api\.m1store-egy\.com\/uploads\//);
});

/* ------------------------------------------------------------------ safety */

test("a sku_id is listed once, and a row missing a required field is counted, not shipped", () => {
  const { stats } = buildTikTokCatalogFromItems([
    buildMetaCatalogItem(row()),
    buildMetaCatalogItem(row()),
    { ...buildMetaCatalogItem(row({ variant_id: 50, variant_sku: "NO-BRAND" })), brand: "" },
  ]);
  assert.equal(stats.items, 1);
  assert.deepEqual(stats.skipped, { duplicate_sku_id: 1, missing_brand: 1 });
});

test("google_product_category is cut to the three levels TikTok reads", () => {
  const item = { ...buildMetaCatalogItem(row()), google_product_category: "Apparel & Accessories > Shoes > Sneakers > Running" };
  assert.equal(tiktokCatalogRow(item).row.google_product_category, "Apparel & Accessories > Shoes > Sneakers");
});

test("a failed rebuild serves the last good copy; with none yet it fails loudly", async () => {
  const good = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf([row()], 1), minItems: 1 });
  const broken = async () => ({ generatedAt: 2, items: { map() { throw new Error("boom"); } } });
  const served = await buildTikTokCatalogFeed({ loadMetaFeed: broken, minItems: 1 });
  assert.equal(served, good);
  clearTikTokCatalogFeedCache();
  await assert.rejects(buildTikTokCatalogFeed({ loadMetaFeed: broken, minItems: 1 }));
});

test("the feed is served at /feeds/tiktok.csv on the API and on the shop's own domain", () => {
  const server = fs.readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
  assert.ok(server.includes(`app.use("/feeds", tiktokCatalogFeedRoutes);`));
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const rewrite = vercel.rewrites.find((r) => r.source === "/feeds/tiktok.csv");
  assert.equal(rewrite?.destination, "https://api.m1store-egy.com/feeds/tiktok.csv");
  const catchAll = vercel.rewrites.findIndex((r) => r.source === "/(.*)");
  if (catchAll >= 0) assert.ok(vercel.rewrites.indexOf(rewrite) < catchAll, "before the SPA catch-all");
});

/* ------------------------------------------------------------------ "Replace your feed" safety */

const manyRows = (count, start = 1) =>
  Array.from({ length: count }, (_, i) => row({ product_id: 1000 + start + i, variant_id: 5000 + start + i, variant_sku: `SKU-${start + i}`, slug: `model-${start + i}` }));

test("Replace safety: an empty or tiny build is never published", async () => {
  await assert.rejects(buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf([], 1) }), /too small/);
  await assert.rejects(buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf(manyRows(99), 2) }), /too small/, "below the default floor of 100");
  const ok = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf(manyRows(100), 3) });
  assert.equal(ok.stats.items, 100);
  assert.equal(tiktokCatalogMinItems({ TIKTOK_CATALOG_MIN_ITEMS: "5000" }), 5000);
  assert.equal(tiktokCatalogMinItems({}), 100);
});

test("Replace safety: a build that loses over half the catalogue keeps serving the last good file", async () => {
  const good = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf(manyRows(300), 1), minItems: 1 });
  const afterDrop = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf(manyRows(140), 2), minItems: 1 });
  assert.equal(afterDrop, good, "140 of 300 -> the 300-row file stays");
  assert.equal(readCsv(afterDrop.csv).length, 300);
  const normalChange = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf(manyRows(200), 3), minItems: 1 });
  assert.equal(normalChange.stats.items, 200, "a third fewer (archiving, a sold-out range) is a normal change");
});

test("Replace safety: when the Meta build itself fails, the last good file is served", async () => {
  const good = await buildTikTokCatalogFeed({ loadMetaFeed: metaFeedOf(manyRows(150), 1), minItems: 1 });
  const served = await buildTikTokCatalogFeed({ loadMetaFeed: async () => { throw new Error("statement timeout"); }, minItems: 1 });
  assert.equal(served, good);
});

const serve = async (handler) => {
  const app = express();
  app.get("/feeds/tiktok.csv", handler);
  const server = app.listen(0);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/feeds/tiktok.csv`);
  const body = await response.text();
  server.close();
  return { response, body };
};

test("over HTTP: a complete CSV with its row count, or a 503 with no CSV at all — never a partial 200", async () => {
  const feed = buildTikTokCatalogFromItems(manyRows(120).map((r) => buildMetaCatalogItem(r)));
  const ok = await serve(createTikTokCatalogFeedHandler({ build: async () => ({ ...feed, generatedAt: Date.now() }) }));
  assert.equal(ok.response.status, 200);
  assert.match(ok.response.headers.get("content-type"), /^text\/csv; charset=utf-8/);
  assert.equal(ok.response.headers.get("x-feed-items"), "120");
  assert.equal(Number(ok.response.headers.get("content-length")), Buffer.byteLength(ok.body), "the whole file, declared up front");
  assert.equal(readCsv(ok.body).length, 120);
  assert.ok(ok.body.endsWith("\n"));

  const failed = await serve(createTikTokCatalogFeedHandler({ build: async () => { throw new Error("catalog too small to publish: 0 items"); } }));
  assert.equal(failed.response.status, 503);
  assert.equal(failed.response.headers.get("retry-after"), "900");
  assert.equal(failed.response.headers.get("cache-control"), "no-store");
  assert.ok(!failed.body.includes("sku_id"), "no CSV header a crawler could read as an empty catalogue");
});
