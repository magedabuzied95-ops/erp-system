import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const listingSource = fs.readFileSync("src/storefront/pages/StorefrontProductListingPage.jsx", "utf8");

test("the product listing forwards every server-supported filter to the storefront API", () => {
  const stateStart = listingSource.indexOf("const backendFilterState = useMemo(");
  const stateEnd = listingSource.indexOf("const productsApiParams", stateStart);
  const stateSource = listingSource.slice(stateStart, stateEnd);

  assert.match(stateSource, /\bcategory,/);
  assert.match(stateSource, /\bbrand,/);
  assert.match(stateSource, /gender: gender \|\| ""/);
  assert.match(stateSource, /product_type: productType \|\| ""/);
  assert.match(stateSource, /grade: grade \|\| ""/);
  assert.match(stateSource, /quality: quality \|\| ""/);
  // Every selected size goes to the backend, not just the first one: filtering
  // the rest client-side removed cards from an already-paginated page.
  assert.match(stateSource, /size: isCrocsListing \? "" : selectedSizes/);
  assert.match(stateSource, /color: color \|\| ""/);
  assert.match(stateSource, /bag_type: bagType \|\| ""/);
  assert.match(stateSource, /min_price: minPrice \|\| ""/);
  assert.match(stateSource, /max_price: maxPrice \|\| ""/);
  assert.match(stateSource, /last_sizes: lastSizes \? 1 : ""/);
  assert.match(stateSource, /Crocs filters use customer-facing EU labels/);
  assert.match(stateSource, /inStock: truthyFlag\(inStock\) \? 1 : ""/);
});

test("the listing does not re-filter a paginated page by a facet the backend already applied", () => {
  const start = listingSource.indexOf("const catalogFiltersWithoutGender = useMemo(");
  const end = listingSource.indexOf("const hasActiveCatalogFilters", start);
  const source = listingSource.slice(start, end);

  for (const facet of ["color", "minPrice", "maxPrice"]) {
    assert.match(source, new RegExp(`${facet}: ""`));
  }
  assert.match(source, /lastSizes: false/);
  // Crocs is the one facet that must stay client-side (EU labels vs factory marking).
  assert.match(source, /sizes: isCrocsListing \? catalogFilters\.sizes : \[\]/);
});

test("changing any forwarded filter invalidates the product request", () => {
  const stateStart = listingSource.indexOf("const backendFilterState = useMemo(");
  const stateEnd = listingSource.indexOf("const productsApiParams", stateStart);
  const stateSource = listingSource.slice(stateStart, stateEnd);

  for (const dependency of ["brand", "category", "gender", "grade", "inStock", "isCrocsListing", "productType", "quality", "selectedSizes", "sort"]) {
    assert.match(stateSource, new RegExp(`\\b${dependency}\\b`));
  }
});
