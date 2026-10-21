import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deliverLocked, localCourierBlockReason } from "../server/modules/shipping/localCourier.js";
import { runPortalOrderAction } from "../server/modules/shipping/shipping.portal.actions.js";
import { portalOrderActionsFor } from "../src/shared/components/portalOnlineOrders/portalOrderActions.js";

/*
 * The shop's own motorcycle courier (owner, 2026-10-21): Damietta orders that never go to
 * Bosta stayed "confirmed" and owing forever, because only Bosta's delivered event ever closed
 * an order's money. Delivered with the courier must close the customer's balance in the same
 * transaction, and the cash then sits with the courier until it is handed into a drawer.
 */

test("only an order no courier has booked may go with the shop's courier", () => {
  assert.equal(localCourierBlockReason({ id: 1, status: "confirmed", shipping_provider: "in_store_delivery" }), "");
  assert.equal(localCourierBlockReason({ id: 1, status: "confirmed", shipping_provider: "local_courier" }), "");
  // The portal's new-order sheet writes "bosta" before any parcel exists.
  assert.equal(localCourierBlockReason({ id: 1, status: "confirmed", shipping_provider: "bosta" }), "");
  assert.equal(localCourierBlockReason({ id: 1, status: "confirmed", shipping_provider: "bosta", shipping_tracking_number: "6473852793" }), "OTHER_COURIER");
  assert.equal(localCourierBlockReason({ id: 1, status: "confirmed", shipping_provider: "jt" }), "OTHER_COURIER");
  assert.equal(localCourierBlockReason({ id: 1, status: "cancelled", shipping_provider: "" }), "ORDER_LOCKED");
  assert.equal(localCourierBlockReason({ id: 1, status: "confirmed", cancelled_at: "2026-10-20" }), "ORDER_LOCKED");
  assert.equal(localCourierBlockReason(null), "order_not_found");
});

