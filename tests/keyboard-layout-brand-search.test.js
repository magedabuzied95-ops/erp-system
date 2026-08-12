import assert from "node:assert/strict";
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
