import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { isMirrorProduct } from "../src/shared/lib/mirrorProduct.js";

test("mirror products are recognized from the compact storefront grade field", () => {
  assert.equal(isMirrorProduct({ grade: "mirror original" }), true);
  assert.equal(isMirrorProduct({ grade: "ميرور أوريجنال" }), true);
  assert.equal(isMirrorProduct({ is_mirror: true }), true);
  assert.equal(isMirrorProduct({ grade: "egyptian" }), false);
});

test("home hero requests and prioritizes Mirror Original products", async () => {
  const source = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");

  assert.match(source, /useProducts\(\{ quality: "mirror_original", sort: "newest", limit: 24 \}\)/);
  assert.match(source, /const mirrorHeroSlides = useMemo/);
  assert.match(source, /mirrorCandidates\.slice\(0, 12\)/);
  assert.match(source, /productsPath\(\{ quality: "mirror_original", sort: "newest" \}\)/);
  assert.match(source, /heroComparePrice/);
  assert.match(source, /وفر \$\{heroDiscount\}%/);
  assert.match(source, /اطلب الآن/);
  assert.match(source, /min-h-\[516px\] flex-col/);
  assert.match(source, /line-clamp-2 h-12 overflow-hidden/);
  assert.match(source, /\{activeHeroIndex \+ 1\}\/\{availableHeroSlides\.length\}/);
  assert.match(source, /preloadStorefrontImage\(nextImage, "hero"\)/);
  assert.match(source, /displayTimeReached && nextImageReady/);
  assert.doesNotMatch(source, /<img key=\{heroImage\}/);
  assert.match(source, /fetchPriority="high"/);
  assert.doesNotMatch(source, /bottom-\[8\.75rem\]/);
});
