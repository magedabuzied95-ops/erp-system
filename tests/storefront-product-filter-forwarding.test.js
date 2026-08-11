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
  assert.match(stateSource, /size: selectedSizes\.length === 1 && !isCrocsListing \? selectedSizes\[0\] : ""/);
  assert.match(stateSource, /Crocs filters use customer-facing EU labels/);
  assert.match(stateSource, /inStock: truthyFlag\(inStock\) \? 1 : ""/);
});

test("changing any forwarded filter invalidates the product request", () => {
  const stateStart = listingSource.indexOf("const backendFilterState = useMemo(");
  const stateEnd = listingSource.indexOf("const productsApiParams", stateStart);
  const stateSource = listingSource.slice(stateStart, stateEnd);

  for (const dependency of ["brand", "category", "gender", "grade", "inStock", "isCrocsListing", "productType", "quality", "selectedSizes", "sort"]) {
    assert.match(stateSource, new RegExp(`\\b${dependency}\\b`));
  }
});
