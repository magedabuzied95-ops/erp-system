import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/modules/inventory/pages/InventoryCount.jsx", import.meta.url),
  "utf8"
);

test("inventory count imports every select-field icon it renders", () => {
  assert.match(source, /ChevronLeft,/);
  assert.match(source, /<ChevronLeft\b/);
});
