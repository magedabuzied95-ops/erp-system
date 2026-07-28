import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storefrontSource = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url), "utf8");
const lightStyles = readFileSync(new URL("../src/storefront/storefront-light.css", import.meta.url), "utf8");

test("product details render grade, brand and recently viewed recommendation rails", () => {
  assert.match(detailSource, /<RelatedProducts currentProduct=\{product\}/);
  assert.match(detailSource, /<RecentProductsSection currentId=\{product\.id\}/);
  assert.match(storefrontSource, /title="منتجات ذات صلة"/);
  assert.match(storefrontSource, /grade: grade \|\| "__no_grade__", limit: 15/);
  assert.match(storefrontSource, /brand: brand \|\| "__no_brand__", limit: 15/);
  assert.match(storefrontSource, /title=\{brand \? `المزيد من منتجات \$\{brand\}`/);
  assert.match(storefrontSource, /slice\(0, 15\)/);
  assert.match(storefrontSource, /sfText\("storefront\.account\.recentlyViewed"\)/);
});

test("recommendation rails provide paging controls and exclude the open product", () => {
  assert.match(storefrontSource, /parentId === String\(currentId\)/);
  assert.match(storefrontSource, /Math\.ceil\(items\.length \/ 5\)/);
  assert.match(storefrontSource, /items\.slice\(page \* 5, page \* 5 \+ 5\)/);
  assert.match(storefrontSource, /aria-label=\{`صفحة \$\{index \+ 1\}`\}/);
});

test("product page prioritizes cached or direct product data and defers recommendation requests", () => {
  assert.match(detailSource, /const prefetched = storefrontApi\.peekProductDetails\(routeValue\)/);
  assert.match(detailSource, /label: "prefetched"/);
  assert.match(detailSource, /label: "direct", loader: loadDirect/);
  assert.match(storefrontSource, /function RelatedProductsContent/);
  assert.match(storefrontSource, /rootMargin: "600px 0px"/);
  assert.match(storefrontSource, /ready \? <RelatedProductsContent/);
});

test("recommendations use a compact five-column storefront strip instead of product cards", () => {
  assert.match(storefrontSource, /function RecommendationProductTile/);
  assert.match(storefrontSource, /lg:grid-cols-5/);
  assert.match(storefrontSource, /aspect-square overflow-hidden bg-white/);
  assert.doesNotMatch(storefrontSource, /<ProductCard product=\{product\} railType="similar" rank=\{index \+ 1\}/);
});

test("product recommendation strips have explicit light-mode colors", () => {
  assert.match(storefrontSource, /sf-product-recommendation-name/);
  assert.match(lightStyles, /not\(\.storefront-dark\) \.sf-product-recommendation-name/);
  assert.match(lightStyles, /not\(\.storefront-dark\) \.sf-product-recommendation-meta/);
});

test("the product page reuses the exact home service strip and footer components", () => {
  assert.match(storefrontSource, /<HomeWhySection lang=\{i18n\.language \|\| "ar"\} \/>/);
  assert.match(storefrontSource, /<HomeSimpleFooter lang=\{i18n\.language \|\| "ar"\} \/>/);
  assert.equal((storefrontSource.match(/function HomeSimpleFooter/g) || []).length, 1);
  assert.equal((storefrontSource.match(/function HomeWhySection/g) || []).length, 1);
});
