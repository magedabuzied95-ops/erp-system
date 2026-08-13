import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  buildShareAvailableOgImageUrl,
  buildShareAvailablePreviewSvg,
  renderShareAvailableHtml,
  resolveShareAvailablePreviewImage,
} from "../server/controllers/publicProductsController.js";

test("available-products page publishes the first filtered product image directly", () => {
  assert.equal(resolveShareAvailablePreviewImage([
    { public_image_url: "https://api.m1store-egy.com/uploads/products/first.jpg" },
    { public_image_url: "https://api.m1store-egy.com/uploads/products/second.jpg" },
  ]), "https://api.m1store-egy.com/uploads/products/first.jpg");
});

test("available-products page redirects browsers without sending social crawlers through a meta refresh", () => {
  const html = renderShareAvailableHtml({
    req: { originalUrl: "/share/available?size=40&type=sneakers&inStock=1&v=6" },
    targetUrl: "https://m1store-egy.com/shop/products?size=40&type=sneakers&inStock=1",
    ogImageUrl: "https://api.m1store-egy.com/uploads/products/first.jpg",
    products: [{ name: "First product" }],
  });

  assert.match(html, /property="og:image" content="https:\/\/api\.m1store-egy\.com\/uploads\/products\/first\.jpg"/);
  assert.match(html, /window\.location\.replace/);
  assert.doesNotMatch(html, /http-equiv="refresh"/i);
});

test("available-products social preview renders only the first filtered product image", async () => {
  const sourceImage = await sharp({
    create: {
      width: 320,
      height: 320,
      channels: 3,
      background: { r: 214, g: 175, b: 55 },
    },
  }).png().toBuffer();
  const embeddedImageUrl = `data:image/png;base64,${sourceImage.toString("base64")}`;
  const svg = buildShareAvailablePreviewSvg({
    filters: { sizes: ["39"] },
    products: [{ name: "First product", image_url: "https://example.com/first.png" }],
    count: 12,
    embeddedImageUrl,
  });

  assert.match(svg, /<image href="data:image\/png;base64,/);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.doesNotMatch(svg, /<text\b/);
  assert.doesNotMatch(svg, /المنتجات|المقاس|منتج متاح/);

  const png = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
});

test("available-products preview contains no Arabic overlay when there is no image", () => {
  const svg = buildShareAvailablePreviewSvg({
    filters: { sizes: ["24"] },
    products: [],
    count: 0,
  });
  assert.doesNotMatch(svg, /<text\b/);
  assert.doesNotMatch(svg, /المنتجات|المقاس|عرض/);
  assert.doesNotMatch(svg, /<image href="https?:\/\//);
});

test("available-products page publishes a V6 preview URL for social cache invalidation", () => {
  const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://m1store-egy.com";
  try {
    const previewUrl = new URL(buildShareAvailableOgImageUrl(null, {
      sizes: ["39"],
      type: "sneakers",
      inStock: true,
    }));
    assert.equal(previewUrl.pathname, "/share/available/og-image.png");
    assert.equal(previewUrl.searchParams.get("size"), "39");
    assert.equal(previewUrl.searchParams.get("type"), "sneakers");
    assert.equal(previewUrl.searchParams.get("v"), "v6");
  } finally {
    if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
  }
});
