import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMerchantReturnPolicy,
  buildOfferShippingDetails,
  parseLegacyDeliveryRange,
} from "../../src/shared/lib/merchantPolicies.js";
import { buildProductSeo } from "../../src/shared/lib/productSeo.js";
import { injectProductSeoIntoHtml } from "../../server/services/storefrontProductSeoPageService.js";

const baseZones = [
  { id: "cairo", governorate: "Cairo", price: 90, delivery_min_days: 2, delivery_max_days: 4, active: true },
  { id: "new-damietta", governorate: "Damietta", city: "New Damietta", price: 40, delivery_min_days: 1, delivery_max_days: 2, active: true },
  { id: "blocked", governorate: "Unsupported", price: 500, delivery_min_days: 8, delivery_max_days: 10, active: false },
];

const returnSettings = {
  "orders.return_exchange_window_days": 14,
  "storefront.return_policy_enabled": true,
  "storefront.return_method": "mail",
  "storefront.customer_remorse_return_fees": "customer_responsibility",
  "storefront.defect_return_fees": "merchant_responsibility",
  "storefront.return_policy_url": "https://m1store-egy.com/returns",
};

test("normal and area-specific shipping rules emit separate EGP details", () => {
  const details = buildOfferShippingDetails({ zones: baseZones, currency: "EGP", productPrice: 650, handlingMinDays: 0, handlingMaxDays: 1 });
  assert.equal(details.length, 2);
  assert.equal(details[0].shippingDestination.addressRegion, "Cairo");
  assert.equal(details[0].shippingRate.value, 90);
  assert.equal(details[1].shippingDestination.addressRegion, "New Damietta");
  assert.equal(details[1].shippingRate.value, 40);
  assert.deepEqual(details[0].deliveryTime.handlingTime, {
    "@type": "QuantitativeValue",
    minValue: 0,
    maxValue: 1,
    unitCode: "DAY",
  });
  assert.equal(details.some((item) => item.shippingDestination.addressRegion === "Unsupported"), false);
});

test("global handling time applies to all 28 active zones without changing rates or transit", () => {
  const zones = Array.from({ length: 28 }, (_, index) => ({
    id: `zone-${index + 1}`,
    governorate: `Region ${index + 1}`,
    price: 40 + index,
    transit_min_days: 2,
    transit_max_days: 5,
    active: true,
  }));
  const details = buildOfferShippingDetails({
    zones,
    currency: "EGP",
    handlingMinDays: 0,
    handlingMaxDays: 1,
  });
  assert.equal(details.length, 28);
  assert.ok(details.every((item) => item.deliveryTime.handlingTime.minValue === 0));
  assert.ok(details.every((item) => item.deliveryTime.handlingTime.maxValue === 1));
  assert.ok(details.every((item) => item.deliveryTime.transitTime.minValue === 2));
  assert.ok(details.every((item) => item.deliveryTime.transitTime.maxValue === 5));
  assert.equal(details[0].shippingRate.value, 40);
  assert.equal(details[27].shippingRate.value, 67);
});

test("zone handling override is opt-in and falls back to the global value", () => {
  const zones = [
    { ...baseZones[0], handling_min_days: 3, handling_max_days: 4 },
    {
      ...baseZones[1],
      handling_time_override_enabled: true,
      handling_min_days: 2,
      handling_max_days: 3,
    },
  ];
  const details = buildOfferShippingDetails({
    zones,
    currency: "EGP",
    handlingMinDays: 0,
    handlingMaxDays: 1,
  });
  assert.equal(details[0].deliveryTime.handlingTime.minValue, 0);
  assert.equal(details[0].deliveryTime.handlingTime.maxValue, 1);
  assert.equal(details[1].deliveryTime.handlingTime.minValue, 2);
  assert.equal(details[1].deliveryTime.handlingTime.maxValue, 3);
});

test("configured free-shipping threshold changes the emitted rate without a duplicate source", () => {
  const zone = { ...baseZones[0], free_shipping_threshold: 600 };
  assert.equal(buildOfferShippingDetails({ zones: [zone], currency: "EGP", productPrice: 650 })[0].shippingRate.value, 0);
  assert.equal(buildOfferShippingDetails({ zones: [zone], currency: "EGP", productPrice: 550 })[0].shippingRate.value, 90);
});

test("legacy delivery text is parsed only as a compatibility fallback", () => {
  assert.deepEqual(parseLegacyDeliveryRange("من ٢ إلى ٥ أيام"), { minValue: 2, maxValue: 5 });
  const [detail] = buildOfferShippingDetails({
    zones: [{ governorate: "Alexandria", price: 75, estimated_delivery_text: "2-5 business days", active: true }],
    currency: "EGP",
  });
  assert.equal(detail.deliveryTime.transitTime.minValue, 2);
  assert.equal(detail.deliveryTime.transitTime.maxValue, 5);
});

