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
});

test("storefront product listing avoids the 500-product no-cache bootstrap", () => {
  const source = readFileSync(new URL("../src/storefront/pages/StorefrontProductListingPage.jsx", import.meta.url), "utf8");
  assert.match(source, /limit:\s*80/);
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