const fakeClient = () => {
  const queries = [];
  return {
    queries,
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/UPDATE orders SET\s+status =/.test(sql)) {
        return { rowCount: 1, rows: [{ id: 5, total_amount: 1200, paid_amount: 0, cod_amount: 0, shipping_provider: "local_courier", shipping_status: "delivered" }] };
      }
      if (/courier_collected_at = COALESCE/.test(sql)) {
        return { rowCount: 1, rows: [{ id: 5, paid_amount: 1200, payment_status: "paid", courier_collected_amount: 1200 }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
};

test("delivered with the shop's courier closes the customer's balance in the same transaction", async () => {
  const client = fakeClient();
  const order = { id: 5, status: "confirmed", total_amount: 1200, paid_amount: 0, cod_amount: 0, shipping_provider: "in_store_delivery", shipping_status: "pending" };
  const outcome = await deliverLocked(client, order, { settings: { courier_name: "Ahmed" } });
  assert.equal(outcome.applied, true);
  assert.equal(outcome.collected, 1200);
  assert.equal(outcome.order.payment_status, "paid");
  const sqls = client.queries.map((entry) => entry.sql);
  assert.ok(sqls.some((sql) => /INSERT INTO shipping_events/.test(sql)), "the delivery is recorded as a shipping event");
  const collect = client.queries.find((entry) => /courier_collected_at = COALESCE/.test(entry.sql));
  assert.ok(collect, "the money is marked collected by the courier");
  assert.equal(collect.params[2], 1200);
  const statusWrite = client.queries.find((entry) => /UPDATE orders SET\s+status =/.test(entry.sql));
  assert.equal(statusWrite.params[2], "local_courier", "the order is now the shop courier's");
});

test("a delivered or Bosta-booked order is never delivered twice by the shop's courier", async () => {
  const delivered = await deliverLocked(fakeClient(), { id: 5, status: "confirmed", shipping_provider: "local_courier", shipping_status: "delivered" }, { settings: {} });
  assert.deepEqual(delivered, { applied: false, reason: "already_delivered" });
  const booked = await deliverLocked(fakeClient(), { id: 5, status: "confirmed", shipping_provider: "bosta", shipping_tracking_number: "1" }, { settings: {} });
  assert.equal(booked.reason, "OTHER_COURIER");
});

const orderIn = (group, extra = {}) => ({ id: 1, group, status: group === "confirmed" ? "confirmed" : "", shipping_status: "", ...extra, shipment: { provider: "", tracking_number: "", ...(extra.shipment || {}) } });

test("the board offers the shop's courier next to Bosta, then delivered / returned while he has it", () => {
  assert.ok(portalOrderActionsFor(orderIn("confirmed")).includes("local_courier_dispatch"));
  assert.ok(!portalOrderActionsFor(orderIn("confirmed", { shipment: { provider: "mylerz" } })).includes("local_courier_dispatch"));
  assert.deepEqual(portalOrderActionsFor(orderIn("shipping", { shipping_status: "out_for_delivery", shipment: { provider: "local_courier" } })), ["local_courier_delivered", "local_courier_returned"]);
  assert.ok(!portalOrderActionsFor(orderIn("shipping", { shipment: { provider: "bosta", tracking_number: "1" } })).includes("local_courier_delivered"));
});

test("the portal routes the courier's buttons to the courier's own paths", async () => {
  const calls = [];
  const loaded = (group) => ({ id: 9, group, status: "confirmed", order_number: "INV-9", shipment: { provider: "", tracking_number: "" } });
  const deps = (group) => ({
    loadOrder: async () => loaded(group),
    dispatchWithLocalCourier: async (input) => { calls.push(["dispatch", input]); return {}; },
    markLocalCourierDelivered: async (input) => { calls.push(["delivered", input]); return { collected: 850 }; },
    markLocalCourierReturned: async (input) => { calls.push(["returned", input]); return {}; },
    audit: async () => {},
  });
  const actor = { id: 2, tenant_id: 3, full_name: "Mona" };
  await runPortalOrderAction({ actor, orderId: 9, action: "local_courier_dispatch", deps: deps("confirmed") });
  const result = await runPortalOrderAction({ actor, orderId: 9, action: "local_courier_delivered", deps: deps("shipping") });
  assert.equal(result.collected, 850);
  await runPortalOrderAction({ actor, orderId: 9, action: "local_courier_returned", deps: deps("shipping") });
  assert.deepEqual(calls.map(([name]) => name), ["dispatch", "delivered", "returned"]);
  assert.equal(calls[0][1].tenantId, 3);
  await assert.rejects(
    runPortalOrderAction({ actor, orderId: 9, action: "local_courier_dispatch", deps: deps("new") }),
    (error) => error.code === "ORDER_NOT_CONFIRMED"
  );
});

test("the shop courier's cash never settles as a Bosta bank transfer, and the old shipment button closes the money", () => {
  const settlements = readFileSync(new URL("../server/modules/shipping/shipping.settlements.service.js", import.meta.url), "utf8");
  assert.match(settlements, /=== "local_courier"\);\s*\n\s*if \(localParcels\.length\)/);
  const controller = readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
  assert.match(controller, /providerKey === "local_courier"[\s\S]{0,400}markLocalCourierDelivered/);
});

test("a hand-in splits across cash, InstaPay and card, and the split must add up to the net", async () => {
  const { normalizeHandInPayments } = await import("../server/modules/shipping/localCourier.js");
  // Nothing typed: the whole net is cash for the drawer.
  assert.deepEqual(normalizeHandInPayments(null, 1105), { cash: 1105, instapay: 0, card: 0 });
  assert.deepEqual(normalizeHandInPayments({ cash: 400, instapay: 505, card: 200 }, 1105), { cash: 400, instapay: 505, card: 200 });
  assert.throws(() => normalizeHandInPayments({ cash: 400, instapay: 505, card: 0 }, 1105), (error) => error.code === "PAYMENTS_MISMATCH");
  assert.throws(() => normalizeHandInPayments({ cash: -5, instapay: 1110, card: 0 }, 1105), (error) => error.code === "INVALID_PAYMENTS");
});

test("only cash goes through the drawer shift; InstaPay and card land on their mapped accounts", () => {
  const source = readFileSync(new URL("../server/modules/shipping/localCourier.js", import.meta.url), "utf8");
  assert.match(source, /if \(split\.cash > 0\) \{\s*await recordCashDrawerEvent\([\s\S]{0,500}amount: split\.cash/);
  assert.match(source, /for \(const method of \["instapay", "card"\]\)[\s\S]{0,300}recordFinancialAccountActivity\([\s\S]{0,300}paymentMethod: method/);
});
