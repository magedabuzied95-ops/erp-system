import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveStoredPaymentMethod,
  formatOrderPaymentMethods,
  getCollectedPaymentAllocations,
} from "../shared/paymentMethods.js";

test("split input with one collected method stores the real method", () => {
  assert.equal(deriveStoredPaymentMethod({
    requestedMethod: "split",
    paymentBreakdown: [{ method: "cash", amount: 700 }],
  }), "cash");
});

test("split input with multiple methods stores only the internal mixed marker", () => {
  assert.equal(deriveStoredPaymentMethod({
    requestedMethod: "split",
    paymentBreakdown: [
      { method: "cash", amount: 200 },
      { method: "visa", amount: 800 },
    ],
  }), "mixed");
  assert.deepEqual(getCollectedPaymentAllocations([
    { method: "cash", amount: 200 },
    { method: "visa", amount: 800 },
  ]), [
    { method: "cash", amount: 200 },
    { method: "card", amount: 800 },
  ]);
});

test("deferred sale stays deferred while its deposit retains the real tender", () => {
  assert.equal(deriveStoredPaymentMethod({
    requestedMethod: "credit_sale",
    paymentBreakdown: [{ method: "instapay", amount: 500 }],
  }), "credit_sale");
});

test("customer-facing payment label lists actual methods and never Split", () => {
  const label = formatOrderPaymentMethods({
    payment_method: "split",
    payment_breakdown: [
      { method: "cash", amount: 200 },
      { method: "card", amount: 800 },
    ],
  }, "ar");
  assert.equal(label, "نقدي + فيزا");
  assert.doesNotMatch(label, /split/i);
});
