import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const purchaseOrder = readFileSync(
  new URL("../src/modules/purchases/pages/PurchaseOrder.jsx", import.meta.url),
  "utf8"
);
const purchasesRoute = readFileSync(
  new URL("../server/routes/purchases.js", import.meta.url),
  "utf8"
);

test("product purchase quantities are consumed only after a successful purchase transaction", () => {
  assert.match(purchaseOrder, /quantity: row\.savedQty,[\s\S]*?consume_default_purchase_qty: true/);
  assert.match(purchaseOrder, /item\.consume_default_purchase_qty \? \{ consume_default_purchase_qty: true \}/);
  assert.match(purchasesRoute, /const resetConsumedDefaultPurchaseQty = async/);
  assert.match(purchasesRoute, /item\?\.metadata\?\.consume_default_purchase_qty === true/);
  assert.match(purchasesRoute, /UPDATE product_variants[\s\S]*?SET default_purchase_qty = 0/);
  assert.match(purchasesRoute, /runStep\("variant purchase quantity reset"[\s\S]*?resetConsumedDefaultPurchaseQty/);
  assert.ok(
    purchasesRoute.indexOf('runStep("variant purchase quantity reset"') < purchasesRoute.indexOf('runStep("transaction.commit"'),
    "the reset must be part of the purchase transaction"
  );
});
