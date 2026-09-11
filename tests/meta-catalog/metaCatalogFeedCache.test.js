import test from "node:test";
import assert from "node:assert/strict";

import {
  META_FEED_TTL_MS,
  clearMetaCatalogFeedCache,
} from "../../server/services/metaCatalogFeedService.js";

test("the cache TTL matches the Cache-Control the route sends", () => {
  assert.equal(META_FEED_TTL_MS, 15 * 60 * 1000);
});

test("clearing the cache is exported so a build can be forced", () => {
  assert.equal(typeof clearMetaCatalogFeedCache, "function");
  assert.doesNotThrow(() => clearMetaCatalogFeedCache());
});

test("a failed rebuild serves the last good copy instead of a 500", async (t) => {
  const feedModule = await import("../../server/services/metaCatalogFeedService.js");
  const dbModule = await import("../../server/database/db.js");
  const db = dbModule.default;
  const realQuery = db.query;
  let calls = 0;

  t.after(() => {
    db.query = realQuery;
    clearMetaCatalogFeedCache();
  });

  clearMetaCatalogFeedCache();
  db.query = async () => {
    calls += 1;
    if (calls === 1) {
      return { rows: [{
        product_id: 1, variant_id: 2, variant_sku: "SKU-2", sku_count: 1,
        product_name: "Cached product", product_type: "Sneakers", color: "Black", size: "42",
        variant_stock: 3, product_selling_price: 500,
      }] };
    }
    throw new Error("Query read timeout");
  };

  const first = await feedModule.buildMetaCatalogFeed({ warmImages: false, force: true });
  assert.match(first.xml, /Cached product/);

  const second = await feedModule.buildMetaCatalogFeed({ warmImages: false, force: true });
  assert.equal(second.xml, first.xml);
  // It really tried again — the settings load runs its own queries, so this is "more than one
  // build's worth of calls", not an exact count.
  assert.ok(calls > 2, `expected a second attempt, saw ${calls} queries`);
});

test("a size with no price anywhere is dropped, never advertised at its strikethrough", async (t) => {
  // Product 221: no price on the size or the product, only a compare price of 950 — the feed
  // printed 950 as the price while the shop sells that colour at 700.
  const feedModule = await import("../../server/services/metaCatalogFeedService.js");
  const db = (await import("../../server/database/db.js")).default;
  const realQuery = db.query;
  t.after(() => {
    db.query = realQuery;
    clearMetaCatalogFeedCache();
  });
  const base = { product_type: "Sneakers", color: "Camel", variant_stock: 2, sku_count: 1 };
  db.query = async (sql) => {
    if (!String(sql).includes("FROM products p")) throw new Error("settings not needed here");
    return { rows: [
      { ...base, product_id: 1, variant_id: 10, variant_sku: "PRICED", product_name: "Priced", size: "40", product_selling_price: 700 },
      { ...base, product_id: 2, variant_id: 20, variant_sku: "PRICELESS", product_name: "Priceless", size: "41",
        use_custom_compare_price: true, custom_compare_price: 950 },
    ] };
  };
  const feed = await feedModule.buildMetaCatalogFeed({ warmImages: false, force: true });
  assert.deepEqual(feed.items.map((item) => item.id), ["PRICED"]);
  assert.equal(feed.xml.includes("950.00 EGP"), false);
});

test("a SKU counts as taken twice only among the rows the feed publishes", async (t) => {
  // Product 391 size 41 carried ADS-LOC-8-WHT-41 alone among live rows, but an archived row
  // with the same SKU made the feed send 391-6818 while the pixel reported the SKU — Meta
  // flagged the view as matching no catalogue item.
  const feedModule = await import("../../server/services/metaCatalogFeedService.js");
  const db = (await import("../../server/database/db.js")).default;
  const realQuery = db.query;
  t.after(() => {
    db.query = realQuery;
    clearMetaCatalogFeedCache();
  });
  let feedSql = "";
  db.query = async (sql) => {
    if (!String(sql).includes("FROM products p")) throw new Error("settings not needed here");
    feedSql = String(sql);
    return { rows: [] };
  };
  await feedModule.buildMetaCatalogFeed({ warmImages: false, force: true });
  const skuCounts = feedSql.match(/variant_sku_counts AS \(([\s\S]*?)GROUP BY/)?.[1] || "";
  assert.ok(skuCounts, "the feed query should still count SKUs");
  for (const filter of [
    /v\.deleted_at IS NULL/,
    /v\.is_active IS DISTINCT FROM FALSE/,
    /vp\.is_active IS DISTINCT FROM FALSE/,
    /vp\.is_storefront_visible IS DISTINCT FROM FALSE/,
    /LOWER\(TRIM\(vp\.status\)\)/,
  ]) {
    assert.match(skuCounts, filter);
  }
});
