import test from "node:test";
import assert from "node:assert/strict";

import { bostaStateText, normalizeBostaDeliveryResponse, normalizeBostaStatus } from "../server/modules/shipping/providers/bosta.mapper.js";

// The real create response for order 414. Bosta reports state as an object, and
// String()-ing it stored the literal "[object Object]" as the shipment status —
// a value no status map, KPI bucket, or order screen can make sense of.
const REAL_CREATE_RESPONSE = {
  success: true,
  message: "Done successfully.",
  data: {
    _id: "Q0ibh4JYuaR3HM2wP3lJX",
    trackingNumber: "6473852793",
    businessReference: "INV-414",
    state: { code: 10, value: "Pickup requested" },
    creationSrc: "API",
  },
};

test("an object-shaped Bosta state never reaches the database as text", () => {
  const result = normalizeBostaDeliveryResponse(REAL_CREATE_RESPONSE);
  assert.notEqual(result.status, "[object Object]");
  assert.equal(result.status, "shipment_created");
  assert.equal(result.tracking_number, "6473852793");
  assert.equal(result.provider_delivery_id, "Q0ibh4JYuaR3HM2wP3lJX");
});

test("Bosta state objects are unwrapped to their value", () => {
  assert.equal(bostaStateText({ code: 10, value: "Pickup requested" }), "Pickup requested");
  assert.equal(bostaStateText({ code: 45 }), "45");
  assert.equal(bostaStateText("Delivered"), "Delivered");
  assert.equal(bostaStateText(null), "");
});

test("Bosta's vocabulary maps onto the statuses the ERP tracks", () => {
  assert.equal(normalizeBostaStatus({ value: "Pickup requested" }), "shipment_created");
  assert.equal(normalizeBostaStatus("Picked up"), "picked_up");
  assert.equal(normalizeBostaStatus("Out for delivery"), "out_for_delivery");
  assert.equal(normalizeBostaStatus("Delivered"), "delivered");
  assert.equal(normalizeBostaStatus("Returned to business"), "returned");
  assert.equal(normalizeBostaStatus("Terminated"), "cancelled");
  assert.equal(normalizeBostaStatus("Exception"), "failed_delivery");
});

test("an unknown Bosta state stays itself instead of masquerading as created", () => {
  assert.equal(normalizeBostaStatus("Some Brand New State"), "some_brand_new_state");
  assert.equal(normalizeBostaStatus(""), "");
});

test("a plain string status still works", () => {
  const result = normalizeBostaDeliveryResponse({ data: { _id: "x", trackingNumber: "1", status: "Delivered" } });
  assert.equal(result.status, "delivered");
});
