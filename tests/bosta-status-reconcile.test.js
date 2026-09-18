import test from "node:test";
import assert from "node:assert/strict";

import { listStaleBostaShipments, reconcileStaleBostaShipments, bostaReconcileEnabled } from "../server/modules/shipping/bosta.reconcile.js";

/*
 * The safety net under the Bosta webhook. It runs unattended, calls another company's
 * API and sends customers messages — so what it picks up, and what it refuses to touch,
 * is worth pinning.
 */

const makeClient = (rows = []) => {
  const calls = [];
  return { calls, query: async (sql, params = []) => { calls.push({ sql, params }); return { rows }; } };
};

test("only live parcels are asked about, and only stale ones", async () => {
  const client = makeClient();
  await listStaleBostaShipments({ staleMinutes: 45, limit: 20, client });
  const { sql, params } = client.calls[0];
  assert.match(sql, /shipping_provider, ''\)\) = 'bosta'/);
  assert.match(sql, /deleted_at IS NULL/);
  assert.match(sql, /cancelled_at IS NULL/);
  assert.match(sql, /shipping_last_synced_at, last_shipping_sync_at, created_at\) < NOW\(\)/);
  const statuses = params[0];
  for (const ending of ["delivered", "returned", "cancelled"]) {
    assert.ok(!statuses.includes(ending), `${ending} is an ending, not a parcel still moving`);
  }
  for (const live of ["out_for_delivery", "in_transit", "failed_delivery"]) {
    assert.ok(statuses.includes(live), `${live} must be chased`);
  }
  assert.equal(params[2], "45");
  assert.equal(params[3], 20);
});

test("one unreachable parcel never stops the rest", async () => {
  const rows = [
    { id: 1, shipment_status: "in_transit" },
    { id: 2, shipment_status: "in_transit" },
    { id: 3, shipment_status: "in_transit" },
  ];
  const seen = [];
  const refresh = async (orderId) => {
    seen.push(orderId);
    if (orderId === 2) throw Object.assign(new Error("Bosta timed out"), { code: "BOSTA_UNREACHABLE" });
    return { order: { shipment_status: orderId === 1 ? "out_for_delivery" : "in_transit" } };
  };
  const summary = await reconcileStaleBostaShipments({ refresh, client: makeClient(rows) });
  assert.deepEqual(seen, [1, 2, 3], "the loop carried on past the failure");
  assert.equal(summary.checked, 3);
  assert.equal(summary.updated, 1);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.changes, [{ order_id: 1, from: "in_transit", to: "out_for_delivery" }]);
});

test("it stays off outside production unless it is switched on by hand", () => {
  const original = { env: process.env.NODE_ENV, flag: process.env.BOSTA_STATUS_RECONCILE_ENABLED };
  try {
    delete process.env.BOSTA_STATUS_RECONCILE_ENABLED;
    process.env.NODE_ENV = "development";
    // A dev machine often points at a database holding the LIVE Bosta key; a refresh
    // there would message real customers on a timer.
    assert.equal(bostaReconcileEnabled(), false);
    process.env.NODE_ENV = "production";
    assert.equal(bostaReconcileEnabled(), true);
    process.env.BOSTA_STATUS_RECONCILE_ENABLED = "false";
    assert.equal(bostaReconcileEnabled(), false, "the flag overrides production too");
    process.env.NODE_ENV = "development";
    process.env.BOSTA_STATUS_RECONCILE_ENABLED = "true";
    assert.equal(bostaReconcileEnabled(), true);
  } finally {
    process.env.NODE_ENV = original.env;
    if (original.flag === undefined) delete process.env.BOSTA_STATUS_RECONCILE_ENABLED;
    else process.env.BOSTA_STATUS_RECONCILE_ENABLED = original.flag;
  }
});
