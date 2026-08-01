import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createSource = readFileSync(new URL("../src/modules/products/pages/CreateProduct.jsx", import.meta.url), "utf8");
const editSource = readFileSync(new URL("../src/modules/products/pages/ProductEdit.jsx", import.meta.url), "utf8");
const productsController = readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
const storefrontController = readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");

test("product create and edit expose color-level storefront visibility", () => {
  for (const source of [createSource, editSource]) {
    assert.match(source, /ظهور اللون على الموقع/);
    assert.match(source, /is_storefront_visible: group\.is_storefront_visible !== false/);
    assert.match(source, /الإخفاء لا يحذف اللون ولا يؤثر على المخزون أو الـPOS/);
  }
});

test("variant visibility is persisted with a backwards-compatible visible default", () => {
  assert.match(productsController, /is_storefront_visible BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(productsController, /is_storefront_visible = \$25/);
  assert.match(productsController, /nextVariant\.is_storefront_visible !== false/);
});

test("storefront catalog, filters and checkout exclude hidden color variants", () => {
  assert.match(storefrontController, /COALESCE\(pv\.is_storefront_visible, TRUE\) = TRUE/);
  assert.match(storefrontController, /COALESCE\(pv_size\.is_storefront_visible, TRUE\) = TRUE/);
  assert.match(storefrontController, /decrement stock:lock variant[\s\S]*?COALESCE\(pv\.is_storefront_visible, TRUE\) = TRUE/);
});
