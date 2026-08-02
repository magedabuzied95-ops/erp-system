import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/modules/employees/pages/EmployeePortalProducts.jsx", import.meta.url),
  "utf8"
);
const serviceSource = await readFile(
  new URL("../server/services/employeePortalProductsService.js", import.meta.url),
  "utf8"
);
const controllerSource = await readFile(
  new URL("../server/controllers/productsController.js", import.meta.url),
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

test("warehouse facets cascade from the selected product type and grade", () => {
  assert.match(source, /const productsMatchingClassificationFilters = useMemo/);
  assert.match(source, /uniqueValues\(productsMatchingClassificationFilters\.map\(\(product\) => product\.brand\)\)/);
  assert.match(source, /uniqueValues\(productsMatchingClassificationFilters\.map\(\(product\) => product\.manufacturer_name\)\)/);
  assert.match(source, /for \(const product of productsMatchingClassificationFilters\)/);
  assert.match(source, /if \(!brandOptions\.some\(\(option\) => option\.id === filters\.brand\)\)/);
  assert.match(source, /if \(!manufacturerOptions\.some\(\(option\) => option\.id === filters\.manufacturer\)\)/);
});

test("warehouse catalog forwards its bounded page and active filters to the product query", () => {
  assert.match(serviceSource, /Math\.min\(Math\.max\(toPositiveInt\(query\.limit/);
  assert.match(serviceSource, /limit,/);
  assert.match(serviceSource, /page,/);
  assert.match(serviceSource, /\{ product_type: productType \}/);
  assert.match(serviceSource, /\{ grade \}/);
  assert.match(serviceSource, /\{ manufacturer \}/);
  assert.match(controllerSource, /manufacturer: req\.query\.manufacturer/);
  assert.match(controllerSource, /applied\.manufacturer = rawManufacturer/);
  assert.match(source, /const params = \{ limit: 48, inStockOnly: 1 \}/);
  assert.match(controllerSource, /route: "GET \/api\/products\/with-variants"[\s\S]*?const limit = requestedLimit > 0 \? Math\.min\(requestedLimit, 48\) : null/);
  assert.match(controllerSource, /LEFT JOIN manufacturers m ON m\.id = p\.manufacturer_id/);
});
