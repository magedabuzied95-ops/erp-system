import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  convertArabicKeyboardToEnglish,
  convertEnglishKeyboardToArabic,
  getKeyboardLayoutSearchVariants,
  keyboardLayoutIncludes,
} from "../shared/keyboardLayoutSearch.js";

test("converts brand names typed while the Arabic keyboard is active", () => {
  assert.equal(convertArabicKeyboardToEnglish("ىهنث"), "nike");
  assert.equal(convertArabicKeyboardToEnglish("شيهيشس"), "adidas");
  assert.equal(convertArabicKeyboardToEnglish("ىثص لاشمشىؤث"), "new balance");
});

test("keeps original text and both keyboard-layout aliases", () => {
  assert.deepEqual(getKeyboardLayoutSearchVariants("ىهنث"), ["ىهنث", "nike"]);
  assert.equal(convertEnglishKeyboardToArabic("nike"), "ىهنث");
});

test("brand matching works without manually switching the keyboard language", () => {
  assert.equal(keyboardLayoutIncludes("Nike", "ىهنث"), true);
  assert.equal(keyboardLayoutIncludes("Adidas Originals", "شيهيشس"), true);
  assert.equal(keyboardLayoutIncludes("New Balance", "ىثص لاشمشىؤث"), true);
  assert.equal(keyboardLayoutIncludes("نايك", "نايك"), true);
  assert.equal(keyboardLayoutIncludes("Puma", "ىهنث"), false);
});

test("the products list uses the keyboard-aware searchable brand combobox", () => {
  const source = readFileSync(new URL("../src/modules/products/pages/ProductsList.jsx", import.meta.url), "utf8");
  assert.match(source, /function BrandFilterCombobox/);
  assert.match(source, /brands\.filter\(\(brand\) => keyboardLayoutIncludes\(brand, query\)\)/);
  assert.match(source, /<BrandFilterCombobox\s+value=\{brandFilter\}/);
});
