import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const editSource = fs.readFileSync("src/modules/products/pages/ProductEdit.jsx", "utf8");
const createSource = fs.readFileSync("src/modules/products/pages/CreateProduct.jsx", "utf8");

test("editing a color-only product does not require a manual size value", () => {
  const validationStart = editSource.indexOf("const invalidRow =");
  const validationEnd = editSource.indexOf("if (invalidRow)", validationStart);
  const validationSource = editSource.slice(validationStart, validationEnd);

  assert.match(validationSource, /const invalidRow = isFullVariationMode/);
  assert.match(validationSource, /: null;/);
});

test("both create and edit generate the fixed size for color-only variants", () => {
  assert.match(createSource, /if \(isColorOnlyMode\)[\s\S]*?fixedSizeLabel \|\| "One Size"/);
  assert.match(editSource, /if \(isColorOnlyMode\)[\s\S]*?product\.fixed_size_label \|\| "One Size"/);
});
