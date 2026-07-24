import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductBaseSlug,
  normalizeProductImageUrl,
  productSlugWithId,
  slugifyProductValue,
  uniqueImageUrls,
} from "../server/utils/productSlug.js";

test("product slug generation uses brand and name with a stable product id suffix", () => {
  const base = buildProductBaseSlug({ brand: "Adidas", name: "Adidas Running" });
  assert.equal(base, "adidas-adidas-running");
  assert.equal(productSlugWithId(base, 130), "adidas-adidas-running-130");
});

test("slugifyProductValue produces lowercase URL-safe slugs", () => {
  assert.equal(slugifyProductValue(" Adidas  Running / White "), "adidas-running-white");
  assert.equal(slugifyProductValue("___Nike@@@Air   Max___"), "nike-air-max");
});

test("normalizeProductImageUrl extracts URLs from image objects and rejects invalid values", () => {
  assert.equal(normalizeProductImageUrl({ url: "https://cdn.example.com/a.jpg" }), "https://cdn.example.com/a.jpg");
  assert.equal(normalizeProductImageUrl({ image_url: "/uploads/a.jpg" }), "/uploads/a.jpg");
  assert.equal(normalizeProductImageUrl({ secure_url: "https://cdn.example.com/b.jpg" }), "https://cdn.example.com/b.jpg");
  assert.equal(normalizeProductImageUrl({ src: "uploads/c.jpg" }), "uploads/c.jpg");
  assert.equal(normalizeProductImageUrl({}), "");
  assert.equal(normalizeProductImageUrl("[object Object]"), "");
  assert.equal(normalizeProductImageUrl("javascript:alert(1)"), "");
});

test("uniqueImageUrls removes duplicate and invalid additional images", () => {
  assert.deepEqual(
    uniqueImageUrls([
      "https://cdn.example.com/a.jpg",
      { url: "https://cdn.example.com/a.jpg" },
      { image_url: "/uploads/b.jpg" },
      "[object Object]",
      null,
    ]),
    ["https://cdn.example.com/a.jpg", "/uploads/b.jpg"]
  );
});
