import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const productsList = readFileSync(
  new URL("../src/modules/products/pages/ProductsList.jsx", import.meta.url),
  "utf8",
);

test("catalog navigation actions are real links that support opening in a new tab", () => {
  assert.match(productsList, /key:\s*"edit"[\s\S]*?href:\s*`\/products\/\$\{row\.id\}\/edit`/);
  assert.match(productsList, /key:\s*"view"[\s\S]*?href:\s*`\/products\/\$\{row\.id\}`/);
  assert.match(productsList, /key:\s*"stock"[\s\S]*?href:\s*`\/inventory\/adjustments\?productId=/);
  assert.match(productsList, /key:\s*"print-barcode"[\s\S]*?href:\s*`\/products\/barcode-labels\?productId=/);
  assert.match(productsList, /key:\s*"barcode-shop"[\s\S]*?href:\s*`\/products\/labels\?mode=barcode-shop/);
  assert.match(productsList, /<Link[\s\S]*?to=\{href\}/);
  assert.match(productsList, /handleNavigableActionClick\(event, action\.onClick\)/);
  assert.match(productsList, /event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/);
});
