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

test("nothing to move: same method, same split, credit picks", () => {
  assert.equal(planEditPaymentMethodChange({ paymentBreakdown: [{ method: "instapay", amount: 100 }], requestedMethod: "instapay" }), null);
  assert.equal(planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "cash", amount: 100 }, { method: "instapay", amount: 50 }],
    requestedSplit: [{ method: "instapay", amount: 50 }, { method: "cash", amount: 100 }],
  }), null);
  assert.equal(planEditPaymentMethodChange({ paymentBreakdown: [{ method: "cash", amount: 100 }], requestedMethod: "credit_sale" }), null);
  assert.equal(planEditPaymentMethodChange({ paymentBreakdown: [{ method: "credit_sale", amount: 100 }], requestedMethod: "cash" }), null);
});

test("a split invoice can be re-split (INV-2243)", () => {
  const plan = planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "cash", amount: 500 }, { method: "vodafone_cash", amount: 500 }],
    requestedSplit: [{ method: "cash", amount: 400 }, { method: "vodafone_cash", amount: 600 }],
  });
  assert.deepEqual(plan.moves, [{ method: "cash", delta: -100 }, { method: "vodafone_cash", delta: 100 }]);
  assert.equal(plan.amount, 100);
  assert.deepEqual(plan.paymentBreakdown.map((row) => [row.method, row.amount]), [["cash", 400], ["vodafone_cash", 600]]);
  assert.equal(deriveStoredPaymentMethod({ requestedMethod: "split", paymentBreakdown: plan.paymentBreakdown }), "mixed");
});

test("a split invoice can move wholly onto one method, and back", () => {
  const plan = planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "cash", amount: 300 }, { method: "card", amount: 200 }],
    requestedMethod: "instapay",
  });
  assert.deepEqual(plan.moves, [{ method: "cash", delta: -300 }, { method: "card", delta: -200 }, { method: "instapay", delta: 500 }]);
  assert.deepEqual(plan.paymentBreakdown.map((row) => [row.method, row.amount]), [["instapay", 500]]);
  const back = planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "cash", amount: 1000 }],
    requestedSplit: [{ method: "cash", amount: 700 }, { method: "wallet", amount: 300 }],
  });
  assert.deepEqual(back.moves, [{ method: "cash", delta: -300 }, { method: "instapay", delta: 300 }]);
});

test("a re-split must equal what was collected and keeps the deferred remainder", () => {
  assert.equal(planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "cash", amount: 500 }, { method: "card", amount: 500 }],
    requestedSplit: [{ method: "cash", amount: 600 }, { method: "card", amount: 500 }],
  }).error, "SPLIT_TOTAL_MISMATCH");
  assert.equal(planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "cash", amount: 500 }],
    requestedSplit: [{ method: "cash", amount: 400 }, { method: "customer_wallet", amount: 100 }],
  }).error, "UNSUPPORTED_METHOD");
  const plan = planEditPaymentMethodChange({
    paymentBreakdown: [{ method: "cash", amount: 200 }, { method: "card", amount: 100 }, { method: "credit_sale", amount: 700 }],
    requestedSplit: [{ method: "cash", amount: 100 }, { method: "card", amount: 200 }],
  });
  assert.deepEqual(plan.paymentBreakdown.map((row) => [row.method, row.amount]), [["credit_sale", 700], ["cash", 100], ["card", 200]]);
});

test("card and wallet columns follow the change; cash_amount never moves", () => {
  assert.deepEqual(editPaymentMethodChangeColumnDeltas({ fromMethod: "vodafone_cash", toMethod: "instapay", amount: 200 }), { card: 0, wallet: 0 });
  assert.deepEqual(editPaymentMethodChangeColumnDeltas({ fromMethod: "card", toMethod: "instapay", amount: 200 }), { card: -200, wallet: 200 });
  assert.deepEqual(editPaymentMethodChangeColumnDeltas({ fromMethod: "cash", toMethod: "card", amount: 200 }), { card: 200, wallet: 0 });
  assert.deepEqual(editPaymentMethodChangeColumnDeltas({ moves: [{ method: "cash", delta: -100 }, { method: "vodafone_cash", delta: 100 }] }), { card: 0, wallet: 100 });
});

test("the edit endpoint and the till are wired to the change", () => {
  const controller = readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
  assert.match(controller, /req\.body\.change_payment_method === true/);
  assert.match(controller, /planEditPaymentMethodChange\(\{\s+paymentBreakdown: loaded\.order\.payment_breakdown/);
  assert.match(controller, /requestedSplit: req\.body\.payment_split/);
  assert.match(controller, /eventType: move\.delta < 0 \? "cash_out" : "cash_in"/);
  // A cancelled invoice that was moved off cash must not hand its cash out a second time.
  assert.match(controller, /source_type\) = 'order_edit' AND e\.event_type = 'cash_out' THEN -e\.amount/);
  const pos = readFileSync(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
  assert.match(pos, /change_payment_method: Boolean\(/);
  assert.match(pos, /payment_split: editResplitActive \? paymentBreakdown : null/);
  assert.match(pos, /editResplitActive \? originalEditPaidAmount : editAmountDueNow/);
});
