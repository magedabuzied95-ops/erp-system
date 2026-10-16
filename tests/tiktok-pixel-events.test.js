import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildTikTokEventProperties,
  isTikTokPaymentComplete,
  tiktokOrderEventId,
} from "../shared/tiktokPixelEvent.js";

const calls = [];
const storage = new Map();
const scripts = [];

const installWindow = (hostname = "m1store-egy.com") => {
  calls.length = 0;
  storage.clear();
  scripts.length = 0;
  const firstScript = { parentNode: { insertBefore: (node) => scripts.push(node.src) } };
  globalThis.document = {
    createElement: () => ({}),
    getElementsByTagName: () => [firstScript],
  };
  globalThis.window = {
    location: { hostname, pathname: "/", search: "", href: `https://${hostname}/` },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
  };
};

const pixel = await import("../src/storefront/lib/tiktokPixel.js");

// The SDK never loads in node, so the queued stub records every call as [method, ...args].
const queued = () => (globalThis.window.ttq || []).filter((entry) => Array.isArray(entry)).map(([method, ...args]) => ({ method, args }));

const product = { id: 7, name: "Air Runner" };
const variant = { id: 31, sku: "AR-42-BLK", price: 1500 };

beforeEach(() => {
  installWindow();
  pixel.__resetTikTokGuardsForTests();
});

test("loads the pixel once with the given id, only on the live shop host", () => {
  assert.equal(pixel.TIKTOK_PIXEL_ID, "DB9980JC77UAEK31A0AG");
  pixel.initTikTokPixel();
  pixel.initTikTokPixel();
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /^https:\/\/analytics\.tiktok\.com\/i18n\/pixel\/events\.js\?sdkid=DB9980JC77UAEK31A0AG/);

  installWindow("localhost");
  assert.equal(pixel.initTikTokPixel(), false);
  assert.equal(window.ttq, undefined);
});

test("an opted-out viewer never gets the pixel", () => {
  storage.set(pixel.TIKTOK_CONSENT_STORAGE_KEY, "denied");
  assert.equal(pixel.initTikTokPixel(), false);
  assert.equal(scripts.length, 0);
});

test("page view: once per navigation, again on a real new page", () => {
  pixel.trackTikTokPageView("/p/air");
  pixel.trackTikTokPageView("/p/air");
  pixel.trackTikTokPageView("/");
  assert.equal(queued().filter((c) => c.method === "page").length, 2);
});

test("ViewContent carries the catalogue id, name, price, EGP and is sent once per size", () => {
  pixel.trackTikTokViewContent({ product, variant, value: 1500 });
  pixel.trackTikTokViewContent({ product, variant, value: 1500 });
  const views = queued().filter((c) => c.args[0] === "ViewContent");
  assert.equal(views.length, 1);
  const [, props, options] = views[0].args;
  assert.deepEqual(props, {
    contents: [{ content_id: "AR-42-BLK", content_type: "product", content_name: "Air Runner", quantity: 1, price: 1500 }],
    content_type: "product",
    value: 1500,
    currency: "EGP",
  });
  assert.match(options.event_id, /^m1_tt_viewcontent_/);
});

test("AddToCart value is price x quantity", () => {
  pixel.trackTikTokAddToCart({ product, variant, line: { name: "Air Runner", price: 1500, quantity: 2 }, quantity: 2 });
  const [, props] = queued().find((c) => c.args[0] === "AddToCart").args;
  assert.equal(props.value, 3000);
  assert.equal(props.contents[0].quantity, 2);
});

test("InitiateCheckout is not repeated by rerenders of the same cart", () => {
  const items = [{ product_id: 7, variant_id: 31, sku: "AR-42-BLK", name: "Air Runner", price: 1500, quantity: 1 }];
  pixel.trackTikTokInitiateCheckout({ items, value: 1500 });
  pixel.trackTikTokInitiateCheckout({ items, value: 1500 });
  assert.equal(queued().filter((c) => c.args[0] === "InitiateCheckout").length, 1);
});

test("an unpaid order is PlaceAnOrder only; Purchase waits for payment_status paid", () => {
  const items = [{ sku: "AR-42-BLK", name: "Air Runner", price: 1500, quantity: 1 }];
  pixel.trackTikTokOrder({ order: { id: 501, status: "pending", payment_status: "unpaid" }, items, value: 1550 });
  pixel.trackTikTokOrder({ order: { id: 501, status: "pending", payment_status: "unpaid" }, items, value: 1550 });
  let events = queued().map((c) => c.args[0]);
  assert.deepEqual(events, ["PlaceAnOrder"]);
  const placed = queued().find((c) => c.args[0] === "PlaceAnOrder");
  assert.equal(placed.args[2].event_id, "m1_tt_placeanorder_order_501");
  assert.equal(placed.args[1].value, 1550);

  pixel.__resetTikTokGuardsForTests(); // a reload: localStorage still remembers
  pixel.trackTikTokOrder({ order: { id: 501, status: "confirmed", payment_status: "paid" }, items, value: 1550 });
  events = queued().map((c) => c.args[0]);
  assert.deepEqual(events, ["PlaceAnOrder", "Purchase"]);
  assert.equal(queued().at(-1).args[2].event_id, "m1_tt_purchase_order_501");
});

test("payment-complete rule", () => {
  assert.equal(isTikTokPaymentComplete({ payment_status: "paid" }), true);
  assert.equal(isTikTokPaymentComplete({ payment_status: "awaiting_verification" }), false);
  assert.equal(isTikTokPaymentComplete({ payment_status: "partially_paid" }), false);
  assert.equal(isTikTokPaymentComplete({ payment_status: "paid", status: "cancelled" }), false);
});

test("no customer data ever enters the event properties", () => {
  const props = buildTikTokEventProperties({
    contents: [{ content_id: "X", price: 10, quantity: 1, email: "a@b.c", phone: "010" }],
  });
  assert.doesNotMatch(JSON.stringify(props), /email|phone|a@b\.c/);
});

test("storefront wires every event next to its GA4 twin", () => {
  const storefront = fs.readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const pdp = fs.readFileSync(new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url), "utf8");
  assert.match(storefront, /trackTikTokPageView\(/);
  assert.match(storefront, /trackTikTokAddToCart\(/);
  assert.match(storefront, /trackTikTokInitiateCheckout\(/);
  assert.equal(storefront.match(/trackTikTokOrder\(/g)?.length, 2);
  assert.match(pdp, /trackTikTokViewContent\(/);
});
