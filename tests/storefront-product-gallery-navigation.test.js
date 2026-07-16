import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storefrontSource = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const productDetailSource = readFileSync(new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url), "utf8");

test("switching product gallery images does not remount or scroll-reset the product page", () => {
  assert.match(storefrontSource, /const storefrontRouteKey = location\.pathname;/);
  assert.doesNotMatch(storefrontSource, /const storefrontRouteKey = `\$\{location\.pathname\}\$\{location\.search\}`;/);

  const productScrollEffect = storefrontSource.slice(
    storefrontSource.indexOf("useLayoutEffect(() =>", storefrontSource.indexOf("function Storefront()")),
    storefrontSource.indexOf("const clearCart", storefrontSource.indexOf("function Storefront()")),
  );
  assert.match(productScrollEffect, /\}, \[location\.pathname\]\);/);
  assert.doesNotMatch(productScrollEffect, /\[location\.pathname, location\.search\]/);
});

test("product gallery preloads responsive hero images without reloading on query-only changes", () => {
  assert.match(productDetailSource, /getStorefrontResponsiveImageProps\(resolvedSrc, "hero"\)/);
  assert.match(productDetailSource, /image\.fetchPriority = index === 0 \? "high" : "low";/);
  assert.doesNotMatch(
    productDetailSource,
    /\}, \[identifier, location\.pathname, location\.search, profilePhone, rememberProduct, reloadToken\]\);/,
  );
});

test("product cards and product details use the same POS sale-mode pricing switch", () => {
  assert.match(
    productDetailSource,
    /const selectedPrice = getDisplayPricing\(product, saleModeEnabled, safeActiveVariant\);/,
  );
  assert.match(productDetailSource, /const selectedSellingPrice = selectedPrice\.price/);
  assert.match(productDetailSource, /const selectedComparePrice = selectedPrice\.comparePrice/);
  assert.doesNotMatch(productDetailSource, /selectedPrice\.activePrice/);
});
