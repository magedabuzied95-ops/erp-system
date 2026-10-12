import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  JOURNEY_LABELS,
  buildPublicShipment,
  customerCourierName,
  mergeJourneySteps,
  shouldRefreshForCustomer,
} from "../server/modules/shipping/publicShipmentJourney.js";
import { STOREFRONT_JOURNEY_KEYS, journeyStepKey, trackingStageKey } from "../src/storefront/lib/serverCopy.js";

// /track tells the customer where the Bosta parcel is, step by step, in our words —
// built from the webhook rows, our own shipment timeline and Bosta's delivery history.

const bostaOrder = (extra = {}) => ({
  id: 77,
  shipping_provider: "bosta",
  shipping_tracking_number: "52112345",
  shipment_status: "in_transit",
  shipment_timeline: [
    { at: "2026-10-10T09:00:00.000Z", action: "bosta_create_delivery", provider: "bosta", status: "shipment_created" },
    { at: "2026-10-11T16:00:00.000Z", action: "bosta_refresh_status", provider: "bosta", status: "picked_up" },
    { at: "2026-10-11T18:00:00.000Z", action: "order_note", provider: "staff", status: "whatever" },
  ],
  bosta_details: {
    state_code: 24,
    history: [
      { title: "Created", date: "2026-10-10T08:59:00.000Z" },
      { title: "Picked up", date: "2026-10-11T12:30:00.000Z" },
      { title: "Received at warehouse", date: "2026-10-11T20:15:00.000Z" },
      { title: "Something Bosta added later", date: "2026-10-11T21:00:00.000Z" },
    ],
  },
  bosta_courier_name: "Ahmed",
  bosta_courier_phone: "+20 100 000 0000",
  bosta_promise_date: "2026-10-14",
  ...extra,
});

test("Bosta's pickup reaches the customer as its own step, at the earliest time any source knows", () => {
  const shipment = buildPublicShipment(bostaOrder());
  assert.equal(shipment.stage, "at_warehouse", "state 24 is finer than the in_transit status column");
  const keys = shipment.events.map((event) => event.key);
  assert.deepEqual(keys, ["at_warehouse", "picked_up", "created"], "newest first, unknown titles dropped, staff entries ignored");
  const pickedUp = shipment.events.find((event) => event.key === "picked_up");
  assert.equal(pickedUp.at, "2026-10-11T12:30:00.000Z", "the refresh only learned it later; Bosta's history has the real moment");
  assert.equal(pickedUp.label, JOURNEY_LABELS.picked_up);
  assert.match(pickedUp.label, /بوسطة/);
});

test("only customer-safe fields leave: no payload, no staff reason, courier only while out for delivery", () => {
  const moving = buildPublicShipment(bostaOrder());
  assert.equal(moving.courier, null, "the courier is nobody's business before the parcel is with them");
  assert.deepEqual(Object.keys(moving).sort(), ["alert", "attempts", "courier", "events", "promise_date", "provider", "stage", "stage_label", "synced_at", "tracking_number"]);
  const out = buildPublicShipment(bostaOrder({ shipment_status: "out_for_delivery", bosta_details: { state_code: 41, history: [] } }));
  assert.equal(out.stage, "out_for_delivery");
  assert.deepEqual(out.courier, { name: "Ahmed", phone: "+201000000000" });
  const delivered = buildPublicShipment(bostaOrder({ shipment_status: "delivered", bosta_details: { state_code: 45 }, bosta_courier_name: "OB-Ahmed Mohammad Amin -Z" }));
  assert.deepEqual(delivered.courier, { name: "Ahmed Mohammad Amin", phone: "" }, "after delivery: the name only, no number to call");
  const serialized = JSON.stringify(buildPublicShipment(bostaOrder({ bosta_exception_reason: "staff-only words" }), {
    events: [{ status: "in_transit", created_at: "2026-10-11T22:00:00Z", payload: { state: 30, secret: "raw-bosta-body" } }],
  }));
  assert.doesNotMatch(serialized, /raw-bosta-body|staff-only words/);
});

test("Bosta's hub prefix and zone suffix come off the courier's name, a real hyphenated name stays", () => {
  assert.equal(customerCourierName("OB-Ahmed Mohammad Amin -Z"), "Ahmed Mohammad Amin");
  assert.equal(customerCourierName("GZ - Mahmoud Saeed - 12"), "Mahmoud Saeed");
  assert.equal(customerCourierName("Ali-Hassan"), "Ali-Hassan");
  assert.equal(customerCourierName("محمود سعيد"), "محمود سعيد");
  assert.equal(customerCourierName(null), "");
});

