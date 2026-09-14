import test from "node:test";
import assert from "node:assert/strict";

import { resolveCodPolicy, resolveGovernorateId, normalizeCodPolicy } from "../shared/codPolicy.js";
import { resolveShippingFeeGate } from "../server/modules/shipping/shipping.service.js";
import { applyTransferPaymentConfirmation } from "../server/modules/walletTransfers/transferPaymentConfirmation.js";

const restricted = { mode: "restricted", governorates: ["damietta"] };

test("governorate names in either language resolve to the catalog id", () => {
  assert.equal(resolveGovernorateId("دمياط"), "damietta");
  assert.equal(resolveGovernorateId("Damietta"), "damietta");
  assert.equal(resolveGovernorateId("محافظة دمياط"), "damietta");
  assert.equal(resolveGovernorateId("", "الإسكندرية"), "alexandria");
  assert.equal(resolveGovernorateId("اسكندريه"), "alexandria");
  assert.equal(resolveGovernorateId("طنطا"), "");
  // Bosta's picker labels
  for (const [label, id] of [["القليوبيه", "qalyubia"], ["El Kalioubia", "qalyubia"], ["بور سعيد", "port-said"], ["Bani Suif", "beni-suef"], ["مرسي مطروح", "matrouh"], ["Kafr Alsheikh", "kafr-el-sheikh"]]) {
    assert.equal(resolveGovernorateId(label), id, label);
  }
});

test("the open system keeps cash on delivery everywhere and transfers the whole order", () => {
  const cod = resolveCodPolicy({ policy: { mode: "open" }, governorate: "القاهرة", shippingFee: 90, orderTotal: 1940 });
  assert.equal(cod.cod_allowed, true);
  assert.equal(cod.advance, "order_total");
  assert.equal(cod.advance_amount, 1940);
});

test("an unset mode is the open system, and an unset list is Damietta", () => {
  assert.deepEqual(normalizeCodPolicy({}), { mode: "open", governorates: ["damietta"] });
});

test("the restricted system: Damietta keeps COD, everyone else prepays the shipping fee only", () => {
  const damietta = resolveCodPolicy({ policy: restricted, governorate: "دمياط", shippingFee: 45, orderTotal: 1000 });
  assert.equal(damietta.cod_allowed, true);
  const cairo = resolveCodPolicy({ policy: restricted, governorate: "Cairo", shippingFee: 90, orderTotal: 1940 });
  assert.equal(cairo.cod_allowed, false);
  assert.equal(cairo.advance, "shipping_fee");
  assert.equal(cairo.advance_amount, 90);
});

test("more governorates can be added to the COD list", () => {
  const cod = resolveCodPolicy({ policy: { mode: "restricted", governorates: ["damietta", "port-said"] }, governorate: "بورسعيد", shippingFee: 60, orderTotal: 500 });
  assert.equal(cod.cod_allowed, true);
});

test("nothing to prepay (free shipping) leaves cash on delivery available", () => {
  const cod = resolveCodPolicy({ policy: restricted, governorate: "Cairo", shippingFee: 0, orderTotal: 1940 });
  assert.equal(cod.cod_allowed, true);
});

test("an unknown governorate fails closed", () => {
  const cod = resolveCodPolicy({ policy: restricted, governorate: "somewhere", shippingFee: 60, orderTotal: 500 });
  assert.equal(cod.cod_allowed, false);
});

test("the shipment gate blocks an unpaid shipping fee outside the COD list, whatever the channel", () => {
  const order = { governorate: "القاهرة", shipping_fee: 90, total_amount: 1940, paid_amount: 0, payment_method: "cash_on_delivery" };
  assert.equal(resolveShippingFeeGate({ order, policy: restricted }).blocked, true);
  assert.equal(resolveShippingFeeGate({ order, policy: { mode: "open" } }).blocked, false);
  assert.equal(resolveShippingFeeGate({ order: { ...order, governorate: "دمياط" }, policy: restricted }).blocked, false);
});

test("a shipping-fee transfer still waiting on review does not open the gate; an approved one does", () => {
  const order = { governorate: "Cairo", shipping_fee: 90, total_amount: 1940, paid_amount: 90, payment_method: "instapay", transfer_proof_status: "pending" };
  assert.equal(resolveShippingFeeGate({ order, policy: restricted }).blocked, true);
  assert.equal(resolveShippingFeeGate({ order: { ...order, transfer_proof_status: "approved" }, policy: restricted }).blocked, false);
});

test("the Bosta city name is enough when the order has no governorate text", () => {
  const order = { shipping_fee: 45, total_amount: 500, paid_amount: 0, payment_method: "cod" };
  assert.equal(resolveShippingFeeGate({ order, city: { name_en: "Damietta" }, policy: restricted }).blocked, false);
});

const fakeClient = () => {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/UPDATE orders/.test(sql)) return { rows: [{ id: params[0], tenant_id: null, payment_status: params[3], paid_amount: params[4] }] };
      return { rows: [] };
    },
  };
};

test("approving a shipping-fee transfer is a part payment, not the whole order", async () => {
  const client = fakeClient();
  await applyTransferPaymentConfirmation(client, {
    order: { id: 7, payment_method: "instapay", total_amount: 1940, shipping_fee: 90, paid_amount: 0, cod_amount: 1850 },
  });
  const update = client.calls.find((call) => /UPDATE orders/.test(call.sql));
  assert.equal(update.params[3], "partially_paid");
  assert.equal(update.params[4], 90);
  assert.match(update.sql, /cod_amount = GREATEST/);
});

test("approving a full transfer still pays the whole order", async () => {
  const client = fakeClient();
  await applyTransferPaymentConfirmation(client, {
    order: { id: 8, payment_method: "vodafone_cash", total_amount: 1940, shipping_fee: 90, paid_amount: 0, cod_amount: 0 },
  });
  const update = client.calls.find((call) => /UPDATE orders/.test(call.sql));
  assert.equal(update.params[3], "paid");
  assert.equal(update.params[4], 1940);
});

test("the address text decides, so another governorate's id cannot buy cash on delivery", () => {
  const cod = resolveCodPolicy({ policy: restricted, governorate: "القاهره", governorateId: "damietta", shippingFee: 90, orderTotal: 1940 });
  assert.equal(cod.cod_allowed, false);
});

test("checkout stores a shipping-fee transfer as unpaid with the goods left to collect", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  assert.match(source, /const codAmount = paymentMethod === "cod" \? total : isGatewayCheckout \? 0 : Math\.max\(0, roundMoney\(total - transferAmount\)\);/);
  assert.match(source, /if \(paymentMethod === "cod" && !codPolicy\.cod_allowed && !posOnlineOrder\)/);
});
