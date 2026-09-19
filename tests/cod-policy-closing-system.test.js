import test from "node:test";
import assert from "node:assert/strict";

import { resolveCodPolicy, resolveGovernorateId, normalizeCodPolicy } from "../shared/codPolicy.js";
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
  assert.deepEqual(normalizeCodPolicy({}), { mode: "open", governorates: ["damietta"], confirmationFee: 400 });
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

// INV-1740 (2026-09-19): a 10,700 order to Giza crossed the free-shipping threshold, owed no
// shipping fee, and went through as plain cash on delivery.
test("free shipping outside the list prepays the order confirmation fee, off the total", () => {
  const cod = resolveCodPolicy({ policy: restricted, governorate: "الجيزه", shippingFee: 0, orderTotal: 10700 });
  assert.equal(cod.cod_allowed, false);
  assert.equal(cod.advance, "shipping_fee");
  assert.equal(cod.advance_kind, "confirmation_fee");
  assert.equal(cod.advance_amount, 400);
  assert.equal(cod.confirmation_fee, 400);
});

test("the confirmation fee follows the setting, never exceeds the order, and 0 switches it off", () => {
  const typed = resolveCodPolicy({ policy: { ...restricted, confirmationFee: "250" }, governorate: "Cairo", shippingFee: 0, orderTotal: 1940 });
  assert.equal(typed.advance_amount, 250);
  const small = resolveCodPolicy({ policy: restricted, governorate: "Cairo", shippingFee: 0, orderTotal: 300 });
  assert.equal(small.advance_amount, 300);
  const off = resolveCodPolicy({ policy: { ...restricted, confirmationFee: 0 }, governorate: "Cairo", shippingFee: 0, orderTotal: 1940 });
  assert.equal(off.cod_allowed, true);
  assert.equal(off.advance_amount, 0);
  assert.equal(normalizeCodPolicy({ confirmationFee: "abc" }).confirmationFee, 400);
});

test("a paid shipping fee, a COD governorate, a pickup and the open system owe no confirmation fee", () => {
  const paidShipping = resolveCodPolicy({ policy: restricted, governorate: "Cairo", shippingFee: 90, orderTotal: 1940 });
  assert.equal(paidShipping.advance_kind, "shipping_fee");
  assert.equal(paidShipping.advance_amount, 90);
  const damietta = resolveCodPolicy({ policy: restricted, governorate: "دمياط", shippingFee: 0, orderTotal: 10700 });
  assert.equal(damietta.cod_allowed, true);
  assert.equal(damietta.confirmation_fee, 0);
  const pickup = resolveCodPolicy({ policy: restricted, governorate: "Cairo", shippingFee: 0, orderTotal: 1940, confirmationFeeExempt: true });
  assert.equal(pickup.cod_allowed, true);
  assert.equal(pickup.advance_amount, 0);
  const open = resolveCodPolicy({ policy: { mode: "open" }, governorate: "Cairo", shippingFee: 0, orderTotal: 1940 });
  assert.equal(open.cod_allowed, true);
  assert.equal(open.advance, "order_total");
});

