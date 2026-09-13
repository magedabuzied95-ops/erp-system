import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { buildStorefrontProductFacets, storefrontProductsSectionQuery } from "../server/controllers/storefrontController.js";

const controllerSource = fs.readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
const listingSource = fs.readFileSync(new URL("../src/storefront/pages/StorefrontProductListingPage.jsx", import.meta.url), "utf8");
const storefrontSource = fs.readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");

const normalized = (overrides = {}) => ({
  q: "",
  category: "",
  brand: "",
  gender: "men",
  productType: "sneakers",
  grade: "",
  quality: "",
  sizes: ["42", "41"],
  size: "42,41",
  colors: ["Black"],
  bagType: [],
  excludeBagType: [],
  minPrice: 0,
  maxPrice: 0,
  sort: "newest",
  scope: "product",
  groupingMode: "color_cards",
  limit: 24,
  offset: 48,
  ...overrides,
});

test("one selection is one section, whatever order it was clicked in and whichever page is asked for", () => {
  const first = storefrontProductsSectionQuery(normalized());
  const second = storefrontProductsSectionQuery(normalized({ sizes: ["41", "42"], colors: ["black"], offset: 0, limit: 12 }));
  assert.deepEqual(first, second);
  assert.equal("offset" in first || "limit" in first, false, "the page cut is not part of the section");
});

test("tracking and cache-busting parameters never reach the listing cache key", () => {
  const listStart = controllerSource.indexOf("export const listProducts = async");
  const listBlock = controllerSource.slice(listStart, controllerSource.indexOf("\n};", listStart));
  assert.doesNotMatch(listBlock, /storefrontCacheKey\(tenantId, "products", req\.query/);
  assert.match(listBlock, /storefrontCacheKey\(tenantId, "products", \{ section: sectionKey, offset, limit \}\)/);
});

test("every sort name the listing sends resolves to a real order instead of a per-page shuffle", () => {
  for (const name of ["best_selling", "most_viewed"]) {
    assert.match(controllerSource, new RegExp(`\\["${name}", "best_sellers"\\]`));
  }
  // An unsorted section still shuffles, but with one seed for all of its pages.
  assert.doesNotMatch(controllerSource, /const storefrontRandomSeed = /, "the per-request random seed is gone");
  assert.match(controllerSource, /deriveStorefrontSectionSeed\(sectionQuery\)/);
});

test("an explicit price or discount order is not overridden by offers-last", () => {
  assert.match(controllerSource, /STOREFRONT_EXPLICIT_ORDER_SORTS = new Set\(\["price_asc", "price_desc", "discount"\]\)/);
  assert.match(controllerSource, /keepOfferCardsAfterRegularCards\(sortedExpandedProducts, effectiveOfferStoryOnly \|\| sizes\.length > 0 \|\| STOREFRONT_EXPLICIT_ORDER_SORTS\.has\(sort\)\)/);
});

test("any storefront invalidation also drops the in-process sections", () => {
  assert.match(controllerSource, /onCacheInvalidatePattern\(\(pattern\) => \{\s*if \(pattern\.startsWith\("storefront"\)\) clearStorefrontSectionCache\(\);/);
});

test("a colour card counts for an audience only if the listing for that audience would keep it", () => {
  const facets = buildStorefrontProductFacets(
    [
      { parent_product_id: 7, id: 7, audiences: ["men", "women"], brand: "Nike", display_color: "Pink", variants: [{ size: "38", stock: 2, audiences: ["women"], color: "Pink" }] },
      { parent_product_id: 7, id: 7, audiences: ["men", "women"], brand: "Nike", display_color: "Black", variants: [{ size: "42", stock: 2, audiences: ["men"], color: "Black" }] },
      { parent_product_id: 7, id: 7, audiences: ["men", "women"], brand: "Nike", display_color: "White", variants: [{ size: "40", stock: 2, audiences: [], color: "White" }] },
    ],
    { productVariantAudiences: new Map([["7", new Set(["men", "women"])]]) }
  );
  assert.deepEqual(facets.audiences.map((entry) => [entry.value, entry.count]), [["men", 2], ["women", 2], ["kids", 0]]);
});

test("a product named after a known brand counts under that brand, as the brand filter matches it", () => {
  const facets = buildStorefrontProductFacets([
    { name: "Adidas Samba - Grey", brand: "Unbranded", display_color: "Grey", variants: [{ size: "41", stock: 1 }] },
    { name: "Adidas Gazelle - Blue", brand: "Adidas", display_color: "Blue", variants: [{ size: "41", stock: 1 }] },
  ]);
  assert.deepEqual(
    facets.brands.map((entry) => [entry.value, entry.count]).sort(),
    [["adidas", 2], ["unbranded", 1]]
  );
});

test("the next page is prefetched only for the filters that actually loaded", () => {
  assert.match(listingSource, /if \(loading \|\| !productsLoadedUrl \|\| productsLoadedUrl !== productsRequestUrl\) return;/);
  assert.doesNotMatch(listingSource, /\{ \.\.\.backendFilterState, offset: page \* pageSize \}/);
  assert.match(storefrontSource, /return \{ \.\.\.state, requestUrl \};/);
});

test("the price slider starts at the range edges and writes the URL once per drag", () => {
  const start = listingSource.indexOf("function CatalogPriceFilter(");
  const block = listingSource.slice(start, listingSource.indexOf("\nfunction ", start + 10));
  assert.match(block, /const urlMin = normalizeFilterText\(minPrice\) && Number\.isFinite\(Number\(minPrice\)\) \? Number\(minPrice\) : resolvedMinBound;/);
  assert.match(block, /onPointerUp: commitDraft/);
  assert.doesNotMatch(block, /onChange\(String\(nextMin\)/, "dragging must not write the URL on every step");
  assert.match(listingSource, /\}, \{ replace: true \}\);\s*\};/);
});
