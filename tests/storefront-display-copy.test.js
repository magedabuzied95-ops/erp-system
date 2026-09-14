import assert from "node:assert/strict";
import test from "node:test";

import { localizeBrandLabel, localizeColorName, localizeHoursLine, localizeSizeLabel } from "../src/storefront/lib/displayCopy.js";
import { formatSchoolBagCardSize } from "../src/storefront/lib/schoolBagSize.js";

test("a colour name made of colour words reads in the shopper's language, both ways", () => {
  assert.equal(localizeColorName("Black & White", "ar"), "أسود وأبيض");
  assert.equal(localizeColorName("White & Red", "ar"), "أبيض وأحمر");
  assert.equal(localizeColorName("Sky Blue", "ar"), "سماوي");
  assert.equal(localizeColorName("BLAck", "ar"), "أسود");
  assert.equal(localizeColorName("أسود", "en"), "Black");
  assert.equal(localizeColorName("أبيض وأسود", "en"), "White & Black");
  assert.equal(localizeColorName("Black & White", "en"), "Black & White");
});

test("anything that is not purely colour words is left exactly as stored", () => {
  assert.equal(localizeColorName("Air Max - Black", "ar"), "Air Max - Black");
  assert.equal(localizeColorName("Black(2)", "ar"), "Black(2)");
  assert.equal(localizeColorName("", "ar"), "");
});

test("the one-size marker and bag inches follow the language; shoe and Crocs sizes do not change", () => {
  assert.equal(localizeSizeLabel("مقاس واحد", "en"), "One size");
  assert.equal(localizeSizeLabel("One Size", "ar"), "مقاس واحد");
  assert.equal(localizeSizeLabel("18-inch", "ar"), "18 بوصة");
  assert.equal(localizeSizeLabel("18-inch", "en"), "18-inch");
  assert.equal(localizeSizeLabel("42", "ar"), "42");
  assert.equal(localizeSizeLabel("M9/W11", "en"), "M9/W11");
});

test("a school bag's bare number is inches, and any other size still reads in the language", () => {
  assert.equal(formatSchoolBagCardSize("18", "ar"), "18 بوصة");
  assert.equal(formatSchoolBagCardSize("مقاس واحد", "en"), "One size");
});

test("Unbranded reads in Arabic, a real brand stays", () => {
  assert.equal(localizeBrandLabel("Unbranded", "ar"), "بدون ماركة");
  assert.equal(localizeBrandLabel("بدون ماركة", "en"), "Unbranded");
  assert.equal(localizeBrandLabel("Nike", "ar"), "Nike");
});

test("working hours typed in Arabic read in English; Arabic readers keep them as typed", () => {
  assert.equal(localizeHoursLine("السبت - الخميس", "en"), "Saturday – Thursday");
  assert.equal(localizeHoursLine("12:00 م - 1:00 ص", "en"), "12:00 PM – 1:00 AM");
  assert.equal(localizeHoursLine("12:00 م - 1:00 ص", "ar"), "12:00 م - 1:00 ص");
});
