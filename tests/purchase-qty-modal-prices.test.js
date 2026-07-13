import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const purchaseOrder = readFileSync(
  new URL("../src/modules/purchases/pages/PurchaseOrder.jsx", import.meta.url),
  "utf8",
);

test("product purchase quantity preview includes editable purchase, selling, and sale prices", () => {
  assert.match(purchaseOrder, /purchasePrice:\s*money\(/);
  assert.match(purchaseOrder, /sellingPrice:\s*money\(/);
  assert.match(purchaseOrder, /salePrice:\s*money\(/);
  assert.match(purchaseOrder, /updateRowPrice\(row\.line_id, "purchasePrice"/);
  assert.match(purchaseOrder, /updateRowPrice\(row\.line_id, "sellingPrice"/);
  assert.match(purchaseOrder, /updateRowPrice\(row\.line_id, "salePrice"/);
});

test("applying saved quantities copies edited prices into invoice lines", () => {
  assert.match(purchaseOrder, /applyProductPurchaseQty = \(group, editedRows = null\)/);
  assert.match(purchaseOrder, /unit_cost:\s*money\(row\.purchasePrice\)/);
  assert.match(purchaseOrder, /selling_price:\s*money\(row\.sellingPrice\)/);
  assert.match(purchaseOrder, /sale_price:\s*money\(row\.salePrice\)/);
  assert.match(purchaseOrder, /onApply=\{\(rows\) => applyProductPurchaseQty\(purchaseQtyModal\.group, rows\)\}/);
});
