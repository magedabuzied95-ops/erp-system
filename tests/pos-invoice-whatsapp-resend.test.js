import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const drawerSource = read("../src/modules/pos/components/RecentOperationsDrawer.jsx");
const routesSource = read("../server/routes/orders.js");
const controllerSource = read("../server/controllers/ordersController.js");
const serviceSource = read("../server/services/whatsappOrderConfirmationService.js");
const registrySource = read("../server/modules/orders/orderMessages.js");

const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  assert.ok(end > start, `missing marker: ${endMarker}`);
  return source.slice(start, end);
};

const localeBundle = (locale) => JSON.parse(read(`../src/locales/${locale}/pos.json`));

test("the WhatsApp action asks before it sends", () => {
  assert.match(
    drawerSource,
    /label=\{t\("pos\.recentOps\.actions\.whatsapp"\)\}[\s\S]{0,400}?onClick=\{\(\) => onResendWhatsapp\(order\)\}/
  );
  assert.match(drawerSource, /onResendWhatsapp=\{openWhatsappResend\}/);

  // The click may only stage the confirmation. If the request ever moves into the
  // opener, a cashier brushing the button messages a customer with no way back.
  const opener = between(drawerSource, "const openWhatsappResend", "const handleWhatsappResend");
  assert.ok(opener.includes("setWhatsappResendOrder(order)"));
  assert.ok(!opener.includes("resend-invoice-whatsapp"), "the button click must not send, only open the confirmation");

  assert.match(drawerSource, /<WhatsappResendModal[\s\S]{0,400}?onConfirm=\{handleWhatsappResend\}/);
});

test("only a confirmed send reports success to the cashier", () => {
  const handler = between(drawerSource, "const handleWhatsappResend", "const handleViewDetails");
  // The shared sender throws on a body that says it did not send.
  assert.match(handler, /await sendOrderMessage\(order\.id, "invoice_receipt"\)/);
  const sendIndex = handler.indexOf("await sendOrderMessage(");
  const successIndex = handler.indexOf("toast.success");
  assert.ok(sendIndex >= 0 && successIndex > sendIndex, "the success toast must follow the send that can throw");
});

test("the receipt keeps the orders view grant, on the old route and the new one", () => {
  assert.match(
    routesSource,
    /router\.post\(\s*"\/:id\/resend-invoice-whatsapp",\s*protect,\s*permit\("orders", "view"\),\s*resendOrderInvoiceWhatsapp\s*\)/
  );
  const entry = between(registrySource, "invoice_receipt: Object.freeze({", "export const orderMessageOf");
  assert.match(entry, /permission: Object\.freeze\(\["orders", "view"\]\)/);
  assert.match(entry, /sendInvoiceWhatsapp\(order, \{ force: true \}\)/);
  assert.match(controllerSource, /export const resendOrderInvoiceWhatsapp = \(req, res\) => respondOrderMessage\(req, res, "invoice_receipt"\)/);
});

test("a manual resend clears the auto-send guards but keeps the ones it cannot talk past", () => {
  const block = between(serviceSource, "export const sendInvoiceWhatsapp", "export const findPendingOrderByPhone");
  assert.match(block, /const isManualResend = options\.force === true;/);
  // The shop's auto-send switch is not even read for a hand-driven resend.
  assert.match(block, /const posAutoSendEnabled = !isPosInvoice \|\| isManualResend/);
  // A resend skips already_sent / not_pos_order / not_storefront_order, and stops only
  // at a cancelled invoice or a message that cannot be built.
  assert.match(
    block,
    /: isManualResend\s*\?\s*\["cancelled", "canceled"\]\.includes\(status\)\s*\?\s*"cancelled_order"\s*:\s*missingPieceReason/
  );
  assert.match(block, /const missingPieceReason = !phone\s*\?\s*"missing_phone"/);
  // The automatic path keeps its own once-only guard.
  assert.ok(block.includes('"already_sent"'), "the automatic send must still refuse to fire twice");
});

