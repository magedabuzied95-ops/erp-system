import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTS_LIST_FILTERS_STORAGE_KEY,
  readProductsListFilters,
  removeStoredProductsListFilters,
  writeProductsListFilters,
} from "../src/modules/products/lib/productListFilters.js";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test("product filters survive a fresh page state", () => {
  const storage = memoryStorage();
  writeProductsListFilters({
    catalogTab: "offers",
    status: "active",
    brand: "Nike",
    classifications: { gender: "men", productType: "bags", grade: "mirror-original" },
  }, storage);

  const restored = readProductsListFilters(storage);
  assert.equal(restored.catalogTab, "offers");
  assert.equal(restored.status, "active");
  assert.equal(restored.brand, "Nike");
  assert.deepEqual(restored.classifications, { gender: "men", productType: "bags", grade: "mirror-original" });
});

test("clear removes persisted product filters", () => {
  const storage = memoryStorage();
  writeProductsListFilters({ status: "active" }, storage);
  removeStoredProductsListFilters(storage);
  assert.equal(storage.getItem(PRODUCTS_LIST_FILTERS_STORAGE_KEY), null);
  assert.equal(readProductsListFilters(storage).status, "all");
});
