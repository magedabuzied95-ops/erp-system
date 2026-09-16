import test from "node:test";
import assert from "node:assert/strict";

import { projectInboxConversationOrder } from "../server/modules/orders/inboxConversationOrders.js";

const restricted = { mode: "restricted", governorates: ["damietta"] };

test("the inbox card shows what the courier really collects, not the stored figure alone", () => {
  const projected = projectInboxConversationOrder({
    order: { id: 1, invoice_number: "INV-1", governorate: "الجيزة", total_amount: 440, shipping_fee: 90, paid_amount: 440, cod_amount: 350, status: "pending" },
    policy: restricted,
  });
  // A stale cod_amount must never ask a fully paid order for money at the door.
  assert.equal(projected.collect_on_delivery, 0);
  assert.equal(projected.paid_amount, 440);
});

test("a transfer screenshot waiting on review is flagged, an approved one is not", () => {
  const base = { id: 2, governorate: "الجيزة", total_amount: 440, shipping_fee: 90, paid_amount: 0, cod_amount: 350, shipping_payment_screenshot: "/uploads/payment-proofs/a.jpg" };
  assert.equal(projectInboxConversationOrder({ order: { ...base, transfer_proof_status: "pending" }, policy: restricted }).awaiting_payment_review, true);
  assert.equal(projectInboxConversationOrder({ order: { ...base, transfer_proof_status: "approved" }, policy: restricted }).awaiting_payment_review, false);
  // Nothing to review when the customer never uploaded anything.
  assert.equal(projectInboxConversationOrder({ order: { ...base, shipping_payment_screenshot: "", transfer_proof_status: "pending" }, policy: restricted }).awaiting_payment_review, false);
});

test("the confirmation message is offered while the order is still open, never after it ships", () => {
  const base = { id: 3, governorate: "دمياط", total_amount: 500, shipping_fee: 45, paid_amount: 0 };
  assert.equal(projectInboxConversationOrder({ order: { ...base, status: "pending" }, policy: restricted }).can_send_confirmation, true);
  assert.equal(projectInboxConversationOrder({ order: { ...base, status: "delivered" }, policy: restricted }).can_send_confirmation, false);
  assert.equal(projectInboxConversationOrder({ order: { ...base, status: "pending", tracking_number: "1234567" }, policy: restricted }).can_send_confirmation, false);
});

test("the swap, the parcel and the label are each offered exactly when they apply", () => {
  const items = [{ id: 7, product_name: "Lacoste", quantity: 1, returned_quantity: 0, total_amount: 1250, unit_price: 1250, variant_id: 9 }];
  const project = (order) => projectInboxConversationOrder({ order: { id: 6, customer_id: 42, governorate: "الجيزة", total_amount: 1250, ...order }, policy: restricted, items });

  // Nothing to swap while the goods are still in the shop, and nothing to swap without a
  // customer to hold the credit.
  assert.equal(project({ status: "confirmed" }).can_exchange, false);
  assert.equal(project({ status: "delivered" }).can_exchange, true);
  // INV-1469: Bosta delivered it while the order still read edit_requested.
  assert.equal(project({ status: "edit_requested", shipment_status: "delivered" }).can_exchange, true);
  // A cancelled order stays closed whatever the courier's last word was.
  assert.equal(project({ status: "cancelled", shipment_status: "delivered" }).can_exchange, false);
  assert.equal(projectInboxConversationOrder({ order: { id: 6, customer_id: null, status: "delivered" }, policy: restricted, items }).can_exchange, false);
  // Every line already returned leaves nothing to exchange.
  assert.equal(
    projectInboxConversationOrder({ order: { id: 6, customer_id: 42, status: "delivered" }, policy: restricted, items: [{ ...items[0], returned_quantity: 1 }] }).can_exchange,
    false
  );

  // One parcel per order: a draft gets no courier, and a booked order gets the label instead.
  assert.equal(project({ status: "ai_draft" }).can_create_shipment, false);
  assert.equal(project({ status: "confirmed" }).can_create_shipment, true);
  assert.equal(project({ status: "confirmed", tracking_number: "6473852793" }).can_create_shipment, false);
  assert.equal(project({ status: "confirmed", tracking_number: "6473852793" }).can_print_label, true);
  assert.equal(project({ status: "confirmed" }).can_print_label, false);

  // The lines travel with the card, so the exchange sheet needs no second request.
  assert.equal(project({ status: "delivered" }).items[0].returnable_quantity, 1);
});