test("shipping schema has no invented fallback when settings are incomplete", () => {
  assert.deepEqual(buildOfferShippingDetails({ zones: [], currency: "EGP" }), []);
  assert.deepEqual(buildOfferShippingDetails({ zones: baseZones, currency: "" }), []);
  assert.deepEqual(buildOfferShippingDetails({
    zones: [{ governorate: "Cairo", price: 90, active: true }],
    currency: "EGP",
  }), []);
});

test("return policy uses the configured 14-day window and accurate general fees", () => {
  const policy = buildMerchantReturnPolicy(returnSettings);
  assert.equal(policy.merchantReturnDays, 14);
  assert.equal(policy.returnMethod, "https://schema.org/ReturnByMail");
  assert.equal(policy.returnFees, "https://schema.org/ReturnFeesCustomerResponsibility");
  assert.equal(policy.merchantReturnLink, "https://m1store-egy.com/returns");
});

test("Product Offer carries shipping and return policy in both React data and initial HTML", () => {
  const shippingDetails = buildOfferShippingDetails({ zones: baseZones, currency: "EGP", productPrice: 650 });
  const returnPolicy = buildMerchantReturnPolicy(returnSettings);
  const product = {
    id: 25,
    slug: "nike-air-force-1-sneakers",
    name: "Nike Air Force 1 Sneakers",
    brand: "Nike",
    category: "Sneakers",
    sku: "NK-AF-M-LOC",
    description: "Classic Nike Air Force 1 sneakers.",
    image_url: "https://images.example/nike.webp",
    final_price: 650,
    variants: [{ color: "White", size: "41", stock: 3, final_price: 650 }],
    merchant_policies: { shippingDetails, returnPolicy },
  };
  const seo = buildProductSeo(product);
  assert.deepEqual(seo.productJsonLd.offers.shippingDetails, shippingDetails);
  assert.deepEqual(seo.productJsonLd.offers.hasMerchantReturnPolicy, returnPolicy);
  const html = injectProductSeoIntoHtml("<html><head></head><body><div id=\"root\"></div></body></html>", seo);
  const match = html.match(/data-m1-product-seo="product">([\s\S]*?)<\/script>/);
  assert.ok(match);
  const initialProduct = JSON.parse(match[1]);
  assert.deepEqual(initialProduct.offers.shippingDetails, seo.productJsonLd.offers.shippingDetails);
  assert.deepEqual(initialProduct.offers.hasMerchantReturnPolicy, seo.productJsonLd.offers.hasMerchantReturnPolicy);
  assert.equal((html.match(/data-m1-product-seo="product"/g) || []).length, 1);
  assert.equal((html.match(/data-m1-product-seo="breadcrumb"/g) || []).length, 1);
});

test("changing the settings is reflected on the next JSON-LD build", () => {
  const first = buildOfferShippingDetails({ zones: baseZones, currency: "EGP" });
  const changed = buildOfferShippingDetails({
    zones: baseZones.map((zone) => zone.id === "cairo" ? { ...zone, price: 125, delivery_max_days: 6 } : zone),
    currency: "EGP",
  });
  assert.equal(first[0].shippingRate.value, 90);
  assert.equal(changed[0].shippingRate.value, 125);
  assert.equal(changed[0].deliveryTime.transitTime.maxValue, 6);
});

test("hydration cannot replace complete initial schema with an incomplete product payload", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const existingProduct = {
    textContent: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      offers: {
        "@type": "Offer",
        shippingDetails: [{ "@type": "OfferShippingDetails" }],
        hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy" },
      },
    }),
    setAttribute() {},
    remove() {},
  };
  const existingBreadcrumb = { textContent: "{}", setAttribute() {}, remove() {} };
  const querySelector = (selector) => {
    if (selector.includes('data-m1-product-seo="product"')) return existingProduct;
    if (selector.includes('data-m1-product-seo="breadcrumb"')) return existingBreadcrumb;
    return null;
  };
  globalThis.document = {
    title: "",
    head: {
      querySelector,
      querySelectorAll: (selector) => {
        const match = querySelector(selector);
        return match ? [match] : [];
      },
      appendChild() {},
    },
    createElement: () => ({ setAttribute() {}, dataset: {} }),
  };
  globalThis.window = { location: { href: "https://m1store-egy.com/product/nike-air-force-1-sneakers" } };
  try {
    const { applyProductSeo } = await import(`../../src/shared/lib/socialMeta.js?regression=${Date.now()}`);
    assert.equal(applyProductSeo({ name: "Incomplete API product", final_price: 650 }), null);
    const parsed = JSON.parse(existingProduct.textContent);
    assert.ok(parsed.offers.shippingDetails);
    assert.ok(parsed.offers.hasMerchantReturnPolicy);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
