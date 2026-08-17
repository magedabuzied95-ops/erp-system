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

test("manufacturer survives a fresh page state and defaults to all", () => {
  const storage = memoryStorage();
  writeProductsListFilters({ manufacturer: "Cairo Factory" }, storage);
  assert.equal(readProductsListFilters(storage).manufacturer, "Cairo Factory");

  // A payload written before the manufacturer filter existed must still read
  // back as "all" rather than undefined, or the request would send `undefined`.
  const legacy = memoryStorage();
  legacy.setItem(PRODUCTS_LIST_FILTERS_STORAGE_KEY, JSON.stringify({ brand: "Nike" }));
  assert.equal(readProductsListFilters(legacy).manufacturer, "all");
});

test("clear removes persisted product filters", () => {
  const storage = memoryStorage();
  writeProductsListFilters({ status: "active" }, storage);
  removeStoredProductsListFilters(storage);
  assert.equal(storage.getItem(PRODUCTS_LIST_FILTERS_STORAGE_KEY), null);
  assert.equal(readProductsListFilters(storage).status, "all");
});
