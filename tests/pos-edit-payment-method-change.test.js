import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { deriveStoredPaymentMethod } from "../shared/paymentMethods.js";
import { editPaymentMethodChangeColumnDeltas, planEditPaymentMethodChange } from "../server/utils/editPaymentMethodChange.js";

test("a Vodafone Cash invoice re-saved as InstaPay is stored as InstaPay", () => {
  const plan = planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "vodafone_cash", amount: 850 }],
    requestedMethod: "instapay",
  });
  assert.deepEqual(
    { from: plan.fromMethod, to: plan.toMethod, amount: plan.amount },
    { from: "vodafone_cash", to: "instapay", amount: 850 }
  );
  assert.equal(plan.paymentBreakdown[0].method, "instapay");
  assert.equal(plan.paymentBreakdown[0].amount, 850);
  assert.equal(
    deriveStoredPaymentMethod({ requestedMethod: "instapay", paymentBreakdown: plan.paymentBreakdown }),
    "instapay"
  );
});

test("the deferred remainder of a part-paid invoice is not touched", () => {
  const plan = planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "cash", amount: 300 }, { method: "credit_sale", amount: 700 }],
    requestedMethod: "vodafone_cash",
  });
  assert.equal(plan.amount, 300);
  assert.deepEqual(plan.paymentBreakdown.map((row) => row.method), ["vodafone_cash", "credit_sale"]);
});

test("nothing to move: same method, split invoices, credit picks", () => {
  assert.equal(planEditPaymentMethodChange({ paymentBreakdown: [{ method: "instapay", amount: 100 }], requestedMethod: "instapay" }), null);
  assert.equal(planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "cash", amount: 100 }, { method: "instapay", amount: 50 }],
    requestedMethod: "vodafone_cash",
  }), null);
  assert.equal(planEditPaymentMethodChange({ paymentBreakdown: [{ method: "cash", amount: 100 }], requestedMethod: "credit_sale" }), null);
  assert.equal(planEditPaymentMethodChange({ paymentBreakdown: [{ method: "credit_sale", amount: 100 }], requestedMethod: "cash" }), null);
});

test("card and wallet columns follow the change; cash_amount never moves", () => {
  assert.deepEqual(editPaymentMethodChangeColumnDeltas({ fromMethod: "vodafone_cash", toMethod: "instapay", amount: 200 }), { card: 0, wallet: 0 });
  assert.deepEqual(editPaymentMethodChangeColumnDeltas({ fromMethod: "card", toMethod: "instapay", amount: 200 }), { card: -200, wallet: 200 });
  assert.deepEqual(editPaymentMethodChangeColumnDeltas({ fromMethod: "cash", toMethod: "card", amount: 200 }), { card: 200, wallet: 0 });
});

test("the edit endpoint and the till are wired to the change", () => {
  const controller = readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
  assert.match(controller, /req\.body\.change_payment_method === true/);
  assert.match(controller, /planEditPaymentMethodChange\(\{ paymentBreakdown: loaded\.order\.payment_breakdown/);
  assert.match(controller, /eventType: fromMethod === "cash" \? "cash_out" : "cash_in"/);
  // A cancelled invoice that was moved off cash must not hand its cash out a second time.
  assert.match(controller, /source_type\) = 'order_edit' AND e\.event_type = 'cash_out' THEN -e\.amount/);
  const pos = readFileSync(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
  assert.match(pos, /change_payment_method: Boolean\(/);
});
