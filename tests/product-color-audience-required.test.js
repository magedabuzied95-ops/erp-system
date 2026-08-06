import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createSource = readFileSync(new URL("../src/modules/products/pages/CreateProduct.jsx", import.meta.url), "utf8");
const editSource = readFileSync(new URL("../src/modules/products/pages/ProductEdit.jsx", import.meta.url), "utf8");

test("create product blocks every populated color without an audience", () => {
  assert.match(createSource, /getProductAudienceValues\(\{ audience: group\.audience \}\)\.length === 0/);
  assert.match(createSource, /يجب تحديد الجمهور للون/);
  assert.match(createSource, /setVariantNotice\(message\)/);
});

test("edit product blocks every populated color without an audience", () => {
  assert.match(editSource, /getProductAudienceValues\(\{ audience: group\.audience \}\)\.length === 0/);
  assert.match(editSource, /يجب تحديد الجمهور للون/);
});