test("webhook rows carry Bosta's code and its own timestamp", () => {
  const shipment = buildPublicShipment(bostaOrder({ shipment_timeline: [], bosta_details: null, shipment_status: "in_transit" }), {
    events: [
      { status: "in_transit", created_at: "2026-10-12T10:00:05Z", payload: { state: 30, timeStamp: Date.parse("2026-10-12T10:00:00Z") } },
      { status: "shipment_created", created_at: "2026-10-10T09:00:00Z", payload: { state: 10 } },
    ],
  });
  assert.deepEqual(shipment.events.map((event) => [event.key, event.at]), [
    ["in_transit", "2026-10-12T10:00:00.000Z"],
    ["created", "2026-10-10T09:00:00.000Z"],
  ]);
});

test("every failed attempt is its own visit, with the reason worded for the customer", () => {
  const steps = mergeJourneySteps([
    { key: "failed_attempt", at: "2026-10-12T10:00:10.000Z", exceptionCode: 7 },
    { key: "failed_attempt", at: "2026-10-12T10:00:40.000Z", exceptionCode: null },
    { key: "failed_attempt", at: "2026-10-13T11:00:00.000Z", exceptionCode: 6 },
  ]);
  assert.equal(steps.length, 2, "one attempt seen by two sources stays one");
  assert.equal(steps[1].reason, "المندوب اتصل بيك ومحدش رد");
  assert.equal(steps[0].reason, undefined, "a cancellation the shop asked for is never explained to the customer");
});

test("the alert shows only while the parcel is stuck, never on one that moved on", () => {
  const stuck = buildPublicShipment(bostaOrder({ shipment_status: "failed_delivery", bosta_details: { state_code: 47 }, bosta_exception_code: 7, bosta_attempts: 1 }));
  assert.equal(stuck.alert.key, "failed_attempt");
  assert.equal(stuck.alert.reason, "المندوب اتصل بيك ومحدش رد");
  const twice = buildPublicShipment(bostaOrder({ shipment_status: "failed_delivery", bosta_details: { state_code: 47 }, bosta_exception_code: 7, bosta_attempts: 2 }));
  assert.equal(twice.alert.key, "contact_us");
  const movedOn = buildPublicShipment(bostaOrder({ shipment_status: "out_for_delivery", bosta_details: { state_code: 41 }, bosta_exception_code: 7, bosta_attempts: 1 }));
  assert.equal(movedOn.alert, null, "bosta_exception_code is never cleared; last week's failure must not alarm a moving parcel");
});

test("a delivered parcel promises nothing, and a DATE column keeps its day", () => {
  assert.equal(buildPublicShipment(bostaOrder({ shipment_status: "delivered", bosta_details: { state_code: 45 } })).promise_date, null);
  assert.equal(buildPublicShipment(bostaOrder({ bosta_promise_date: new Date(2026, 9, 14) })).promise_date, "2026-10-14");
});

test("no Bosta parcel, no shipment block", () => {
  assert.equal(buildPublicShipment({ shipping_provider: "bosta" }), null);
  assert.equal(buildPublicShipment({ shipping_provider: "jt", tracking_number: "1" }), null);
});

test("opening the page asks Bosta only for a stale parcel that is still moving", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  assert.equal(shouldRefreshForCustomer(bostaOrder({ shipping_last_synced_at: "2026-10-13T11:55:00Z" }), now), false, "fresh");
  assert.equal(shouldRefreshForCustomer(bostaOrder({ shipping_last_synced_at: "2026-10-13T11:00:00Z" }), now), true, "stale");
  assert.equal(shouldRefreshForCustomer(bostaOrder({ shipment_status: "delivered", shipping_last_synced_at: "2026-10-12T11:00:00Z" }), now), false, "finished");
});

test("every journey key the server sends has copy in both languages, and the Bosta pickup stage names Bosta", () => {
  const read = (lang) => JSON.parse(fs.readFileSync(new URL(`../src/locales/${lang}/storefront.json`, import.meta.url), "utf8"));
  for (const lang of ["ar", "en"]) {
    const tracking = read(lang).tracking;
    for (const key of Object.keys(JOURNEY_LABELS)) {
      assert.ok(STOREFRONT_JOURNEY_KEYS.includes(key), `${key} is a key the page knows`);
      assert.ok(tracking.journey[key], `${lang} has copy for ${key}`);
      assert.equal(journeyStepKey({ key }), `storefront.tracking.journey.${key}`);
    }
    assert.ok(tracking.stages.picked_up && tracking.stages.picked_up_bosta, `${lang} has both pickup stage labels`);
    for (const key of ["failed_attempt", "contact_us"]) assert.ok(tracking.alerts[key], `${lang} has the ${key} alert`);
  }
  assert.equal(trackingStageKey({ key: "picked_up", courier: "bosta" }), "storefront.tracking.stages.picked_up_bosta");
  assert.equal(trackingStageKey({ key: "picked_up" }), "storefront.tracking.stages.picked_up");
});
