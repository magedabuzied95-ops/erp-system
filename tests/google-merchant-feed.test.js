import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildGoogleMerchantItem,
  buildGoogleMerchantFeedFromRows,
  googleMerchantItemXml,
  resolveGoogleFeedPricing,
} from "../server/services/googleMerchantFeedService.js";
import { createGoogleMerchantFeedHandler } from "../server/routes/googleMerchantFeed.js";

const baseRow = {
  product_id: 100,
  product_name: "Runner Pro",
  description: "Light & comfortable <shoe>",
  slug: "runner-pro",
  product_type: "sneakers",
  category_name: "Sneakers",
  brand_name: "M1",
  product_gender: "men",
  product_image_url: "/uploads/runner.webp",
  product_selling_price: 1000,
  product_regular_price: 1000,
  product_price: 1000,
  product_sale_price: 0,
  product_sale_price_enabled: false,
  product_stock: 10,
  gallery_images: [{ url: "/uploads/runner-side.webp" }],
};

const variant = (overrides = {}) => ({
  ...baseRow,
  variant_id: 501,
  color: "Black",
  size: "42",
  variant_stock: 3,
  variant_selling_price: 1000,
  variant_regular_price: 1000,
  variant_price: 1000,
  variant_sale_price: 0,
  variant_sale_price_enabled: false,
  variant_image_url: "/uploads/runner-black-42.webp",
  ...overrides,
});

test("shoe color × size variants have unique ids and one item_group_id", () => {
  const rows = [
    variant({ variant_id: 501, color: "Black", size: "42" }),
    variant({ variant_id: 502, color: "Black", size: "43" }),
    variant({ variant_id: 503, color: "White", size: "42" }),
  ];
  const items = rows.map(buildGoogleMerchantItem);
  assert.deepEqual(items.map((item) => item.id), ["100-501", "100-502", "100-503"]);
  assert.equal(new Set(items.map((item) => item.id)).size, 3);
  assert.deepEqual(new Set(items.map((item) => item.item_group_id)), new Set(["100"]));
  assert.deepEqual(items.map((item) => [item.color, item.size]), [["Black", "42"], ["Black", "43"], ["White", "42"]]);
});

test("discounted item emits compare price plus sale_price; regular item emits price only", () => {
  const discounted = variant({
    product_selling_price: 1000,
    product_sale_price: 850,
    product_sale_price_enabled: true,
  });
  assert.deepEqual(resolveGoogleFeedPricing(discounted), {
    price: 1000,
    sale_price: 850,
    active_price: 850,
  });
  const discountedItem = buildGoogleMerchantItem(discounted);
  assert.equal(discountedItem.price, "1000.00 EGP");
  assert.equal(discountedItem.sale_price, "850.00 EGP");

  const regularItem = buildGoogleMerchantItem(variant({
    product_regular_price: 1500,
    variant_regular_price: 1500,
    product_sale_price_enabled: false,
    variant_sale_price_enabled: false,
  }));
  assert.equal(regularItem.price, "1000.00 EGP");
  assert.equal(regularItem.sale_price, "");
});

test("availability is variant-specific for available and unavailable sizes", () => {
  assert.equal(buildGoogleMerchantItem(variant({ variant_stock: 2 })).availability, "in_stock");
  assert.equal(buildGoogleMerchantItem(variant({ variant_id: 502, variant_stock: 0 })).availability, "out_of_stock");
});

test("bag may have a color without a size", () => {
  const bag = buildGoogleMerchantItem(variant({
    product_id: 200,
    variant_id: 701,
    product_name: "Tote Bag",
    slug: "tote-bag",
    product_type: "bags",
    category_name: "Bags",
    product_gender: "women",
    color: "Brown",
    size: "",
  }));
  assert.ok(bag);
  assert.equal(bag.color, "Brown");
  assert.equal(bag.size, "");
  assert.equal(bag.google_product_category, "Apparel & Accessories > Handbags, Wallets & Cases > Handbags");
});

test("invalid zero prices and incomplete footwear variants are excluded", () => {
  assert.equal(buildGoogleMerchantItem(variant({
    product_selling_price: 0,
    product_regular_price: 0,
    product_price: 0,
    variant_selling_price: 0,
    variant_regular_price: 0,
    variant_price: 0,
  })), null);
  assert.equal(buildGoogleMerchantItem(variant({ size: "" })), null);
  assert.equal(buildGoogleMerchantItem(variant({ color: "" })), null);
});

