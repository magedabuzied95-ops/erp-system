import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getOrderOutstandingAmount,
  getOrderRemainingAmount,
  resolveOrderPaymentState,
} from "../src/modules/pos/lib/orderPaymentState.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const drawerSource = read("../src/modules/pos/components/RecentOperationsDrawer.jsx");
const ordersControllerSource = read("../server/controllers/ordersController.js");

test("payment state comes from the amounts, never from the fulfilment status", () => {
  // Every completed POS sale normalizes to `confirmed`, and a deferred one to
  // `pending`; both used to leak onto the badge as the invoice's payment state.
  assert.equal(
    resolveOrderPaymentState({ status: "confirmed", total: 1700, paid_amount: 1700, remaining_amount: 0 }),
    "paid"
  );
  assert.equal(
    resolveOrderPaymentState({ status: "confirmed", total: 1700, paid_amount: 700, remaining_amount: 1000 }),
    "partial"
  );
  assert.equal(
    resolveOrderPaymentState({ status: "pending", total: 1700, paid_amount: 0, remaining_amount: 1700 }),
    "unpaid"
  );
  // A lifecycle status alone must never be read as a payment state.
  assert.equal(resolveOrderPaymentState({ status: "confirmed", total: 1700 }), "");
  assert.equal(resolveOrderPaymentState({ status: "delivered", total: 1700 }), "");
});

test("payment_status is only a fallback, and its POS spellings all resolve", () => {
  // POS writes the checkout summary straight through, so the column is mixed-case
  // and mixed-vocabulary.
  assert.equal(resolveOrderPaymentState({ payment_status: "Paid" }), "paid");
  assert.equal(resolveOrderPaymentState({ payment_status: "partially_paid" }), "partial");
  assert.equal(resolveOrderPaymentState({ payment_status: "Partial" }), "partial");
  assert.equal(resolveOrderPaymentState({ payment_status: "unpaid" }), "unpaid");
  assert.equal(resolveOrderPaymentState({ payment_status: "Pending" }), "unpaid");
  // Amounts win over a payment_status that disagrees with them.
  assert.equal(
    resolveOrderPaymentState({ payment_status: "Paid", total: 500, paid_amount: 200, remaining_amount: 300 }),
    "partial"
  );
});

test("the stored remaining_amount outranks total - paid", () => {
  assert.equal(getOrderRemainingAmount({ total: 500, paid_amount: 100, remaining_amount: 250 }), 250);
  assert.equal(getOrderRemainingAmount({ total: 500, paid_amount: 100 }), 400);
  assert.equal(getOrderRemainingAmount({ total: 500, paid_amount: 900, remaining_amount: -40 }), 0);
});

test("a row with no amounts reports no outstanding balance instead of the full total", () => {
  // Guards the chip against rendering `total - 0` for an invoice that was fully paid.
  assert.equal(getOrderOutstandingAmount({ total: 1700 }), null);
  assert.equal(getOrderOutstandingAmount({ total: 1700, paid_amount: 1700, remaining_amount: 0 }), 0);
  assert.equal(getOrderOutstandingAmount({ total: 1700, paid_amount: 700, remaining_amount: 1000 }), 1000);
});

test("the recent operations badge renders the payment state and drops the lifecycle guesses", () => {
  assert.match(drawerSource, /const paymentState = resolveOrderPaymentState\(order\);/);
  assert.match(drawerSource, /partial: \{ labelKey: "pos\.recentOps\.status\.partiallyPaid"/);
  assert.match(drawerSource, /unpaid: \{ labelKey: "pos\.recentOps\.status\.credit"/);
  assert.doesNotMatch(drawerSource, /isReviewOrder|isPaidOrder/);
  // The outstanding chip stays off a cancelled or returned invoice, whose stored
  // amounts the return flow never adjusts.
  assert.match(
    drawerSource,
    /isCancelledOrder\(order\) \|\| isReturnedOrder\(order\) \? null : getOrderOutstandingAmount\(order\)/
  );

  for (const locale of ["en", "ar"]) {
    const status = JSON.parse(read(`../src/locales/${locale}/pos.json`))?.recentOps;
    for (const key of ["paid", "partiallyPaid", "credit"]) {
      assert.equal(typeof status?.status?.[key], "string", `pos.recentOps.status.${key} missing in ${locale}`);
      assert.ok(status.status[key].trim().length > 0, `pos.recentOps.status.${key} empty in ${locale}`);
    }
    assert.ok(String(status?.remainingLabel || "").trim().length > 0, `pos.recentOps.remainingLabel missing in ${locale}`);
  }
});

test("the POS recent-orders projection ships the amounts the badge needs", () => {
  const start = ordersControllerSource.indexOf("const getPosRecentOrders");
  assert.ok(start > 0, "getPosRecentOrders not found");
  const handler = ordersControllerSource.slice(start, ordersControllerSource.indexOf("export const getOrders", start));
  assert.match(handler, /AS paid_amount,/);
  assert.match(handler, /AS remaining_amount,/);
  assert.match(handler, /paid_amount: Number\(order\.paid_amount \|\| 0\),/);
  assert.match(handler, /remaining_amount: Number\(order\.remaining_amount \|\| 0\),/);
});
