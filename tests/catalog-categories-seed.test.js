import test from "node:test";
import assert from "node:assert/strict";

// The categories page keeps its list in localStorage. Emptying it used to refill it with
// the demo Footwear / Sneakers / Apparel on the next visit, so the owner could never
// get rid of them. The starter list is for a browser that never saved one, only.

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
};
const { seedCategories, saveCategories } = await import("../src/modules/products/lib/catalog.js");

test("a fresh browser gets the starter categories", () => {
  store.clear();
  assert.ok(seedCategories().length > 0);
});

test("a list the owner emptied stays empty", () => {
  store.clear();
  seedCategories();
  saveCategories([]);
  assert.deepEqual(seedCategories(), []);
});
