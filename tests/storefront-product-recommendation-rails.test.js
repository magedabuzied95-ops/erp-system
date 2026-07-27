import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storefrontSource = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url), "utf8");

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
  assert.match(storefrontSource, /scrollIntoView\(\{ behavior: "smooth"/);
  assert.match(storefrontSource, /aria-label=\{`صفحة \$\{index \+ 1\}`\}/);
});
