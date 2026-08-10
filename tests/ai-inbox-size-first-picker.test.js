import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const controllerSource = fs.readFileSync(
  new URL("../server/controllers/productsController.js", import.meta.url),
  "utf8"
);
const routesSource = fs.readFileSync(
  new URL("../server/routes/products.js", import.meta.url),
  "utf8"
);
const pickerSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url),
  "utf8"
);
const pickerApiSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/services/pickerSizesApi.js", import.meta.url),
  "utf8"
);

test("size-first endpoints exist and are registered with the same auth as the catalog", () => {
  assert.match(controllerSource, /export const getAvailableProductSizes = async/);
  assert.match(controllerSource, /export const getProductsBySize = async/);
  assert.match(routesSource, /router\.get\("\/available-sizes", protect, permit\("products", "view"\), getAvailableProductSizes\)/);
  assert.match(routesSource, /router\.get\("\/by-size", protect, permit\("products", "view"\), getProductsBySize\)/);
});

test("size endpoints reuse the canonical active/sellable/stock predicate", () => {
  // Same rule getProductsWithVariants uses: active, not deleted, positive stock.
  assert.match(
    controllerSource,
    /v\.is_active IS DISTINCT FROM FALSE AND v\.deleted_at IS NULL AND COALESCE\(v\.stock, 0\) > 0/
  );
});

test("size endpoints reuse the shared scope/search/filter helpers (no bespoke tenant logic)", () => {
  // buildPickerProductWhere composes the exact helpers used by the catalog endpoint.
  assert.match(controllerSource, /const buildPickerProductWhere = async/);
  assert.match(controllerSource, /resolveProductRequestScope\(req\)/);
  assert.match(controllerSource, /buildProductScopeClause\(\{ columns, scope \}\)/);
  assert.match(controllerSource, /buildProductSearchClause\(\{ values, search:/);
  assert.match(controllerSource, /buildProductsAdminListFiltersClause\(\{/);
});

test("the picker uses the size-first endpoints and skips the full catalog in sizeMode", () => {
  assert.match(pickerSource, /from "\.\.\/services\/pickerSizesApi"/);
  assert.match(pickerSource, /getAvailableProductSizes/);
  assert.match(pickerSource, /getProductsBySizeCount/);
  // In sizeMode the open effect must NOT load the full catalog (unless it fell back).
  assert.match(pickerSource, /if \(sizeMode && !sizeCatalogFallback\) return undefined;/);
});

test("the picker still falls back to the catalog if the size endpoints are unavailable", () => {
  assert.match(pickerSource, /setSizeCatalogFallback\(true\)/);
  assert.match(pickerSource, /sizeCatalogFallback\s*\?\s*availableSizesForProducts\(sizeLinkFilteredProducts\)/);
});

test("the picker size API omits empty/all params so requests stay minimal", () => {
  assert.match(pickerApiSource, /toLowerCase\(\) !== "all"\) params\.brand = brandValue/);
  assert.match(pickerApiSource, /count_only: 1/);
  assert.match(pickerApiSource, /\/products\/available-sizes/);
  assert.match(pickerApiSource, /\/products\/by-size/);
});
