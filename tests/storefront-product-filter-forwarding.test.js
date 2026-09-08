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
  // Crocs included: `backendSizes` is the EU label plus every factory marking
  // that names the same shoe, so the backend can cut the result set itself.
  assert.match(stateSource, /size: backendSizes/);
  assert.match(stateSource, /color: color \|\| ""/);
  assert.match(stateSource, /bag_type: bagType \|\| ""/);
  assert.match(stateSource, /min_price: minPrice \|\| ""/);
  assert.match(stateSource, /max_price: maxPrice \|\| ""/);
  assert.match(stateSource, /last_sizes: lastSizes \? 1 : ""/);
  assert.match(stateSource, /the request carries the EU label and every factory/);
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
  // Crocs was the last exception, and it cost the customer the result count and
  // the second page. No size is re-applied to an already-cut page any more.
  assert.match(source, /sizes: \[\]/);
});

test("changing any forwarded filter invalidates the product request", () => {
  const stateStart = listingSource.indexOf("const backendFilterState = useMemo(");
  const stateEnd = listingSource.indexOf("const productsApiParams", stateStart);
  const stateSource = listingSource.slice(stateStart, stateEnd);

  for (const dependency of ["backendSizes", "brand", "category", "gender", "grade", "inStock", "productType", "quality", "sort"]) {
    assert.match(stateSource, new RegExp(`\\b${dependency}\\b`));
  }
});
