import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { liveBostaShipmentOf } from "../server/modules/shipping/shipping.service.js";

const shippingServiceSource = readFileSync(new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8");
const shippingCenterServiceSource = readFileSync(new URL("../server/modules/shipping/shipping.center.service.js", import.meta.url), "utf8");
const shippingControllerSource = readFileSync(new URL("../server/modules/shipping/shipping.controller.js", import.meta.url), "utf8");
const shippingCenterPageSource = readFileSync(new URL("../src/modules/shipping/pages/ShippingCenter.jsx", import.meta.url), "utf8");

// 2026-08-19: INV-413, INV-516 and INV-517 were each created twice. Bosta answered
// the second call with a second parcel instead of editing the first, and the create
// overwrote tracking_number — so the originals moved to "In progress" with the
// courier while the ERP tracked three "New" parcels nobody would ever collect.
test("an order that already has a live Bosta parcel reports it", () => {
  const shipment = liveBostaShipmentOf({
    shipping_provider_delivery_id: "JFgcPwq0U767DPJCTVZSH",
    shipping_tracking_number: "6809691515",
    shipment_status: "shipment_created",
  });
  assert.equal(shipment.deliveryId, "JFgcPwq0U767DPJCTVZSH");
  assert.equal(shipment.trackingNumber, "6809691515");
});

test("an order with no shipment at all is free to ship", () => {
  assert.equal(liveBostaShipmentOf({}), null);
  assert.equal(liveBostaShipmentOf({ shipment_status: "ready_to_ship" }), null);
  assert.equal(liveBostaShipmentOf({ shipping_provider_delivery_id: "", tracking_number: "" }), null);
});

// A parcel that is over is not a duplicate risk — re-shipping a cancelled or returned
// order is exactly what the operator means to do.
test("a finished parcel does not block a fresh shipment", () => {
  for (const status of ["cancelled", "canceled", "returned", "failed_delivery", "failed"]) {
    assert.equal(liveBostaShipmentOf({ shipping_provider_delivery_id: "abc", shipment_status: status }), null, status);
  }
});

test("a parcel still moving does block a fresh shipment", () => {
  for (const status of ["shipment_created", "picked_up", "in_transit", "out_for_delivery", "delivered"]) {
    assert.ok(liveBostaShipmentOf({ shipping_provider_delivery_id: "abc", shipment_status: status }), status);
  }
});

// The guard is worthless if it runs after the parcel already exists at Bosta.
test("the duplicate check happens before Bosta is called", () => {
  const createBody = shippingServiceSource.slice(shippingServiceSource.indexOf("export const createBostaShipmentForOrder"));
  const guardIndex = createBody.indexOf("throw bostaShipmentExistsError");
  const createCallIndex = createBody.indexOf("await bosta.createDelivery(deliveryPayload)");
  assert.ok(guardIndex > 0, "the create path must refuse an order that already has a parcel");
  assert.ok(createCallIndex > guardIndex, "no delivery is requested before the duplicate check");
  assert.match(shippingServiceSource, /code = "BOSTA_SHIPMENT_EXISTS"/);
});

// A bulk "create again" over a whole selection is the accident itself, so the escape
// hatch is deliberately single-order only.
test("re-issuing is a single-order action, never a bulk one", () => {
  assert.match(shippingControllerSource, /replaceExisting: req\.body\?\.replace_existing === true/);
  assert.doesNotMatch(shippingCenterServiceSource, /replaceExisting/);
});

test("re-issuing cancels the old parcel and names it in the timeline", () => {
  assert.match(shippingServiceSource, /options\.replaceExisting[\s\S]{0,300}cancelDelivery\(existing\.deliveryId\)/);
  assert.match(shippingServiceSource, /replaced_delivery_id: existing\.deliveryId/);
  assert.match(shippingServiceSource, /replaced_tracking_number: existing\.trackingNumber/);
});

// The per-order failures come back inside a 200. Rendering them as a green
// "Action finished with 3 failed" is why the double shipment went unnoticed.
test("a failed bulk action shows the reason instead of a success toast", () => {
  assert.match(shippingCenterPageSource, /const failures = \(result\.results \|\| \[\]\)\.filter\(\(row\) => !row\.success\)/);
  assert.match(shippingCenterPageSource, /toast\.error\(/);
  assert.doesNotMatch(shippingCenterPageSource, /toast\.success\(`Action finished/);
});

const bostaClientSource = readFileSync(new URL("../server/modules/shipping/providers/bosta.client.js", import.meta.url), "utf8");

// `/deliveries/{id}` answers "Cannot GET" — an Express 404 raised before any auth
// check, while every real Bosta path answers 401 errorCode 1028 even unauthenticated.
// So every status refresh this ERP ever made failed with a bare 404, which is exactly
// why no order carries a single `bosta_refresh_status` timeline entry.
test("the status refresh calls a Bosta path that exists", () => {
  assert.match(bostaClientSource, /BOSTA_DELIVERY_STATUS_PATH", "\/deliveries\/business\/\{id\}"/);
  assert.doesNotMatch(bostaClientSource, /BOSTA_DELIVERY_STATUS_PATH", "\/deliveries\/\{id\}"/);
});

test("the refresh keys on the tracking number, not the delivery id", () => {
  const refreshBody = shippingServiceSource.slice(shippingServiceSource.indexOf("export const refreshBostaShipmentForOrder"));
  const identifier = refreshBody.slice(refreshBody.indexOf("const identifier ="), refreshBody.indexOf(";", refreshBody.indexOf("const identifier =")));
  assert.ok(
    identifier.indexOf("shipping_tracking_number") < identifier.indexOf("shipping_provider_delivery_id"),
    "the tracking number must be preferred over the delivery id"
  );
});

// "created" is a fine default right after creating a parcel and a silent lie on a
// refresh: it overwrites a real status and stamps a fresh sync time, which on screen
// reads as "the courier has not moved it yet".
test("an unreadable Bosta response never gets written as 'created'", () => {
  assert.match(shippingServiceSource, /if \(!response\.status_parsed\)/);
  assert.match(shippingServiceSource, /code = "BOSTA_STATUS_UNREADABLE"/);
  const refreshBody = shippingServiceSource.slice(shippingServiceSource.indexOf("export const refreshBostaShipmentForOrder"));
  const cancelIndex = refreshBody.indexOf("export const cancelBostaShipmentForOrder");
  assert.doesNotMatch(refreshBody.slice(0, cancelIndex), /order\.shipping_status \|\| "created"/);
});
