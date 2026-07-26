import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildGa4Item,
  buildGa4PurchasePayload,
  ga4CartPayload,
  ga4ItemId,
  isGa4PurchaseEligible,
} from "../src/storefront/lib/ga4EventPayload.js";
import {
  __resetGa4GuardsForTests,
  GA4_MEASUREMENT_ID,
  ensureGoogleTag,
  trackGa4PageView,
  trackGa4Purchase,
} from "../src/storefront/lib/ga4Events.js";

const line = {
  product_id: 205,
  variant_id: 3858,
  name: "Nike Equality",
  brand: "Nike",
  category: "Sneakers",
  color: "White & Black",
  size: "41",
  price: 600,
  sale_price: 500,
  compare_at_price: 900,
  quantity: 2,
};

const installBrowserMock = () => {
  const storage = new Map();
  const scripts = [];
  global.window = {
    location: {
      hostname: "m1store-egy.com",
      pathname: "/product/nike-equality",
      search: "",
      href: "https://m1store-egy.com/product/nike-equality",
    },
    dataLayer: [],
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  };
  global.document = {
    title: "Nike Equality | M1 Store",
    head: { appendChild: (node) => scripts.push(node) },
    createElement: () => ({}),
    getElementById: (id) => scripts.find((script) => script.id === id) || null,
    querySelector: () => null,
  };
  return { scripts, storage };
};

const removeBrowserMock = () => {
  delete global.window;
  delete global.document;
};

test("GA4 uses the configured measurement ID and a single Google tag loader", () => {
  const { scripts } = installBrowserMock();
  __resetGa4GuardsForTests();
  assert.equal(GA4_MEASUREMENT_ID, "G-J47KZ3W60P");
  assert.equal(ensureGoogleTag(), true);
  assert.equal(ensureGoogleTag(), true);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0].src, /googletagmanager\.com\/gtag\/js\?id=G-J47KZ3W60P/);
  removeBrowserMock();
});

test("item_id matches the Google Merchant product_id-variant_id format", () => {
  assert.equal(ga4ItemId(line, line), "205-3858");
  const item = buildGa4Item({ product: line, variant: line, line });
  assert.equal(item.item_id, "205-3858");
  assert.equal(item.item_brand, "Nike");
  assert.equal(item.item_category, "Sneakers");
  assert.equal(item.item_color, "White & Black");
  assert.equal(item.item_size, "41");
});

test("GA4 ecommerce uses the actual customer price, not crossed or internal sale prices", () => {
  const payload = ga4CartPayload([line]);
  assert.equal(payload.value, 1200);
  assert.equal(payload.items[0].price, 600);
  assert.notEqual(payload.items[0].price, line.compare_at_price);
  assert.notEqual(payload.items[0].price, line.sale_price);
});

test("purchase contains real order, shipping, coupon and item data", () => {
  const payload = buildGa4PurchasePayload({
    order: { id: 110, status: "confirmed", total_amount: 1275, shipping_fee: 75, coupon_code: "M1SAVE" },
    items: [line],
  });
  assert.equal(payload.transaction_id, "110");
  assert.equal(payload.value, 1275);
  assert.equal(payload.currency, "EGP");
  assert.equal(payload.shipping, 75);
  assert.equal(payload.coupon, "M1SAVE");
  assert.equal(payload.items[0].item_id, "205-3858");
});

test("failed, cancelled, draft and incomplete orders never qualify for purchase", () => {
  for (const status of ["failed", "payment_failed", "cancelled", "canceled", "draft", "incomplete", "abandoned"]) {
    assert.equal(isGa4PurchaseEligible({ id: 110, status }), false);
  }
  assert.equal(isGa4PurchaseEligible({ status: "confirmed" }), false);
  assert.equal(isGa4PurchaseEligible({ id: 110, status: "confirmed" }), true);
});

test("page_view and purchase are deduplicated across rerenders and success-page refresh", () => {
  const { storage } = installBrowserMock();
  __resetGa4GuardsForTests();
  trackGa4PageView({ path: "/product/nike-equality" });
  trackGa4PageView({ path: "/product/nike-equality" });
  trackGa4Purchase({ order: { id: 110, status: "confirmed", total: 1275, shipping_fee: 75 }, items: [line] });
  trackGa4Purchase({ order: { id: 110, status: "confirmed", total: 1275, shipping_fee: 75 }, items: [line] });
  const events = window.dataLayer.filter((entry) => entry?.[0] === "event");
  assert.equal(events.filter((entry) => entry[1] === "page_view").length, 1);
  assert.equal(events.filter((entry) => entry[1] === "purchase").length, 1);
  assert.equal(storage.get("m1.ga4.purchase.110"), "1");
  removeBrowserMock();
});

test("GA4 is wired only into storefront modules and Meta tracking implementation stays independent", () => {
  const storefront = fs.readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const metaEvents = fs.readFileSync(new URL("../src/storefront/lib/metaPixelEvents.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(storefront, /trackGa4PageView/);
  assert.match(storefront, /trackGa4AddToCart/);
  assert.doesNotMatch(metaEvents, /ga4|gtag|googletagmanager/i);
  assert.doesNotMatch(app, /ga4|gtag|googletagmanager/i);
});
