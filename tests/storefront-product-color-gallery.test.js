import test from "node:test";
import assert from "node:assert/strict";

import { buildProductColorGroups, buildSelectedColorGallery, colorSwatchImage, resolveColorGroup } from "../src/storefront/lib/productColorGallery.js";

const colorKey = (variant = {}) => variant.color;
const colorName = (variant = {}) => variant.color;
const inStock = (variant = {}) => Number(variant.stock || 0) > 0;

const product = {
  image_url: "general.jpg",
  variants: [
    { id: 1, color: "White", size: "41", stock: 2, images: [{ image_url: "white-front.jpg" }, { image_url: "white-side.jpg" }] },
    { id: 2, color: "Olive", size: "41", stock: 2, images: [{ image_url: "olive-front.jpg" }, { image_url: "olive-side.jpg" }] },
    { id: 3, color: "Black & White", size: "42", stock: 2, images: [{ image_url: "black-front.jpg" }] },
  ],
};

const groupsFor = (variants = product.variants) => buildProductColorGroups({ variants, colorKey, colorName, variantHasStock: inStock });

test("selecting a color uses its first image and keeps its variants", () => {
  const white = groupsFor().find((group) => group.key === "White");
  assert.equal(colorSwatchImage(white), "white-front.jpg");
  assert.deepEqual(white.variants.map((variant) => variant.id), [1]);
});

test("gallery contains only images for the selected color", () => {
  const olive = groupsFor().find((group) => group.key === "Olive");
  const gallery = buildSelectedColorGallery({ product, colorGroup: olive });
  assert.deepEqual(gallery.map((item) => item.image), ["olive-front.jpg", "olive-side.jpg"]);
  assert.equal(gallery.some((item) => item.image.includes("white") || item.image.includes("black")), false);
});

test("a color with one image keeps a one-image gallery without another color", () => {
  const black = groupsFor().find((group) => group.key === "Black & White");
  const gallery = buildSelectedColorGallery({ product, colorGroup: black });
  assert.deepEqual(gallery.map((item) => item.image), ["black-front.jpg"]);
});

test("legacy product without color-linked images uses only its safe general-image fallback", () => {
  const legacy = {
    image_url: "legacy-general.jpg",
    variants: [{ id: 8, color: "Navy", size: "42", stock: 1 }],
  };
  const navy = groupsFor(legacy.variants)[0];
  assert.equal(colorSwatchImage(navy, legacy.image_url), "legacy-general.jpg");
  assert.deepEqual(buildSelectedColorGallery({ product: legacy, colorGroup: navy }).map((item) => item.image), ["legacy-general.jpg"]);
});

test("changing color cannot retain a gallery image from the previous color", () => {
  const groups = groupsFor();
  const whiteGallery = buildSelectedColorGallery({ product, colorGroup: groups.find((group) => group.key === "White") });
  const oliveGallery = buildSelectedColorGallery({ product, colorGroup: groups.find((group) => group.key === "Olive") });
  assert.equal(oliveGallery.some((item) => whiteGallery.some((previous) => previous.image === item.image)), false);
});

test("unknown URL color falls back to the first available color group", () => {
  const groups = groupsFor();
  const fallback = resolveColorGroup(groups, "not-a-real-color");
  assert.equal(fallback.key, "White");
  assert.deepEqual(buildSelectedColorGallery({ product, colorGroup: fallback }).map((item) => item.image), ["white-front.jpg", "white-side.jpg"]);
});

test("null color/variant records and a variant without a color gallery cannot crash the fallback", () => {
  const malformedProduct = {
    image_url: "safe-general.jpg",
    variants: [null, { id: 99, color: "Blue", size: "43", stock: 1, gallery_images: null, images: null, color_images: null }],
  };
  const groups = groupsFor(malformedProduct.variants);
  const fallback = resolveColorGroup(groups, "missing-url-color");
  assert.equal(fallback?.key, "Blue");
  assert.deepEqual(buildSelectedColorGallery({ product: malformedProduct, colorGroup: fallback }).map((item) => item.image), ["safe-general.jpg"]);
});

test("product cover matching a color cover is emitted once before that color's extra image", () => {
  const oneColorProduct = {
    image_url: "nb-cover.jpg?cache=product",
    image_urls: ["nb-cover.jpg?cache=product", "unlinked-product-image.jpg"],
    color_images: [{
      color: "White & Navy",
      images: [
        { image_id: 10, image_url: "nb-cover.jpg?cache=color", is_primary: true },
        { image_id: 11, image_url: "nb-color-extra.jpg" },
      ],
    }],
    variants: [{ id: 3114, color: "White & Navy", size: "42", stock: 1, image_url: "nb-cover.jpg?cache=product" }],
  };
  const [group] = buildProductColorGroups({ product: oneColorProduct, variants: oneColorProduct.variants, colorKey, colorName, variantHasStock: inStock });
  const gallery = buildSelectedColorGallery({ product: oneColorProduct, colorGroup: group });
  assert.deepEqual(gallery.map((item) => item.image), ["nb-cover.jpg?cache=color", "nb-color-extra.jpg"]);
});

test("multiple colors with color galleries remain isolated even when product has general images", () => {
  const groups = groupsFor();
  const olive = groups.find((group) => group.key === "Olive");
  const gallery = buildSelectedColorGallery({ product: { ...product, gallery_images: ["general-other-angle.jpg"] }, colorGroup: olive, colorGroupCount: groups.length });
  assert.deepEqual(gallery.map((item) => item.image), ["olive-front.jpg", "olive-side.jpg"]);
});
