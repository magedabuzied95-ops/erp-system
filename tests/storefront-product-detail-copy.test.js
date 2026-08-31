// Rescued from tests/storefront-mobile-bottom-nav.test.js, which was deleted
// along with the bottom nav it guarded. These three assertions were sitting in
// that file but have nothing to do with the nav — they cover the product detail
// page's bilingual copy and the CTA gradient — so they move here rather than
// disappear with it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stylesheetSource = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const productDetailSource = readFileSync(
  new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url),
  "utf8"
);

test("the product detail page does not fall back to Arabic for an English reader", () => {
  assert.match(productDetailSource, /isRtl \? "دليل المقاسات" : "Size guide"/);
});

test("the low-stock line is written once", () => {
  assert.equal((productDetailSource.match(/storefront\.products\.onlyLeft/g) || []).length, 1);
});

test("the product CTA keeps its gold gradient", () => {
  assert.match(stylesheetSource, /sf-product-cta[\s\S]*?linear-gradient\(135deg, #c99a19, #e5c158\)/);
});
