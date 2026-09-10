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
