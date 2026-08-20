import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { buildStorefrontProductFacets } from "../server/controllers/storefrontController.js";

const controllerSource = fs.readFileSync(
  new URL("../server/controllers/storefrontController.js", import.meta.url),
  "utf8"
);
const routesSource = fs.readFileSync(
  new URL("../server/routes/storefront.js", import.meta.url),
  "utf8"
);
const listingSource = fs.readFileSync(
  new URL("../src/storefront/pages/StorefrontProductListingPage.jsx", import.meta.url),
  "utf8"
);
const storefrontSource = fs.readFileSync(
  new URL("../src/storefront/Storefront.jsx", import.meta.url),
  "utf8"
);

const card = (overrides = {}) => ({
  display_color: "Black",
  color: "Black",
  sizes: ["41", "42"],
  brand: "Adidas",
  grade: "local",
  product_type: "sneakers",
  category: "",
  audiences: ["women"],
  final_price: 650,
  variants: [{ size: "41", stock: 3, color: "Black" }],
  ...overrides,
});

test("facets count the whole section, not the page the shopper happens to be on", () => {
  const facets = buildStorefrontProductFacets([
    card(),
    card({ display_color: "Black", color: "Black", final_price: 900 }),
    card({ display_color: "Pink", color: "Pink", brand: "MOMOLLY", product_type: "bags", sizes: ["18-inch"], final_price: 1700, variants: [{ size: "18-inch", stock: 1, color: "Pink" }] }),
  ]);

  assert.equal(facets.total, 3);
  assert.deepEqual(
    facets.colors.map((entry) => [entry.value, entry.count]),
    [["black", 2], ["pink", 1]]
  );
  assert.deepEqual(
    facets.brands.map((entry) => [entry.value, entry.count]),
    [["adidas", 2], ["momolly", 1]]
  );
  assert.deepEqual(
    facets.product_types.map((entry) => [entry.value, entry.count]),
    [["sneakers", 2], ["bags", 1]]
  );
  assert.deepEqual(facets.price, { min: 650, max: 1700 });
});

test("a card counts once per colour it shows, so the chip total tracks the cards", () => {
  const facets = buildStorefrontProductFacets([
    // Same normalized colour reached through display_color and the variant row -
    // one card must not be counted twice for the colour it displays.
    card({ display_color: "Sky Blue", color: "sky blue", variants: [{ size: "41", stock: 2, color: "SKY BLUE" }] }),
  ]);
  assert.deepEqual(facets.colors.map((entry) => [entry.value, entry.count]), [["sky blue", 1]]);
});

test("a size only becomes a chip while some colour still has it in stock", () => {
  const facets = buildStorefrontProductFacets([
    card({ sizes: [], variants: [{ size: "44", stock: 0 }, { size: "45", stock: 2 }] }),
  ]);
  assert.deepEqual(facets.sizes.map((entry) => entry.value), ["45"]);
});

test("audience counts stay on the three the switch offers", () => {
  const facets = buildStorefrontProductFacets([
    card({ audiences: ["men", "women", "kids"] }),
    card({ audiences: ["women"] }),
  ]);
  assert.deepEqual(
    facets.audiences.map((entry) => [entry.value, entry.count]),
    [["men", 1], ["women", 2], ["kids", 1]]
  );
});

test("the facet route is reachable before the :identifier catch-all swallows it", () => {
  const facetsAt = routesSource.indexOf('router.get("/products/facets"');
  const identifierAt = routesSource.indexOf('router.get("/products/:identifier"');
  assert.ok(facetsAt > -1, "the facets route is registered");
  assert.ok(facetsAt < identifierAt, "the facets route is registered before /products/:identifier");
});

test("the facet scope carries only what the route pins, never the shopper's own picks", () => {
  const scopeAt = controllerSource.indexOf("const storefrontFacetScopeQuery");
  const scopeBlock = controllerSource.slice(scopeAt, controllerSource.indexOf("};", scopeAt));
  for (const sidebarFacet of ["brand", "grade", "quality", "colors", "sizes", "bagType", "minPrice", "maxPrice", "lastSizes", "category"]) {
    assert.ok(
      !new RegExp(`\\b${sidebarFacet}:`).test(scopeBlock),
      `${sidebarFacet} must stay out of the facet scope - a group counted with its own selection applied returns only the value already chosen`
    );
  }
  assert.match(scopeBlock, /gender: normalized\.gender/);
  assert.match(scopeBlock, /productType: normalized\.productType/);
});

test("the sidebar prefers the API facets and still falls back to the page it already has", () => {
  // The frontend ships on a push to main while the API waits on the VPS deploy,
  // so the listing has to survive a 404 from the facets endpoint.
  assert.match(storefrontSource, /const useStorefrontProductFacets = \(scope = \{\}\) =>/);
  assert.match(storefrontSource, /setState\(\{ facets: null, loading: false, error:/);
  assert.match(listingSource, /facets \? facetOptionsFromEntries\(facets\.colors, color\) : buildFacetOptions\(/);
  assert.match(listingSource, /facets \? buildAvailableSizeOptionsFromFacets\(facets\.sizes, \{ crocs: isCrocsListing \}\) : buildAvailableSizeOptions\(/);
  assert.match(listingSource, /facets \? facetOptionsFromEntries\(facets\.brands, brand\) : buildFacetOptions\(/);
});

test("a classification with nothing behind it never becomes a chip", () => {
  // "Winter Collection" was a live taxonomy entry with no products, so the chip
  // sent the customer straight to an empty page.
  const typeOptionsAt = listingSource.indexOf("const typeOptions = useMemo");
  const typeOptionsBlock = listingSource.slice(typeOptionsAt, listingSource.indexOf("const colorOptions", typeOptionsAt));
  assert.match(typeOptionsBlock, /\.filter\(\(option\) => option\.count > 0 \|\| normalizeClassificationFacetKey\(option\.value\) === selectedKey\)/);
});
