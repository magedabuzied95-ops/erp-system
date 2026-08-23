import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("storefront home uses its aggregated payload instead of four duplicate product feeds", () => {
  const source = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const homeStart = source.indexOf("function PremiumHomePage");
  const homeEnd = source.indexOf("\nfunction ", homeStart + 1);
  const homeSource = source.slice(homeStart, homeEnd > homeStart ? homeEnd : undefined);

  assert.doesNotMatch(homeSource, /useProducts\(/);
  assert.match(homeSource, /storefrontHome\.collections/);
  assert.match(homeSource, /productAudienceValues\(product\)/);
  assert.doesNotMatch(homeSource, /productListingAudienceValues/);
});

test("storefront product listing avoids the 500-product no-cache bootstrap", () => {
  const source = readFileSync(new URL("../src/storefront/pages/StorefrontProductListingPage.jsx", import.meta.url), "utf8");
  assert.match(source, /SEO_PAGE_SIZE = 24/);
  assert.doesNotMatch(source, /limit:\s*500/);
  assert.doesNotMatch(source, /useProducts\(productsApiParams,\s*\{\s*ttlMs:\s*0\s*\}\)/);
});

test("POS renders its cached catalog while the fresh catalog revalidates", () => {
  const source = readFileSync(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
  const cacheRead = source.indexOf("await getPosCatalogSnapshot()");
  const networkRefresh = source.indexOf("await refreshCatalogProducts", cacheRead);

  assert.ok(cacheRead >= 0);
  assert.ok(networkRefresh > cacheRead);
  assert.match(source.slice(cacheRead, networkRefresh), /setLoading\(false\)/);
});

test("storefront list payload does not duplicate full image collections", () => {
  const source = readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  const slimStart = source.indexOf("const slimProductForList");
  const slimEnd = source.indexOf("\nconst productHomeImage", slimStart);
  const slimSource = source.slice(slimStart, slimEnd);

  assert.match(source, /const slimVariantForList/);
  assert.doesNotMatch(slimSource, /\badditional_images:/);
  assert.doesNotMatch(slimSource, /\bproduct_images:/);
  assert.doesNotMatch(slimSource, /\bimage_urls:/);
  // The list used to drop galleries entirely (gallery_images: []). The card hover
  // gallery needs a few, so the guard is now "bounded", not "empty": firstCardImages
  // stops at CARD_IMAGE_LIMIT, which is what keeps a full collection out of a
  // response that carries one entry per card.
  assert.match(slimSource, /gallery_images:\s*firstCardImages\(/);
  assert.match(source, /if \(picked\.length >= CARD_IMAGE_LIMIT\) return picked;/);
});

test("storefront product responses use a shared cache with a stale window", () => {
  const source = readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  const listStart = source.indexOf("export const listProducts");
  const listEnd = source.indexOf("\nexport const visualSearchProducts", listStart);
  const listSource = source.slice(listStart, listEnd);

  // Server-side cache: SWR, so an expired entry is served while it rebuilds rather
  // than making the next visitor wait out the 4-6s cold build.
  assert.match(listSource, /getOrSetCacheSWR\(storefrontCacheKey\(tenantId,\s*"products"/);
  assert.match(listSource, /storefrontCacheKey\(tenantId,\s*"products"[\s\S]*?storefrontCacheWindows\(\),\s*async/);

  // Browser/CDN cache stays deliberately short: the server entry is dropped the
  // moment a product is saved, but a downstream copy is not, so this bounds how
  // long hiding a product can appear to do nothing.
  assert.match(listSource, /public,\s*max-age=15,\s*stale-while-revalidate=30/);

  // The stale window must be strictly longer than the fresh one, or SWR degenerates
  // back into a plain expiry cache.
  assert.match(source, /const STOREFRONT_CACHE_FRESH_SECONDS = Math\.max\(5, Number\(process\.env\.STOREFRONT_CACHE_FRESH_SECONDS \|\| 120\)\)/);
  assert.match(source, /Number\(process\.env\.STOREFRONT_CACHE_STALE_SECONDS \|\| 1800\)/);
});