test("the deposit ask is only live while the fee is genuinely owed", () => {
  const owed = projectInboxConversationOrder({
    order: { id: 4, governorate: "القاهرة", total_amount: 1940, shipping_fee: 90, paid_amount: 0, cod_amount: 1850 },
    policy: restricted,
  });
  assert.equal(owed.shipping_fee_advance.required, true);
  assert.equal(owed.shipping_fee_advance.status, "awaiting_payment");
  const damietta = projectInboxConversationOrder({
    order: { id: 5, governorate: "دمياط", total_amount: 1940, shipping_fee: 90, paid_amount: 0 },
    policy: restricted,
  });
  assert.equal(damietta.shipping_fee_advance.required, false);
});

// ---- INV-1583: a deposit staff asked for under the open closing system
import { describeShippingFeeAdvance, requestedDepositAmount } from "../server/modules/shipping/shippingFeeAdvance.js";
import { applyTransferPaymentConfirmation } from "../server/modules/walletTransfers/transferPaymentConfirmation.js";

const open = { mode: "open", governorates: ["damietta"] };
const depositOrder = (extra = {}) => ({
  id: 1583,
  governorate: "القاهرة",
  total_amount: 3600,
  shipping_fee: 0,
  paid_amount: 0,
  payment_method: "cash_on_delivery",
  timeline: [{ action: "deposit_requested", amount: 1000, at: "2026-09-16T00:00:00.000Z" }],
  ...extra,
});

test("a deposit the staff asked for is what the order owes, even under the open system", () => {
  const advance = describeShippingFeeAdvance({ order: depositOrder(), policy: open });
  assert.equal(advance.required, true);
  assert.equal(advance.amount, 1000);
  assert.equal(advance.status, "awaiting_payment");
  // Without the ask, the same order owes nothing up front.
  assert.equal(describeShippingFeeAdvance({ order: depositOrder({ timeline: [] }), policy: open }).required, false);
});

test("the newest ask wins and a paid deposit closes it", () => {
  const order = depositOrder({ timeline: [{ action: "deposit_requested", amount: 1000 }, { action: "deposit_requested", amount: 1500 }] });
  assert.equal(requestedDepositAmount(order), 1500);
  const paid = describeShippingFeeAdvance({ order: { ...order, paid_amount: 1500, transfer_proof_status: "approved" }, policy: open });
  assert.equal(paid.status, "paid");
});

test("a deposit never exceeds the order it belongs to", () => {
  assert.equal(requestedDepositAmount(depositOrder({ timeline: [{ action: "deposit_requested", amount: 99999 }] })), 3600);
});

test("approving the deposit pays exactly the deposit, and the courier collects the rest", async () => {
  const calls = [];
  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/UPDATE orders/.test(sql)) return { rows: [{ id: params[0], tenant_id: null, payment_status: params[3], paid_amount: params[4] }] };
      return { rows: [] };
    },
  };
  await applyTransferPaymentConfirmation(client, { order: depositOrder({ transfer_proof_status: "pending" }) });
  const update = calls.find((call) => /UPDATE orders/.test(call.sql));
  assert.equal(update.params[4], 1000);
  assert.equal(update.params[3], "partially_paid");
});

test("the whole-order choice still overrides a deposit ask", async () => {
  const calls = [];
  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/UPDATE orders/.test(sql)) return { rows: [{ id: params[0], tenant_id: null, payment_status: params[3], paid_amount: params[4] }] };
      return { rows: [] };
    },
  };
  await applyTransferPaymentConfirmation(client, { order: depositOrder({ transfer_proof_status: "pending" }), fullOrder: true });
  const update = calls.find((call) => /UPDATE orders/.test(call.sql));
  assert.equal(update.params[4], 3600);
  assert.equal(update.params[3], "paid");
});

test("a stated amount repairs an approval that read a deposit as the whole order", async () => {
  const calls = [];
  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/UPDATE orders/.test(sql)) return { rows: [{ id: params[0], tenant_id: null, payment_status: params[3], paid_amount: params[4] }] };
      return { rows: [] };
    },
  };
  // INV-1583 after the wrong press: 3600 recorded, 200 actually transferred.
  await applyTransferPaymentConfirmation(client, {
    order: depositOrder({ paid_amount: 3600, payment_status: "paid", transfer_proof_status: "approved", timeline: [] }),
    paidAmount: 200,
  });
  const update = calls.find((call) => /UPDATE orders/.test(call.sql));
  assert.equal(update.params[4], 200);
  assert.equal(update.params[3], "partially_paid");
});

test("a stated amount never exceeds the order", async () => {
  const calls = [];
  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/UPDATE orders/.test(sql)) return { rows: [{ id: params[0], tenant_id: null, payment_status: params[3], paid_amount: params[4] }] };
      return { rows: [] };
    },
  };
  await applyTransferPaymentConfirmation(client, { order: depositOrder(), paidAmount: 99999 });
  const update = calls.find((call) => /UPDATE orders/.test(call.sql));
  assert.equal(update.params[4], 3600);
  assert.equal(update.params[3], "paid");
});
