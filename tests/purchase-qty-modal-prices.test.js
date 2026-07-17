import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const purchaseOrder = readFileSync(
  new URL("../src/modules/purchases/pages/PurchaseOrder.jsx", import.meta.url),
  "utf8",
);

test("multi-product purchase quantity preview includes one price set per product", () => {
  assert.match(purchaseOrder, /purchasePrice:\s*money\(/);
  assert.match(purchaseOrder, /sellingPrice:\s*money\(/);
  assert.match(purchaseOrder, /salePrice:\s*money\(/);
  assert.match(purchaseOrder, /function MultiProductPurchaseQtyModal/);
  assert.match(purchaseOrder, /updateProductPrice\(product\.key, field, event\.target\.value\)/);
  assert.match(purchaseOrder, /priceInput\(product, "purchasePrice"/);
  assert.match(purchaseOrder, /priceInput\(product, "sellingPrice"/);
  assert.match(purchaseOrder, /priceInput\(product, "salePrice"/);
});

test("applying selected products copies each product price set into all of its invoice lines", () => {
  assert.match(purchaseOrder, /applyProductPurchaseQty = \(editedProducts = \[\]\)/);
  assert.match(purchaseOrder, /toArray\(editedProducts\)\.flatMap/);
  assert.match(purchaseOrder, /toArray\(product\.rows\)\.map/);
  assert.match(purchaseOrder, /unit_cost:\s*money\(row\.purchasePrice\)/);
  assert.match(purchaseOrder, /selling_price:\s*money\(row\.sellingPrice\)/);
  assert.match(purchaseOrder, /sale_price:\s*money\(row\.salePrice\)/);
  assert.match(purchaseOrder, /onApply=\{applyProductPurchaseQty\}/);
});

test("product cards support multi-select and a single review action", () => {
  assert.match(purchaseOrder, /const \[purchaseQtySelection, setPurchaseQtySelection\] = useState\(\[\]\)/);
  assert.match(purchaseOrder, /togglePurchaseQtySelection/);
  assert.match(purchaseOrder, /purchaseQtySelection\.length/);
  assert.match(purchaseOrder, /onClick=\{openPurchaseQtyPreview\}/);
  assert.match(purchaseOrder, /purchaseQtySelected=\{purchaseQtySelected\}/);
  assert.match(purchaseOrder, /aria-pressed=\{purchaseQtySelected\}/);
});
