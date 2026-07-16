import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storefrontSource = fs.readFileSync("src/storefront/Storefront.jsx", "utf8");
const confirmationSource = fs.readFileSync("src/storefront/pages/OrderConfirmationActionPage.jsx", "utf8");
const styles = fs.readFileSync("src/index.css", "utf8");

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
