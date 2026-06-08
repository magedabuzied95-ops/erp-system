import assert from "node:assert/strict";

import { normalizeArabicForIntent, normalizeArabicMessage } from "../utils/arabicTextNormalizer.js";

const expectEqual = (actual, expected, label) => {
  assert.equal(actual, expected, `${label}: expected "${expected}" but got "${actual}"`);
  console.log(`[verify] ${label}: ${actual}`);
};

const affirmativeSamples = ["أيوه", "ايوه", "أيوة", "ايوة"];
const affirmativeNormalized = affirmativeSamples.map((sample) => normalizeArabicForIntent(sample));
affirmativeNormalized.forEach((value, index) => expectEqual(value, "ايوه", `affirmative_${index + 1}`));

expectEqual(normalizeArabicForIntent("٤٢"), "42", "arabic_digits");
expectEqual(normalizeArabicForIntent("42"), "42", "latin_digits");

expectEqual(normalizeArabicForIntent("شوكس"), "shox", "shox_alias_ar");
expectEqual(normalizeArabicForIntent("shox"), "shox", "shox_alias_en");

expectEqual(normalizeArabicForIntent("جوردن فور"), "jordan 4", "jordan_four_ar");
expectEqual(normalizeArabicForIntent("jordan 4"), "jordan 4", "jordan_four_en");

["لا", "لأ", "لاء"].forEach((sample, index) => {
  expectEqual(normalizeArabicForIntent(sample), "لا", `negative_${index + 1}`);
});

expectEqual(normalizeArabicMessage("تماااام"), "تمام", "collapsed_repeat");
expectEqual(normalizeArabicForIntent("size ٤٢"), "مقاس 42", "size_word_normalization");

console.log("[verify] all arabic normalizer checks passed");
