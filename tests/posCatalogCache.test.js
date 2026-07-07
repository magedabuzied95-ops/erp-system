import assert from "node:assert/strict";
import test from "node:test";

import {
  POS_CATALOG_SCHEMA_VERSION,
  buildPosCatalogSnapshot,
  extractPosCatalogSnapshotImageUrls,
} from "../src/modules/pos/lib/posCatalogCache.js";

test("buildPosCatalogSnapshot trims catalog payload to essentials", () => {
  const snapshot = buildPosCatalogSnapshot([
    {
      id: 11,
      product_id: 11,
      name: "Jordan",
      price: "1250",
      stock: "8",
      image_url: "https://cdn.example.com/products/jordan.jpg",
      description: "large text should not be cached",
      variants: [
        {
          id: 22,
          variant_id: 22,
          product_id: 11,
          price: "1300",
          stock_quantity: "3",
          image_url: "https://cdn.example.com/products/jordan-thumb.jpg",
          notes: "ignored",
        },
      ],
    },
  ]);

  assert.equal(snapshot.schema_version, POS_CATALOG_SCHEMA_VERSION);
  assert.equal(snapshot.products.length, 1);
  assert.equal(snapshot.products[0].image_url, "https://cdn.example.com/products/jordan.jpg");
  assert.equal(snapshot.products[0].variants[0].image_url, "https://cdn.example.com/products/jordan-thumb.jpg");
  assert.equal(snapshot.products[0].variants[0].stock_quantity, 3);
  assert.equal(snapshot.products[0].description, undefined);
  assert.match(snapshot.cached_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("extractPosCatalogSnapshotImageUrls dedupes thumbnail urls", () => {
  const urls = extractPosCatalogSnapshotImageUrls([
    {
      image_url: "https://cdn.example.com/a.jpg",
      product_image_url: "https://cdn.example.com/a.jpg",
      variants: [
        { image_url: "https://cdn.example.com/b.jpg" },
        { thumbnail_url: "https://cdn.example.com/b.jpg" },
      ],
    },
  ]);

  assert.deepEqual(urls, [
    "https://cdn.example.com/a.jpg",
    "https://cdn.example.com/b.jpg",
  ]);
});

