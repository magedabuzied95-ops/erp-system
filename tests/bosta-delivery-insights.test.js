import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BOSTA_STATE_CODES,
  extractBostaInsights,
  normalizeBostaFeeEstimate,
  normalizeBostaPickupDates,
  normalizeBostaPickupLocations,
  normalizeBostaPickups,
  normalizeBostaStatus,
  mapOrderToBostaDeliveryUpdatePayload,
} from "../server/modules/shipping/providers/bosta.mapper.js";
import { bostaCustomerFailureReason, parseBostaPromiseDate } from "../shared/bostaDeliveryInsights.js";
import { renderShipmentTemplate, SHIPMENT_NOTIFICATION_DEFAULTS } from "../shared/shipmentNotificationTemplates.js";

const clientSource = readFileSync(new URL("../server/modules/shipping/providers/bosta.client.js", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8");
const whatsappSource = readFileSync(new URL("../server/services/whatsappShippingService.js", import.meta.url), "utf8");

// The webhook body exactly as Bosta documents it (docs.bosta.co), on an Exception.
const EXCEPTION_WEBHOOK = {
  _id: "NGnhfEz_cb",
  trackingNumber: 48089608,
  state: 47,
  type: "SEND",
  timeStamp: 1689252908261,
  deliveryPromiseDate: "13-07-2023",
  exceptionReason: "Customer is not answering.",
  exceptionCode: 7,
  businessReference: "INV-620",
  numberOfAttempts: 2,
};

test("a failed-attempt webhook yields the reason, the attempt count and the promised day", () => {
  const insights = extractBostaInsights(EXCEPTION_WEBHOOK);
  assert.equal(insights.exception_code, 7);
  assert.equal(insights.exception_reason, "العميل مبيردش");
  assert.equal(insights.exception_reason_raw, "Customer is not answering.");
  assert.equal(insights.attempts, 2);
  assert.equal(insights.promise_date, "2023-07-13");
  assert.equal(insights.is_delivery_view, false);
});

test("a delivered webhook carries the collected COD and the confirmation flag", () => {
  const insights = extractBostaInsights({ _id: "x", trackingNumber: "1", state: 45, cod: 1895, isConfirmedDelivery: true, numberOfAttempts: 0 });
  assert.equal(insights.reported_cod, 1895);
  assert.equal(insights.confirmed_delivery, true);
  assert.equal(insights.exception_code, null, "no exception fields on a delivered event");
});

// A field the payload did not carry must come back null, never 0 or false: the writer
// keeps the stored value for null, so a bare webhook cannot erase what a refresh stored.
test("fields a payload lacks stay null so they never overwrite stored values", () => {
  const insights = extractBostaInsights({ _id: "x", trackingNumber: "1", state: 24 });
  for (const key of ["exception_code", "attempts", "confirmed_delivery", "reported_cod", "shipment_fees"]) {
    assert.equal(insights[key], null, key);
  }
  assert.equal(insights.courier_name, "");
});

// The business delivery view from the official spec.
test("the delivery view yields fees, attempts, history and Bosta's next step", () => {
  const insights = extractBostaInsights({
    success: true,
    data: {
      _id: "NGnhfEz_cb",
      state: { code: 41, value: "Picked up" },
      maskedState: "Out for delivery",
      deliveryAttemptsLength: 1,
      shipmentFees: 63.949,
      star: { name: "Ahmed Star", phone: "01099999999" },
      timeline: [
        { value: "Created", nextAction: "Please pack the shipment", done: true },
        { value: "Out for delivery", nextAction: "Shipment is about to be delivered to your customer", done: false },
      ],
      history: [{ title: "Created", date: "2021-02-08T12:38:07.275Z", subs: [{ title: "You Created this package", date: "2021-02-08T12:38:07.275Z" }] }],
    },
  });
  assert.equal(insights.shipment_fees, 63.949);
  assert.equal(insights.attempts, 1);
  assert.equal(insights.courier_name, "Ahmed Star");
  assert.equal(insights.courier_phone, "01099999999");
  assert.equal(insights.next_action, "Shipment is about to be delivered to your customer");
  assert.equal(insights.history.length, 1);
  assert.equal(insights.is_delivery_view, true);
});

test("Bosta's promise date is read day-first and a non-date is refused", () => {
  assert.equal(parseBostaPromiseDate("13-07-2023"), "2023-07-13");
  assert.equal(parseBostaPromiseDate("2026-09-18"), "2026-09-18");
  assert.equal(parseBostaPromiseDate("31-02-2026"), "", "no such day");
  assert.equal(parseBostaPromiseDate("soon"), "");
  assert.equal(parseBostaPromiseDate(null), "");
});

// Codes from the official state table. The old hand-written table invented code 50 and
// described 22–24 as the wrong events.
test("state codes follow Bosta's official table", () => {
  assert.equal(normalizeBostaStatus(24), "in_transit", "24 is received at warehouse");
  assert.equal(normalizeBostaStatus(41), "out_for_delivery");
  assert.equal(normalizeBostaStatus(46), "returned");
  assert.equal(normalizeBostaStatus(47, "Exception"), "failed_delivery");
  assert.equal(normalizeBostaStatus(60), "returned", "returned to stock");
  assert.equal(BOSTA_STATE_CODES[50], undefined, "50 is not a Bosta state");
  for (const untracked of [102, 104, 105]) assert.equal(BOSTA_STATE_CODES[untracked], undefined, `${untracked} must not move an order`);
});

test("an object state is decided by its code, not by its words", () => {
  assert.equal(normalizeBostaStatus({ code: 41, value: "Picked up" }), "out_for_delivery");
  assert.equal(normalizeBostaStatus({ code: 999, value: "Delivered" }), "delivered", "an unknown code still falls back to the words");
});

// Only reasons the customer can fix by replying may reach the customer.
test("a refusal or a shop-side cancellation is never messaged to the customer", () => {
  for (const code of [1, 5, 7, 13, 14]) assert.ok(bostaCustomerFailureReason(code), `code ${code} is customer-actionable`);
  for (const code of [2, 3, 4, 6, 8, 12, 26, 100, 101, null]) assert.equal(bostaCustomerFailureReason(code), "", `code ${code} must not reach the customer`);
});

test("the failed-delivery message names the reason and drops nothing it needs", () => {
  const rendered = renderShipmentTemplate(SHIPMENT_NOTIFICATION_DEFAULTS.delivery_failed.template, {
    order_number: "INV-620",
    failure_reason: bostaCustomerFailureReason(7),
  });
  assert.match(rendered, /INV-620/);
  assert.match(rendered, /المندوب اتصل بيك ومحدش رد/);
});

test("the out-for-delivery message names the courier only when Bosta gave one", () => {
  const withCourier = renderShipmentTemplate(SHIPMENT_NOTIFICATION_DEFAULTS.out_for_delivery.template, { order_number: "INV-1", courier_name: "Ahmed", courier_phone: "0100" });
  assert.match(withCourier, /المندوب: Ahmed/);
  const without = renderShipmentTemplate(SHIPMENT_NOTIFICATION_DEFAULTS.out_for_delivery.template, { order_number: "INV-1" });
  assert.doesNotMatch(without, /رقم المندوب/);
});

// Each failed day is its own message: the claim is per attempt, not once per order.
test("the failed-delivery claim is per attempt, with a per-attempt queue key", () => {
  assert.match(whatsappSource, /COALESCE\(whatsapp_delivery_failed_attempt, 0\) < \$2/);
  assert.match(whatsappSource, /idempotencySuffix = type === "delivery_failed" \? `attempt_/);
});

test("pickup dates without a year roll into next year rather than into the past", () => {
  const dates = normalizeBostaPickupDates({ data: ["Tue, 30 Dec.", "Thu, 1 Jan."] }, new Date(2026, 11, 29));
  assert.deepEqual(dates.map((row) => row.date), ["2026-12-30", "2027-01-01"]);
});

test("pickup locations and pickups normalise from the spec's shapes", () => {
  const locations = normalizeBostaPickupLocations({ data: { list: [{ _id: "yfWPU0tP2", locationName: "Main", isDefault: true, address: { firstLine: "Nasr City", city: { name: "Cairo" }, district: "Nasr City" } }] } });
  assert.equal(locations[0].id, "yfWPU0tP2");
  assert.equal(locations[0].city, "Cairo");
  const pickups = normalizeBostaPickups({ data: { list: [{ _id: "070000001729", state: "Requested", scheduledDate: "6/5/2021", business: { _id: "rHN7QJsXr", locationName: "Main" }, star: { name: "Rehab", phone: "0158" } }] } });
  assert.equal(pickups[0].business_id, "rHN7QJsXr");
  assert.equal(pickups[0].courier_name, "Rehab");
});

test("an undocumented pricing response still yields a figure when it has one", () => {
  assert.equal(normalizeBostaFeeEstimate({ data: { priceAfterVat: 71.5 } }).fees, 71.5);
  assert.equal(normalizeBostaFeeEstimate({ data: { tiers: [{ shipmentFees: 60 }] } }).fees, 60);
  assert.equal(normalizeBostaFeeEstimate({ data: {} }).fees, null);
});

// Money on a live parcel is changed on purpose in Bosta's dashboard, never as a side
// effect of fixing an address.
test("pushing an address fix to Bosta never sends the COD", () => {
  const body = mapOrderToBostaDeliveryUpdatePayload({ order: { customer_name: "Mona Ali", customer_phone: "01000000000", street_address: "12 Abbas El Akkad street", cod_amount: 900 }, city: { provider_city_id: "c" }, zone: {}, district: { provider_district_id: "d" }, codAmount: 900 });
  assert.equal("cod" in body, false);
  assert.equal(body.receiver.phone, "01000000000");
  assert.ok(body.dropOffAddress.firstLine);
});

// `POST /deliveries/{id}/cancel` answers "Cannot POST" — the route does not exist, so every
// cancel left the parcel live at Bosta while the ERP said cancelled.
test("cancelling calls Bosta's real terminate route, keyed by tracking number", () => {
  assert.match(clientSource, /"\/deliveries\/business\/\{id\}\/terminate"/);
  assert.match(clientSource, /method: "DELETE"/);
  assert.doesNotMatch(clientSource, /"\/deliveries\/\{id\}\/cancel"/);
  const cancelBody = serviceSource.slice(serviceSource.indexOf("export const cancelBostaShipmentForOrder"));
  const identifier = cancelBody.slice(cancelBody.indexOf("const identifier ="), cancelBody.indexOf(";", cancelBody.indexOf("const identifier =")));
  assert.ok(identifier.indexOf("shipping_tracking_number") < identifier.indexOf("shipping_provider_delivery_id"), "tracking number first");
});

// A refresh that lands on "on hold" must keep the details and leave the status alone.
test("a refresh on a state the ERP does not track stores details without moving the order", () => {
  const refreshBody = serviceSource.slice(serviceSource.indexOf("export const refreshBostaShipmentForOrder"));
  const guard = refreshBody.indexOf("if (!ERP_SHIPPING_STATUSES.has(status))");
  const update = refreshBody.indexOf("UPDATE orders SET");
  assert.ok(guard > 0 && update > guard, "the untracked-state return must come before the status write");
});

// The reason has to be on the order in the same transaction as the failed status.
test("webhook insights are written inside the status transaction", () => {
  const webhookBody = serviceSource.slice(serviceSource.indexOf("export const processBostaWebhook"));
  const begin = webhookBody.indexOf('client.query("BEGIN")');
  const apply = webhookBody.indexOf("applyBostaInsights(client, order.id, insights");
  const lastCommit = webhookBody.lastIndexOf('client.query("COMMIT")');
  assert.ok(apply > begin && apply < lastCommit);
  assert.match(webhookBody, /void operations\.runAfterBostaEvent\(/);
});

test("Bosta's epoch-millisecond timeStamp becomes a real timeline date", async () => {
  const { previewBostaWebhookPayload } = await import("../server/modules/shipping/shipping.service.js");
  const preview = previewBostaWebhookPayload(EXCEPTION_WEBHOOK);
  assert.equal(preview.parsed.occurredAt, new Date(1689252908261).toISOString());
  assert.equal(preview.parsed.status, "failed_delivery");
});

const centerServiceSource = readFileSync(new URL("../server/modules/shipping/shipping.center.service.js", import.meta.url), "utf8");
const settlementsServiceSource = readFileSync(new URL("../server/modules/shipping/shipping.settlements.service.js", import.meta.url), "utf8");
const centerPageSource = readFileSync(new URL("../src/modules/shipping/pages/ShippingCenter.jsx", import.meta.url), "utf8");
const settlementsPageSource = readFileSync(new URL("../src/modules/shipping/pages/CourierSettlements.jsx", import.meta.url), "utf8");
const orderPanelSource = readFileSync(new URL("../src/modules/orders/components/BostaShipmentInsights.jsx", import.meta.url), "utf8");
const orderDetailsSource = readFileSync(new URL("../src/modules/orders/pages/OrderDetails.jsx", import.meta.url), "utf8");
const operationsSource = readFileSync(new URL("../server/modules/shipping/bosta.operations.js", import.meta.url), "utf8");

// The list someone works from today: a failed attempt that is still open.
test("the Shipping Center can filter down to the parcels that need a call", () => {
  assert.match(centerServiceSource, /query\.needsAction === "1"/);
  assert.match(centerServiceSource, /bosta_exception_code IS NOT NULL AND COALESCE\(o\.shipment_status, o\.shipping_status, ''\) NOT IN \('delivered', 'returned', 'cancelled'\)/);
  assert.match(centerPageSource, /setFilter\("needsAction"/);
  assert.match(centerPageSource, /order\.bosta_exception_reason/);
});

// Fees typed off a PDF are how a settlement drifts from what Bosta actually charged.
test("the settlement starts from Bosta's own per-parcel fees", () => {
  assert.match(settlementsServiceSource, /o\.bosta_shipment_fees AS shipment_fees/);
  assert.match(settlementsPageSource, /const bostaFees = useMemo\(/);
  assert.match(settlementsPageSource, /const fees = feesPrefilled \? bostaFees : round2\(form\.fees\)/);
});

// The empty "رابط الملصق" field is gone: Bosta never fills it.
test("the order screen prints the airway bill instead of showing an empty label link", () => {
  assert.doesNotMatch(orderDetailsSource, /orders\.shipping\.labelLink/);
  assert.match(orderDetailsSource, /<BostaShipmentInsights/);
  assert.match(orderPanelSource, /action: "print_labels", order_ids: \[order\.id\]/);
});

// One alert per attempt, claimed in SQL — a retried webhook must not alert twice.
test("the manager alert is claimed per attempt", () => {
  assert.match(operationsSource, /COALESCE\(bosta_alerted_attempt, 0\) < \$2::integer/);
  assert.match(operationsSource, /type: "bosta_delivery_exception"/);
  assert.match(operationsSource, /type: "bosta_cod_mismatch"/);
});

// A payload without a field must never blank what an earlier payload stored.
test("the insights writer keeps stored values when a payload omits them", () => {
  assert.match(operationsSource, /bosta_courier_name = COALESCE\(NULLIF\(\$11::text, ''\), bosta_courier_name\)/);
  assert.match(operationsSource, /bosta_attempts = CASE WHEN \$6::integer IS NULL THEN bosta_attempts ELSE GREATEST/);
});
