import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PROVISIONAL_MOVEMENT_TYPES,
  planProvisionalSettlements,
  planProvisionalStockAdds,
} from "../server/utils/provisionalStock.js";
import { buildProductEditChangeSummary } from "../server/utils/productEditChangeSummary.js";

test("a raised quantity on a zero-stock size goes on sale", () => {
  const plan = planProvisionalStockAdds({
    previousVariants: [{ id: 1, default_purchase_qty: 0 }],
    savedVariants: [{ id: 1, product_id: 9, color: "Black", size: "42", stock: 0, default_purchase_qty: 5 }],
  });
  assert.deepEqual(plan, [{ variantId: 1, productId: 9, quantity: 5, color: "Black", size: "42" }]);
});

test("a brand-new size row with a quantity goes on sale", () => {
  const plan = planProvisionalStockAdds({
    previousVariants: [],
    savedVariants: [{ id: 7, product_id: 9, stock: 0, default_purchase_qty: 3 }],
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].quantity, 3);
});

test("an unrelated save never mints stock from quantities that were already planned", () => {
  const plan = planProvisionalStockAdds({
    previousVariants: [{ id: 1, default_purchase_qty: 6 }],
    savedVariants: [{ id: 1, stock: 0, default_purchase_qty: 6 }],
  });
  assert.deepEqual(plan, []);
});

test("a size that already has stock is only planned, not stocked", () => {
  const plan = planProvisionalStockAdds({
    previousVariants: [{ id: 1, default_purchase_qty: 0 }],
    savedVariants: [{ id: 1, stock: 2, default_purchase_qty: 10 }],
  });
  assert.deepEqual(plan, []);
});

test("a sold-out size that is still pending only receives the increase", () => {
  const plan = planProvisionalStockAdds({
    previousVariants: [{ id: 1, default_purchase_qty: 5 }],
    savedVariants: [{ id: 1, stock: 0, default_purchase_qty: 8 }],
    pendingByVariant: new Map([[1, 5]]),
  });
  assert.equal(plan[0].quantity, 3);
});

test("the invoice replaces provisional units instead of adding on top", () => {
  const plan = planProvisionalSettlements({
    items: [
      { variant_id: 1, product_id: 9, quantity: 5 },
      { variant_id: 2, product_id: 9, quantity: 8 },
      { variant_id: 3, product_id: 9, quantity: 4 },
    ],
    pendingByVariant: new Map([[1, 5], [2, 5]]),
  });
  assert.deepEqual(plan, [
    { variantId: 1, productId: 9, quantity: 5 },
    // an invoice larger than what was added settles only what was added
    { variantId: 2, productId: 9, quantity: 5 },
  ]);
});

test("a smaller invoice settles only its own quantity", () => {
  const plan = planProvisionalSettlements({
    items: [{ variant_id: 1, quantity: 2 }, { variant_id: 1, quantity: 1 }],
    pendingByVariant: new Map([[1, 5]]),
  });
  assert.equal(plan[0].quantity, 3);
});

test("the pending ledger reads exactly the three provisional movement types", () => {
  assert.deepEqual(PROVISIONAL_MOVEMENT_TYPES, ["PROVISIONAL_STOCK_IN", "PROVISIONAL_STOCK_SETTLED", "PROVISIONAL_SETTLEMENT_REVERSED"]);
});

test("the change summary names prices, new colours, new sizes and stock put on sale", () => {
  const changes = buildProductEditChangeSummary({
    previousProduct: { name: "Jordan", price: 650 },
    nextProduct: { name: "Jordan", price: 700 },
    previousVariants: [{ id: 1, color: "Black", size: "41", default_purchase_qty: 0 }],
    nextVariants: [
      { id: 1, color: "Black", size: "41", default_purchase_qty: 0 },
      { id: 2, color: "Black", size: "42", default_purchase_qty: 4 },
      { id: 3, color: "White", size: "40", default_purchase_qty: 2 },
    ],
    provisionalStockAdds: [{ variantId: 2, color: "Black", size: "42", quantity: 4 }],
  });
  assert.ok(changes.some((line) => line.startsWith("السعر:") && line.includes("650") && line.includes("700")));
  assert.ok(changes.includes("لون جديد: White"));
  assert.ok(changes.includes("مقاس جديد: Black / 42"));
  assert.ok(changes.some((line) => line.includes("اتضاف للمخزون 4")));
  assert.ok(!changes.some((line) => line.startsWith("الاسم")));
});

const purchasesRoute = readFileSync(new URL("../server/routes/purchases.js", import.meta.url), "utf8");
const productsController = readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");

test("every place a purchase puts stock in settles provisional stock, and a reversal gives it back first", () => {
  assert.equal((purchasesRoute.match(/settleProvisionalStockForPurchase\(client/g) || []).length, 3);
  assert.match(purchasesRoute, /const reverseReceivedPurchase = async[\s\S]{0,400}reverseProvisionalSettlementsForPurchase\(client/);
  assert.match(purchasesRoute, /loadOpenProvisionalSettlementsForPurchase\(client, \{ tenantId, purchaseId: purchase\?\.id \}\)/);
});

test("buying one colour no longer clears the planned quantity of the whole product", () => {
  assert.match(purchasesRoute, /variantlessProductIds\.length && columns\.has\("product_id"\)/);
  assert.doesNotMatch(purchasesRoute, /if \(productIds\.length && columns\.has\("product_id"\)\) \{\s*values\.push\(productIds\);/);
});

test("the product editor save applies provisional stock and tells the manager portal", () => {
  assert.match(productsController, /provisionalStockAdds = await applyProvisionalStockFromEditor\(client/);
  assert.match(productsController, /void sendManagerProductEditedPush\(/);
  assert.ok(
    productsController.indexOf("void sendManagerProductEditedPush(") > productsController.indexOf('await client.query("COMMIT");\n    transactionStarted = false;\n    await invalidateProductStorefrontCache'),
    "the push must fire after the save commits"
  );
});
