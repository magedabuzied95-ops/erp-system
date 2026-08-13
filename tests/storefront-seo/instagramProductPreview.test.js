import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  injectProductSeoIntoHtml,
  makeProductSeoImagesAbsolute,
} from "../../server/services/storefrontProductSeoPageService.js";

const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));

test("legacy shop product links are server-rendered for Instagram crawlers", () => {
  assert.ok(vercel.rewrites.some((rewrite) =>
    rewrite.source === "/shop/product/:identifier"
    && rewrite.destination.endsWith("/api/storefront/seo/product/:identifier")
  ));
});

test("local product uploads become absolute public API image URLs", () => {
  const seo = makeProductSeoImagesAbsolute({
    image: "/uploads/products/shoe.webp",
    productJsonLd: { image: ["/uploads/products/shoe.webp"] },
  });
  assert.equal(seo.image, "https://api.m1store-egy.com/uploads/products/shoe.webp");
  assert.deepEqual(seo.productJsonLd.image, ["https://api.m1store-egy.com/uploads/products/shoe.webp"]);
});

test("rendered Open Graph and Twitter image tags use the absolute product image", () => {
  const seo = makeProductSeoImagesAbsolute({
    title: "Adidas Adistar22 | M1 Store",
    description: "Product description",
    canonical: "https://m1store-egy.com/product/adidas-adidas-adistar22",
    image: "/uploads/products/shoe.webp",
    url: "https://m1store-egy.com/product/adidas-adidas-adistar22",
    robots: "index,follow,max-image-preview:large",
    productJsonLd: { image: ["/uploads/products/shoe.webp"] },
    breadcrumbJsonLd: {},
  });
  const html = injectProductSeoIntoHtml("<html><head></head><body></body></html>", seo);
  assert.match(html, /property="og:image" content="https:\/\/api\.m1store-egy\.com\/uploads\/products\/shoe\.webp"/);
  assert.match(html, /name="twitter:image" content="https:\/\/api\.m1store-egy\.com\/uploads\/products\/shoe\.webp"/);
});
