import test from "node:test";
import assert from "node:assert/strict";

import { isSchoolBagType, SCHOOL_BAG_SIZE_OPTIONS } from "../src/modules/products/lib/schoolBagSizes.js";

test("school bag size options cover every inch from 12 through 22", () => {
  assert.deepEqual(SCHOOL_BAG_SIZE_OPTIONS.map((option) => option.inches), [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  assert.equal(SCHOOL_BAG_SIZE_OPTIONS[0].value, "12-inch");
  assert.equal(SCHOOL_BAG_SIZE_OPTIONS.at(-1).value, "22-inch");
});

test("school bag classification accepts stored separator variants", () => {
  assert.equal(isSchoolBagType("school-bag"), true);
  assert.equal(isSchoolBagType("school_bag"), true);
  assert.equal(isSchoolBagType("handbag"), false);
});
