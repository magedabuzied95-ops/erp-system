import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const pageSource = read("../src/modules/orders/pages/OrderDetails.jsx");
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

const localeBundle = (locale) => JSON.parse(read(`../src/locales/${locale}/orders.json`));

test("the button asks before a customer is messaged", () => {
  // The click may only open the question. If the request ever moves into the button,
  // brushing it messages a customer with no way back.
  const button = between(pageSource, `onClick={() => setConfirmationSendOpen(true)}`, `{t("orders.details.confirmationSend.action")}`);
  assert.ok(!button.includes("send-confirmation"), "the button click must open the dialog, not send");
  assert.match(pageSource, /onClick=\{handleSendConfirmation\}/);
});

test("only a confirmed send reports success to the operator", () => {
  const handler = between(pageSource, "const handleSendConfirmation", "const handleCopyPhone");
  assert.match(handler, /api\.post\(`\/orders\/\$\{order\.id\}\/send-confirmation`/);
  assert.match(handler, /if \(response\?\.sent === false\) throw new Error/);
  const guardIndex = handler.indexOf("response?.sent === false");
  const successIndex = handler.indexOf("toast.success");
  assert.ok(guardIndex >= 0 && successIndex > guardIndex, "the success toast must sit behind the sent guard");
});

test("the send route is mounted behind auth and the orders edit grant", () => {
  // A tap on what this sends can confirm, edit or cancel the order, so viewing is not enough.
  assert.match(
    routesSource,
    /router\.post\(\s*"\/:id\/send-confirmation",\s*protect,\s*permit\("orders", "edit"\),\s*sendOrderConfirmationWhatsapp\s*\)/
  );
});

test("the controller forces the send and never dresses a refusal as a success", () => {
  const handler = between(controllerSource, "export const sendOrderConfirmationWhatsapp", "export const confirmShippingPayment");
  assert.match(handler, /sendOrderConfirmation\(order, \{ force: true \}\)/);
  // The outbound queue is the normal path, so a queued message is the success case.
  assert.match(handler, /const queued = Boolean\(result\?\.queued\)/);
  assert.match(handler, /if \(!result\?\.sent && !queued\)[\s\S]{0,500}?res\.status\(400\)/);
  assert.ok(!/res\.status\(200\)[\s\S]{0,240}?sent: false/.test(handler), "a skipped send must never answer 200");
  // A 5xx reaches the browser as an opaque CORS error, so a gateway refusal is a 400.
  assert.match(handler, /catch \(gatewayError\)[\s\S]{0,700}?res\.status\(400\)/);
});

test("a manual send clears only the guards that exist for the automatic one", () => {
  const send = between(serviceSource, "export const sendOrderConfirmation = async", "export const sendPaymentReviewNotification");
  assert.match(send, /const isManualSend = options\.force === true;/);
  // What a human cannot wave away: no phone, and an order already past dispatch.
  const manual = between(send, "const manualBlockReason", "const reason =");
  assert.match(manual, /!phone[\s\S]{0,60}"missing_phone"/);
  assert.match(manual, /isOrderConfirmationProtectedStatus\(status\)[\s\S]{0,80}"order_already_dispatched"/);
  assert.match(manual, /!ORDER_CONFIRMATION_ACTIONABLE_STATUSES\.has\(status\)[\s\S]{0,80}"status_not_confirmable"/);
  // The automatic gate keeps every one of its own four conditions.
  const automatic = between(send, "const reason =", "const shouldSend");
  for (const guard of ["not_storefront_order", "not_cod_order", "not_pending_confirmation", "already_sent"]) {
    assert.ok(automatic.includes(guard), `the automatic send lost its ${guard} guard`);
  }
});

test("a resend carries its own idempotency key", () => {
  // Same order + same automation is one queued message forever. Without a fresh key the
  // queue answers "duplicate" and the customer is never messaged again.
  const send = between(serviceSource, "export const sendOrderConfirmation = async", "export const sendPaymentReviewNotification");
  assert.match(send, /idempotencySuffix: isManualSend \? `manual-\$\{Date\.now\(\)\}` : ""/);
});

test("the customer's tap lands on the statuses a manual send can reach", () => {
  // sendOrderConfirmation may now be fired at a `pending` order - a till-raised online order or
  // a gateway checkout. If applyConfirmationAction still refused those, the buttons we just sent
  // would silently do nothing.
  assert.match(serviceSource, /const ORDER_CONFIRMATION_ACTIONABLE_STATUSES = new Set\(\[[\s\S]{0,240}?\]\);/);
  const actionable = between(serviceSource, "const ORDER_CONFIRMATION_ACTIONABLE_STATUSES", "const ORDER_CONFIRMATION_SINGLE_USE_ACTIONS");
  for (const status of ["pending", "pending_confirmation", "confirmed", "edit_requested"]) {
    assert.ok(actionable.includes(`"${status}"`), `a ${status} order must still accept a confirm tap`);
  }
  // Past dispatch is still refused, and by the other set.
  for (const status of ["shipped", "delivered", "out_for_delivery"]) {
    assert.ok(!actionable.includes(`"${status}"`), `${status} must not be confirmable`);
  }
  const apply = between(serviceSource, "async function applyConfirmationAction", "export { applyConfirmationAction }");
  assert.equal(
    apply.split("ORDER_CONFIRMATION_ACTIONABLE_STATUSES.has(currentStatus)").length - 1,
    2,
    "both the confirm and the edit branch must read the shared set"
  );
  assert.ok(apply.includes("isOrderConfirmationProtectedStatus(currentStatus)"), "the dispatch lock must stay");
});

test("both locales carry the dialog copy", () => {
  const keys = ["action", "title", "question", "detail", "invoice", "customer", "phone", "lastSent", "neverSent", "confirm", "sending", "sent", "failed", "noPhone"];
  for (const locale of ["ar", "en"]) {
    const bundle = localeBundle(locale).details?.confirmationSend;
    assert.ok(bundle, `${locale} is missing orders.details.confirmationSend`);
    for (const key of keys) {
      assert.ok(String(bundle[key] || "").trim(), `${locale} is missing orders.details.confirmationSend.${key}`);
    }
  }
});
