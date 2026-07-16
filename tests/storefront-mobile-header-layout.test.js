import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storefrontSource = fs.readFileSync("src/storefront/Storefront.jsx", "utf8");

test("mobile storefront header balances cart and menu around a centered logo", () => {
  const mobileHeaderStart = storefrontSource.indexOf('<div className="sf-mobile-header-shell md:hidden"');
  const desktopHeaderStart = storefrontSource.indexOf('<div className="sf-utility-row', mobileHeaderStart);
  const mobileHeader = storefrontSource.slice(mobileHeaderStart, desktopHeaderStart);

  assert.ok(mobileHeaderStart >= 0 && desktopHeaderStart > mobileHeaderStart);
  assert.match(mobileHeader, /grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(mobileHeader, /sf-header-logo mx-auto/);
  assert.match(mobileHeader, /<ShoppingCart/);
  assert.doesNotMatch(mobileHeader, /<Search/);
});
