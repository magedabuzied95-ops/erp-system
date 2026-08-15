import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { resolveAiOrderShipping } from "../server/services/aiAgentOrderService.js";

const inboxSource = fs.readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const routeSource = fs.readFileSync("server/routes/aiAgentOrders.js", "utf8");
const serviceSource = fs.readFileSync("server/services/aiAgentOrderService.js", "utf8");
const arabic = JSON.parse(fs.readFileSync("src/locales/ar/aiSupport.json", "utf8"));
const english = JSON.parse(fs.readFileSync("src/locales/en/aiSupport.json", "utf8"));

const composerSource = () => {
  const start = inboxSource.indexOf("function InboxOrderComposer(");
  assert.ok(start >= 0, "InboxOrderComposer not found");
  return inboxSource.slice(start, inboxSource.indexOf("\nfunction SalesCloserPanel(", start));
};

test("a typed shipping price wins over the zone price list", async () => {
  const result = await resolveAiOrderShipping({ shipping_cost: 75, governorate: "القاهرة", net_subtotal: 1750 });
  assert.equal(result.cost, 75);
  assert.equal(result.source, "manual");
  assert.equal(result.quote, null);
});

test("free delivery is an explicit zero, not a missing value", async () => {
  // The seller granting free shipping and the seller not having touched the
  // field must not collapse into the same request.
  const free = await resolveAiOrderShipping({ shipping_cost: 0, governorate: "القاهرة", net_subtotal: 1750 });
  assert.equal(free.cost, 0);
  assert.equal(free.source, "manual");

  for (const untouched of [{}, { shipping_cost: "" }, { shipping_cost: null }, { shipping_cost: undefined }]) {
    const resolved = await resolveAiOrderShipping({ ...untouched, net_subtotal: 0 });
    assert.notEqual(resolved.source, "manual", `${JSON.stringify(untouched)} must not read as a manual override`);
  }
});

test("a negative typed price is not treated as an override", async () => {
  const resolved = await resolveAiOrderShipping({ shipping_cost: -5, net_subtotal: 0 });
  assert.notEqual(resolved.source, "manual");
});

test("the order is priced through the same resolver the preview calls", () => {
  // One authority. If the draft ever inlines its own quote again, the figure on
  // screen and the figure on the invoice can drift apart silently.
  assert.match(serviceSource, /export const resolveAiOrderShipping = async/);
  assert.match(serviceSource, /const \{ cost: shippingCost, quote: shippingQuote \} = await resolveAiOrderShipping\(/);
  assert.equal(serviceSource.match(/resolveStorefrontShippingQuote\(\{/g)?.length, 1);

  assert.match(routeSource, /router\.get\("\/shipping-quote", protect, permit\("settings", "edit"\)/);
  assert.match(routeSource, /const shipping = await resolveAiOrderShipping\(\{/);
});

test("the composer's manual price survives the trip to the invoice", () => {
  // The route used to drop shipping_cost on the floor, so an edited price never
  // reached the service that prices the order.
  assert.match(routeSource, /shipping_cost: req\.body\?\.shipping_cost,/);

  const composer = composerSource();
  assert.match(composer, /\.\.\.\(shippingIsOverridden \? \{ shipping_cost: shippingCost \} : \{\}\)/);
});

test("an untouched shipping field sends no shipping_cost at all", () => {
  const composer = composerSource();
  // Spreading an empty object keeps the key absent rather than sending 0, which
  // the server would read as the seller granting free delivery.
  assert.doesNotMatch(composer, /shipping_cost: shippingOverride/);
  assert.match(composer, /shippingIsOverridden = shippingOverride !== null/);
});

test("the composer re-quotes when the address or the discounted subtotal changes", () => {
  const composer = composerSource();
  // A free-shipping threshold makes the price depend on the amount too, so a
  // discount that crosses it has to re-price.
  assert.match(composer, /api\.get\(`\/ai-inbox\/shipping-quote\?/);
  assert.match(composer, /net_subtotal: String\(netSubtotal\)/);
  assert.match(composer, /\}, \[cityArea, governorate, headers, netSubtotal, open, shippingCityId, shippingDistrictId, shippingLocations, shippingProvider, shippingZoneId\]\)/);
});

test("the composer shows shipping and a grand total before saving", () => {
  const composer = composerSource();
  assert.match(composer, /const netSubtotal = Math\.max\(0, cartTotal - discountAmount\)/);
  assert.match(composer, /const orderTotal = Math\.max\(0, netSubtotal \+ shippingCost\)/);
  assert.match(composer, /aiSupport\.inbox\.order\.orderTotal/);
  assert.match(composer, /setShippingOverride\(null\)/); // reset back to the quoted price
});

test("every new composer string exists in both locales", () => {
  const keys = [
    "shippingLabel",
    "shippingFromZones",
    "shippingFree",
    "shippingManual",
    "shippingResetAuto",
    "shippingLoading",
    "shippingNeedsAddress",
    "orderTotal",
  ];
  for (const key of keys) {
    assert.ok(arabic.inbox.order[key], `ar is missing inbox.order.${key}`);
    assert.ok(english.inbox.order[key], `en is missing inbox.order.${key}`);
    assert.notEqual(arabic.inbox.order[key], english.inbox.order[key], `inbox.order.${key} was never translated`);
  }
});
