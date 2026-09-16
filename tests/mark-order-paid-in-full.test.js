import test from "node:test";
import assert from "node:assert/strict";

import { markOrderPaidInFull } from "../server/modules/shipping/markOrderPaidInFull.js";

// A fake client: the order row, then whatever the approval and the stamp write.
const fakeClient = (row) => {
  const writes = [];
  let current = { ...row };
  return {
    writes,
    query: async (sql, params = []) => {
      if (/^\s*SELECT \* FROM orders/.test(sql)) return { rows: [current] };
      if (/SET payment_status = \$4/.test(sql)) {
        current = { ...current, status: "confirmed", payment_status: params[3], paid_amount: params[4], cod_amount: Number(current.total_amount) - params[4] };
        writes.push({ kind: "approve", paid: params[4] });
        return { rows: [current] };
      }
      if (/SET status = CASE/.test(sql)) {
        if (params[1]) current = { ...current, status: params[1] };
        writes.push({ kind: "stamp", keep: params[1], method: params[2], timeline: JSON.parse(params[3]) });
        return { rows: [current] };
      }
      return { rows: [] };
    },
  };
};

const base = { id: 5, tenant_id: null, status: "pending_confirmation", total_amount: 2590, shipping_fee: 90, paid_amount: 0, cod_amount: 2500, payment_method: "vodafone_cash" };

test("the whole order is paid and nothing is left for the courier", async () => {
  const client = fakeClient(base);
  const updated = await markOrderPaidInFull({ orderId: 5, method: "vodafone_cash", actorName: "Omar", source: "manager_portal", client });
  assert.equal(Number(updated.paid_amount), 2590);
  assert.equal(updated.cod_amount, 0);
  assert.equal(updated.payment_status, "paid");
  const stamp = client.writes.find((w) => w.kind === "stamp");
  assert.equal(stamp.timeline[0].action, "order_paid_in_full");
  assert.equal(stamp.method, "vodafone_cash");
});

test("an order already ready to ship is not moved back to confirmed", async () => {
  const client = fakeClient({ ...base, status: "ready_to_ship" });
  const updated = await markOrderPaidInFull({ orderId: 5, method: "cash", client });
  assert.equal(updated.status, "ready_to_ship");
});

test("refused once a parcel exists or the order is closed", async () => {
  await assert.rejects(markOrderPaidInFull({ orderId: 5, client: fakeClient({ ...base, tracking_number: "99" }) }), { code: "FULL_PAYMENT_AFTER_SHIPMENT" });
  await assert.rejects(markOrderPaidInFull({ orderId: 5, client: fakeClient({ ...base, status: "delivered" }) }), { code: "ORDER_LOCKED" });
});
