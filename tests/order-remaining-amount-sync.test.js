import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ordersController = read("../server/controllers/ordersController.js");
const posController = read("../server/controllers/posController.js");
const customersController = read("../server/controllers/customersController.js");
const ordersDashboard = read("../src/modules/orders/pages/OrdersDashboard.jsx");
const invoiceNormalizer = read("../src/shared/utils/orderInvoice.js");

// orders.remaining_amount is denormalized: it is written at checkout and then read
// back by the orders list and the invoice. Every later writer of paid_amount has to
// keep it in step, or a fully collected invoice keeps reporting the old balance.
test("POS invoice edit rewrites the remaining balance alongside the paid amount", () => {
  assert.match(ordersController, /paid_amount = \$6,\s*\n\s*change_amount = GREATEST\(\$6::numeric - \$5::numeric, 0\),\s*\n\s*remaining_amount = GREATEST\(\$5::numeric - \$6::numeric, 0\),/);
});

test("shipping payment confirmation rewrites the remaining balance", () => {
  assert.match(ordersController, /paid_amount = \$5,\s*\n\s*remaining_amount = GREATEST\(/);
});

test("terminal payment confirmation rewrites the remaining balance", () => {
  const settlements = posController.match(/card_amount = COALESCE\(card_amount, 0\) \+ \$2::numeric,\s*\n\s*remaining_amount = GREATEST\(/g) || [];
  assert.equal(settlements.length, 2, "both the webhook and the manual terminal confirmations must sync remaining_amount");
});

test("customer ledger reconciliation rewrites the remaining balance", () => {
  assert.match(customersController, /SET paid_amount = allocation\.initial_paid_amount \+ allocation\.paid_amount,\s*\n\s*remaining_amount = GREATEST\(/);
});

test("a fully collected invoice is never shown as due", () => {
  assert.match(ordersDashboard, /if \(totalValue\(order\) > 0 && getPaidAmount\(order\) >= totalValue\(order\) - 0\.009\) return 0;/);
  assert.match(invoiceNormalizer, /const settledInFull = grandTotal > 0 && paidAmount >= grandTotal - 0\.009;/);
  assert.match(invoiceNormalizer, /const remainingAmount = settledInFull \? 0 :/);
});
