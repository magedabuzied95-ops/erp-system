import test from "node:test";
import assert from "node:assert/strict";

process.env.BUSINESS_MODE = "wholesale";
const { computeShipment } = await import("../../server/modules/wholesale/wholesale.imports.js");

test("landed cost: goods at the real transfer rate + costs spread equally per piece", () => {
  const summary = computeShipment({
    shipment: { booking_rate: 48 },
    lines: [
      { pieces: 100, unit_foreign: 5 },
      { pieces: 300, unit_foreign: 2 },
    ],
    // 1,100 USD of goods paid in two transfers: 600 by agent at 50, 500 cash at 49 + 500 EGP fees.
    transfers: [
      { foreign_amount: 600, egp_amount: 30000, fees_egp: 0 },
      { foreign_amount: 500, egp_amount: 24500, fees_egp: 500 },
    ],
    costs: [{ amount_egp: 6000 }, { amount_egp: 2000 }],
  });
  assert.equal(summary.goods_foreign, 1100);
  assert.equal(summary.pieces, 400);
  assert.equal(summary.paid_egp, 55000);
  assert.equal(summary.effective_rate, 50);
  assert.equal(summary.goods_egp, 55000);
  assert.equal(summary.extra_per_piece, 20, "8,000 EGP of costs over 400 pieces");
  assert.equal(summary.lines[0].landed_unit, 270, "5 USD x 50 + 20");
  assert.equal(summary.lines[1].landed_unit, 120, "2 USD x 50 + 20");
  assert.equal(summary.booked_egp, 52800);
  assert.equal(summary.fx_loss, 2200, "paid 55,000 for goods booked at 52,800");
  assert.equal(summary.fully_paid, true);
});

test("unpaid remainder is estimated at the booking rate; overpayment stays with the agent", () => {
  const partial = computeShipment({
    shipment: { booking_rate: 7 },
    lines: [{ pieces: 1000, unit_foreign: 10 }],
    transfers: [{ foreign_amount: 4000, egp_amount: 30000, fees_egp: 0 }],
    costs: [],
  });
  assert.equal(partial.remaining_foreign, 6000);
  assert.equal(partial.remaining_egp_estimate, 42000);
  assert.equal(partial.goods_egp, 72000);
  assert.equal(partial.fx_loss, 2000);

  const over = computeShipment({
    shipment: { booking_rate: 50 },
    lines: [{ pieces: 10, unit_foreign: 10 }],
    transfers: [{ foreign_amount: 150, egp_amount: 7500, fees_egp: 0 }],
    costs: [],
  });
  assert.equal(over.overpaid_foreign, 50);
  assert.equal(over.overpaid_egp, 2500);
  assert.equal(over.goods_egp, 5000);
});
