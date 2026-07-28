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
  assert.match(storefrontSource, /Math\.ceil\(items\.length \/ pageSize\)/);
  assert.match(storefrontSource, /items\.slice\(page \* pageSize, page \* pageSize \+ pageSize\)/);
  assert.match(storefrontSource, /window\.setInterval/);
  assert.match(storefrontSource, /\(currentPage \+ 1\) % pageCount/);
  assert.match(storefrontSource, /sf-product-recommendation-page/);
  assert.match(storefrontSource, /aria-label=\{`صفحة \$\{index \+ 1\}`\}/);
});

test("customer recent products include brand and crossed-price fields", () => {
  const controller = readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  assert.match(controller, /b\.name AS brand_name/);
  assert.match(controller, /AS compare_at_price/);
  assert.match(controller, /LEFT JOIN brands b ON b\.id = p\.brand_id/);
  assert.match(controller, /LEFT JOIN LATERAL \([\s\S]*?FROM product_variants pv/);
  assert.match(controller, /display_variant\.selling_price/);
  assert.match(controller, /display_variant\.compare_price/);
  assert.match(controller, /ORDER BY \(COALESCE\(pv\.stock, 0\) > 0\) DESC/);
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
  assert.match(storefrontSource, /sf-product-recommendation-current-price/);
  assert.match(storefrontSource, /sf-product-recommendation-compare-price/);
  assert.match(lightStyles, /not\(\.storefront-dark\) \.sf-product-recommendation-current-price/);
  assert.match(lightStyles, /not\(\.storefront-dark\) \.sf-product-recommendation-compare-price/);
});

test("recommendation copy never exposes the raw mirror grade", () => {
  assert.doesNotMatch(storefrontSource, /\[brand, category\]\.filter/);
  assert.doesNotMatch(storefrontSource, /`المزيد من فئة \$\{grade\}`/);
  assert.match(storefrontSource, /subtitle="منتجات مشابهة مختارة لك"/);
});

test("the product page reuses the exact home service strip and footer components", () => {
  assert.match(storefrontSource, /<HomeWhySection lang=\{i18n\.language \|\| "ar"\} \/>/);
  assert.match(storefrontSource, /<HomeSimpleFooter lang=\{i18n\.language \|\| "ar"\} \/>/);
  assert.equal((storefrontSource.match(/function HomeSimpleFooter/g) || []).length, 1);
  assert.equal((storefrontSource.match(/function HomeWhySection/g) || []).length, 1);
});
