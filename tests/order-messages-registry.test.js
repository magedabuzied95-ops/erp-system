import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const registrySource = read("../server/modules/orders/orderMessages.js");
const shippingSource = read("../server/services/whatsappShippingService.js");
const controllerSource = read("../server/controllers/ordersController.js");
const routesSource = read("../server/routes/orders.js");
const inboxPanelSource = read("../src/shared/components/inboxCustomerOrders/InboxCustomerOrdersPanel.jsx");
const pageSource = read("../src/modules/orders/pages/OrderDetails.jsx");

const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  assert.ok(end > start, `missing marker: ${endMarker}`);
  return source.slice(start, end);
};

const entryOf = (key, nextMarker) => between(registrySource, `${key}: Object.freeze({`, nextMarker);

test("the send route checks the grant the picked message names", () => {
  const guard = between(routesSource, "const permitOrderMessage", "router.get(");
  assert.match(guard, /orderMessageOf\(req\.params\.key\)/);
  assert.match(guard, /res\.status\(404\)/);
  assert.match(guard, /permit\(\.\.\.entry\.permission\)\(req, res, next\)/);
  assert.match(routesSource, /"\/:id\/messages\/:key",\s*protect,\s*permitOrderMessage,\s*sendOrderMessageWhatsapp/);
  assert.match(routesSource, /"\/:id\/messages",\s*protect,\s*permit\("orders", "view"\),\s*listOrderMessagesWhatsapp/);
});

test("the shipping update sends the message for where the parcel is now, on purpose", () => {
  const entry = entryOf("shipping_update", "shipping_fee_payment_card: Object.freeze({");
  assert.match(entry, /send: \(\{ order \}\) => resendShipmentNotification\(order\)/);
  const resend = between(shippingSource, "export const resendShipmentNotification", "export const sendShipmentNotificationForStatus");
  assert.match(resend, /shipmentNotificationTypeFor\(current\.shipment_status \|\| current\.shipping_status\)/);
  assert.match(resend, /if \(!type\) return \{ sent: false, reason: "no_shipping_update" \}/);
  assert.match(resend, /sendShippingNotification\(current, type, \{ force: true \}\)/);
  // The automatic path and the manual one read the same status map.
  const automatic = between(shippingSource, "export const sendShipmentNotificationForStatus", "export default");
  assert.match(automatic, /const type = shipmentNotificationTypeFor\(normalized\)/);
});

test("a manual shipping send steps past the switch and the once-only claim, nothing else", () => {
  const send = between(shippingSource, "const sendShippingNotification = async", "export const sendShipmentCreated");
  assert.match(send, /const isManualSend = options\.force === true;/);
  assert.match(send, /!settings\.enabled && !isManualSend/);
  // Eligibility and the pieces the message needs still hold for a human.
  for (const reason of ["missing_phone", "empty_template", "config.skipReason"]) assert.ok(send.includes(reason), `${reason} must still stop a manual send`);
  // The once-only guards are dropped only for the manual send, and the stamp is still written.
  assert.match(send, /\$\{isManualSend \? "" : `AND \$\{custom\.where\}`\}/);
  assert.match(send, /\$\{isManualSend \? "" : `AND \$\{config\.column\} IS NULL`\}/);
  assert.match(send, /SET \$\{config\.column\} = \$\{isManualSend \? "NOW\(\)" : `COALESCE/);
  // Without a fresh key the queue answers "duplicate" and the customer is never messaged again.
  assert.match(send, /const idempotencySuffix = isManualSend\s*\? `manual-\$\{Date\.now\(\)\}`/);
});

test("the payment card answers its coded refusals instead of crashing on them", () => {
  const entry = entryOf("shipping_fee_payment_card", "export const orderMessageOf");
  assert.match(entry, /permission: Object\.freeze\(\["orders", "edit"\]\)/);
  assert.match(entry, /sendShippingFeePaymentRequest\(\{ orderId: order\.id, tenantId, amount: Number\(input\.amount\) \|\| 0 \}\)/);
  assert.match(entry, /if \(!refusal\) throw error;/);
  assert.match(entry, /reason: PAYMENT_CARD_REASONS\[error\.code\] \|\| String\(error\.code\)\.toLowerCase\(\), message: error\.message/);
  // Its card only goes through the queue, so a queued card is the success case.
  assert.match(entry, /return \{ sent: false, queued: true, response:/);
  // The service's own wording reaches the operator when the registry has none for that code.
  assert.match(registrySource, /entry\?\.failures\?\.\[reason\] \|\| String\(serviceMessage \|\| ""\)\.trim\(\)/);
});

test("the old payment-card route and the inbox go through the registry", () => {
  assert.match(controllerSource, /export const requestOrderShippingFeePayment = \(req, res\) => respondOrderMessage\(req, res, "shipping_fee_payment_card"\)/);
  assert.match(controllerSource, /input: req\.body \|\| \{\}/);
  assert.match(inboxPanelSource, /sendOrderMessage\(order\.id, "shipping_fee_payment_card", \{ headers, body: typed > 0 \? \{ amount: typed \} : \{\} \}\)/);
  assert.ok(!inboxPanelSource.includes("/request-shipping-fee"), "the inbox must not post to the old route");
  // The order page sends a typed deposit only with the payment card.
  assert.match(pageSource, /messageKey === "shipping_fee_payment_card" && amount > 0 \? \{ amount \} : \{\}/);
});
