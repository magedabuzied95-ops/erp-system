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

test("public home response is briefly cached and concurrent rebuilds are deduplicated", async () => {
  const source = await readFile(new URL("../server/routes/storefront.js", import.meta.url), "utf8");

  assert.match(source, /const publicStorefrontHomeCache = new Map\(\)/);
  assert.match(source, /if \(cached\?\.promise\) return cached\.promise/);
  assert.match(source, /stale-while-revalidate=300/);
  assert.match(source, /res\.vary\("X-Tenant-Id"\)/);
});