test("feed uses storefront canonical links, HTTPS images, escaped XML, and no ERP links", () => {
  const feed = buildGoogleMerchantFeedFromRows([variant()]);
  assert.equal(feed.items.length, 1);
  assert.match(feed.xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(feed.xml, /<rss version="2\.0" xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0">/);
  assert.match(feed.xml, /Light &amp; comfortable &lt;shoe&gt;/);
  assert.match(feed.xml, /https:\/\/m1store-egy\.com\/product\/runner-pro/);
  assert.match(feed.xml, /https:\/\/api\.m1store-egy\.com\/uploads\/runner-black-42\.webp/);
  assert.match(feed.xml, /https:\/\/api\.m1store-egy\.com\/uploads\/runner-side\.webp/);
  assert.doesNotMatch(feed.xml, /%5Bobject%20Object%5D|\[object Object\]/);
  assert.doesNotMatch(feed.xml, /erp\.m1store-egy\.com/);
  assert.doesNotMatch(feed.xml, /<g:price>0(?:\.00)? EGP<\/g:price>/);
  assert.equal((feed.xml.match(/<item>/g) || []).length, (feed.xml.match(/<\/item>/g) || []).length);
});

test("XML includes Google variant, audience, identifier and condition fields", () => {
  const item = buildGoogleMerchantItem(variant({ variant_barcode: "4006381333931" }));
  const xml = googleMerchantItemXml(item);
  assert.match(xml, /<g:item_group_id>100<\/g:item_group_id>/);
  assert.match(xml, /<g:color>Black<\/g:color>/);
  assert.match(xml, /<g:size>42<\/g:size>/);
  assert.match(xml, /<g:gender>male<\/g:gender>/);
  assert.match(xml, /<g:age_group>adult<\/g:age_group>/);
  assert.match(xml, /<g:condition>new<\/g:condition>/);
  assert.match(xml, /<g:gtin>4006381333931<\/g:gtin>/);
  assert.match(xml, /<g:identifier_exists>yes<\/g:identifier_exists>/);
});

const responseRecorder = () => {
  const headers = {};
  return {
    headers,
    statusCode: 0,
    body: "",
    set(name, value) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    },
    type(value) {
      headers["content-type"] = value;
      return this;
    },
  };
};

test("HTTP handler returns 200 RSS XML and supports ETag conditional caching", async () => {
  const feed = {
    ...buildGoogleMerchantFeedFromRows([variant()]),
    etag: '"feed-etag"',
    generatedAt: Date.now(),
  };
  const handler = createGoogleMerchantFeedHandler({ loadFeed: async () => feed });
  const response = responseRecorder();
  await handler({ headers: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^application\/rss\+xml/);
  assert.equal(response.headers.etag, '"feed-etag"');
  assert.match(response.body, /^<\?xml/);
  assert.doesNotMatch(response.body, /<!doctype html|<html/i);

  const cachedResponse = responseRecorder();
  await handler({ headers: { "if-none-match": '"feed-etag"' } }, cachedResponse);
  assert.equal(cachedResponse.statusCode, 304);
});

test("Meta feed remains on its original independent route and service", () => {
  const routeSource = fs.readFileSync(new URL("../server/routes/metaCatalogFeed.js", import.meta.url), "utf8");
  const serviceSource = fs.readFileSync(new URL("../server/services/metaCatalogFeedService.js", import.meta.url), "utf8");
  assert.match(routeSource, /router\.get\("\/meta\.xml"/);
  assert.match(routeSource, /buildMetaCatalogFeed/);
  assert.doesNotMatch(routeSource, /googleMerchant/i);
  assert.doesNotMatch(serviceSource, /googleMerchant/i);
});

test("Vercel exposes Google feed before SPA fallback", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const sources = config.rewrites.map(({ source }) => source);
  assert.ok(sources.indexOf("/feeds/google.xml") >= 0);
  assert.ok(sources.indexOf("/feeds/google.xml") < sources.indexOf("/(.*)"));
});
