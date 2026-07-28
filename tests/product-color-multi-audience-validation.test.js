import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const createSource = read("../src/modules/products/pages/CreateProduct.jsx");
const editSource = read("../src/modules/products/pages/ProductEdit.jsx");

test("create product accepts one or multiple audiences for each color", () => {
  assert.match(createSource, /getProductAudienceValues\(\{ audience: group\.audience \}\)\.length === 0/);
  assert.doesNotMatch(createSource, /!normalizeProductAudienceValue\(group\.audience\)/);
});

test("edit product accepts one or multiple audiences for each color", () => {
  assert.match(editSource, /getProductAudienceValues\(\{ audience: group\.audience \}\)\.length === 0/);
  assert.doesNotMatch(editSource, /!normalizeProductAudienceValue\(group\.audience\)/);
});
