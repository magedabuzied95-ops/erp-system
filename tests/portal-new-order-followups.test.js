import test from "node:test";
import assert from "node:assert/strict";

import { runCreateFollowups } from "../server/modules/shipping/shipping.portal.create.js";

// The two switches on the "+" new-order sheet (owner request 2026-10-19): money already
// received goes through the card's own "تم دفع الشحن" step, the WhatsApp confirmation is the
// order page's manual send, payment first — and a refusal never undoes the saved order.

const actor = { id: 7, tenant_id: 1, name: "Manager" };
const recorder = () => {
  const calls = [];
  return {
    calls,
    runAction: async (args) => { calls.push(["action", args]); },
    sendConfirmation: async (orderId) => { calls.push(["confirm", orderId]); return { queued: true }; },
  };
};

test("both switches off: nothing runs", async () => {
  const deps = recorder();
  const result = await runCreateFollowups({ actor, surface: "manager-portal", orderId: 5, body: {}, deps });
  assert.deepEqual(result, {});
  assert.equal(deps.calls.length, 0);
});

test("shipping fee paid then confirmation, in that order, through the card's action", async () => {
  const deps = recorder();
  const result = await runCreateFollowups({
    actor,
    surface: "employee-portal",
    orderId: 5,
    body: { payment_received: "shipping_fee", payment_received_method: "vodafone_cash", send_confirmation: true },
    deps,
  });
  assert.deepEqual(deps.calls.map(([kind]) => kind), ["action", "confirm"]);
  const [, args] = deps.calls[0];
  assert.equal(args.action, "shipping_fee_paid");
  assert.equal(args.surface, "employee_portal");
  assert.deepEqual(args.input, { method: "vodafone_cash" });
  assert.deepEqual(result, { payment: { ok: true, scope: "shipping_fee" }, confirmation: { ok: true, queued: true } });
});

test("whole order paid sends scope order_total; an unknown method falls back to instapay", async () => {
  const deps = recorder();
  await runCreateFollowups({ actor, surface: "manager-portal", orderId: 5, body: { payment_received: "order_total", payment_received_method: "bitcoin" }, deps });
  assert.deepEqual(deps.calls[0][1].input, { method: "instapay", scope: "order_total" });
});

test("a refused payment or send is reported, never thrown", async () => {
  const result = await runCreateFollowups({
    actor,
    surface: "manager-portal",
    orderId: 5,
    body: { payment_received: "shipping_fee", send_confirmation: true },
    deps: {
      runAction: async () => { throw Object.assign(new Error("closed"), { code: "ORDER_LOCKED" }); },
      sendConfirmation: async () => ({ sent: false, reason: "missing_phone" }),
    },
  });
  assert.deepEqual(result.payment, { ok: false, code: "ORDER_LOCKED", message: "closed" });
  assert.deepEqual(result.confirmation, { ok: false, code: "missing_phone" });
});
