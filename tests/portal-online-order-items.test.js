import test from "node:test";
import assert from "node:assert/strict";

import { orderShippingFee, planPortalOrderItems } from "../server/modules/shipping/shipping.portal.items.js";
import { editPortalOnlineOrder } from "../server/modules/shipping/shipping.portal.manage.js";

// Editing what is inside an online order from the manager portal (owner request
// 2026-10-19). The plan is what editOrder's line path receives, so what must hold is:
// prices come from the order or the price authority, stock is checked against what the
// order already holds, the shipping fee and the seller's discount survive, nothing is
// "collected" on the phone, and a lower total than what was paid is refused.

const order = {
  id: 88,
  group: "confirmed",
  shipment: { tracking_number: "", delivery_id: "" },
  money: { total: 1150 },
  items: [
    { id: 501, product_id: 7, variant_id: 70, product_name: "Runner", color: "Black", size: "42", quantity: 1, unit_price: 1000, returned_quantity: 0 },
  ],
};
// An inbox order: the fee lives in shipping_cost, service_fee is 0.
const raw = { shipping_cost: 70, shipping_fee: 70, service_fee: 0, invoice_discount_type: "percent", invoice_discount_value: 10, invoice_discount_amount: 100, coupon_discount_amount: 0, tax_amount: 0, paid_amount: 0 };
const variants = new Map([
  [70, { variant_id: 70, product_id: 7, product_name: "Runner", color: "Black", size: "42", stock: 0, sku: "R-42" }],
  [71, { variant_id: 71, product_id: 7, product_name: "Runner", color: "Black", size: "43", stock: 2, sku: "R-43" }],
  [90, { variant_id: 90, product_id: 9, product_name: "Slide", color: "White", size: "40", stock: 5, sku: "S-40" }],
]);
const priceOf = (row) => ({ 70: 1100, 71: 1100, 90: 400 })[row.variant_id];
const plan = (overrides = {}) => planPortalOrderItems({ order, raw, variantsById: variants, priceOf, lines: [{ order_item_id: 501, variant_id: 70, quantity: 1 }], ...overrides });

test("a kept line keeps the price it was sold at; a new or swapped line takes the authority's price", () => {
  const result = plan({ lines: [{ order_item_id: 501, variant_id: 70, quantity: 1 }, { variant_id: 90, quantity: 2 }] });
  assert.deepEqual(result.body.items.map((item) => [item.variant_id, item.price, item.quantity]), [[70, 1000, 1], [90, 400, 2]]);
  const swapped = plan({ lines: [{ order_item_id: 501, variant_id: 71, quantity: 1 }] });
  assert.equal(swapped.body.items[0].price, 1100, "a size swap is a new line, priced as one");
  const typed = plan({ lines: [{ order_item_id: 501, variant_id: 70, quantity: 1, unit_price: 950 }] });
  assert.equal(typed.body.items[0].price, 950, "the manager's typed unit price wins");
});

test("stock: what the order already holds comes back first", () => {
  // Variant 70 has 0 in stock but the order holds 1 — keeping it is fine, a second is not.
  assert.doesNotThrow(() => plan());
  assert.throws(() => plan({ lines: [{ order_item_id: 501, variant_id: 70, quantity: 2 }] }), { code: "OUT_OF_STOCK" });
  assert.throws(() => plan({ lines: [{ variant_id: 90, quantity: 6 }] }), { code: "OUT_OF_STOCK" });
  assert.throws(() => plan({ lines: [{ variant_id: 999, quantity: 1 }] }), { code: "VARIANT_NOT_FOUND" });
  assert.throws(() => plan({ lines: [] }), { code: "ITEMS_EMPTY" });
});

