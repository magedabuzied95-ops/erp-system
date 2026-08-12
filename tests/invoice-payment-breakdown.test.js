import assert from "node:assert/strict";
import test from "node:test";

import { normalizeInvoicePaymentBreakdown } from "../src/shared/utils/invoicePaymentBreakdown.js";

const splitPayment = [
  { method: "cash", amount: 550 },
  { method: "vodafone_cash", amount: 1300 },
];

test("invoice INV-352 style split payment keeps each collected method and amount", () => {
  assert.deepEqual(normalizeInvoicePaymentBreakdown(splitPayment), splitPayment);

});

test("payment breakdown accepts stored JSON and aggregates duplicate method rows", () => {
  assert.deepEqual(
    normalizeInvoicePaymentBreakdown(JSON.stringify([
      { payment_method: "cash", amount: 200 },
      { method: "cash", paid_amount: 350 },
      { method: "vodafone-cash", value: 1300 },
      { method: "credit_sale", amount: 25 },
    ])),
    splitPayment
  );
});
