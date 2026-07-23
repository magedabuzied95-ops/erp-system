import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { isMirrorProduct } from "../src/shared/lib/mirrorProduct.js";

test("mirror products are recognized from the compact storefront grade field", () => {
  assert.equal(isMirrorProduct({ grade: "mirror original" }), true);
  assert.equal(isMirrorProduct({ grade: "ميرور أوريجنال" }), true);
  assert.equal(isMirrorProduct({ is_mirror: true }), true);
  assert.equal(isMirrorProduct({ grade: "egyptian" }), false);
  assert.equal(isMirrorProduct({ category_name: "Mirror Original", grade: "egyptian" }), false);
  assert.equal(isMirrorProduct({ grade: "not-mirror" }), false);
});

test("home hero requests and prioritizes Mirror Original products", async () => {
  const source = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const controller = await readFile(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  const stylesheet = await readFile(new URL("../src/index.css", import.meta.url), "utf8");

  assert.match(controller, /const mirrorProducts = products\.filter\(isHomeMirrorProduct\)\.slice\(0, 12\)/);
  assert.match(controller, /mirror_products: mirrorCards/);
  assert.match(controller, /const heroProduct = mirrorProducts\[0\] \|\| null/);
  assert.doesNotMatch(controller, /const heroProduct = sale\[0\] \|\| latest\[0\]/);
  assert.match(source, /home\.mirror_products/);
  assert.match(source, /filter\(\(product\) => product\.id && product\.name && isMirrorProduct\(product\)\)/);
  assert.match(source, /const mirrorHeroSlides = useMemo/);
  assert.match(source, /mirrorCandidates\.slice\(0, 12\)/);
  assert.match(source, /productsPath\(\{ quality: "mirror_original", sort: "newest" \}\)/);
  assert.match(source, /heroComparePrice/);
  assert.match(source, /وفر \$\{heroDiscount\}%/);
  assert.match(source, /اطلب الآن/);
  assert.match(source, /min-h-\[516px\] flex-col/);
  assert.match(source, /line-clamp-2 h-12 overflow-hidden/);
  assert.match(source, /\{activeHeroIndex \+ 1\}\/\{availableHeroSlides\.length\}/);
  assert.match(source, /data-testid="hero-slide-progress" className="[^"]*relative/);
  assert.doesNotMatch(source, /data-testid="hero-slide-progress" className="absolute/);
  assert.match(source, /preloadStorefrontImage\(nextImage, "hero"\)/);
  assert.match(source, /\.slice\(0, 6\)/);
  assert.match(source, /Promise\.race/);
  assert.match(source, /\}, 2800\)/);
  assert.match(source, /resolve\(false\), 900/);
  assert.doesNotMatch(source, /homepageProductsWithImages\[0\] \|\| homepageProductPool\[0\]/);
  assert.doesNotMatch(source, /<img key=\{heroImage\}/);
  assert.match(source, /key=\{`\$\{activeHeroIndex\}:\$\{heroImage\}`\}/);
  assert.match(source, /className="sf-hero-image-transition/);
  assert.match(stylesheet, /@keyframes sfHeroImageEnter/);
  assert.match(stylesheet, /animation: sfHeroImageEnter 620ms/);
  assert.match(stylesheet, /--sf-hero-image-scale: 1\.13/);
  assert.match(stylesheet, /transform: scale\(var\(--sf-hero-image-scale\)\)/);
  assert.match(stylesheet, /@media \(min-width: 640px\)[\s\S]*?--sf-hero-image-scale: 1/);
  assert.match(stylesheet, /prefers-reduced-motion: reduce[\s\S]*?\.sf-home-hero-v2 \.sf-hero-image-transition/);
  assert.match(source, /fetchPriority="high"/);
  assert.doesNotMatch(source, /bottom-\[8\.75rem\]/);
  assert.match(source, /data-testid="mirror-hero-copy" className="order-2 hidden[^"]*lg:flex/);
  assert.match(source, /if \(loading && !heroImage && !heroProduct\?\.id\)/);
  assert.match(source, /data-testid="mirror-hero-loading"/);
  assert.match(source, /aria-busy="true"/);
  assert.match(source, /بنجهز لك أحدث الاختيارات/);
  assert.match(stylesheet, /@keyframes sfHomeHeroLoaderRing/);
  assert.match(stylesheet, /@keyframes sfHomeHeroLoaderDot/);
});
