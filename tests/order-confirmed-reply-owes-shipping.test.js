import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildOrderConfirmedMessage } from "../server/utils/orderConfirmationMessage.js";
import { buildShippingFeePaymentCard } from "../server/modules/shipping/paymentProofLink.js";

// INV-2187 (owner, 2026-10-19): an order outside the COD governorates was confirmed by the
// customer on WhatsApp and told "فريقنا بدأ تجهيز طلبك للشحن" while its shipping fee was
// unpaid — the payment card had gone out above the request and the reply buried it.

const order = { invoice_number: "INV-2187", total_amount: 800, shipping_fee: 100 };

test("fee unpaid: the reply says what is left, not that the parcel is being prepared", () => {
  const msg = buildOrderConfirmedMessage({ customerName: "ماجد", order, trackingUrl: "https://x/track", shippingAdvance: { required: true, status: "awaiting_payment", amount: 100, kind: "shipping_fee" } });
  assert.match(msg, /^✅ تم تأكيد طلبك رقم INV-2187 يا ماجد$/m);
  assert.match(msg, /💳 فاضل بس تحوّل قيمة الشحن 100 جنيه عشان نشحنه 👇/);
  assert.doesNotMatch(msg, /بدأ تجهيز|تابع طلبك/);
});

test("free shipping: the money is the confirmation fee", () => {
  const msg = buildOrderConfirmedMessage({ customerName: "ماجد", order, shippingAdvance: { required: true, status: "awaiting_payment", amount: 50, kind: "confirmation_fee" } });
  assert.match(msg, /فاضل بس تحوّل 50 جنيه مقدّم/);
});

test("screenshot already in review: no payment ask", () => {
  const msg = buildOrderConfirmedMessage({ customerName: "ماجد", order, shippingAdvance: { required: true, status: "awaiting_review", amount: 100 } });
  assert.match(msg, /صورة التحويل وصلتنا وبنراجعها/);
  assert.doesNotMatch(msg, /فاضل بس تحوّل/);
});

test("nothing owed: the usual short reply", () => {
  const msg = buildOrderConfirmedMessage({ customerName: "ماجد", order, trackingUrl: "https://x/track" });
  assert.match(msg, /بدأ تجهيز طلبك للشحن/);
  assert.match(msg, /تابع طلبك من هنا/);
});

test("the ✅ answer with the fee owed is ONE message: the card, opening with the confirmation", () => {
  // INV-2189 (owner, 2026-10-19): a text reply plus the card twice — three messages for one tap.
  const card = buildShippingFeePaymentCard({ order: { ...order, customer_name: "ماجد" }, amount: 100, transfer: { vodafone: "01024960585" }, uploadUrl: "https://x/pay/a", confirmed: true });
  assert.equal(card.title, "✅ تم تأكيد طلبك INV-2187");
  assert.match(card.body, /^💳 فاضل بس تحوّل قيمة الشحن 100 جنيه عشان نشحنه$/m);
  assert.match(card.fallbackText, /^✅ تم تأكيد طلبك INV-2187/);
  assert.equal(card.buttons.length, 2);
  // Not confirmed (the card under the request): the usual heading.
  assert.equal(buildShippingFeePaymentCard({ order, amount: 100, transfer: { vodafone: "01024960585" }, uploadUrl: "https://x/pay/a" }).title, "💳 دفع الشحن");
});

test("wiring: the card is the step after ✅ — never with the request, never doubled", () => {
  const source = fs.readFileSync(new URL("../server/services/whatsappOrderConfirmationService.js", import.meta.url), "utf8");
  // The late-confirm path (an order staff already confirmed — the portal "+" order) and the normal one.
  assert.equal(source.match(/await replyToCustomerConfirm\(\{/g)?.length, 2);
  // Fee owed: the card IS the answer; the text goes out only when no card did.
  assert.match(source, /const sent = await sendPaymentCardAfterConfirm\(\{ order, phone, tenantId, advance \}\);\s*if \(sent\.payment_card\) return sent;/);
  assert.match(source, /prepareShippingFeePaymentCard\(\{ order, amount: owed\.amount, confirmed: true \}\)/);
  assert.match(source, /if \(await paymentCardJustQueued\(order\.id\)\) return \{ payment_card: true, reason: "card_already_below", owed \};/);
  assert.match(source, /AND automation_type = 'shipping_fee_payment_card'\s+AND status IN \('pending', 'scheduled', 'sending'\)/);
  // The confirm-link page sends it too.
  assert.match(source, /if \(actionConfig\.payloadAction === "confirm" && !alreadyApplied && updatedWithItems\?\.id\) \{[\s\S]{0,300}sendPaymentCardAfterConfirm\(/);
  // One card send in the whole module, and the request no longer prepares one.
  assert.equal(source.match(/queueShippingFeePaymentCard\(/g)?.length, 1);
  assert.doesNotMatch(source, /directPaymentCard/);
});

test("the request says the money comes after confirming, with no arrow to a card that is not there", async () => {
  const { buildShippingFeeAdvanceNotice } = await import("../server/services/codPolicyReplyService.js");
  const policy = { mode: "restricted", governorates: ["damietta"] };
  const notice = buildShippingFeeAdvanceNotice({ policy, governorate: "الدقهلية", shippingFee: 100, orderTotal: 800, paymentCardAfterConfirm: true });
  assert.equal(notice, "💳 بعد التأكيد هتحوّل قيمة الشحن 100 جنيه بس");
});
