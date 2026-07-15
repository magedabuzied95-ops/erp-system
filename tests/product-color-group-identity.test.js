import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { collectProductVariantImagesFromPayload } from "../server/services/productVariantImagesService.js";

test("variant payload keeps the durable color group identity", () => {
  const source = fs.readFileSync(new URL("../src/modules/products/services/productsApi.js", import.meta.url), "utf8");
  assert.match(source, /color_group_key:\s*normalizeText/);
  assert.match(source, /source\.colorGroupKey/);
});

test("three color groups never merge images just because the visible color name matches", () => {
  const records = collectProductVariantImagesFromPayload({
    productId: 77,
    colorImages: [
      { color_group_key: "group-a", color_name: "Black", images: [{ image_url: "/a.webp", is_primary: true }] },
      { color_group_key: "group-b", color_name: "Black", images: [{ image_url: "/b.webp", is_primary: true }] },
      { color_group_key: "group-c", color_name: "Green", images: [{ image_url: "/c.webp", is_primary: true }] },
    ],
  });

  assert.equal(records.length, 3);
  assert.deepEqual(new Set(records.map((record) => record.color_group_key)), new Set(["group-a", "group-b", "group-c"]));
});

test("the same image URL can belong to two independently saved color groups", () => {
  const records = collectProductVariantImagesFromPayload({
    productId: 88,
    colorImages: [
      { color_group_key: "group-a", color_name: "Black", images: [{ image_url: "/shared.webp", is_primary: true }] },
      { color_group_key: "group-b", color_name: "Black", images: [{ image_url: "/shared.webp", is_primary: true }] },
    ],
  });

  assert.equal(records.length, 2);
  assert.deepEqual(new Set(records.map((record) => record.color_group_key)), new Set(["group-a", "group-b"]));
});
