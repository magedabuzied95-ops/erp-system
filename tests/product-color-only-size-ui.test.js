import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const createSource = fs.readFileSync(
  new URL("../src/modules/products/pages/CreateProduct.jsx", import.meta.url),
  "utf8"
);
const editSource = fs.readFileSync(
  new URL("../src/modules/products/pages/ProductEdit.jsx", import.meta.url),
  "utf8"
);

test("color-only product rows do not render a size field inside each color group", () => {
  for (const source of [createSource, editSource]) {
    assert.match(source, /\{!isColorOnlyMode \? <div>\s*<label[\s\S]*products\.fields\.size/);
    assert.doesNotMatch(source, /isColorOnlyMode \? t\("products\.editor\.fixedSize"[\s\S]{0,300}<input/);
  }
});

test("full variation rows keep their size input", () => {
  for (const source of [createSource, editSource]) {
    assert.match(source, /updateSizeRow\(group\.id, row\.id, "size", e\.target\.value\)/);
    assert.match(source, /placeholder="40"/);
  }
});
