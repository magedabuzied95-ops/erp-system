import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("variant payload preserves the selected color order", () => {
  const productsApi = readFileSync(new URL("../src/modules/products/services/productsApi.js", import.meta.url), "utf8");
  assert.match(productsApi, /color_sort_order:\s*Math\.max\(0, Number\(source\.color_sort_order/);
  assert.match(productsApi, /colorSortOrder:\s*Math\.max\(0, Number\(source\.colorSortOrder/);
});

test("product editor can reorder color groups without deleting them", () => {
  const createEditor = readFileSync(new URL("../src/modules/products/pages/CreateProduct.jsx", import.meta.url), "utf8");
  const editEditor = readFileSync(new URL("../src/modules/products/pages/ProductEdit.jsx", import.meta.url), "utf8");

  for (const source of [createEditor, editEditor]) {
    assert.match(source, /const moveColorGroup =/);
    assert.match(source, /\[next\[currentIndex\], next\[targetIndex\]\] = \[next\[targetIndex\], next\[currentIndex\]\]/);
    assert.match(source, /color_sort_order: groupIndex/);
  }
});

test("backend persists and storefront honors color sort order", () => {
  const products = readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
  const storefront = readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../server/database/schema.sql", import.meta.url), "utf8");

  assert.match(schema, /color_sort_order INTEGER NOT NULL DEFAULT 0/);
  assert.match(products, /color_sort_order = \$23/);
  assert.match(products, /ORDER BY v\.product_id DESC, v\.color_sort_order ASC, v\.id ASC/);
  assert.match(storefront, /'color_sort_order', pv\.color_sort_order/);
  assert.match(storefront, /Number\(left\?\.color_sort_order/);
});
