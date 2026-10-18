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
  assert.deepEqual(card.buttons.map((button) => button.title), ["📋 انسخ الرقم", "📸 ارفع صورة التحويل"]);
  assert.ok(card.buttons.every((button) => button.url === payUrl));
});

test("with an InstaPay link: open InstaPay + copy the number", () => {
  const card = buildShippingFeeMetaCard({ order, amount: 100, transfer: { ...transfer, instapayUrl: "https://ipn.eg/S/x" }, payUrl });
  assert.deepEqual(card.buttons.map((button) => button.title), ["🏦 حوّل بانستا باي", "📋 انسخ الرقم"]);
  assert.equal(card.buttons[0].url, "https://ipn.eg/S/x");
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
