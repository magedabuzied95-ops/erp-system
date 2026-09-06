import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  mergeColorNameSuggestions,
} from "../src/modules/products/lib/colorNameSuggestions.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("the catalogue's own colour names lead the suggestion list, standards fill the rest", () => {
  const merged = mergeColorNameSuggestions(["White & Burgandy", "أسود وأبيض", "black"]);

  assert.deepEqual(merged.slice(0, 3), ["White & Burgandy", "أسود وأبيض", "black"]);
  // A compound name is exactly what the hard-coded list could never offer.
  assert.ok(merged.includes("White & Burgandy"));
  assert.ok(merged.includes("أسود وأبيض"));
  // The standard singles still follow, and "black" is not repeated as "Black".
  assert.ok(merged.includes("White"));
  assert.equal(merged.filter((name) => name.toLowerCase() === "black").length, 1);
});

test("blank and duplicate colour names are dropped before they reach the dropdown", () => {
  const merged = mergeColorNameSuggestions(["  Navy  ", "", null, "navy", "Sky   Blue"]);

  assert.equal(merged.filter((name) => name.toLowerCase() === "navy").length, 1);
  assert.ok(merged.includes("Navy"));
  // Collapsed whitespace makes "Sky   Blue" the same option as the standard "Sky Blue".
  assert.equal(merged.filter((name) => name === "Sky Blue").length, 1);
  assert.ok(!merged.some((name) => !name.trim()));
});

test("both product editors render the shared datalist once and point the colour input at it", async () => {
  for (const page of ["../src/modules/products/pages/CreateProduct.jsx", "../src/modules/products/pages/ProductEdit.jsx"]) {
    const source = await read(page);
    assert.equal(
      source.split("<ColorNameDatalist />").length - 1,
      1,
      `${page}: the datalist belongs at page level, not once per colour block`
    );
    assert.ok(
      source.includes('list="m1-standard-color-names"'),
      `${page}: the colour input must stay wired to the datalist`
    );
    assert.ok(
      !source.includes("STANDARD_COLOR_NAMES"),
      `${page}: the hard-coded 24-colour list must not come back`
    );
  }
});
