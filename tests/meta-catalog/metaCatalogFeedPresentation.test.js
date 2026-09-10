import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMetaCatalogItem,
  metaCatalogItemXml,
  metaItemGroupId,
} from "../../server/services/metaCatalogFeedService.js";

const baseRow = (overrides = {}) => ({
  product_id: 10,
  variant_id: 20,
  variant_sku: "SKU-20",
  sku_count: 1,
  product_name: "Nike V2K",
  product_type: "Sneakers",
  variant_stock: 3,
  product_selling_price: 500,
  color: "White & Pink",
  size: "39",
  ...overrides,
});

test("the ad title carries the colourway, never the size", () => {
  const item = buildMetaCatalogItem(baseRow());
  assert.equal(item.title, "Nike V2K - White & Pink");
  assert.equal(item.size, "39");
  assert.match(metaCatalogItemXml(item), /<g:size>39<\/g:size>/);
});

test("sizes share a colourway group while colours advertise separately", () => {
  const size39 = metaItemGroupId(baseRow({ size: "39", variant_id: 20 }));
  const size41 = metaItemGroupId(baseRow({ size: "41", variant_id: 21 }));
  const black = metaItemGroupId(baseRow({ color: "Black&white", variant_id: 22 }));

  assert.equal(size39, "10-white-pink");
  assert.equal(size41, size39);
  assert.equal(black, "10-black-white");
  assert.notEqual(black, size39);
});

test("a colourless row still groups by product, and a non-latin colour stays distinct", () => {
  assert.equal(metaItemGroupId(baseRow({ color: "" })), "10");
  const arabic = metaItemGroupId(baseRow({ color: "أسود" }));
  const arabicOther = metaItemGroupId(baseRow({ color: "أبيض" }));
  assert.notEqual(arabic, "10");
  assert.notEqual(arabic, arabicOther);
});

test("audience reaches Meta as gender and age group", () => {
  const men = buildMetaCatalogItem(baseRow({ variant_audience: "men" }));
  assert.equal(men.gender, "male");
  assert.equal(men.age_group, "adult");
  assert.match(metaCatalogItemXml(men), /<g:gender>male<\/g:gender>/);
  assert.match(metaCatalogItemXml(men), /<g:age_group>adult<\/g:age_group>/);

  const kids = buildMetaCatalogItem(baseRow({ product_gender: "kids" }));
  assert.equal(kids.gender, "unisex");
  assert.equal(kids.age_group, "kids");

  const unknown = buildMetaCatalogItem(baseRow());
  assert.equal(unknown.gender, "");
  const xml = metaCatalogItemXml(unknown);
  assert.equal(xml.includes("<g:gender>"), false);
  assert.equal(xml.includes("<g:age_group>"), false);
});

test("a Facebook category override reaches the feed instead of being dropped", () => {
  const item = buildMetaCatalogItem(baseRow({ facebook_product_category: "Clothing & Accessories > Shoes" }));
  assert.equal(item.fb_product_category, "Clothing & Accessories > Shoes");
  assert.match(
    metaCatalogItemXml(item),
    /<g:fb_product_category>Clothing &amp; Accessories &gt; Shoes<\/g:fb_product_category>/
  );
});

test("object gallery entries become real urls instead of [object Object]", () => {
  const item = buildMetaCatalogItem(baseRow({
    variant_image_url: "/uploads/main.png",
    gallery_images: JSON.stringify([
      { url: "/uploads/one.png" },
      { image_url: "https://cdn.example.com/two.png" },
      { secure_url: "/uploads/three.png" },
      "/uploads/four.png",
      { caption: "no url here" },
    ]),
  }), { backendUrl: "https://api.m1store-egy.com" });

  assert.deepEqual(item.additional_image_link, [
    "https://api.m1store-egy.com/uploads/one.png",
    "https://cdn.example.com/two.png",
    "https://api.m1store-egy.com/uploads/three.png",
    "https://api.m1store-egy.com/uploads/four.png",
  ]);
  assert.equal(metaCatalogItemXml(item).includes("object Object"), false);
});

test("a colour gallery of objects is cleaned the same way", () => {
  const item = buildMetaCatalogItem(baseRow({
    variant_image_url: "/uploads/main.png",
    color_gallery: [{ image_url: "/uploads/colour-a.png" }, "/uploads/colour-b.png"],
  }), { backendUrl: "https://api.m1store-egy.com" });

  assert.deepEqual(item.additional_image_link, [
    "https://api.m1store-egy.com/uploads/colour-a.png",
    "https://api.m1store-egy.com/uploads/colour-b.png",
  ]);
});

test("the card links to its own colourway on the storefront", () => {
  const item = buildMetaCatalogItem(baseRow({ slug: "nike-v2k" }), { storefrontUrl: "https://m1store-egy.com" });
  assert.equal(item.link, "https://m1store-egy.com/product/nike-v2k?color=White%20%26%20Pink");

  const colourless = buildMetaCatalogItem(baseRow({ slug: "nike-v2k", color: "" }), {
    storefrontUrl: "https://m1store-egy.com",
  });
  assert.equal(colourless.link, "https://m1store-egy.com/product/nike-v2k");
});
