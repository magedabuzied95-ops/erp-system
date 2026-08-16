import assert from "node:assert/strict";
import test from "node:test";

import {
  BRAND_CATALOG_NAMES,
  extractBrand,
  extractCategory,
  extractColor,
  extractModel,
  resolveBrand,
} from "../../server/services/aiEntityLexicon.js";

test("Arabic and Latin spellings reach the same catalog brand", () => {
  for (const [arabic, latin] of [
    ["عندكم كروكس؟", "Crocs"],
    ["عايز بوما", "Puma"],
    ["فانز موجودة؟", "Vans"],
    ["نايك عندكم", "Nike"],
    ["اديداس للجري", "Adidas"],
    ["نيو بالانس", "New Balance"],
    ["كونفرس", "Converse"],
  ]) {
    assert.equal(extractBrand(arabic), latin, `${arabic} should read as ${latin}`);
  }
  assert.equal(extractBrand("do you have crocs?"), "Crocs");
});

test("a multi-word brand wins over the single word inside it", () => {
  // "بالانس" alone must not shadow "نيو بالانس" — ordering in the lexicon is load-bearing.
  assert.equal(extractBrand("عايز نيو بالانس 574"), "New Balance");
});

test("an unknown brand reads as null rather than a guess", () => {
  assert.equal(extractBrand("عايز حاجة حلوة"), null);
  assert.equal(extractBrand(""), null);
});

test("behaviour the store chat if-chain had is preserved", () => {
  // These three were the ONLY brands the old chain knew; none may regress.
  assert.equal(resolveBrand("عايز جوردن فور"), "Jordan");
  assert.equal(resolveBrand("nike shox"), "Nike");
  assert.equal(resolveBrand("adidas"), "Adidas");
  // "شوكس" named no brand outright, yet the old chain returned Nike for it.
  assert.equal(resolveBrand("عايز شوكس"), "Nike");
  assert.equal(resolveBrand("aj4"), "Jordan");
});

test("resolveBrand returns empty string, not null, for the route's contract", () => {
  // cleanVisualProductQuery spreads this into a payload typed as string.
  assert.equal(resolveBrand("حاجة مش معروفة"), "");
});

test("models, categories and colours resolve to canonical values", () => {
  assert.equal(extractModel("عايز جوردن فور"), "jordan4");
  assert.equal(extractCategory("عايز اديداس للجري"), "running");
  assert.equal(extractCategory("حاجة كاجوال"), "casual");
  assert.equal(extractColor("كروكس اسود"), "أسود");
  assert.equal(extractColor("in black please"), "أسود");
});

test("catalog names are unique and Latin — the retriever searches these", () => {
  assert.equal(BRAND_CATALOG_NAMES.length, new Set(BRAND_CATALOG_NAMES).size);
  for (const name of BRAND_CATALOG_NAMES) {
    assert.match(name, /^[A-Za-z][A-Za-z\s]*$/, `${name} must be a Latin catalog spelling`);
  }
});
