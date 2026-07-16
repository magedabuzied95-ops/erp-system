import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const listingSource = fs.readFileSync("src/storefront/pages/StorefrontProductListingPage.jsx", "utf8");
const storefrontSource = fs.readFileSync("src/storefront/Storefront.jsx", "utf8");

test("storefront size filters only match variants that are actually in stock", () => {
  assert.match(listingSource, /productHasAvailableSize\(product, selectedSize\)/);
  assert.doesNotMatch(listingSource, /const sizeValues = \(Array\.isArray\(product\.variants\)/);
  assert.doesNotMatch(listingSource, /const filterCatalogProducts/);
  assert.match(listingSource, /applyCatalogFilters\(catalogProducts, catalogFiltersWithoutGender\)/);
  assert.match(
    storefrontSource,
    /const productHasAvailableSize[\s\S]*?variantHasStock\(variant\)/
  );
});

test("a selected size contributes once to the active filter count", () => {
  const activeCountStart = listingSource.indexOf("const activeFilterCount = [");
  const activeCountEnd = listingSource.indexOf("] .filter(Boolean)", activeCountStart);
  const fallbackEnd = listingSource.indexOf("].filter(Boolean)", activeCountStart);
  const activeCountSource = listingSource.slice(activeCountStart, activeCountEnd > 0 ? activeCountEnd : fallbackEnd);

  assert.match(activeCountSource, /selectedSizes\.length/);
  assert.doesNotMatch(activeCountSource, /^\s*size,\s*$/m);
});
