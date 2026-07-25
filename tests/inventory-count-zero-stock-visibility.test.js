import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pageSource = fs.readFileSync(
  new URL("../src/modules/inventory/pages/InventoryCount.jsx", import.meta.url),
  "utf8"
);

test("inventory count does not hide zero-stock colors or sizes", () => {
  assert.doesNotMatch(
    pageSource,
    /filters\.inStockOnly\s*\|\|\s*toNumber\(group\.system_total/
  );
  assert.match(pageSource, /inStockOnly:\s*false/);
  assert.doesNotMatch(pageSource, /inStockOnly:\s*true/);
});
