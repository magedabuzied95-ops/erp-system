import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/modules/employees/pages/EmployeePortalProducts.jsx", import.meta.url),
  "utf8"
);

test("warehouse request filters use the configured POS classifications", () => {
  assert.match(source, /useProductClassifications\(\{ includeInactive: false \}\)/);
  assert.match(source, /classificationGroupsToFieldOptions/);
  assert.match(source, /getEmployeeSmartFilterValue\(product, "productType"/);
  assert.match(source, /getEmployeeSmartFilterValue\(product, "grade"/);
});

test("warehouse product type ordering keeps winter collection last", () => {
  assert.match(source, /productType: moveWinterCollectionToEnd\(productType\)/);
});

test("grade filter is sourced from product grade instead of display category", () => {
  assert.match(source, /grade: text\(mappedProduct\.grade \|\| mappedProduct\.product_grade/);
  assert.doesNotMatch(source, /grade: optionWithCounts\(filterOptions\.categories/);
});
