import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildPriceDropMessage,
  evaluatePriceDrop,
  quietHoursSendAt,
} from "../server/services/storefrontPriceDropAlertService.js";
import { droppedPriceAlerts, readPriceDropEnabled } from "../src/storefront/lib/priceDropAlertsModel.js";
import { WHATSAPP_AUTOMATION_TYPES, normalizeWhatsappAutomationExpiry } from "../shared/whatsappQueueDefaults.js";
import { getSettingDefinition } from "../shared/settingsRegistry.js";

// Price Drop Alert: a customer follows a product, and is told when its storefront price falls
// below the price they followed at.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("a drop is announced only when lower, big enough, and buyable", () => {
  assert.equal(evaluatePriceDrop({ referencePrice: 1000, currentPrice: 900, inStock: true, minPercent: 5 }).drop, true);
  assert.equal(evaluatePriceDrop({ referencePrice: 1000, currentPrice: 950, inStock: true, minPercent: 5 }).drop, true, "exactly the threshold counts");
  assert.equal(evaluatePriceDrop({ referencePrice: 1000, currentPrice: 960, inStock: true, minPercent: 5 }).reason, "below_threshold");
  assert.equal(evaluatePriceDrop({ referencePrice: 1000, currentPrice: 1000, inStock: true }).reason, "not_lower");
  assert.equal(evaluatePriceDrop({ referencePrice: 1000, currentPrice: 1200, inStock: true }).reason, "not_lower");
  assert.equal(evaluatePriceDrop({ referencePrice: 1000, currentPrice: 700, inStock: false }).reason, "out_of_stock");
  // A product that lost its price is not a 100% discount.
  assert.equal(evaluatePriceDrop({ referencePrice: 1000, currentPrice: 0, inStock: true }).reason, "no_price");
  assert.equal(evaluatePriceDrop({ referencePrice: 1000, currentPrice: 999, inStock: true, minPercent: 0 }).drop, true);
});

test("nothing leaves during Cairo quiet hours; it waits for 10:00", () => {
  // 13 September 2026: Cairo is UTC+3.
  assert.equal(quietHoursSendAt(new Date("2026-09-13T12:00:00Z")), null, "15:00 Cairo sends now");
  assert.equal(quietHoursSendAt(new Date("2026-09-13T22:30:00Z")).toISOString(), "2026-09-14T07:00:00.000Z", "01:30 waits for 10:00");
  assert.equal(quietHoursSendAt(new Date("2026-09-13T20:15:00Z")).toISOString(), "2026-09-14T07:00:00.000Z", "23:15 waits for the next morning");
  assert.equal(quietHoursSendAt(new Date("2026-09-14T07:00:00Z")), null, "10:00 is open");
});

test("the message names the product, both prices and links the product page", () => {
  const message = buildPriceDropMessage({
    product: { id: 5, slug: "nike-af1", name: "Nike AF1", image_url: "/uploads/a.jpg" },
    oldPrice: 1200,
    newPrice: 999,
    customerName: "Ahmed Ali",
    baseUrl: "https://m1store-egy.com/",
  });
  assert.equal(message.url, "https://m1store-egy.com/shop/product/nike-af1");
  assert.match(message.body, /Ahmed/);
  assert.match(message.card.body, /1,200/);
  assert.match(message.card.body, /999/);
  assert.equal(message.card.url, message.url);
  assert.equal(message.card.imageUrl, "/uploads/a.jpg");
  assert.match(message.fallbackText, /https:\/\/m1store-egy\.com\/shop\/product\/nike-af1/);
});

test("the wishlist panel lists only real drops, biggest first", () => {
  const product = { id: 1, slug: "a", name: "A" };
  const list = droppedPriceAlerts([
    { product_id: 1, dropped: true, followed_price: 1000, current_price: 900, product },
    { product_id: 2, dropped: true, followed_price: 1000, current_price: 500, product: { ...product, id: 2 } },
    { product_id: 3, dropped: false, followed_price: 1000, current_price: 1000, product },
    { product_id: 4, dropped: true, followed_price: 1000, current_price: 800, product: null },
  ]);
  assert.deepEqual(list.map((alert) => alert.product_id), [2, 1]);
});

test("the button stays hidden unless the backend publishes the switch", () => {
  assert.equal(readPriceDropEnabled({ settings: {} }), false);
  assert.equal(readPriceDropEnabled({ settings: { "storefront.price_drop_alert.enabled": true } }), true);
  assert.equal(readPriceDropEnabled({ settings: { "storefront.price_drop_alert.enabled": false } }), false);
});

test("settings: storefront switch public, WhatsApp off by default and private", () => {
  const enabled = getSettingDefinition("storefront.price_drop_alert.enabled");
  const whatsapp = getSettingDefinition("storefront.price_drop_alert.whatsapp_enabled");
  const minPercent = getSettingDefinition("storefront.price_drop_alert.min_percent");
  assert.equal(enabled?.defaultValue, true);
  assert.equal(enabled?.isPublic, true);
  assert.equal(whatsapp?.defaultValue, false);
  assert.notEqual(whatsapp?.isPublic, true);
  assert.equal(minPercent?.defaultValue, 5);
});

test("the WhatsApp send is a paced engagement message with its own expiry", () => {
  assert.equal(WHATSAPP_AUTOMATION_TYPES.price_drop_alert, "engagement");
  assert.equal(normalizeWhatsappAutomationExpiry({}).price_drop_alert, 480);
});

test("wiring: routes, wishlist door, boot schema, tick, and the gitignore allowlist", () => {
  const routes = read("../server/routes/storefront.js");
  assert.match(routes, /router\.get\("\/price-alerts", \.\.\.storefrontCustomerAuthRequired/);
  assert.match(routes, /router\.post\("\/price-alerts", \.\.\.storefrontCustomerAuthRequired/);
  assert.match(routes, /router\.delete\("\/price-alerts\/:productId", \.\.\.storefrontCustomerAuthRequired/);

  const controller = read("../server/controllers/storefrontController.js");
  const saveWishlist = controller.slice(controller.indexOf("export const saveWishlist"), controller.indexOf("export const saveRecentlyViewed"));
  assert.match(saveWishlist, /setPriceAlertFollow\(\{[^}]*source: "wishlist"/);
  // The price compared is the product page's own price, not a hand-rolled one.
  const snapshot = controller.slice(controller.indexOf("export const loadStorefrontProductPriceSnapshots"), controller.indexOf("const productAudienceFilterSql"));
  assert.match(snapshot, /normalizeProduct\(row, pricingSettings\)/);
  assert.match(snapshot, /buildCatalogQuery\(/);

  const server = read("../server/server.js");
  assert.match(server, /await ensurePriceDropAlertSchema\(db\)/);
  assert.match(server, /runPriceDropAlertTick\(\)/);

  const service = read("../server/services/storefrontPriceDropAlertService.js");
  // Claim before send: the claim must still see the reference price that was read.
  assert.match(service, /AND reference_price = \$3/);
  assert.ok(service.indexOf("claimAlert({ alert, price })") < service.indexOf("await notifyCustomer("), "claim precedes the send");
  assert.match(service, /if \(!config\.whatsapp_enabled\) return/);

  const gitignore = read("../.gitignore");
  assert.equal(gitignore.split(/\r?\n/).filter((line) => line === "!server/services/storefrontPriceDropAlertService.js").length, 2);

  const pdp = read("../src/storefront/pages/StorefrontProductDetailPage.jsx");
  assert.match(pdp, /priceDrop\.enabled && !showRestockCta/);
});
