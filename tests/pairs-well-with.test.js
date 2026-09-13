import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const storefront = read("../src/storefront/Storefront.jsx");
const detailPage = read("../src/storefront/pages/StorefrontProductDetailPage.jsx");
const checkoutController = read("../server/controllers/storefrontController.js");
const registry = read("../shared/settingsRegistry.js");
const server = read("../server/server.js");
const gitignore = read("../.gitignore");

test("the discount is charged from settings and catalogue prices, never from the request", () => {
  assert.match(checkoutController, /const bundleSettings = await loadBundleSettings\(\);/);
  assert.match(checkoutController, /bundleResult = computeBundleDiscount\(normalizedItems, bundleSettings\.percent, isEligiblePair\);/);
  // normalizedItems carry the price resolved from the catalogue, not the client's.
  assert.match(checkoutController, /const price = shelfPriceByVariantId\.get\(String\(variant\.id\)\) \|\| resolvedPrice\.activePrice;/);
  assert.match(checkoutController, /const discount = Math\.max\(0, manualDiscount \+ couponDiscountAmount \+ bundleDiscountAmount\);/);
  // Coupons see it as an applied discount, on the checkout AND the redemption.
  assert.equal((checkoutController.match(/appliedDiscounts: \{ invoice: manualDiscount \+ bundleDiscountAmount \}/g) || []).length, 2);
  assert.match(checkoutController, /const couponBaseTotal = Math\.max\(0, subtotal - manualDiscount - bundleDiscountAmount\);/);
  // The breakdown row cannot abort a customer's order.
  assert.match(checkoutController, /SAVEPOINT bundle_discount_record/);
});

test("the cart summary runs the same calculation, gated on the published settings", () => {
  assert.match(storefront, /import \{ buildBundleId, computeBundleDiscount, normalizeBundleDiscountPercent \} from "\.\.\/\.\.\/shared\/bundleDiscount\.js";/);
  assert.match(storefront, /computeBundleDiscount\(pricedCart, storefrontBundleConfig\(publicStoreSettings\)\.percent\)\.amount/);
  assert.match(storefront, /const discount = couponDiscount \+ bundleDiscount;/);
  // Coupon preview and the checkout agree on the base.
  assert.match(storefront, /orderTotal: Math\.max\(0, subtotal - bundleDiscount\),/);
  // An older backend publishes no bundle key: that must read as off.
  assert.match(storefront, /const enabled = rawEnabled === true \|\| rawEnabled === "true" \|\| rawEnabled === 1 \|\| rawEnabled === "1";/);
});

test("a bundle line never merges into a plain line of the same size", () => {
  assert.match(storefront, /\.\.\.\(safeBundleId \? \[safeBundleId\] : \[\]\),/);
  assert.match(storefront, /String\(item\.bundle_id \|\| ""\) === String\(nextLine\.bundle_id \|\| ""\)/);
});

test("the product page renders the section, off by default in settings", () => {
  assert.match(detailPage, /<PairsWellWith key=\{product\.id\} product=\{product\} currentVariant=\{safeActiveVariant\}/);
  assert.match(registry, /\["storefront\.bundle\.enabled", "storefront", "boolean", false,/);
  assert.match(registry, /\["storefront\.bundle\.discount_percent", "storefront", "number", 5,[\s\S]{0,400}validation: \{ min: 0, max: 50 \}/);
});

test("the tables are created at boot, non-fatally, and the service ships", () => {
  assert.match(server, /await ensureProductBundleSchema\(db\)\s*\.then\(/);
  assert.match(gitignore, /!server\/services\/productBundleService\.js/);
});
