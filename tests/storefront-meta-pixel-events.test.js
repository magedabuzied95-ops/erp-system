import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMetaEventPayload,
  canTrackMetaPurchase,
  createMetaEventOnceGuard,
  isMetaPurchaseEligible,
  metaCatalogContentId,
  metaCurrentSellingPrice,
  metaLineContent,
  metaPurchaseValue,
  purchaseEventId,
} from "../src/storefront/lib/metaPixelEventPayload.js";

test("ViewContent is allowed once per product view and has the current product payload", () => {
  const once = createMetaEventOnceGuard();
  const viewKey = "product-page:NAJ-J1-M-LOC-BLK-32";
  assert.equal(once(viewKey), true);
  assert.equal(once(viewKey), false);
  assert.equal(once("another-product:SKU-2"), true);
  const payload = buildMetaEventPayload({
    contentIds: ["NAJ-J1-M-LOC-BLK-32"],
    contentName: "Nike Air Jordan 1 Low",
    value: 650,
    eventId: "m1_viewcontent_test",
  });
  assert.deepEqual(payload.content_ids, ["NAJ-J1-M-LOC-BLK-32"]);
  assert.equal(payload.content_name, "Nike Air Jordan 1 Low");
  assert.equal(payload.value, 650);
  assert.equal(payload.currency, "EGP");
  assert.equal(payload.event_id, "m1_viewcontent_test");
});

test("AddToCart payload uses catalog SKU and current selling price", () => {
  const product = { id: 22, name: "Nike Air Jordan 1 Low", selling_price: 650 };
  const variant = { id: 31, sku: "NAJ-J1-M-LOC-BLK-32", sale_price: 550, selling_price: 650 };
  const id = metaCatalogContentId(product, variant);
  const price = metaCurrentSellingPrice({ product, variant, value: 650 });
  const payload = buildMetaEventPayload({
    eventName: "AddToCart",
    contentIds: [id],
    contentName: product.name,
    contents: [{ id, quantity: 2, item_price: price }],
    value: price * 2,
    eventId: "m1_add_to_cart_test",
  });
  assert.deepEqual(payload.content_ids, ["NAJ-J1-M-LOC-BLK-32"]);
  assert.equal(payload.value, 1300);
  assert.equal(payload.currency, "EGP");
  assert.equal(payload.event_id, "m1_add_to_cart_test");
  assert.equal(payload.content_name, "Nike Air Jordan 1 Low");
});

test("InitiateCheckout uses cart SKUs, quantities, value and a unique event id", () => {
  const contents = [
    metaLineContent({ sku: "SKU-1", price: 500, quantity: 2 }),
    metaLineContent({ sku: "SKU-2", price: 300, quantity: 1 }),
  ].filter(Boolean);
  const payload = buildMetaEventPayload({
    contentIds: contents.map((item) => item.id),
    contents,
    numItems: 3,
    value: 1300,
    eventId: "m1_initiatecheckout_123_unique",
    customer: { phone: "01012345678" },
  });
  assert.deepEqual(payload.content_ids, ["SKU-1", "SKU-2"]);
  assert.equal(payload.num_items, 3);
  assert.equal(payload.value, 1300);
  assert.equal(payload.phone, "201012345678");
  assert.equal(payload.event_id, "m1_initiatecheckout_123_unique");
});

test("Purchase cart lines preserve the catalog SKU instead of falling back to an internal variant ID", () => {
  const line = metaLineContent({
    product_id: 22,
    variant_id: 31,
    sku: "NAJ-J1-M-LOC-BLK-32",
    price: 650,
    quantity: 1,
  });
  assert.deepEqual(line, { id: "NAJ-J1-M-LOC-BLK-32", quantity: 1, item_price: 650 });
});

test("Purchase is once per order ID and includes stable event ID, quantities and catalog IDs", () => {
  const seen = new Set();
  const order = { id: 9001, status: "pending" };
  assert.equal(canTrackMetaPurchase(order, seen), true);
  seen.add(String(order.id));
  assert.equal(canTrackMetaPurchase(order, seen), false);
  assert.equal(purchaseEventId(order), "m1_purchase_order_9001");
  const payload = buildMetaEventPayload({
    contentIds: ["NAJ-J1-M-LOC-BLK-32", "SKU-2"],
    contents: [
      { id: "NAJ-J1-M-LOC-BLK-32", quantity: 2, item_price: 650 },
      { id: "SKU-2", quantity: 1, item_price: 300 },
    ],
    numItems: 3,
    value: 1600,
    eventId: purchaseEventId(order),
  });
  assert.deepEqual(payload.content_ids, ["NAJ-J1-M-LOC-BLK-32", "SKU-2"]);
  assert.equal(payload.num_items, 3);
  assert.equal(payload.value, 1600);
  assert.equal(payload.currency, "EGP");
  assert.equal(payload.event_id, "m1_purchase_order_9001");
});

test("Cancelled or failed orders never qualify for Purchase", () => {
  for (const status of ["cancelled", "canceled", "failed", "payment_failed"]) {
    assert.equal(isMetaPurchaseEligible({ id: 1, status }), false);
    assert.equal(canTrackMetaPurchase({ id: 1, status }), false);
  }
});

test("A submitted shipping-confirmation order qualifies for Purchase", () => {
  const order = { id: 9002, status: "awaiting_verification", payment_method: "shipping_confirmation" };
  assert.equal(isMetaPurchaseEligible(order), true);
  assert.equal(canTrackMetaPurchase(order), true);
  assert.equal(purchaseEventId(order), "m1_purchase_order_9002");
});

test("Meta purchase value accepts formatted totals and falls back to cart lines", () => {
  assert.equal(metaPurchaseValue({ value: "1,695.00" }), 1695);
  assert.equal(metaPurchaseValue({ value: "١٬٦٩٥٫٥٠" }), 1695.5);
  assert.equal(metaPurchaseValue({
    value: 0,
    items: [
      { price: 650, quantity: 2 },
      { total_amount: "٣٠٠", quantity: 1 },
    ],
  }), 1600);
});
