import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { countUniqueVariantColors, getVariantColorKey } from "../src/modules/pos/lib/posCatalogMerge.js";
import { buildPosCatalogSnapshot } from "../src/modules/pos/lib/posCatalogCache.js";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// Real shape of Crocs product 733: one product carrying several DIFFERENT colour
// groups that share a colour name. Grouping by the name collapsed 24 sellable
// colours into 15 tiles, each showing one image and the summed stock.
const crocsVariants = [
  { variant_id: 1, color: "Black", color_group_key: "grp-black-a", size: "M8", stock: 1 },
  { variant_id: 2, color: "Black", color_group_key: "grp-black-a", size: "M9", stock: 2 },
  { variant_id: 3, color: "Black", color_group_key: "grp-black-b", size: "M8", stock: 4 },
  { variant_id: 4, color: "Black", color_group_key: "grp-black-c", size: "M10", stock: 6 },
  { variant_id: 5, color: "Off White", color_group_key: "grp-offwhite", size: "M8", stock: 3 },
];

test("colour identity is the colour group, not the colour name", () => {
  assert.equal(getVariantColorKey(crocsVariants[0]), "g:grp-black-a");
  assert.notEqual(getVariantColorKey(crocsVariants[0]), getVariantColorKey(crocsVariants[2]));
  assert.equal(getVariantColorKey(crocsVariants[0]), getVariantColorKey(crocsVariants[1]));
});

test("variants without a group key still group by colour name", () => {
  assert.equal(getVariantColorKey({ color: " Black " }), "c:black");
  assert.equal(getVariantColorKey({ color: "black" }), "c:black");
});

test("same-named colour groups are counted separately", () => {
  assert.equal(countUniqueVariantColors({ variants: crocsVariants }), 4);
  assert.equal(
    new Set(crocsVariants.map((variant) => String(variant.color))).size,
    2,
    "the name-based count is the regression this test guards against"
  );
});

test("every layer between SQL and the picker carries color_group_key", () => {
  // The POS lean projection is an allowlist: a field missing here never reaches the
  // client, which is what silently disabled group-based colours in the first place.
  assert.match(
    readSource("../server/controllers/productsController.js"),
    /POS_VARIANT_KEEP_FIELDS[\s\S]*?"color_group_key"/
  );
  assert.match(
    readSource("../src/modules/pos/services/posProductsApi.js"),
    /color_group_key: normalizeText\(row\.color_group_key/
  );
  // The picker groups and selects by the key, never by the colour name.
  const posSource = readSource("../src/modules/pos/pages/POSPro.jsx");
  assert.match(posSource, /new Set\(variants\.map\(\(variant\) => getVariantColorKey\(variant\)\)\)/);
  assert.doesNotMatch(posSource, /String\(variant\.color \|\| ""\) === String\(selectedColor/);
});

test("the offline catalog snapshot keeps color_group_key too", () => {
  const snapshot = buildPosCatalogSnapshot([
    { id: 733, name: "Crocs", variants: crocsVariants },
  ]);
  assert.equal(countUniqueVariantColors(snapshot.products[0]), 4);
});
