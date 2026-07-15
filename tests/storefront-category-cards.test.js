import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("storefront category cards use full-bleed motion media", async () => {
  const source = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");

  assert.match(source, /function HomeCategoryMotionMedia/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /muted[\s\S]*?loop[\s\S]*?playsInline/);
  assert.match(source, /min-h-\[390px\][\s\S]*?overflow-hidden/);
  assert.match(source, /HomeCategoryMotionMedia video=\{card\.video\} image=\{card\.image\}/);
  assert.match(source, /h-full w-full object-cover transition/);
  assert.match(source, /match\?\.promo_video_url/);
  assert.match(source, /matchingProducts\.find\(\(product\) => homeProductWithImage\(product\)\)/);
  assert.match(source, /saleProducts\.find\(\(product\) => isAvailableProduct\(product\) && homeProductWithImage\(product\)\)/);
  assert.match(source, /تسوّق الآن/);
});
