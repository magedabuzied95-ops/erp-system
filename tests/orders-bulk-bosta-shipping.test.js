import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { canCreateBostaShipmentFor } from "../server/modules/shipping/shipping.center.service.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ordersPageSource = read("../src/modules/orders/pages/OrdersDashboard.jsx");
const centerServiceSource = read("../server/modules/shipping/shipping.center.service.js");
const centerControllerSource = read("../server/modules/shipping/shipping.center.controller.js");
const gatewaySource = read("../server/services/whatsappGatewayService.js");
const arOrders = JSON.parse(read("../src/locales/ar/orders.json"));
const enOrders = JSON.parse(read("../src/locales/en/orders.json"));

/*
 * An order that never picked a courier IS the ordinary case on the orders list —
 * the column holds the `manual` / `in_store_delivery` default — so refusing it
 * would leave the new button doing nothing on almost every row. What must stay
 * refused is an order already booked with a DIFFERENT courier: creating a Bosta
 * parcel for it puts two vans on the same box.
 */
test("only a Bosta order, or one with no courier yet, may be created on Bosta", () => {
  assert.equal(canCreateBostaShipmentFor("bosta", ""), true, "a Bosta order never needed the override");
  assert.equal(canCreateBostaShipmentFor("BOSTA", "bosta"), true);

  for (const providerless of ["", "manual", "in_store_delivery", "store_pickup"]) {
    assert.equal(canCreateBostaShipmentFor(providerless, "bosta"), true, `${providerless} should be bookable on request`);
    assert.equal(canCreateBostaShipmentFor(providerless, ""), false, `${providerless} must not be booked without an explicit provider`);
  }

  for (const courier of ["mylerz", "shipblu", "aramex"]) {
    assert.equal(canCreateBostaShipmentFor(courier, "bosta"), false, `${courier} must never be overwritten`);
    assert.equal(canCreateBostaShipmentFor(courier, ""), false);
  }
});

test("the Shipping Center's own queue keeps its behaviour: the override is opt-in per request", () => {
  assert.match(centerControllerSource, /provider: req\.body\?\.provider \|\| req\.body\?\.shipping_provider \|\| ""/);
  const shippingCenterPage = read("../src/modules/shipping/pages/ShippingCenter.jsx");
  const bulkCall = shippingCenterPage.slice(shippingCenterPage.indexOf('api.post("/shipping/center/bulk", { action, order_ids: selectedIds })'));
  assert.ok(bulkCall.startsWith('api.post("/shipping/center/bulk", { action, order_ids: selectedIds })'), "the Shipping Center still sends no provider override");
});

/*
 * The orders bar sends only the rows that can actually be shipped. Sending the
 * whole selection and letting the server refuse the rest would answer a routine
 * click with a wall of red for orders nobody meant to re-ship.
 */
test("rows that already have a parcel are held back from the bulk create", () => {
  const handler = ordersPageSource.slice(
    ordersPageSource.indexOf("const bulkCreateShipments = async"),
    ordersPageSource.indexOf("const bulkPrint = async")
  );
  assert.ok(handler.length > 0, "the bulk create handler must exist");
  assert.match(handler, /alreadyShipped = selectedOrders\.filter\(\(order\) => orderShipmentReference\(order\)\)/);
  assert.match(handler, /order_ids: targets\.map\(\(order\) => order\.id\)/);
  assert.match(handler, /provider: "bosta"/);
  // Per-order failures come back inside a 200, so they have to be read out of the body.
  assert.match(handler, /const failures = rows\.filter\(\(row\) => !row\.success\)/);
  assert.match(handler, /toast\.error\(`\$\{t\("orders\.bulk\.shipmentFailed"/);
});

test("the bulk print asks for the airway bill and its inbox delivery in one request", () => {
  const handler = ordersPageSource.slice(
    ordersPageSource.indexOf("const bulkPrint = async"),
    ordersPageSource.indexOf("const exportSelected =")
  );
  assert.ok(handler.length > 0, "the bulk print handler must exist");
  assert.match(handler, /action: "print_labels"/);
  assert.match(handler, /send_to_inbox: true/);
  // The tab is claimed before the await or the popup blocker eats it.
  assert.ok(
    handler.indexOf("window.open(\"\", \"_blank\")") < handler.indexOf("await api.post"),
    "the print tab must be opened inside the click, before the request"
  );
  // A selection with no parcel on it still has invoices to print.
  assert.match(handler, /if \(!withShipment\.length\) \{\s*await printOrders\(selectedOrders\);/);
});

test("the label PDF is sent as a document, not as an image", () => {
  assert.match(gatewaySource, /export const sendDocumentMessage = async/);
  const sender = gatewaySource.slice(gatewaySource.indexOf("export const sendDocumentMessage"));
  assert.match(sender.slice(0, 2000), /mediatype: "document"/);
  assert.match(sender.slice(0, 2000), /fileName: safeFileName/);

  const delivery = centerServiceSource.slice(centerServiceSource.indexOf("const deliverLabelsToInbox"));
  assert.match(delivery.slice(0, 4000), /sendDocumentMessage\(/);
  assert.match(delivery.slice(0, 4000), /messageType: "document"/);
  // The bubble is written whether or not WhatsApp took the file: a failed send has
  // to be visible in the thread instead of only in a log line.
  assert.match(delivery.slice(0, 4000), /deliveryStatus = "failed"/);
  assert.match(delivery.slice(0, 4000), /appendChannelOutboundSupportReply/);
});

test("the labels go to a canonical whatsapp session so a reply lands on the same thread", () => {
  const delivery = centerServiceSource.slice(centerServiceSource.indexOf("const deliverLabelsToInbox"));
  assert.match(delivery.slice(0, 4000), /normalizeWhatsappSessionId\(rawPhone, canonicalPhone\) \|\| `whatsapp:\$\{canonicalPhone\}`/);
  assert.match(delivery.slice(0, 4000), /upsertChannelConversationMapping/);
  assert.match(centerServiceSource, /const DEFAULT_LABEL_INBOX_PHONE = "01019719986"/);
  assert.match(centerServiceSource, /process\.env\.SHIPPING_LABEL_INBOX_PHONE/);
});

/*
 * Arabic has six plural categories, so a `_one`/`_other` pair silently renders the
 * ENGLISH string for counts 2, 3 and 11. Every counted string here is one
 * non-suffixed key phrased to read at any count.
 */
test("the new bulk copy exists in both locales with no plural suffixes", () => {
  const keys = [
    "createShipment",
    "createShipmentBusy",
    "createShipmentHint",
    "printHint",
    "shipmentCreating",
    "shipmentCreated",
    "shipmentFailed",
    "shipmentFailedAll",
    "shipmentAllExist",
    "shipmentNoEligible",
    "shipmentSkippedExisting",
    "shipmentSkippedProvider",
    "labelPreparing",
    "labelBusy",
    "labelReady",
    "labelFailed",
    "labelPopupBlocked",
    "labelSentToInbox",
    "labelInboxFailed",
    "labelSkipped",
  ];
  for (const key of keys) {
    assert.ok(arOrders.bulk[key], `ar orders.bulk.${key} is missing`);
    assert.ok(enOrders.bulk[key], `en orders.bulk.${key} is missing`);
  }
  for (const key of Object.keys(arOrders.bulk)) {
    assert.doesNotMatch(key, /_(zero|one|two|few|many|other)$/, `${key} uses an i18next plural suffix`);
  }
});
