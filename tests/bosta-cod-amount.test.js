import test from "node:test";
import assert from "node:assert/strict";

import { orderCodAmount } from "../server/modules/shipping/shipping.service.js";

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
  // "promo_codes" contains "cod" as a letter run — it must not read as cash on delivery.
  assert.equal(orderCodAmount({ payment_method: "promo_codes", total_amount: 400 }), 0);
});
