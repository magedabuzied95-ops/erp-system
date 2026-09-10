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
