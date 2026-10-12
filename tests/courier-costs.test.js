import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assignShipmentsToPackages, packageUnitCost, pickupFeeFor } from "../server/modules/shipping/shipping.costs.service.js";

// A 2,000 EGP package of 20 shipments is 100 per shipment, and the units of any package
// add back up to its price to the piastre — otherwise the expenses drift from the money paid.
test("package units cost price / count and always sum to the price", () => {
  const units = Array.from({ length: 20 }, (_, i) => packageUnitCost(2000, 20, i + 1));
  assert.ok(units.every((unit) => unit === 100));
  const odd = [1, 2, 3].map((n) => packageUnitCost(100, 3, n));
  assert.equal(Math.round(odd.reduce((a, b) => a + b, 0) * 100) / 100, 100);
  assert.deepEqual(odd, [33.33, 33.34, 33.33]);
});

// Bosta charges a flat 70 when a pickup carries fewer than 3 parcels.
test("small pickups cost the flat fee, full pickups cost nothing", () => {
  const settings = { pickup_min_parcels: 3, pickup_small_fee: 70 };
  assert.equal(pickupFeeFor(1, settings), 70);
  assert.equal(pickupFeeFor(2, settings), 70);
  assert.equal(pickupFeeFor(3, settings), 0);
  assert.equal(pickupFeeFor(12, settings), 0);
  assert.equal(pickupFeeFor(0, settings), 0);
  assert.equal(pickupFeeFor(1, { pickup_min_parcels: 3, pickup_small_fee: 0 }), 0);
});

test("shipments draw from the oldest package, never from one bought after them", () => {
  const packages = [
    { id: 1, purchased_at: "2026-10-01T10:00:00Z", shipments_count: 2, used: 0 },
    { id: 2, purchased_at: "2026-10-10T10:00:00Z", shipments_count: 20, used: 0 },
  ];
  const shipments = [
    { id: 100, shipped_at: "2026-09-30T10:00:00Z" }, // before every package — paid some other way
    { id: 101, shipped_at: "2026-10-02T10:00:00Z" },
    { id: 102, shipped_at: "2026-10-03T10:00:00Z" },
    { id: 103, shipped_at: "2026-10-05T10:00:00Z" }, // package 1 is empty, package 2 not bought yet
    { id: 104, shipped_at: "2026-10-10T08:00:00Z" }, // same Cairo day as package 2's purchase
  ];
  const result = assignShipmentsToPackages(shipments, packages);
  assert.deepEqual(result.map((row) => [row.order_id, row.package_id]), [[101, 1], [102, 1], [104, 2]]);
});

test("a package's already-used units are not handed out again", () => {
  const result = assignShipmentsToPackages(
    [{ id: 1, shipped_at: "2026-10-12T10:00:00Z" }, { id: 2, shipped_at: "2026-10-12T11:00:00Z" }],
    [{ id: 9, purchased_at: "2026-10-01T10:00:00Z", shipments_count: 20, used: 19 }]
  );
  assert.deepEqual(result.map((row) => row.order_id), [1]);
});

// The settlement's fee used to leave the bank as a money movement only; the P&L reads the
// expenses table, so Bosta's deductions never lowered the profit.
test("a settlement posts its fees as an expense and keeps Bosta's expected fees", () => {
  const source = readFileSync(new URL("../server/modules/shipping/shipping.settlements.service.js", import.meta.url), "utf8");
  assert.match(source, /postSettlementFeeExpense\(client,/);
  assert.match(source, /expected_fees_amount\)/);
});

test("creating and cancelling a Bosta shipment reconciles package consumption", () => {
  const source = readFileSync(new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8");
  assert.equal((source.match(/reconcileCourierCostsSoon\(/g) || []).length, 2);
});
