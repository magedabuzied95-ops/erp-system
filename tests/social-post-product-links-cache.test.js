import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync("server/services/socialPostProductLinksV2Service.js", "utf8");

test("the schema DDL runs once, not on every lookup", () => {
  // The posts list calls the lookup once per post, and each call used to issue three
  // CREATE ... IF NOT EXISTS statements and take their locks.
  assert.match(SOURCE, /let schemaReadyPromise = null;/);
  assert.match(SOURCE, /const ensureSchema = async \(\) => \{\s*if \(!schemaReadyPromise\)/);
  // A failed bootstrap must not be cached, or the table would never be created.
  assert.match(SOURCE, /schemaReadyPromise = null;\s*throw error;/);
});

test("lookups are cached and share in-flight work", () => {
  assert.match(SOURCE, /const POST_PRODUCT_LINKS_CACHE_TTL_MS = /);
  assert.match(SOURCE, /if \(entry\?\.promise\) \{[\s\S]*?return entry\.promise;/);
  assert.match(SOURCE, /postProductLinksCache\.set\(key, \{ value, at: Date\.now\(\) \}\)/);
});

test("a failed lookup is not cached", () => {
  assert.match(SOURCE, /catch \(error\) \{\s*postProductLinksCache\.delete\(key\);\s*throw error;/);
});

test("writing a link invalidates the tenant's cached lookups", () => {
  // Without this the gear would keep its old colour after linking or unlinking a product.
  const save = SOURCE.match(/export const savePostProductLinksV2 = async \([\s\S]{0,400}/)?.[0] || "";
  const remove = SOURCE.match(/export const removePostProductLinksV2 = async \([\s\S]{0,400}/)?.[0] || "";
  assert.match(save, /invalidatePostProductLinksCache\(tenantId\)/);
  assert.match(remove, /invalidatePostProductLinksCache\(tenantId\)/);
});

test("invalidation is tenant-scoped, never a blind global clear when a tenant is known", () => {
  const fn = SOURCE.match(/export const invalidatePostProductLinksCache = [\s\S]*?\n\};/)?.[0] || "";
  assert.match(fn, /const prefix = `\$\{safeTenantId\}\|`/);
  assert.match(fn, /if \(key\.startsWith\(prefix\)\) postProductLinksCache\.delete\(key\)/);
  // Clearing everything is only correct when there is no tenant to scope to.
  assert.match(fn, /if \(!safeTenantId\) \{\s*postProductLinksCache\.clear\(\);/);
});
