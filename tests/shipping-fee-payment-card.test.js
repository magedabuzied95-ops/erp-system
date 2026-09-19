import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";

import {
  PAYMENT_PROOF_CODE_ACTION,
  buildPaymentProofApprovedMessage,
  buildPaymentProofReceivedMessage,
  buildScreenshotInChatReply,
  buildShippingFeePaymentCard,
  hashPaymentProofCode,
  notifyPaymentProofApproved,
  PAYMENT_APPROVED_DELAY_MS,
  paymentProofState,
} from "../server/modules/shipping/paymentProofLink.js";
import { buildShippingFeeAdvanceNotice } from "../server/services/codPolicyReplyService.js";
import { orderLinkSecret } from "../server/utils/orderLinkSecret.js";
import { performSend } from "../server/services/whatsappQueue/worker.js";
import { WHATSAPP_AUTOMATION_TYPES } from "../shared/whatsappQueueDefaults.js";

// The shipping-fee payment card: under the WhatsApp confirmation request of an order that must
// prepay its shipping, a second message with "pay by InstaPay", "copy the Vodafone Cash number" and
// "upload the transfer screenshot". The upload link attaches the screenshot to the order.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const order = { id: 41, public_order_number: "INV-1700", total_amount: 1940, customer_name: "Mona Adel" };
const transfer = { instapayUrl: "https://ipn.eg/S/m1/instapay/abc", instapayHandle: "m1@instapay", vodafone: "01012345678" };
const uploadUrl = "https://m1store.example/pay/ABCDEFGHIJKLMNOP";

