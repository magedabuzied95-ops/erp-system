import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSchoolBagCardSize,
  isSchoolBagProduct,
  schoolBagSizeInches,
} from "../src/storefront/lib/schoolBagSize.js";

test("school bag sizes accept both stored inch formats", () => {
  assert.equal(schoolBagSizeInches("inch-18"), 18);
  assert.equal(schoolBagSizeInches("18-inch"), 18);
  assert.equal(schoolBagSizeInches("18 inches"), 18);
});

test("school bag card size is readable in Arabic and English", () => {
  assert.equal(formatSchoolBagCardSize("inch-18", "ar"), "18 بوصة");
  assert.equal(formatSchoolBagCardSize("18-inch", "en"), "18 inch");
  assert.equal(formatSchoolBagCardSize("42", "ar"), "42");
});

test("school bag detection does not affect regular bags", () => {
  assert.equal(isSchoolBagProduct({ bag_type: "school-bag" }), true);
  assert.equal(isSchoolBagProduct({ bag_type: "handbag" }), false);
});
