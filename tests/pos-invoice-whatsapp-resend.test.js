import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const drawerSource = read("../src/modules/pos/components/RecentOperationsDrawer.jsx");
const routesSource = read("../server/routes/orders.js");
const controllerSource = read("../server/controllers/ordersController.js");
const serviceSource = read("../server/services/whatsappOrderConfirmationService.js");

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
  assert.match(handler, /api\.post\(`\/orders\/\$\{order\.id\}\/resend-invoice-whatsapp`/);
  assert.match(handler, /if \(response\?\.sent === false\) throw new Error/);
  const guardIndex = handler.indexOf("response?.sent === false");
  const successIndex = handler.indexOf("toast.success");
  assert.ok(guardIndex >= 0 && successIndex > guardIndex, "the success toast must sit behind the sent guard");
});

test("the resend route is mounted behind auth and the orders grant", () => {
  assert.match(
    routesSource,
    /router\.post\(\s*"\/:id\/resend-invoice-whatsapp",\s*protect,\s*permit\("orders", "view"\),\s*resendOrderInvoiceWhatsapp\s*\)/
  );
});

test("a refusal answers 4xx with a reason instead of a 5xx or a false success", () => {
  const handler = between(controllerSource, "export const resendOrderInvoiceWhatsapp", "export const confirmShippingPayment");
  assert.match(handler, /sendInvoiceWhatsapp\(order, \{ force: true \}\)/);
  // A service that declined to send must not surface as a success.
  assert.match(handler, /if \(!result\?\.sent\)[\s\S]{0,500}?res\.status\(400\)/);
  assert.ok(!/res\.status\(200\)[\s\S]{0,240}?sent: false/.test(handler), "a skipped send must never answer 200");
  // A 5xx reaches the browser as an opaque CORS error, so the gateway refusal is a 400.
  assert.match(handler, /catch \(gatewayError\)[\s\S]{0,1200}?res\.status\(400\)[\s\S]{0,300}?reason: "gateway_error"/);
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
  const table = between(controllerSource, "const INVOICE_RESEND_FAILURE_MESSAGES", "const invoiceResendFailureMessage");
  const codes = [...table.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]);
  assert.ok(codes.length >= 6, `expected the failure table to name its codes, saw ${codes.length}`);
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
