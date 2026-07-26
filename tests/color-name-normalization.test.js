import test from "node:test";
import assert from "node:assert/strict";

import { normalizeColorName } from "../src/shared/utils/colorNameNormalization.js";

test("normalizes common English color misspellings", () => {
  assert.equal(normalizeColorName("Biege"), "Beige");
  assert.equal(normalizeColorName("balck"), "Black");
  assert.equal(normalizeColorName("navyblue"), "Navy");
});

test("normalizes capitalization and keeps compound colors", () => {
  assert.equal(normalizeColorName("black + offwhite"), "Black + Off White");
  assert.equal(normalizeColorName("brown / cream"), "Brown / Cream");
  assert.equal(normalizeColorName("dusty teal"), "Dusty Teal");
});