test("the shipping fee and the seller's discount survive; nothing is collected on the phone", () => {
  const result = plan({ lines: [{ order_item_id: 501, variant_id: 70, quantity: 1 }, { variant_id: 90, quantity: 1 }] });
  assert.equal(result.body.service_fee, 70, "an inbox order's fee is in shipping_cost — editOrder reads service_fee");
  assert.equal(result.body.invoice_discount_type, "percentage", "an untouched percent stays a percent of the new goods");
  assert.equal(result.body.invoice_discount_value, 10);
  assert.equal(result.body.discount_amount, 140);
  assert.equal(result.estimated_total, 1400 - 140 + 70);
  assert.equal(result.body.paid_amount, 0);
  assert.deepEqual(result.body.additional_payment_breakdown, []);
  assert.equal(result.body.payment_method, "deferred", "keeps the order's own COD / transfer method in editOrder");
  const typed = plan({ discountAmount: 50, shippingFee: 0 });
  assert.equal(typed.body.invoice_discount_type, "fixed");
  assert.equal(typed.body.discount_amount, 50);
  assert.equal(typed.body.service_fee, 0);
  assert.equal(typed.shipping_fee_changed, true);
  assert.throws(() => plan({ discountAmount: 5000 }), { code: "DISCOUNT_TOO_HIGH" });
});

test("untouched lines and money are not a change", () => {
  assert.equal(plan({ discountAmount: 100, shippingFee: 70 }).changed, false);
  assert.equal(plan({ lines: [{ order_item_id: 501, variant_id: 70, quantity: 1, unit_price: 1000 }] }).changed, false);
  assert.equal(orderShippingFee({ shipping_fee: 0, shipping_cost: 0, service_fee: 55 }), 55, "a till order keeps it in service_fee");
});

test("an old line with no colour/size (or no price) stays as it is; a new one needs both", () => {
  const legacy = { ...order, items: [...order.items, { id: 502, product_id: 3, variant_id: null, product_name: "Bag", quantity: 1, unit_price: 0, returned_quantity: 0 }] };
  const kept = plan({ order: legacy, lines: [{ order_item_id: 501, variant_id: 70, quantity: 1 }, { order_item_id: 502, variant_id: null, quantity: 1 }] });
  assert.deepEqual(kept.body.items[1], { ...kept.body.items[1], variant_id: null, price: 0, product_id: 3 });
  assert.equal(kept.changed, false);
  assert.throws(() => plan({ order: legacy, lines: [{ variant_id: null, quantity: 1 }] }), { code: "VARIANT_REQUIRED" });
});

test("a total below what the customer paid, or an order with a return, is refused", () => {
  assert.throws(() => planPortalOrderItems({ order, raw: { ...raw, paid_amount: 1100 }, variantsById: variants, priceOf, lines: [{ variant_id: 90, quantity: 1 }] }), { code: "REFUND_NEEDED" });
  assert.throws(() => plan({ order: { ...order, items: [{ ...order.items[0], returned_quantity: 1 }] } }), { code: "ORDER_HAS_RETURNS" });
});

test("the lines go to editOrder first, then the fields — with the new fee as shipping_cost", async () => {
  const calls = [];
  const deps = {
    loadOrder: async () => order,
    editHandler: async (req) => { calls.push(req.body); return { statusCode: 200, payload: { success: true } }; },
    appendTimeline: async () => {},
    audit: async () => {},
    loadMoneyRow: async () => ({ raw, lineDiscountByItemId: new Map() }),
    loadVariants: async () => variants,
    priceOf: async () => priceOf,
    saleModeEnabled: async () => false,
  };
  await editPortalOnlineOrder({
    actor: { id: 1, tenant_id: 4, full_name: "Omar" },
    orderId: 88,
    fields: { landmark: "near the mosque" },
    items: [{ order_item_id: 501, variant_id: 71, quantity: 1 }],
    money: { discount_amount: 100, shipping_fee: 50 },
    deps,
  });
  assert.equal(calls.length, 2);
  assert.ok(Array.isArray(calls[0].items), "lines first: the field patch then reads the new cod_amount");
  assert.equal(calls[0].service_fee, 50);
  assert.ok(!("items" in calls[1]));
  assert.equal(calls[1].landmark, "near the mosque");
  assert.equal(calls[1].shipping_cost, 50);

  calls.length = 0;
  await editPortalOnlineOrder({ actor: { tenant_id: 4 }, orderId: 88, fields: { landmark: "x" }, deps });
  assert.equal(calls.length, 1, "a fields-only edit never rewrites the lines");
  assert.ok(!("items" in calls[0]));
});
