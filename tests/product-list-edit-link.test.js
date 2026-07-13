import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const productsList = readFileSync(
  new URL("../src/modules/products/pages/ProductsList.jsx", import.meta.url),
  "utf8",
);

test("catalog edit action is a real link that supports opening in a new tab", () => {
  assert.match(productsList, /key:\s*"edit"[\s\S]*?href:\s*`\/products\/\$\{row\.id\}\/edit`/);
  assert.match(productsList, /<Link[\s\S]*?to=\{href\}/);
  assert.match(productsList, /event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/);
});
