import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("storefront home hydrates from persistent cache and refreshes in the background", async () => {
  const source = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");

  assert.match(source, /catalog=mirror-v3/);
  assert.match(source, /STOREFRONT_HOME_PERSISTED_CACHE_KEY = "storefront\.home\.bootstrap\.v3\.mirror_original"/);
  assert.match(source, /memoryHome \|\| readPersistedStorefrontHome\(\)/);
  assert.match(source, /forceRefresh: Boolean\(initialHome\)/);
  assert.match(source, /persist: true/);
  assert.match(source, /if \(!initialHome\) setState/);
});

test("public home response is cached, served stale, and concurrent rebuilds are deduplicated", async () => {
  const source = await readFile(new URL("../server/routes/storefront.js", import.meta.url), "utf8");

  assert.match(source, /const publicStorefrontHomeCache = new Map\(\)/);
  assert.match(source, /stale-while-revalidate=300/);
  assert.match(source, /res\.vary\("X-Tenant-Id"\)/);

  // Dedup, cold: with nothing servable a second caller joins the running rebuild
  // rather than starting its own. The `!cached?.data` guard is what stops this from
  // ALSO blocking a caller that has a stale copy it could have been handed instantly.
  assert.match(source, /if \(cached\?\.promise && !cached\?\.data\) return cached\.promise/);

  // Stale window: past the TTL the cached value is still returned and the rebuild
  // runs behind the response, so no visitor pays the 2.6-3.3s rebuild.
  assert.match(source, /PUBLIC_STOREFRONT_HOME_CACHE_STALE_MS/);
  assert.match(source, /if \(cached\?\.data && age < PUBLIC_STOREFRONT_HOME_CACHE_STALE_MS\) \{/);

  // Dedup, stale: only one background rebuild is ever in flight.
  assert.match(source, /if \(!cached\.promise\) \{\s+rebuild\(\)/);

  // A failed rebuild must not demote a stale copy to a cold cache.
  assert.match(source, /if \(current\?\.data\) publicStorefrontHomeCache\.set\(key, \{ at: current\.at, data: current\.data \}\)/);
});
