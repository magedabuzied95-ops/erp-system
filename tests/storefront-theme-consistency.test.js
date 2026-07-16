import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storefrontSource = fs.readFileSync("src/storefront/Storefront.jsx", "utf8");
const listingSource = fs.readFileSync("src/storefront/pages/StorefrontProductListingPage.jsx", "utf8");
const confirmationSource = fs.readFileSync("src/storefront/pages/OrderConfirmationActionPage.jsx", "utf8");
const styles = fs.readFileSync("src/index.css", "utf8");
const lightStyles = fs.readFileSync("src/storefront/storefront-light.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("src/main.jsx", "utf8");

test("storefront light mode is restored before the first browser paint", () => {
  assert.match(html, /isStorefrontHost[\s\S]*?"storefront\.theme"/);
  assert.match(html, /storedTheme\s*=\s*JSON\.parse\(storedTheme\)/);
  assert.match(html, /root\.dataset\.theme\s*=\s*theme/);
  assert.match(html, /root\.style\.backgroundColor\s*=\s*dark\s*\?/);
  assert.match(main, /if \(!document\.documentElement\.dataset\.theme\)/);
  assert.doesNotMatch(main, /localStorage\.getItem\("erp\.theme"\) \|\| "dark"/);
});

test("storefront owns one synchronized light-dark theme state", () => {
  assert.match(storefrontSource, /root\.classList\.toggle\("dark", dark\)/);
  assert.match(storefrontSource, /body\.classList\.toggle\("dark", dark\)/);
  assert.match(storefrontSource, /body\.classList\.toggle\("storefront-dark", dark\)/);
  assert.match(storefrontSource, /root\.setAttribute\("data-theme", themeMode\)/);
  assert.match(storefrontSource, /root\.style\.colorScheme = themeMode/);
});

test("storefront uses Cairo as its single typography family", () => {
  assert.match(styles, /--sf-font-family:\s*"Cairo",\s*"Segoe UI",\s*sans-serif/);
  assert.match(styles, /font-family:\s*var\(--sf-font-family\)/);
});

test("storefront palette overrides the shared app palette in both modes", () => {
  assert.match(styles, /\.storefront-dark\s*\{[\s\S]*?--bg:\s*#050505/);
  assert.match(styles, /\.storefront-shell:not\(\.storefront-dark\)\s*\{[\s\S]*?--bg:\s*#f3f3f1/);
  assert.match(styles, /body\.storefront-shell:not\(\.storefront-dark\)[\s\S]*?background:\s*#f3f3f1\s*!important/);
});

test("catalog heading and result count keep readable light-mode contrast", () => {
  assert.match(listingSource, /sf-catalog-title[^"]*text-stone-950/);
  assert.match(listingSource, /sf-catalog-eyebrow[^"]*text-stone-600/);
  assert.match(listingSource, /sf-catalog-count[^"]*text-stone-700/);
  assert.match(lightStyles, /\.sf-product-listing-page \.sf-catalog-title[\s\S]*?color:\s*var\(--sf-light-text\)\s*!important/);
  assert.match(lightStyles, /\.sf-catalog-count[\s\S]*?color:\s*var\(--sf-light-text-secondary\)\s*!important/);
});

test("product card red experiment stays compact and scoped to product cards", () => {
  assert.match(storefrontSource, /standard:\s*\{[\s\S]*?image:\s*"aspect-\[0\.92\/1\] p-0"/);
  assert.match(storefrontSource, /compact:\s*\{[\s\S]*?image:\s*"aspect-\[0\.96\/1\] p-0"/);
  assert.match(storefrontSource, /sf-card-primary-image[^`]*scale-\[1\.08\]/);
  assert.match(storefrontSource, /sf-product-card-price[^`]*text-\[#c1121f\]/);
  assert.match(styles, /\.storefront-shell \.sf-product-card \.sf-quick-add-button \{[\s\S]*?background:\s*linear-gradient\(135deg, #c1121f 0%, #d90429 48%, #ef233c 100%\)\s*!important/);
  assert.doesNotMatch(styles, /\.storefront-shell \.sf-quick-add-button,\s*\n\.storefront-shell \.sf-wishlist-add-button/);
});

test("mobile dark palette is scoped to dark storefronts", () => {
  const mediaStart = styles.indexOf("@media (max-width: 1023px)", styles.indexOf("@media (max-width: 1023px)") + 1);
  const blockStart = styles.indexOf(".storefront-shell.storefront-dark {", mediaStart);
  const blockEnd = styles.indexOf(".storefront-shell .sf-header-wordmark", blockStart);
  const mobileThemeBlock = styles.slice(blockStart, blockEnd);
  const scopedSelectorLines = mobileThemeBlock
    .split(/\r?\n/)
    .filter((line) => line.includes(".storefront-shell"));

  assert.ok(blockStart > mediaStart && blockEnd > blockStart, "mobile storefront theme block must exist");
  assert.ok(scopedSelectorLines.length > 0);
  assert.ok(scopedSelectorLines.every((line) => line.trimStart().startsWith(".storefront-shell.storefront-dark")));
  assert.doesNotMatch(mobileThemeBlock, /\.storefront-dark--/);
});

test("public order pages no longer force dark mode", () => {
  assert.doesNotMatch(storefrontSource, /className="storefront-dark relative/);
  assert.doesNotMatch(confirmationSource, /className="storefront-dark min-h-screen/);
});
