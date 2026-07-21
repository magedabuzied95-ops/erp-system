import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readSourceFile = (url) => {
  const buffer = readFileSync(url);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return buffer.swap16().toString("utf16le");
  }
  return buffer.toString("utf8");
};

const purchaseOrder = readSourceFile(new URL("../src/modules/purchases/pages/PurchaseOrder.jsx", import.meta.url));
const purchasesRoute = readSourceFile(new URL("../server/routes/purchases.js", import.meta.url));

test("product purchase quantities are consumed only after a successful purchase transaction", () => {
  assert.match(purchaseOrder, /quantity: row\.savedQty,[\s\S]*?consume_default_purchase_qty: true/);
  assert.match(purchaseOrder, /shouldConsumeDefaultPurchaseQty = item\.consume_default_purchase_qty \|\| savedDefaultPurchaseQty > 0/);
  assert.match(purchaseOrder, /shouldConsumeDefaultPurchaseQty \? \{ consume_default_purchase_qty: true \}/);
  assert.match(purchasesRoute, /const resetConsumedDefaultPurchaseQty = async/);
  assert.match(purchasesRoute, /item\?\.metadata\?\.consume_default_purchase_qty === true/);
  assert.match(purchasesRoute, /Number\(item\?\.default_purchase_qty \|\| item\?\.metadata\?\.default_purchase_qty \|\| 0\) > 0/);
  assert.match(purchasesRoute, /UPDATE product_variants[\s\S]*?SET default_purchase_qty = 0/);
  assert.match(purchasesRoute, /runStep\("variant purchase quantity reset"[\s\S]*?resetConsumedDefaultPurchaseQty/);
  assert.ok(
    purchasesRoute.indexOf('runStep("variant purchase quantity reset"') < purchasesRoute.indexOf('runStep("transaction.commit"'),
    "the reset must be part of the purchase transaction"
  );
});
