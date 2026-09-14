import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { redeemCoupon, validateCoupon } from "../../server/services/couponsService.js";

// A fake transaction client that answers the handful of queries validate/redeem make. The orders
// look-up honours the "id IS DISTINCT FROM $2" exclusion exactly like Postgres would, so the test
// proves which order the service leaves out, not just that a parameter was sent.
const makeClient = ({ orders, redemptions = [], usageCount = 0, usageLimit = 1 }) => {
  const calls = [];
  const client = {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ text, params });
      if (/FROM coupons cp\s+JOIN coupon_campaigns/.test(text)) {
        return {
          rowCount: 1,
          rows: [{
            id: 11,
            campaign_id: 7,
            code: "WELCOME",
            usage_count: usageCount,
            usage_limit: usageLimit,
            is_active: true,
            campaign_is_active: true,
            campaign_name: "Welcome",
            discount_type: "percentage",
            discount_value: 10,
            minimum_order_amount: 0,
            channel: "all",
            scope: null,
            stack_policy: "all",
            budget_cap: null,
            usage_limit_per_customer: null,
            first_order_only: true,
            apply_to_single_item: false,
          }],
        };
      }
      if (/FROM orders\s+WHERE customer_id = \$1/.test(text)) {
        const [customerId, excluded] = params;
        const hits = orders.filter((order) => order.customer_id === customerId
          && !["cancelled", "canceled", "void"].includes(String(order.status || "").toLowerCase())
          && (excluded === null || excluded === undefined || order.id !== excluded));
        return { rowCount: hits.length ? 1 : 0, rows: hits.length ? [{ "?column?": 1 }] : [] };
      }
      if (/FROM coupon_redemptions WHERE coupon_id = \$1 AND order_id = \$2/.test(text)) {
        return { rowCount: 1, rows: [{ n: redemptions.filter((row) => row.order_id === params[1]).length }] };
      }
      if (/^\s*UPDATE coupons/.test(text)) return { rowCount: 1, rows: [{ id: 11, code: "WELCOME", usage_count: usageCount + 1 }] };
      if (/INSERT INTO coupon_redemptions/.test(text)) return { rowCount: 1, rows: [{ id: 1, order_id: params[3] }] };
      return { rowCount: 0, rows: [] };
    },
  };
  return client;
};

const redeemArgs = (client, orderId) => ({
  code: "WELCOME",
  orderId,
  customerId: 42,
  source: "website",
  orderTotal: 1000,
  items: [{ product_id: 1, price: 1000, quantity: 1 }],
  client,
});

test("a first-order coupon redeems on the order being placed when it is the customer's only order", async () => {
  // Checkout has already inserted order 900 inside the transaction before redeeming.
  const client = makeClient({ orders: [{ id: 900, customer_id: 42, status: "pending" }] });
  const result = await redeemCoupon(redeemArgs(client, 900));
  assert.equal(result.valid, true);
  assert.equal(result.discount_amount, 100);
});

test("a first-order coupon is still refused when the customer has another live order", async () => {
  const client = makeClient({
    orders: [
      { id: 500, customer_id: 42, status: "delivered" },
      { id: 900, customer_id: 42, status: "pending" },
    ],
  });
  await assert.rejects(redeemCoupon(redeemArgs(client, 900)), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.message, "Coupon is for first orders only");
    return true;
  });
});

test("a cancelled earlier order does not block the first-order coupon", async () => {
  const client = makeClient({
    orders: [
      { id: 500, customer_id: 42, status: "cancelled" },
      { id: 900, customer_id: 42, status: "pending" },
    ],
  });
  const result = await redeemCoupon(redeemArgs(client, 900));
  assert.equal(result.valid, true);
});

test("the current order id does not relax the usage limit the way an edit's excludeOrderId does", async () => {
  // Coupon already used once on order 900; redeeming it again on the same order must not pass.
  const client = makeClient({
    orders: [{ id: 900, customer_id: 42, status: "pending" }],
    redemptions: [{ order_id: 900 }],
    usageCount: 1,
    usageLimit: 1,
  });
  await assert.rejects(redeemCoupon(redeemArgs(client, 900)), /Coupon usage limit reached/);
  const validation = await validateCoupon({ ...redeemArgs(client, 900), currentOrderId: 900, lock: true });
  assert.equal(validation.reason, "Coupon usage limit reached");
});

test("every redeemCoupon caller hands over the order id it is redeeming on", () => {
  const callers = [
    "server/controllers/storefrontController.js",
    "server/controllers/ordersController.js",
    "server/controllers/couponsController.js",
  ];
  for (const file of callers) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const calls = [...source.matchAll(/await redeemCoupon\(\{([\s\S]*?)\}\);/g)];
    assert.ok(calls.length > 0, `${file} should call redeemCoupon`);
    for (const [, body] of calls) {
      assert.match(body, /\borderId\s*:/, `${file} must pass orderId to redeemCoupon`);
    }
  }
  const service = readFileSync(new URL("../../server/services/couponsService.js", import.meta.url), "utf8");
  const redeemBody = service.slice(service.indexOf("export const redeemCoupon"));
  assert.match(redeemBody.slice(0, 800), /validateCoupon\(\{[^}]*currentOrderId:\s*orderId/);
});
