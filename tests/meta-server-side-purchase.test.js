import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { metaCatalogContentId, metaPurchaseEventId } from "../shared/metaPurchaseEvent.js";
import { metaLineContent, purchaseEventId } from "../src/storefront/lib/metaPixelEventPayload.js";

/*
 * The browser reported the sale only while it was still there — a customer who
 * closed the tab on the payment page produced an order Meta never heard about.
 * The shop now reports it too, and the two must collapse into one conversion.
 */

test("both senders derive the same Purchase identity from the same order", () => {
  const order = { id: 9001, invoice_number: "INV-1", status: "pending" };
  assert.equal(purchaseEventId(order), "m1_purchase_order_9001");
  assert.equal(metaPurchaseEventId(order), purchaseEventId(order));
  // Falls back through the same ladder when the row carries no id.
  assert.equal(metaPurchaseEventId({ invoice_number: "INV-7" }), "m1_purchase_order_INV-7");
});

test("both senders derive the same catalogue id for the same line", () => {
  // The browser prices a cart line; the server reads the order item row.
  const cartLine = { sku: "NAJ-J1-M-LOC-BLK-32", product_id: 22, variant_id: 31, price: 650, quantity: 2 };
  const orderItem = { sku: "NAJ-J1-M-LOC-BLK-32", product_id: 22, variant_id: 31, price: 650, quantity: 2 };
  assert.equal(metaLineContent(cartLine).id, metaCatalogContentId(orderItem, orderItem));
  // With no SKU both fall back to the same composite id.
  const noSku = { product_id: 22, variant_id: 31, price: 650, quantity: 1 };
  assert.equal(metaLineContent(noSku).id, metaCatalogContentId(noSku, noSku));
  assert.equal(metaCatalogContentId(noSku, noSku), "22-31");
});

test("the shop reports the sale with the order's own items, value and identity", async (t) => {
  process.env.DATABASE_URL = "postgres://none:none@127.0.0.1:1/none";
  process.env.PG_CONNECTION_TIMEOUT_MS = "100";
  process.env.M1_META_CAPI_ACCESS_TOKEN = "test-token";
  process.env.M1_META_DATASET_ID = "1234567890";
  const { sendStorefrontPurchaseEvent } = await import("../server/services/metaConversionsApiService.js");

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events_received: 1 }) });
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const order = { id: 9001, status: "pending", customer_id: 555, total_amount: 1600 };
  const items = [
    { sku: "SKU-1", product_id: 22, variant_id: 31, price: 650, quantity: 2 },
    { sku: "SKU-2", product_id: 23, variant_id: 32, price: 300, quantity: 1 },
  ];
  const result = await sendStorefrontPurchaseEvent({
    req: { headers: { "user-agent": "test-agent" } },
    order,
    items,
    value: 1600,
    checkout: {
      full_name: "Maged Abu Zied",
      primary_phone: "01012345678",
      email: "Customer@Example.com",
      city_area: "Sidi Gaber",
      governorate: "Alexandria",
    },
    customer: { id: 555 },
    identity: { fbp: "fb.1.1700000000.123", fbc: "fb.1.1700000000.clickid", source_url: "https://erp.m1store-egy.com/checkout" },
    tenantId: 1,
  });

  assert.equal(result.sent, true);
  const event = result.payload.data[0];
  assert.equal(event.event_name, "Purchase");
  // The dedup contract: same id the browser would have sent.
  assert.equal(event.event_id, purchaseEventId(order));
  assert.equal(event.action_source, "website");
  assert.equal(event.event_source_url, "https://erp.m1store-egy.com/checkout");
  assert.deepEqual(event.custom_data.content_ids, ["SKU-1", "SKU-2"]);
  assert.deepEqual(event.custom_data.contents, [
    { id: "SKU-1", quantity: 2, item_price: 650 },
    { id: "SKU-2", quantity: 1, item_price: 300 },
  ]);
  assert.equal(event.custom_data.value, 1600);
  assert.equal(event.custom_data.currency, "EGP");
  assert.equal(event.custom_data.num_items, 3);
  // The click id the browser could not hand to this origin on its own.
  assert.equal(event.user_data.fbp, "fb.1.1700000000.123");
  assert.equal(event.user_data.fbc, "fb.1.1700000000.clickid");
  assert.equal(event.user_data.client_user_agent, "test-agent");
  for (const field of ["em", "ph", "fn", "ln", "ct", "st", "external_id"]) {
    assert.ok(Array.isArray(event.user_data[field]) && /^[0-9a-f]{64}$/.test(event.user_data[field][0]), `${field} is hashed`);
  }
});

test("the shop reports nothing for an order that is not a sale", async (t) => {
  process.env.M1_META_CAPI_ACCESS_TOKEN = "test-token";
  process.env.M1_META_DATASET_ID = "1234567890";
  const { sendStorefrontPurchaseEvent } = await import("../server/services/metaConversionsApiService.js");
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({}) };
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const items = [{ sku: "SKU-1", price: 650, quantity: 1 }];
  const base = { req: { headers: {} }, items, value: 650, checkout: {}, customer: {}, identity: {} };

  assert.deepEqual(
    await sendStorefrontPurchaseEvent({ ...base, order: { id: 1, status: "cancelled" } }),
    { sent: false, reason: "order_not_eligible" }
  );
  assert.deepEqual(
    await sendStorefrontPurchaseEvent({ ...base, order: {} }),
    { sent: false, reason: "missing_order_reference" }
  );
  assert.deepEqual(
    await sendStorefrontPurchaseEvent({ ...base, order: { id: 2 }, items: [{ price: 650, quantity: 1 }] }),
    { sent: false, reason: "missing_content_ids" }
  );
  assert.deepEqual(
    await sendStorefrontPurchaseEvent({ ...base, order: { id: 3 }, value: 0 }),
    { sent: false, reason: "invalid_purchase_value" }
  );
  assert.equal(calls, 0, "nothing reached Meta");
});

test("a till-raised online order is not reported as a website conversion", () => {
  const controllerSource = fs.readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  const call = controllerSource.slice(
    controllerSource.indexOf("sendStorefrontPurchaseEvent({") - 400,
    controllerSource.indexOf("sendStorefrontPurchaseEvent({")
  );
  assert.match(call, /if \(!posOnlineOrder\) \{/);
});
