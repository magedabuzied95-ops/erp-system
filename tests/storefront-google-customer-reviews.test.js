import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GOOGLE_CUSTOMER_REVIEWS_DELIVERY_COUNTRY,
  GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID,
  addConfiguredWorkingDays,
  buildCustomerReviewOptInPayload,
  buildCustomerReviewsProducts,
  isValidGtin,
} from "../server/services/storefrontCustomerReviewsService.js";

const validPayload = {
  merchant_id: 5829421968,
  order_id: "INV-110",
  email: "customer@example.com",
  delivery_country: "EG",
  estimated_delivery_date: "2026-08-01",
};

test("uses the configured merchant and Egypt delivery country", () => {
  assert.equal(GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID, 5829421968);
  assert.equal(GOOGLE_CUSTOMER_REVIEWS_DELIVERY_COUNTRY, "EG");
});

test("calculates the delivery date from regional transit, global handling and configured working days", () => {
  const payload = buildCustomerReviewOptInPayload({
    order: {
      id: 110,
      invoice_number: "INV-110",
      status: "confirmed",
      created_at: "2026-07-26T10:00:00.000Z",
    },
    email: "Customer@Example.com",
    shippingZone: {
      governorate: "Cairo",
      transit_min_days: 2,
      transit_max_days: 4,
      active: true,
    },
    handlingMinDays: 0,
    handlingMaxDays: 1,
    workingDays: ["sat", "sun", "mon", "tue", "wed", "thu"],
  });
  assert.equal(payload.order_id, "INV-110");
  assert.equal(payload.email, "customer@example.com");
  assert.equal(payload.estimated_delivery_date, "2026-08-01");
});

test("uses actual configured zone values as a conservative fallback when no region can be resolved", () => {
  const payload = buildCustomerReviewOptInPayload({
    order: { id: 111, status: "confirmed", created_at: "2026-07-26T10:00:00.000Z" },
    email: "customer@example.com",
    fallbackZones: [
      { governorate: "Cairo", transit_max_days: 4, active: true },
      { governorate: "New Valley", delivery_max_days: 7, active: true },
    ],
    handlingMinDays: 0,
    handlingMaxDays: 1,
    workingDays: [],
  });
  assert.equal(payload.estimated_delivery_date, "2026-08-03");
});

test("working-day calculation respects the stored fulfillment calendar", () => {
  assert.equal(addConfiguredWorkingDays({
    createdAt: "2026-07-30T20:00:00.000Z",
    days: 1,
    workingDays: ["sat", "sun", "mon", "tue", "wed", "thu"],
  }), "2026-08-01");
});

test("does not opt in without a valid customer email or for failed orders", () => {
  const base = {
    order: { id: 110, status: "confirmed", created_at: "2026-07-26T10:00:00.000Z" },
    shippingZone: { governorate: "Cairo", transit_max_days: 4 },
    handlingMinDays: 0,
    handlingMaxDays: 1,
  };
  assert.equal(buildCustomerReviewOptInPayload({ ...base, email: "" }), null);
  assert.equal(buildCustomerReviewOptInPayload({ ...base, email: "not-an-email" }), null);
  assert.equal(buildCustomerReviewOptInPayload({
    ...base,
    email: "customer@example.com",
    order: { ...base.order, status: "failed" },
  }), null);
});

test("only sends checksum-valid GTIN values and omits products when none are valid", () => {
  assert.equal(isValidGtin("4006381333931"), true);
  assert.equal(isValidGtin("2501"), false);
  assert.deepEqual(buildCustomerReviewsProducts([
    { gtin: "4006381333931" },
    { gtin: "2501" },
    { gtin: "4006381333931" },
    { barcode: "4006381333931" },
  ]), [{ gtin: "4006381333931" }]);
  const payload = buildCustomerReviewOptInPayload({
    order: { id: 110, status: "confirmed", created_at: "2026-07-26T10:00:00.000Z" },
    email: "customer@example.com",
    items: [{ barcode: "2501" }],
    shippingZone: { governorate: "Cairo", transit_max_days: 4 },
    handlingMinDays: 0,
    handlingMaxDays: 1,
  });
  assert.equal(Object.hasOwn(payload, "products"), false);
});

test("loads the official script and renders the survey only once across rerenders and refresh guards", async () => {
  const stored = new Map();
  const scripts = [];
  let renderCount = 0;
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
    setTimeout,
  };
  globalThis.document = {
    head: {
      appendChild: (script) => scripts.push(script),
    },
    createElement: () => ({}),
    getElementById: (id) => scripts.find((script) => script.id === id) || null,
    querySelector: () => scripts[0] || null,
  };
  const reviews = await import(`../src/storefront/lib/googleCustomerReviews.js?test=${Date.now()}`);
  reviews.__resetGoogleCustomerReviewsForTests();
  assert.equal(reviews.isCustomerReviewOrderEligible({ id: 110, status: "confirmed" }), true);
  assert.equal(reviews.isCustomerReviewOrderEligible({ id: 110, status: "failed" }), false);
  const first = reviews.renderGoogleCustomerReviewOptIn(validPayload);
  const duplicateRender = reviews.renderGoogleCustomerReviewOptIn(validPayload);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "https://apis.google.com/js/platform.js?onload=renderOptIn");
  window.gapi = {
    load: (_name, callback) => callback(),
    surveyoptin: { render: () => { renderCount += 1; } },
  };
  window.renderOptIn();
  assert.equal(await first, true);
  assert.equal(await duplicateRender, true);
  assert.equal(renderCount, 1);
  assert.equal(await reviews.renderGoogleCustomerReviewOptIn(validPayload), false);
  assert.equal(renderCount, 1);
  delete globalThis.window;
  delete globalThis.document;
});

test("integration is storefront-only and leaves GA4 and Meta purchase calls in place", async () => {
  const storefront = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(storefront, /renderGoogleCustomerReviewOptIn/);
  assert.match(storefront, /trackGa4Purchase/);
  assert.match(storefront, /trackMetaPurchase/);
  assert.doesNotMatch(app, /googleCustomerReviews|renderGoogleCustomerReviewOptIn/);
});
