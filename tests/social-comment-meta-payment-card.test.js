import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildShippingFeeMetaCard } from "../server/modules/shipping/paymentProofLink.js";

// After the shipping details on Messenger/Instagram the customer used to get a wall of text: the
// governorate rule, both wallets spelled out, a "team will contact you" paragraph and an invoice
// link whose preview was a big blank box. The owner asked (2026-10-18) for one short card: what
// to transfer, that it comes off the total, and two buttons.

const order = { id: 1, shipping_fee: 100, total_amount: 1000, invoice_number: "INV-1" };
const transfer = { vodafone: "01024960585", instapayHandle: "maged.helal@instapay", instapayUrl: "" };
const payUrl = "https://m1store-egy.com/pay/abc";

test("the card names the fee and says it comes off the total, within Meta's limits", () => {
  const card = buildShippingFeeMetaCard({ order, amount: 100, transfer, payUrl });
  assert.match(card.title, /لتأكيد الأوردر حوّل قيمة الشحن 100 جنيه/);
  assert.match(card.subtitle, /بيتخصم من إجمالي الأوردر/);
  assert.match(card.subtitle, /01024960585/);
  assert.ok(card.title.length <= 80 && card.subtitle.length <= 80);
  for (const button of card.buttons) assert.ok([...button.title].length <= 20, button.title);
  assert.doesNotMatch(`${card.title}${card.subtitle}${card.fallbackText}`, /الدفع عند الاستلام متاح/);
});

test("without an InstaPay link: copy the number + upload, both through /pay", () => {
  const card = buildShippingFeeMetaCard({ order, amount: 100, transfer, payUrl });
  assert.deepEqual(card.buttons.map((button) => button.title), ["📋 انسخ وارفع التحويل"]);
  assert.ok(card.buttons.every((button) => button.url === payUrl));
});

test("even with an InstaPay link the card has ONE button, to /pay (owner, 2026-10-18)", () => {
  const card = buildShippingFeeMetaCard({ order, amount: 100, transfer: { ...transfer, instapayUrl: "https://ipn.eg/S/x" }, payUrl });
  assert.deepEqual(card.buttons, [{ title: "📋 انسخ وارفع التحويل", url: payUrl }]);
});

test("no card text before or beside the cards: the address card and the payment card stand alone", () => {
  const meta = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  // The "☑ ممتاز / فاضل بس بيانات الشحن / اضغط «إملا بيانات الشحن»" text went out under the card.
  assert.doesNotMatch(meta, /اضغط «إملا بيانات الشحن» وكمل بياناتك/);
  assert.match(meta, /if \(addressCardSent\) \{[\s\S]{0,400}appendAiGeneratedSupportReply\([\s\S]{0,400}\} else await sendSocialCommentSalesFlowText\(/);
  // "✅ تم تأكيد طلبك بنجاح" is not sent on Messenger/Instagram when the payment card follows.
  assert.match(meta, /else if \(!metaPaymentCard\) await sendSocialCommentSalesFlowText\(\{/);
});

test("free shipping: the advance is the confirmation fee, not 'قيمة الشحن'", () => {
  const card = buildShippingFeeMetaCard({ order: { ...order, shipping_fee: 0 }, amount: 400, transfer, payUrl });
  assert.match(card.title, /حوّل 400 جنيه مقدّم/);
  assert.doesNotMatch(card.title, /قيمة الشحن/);
});

test("Messenger/Instagram send the card and keep the message before it short", () => {
  const meta = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  assert.match(meta, /const metaPaymentCard = !isWhatsapp \? shippingFeeCard\?\.metaCard \|\| null : null;/);
  assert.match(meta, /sendSocialCommentPaymentCard\(\{ config, message, metaCard: metaPaymentCard \}\)/);
  assert.match(meta, /text: metaPaymentCard\.fallbackText/);
});

test("/pay opens the InstaPay app through its own ipn: scheme, never the QR web page", () => {
  const page = fs.readFileSync(new URL("../src/storefront/pages/PaymentProofPage.jsx", import.meta.url), "utf8");
  assert.match(page, /return `ipn:\/\/\$\{path\}`;/);
  assert.match(page, /intent:\/\/\$\{path\}#Intent;scheme=ipn;package=\$\{INSTAPAY_ANDROID_PACKAGE\};S\.browser_fallback_url=/);
  assert.match(page, /<a href=\{instapayHref\}/);
  assert.match(page, /get\("open"\) !== "instapay"/);
});

test("the payment receipt carries the invoice link and also reaches the order's Instagram/Messenger thread", async () => {
  const { buildPaymentProofApprovedMessage } = await import("../server/modules/shipping/paymentProofLink.js");
  const message = buildPaymentProofApprovedMessage(
    { invoice_number: "INV-1", customer_name: "ماجد", total_amount: 1000, paid_amount: 100, shipping_fee: 100 },
    { invoiceUrl: "https://m1store-egy.com/invoice/tok", trackingUrl: "https://m1store-egy.com/track?x" }
  );
  assert.match(message, /🧾 فاتورتك: https:\/\/m1store-egy\.com\/invoice\/tok/);
  const source = fs.readFileSync(new URL("../server/modules/shipping/paymentProofLink.js", import.meta.url), "utf8");
  // Instagram/Messenger first, and whatever WhatsApp does (no phone, no number) does not stop it.
  assert.match(source, /const META_THREAD = \/\^\(instagram\|facebook_messenger\):\(\.\+\)\$\/;/);
  assert.match(source, /const meta = await notifyPaymentOnMeta\(order, message\);\s*if \(!phone\)/);
  // The "استلمنا صورة التحويل" reply after an upload reaches the thread too.
  assert.match(source, /await notifyPaymentOnMeta\(updated, buildPaymentProofReceivedMessage\(updated\), \{ intent: PAYMENT_RECEIVED_META_INTENT, once: false \}\);/);
});

test("Messenger gets the same flow, with /pay opening inside the conversation", () => {
  const meta = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  const sender = meta.slice(
    meta.indexOf("const sendSocialCommentPaymentCard = async ({"),
    meta.indexOf("const sendSocialCommentAddressCard = async ({")
  );
  assert.match(sender, /\[AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS\.INSTAGRAM\]\.includes\(channel\)/);
  assert.match(sender, /channel === AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER \? \{ webview_height_ratio: "tall" \} : \{\}/);
  const pay = fs.readFileSync(new URL("../server/modules/shipping/paymentProofLink.js", import.meta.url), "utf8");
  assert.match(pay, /\(instagram\|facebook_messenger\)/);
});

test("the payment step goes out as a BUTTON template first, so Messenger does not cut the number off", () => {
  const card = buildShippingFeeMetaCard({ order, amount: 100, transfer, payUrl });
  assert.match(card.buttonText, /01024960585\n\(فودافون كاش أو انستا باي\)/);
  assert.ok(card.buttonText.length <= 640);
  const meta = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  const sender = meta.slice(
    meta.indexOf("const sendSocialCommentPaymentCard = async ({"),
    meta.indexOf("const sendSocialCommentAddressCard = async ({")
  );
  assert.match(sender, /template_type: "button", text: metaCard\.buttonText, buttons: templateButtons/);
  // A refused button template still leaves the generic card; a network failure is not a refusal.
  assert.match(sender, /if \(!error\?\.status\) throw error;[\s\S]{0,400}body: genericCard/);
});
