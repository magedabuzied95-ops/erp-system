import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMetaEventPayload,
  metaCurrentSellingPrice,
  metaLineContent,
} from "../src/storefront/lib/metaPixelEventPayload.js";

/*
 * Events Manager raised "Value setup method (price)": events were arriving with
 * custom_data.value = 0, which it reads as a price it cannot use. Two faults fed
 * it — the price walk stopped at a displayed zero instead of looking further, and
 * the payload builder wrote the zero out instead of leaving the field off.
 */

test("a displayed zero no longer stops the price walk", () => {
  // The product page passes the price it rendered. A lean catalogue projection
  // can hand it a row with no price field, so that argument arrives as 0.
  assert.equal(metaCurrentSellingPrice({ product: { selling_price: 650 }, variant: {}, value: 0 }), 650);
  assert.equal(metaCurrentSellingPrice({ product: {}, variant: { price: 420 }, value: 0 }), 420);
  assert.equal(metaCurrentSellingPrice({ product: { current_selling_price: "1,695.00" }, variant: {} }), 1695);
  // A cart line priced only by its total still yields the unit price.
  assert.equal(metaCurrentSellingPrice({ product: {}, variant: {}, line: { price: 0, total_amount: 900, quantity: 3 } }), 300);
  // Sale and offer prices are the last resort, not the first.
  assert.equal(metaCurrentSellingPrice({ product: { selling_price: 650, sale_price: 550 }, variant: {} }), 650);
  assert.equal(metaCurrentSellingPrice({ product: { sale_price: 550 }, variant: {} }), 550);
  // Nothing resolvable stays zero rather than inventing a price.
  assert.equal(metaCurrentSellingPrice({ product: { name: "no price" }, variant: {} }), 0);
});

test("an event with no resolvable price ships without value and without currency", () => {
  const payload = buildMetaEventPayload({
    contentIds: ["SKU-NO-PRICE"],
    contentName: "Unpriced product",
    value: 0,
    eventId: "m1_viewcontent_no_price",
  });
  assert.ok(payload, "the event is still sent — only the price is absent");
  assert.deepEqual(payload.content_ids, ["SKU-NO-PRICE"]);
  assert.equal("value" in payload, false);
  assert.equal("currency" in payload, false);
});

test("a resolved price still ships as a value/currency pair", () => {
  const payload = buildMetaEventPayload({
    contentIds: ["SKU-1"],
    value: 650,
    eventId: "m1_viewcontent_priced",
  });
  assert.equal(payload.value, 650);
  assert.equal(payload.currency, "EGP");
});

test("cart lines with no resolvable price travel without item_price", () => {
  const unpriced = metaLineContent({ sku: "SKU-NO-PRICE", quantity: 2 });
  assert.deepEqual(unpriced, { id: "SKU-NO-PRICE", quantity: 2 });
  const priced = metaLineContent({ sku: "SKU-1", price: 500, quantity: 2 });
  assert.deepEqual(priced, { id: "SKU-1", quantity: 2, item_price: 500 });
});

test("a zero item_price is stripped from contents built by the caller", () => {
  const payload = buildMetaEventPayload({
    contentIds: ["SKU-1"],
    contents: [{ id: "SKU-1", quantity: 1, item_price: 0 }],
    value: 0,
    eventId: "m1_addtocart_no_price",
  });
  assert.deepEqual(payload.contents, [{ id: "SKU-1", quantity: 1 }]);
  assert.equal("value" in payload, false);
});

test("the Conversions API applies the same rule to custom_data", async (t) => {
  process.env.DATABASE_URL = "postgres://none:none@127.0.0.1:1/none";
  process.env.PG_CONNECTION_TIMEOUT_MS = "100";
  process.env.M1_META_CAPI_ACCESS_TOKEN = "test-token";
  process.env.M1_META_DATASET_ID = "1234567890";
  const { sendStorefrontMetaEvent } = await import("../server/services/metaConversionsApiService.js");

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events_received: 1 }) });
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const send = (event) => sendStorefrontMetaEvent({ req: { headers: {} }, event, tenantId: 1 });

  const unpriced = await send({
    event_name: "AddToCart",
    event_id: "m1_addtocart_no_price",
    content_ids: ["SKU-NO-PRICE"],
    contents: [{ id: "SKU-NO-PRICE", quantity: 1, item_price: 0 }],
    value: 0,
    currency: "EGP",
  });
  assert.equal(unpriced.sent, true);
  const unpricedData = unpriced.payload.data[0].custom_data;
  assert.equal("value" in unpricedData, false);
  assert.equal("currency" in unpricedData, false);
  assert.deepEqual(unpricedData.contents, [{ id: "SKU-NO-PRICE", quantity: 1 }]);

  const priced = await send({
    event_name: "AddToCart",
    event_id: "m1_addtocart_priced",
    content_ids: ["SKU-1"],
    contents: [{ id: "SKU-1", quantity: 2, item_price: 650 }],
    value: "1,300.00",
    currency: "EGP",
  });
  const pricedData = priced.payload.data[0].custom_data;
  assert.equal(pricedData.value, 1300);
  assert.equal(pricedData.currency, "EGP");
  assert.deepEqual(pricedData.contents, [{ id: "SKU-1", quantity: 2, item_price: 650 }]);

  // An order with no total is not a purchase, and never leaves the server.
  const purchase = await send({
    event_name: "Purchase",
    event_id: "m1_purchase_order_1",
    content_ids: ["SKU-1"],
    value: 0,
  });
  assert.deepEqual(purchase, { sent: false, reason: "invalid_purchase_value" });
});