test("the card has at most two CTA buttons: copy the number, and the upload link", () => {
  // Evolution answers a third CTA with 400 "Maximum of 2 CTA buttons allowed" (INV-1652).
  const card = buildShippingFeePaymentCard({ order, amount: 90, transfer, uploadUrl });
  assert.deepEqual(card.buttons, [
    { type: "copy", displayText: "انسخ الرقم", copyCode: "01012345678" },
    { type: "url", displayText: "ارفع صورة التحويل", url: uploadUrl },
  ]);
  // WhatsApp truncates a CTA label past 20 characters.
  for (const button of card.buttons) assert.ok([...button.displayText].length <= 20, button.displayText);
  assert.match(card.body, /رسوم الشحن لطلبك رقم INV-1700: 90 جنيه، والباقي 1,850 جنيه تدفعه عند الاستلام\./);
  assert.doesNotMatch(card.body, /\/pay\//);
  assert.match(read("../server/services/whatsappGatewayService.js"), /\.slice\(0, 2\);\s*if \(!safeButtons\.length\) throw gatewayError\("A CTA message needs/);
});

test("one number, and the customer is told it takes InstaPay and Vodafone Cash alike", () => {
  // Owner: the InstaPay number IS the Vodafone Cash number; no separate handle to choose between.
  const card = buildShippingFeePaymentCard({ order, amount: 90, transfer: { instapayHandle: "maged.helal@instapay", vodafone: "01024960585" }, uploadUrl });
  assert.match(card.body, /1️⃣ حوّل 90 جنيه على الرقم ده:\n📱 01024960585\nينفع تحوّل عليه بانستا باي أو فودافون كاش/);
  assert.doesNotMatch(card.body, /maged\.helal@instapay/);
  assert.doesNotMatch(card.fallbackText, /maged\.helal@instapay/);
  // No wallet number set: the InstaPay handle is the number to copy.
  const handleOnly = buildShippingFeePaymentCard({ order, amount: 90, transfer: { instapayHandle: "m1@instapay" }, uploadUrl });
  assert.equal(handleOnly.buttons[0].copyCode, "m1@instapay");
});

test("the text fallback spells out every value, so a card that will not render still says how to pay", () => {
  const card = buildShippingFeePaymentCard({ order, amount: 90, transfer, uploadUrl });
  for (const value of ["01012345678", uploadUrl, "90 جنيه", "بانستا باي أو فودافون كاش"]) {
    assert.ok(card.fallbackText.includes(value), value);
  }
  assert.deepEqual(card.transcriptButtons.map((button) => button.type), ["whatsapp_footer", "whatsapp_copy_button", "whatsapp_url_button"]);
});

test("the confirmation request stops listing wallet details when the card follows it", () => {
  const policy = { mode: "restricted", governorates: ["damietta"] };
  const withCard = buildShippingFeeAdvanceNotice({ policy, governorate: "القاهرة", shippingFee: 90, orderTotal: 1940, transfer: { vodafone: "01012345678", instapay: "m1@instapay" }, paymentCardFollows: true });
  assert.match(withCard, /لازم تحوّل رسوم الشحن 90 جنيه الأول/);
  assert.match(withCard, /الرسالة اللي جاية/);
  assert.doesNotMatch(withCard, /01012345678|ابعت صورة التحويل هنا/);
  const withoutCard = buildShippingFeeAdvanceNotice({ policy, governorate: "القاهرة", shippingFee: 90, orderTotal: 1940, transfer: { vodafone: "01012345678", instapay: "m1@instapay" } });
  assert.match(withoutCard, /01012345678/);
});

test("an upload code lives in its own HMAC namespace and the confirmation link refuses it", () => {
  const plain = createHmac("sha256", orderLinkSecret()).update("ABCDEFGHIJKLMNOP").digest("hex");
  assert.notEqual(hashPaymentProofCode("ABCDEFGHIJKLMNOP"), plain);
  const confirmation = read("../server/services/whatsappOrderConfirmationService.js");
  assert.match(confirmation, /WHERE code_hash = \$1\s+-- A payment-proof upload code may only upload[^\n]*\n\s+AND action <> \$2/);
  assert.match(confirmation, /params: \[codeHash, PAYMENT_PROOF_CODE_ACTION\]/);
  assert.equal(PAYMENT_PROOF_CODE_ACTION, "payment_proof");
});

test("the page state follows the order: ready, in review, paid, not required, closed", () => {
  assert.equal(paymentProofState({ order: { status: "pending_confirmation" }, advance: { required: true, status: "awaiting_payment" } }), "ready");
  assert.equal(paymentProofState({ order: { status: "payment_rejected" }, advance: { required: true, status: "awaiting_payment" } }), "ready");
  assert.equal(paymentProofState({ order: { status: "pending_confirmation" }, advance: { required: true, status: "awaiting_review" } }), "submitted");
  assert.equal(paymentProofState({ order: { status: "confirmed" }, advance: { required: true, status: "paid" } }), "paid");
  assert.equal(paymentProofState({ order: { status: "confirmed" }, advance: { required: false } }), "not_required");
  assert.equal(paymentProofState({ order: { status: "delivered" }, advance: { required: true, status: "awaiting_payment" } }), "closed");
});

test("the customer's messages: received, approved, and the reply to a screenshot sent in the chat", () => {
  assert.match(buildPaymentProofReceivedMessage(order), /استلمنا صورة تحويل رسوم الشحن لطلبك رقم INV-1700/);
  assert.match(buildPaymentProofReceivedMessage(order), /طلبك دلوقتي في مراجعة الدفع/);
  assert.match(buildPaymentProofApprovedMessage({ ...order, paid_amount: 90 }), /المندوب هيحصّل 1,850 جنيه عند الاستلام/);
  assert.ok(buildScreenshotInChatReply({ order, state: "ready", uploadUrl }).includes(uploadUrl));
  assert.match(buildScreenshotInChatReply({ order, state: "submitted" }), /وصلتنا قبل كده/);
});

test("confirming the money anywhere tells the customer, and the message carries the tracking link", async () => {
  // Owner, 2026-09-20: the orders page, the employee portal, the manager portal, the AI Inbox
  // order card and the wallet SMS matcher all answer the customer. A fee staff recorded by hand
  // used to be silent because it carried no payment_proof_link timeline entry.
  assert.deepEqual(await notifyPaymentProofApproved(null), { sent: false, reason: "missing_order" });
  assert.deepEqual(
    await notifyPaymentProofApproved({ id: 9, timeline: [{ action: "shipping_fee_paid", source: "orders" }] }),
    { sent: false, reason: "missing_phone" }
  );
  // A closed order can still have its money recorded; "بيتجهز للشحن" would be wrong on it.
  assert.deepEqual(
    await notifyPaymentProofApproved({ id: 9, status: "cancelled", customer_phone: "01012345678" }),
    { sent: false, reason: "order_closed" }
  );

  const message = buildPaymentProofApprovedMessage(
    { ...order, customer_name: "Mo3taz Ali", paid_amount: 90 },
    { trackingUrl: "https://m1store-egy.com/track?order=INV-1700&phone=201558934989" }
  );
  assert.match(message, /^✅ تم تأكيد دفع رسوم الشحن لطلبك رقم INV-1700 يا Mo3taz$/m);
  assert.match(message, /^🚚 طلبك بيتجهز للشحن دلوقتي، والمندوب هيحصّل 1,850 جنيه عند الاستلام\.$/m);
  // One 🚚 line, never two: "فريقنا بدأ تجهيز طلبك للشحن" only said the line above it again (owner).
  assert.equal(message.split("\n\n").filter((block) => block.startsWith("🚚")).length, 1);
  assert.doesNotMatch(message, /بدأ تجهيز/);
  assert.match(message, /📍 تابع طلبك من هنا:\nhttps:\/\/m1store-egy\.com\/track\?order=INV-1700&phone=201558934989/);
  assert.match(message, /شكراً لاختيارك M1 Store ❤️$/);

  // Paid in full: naming the shipping fee would read as if something is still owed.
  const full = buildPaymentProofApprovedMessage({ ...order, paid_amount: 1940 });
  assert.match(full, /^✅ تم تأكيد دفع طلبك رقم INV-1700 بالكامل يا Mona$/m);
  assert.match(full, /^💰 طلبك مدفوع بالكامل، مفيش مبلغ هيتحصّل عند الاستلام\.$/m);
  assert.doesNotMatch(full, /رسوم الشحن|هيحصّل \d/);

  // A parcel that is already booked is never described as "بيتجهز للشحن" (the INV-1616 lie).
  const shipped = buildPaymentProofApprovedMessage({ ...order, paid_amount: 90, shipping_tracking_number: "7654321", shipping_provider: "bosta" });
  assert.match(shipped, /🚚 طلبك اتسلّم لـبوسطة، ورقم الشحنة 7654321\./);
  assert.match(shipped, /💰 المندوب هيحصّل 1,850 جنيه عند الاستلام\./);
  assert.doesNotMatch(shipped, /بيتجهز للشحن دلوقتي|بدأ تجهيز/);

  // Two taps on the same amount are one message; a later, larger payment gets its own.
  const module = read("../server/modules/shipping/paymentProofLink.js");
  assert.match(module, /idempotencySuffix: `paid:\$\{Math\.round\(money\(order\.paid_amount\) \* 100\)\}`/);
  // The link is built here, not by the caller: every approval path gets it for free.
  assert.match(module, /buildPaymentProofApprovedMessage\(order, \{ trackingUrl: buildOrderTrackingUrl\(orderRef\(order\), phone\) \}\)/);
  // The receipt waits five minutes: the wallet matcher approves a website order a second after
  // checkout, and two automated messages back to back on one number is the burst WhatsApp bans.
  assert.equal(PAYMENT_APPROVED_DELAY_MS, 5 * 60 * 1000);
  assert.match(module, /delayMs: PAYMENT_APPROVED_DELAY_MS,/);
  // Switching the queue off must not turn the wait into an instant send.
  assert.match(module, /scheduledAt: delayMs > 0 \? new Date\(Date\.now\(\) \+ delayMs\) : null,/);
  assert.match(module, /const directSend = delayMs > 0\s*\?\s*async \(\) => \{\s*const timer = setTimeout\(/);
  for (const path of ["../server/controllers/ordersController.js", "../server/modules/walletTransfers/walletTransfers.service.js", "../server/modules/shipping/shipping.portal.actions.js"]) {
    assert.match(read(path), /notifyPaymentProofApproved\(/, path);
  }
});

test("a card that will not render goes out as its text fallback", async () => {
  const sent = [];
  const gateway = {
    sendCtaButtonsMessage: async () => { throw new Error("buttons down"); },
    sendTextMessage: async (payload) => { sent.push(payload); return { id: "wamid.1" }; },
  };
  const row = {
    id: 1,
    automation_type: "shipping_fee_payment_card",
    recipient_phone: "201012345678",
    rendered_body: "body",
    payload: { send: { kind: "cta_buttons", title: "💳 دفع رسوم الشحن", buttons: [{ type: "url", displayText: "x", url: "https://x" }], fallbackText: "FALLBACK" } },
  };
  const result = await performSend(row, gateway, { lastInboundAt: null });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message, "FALLBACK");
  assert.equal(result.delivery_mode, "link_text");
});

test("the WhatsApp sales flow's order confirmation is followed by the card too", async () => {
  // INV-1646: the customer ordered through the WhatsApp sales flow (address link), got
  // "✅ تم تأكيد طلبك بنجاح" with the old wallet lines, and no card — only the POS request had one.
  const meta = read("../server/services/metaIntegrationService.js");
  const at = meta.indexOf("const successLines = [\"✅ تم تأكيد طلبك بنجاح\"");
  assert.ok(at > 0);
  const block = meta.slice(at, at + 2500);
  assert.match(block, /isWhatsapp\s*\? await shippingFeeNoticeWithPaymentCard\(advanceOrder\)/);
  assert.match(block, /await sendConfirmation\(successText\);\s*if \(shippingFeeCard\) \{/);
  assert.match(block, /queueShippingFeePaymentCard\(\{/);
  // Nothing owed: no notice and no card.
  const { shippingFeeNoticeWithPaymentCard } = await import("../server/modules/shipping/paymentProofLink.js");
  assert.equal(typeof shippingFeeNoticeWithPaymentCard, "function");
});

test("wiring: queue types, Evolution copy buttons, the public route, the webhook and the wallet matcher", () => {
  assert.equal(WHATSAPP_AUTOMATION_TYPES.shipping_fee_payment_card, "transactional");
  assert.equal(WHATSAPP_AUTOMATION_TYPES.payment_proof_received, "transactional");
  assert.equal(WHATSAPP_AUTOMATION_TYPES.payment_proof_approved, "transactional");

  const gateway = read("../server/services/whatsappGatewayService.js");
  assert.match(gateway, /export const sendCtaButtonsMessage/);
  assert.match(gateway, /\{ type: "copy", displayText, copyCode: text\(button\.copyCode\) \}/);

  const server = read("../server/server.js");
  assert.match(server, /app\.use\("\/api\/public\/payment-proof", publicPaymentProofRoutes\)/);
  assert.match(read("../src/App.jsx"), /path="\/pay\/:code"/);

  const confirmation = read("../server/services/whatsappOrderConfirmationService.js");
  assert.match(confirmation, /shippingFeeAdvanceNoticeForOrder\(order, \{ paymentCardFollows: Boolean\(paymentCard\) \}\)/);
  assert.match(confirmation, /queueShippingFeePaymentCard\(/);

  // The screenshot check runs before the sales flow and the AI, so a transfer screenshot never
  // reaches the product visual search.
  const webhook = read("../server/routes/whatsappGateway.js");
  const screenshotAt = webhook.indexOf("answerTransferScreenshotInChat");
  assert.ok(screenshotAt > 0 && screenshotAt < webhook.indexOf("handleWhatsappSalesFlow"));
  assert.ok(screenshotAt < webhook.indexOf("triggerWhatsappAiAutoReply(normalized)"));

  const wallet = read("../server/modules/walletTransfers/walletTransfers.service.js");
  assert.match(wallet, /OR LOWER\(COALESCE\(shipping_payment_method, ''\)\) = ANY\(\$4::text\[\]\)/);
  assert.match(wallet, /ABS\(COALESCE\(shipping_fee, 0\) - \$3::numeric\) < 0\.01/);
});

test("a free-shipping order's card and messages call the money the order confirmation fee", () => {
  const order = { id: 1740, invoice_number: "INV-1740", total_amount: 10700, shipping_fee: 0, paid_amount: 400 };
  const card = buildShippingFeePaymentCard({ order, amount: 400, transfer: { vodafone: "01012345678" }, uploadUrl: "https://m1store-egy.com/pay/abc" });
  assert.equal(card.title, "💳 دفع رسوم تأكيد الأوردر");
  assert.match(card.body, /رسوم تأكيد الأوردر لطلبك رقم INV-1740: 400 جنيه، والباقي 10,300 جنيه تدفعه عند الاستلام\./);
  assert.match(buildPaymentProofReceivedMessage(order), /صورة تحويل رسوم تأكيد الأوردر/);
  assert.match(buildPaymentProofApprovedMessage(order), /تم تأكيد دفع رسوم تأكيد الأوردر[\s\S]*10,300 جنيه عند الاستلام/);
});
