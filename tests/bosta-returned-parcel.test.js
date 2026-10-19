import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { receiveReturnedBostaParcel, returnedParcelSkipReason, RETURNED_TO_STORE_REASON } from "../server/modules/shipping/bostaReturnedParcel.js";
import { listStaleBostaShipments } from "../server/modules/shipping/bosta.reconcile.js";

/*
 * A parcel Bosta brings back is the sale undone (owner, 2026-10-19, INV-2074): the order
 * is cancelled through the ERP's own cancelOrder — stock back on the shelf — and the
 * return is stamped with its date. Before this the courier's "returned" only moved
 * shipping_status and the card kept saying "جاهز للشحن".
 */

const fakeDeps = (statusCode = 200) => {
  const calls = { cancel: [], stamp: [] };
  return {
    calls,
    deps: {
      cancelHandler: async (req) => { calls.cancel.push(req); return { statusCode, payload: { success: statusCode < 400, message: "x", order: { id: 7 } } }; },
      stamp: async (input) => { calls.stamp.push(input); },
    },
  };
};

test("a returned parcel cancels the order through cancelOrder and stamps the date", async () => {
  const { calls, deps } = fakeDeps();
  const result = await receiveReturnedBostaParcel(
    { id: 7, tenant_id: 3, status: "ready_to_ship", shipping_status: "returned" },
    { source: "bosta_webhook", at: "2026-10-19T10:00:00.000Z", deps }
  );
  assert.equal(result.received, true);
  assert.equal(calls.cancel.length, 1);
  const req = calls.cancel[0];
  assert.equal(req.params.id, "7");
  assert.equal(req.body.reason, RETURNED_TO_STORE_REASON);
  assert.equal(req.user.tenant_id, 3);
  assert.notEqual(req.user.role, "super_admin", "a super admin would unscope the tenant");
  assert.deepEqual(calls.stamp, [{ orderId: 7, at: "2026-10-19T10:00:00.000Z", source: "bosta_webhook" }]);
});

test("never twice, and never an order that is already closed", () => {
  assert.equal(returnedParcelSkipReason({ id: 1, cancelled_at: "2026-10-01" }), "already_cancelled");
  assert.equal(returnedParcelSkipReason({ id: 1, status: "cancelled" }), "already_cancelled");
  assert.equal(returnedParcelSkipReason({ id: 1, stock_restored_at: "2026-10-01" }), "stock_already_restored");
  assert.equal(returnedParcelSkipReason({ id: 1, deleted_at: "2026-10-01" }), "deleted");
  assert.equal(returnedParcelSkipReason({ id: 1, status: "delivered" }), "order_closed");
  assert.equal(returnedParcelSkipReason({ id: 1, ai_agent_metadata: { exchange: { return_id: 9, return_lines: [{ product_name: "x", quantity: 1 }] } } }), "exchange_parcel");
  assert.equal(returnedParcelSkipReason({ id: 1, status: "ready_to_ship" }), "");
});

test("a refused cancel stamps nothing", async () => {
  const { calls, deps } = fakeDeps(400);
  const result = await receiveReturnedBostaParcel({ id: 7, status: "confirmed" }, { deps });
  assert.equal(result.received, false);
  assert.equal(calls.stamp.length, 0);
});

test("both Bosta paths receive a returned parcel, and a cancelled shipment may still come back", () => {
  const source = readFileSync(new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8");
  assert.match(source, /status === "returned"\) \{\s*const received = await receiveReturnedBostaParcel\(updatedOrder, \{ source: "bosta_refresh" \}\)/);
  assert.match(source, /parsed\.status === "returned"\) \{\s*void receiveReturnedBostaParcel\(updatedOrder, \{ source: "bosta_webhook"/);
  assert.match(source, /parcelComingBack = parsed\.status === "returned" && shippingStatus === "cancelled"/);
  assert.match(source, /shippingStatus === "cancelled" && !parcelComingBack/);
});

test("the reconcile keeps chasing a cancelled parcel until the order is received", async () => {
  const calls = [];
  await listStaleBostaShipments({ client: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } } });
  const { sql, params } = calls[0];
  assert.match(sql, /cancelled_at IS NULL/);
  assert.match(sql, /= ANY\(\$5::text\[\]\)/);
  assert.ok(params[4].includes("cancelled") && params[4].includes("returned"));
});
