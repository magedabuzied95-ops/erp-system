import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { storefrontColorKey, storefrontColorLabel } from "../shared/storefrontColorKey.js";
import { buildStorefrontProductFacets } from "../server/controllers/storefrontController.js";

test("spellings of one colour share one key", () => {
  const same = (values, key) => values.forEach((value) => assert.equal(storefrontColorKey(value), key, value));
  same(["Grey", "gray", " GRAY "], "grey");
  same(["beige", "Bige", "baige", "biege"], "beige");
  same(["black & white", "White & Black", "black&white", "white /black", "whtite & black", "white&balck"], "black & white");
  same(["dark gray", "dark & grey", "d.gray"], "dark grey");
  same(["light gray", "light & grey", "l gray"], "light grey");
  same(["mauve", "mouve", "move"], "mauve");
});

test("different colours and non-Latin names never collide", () => {
  assert.notEqual(storefrontColorKey("grey"), storefrontColorKey("dark grey"));
  assert.notEqual(storefrontColorKey("sky blue"), storefrontColorKey("blue"));
  assert.equal(storefrontColorKey("أسود"), storefrontColorKey("اسود"), "Arabic keeps the normalization the filter always used");
  assert.notEqual(storefrontColorKey("أسود"), storefrontColorKey("أبيض"));
  assert.equal(storefrontColorKey("Gucci Custom (Black)"), "gucci custom (black)");
  assert.equal(storefrontColorLabel("dark grey & white"), "Dark Grey & White");
});

test("the colour facet counts every spelling under one chip", () => {
  const card = (color) => ({ display_color: color, color, variants: [{ size: "41", stock: 1, color }] });
  const facets = buildStorefrontProductFacets([card("Gray"), card("grey"), card("White & Black"), card("black&white")]);
  assert.deepEqual(facets.colors.map((entry) => [entry.value, entry.count]), [["black & white", 2], ["grey", 2]]);
});

test("the listing no longer reads the in-stock switch from the URL", () => {
  const listing = fs.readFileSync(new URL("../src/storefront/pages/StorefrontProductListingPage.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(listing, /params\.get\("inStock"\)/);
  assert.match(listing, /const color = storefrontColorKey\(params\.get\("color"\) \|\| ""\);/);
});
