import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

test("product edit wires the school bag size field and preserves its stored value", () => {
  const source = readFileSync(new URL("../src/modules/products/pages/ProductEdit.jsx", import.meta.url), "utf8");
  assert.match(source, /schoolBagSize=\{isSchoolBagType\(product\.bag_type\)/);
  assert.match(source, /onSchoolBagSizeChange=\{\(value\) => updateProductField\("fixed_size_label", value\)\}/);
  assert.match(source, /fixed_size_label:\s*isSchoolBagType\(product\.bag_type\)/);
});

test("product list renders a saved school bag size beside article badges", () => {
  const listSource = readFileSync(new URL("../src/modules/products/pages/ProductsList.jsx", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
  assert.match(listSource, /getSchoolBagSizeLabel/);
  assert.match(listSource, /مقاس \{schoolBagSizeLabel\}/);
  assert.match(controllerSource, /COALESCE\(p\.bag_type, ''\) AS bag_type/);
  assert.match(controllerSource, /COALESCE\(p\.fixed_size_label, ''\) AS fixed_size_label/);
});
