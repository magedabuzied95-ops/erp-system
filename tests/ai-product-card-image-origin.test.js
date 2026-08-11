import test from "node:test";
import assert from "node:assert/strict";

import { resolvePublicProductImageUrl } from "../server/services/aiProductCards.js";

const storefront = "https://m1store-egy.com";
const api = "https://api.m1store-egy.com";

test("AI product cards serve migrated upload images from the public API origin", () => {
  assert.equal(
    resolvePublicProductImageUrl("/uploads/products/cloudinary/shoe.jpg", {
      baseUrl: storefront,
      assetBaseUrl: api,
    }),
    `${api}/uploads/products/cloudinary/shoe.jpg`
  );
});

test("AI product cards expand legacy product image paths on the public API origin", () => {
  assert.equal(
    resolvePublicProductImageUrl("products/cloudinary/shoe.jpg", {
      baseUrl: storefront,
      assetBaseUrl: api,
    }),
    `${api}/uploads/products/cloudinary/shoe.jpg`
  );
  assert.equal(
    resolvePublicProductImageUrl("cloudinary/shoe.jpg", {
      baseUrl: storefront,
      assetBaseUrl: api,
    }),
    `${api}/uploads/products/cloudinary/shoe.jpg`
  );
});

test("AI product cards preserve absolute image URLs and storefront shop paths", () => {
  const cloudinary = "https://res.cloudinary.com/demo/image/upload/shoe.jpg";
  assert.equal(
    resolvePublicProductImageUrl(cloudinary, { baseUrl: storefront, assetBaseUrl: api }),
    cloudinary
  );
  assert.equal(
    resolvePublicProductImageUrl("/shop/assets/shoe.jpg", { baseUrl: storefront, assetBaseUrl: api }),
    `${storefront}/shop/assets/shoe.jpg`
  );
});
