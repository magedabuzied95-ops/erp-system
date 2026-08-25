import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { reverseOrderLoyaltyForReturn } from "../server/services/loyaltyService.js";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

// A pg client that remembers just enough to prove the claw-back arithmetic:
// what the order earned, what has already been taken back, and the customer balance.
const makeClient = ({ earned = 0, reversed = 0, balance = 0, spent = 0, orders = 0 } = {}) => {
  const state = { earned, reversed, balance, spent, orders, history: [], transactions: [] };

  return {
    state,
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes("reason = 'order_earned'")) {
        return { rows: state.earned > 0 ? [{ source: "pos", points_change: state.earned }] : [] };
      }
      if (text.includes("SUM(ABS(points_change))")) {
        return { rows: [{ points: state.reversed }] };
      }
      if (text.includes("FROM customers") && text.includes("FOR UPDATE")) {
        return {
          rows: [{ loyalty_points: state.balance, total_spent: state.spent, total_orders: state.orders }],
        };
      }
      if (text.includes("INSERT INTO customer_loyalty_history")) {
        const reason = params[6];
        // ON CONFLICT DO NOTHING: the same return can only be booked once.
        if (state.history.some((row) => row.reason === reason)) return { rows: [] };
        const row = {
          order_id: params[2],
          source: params[3],
          points_change: Number(params[4]),
          balance_after: Number(params[5]),
          reason,
        };
        state.history.push(row);
        state.reversed += Math.abs(row.points_change);
        return { rows: [row] };
      }
      if (text.includes("INSERT INTO loyalty_transactions")) {
        state.transactions.push({ points: Number(params[3]), amount_value: Number(params[4]) });
        return { rows: [] };
      }
      if (text.trim().startsWith("UPDATE") && text.includes("customers")) {
        state.balance = Number(params[0]);
        state.tier = params[1];
        state.spent = Number(params[2]);
        state.orders = Number(params[3]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
};

const returnArgs = (overrides = {}) => ({
  tenantId: 1,
  orderId: 501,
  returnId: 900,
  customerId: 77,
  refundAmount: 300,
  orderTotal: 1200,
  fullyReturned: false,
  userId: 5,
  ...overrides,
});

test("a partial return takes back its share of the order's points", async () => {
  const client = makeClient({ earned: 120, balance: 200, spent: 5000, orders: 3 });

  const result = await reverseOrderLoyaltyForReturn(client, returnArgs());

  assert.equal(result.reversed, true);
  assert.equal(result.pointsReversed, 30, "a quarter of the money back is a quarter of the points back");
  assert.equal(client.state.balance, 170);
  assert.equal(client.state.spent, 4700, "lifetime spend drops by the refunded money");
  assert.equal(client.state.orders, 3, "a partial return does not un-count the order");
  assert.equal(client.state.transactions[0].points, -30);
});

test("a full return takes back everything the order still has standing", async () => {
  const client = makeClient({ earned: 120, reversed: 30, balance: 170, spent: 4700, orders: 3 });

  const result = await reverseOrderLoyaltyForReturn(
    client,
    returnArgs({ returnId: 901, refundAmount: 900, fullyReturned: true })
  );

  assert.equal(result.pointsReversed, 90, "the 30 already clawed back are not taken twice");
  assert.equal(client.state.balance, 80, "the order's 120 points are fully gone");
  assert.equal(client.state.orders, 2, "a fully returned order stops counting");
});

test("returning the whole order in one go strips all of its points", async () => {
  const client = makeClient({ earned: 120, balance: 200, spent: 5000, orders: 3 });

  const result = await reverseOrderLoyaltyForReturn(
    client,
    returnArgs({ refundAmount: 1200, fullyReturned: true })
  );

  assert.equal(result.pointsReversed, 120);
  assert.equal(client.state.balance, 80);
});

test("the same return cannot claw the points back twice", async () => {
  const client = makeClient({ earned: 120, balance: 200, spent: 5000, orders: 3 });

  await reverseOrderLoyaltyForReturn(client, returnArgs());
  const replay = await reverseOrderLoyaltyForReturn(client, returnArgs());

  assert.equal(replay.reversed, false);
  assert.equal(replay.duplicate, true);
  assert.equal(client.state.balance, 170, "the balance moved once, not twice");
});

test("two separate partial returns each take their own share", async () => {
  const client = makeClient({ earned: 120, balance: 200, spent: 5000, orders: 3 });

  await reverseOrderLoyaltyForReturn(client, returnArgs({ returnId: 900, refundAmount: 300 }));
  await reverseOrderLoyaltyForReturn(client, returnArgs({ returnId: 901, refundAmount: 600 }));

  assert.equal(client.state.balance, 110, "30 then 60 points come off the same order");
});

test("the claw-back never pushes a balance below zero", async () => {
  const client = makeClient({ earned: 120, balance: 10, spent: 100, orders: 1 });

  await reverseOrderLoyaltyForReturn(client, returnArgs({ refundAmount: 1200, fullyReturned: true }));

  assert.equal(client.state.balance, 0);
  assert.equal(client.state.spent, 0);
});

test("a return on an order that never earned points changes nothing", async () => {
  const client = makeClient({ earned: 0, balance: 200, spent: 5000, orders: 3 });

  const result = await reverseOrderLoyaltyForReturn(client, returnArgs());

  assert.equal(result.reversed, false);
  assert.equal(result.reason, "no_points_to_reverse");
  assert.equal(client.state.balance, 200);
  assert.equal(client.state.history.length, 0);
});

test("cancelling an order after a partial return only takes the rest", async () => {
  const { reverseOrderLoyalty } = await import("../server/services/loyaltyService.js");
  const client = makeClient({ earned: 120, reversed: 30, balance: 170, spent: 4700, orders: 3 });

  const result = await reverseOrderLoyalty(client, {
    id: 501,
    tenant_id: 1,
    customer_id: 77,
    total_amount: 1200,
    status: "cancelled",
  });

  assert.equal(result.pointsReversed, 90);
  assert.equal(client.state.balance, 80);
});

test("both return endpoints claw the points back", async () => {
  const source = await readSource("server/controllers/ordersController.js");

  const returnOrderSource = source.slice(
    source.indexOf("export const returnOrder"),
    source.indexOf("export const getReturns") > -1
      ? source.indexOf("export const getReturns")
      : source.indexOf("export const createReturn")
  );
  const createReturnSource = source.slice(source.indexOf("export const createReturn"));

  assert.match(returnOrderSource, /reverseOrderLoyaltyForReturn\(/);
  assert.match(createReturnSource, /reverseOrderLoyaltyForReturn\(/);
  assert.doesNotMatch(
    returnOrderSource,
    /if \(paymentStatus === "refunded"\) \{\s*await reverseOrderLoyalty\(/,
    "a partial return must not skip the claw-back"
  );
});
