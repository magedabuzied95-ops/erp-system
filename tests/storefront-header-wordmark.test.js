import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const storefrontSource = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const settingsRegistrySource = readFileSync(new URL("../shared/settingsRegistry.js", import.meta.url), "utf8");

test("storefront header supports a dedicated transparent wordmark", () => {
  assert.match(storefrontSource, /storefront\.header_logo_url/);
  assert.match(settingsRegistrySource, /"storefront\.header_logo_url"[\s\S]*?isPublic: true/);
  assert.match(storefrontSource, /headerLogoUrl=\{storefrontBrandSettings\.headerLogoUrl\}/);
  assert.match(storefrontSource, /h-\[72px\] w-\[82px\][\s\S]*?object-contain/);
  assert.match(storefrontSource, /const mOneHeaderLogoVariant = "white"/);
  assert.match(storefrontSource, /sf-header-logo-moving-m/);
  assert.doesNotMatch(storefrontSource, /headerLogoUrl \|\| brandLogoUrl[\s\S]{0,500}clipPath: "circle/);
});

test("M One wordmark variants are bundled with the storefront", () => {
  for (const variant of ["orange", "white", "dark"]) {
    assert.equal(existsSync(new URL(`../public/branding/m-one-wordmark-${variant}.png`, import.meta.url)), true);
  }
  for (const variant of ["white", "dark"]) {
    for (const layer of ["fixed", "m"]) {
      assert.equal(existsSync(new URL(`../public/branding/m-one-logo-${variant}-${layer}.png`, import.meta.url)), true);
    }
  }
});
