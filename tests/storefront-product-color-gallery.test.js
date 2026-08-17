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

test("two model groups with the same visible color name stay separate", () => {
  const variants = [
    { id: 501, color: "White & Black", color_group_key: "model-a", size: "42", stock: 1, selling_price: 1200 },
    { id: 502, color: "White & Black", color_group_key: "model-b", size: "42", stock: 1, selling_price: 1450 },
  ];
  const groups = buildProductColorGroups({
    variants,
    colorKey: (variant) => variant.color_group_key || variant.color,
    colorName,
    variantHasStock: inStock,
  });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.key), ["model-a", "model-b"]);
  assert.deepEqual(groups.map((group) => group.variants[0].selling_price), [1200, 1450]);
});

test("Crocs 733 production payload keeps its two Grey colours photographically separate", () => {
  const greyA = "https://cdn/1786474207403-f2d6a8ef.jpg";
  const greyB = "https://cdn/1786887175290-photo_5769295557607231345_y.jpg";
  const keyA = "f22d94ad-d223-4432-9af3-a7571f12551b";
  const keyB = "0bc71c9e-0c0a-4579-9bf6-b01c5d6789ae";
  const payload = {
    id: "733",
    image_url: "product-cover.jpg",
    color_images: [
      { color: "Grey", color_name: "Grey", color_group_key: keyA, images: [{ id: "1", color_group_key: keyA, color_name: "Grey", image_url: greyA, is_primary: true }] },
      { color: "Grey", color_name: "Grey", color_group_key: keyB, images: [{ id: "2", color_group_key: keyB, color_name: "Grey", image_url: greyB, is_primary: true }] },
    ],
    variants: [
      { id: 9001, color: "Grey", color_group_key: keyA, size: "41/42", stock: 1 },
      { id: 9002, color: "Grey", color_group_key: keyB, size: "43/44", stock: 1 },
    ],
  };
  const groups = buildProductColorGroups({
    product: payload,
    variants: payload.variants,
    colorKey: (variant) => variant.color_group_key || variant.color,
    colorName,
    variantHasStock: inStock,
  });

  assert.deepEqual(groups.map((group) => group.key), [keyA, keyB]);
  assert.deepEqual(buildSelectedColorGallery({ product: payload, colorGroup: groups[0] }).map((item) => item.image), [greyA]);
  assert.deepEqual(buildSelectedColorGallery({ product: payload, colorGroup: groups[1] }).map((item) => item.image), [greyB]);
  assert.equal(colorSwatchImage(groups[0]), greyA);
  assert.equal(colorSwatchImage(groups[1]), greyB);
});

test("a same-named colour whose images live only on the variant never borrows its twin's entry", () => {
  const payload = {
    id: "734",
    color_images: [
      { color: "Grey", color_name: "Grey", color_group_key: "keyed-grey", images: [{ id: "1", image_url: "keyed-grey.jpg", is_primary: true }] },
    ],
    variants: [
      { id: 1, color: "Grey", color_group_key: "keyed-grey", size: "41", stock: 1 },
      { id: 2, color: "Grey", color_group_key: "other-grey", size: "41", stock: 1, images: [{ id: "9", image_url: "other-grey.jpg" }] },
    ],
  };
  const groups = buildProductColorGroups({
    product: payload,
    variants: payload.variants,
    colorKey: (variant) => variant.color_group_key || variant.color,
    colorName,
    variantHasStock: inStock,
  });

  assert.deepEqual(buildSelectedColorGallery({ product: payload, colorGroup: groups[0] }).map((item) => item.image), ["keyed-grey.jpg"]);
  assert.deepEqual(buildSelectedColorGallery({ product: payload, colorGroup: groups[1] }).map((item) => item.image), ["other-grey.jpg"]);
});

test("an exact colour-key request wins over an earlier group sharing the requested name", () => {
  const groups = [
    { key: "group-a", colorName: "Grey", images: [], variants: [] },
    { key: "grey", colorName: "Grey", images: [], variants: [] },
  ];
  assert.equal(resolveColorGroup(groups, "grey").key, "grey");
  assert.equal(resolveColorGroup(groups, "group-a").key, "group-a");
});

test("New Balance 530 production payload keeps White & Navy cover plus its stored extra image", () => {
  const cover = "https://res.cloudinary.com/dpnyfsjvz/image/upload/v1784140987/erp/products/ssgvyssfwsfbz9wdcomb.jpg";
  const extra = "https://res.cloudinary.com/dpnyfsjvz/image/upload/v1784735201/erp/products/f4fqafxwunrlhxwimbdg.png";
  const colorGroupKey = "legacy-eeaad18664b712c6437bd112a55d1079";
  const actualProductPayload = {
    id: "140",
    color_images: [{
      color: "White & Navy",
      color_name: "White & Navy",
      color_group_key: colorGroupKey,
      images: [
        { id: "2551", color_group_key: colorGroupKey, color_name: "White & Navy", image_url: cover, sort_order: 0, is_primary: true },
        { id: "2552", color_group_key: colorGroupKey, color_name: "White & Navy", image_url: extra, sort_order: 1, is_primary: false },
      ],
    }],
    variants: [{
      id: 3114,
      color: "White & Navy",
      stock: 2,
      images: [
        { id: "2551", color_group_key: colorGroupKey, color_name: "White & Navy", image_url: cover, sort_order: 0, is_primary: true },
        { id: "2552", color_group_key: colorGroupKey, color_name: "White & Navy", image_url: extra, sort_order: 1, is_primary: false },
      ],
    }],
  };
  const groups = buildProductColorGroups({
    product: actualProductPayload,
    variants: actualProductPayload.variants,
    colorKey: (variant) => variant.images?.[0]?.color_group_key || variant.color,
    colorName,
    variantHasStock: inStock,
  });
  assert.equal(groups[0].key, colorGroupKey);
  assert.deepEqual(buildSelectedColorGallery({ product: actualProductPayload, colorGroup: groups[0] }).map((item) => item.image), [cover, extra]);
});
