import test from "node:test";
import assert from "node:assert/strict";

import { orderCodAmount, orderOwedAmount, resolveBostaCollection } from "../server/modules/shipping/shipping.service.js";

// `cash_on_delivery` — what the POS and the AI inbox composer write — does not
// contain the substring "cod". The old check tested for that substring, so every
// one of those orders was read as prepaid and Bosta received cod: 0: the courier
// would deliver the parcel and collect nothing.
test("cash_on_delivery orders are collected on delivery", () => {
  assert.equal(orderCodAmount({ payment_method: "cash_on_delivery", paid_amount: 0, cod_amount: 0, total_amount: 1840 }), 1840);
  assert.equal(orderCodAmount({ payment_method: "Cash On Delivery", total_amount: 300 }), 300);
  assert.equal(orderCodAmount({ payment_method: "cash-on-delivery", total_amount: 300 }), 300);
  assert.equal(orderCodAmount({ payment_status: "cash_on_delivery", total_amount: 120 }), 120);
});

test("the legacy cod spelling still works", () => {
  assert.equal(orderCodAmount({ payment_method: "cod", total_amount: 500 }), 500);
  assert.equal(orderCodAmount({ payment_method: "COD", total_amount: 500 }), 500);
});

test("the courier collects only what is still owed", () => {
  assert.equal(orderCodAmount({ payment_method: "cash_on_delivery", paid_amount: 200, total_amount: 900 }), 700);
  assert.equal(orderCodAmount({ payment_method: "cash_on_delivery", paid_amount: 999, total_amount: 900 }), 0);
});

test("an explicitly recorded collection amount wins over the order total", () => {
  assert.equal(orderCodAmount({ payment_method: "cash_on_delivery", cod_amount: 250, total_amount: 900 }), 250);
  assert.equal(orderCodAmount({ payment_method: "visa", cod_amount: 120, total_amount: 700 }), 120);
});

test("prepaid orders are never turned into a collection", () => {
  assert.equal(orderCodAmount({ payment_method: "instapay", paid_amount: 1050, total_amount: 1050 }), 0);
  assert.equal(orderCodAmount({ payment_method: "visa", total_amount: 700 }), 0);
  assert.equal(orderCodAmount({ payment_method: "vodafone_cash", total_amount: 700 }), 0);
  assert.equal(orderCodAmount({ payment_status: "paid", total_amount: 700 }), 0);
});

// This used to assert 0, on the reasoning that "promo_codes" only *looks* like cod.
// That half was right and still holds — it is not read as cash on delivery — but
// falling through to "prepaid, collect nothing" is the defect itself: an unpaid
// order with an unrecognised method is money the courier has to bring back.
test("an unrecognised payment method still collects what is owed", () => {
  assert.equal(orderCodAmount({ payment_method: "promo_codes", total_amount: 400 }), 400);
  assert.equal(orderCodAmount({ payment_method: "", total_amount: 400 }), 400);
  assert.equal(orderCodAmount({ total_amount: 400 }), 400);
});

// The AI inbox writes "pending" on a single-product draft. Reading that as prepaid
// is how a shipment reached Bosta with cod: 0 while the customer owed the full 1,490.
test("an AI draft and a credit sale are unpaid orders, not prepaid ones", () => {
  assert.equal(orderCodAmount({ payment_method: "pending", payment_status: "unpaid", total_amount: 1490 }), 1490);
  assert.equal(orderCodAmount({ payment_method: "credit", payment_status: "unpaid", total_amount: 1490 }), 1490);
  assert.equal(orderCodAmount({ payment_method: "deferred", total_amount: 300, paid_amount: 100 }), 200);
});

// Prepaid shipping plus cash for the goods: the method reads "instapay", but part of
// the money is already recorded, so the balance is still collected at the door.
test("a part payment is collected on delivery whatever the method is called", () => {
  assert.equal(orderCodAmount({ payment_method: "instapay", payment_status: "shipping_paid", total_amount: 1540, paid_amount: 50 }), 1490);
  assert.equal(resolveBostaCollection({ order: { payment_method: "instapay", total_amount: 1540, paid_amount: 50 } }).blocked, false);
});

test("what is owed is read from the money columns, not the denormalized mirror", () => {
  assert.equal(orderOwedAmount({ total_amount: 900, paid_amount: 200, remaining_amount: 0 }), 700);
  assert.equal(orderOwedAmount({ total_amount: 900, paid_amount: 900 }), 0);
  // Only when there is no total to work from does the mirror answer.
  assert.equal(orderOwedAmount({ remaining_amount: 450 }), 450);
});

test("an unpaid order marked prepaid is blocked instead of shipping with nothing to collect", () => {
  const blocked = resolveBostaCollection({ order: { payment_method: "visa", total_amount: 700, paid_amount: 0 } });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.amount, 0);
  assert.equal(blocked.owed, 700);
});

test("a settled order ships with nothing to collect", () => {
  const settled = resolveBostaCollection({ order: { payment_method: "instapay", total_amount: 700, paid_amount: 700 } });
  assert.equal(settled.blocked, false);
  assert.equal(settled.amount, 0);
  assert.equal(settled.source, "settled");
});

test("the operator's amount overrides the rule, including an explicit zero", () => {
  const override = resolveBostaCollection({ order: { payment_method: "cash_on_delivery", total_amount: 900 }, override: 250 });
  assert.equal(override.amount, 250);
  assert.equal(override.source, "operator");

  const zero = resolveBostaCollection({ order: { payment_method: "visa", total_amount: 700, paid_amount: 0 }, override: 0 });
  assert.equal(zero.blocked, false);
  assert.equal(zero.amount, 0);

  // An untouched field is not a decision: an empty override falls back to the rule.
  const untouched = resolveBostaCollection({ order: { payment_method: "cash_on_delivery", total_amount: 900 }, override: "" });
  assert.equal(untouched.amount, 900);
});
