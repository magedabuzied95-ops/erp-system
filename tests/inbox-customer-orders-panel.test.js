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