test("an unknown governorate fails closed", () => {
  const cod = resolveCodPolicy({ policy: restricted, governorate: "somewhere", shippingFee: 60, orderTotal: 500 });
  assert.equal(cod.cod_allowed, false);
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

test("a screenshot in the shipping-fee slot can be approved as the whole order (INV-1637)", async () => {
  const client = fakeClient();
  await applyTransferPaymentConfirmation(client, {
    order: { id: 1637, payment_method: "instapay", total_amount: 440, shipping_fee: 90, paid_amount: 90, cod_amount: 350 },
    fullOrder: true,
  });
  const update = client.calls.find((call) => /UPDATE orders/.test(call.sql));
  assert.equal(update.params[3], "paid");
  assert.equal(update.params[4], 440);
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

// ---- staff + AI side (2026-09-15)
import { describeShippingFeeAdvance } from "../server/modules/shipping/shippingFeeAdvance.js";
import { buildShippingFeeAdvanceNotice, buildRestrictedCodFaqAnswer } from "../server/services/codPolicyReplyService.js";
import { buildCodOrderConfirmationMessage } from "../server/utils/orderConfirmationMessage.js";
import { portalOrderActionsFor, shippingFeeAdvanceState } from "../src/shared/components/portalOnlineOrders/portalOrderActions.js";
import { runPortalOrderAction } from "../server/modules/shipping/shipping.portal.actions.js";

test("an order's shipping-fee state: awaiting, under review, paid, not required", () => {
  const base = { governorate: "Cairo", shipping_fee: 90, total_amount: 1940, paid_amount: 0 };
  assert.equal(describeShippingFeeAdvance({ order: base, policy: restricted }).status, "awaiting_payment");
  assert.equal(describeShippingFeeAdvance({ order: { ...base, transfer_proof_status: "pending" }, policy: restricted }).status, "awaiting_review");
  assert.equal(describeShippingFeeAdvance({ order: { ...base, paid_amount: 90, transfer_proof_status: "approved" }, policy: restricted }).status, "paid");
  assert.equal(describeShippingFeeAdvance({ order: { ...base, governorate: "دمياط" }, policy: restricted }).status, "not_required");
  assert.equal(describeShippingFeeAdvance({ order: base, policy: { mode: "open" } }).required, false);
});

test("the customer is told the fee, the rest and where to transfer — and nothing under the open system", () => {
  const notice = buildShippingFeeAdvanceNotice({ policy: restricted, governorate: "القاهرة", shippingFee: 90, orderTotal: 1940, transfer: { vodafone: "01012345678", instapay: "m1@instapay" } });
  assert.match(notice, /دمياط/);
  assert.match(notice, /90 جنيه/);
  assert.match(notice, /1,850 جنيه/);
  assert.match(notice, /01012345678/);
  assert.match(notice, /m1@instapay/);
  assert.equal(buildShippingFeeAdvanceNotice({ policy: { mode: "open" }, governorate: "القاهرة", shippingFee: 90, orderTotal: 1940 }), "");
  assert.equal(buildShippingFeeAdvanceNotice({ policy: restricted, governorate: "دمياط", shippingFee: 45, orderTotal: 500 }), "");
  assert.match(buildRestrictedCodFaqAnswer({ policy: restricted }), /لباقي المحافظات بتحوّل رسوم الشحن/);
  assert.equal(buildRestrictedCodFaqAnswer({ policy: { mode: "open" } }), "");
});

test("the WhatsApp confirmation request carries the notice and collects only the rest", () => {
  const order = { id: 1, invoice_number: "INV-9", total_amount: 1940, cod_amount: 1940, governorate: "القاهرة" };
  const message = buildCodOrderConfirmationMessage({ order, shippingAdvance: { notice: "NOTICE-LINE", amount: 90 } });
  assert.match(message, /مبلغ التحصيل: 1,850 جنيه/);
  assert.match(message, /NOTICE-LINE/);
  assert.match(buildCodOrderConfirmationMessage({ order }), /مبلغ التحصيل: 1,940 جنيه/);
});

test("the board offers تم دفع الشحن instead of the Bosta button while the fee is unpaid", () => {
  const awaiting = { group: "confirmed", status: "confirmed", shipment: { provider: "bosta" }, money: { shipping_fee_advance: { required: true, status: "awaiting_payment", amount: 90 } } };
  assert.deepEqual(portalOrderActionsFor(awaiting), ["shipping_fee_paid", "ready_to_ship"]);
  const paid = { ...awaiting, money: { shipping_fee_advance: { required: true, status: "paid", amount: 90 } } };
  assert.deepEqual(portalOrderActionsFor(paid), ["ready_to_ship", "create_shipment"]);
  assert.equal(shippingFeeAdvanceState({ money: { shipping_fee_advance: { required: false } } }), null);
});

test("the portal action records the fee with the method staff picked", async () => {
  const calls = [];
  const order = { id: 5, group: "confirmed", status: "confirmed", order_number: "5", shipment: {}, customer: {} };
  await runPortalOrderAction({
    actor: { id: 1, tenant_id: 2, full_name: "Mona" },
    surface: "manager_portal",
    orderId: 5,
    action: "shipping_fee_paid",
    input: { method: "vodafone_cash" },
    deps: {
      loadOrder: async () => order,
      markShippingFeePaid: async (args) => { calls.push(args); },
      audit: async () => {},
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "vodafone_cash");
  assert.equal(calls[0].tenantId, 2);
  assert.equal(calls[0].actorName, "Mona");
});

import { buildCodFaqAnswer } from "../server/services/codPolicyReplyService.js";

test("the COD answer follows the switch alone: every governorate when open, Damietta + transfer when restricted, none when COD is off", () => {
  assert.equal(buildCodFaqAnswer({ policy: { mode: "open" } }), "أيوه، الدفع عند الاستلام متاح لكل المحافظات 👌");
  assert.doesNotMatch(buildCodFaqAnswer({ policy: { mode: "open" } }), /حسب المنطقة/);
  assert.match(buildCodFaqAnswer({ policy: restricted }), /لمحافظة دمياط/);
  assert.match(buildCodFaqAnswer({ policy: { mode: "open" }, codEnabled: false, transfer: { vodafone: "01012345678" } }), /مش متاح حالياً[\s\S]*01012345678/);
});

test("the typed COD reply in the AI settings no longer decides the answer", async () => {
  const fs = await import("node:fs");
  const meta = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  assert.match(meta, /payment: codAnswer,/);
  const order = fs.readFileSync(new URL("../server/services/aiAgentOrderService.js", import.meta.url), "utf8");
  assert.match(order, /answer: objection === "cod" \? await codFaqAnswer\(\)/);
});

// ---- INV-1616: an invoice edit lowered the total but cod_amount kept the old figure
import { orderCodAmount } from "../server/modules/shipping/shipping.service.js";
import { collectOnDeliveryAmount } from "../server/utils/orderConfirmationMessage.js";

test("a stale cod_amount never makes the courier or the customer message ask for more than is owed", () => {
  const edited = { payment_method: "credit_sale", total_amount: 1290, paid_amount: 90, cod_amount: 2400, invoice_number: "INV-1616" };
  assert.equal(orderCodAmount(edited), 1200);
  assert.equal(collectOnDeliveryAmount(edited), 1200);
  assert.match(buildCodOrderConfirmationMessage({ order: edited }), /مبلغ التحصيل: 1,200 جنيه/);
});

test("the invoice edit re-prices a stored collection amount with the new total", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
  assert.match(source, /cod_amount = CASE WHEN COALESCE\(cod_amount, 0\) > 0 THEN GREATEST\(\$5::numeric - \$6::numeric, 0\) ELSE cod_amount END/);
});

// ---- INV-1616: آجل chosen on the till must not turn an online order into a credit sale
import { editedOnlineOrderPaymentMethod, isOnlineShippingOrder } from "../server/modules/shipping/onlineOrderSql.js";

test("an edited online order keeps its own payment method instead of becoming آجل", () => {
  const website = { source: "website", channel: "storefront", payment_method: "instapay" };
  assert.equal(isOnlineShippingOrder(website), true);
  assert.equal(editedOnlineOrderPaymentMethod({ order: website, requestedMethod: "credit_sale" }), "instapay");
  assert.equal(editedOnlineOrderPaymentMethod({ order: { ...website, payment_method: "credit_sale" }, requestedMethod: "credit_sale" }), "cash_on_delivery");
  assert.equal(editedOnlineOrderPaymentMethod({ order: website, requestedMethod: "cash" }), "", "a real payment method is left alone");
  assert.equal(isOnlineShippingOrder({ source: "pos", channel: "pos", shipping_provider: "in_store_delivery" }), false, "a till sale can still go on credit");
  assert.equal(isOnlineShippingOrder({ source: "pos", shipping_provider: "bosta" }), true);
});

test("the POS edit reason stays in the audit and never replaces the order notes the courier reads", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /req\.body\.reason \|\| req\.body\.notes \|\| null/);
  assert.match(source, /String\(req\.body\.notes \|\| ""\)\.trim\(\) \|\| null,/);
  assert.match(source, /req\.body\.reason \|\| "POS invoice edit"/, "the audit row still records the reason");
});

// ---- INV-1616: confirmed at 4:32 after the parcel was booked at 4:20, and told "بنجهّزه"
import { buildOrderConfirmedMessage } from "../server/utils/orderConfirmationMessage.js";

test("a confirmation after the parcel is booked names the courier, tracking number and what is collected", () => {
  const shipped = { invoice_number: "INV-1616", shipping_provider: "bosta", shipping_tracking_number: "1399658887", total_amount: 1290, paid_amount: 90, cod_amount: 1200 };
  const reply = buildOrderConfirmedMessage({ customerName: "هدير", order: shipped, trackingUrl: "https://m1store-egy.com/track/x" });
  assert.match(reply, /تم تأكيد طلبك رقم INV-1616 يا هدير/);
  assert.match(reply, /اتسلّم لـبوسطة، ورقم الشحنة 1399658887/);
  assert.match(reply, /المندوب هيحصّل 1,200 جنيه/);
  assert.doesNotMatch(reply, /بنجهّزه|بدأ تجهيز/);
  const notShipped = buildOrderConfirmedMessage({ customerName: "هدير", order: { invoice_number: "INV-1" } });
  assert.match(notShipped, /بدأ تجهيز طلبك للشحن/);
});

test("a late confirm is recorded as the customer's and the reply is logged as the system", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../server/services/whatsappOrderConfirmationService.js", import.meta.url), "utf8");
  assert.match(source, /if \(action === "confirm" && currentStatus === "confirmed" && order\?\.id\)/);
  assert.match(source, /SET whatsapp_confirmed_at = NOW\(\),[\s\S]*WHERE id = \$1 AND whatsapp_confirmed_at IS NULL/);
  assert.match(source, /const sendSystemOrderText = [\s\S]*senderType: "system"/);
});

import { toPlace } from "../server/services/codPolicyReplyService.js";

test("the notice names the governorate as written Arabic: للقاهرة, لدمياط", () => {
  assert.equal(toPlace("القاهرة"), "للقاهرة");
  assert.equal(toPlace("دمياط"), "لدمياط");
  const notice = buildShippingFeeAdvanceNotice({ policy: restricted, governorate: "القاهره", shippingFee: 90, orderTotal: 1840 });
  assert.match(notice, /عشان نشحن طلبك للقاهرة لازم تحوّل رسوم الشحن 90 جنيه/);
  assert.doesNotMatch(notice, /لـال/);
});

test("an existing free-shipping website order owes the confirmation fee; a till sale and an exchange do not", () => {
  const website = { source: "website", channel: "storefront", governorate: "الجيزه", total_amount: 10700, shipping_fee: 0, paid_amount: 0 };
  const owed = describeShippingFeeAdvance({ order: website, policy: restricted });
  assert.deepEqual([owed.required, owed.status, owed.kind, owed.amount], [true, "awaiting_payment", "confirmation_fee", 400]);
  const paid = describeShippingFeeAdvance({ order: { ...website, paid_amount: 400, transfer_proof_status: "approved" }, policy: restricted });
  assert.equal(paid.status, "paid");
  const till = describeShippingFeeAdvance({ order: { source: "pos", channel: "pos", total_amount: 900, shipping_fee: 0, shipping_provider: null }, policy: restricted });
  assert.equal(till.required, false);
  const exchange = describeShippingFeeAdvance({ order: { ...website, ai_agent_metadata: { exchange: { return_lines: [{ product_name: "x", quantity: 1 }] } } }, policy: restricted });
  assert.equal(exchange.required, false);
  const pickup = describeShippingFeeAdvance({ order: { ...website, shipping_provider: "store_pickup" }, policy: restricted });
  assert.equal(pickup.required, false);
});

test("the customer is told the fee by its name and that it comes off the total", () => {
  const notice = buildShippingFeeAdvanceNotice({ policy: restricted, governorate: "الجيزه", shippingFee: 0, orderTotal: 10700 });
  assert.match(notice, /رسوم تأكيد الأوردر 400 جنيه/);
  assert.match(notice, /بيتخصم من إجمالي الأوردر/);
  assert.match(notice, /10,300 جنيه/);
  const shipping = buildShippingFeeAdvanceNotice({ policy: restricted, governorate: "Cairo", shippingFee: 90, orderTotal: 1940 });
  assert.match(shipping, /رسوم الشحن 90 جنيه/);
  assert.doesNotMatch(shipping, /رسوم تأكيد/);
});
