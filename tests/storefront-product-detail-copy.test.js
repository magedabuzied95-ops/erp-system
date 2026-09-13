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

test("the buy bar is quantity + outlined add to cart, then a filled buy it now", () => {
  // Quantity and add to cart share a row; buy it now is its own full-width row.
  assert.match(productDetailSource, /<div className="flex items-stretch gap-2">\s*<div className="sf-buy-qty /);
  assert.match(productDetailSource, /className="sf-buy-atc h-14 min-w-0 flex-1"/);
  assert.match(productDetailSource, /onClick=\{buyNow\}[\s\S]{0,160}className="sf-buy-now h-14 w-full"/);
  assert.doesNotMatch(productDetailSource, /\{false && <button\s+type="button"\s+onClick=\{buyNow\}/);
  // Add to cart: fill sweeps up on hover, a shake once per 6s cycle, both off
  // under reduced motion and the shake off while hovered, focused or disabled.
  assert.match(stylesheetSource, /\.sf-buy-atc::before \{[\s\S]{0,260}transform: scaleY\(0\);\s*transform-origin: 50% 100%;/);
  assert.match(stylesheetSource, /\.sf-buy-atc:not\(:disabled\):hover::before \{\s*transform: scaleY\(1\);/);
  assert.match(stylesheetSource, /animation: sf-buy-atc-shake 6s ease-in-out 2s infinite;/);
  assert.match(stylesheetSource, /\.sf-buy-atc:hover,\s*\.storefront-shell \.sf-buy-atc:focus-visible,\s*\.storefront-shell \.sf-buy-atc:disabled \{\s*animation: none;/);
  assert.match(stylesheetSource, /@media \(prefers-reduced-motion: reduce\) \{\s*\.storefront-shell \.sf-buy-atc \{\s*animation: none;/);
});
