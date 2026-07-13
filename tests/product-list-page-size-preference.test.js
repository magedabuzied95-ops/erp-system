import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const productsList = readFileSync(
  new URL("../src/modules/products/pages/ProductsList.jsx", import.meta.url),
  "utf8",
);

test("product list restores and persists the selected page size", () => {
  assert.match(productsList, /PRODUCTS_PAGE_SIZE_STORAGE_KEY\s*=\s*"erp\.products\.list\.pageSize"/);
  assert.match(productsList, /useState\(getStoredProductsPageSize\)/);
  assert.match(productsList, /storeProductsPageSize\(pageSize\)/);
  assert.match(productsList, /pageSizeOptions\.includes\(storedValue\)/);
});
