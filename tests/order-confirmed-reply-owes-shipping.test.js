import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildOrderConfirmedMessage } from "../server/utils/orderConfirmationMessage.js";

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

test("wiring: both ✅ paths answer through the helper that re-sends the card when the fee is owed", () => {
  const source = fs.readFileSync(new URL("../server/services/whatsappOrderConfirmationService.js", import.meta.url), "utf8");
  // The late-confirm path (an order staff already confirmed — the portal "+" order) and the normal one.
  assert.equal(source.match(/await replyToCustomerConfirm\(\{/g)?.length, 2);
  assert.match(source, /if \(advance\?\.status !== "awaiting_payment"\) return \{ payment_card: false \};/);
  assert.match(source, /queueShippingFeePaymentCard\(\{ order, card, phone, tenantId, idempotencySuffix: `after-confirm-\$\{Date\.now\(\)\}` \}\)/);
});