test("every refusal code the API can answer with has copy in both bundles", () => {
  const shared = between(registrySource, "const SHARED_FAILURES", "export const ORDER_MESSAGES");
  const own = between(between(registrySource, "invoice_receipt: Object.freeze({", "export const orderMessageOf"), "failures:", "fallbackFailure");
  const codes = [...new Set([...`${shared}\n${own}`.matchAll(/^ +([a-z_]+):/gm)].map((match) => match[1]))];
  assert.ok(codes.length >= 7, `expected the failure tables to name their codes, saw ${codes.length}`);
  for (const locale of ["en", "ar"]) {
    const reasons = localeBundle(locale)?.recentOps?.whatsappResend?.reasons || {};
    for (const code of codes) {
      assert.ok(String(reasons[code] || "").trim(), `refusal code ${code} has no ${locale} copy`);
    }
  }
});

test("both bundles carry the resend confirmation copy", () => {
  for (const locale of ["en", "ar"]) {
    const recentOps = localeBundle(locale)?.recentOps;
    assert.ok(String(recentOps?.actions?.whatsapp || "").trim(), `pos.recentOps.actions.whatsapp missing in ${locale}`);
    const resend = recentOps?.whatsappResend;
    for (const key of ["title", "question", "detail", "invoice", "customer", "phone", "total", "confirm", "sending", "buttonHint"]) {
      assert.ok(String(resend?.[key] || "").trim(), `pos.recentOps.whatsappResend.${key} missing in ${locale}`);
    }
    assert.ok(
      String(recentOps?.toasts?.whatsappResent || "").includes("{{invoice}}"),
      `the success toast must name the invoice in ${locale}`
    );
    assert.ok(String(recentOps?.toasts?.whatsappResendFailed || "").trim(), `whatsappResendFailed missing in ${locale}`);
  }
});

test("the receipt send does not pay for data the receipt never carries", () => {
  const block = between(serviceSource, "export const sendInvoiceWhatsapp", "export const findPendingOrderByPhone");
  // loadOrderById drags in the order's items with their product-image fallback chain
  // (1647ms measured) and the shipping address block (895ms). The receipt is a number
  // and a link, so this path reads `orders` and nothing else.
  assert.match(block, /const current = order\?\.id \? await loadOrderForInvoiceSend\(order\.id\) : order;/);
  assert.ok(!block.includes("loadOrderById"), "sendInvoiceWhatsapp must not go through the item-loading order fetch");

  const loader = between(serviceSource, "const loadOrderForInvoiceSend", "const loadLatestOrderByPhone");
  assert.match(loader, /SELECT \* FROM orders WHERE id = \$1 LIMIT 1/);
  assert.ok(!/JOIN/i.test(loader), "the invoice-send loader must not join anything");
});

test("the caller is not held for bookkeeping that happens after delivery", () => {
  const block = between(serviceSource, "export const sendInvoiceWhatsapp", "export const findPendingOrderByPhone");
  // The ledger write and the socket emit run behind the return, so a send that landed
  // is reported the moment it lands - and a failed write can no longer be thrown as a
  // failed send.
  assert.match(block, /void recordDelivery\(\)\.catch\(/);
  assert.ok(!/await recordDelivery\(\)/.test(block), "recordDelivery must not be awaited");
  const sendIndex = block.indexOf("await sendTextMessage(");
  const returnIndex = block.indexOf("return { sent: true");
  const transcriptIndex = block.indexOf("appendWhatsappOutboundSupportReply(");
  const detachIndex = block.indexOf("void recordDelivery()");
  assert.ok(sendIndex >= 0 && transcriptIndex > sendIndex, "the transcript write belongs after the send");
  assert.ok(detachIndex > transcriptIndex && returnIndex > detachIndex, "the return must follow the detached record call");
  // UPDATE orders lives inside recordDelivery, not on the response path.
  const recordBlock = block.slice(block.indexOf("const recordDelivery"), detachIndex);
  assert.match(recordBlock, /UPDATE orders/);
});
