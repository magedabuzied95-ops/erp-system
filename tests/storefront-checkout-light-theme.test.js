import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync("src/index.css", "utf8");
const lightCheckoutStart = css.indexOf(".storefront-shell:not(.storefront-dark) .sf-checkout-eyebrow");
const lightCheckoutEnd = css.indexOf(".storefront-shell:not(.storefront-dark) .sf-checkout-section h1", lightCheckoutStart);
const lightCheckoutCss = css.slice(lightCheckoutStart, lightCheckoutEnd);

test("checkout light mode uses the storefront gold accent instead of purple or blue accents", () => {
  assert.ok(lightCheckoutStart >= 0 && lightCheckoutEnd > lightCheckoutStart);
  assert.match(lightCheckoutCss, /\.sf-checkout-eyebrow[\s\S]*?color: #9a7108 !important/);
  assert.match(lightCheckoutCss, /\.sf-checkout-progress-step--active[\s\S]*?linear-gradient\(135deg, #c99a19, #e5c158\)/);
  assert.match(lightCheckoutCss, /\.sf-checkout-step-badge[\s\S]*?color: #8a6508 !important/);
  assert.doesNotMatch(lightCheckoutCss, /#7c3aed|#6d28d9|#5b21b6|rgba\(124,\s*58,\s*237/);
});

test("checkout theme overrides remain explicitly scoped away from dark mode", () => {
  const selectors = lightCheckoutCss.match(/\.storefront-shell[^{]+/g) || [];
  assert.ok(selectors.length > 0);
  selectors.forEach((selector) => {
    assert.match(selector, /\.storefront-shell:not\(\.storefront-dark\)/);
  });
});
