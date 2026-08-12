import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storefrontSource = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const stylesheetSource = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

test("home brand strip renders logo-only duplicated marquee groups", () => {
  assert.match(storefrontSource, /const groups = brandItems\.length > 1 \? \[brandItems, brandItems\]/);
  assert.match(storefrontSource, /className="sf-brand-marquee__item group"/);
  assert.doesNotMatch(storefrontSource.slice(storefrontSource.indexOf("function HomeBrandStrip"), storefrontSource.indexOf("function HomeWhySection")), /Available in store|Trusted names/);
});

test("brand cards share the home surface and filter products by brand name", () => {
  assert.match(storefrontSource, /max-w-\[1400px\][\s\S]*?rounded-\[2rem\][\s\S]*?background: themeTokens\.surface/);
  assert.match(storefrontSource, /to=\{`\/products\?brand=\$\{encodeURIComponent\(brand\.name\)\}`\}/);
  assert.doesNotMatch(storefrontSource, /to=\{`\/\?brand=\$\{encodeURIComponent\(brand\.id/);
  // This assertion used to be:
  //   /\.sf-brand-marquee__item[\s\S]*?border: 1px solid[\s\S]*?background: color-mix/
  // and it was vacuous. `[\s\S]*?` is unanchored, so it matched a 141,971-char
  // span running from the marquee rule down into the ERP dashboard block, and
  // was satisfied by an unrelated `.dashboard-premium > .sticky` declaration.
  // It passed regardless of what the brand card looked like, then broke the
  // moment that dashboard rule was retired — for reasons with nothing to do
  // with the storefront.
  //
  // The brand card is logo-only (see the first test in this file): the item
  // carries no chrome of its own and the logo frame carries the surface. Pin
  // that contract locally, so this guard fails only if the storefront changes.
  const itemStart = stylesheetSource.indexOf(".sf-brand-marquee__item {");
  const marqueeItemRule = stylesheetSource.slice(itemStart, stylesheetSource.indexOf("}", itemStart));
  assert.match(marqueeItemRule, /border: 0;/);
  assert.match(marqueeItemRule, /background: transparent;/);
  assert.match(stylesheetSource, /\.sf-brand-marquee__logo-frame \{[\s\S]*?background: #fff;/);
});

test("brand carousel advances exactly one logo every four seconds and loops", () => {
  assert.match(storefrontSource, /setInterval\([\s\S]*?4000\)/);
  assert.doesNotMatch(storefrontSource, /setTimeout\(\(\) => setBrandSlideIndex/);
  assert.match(storefrontSource, /currentIndex < brandItems\.length \? currentIndex \+ 1/);
  assert.match(storefrontSource, /brandSlideIndex \* brandStepPx/);
  assert.match(storefrontSource, /brandSlideIndex < brandItems\.length/);
  assert.match(stylesheetSource, /sf-brand-marquee__track--stepping[\s\S]*?transition: transform 650ms/);
  assert.doesNotMatch(stylesheetSource, /@keyframes sfBrandMarqueePause/);
});

test("mobile brand carousel shows one enlarged brand card per step", () => {
  assert.match(stylesheetSource, /@media \(max-width: 639px\)[\s\S]*?\.sf-brand-marquee__item[\s\S]*?width: calc\(100vw - 5\.25rem\);/);
  assert.match(stylesheetSource, /@media \(max-width: 639px\)[\s\S]*?height: clamp\(10rem, 42vw, 12rem\);/);
  assert.match(stylesheetSource, /@media \(max-width: 639px\)[\s\S]*?\.sf-brand-marquee__group[\s\S]*?gap: 1rem;/);
});

test("brand logos preserve their original aspect ratio without cropping", () => {
  assert.match(storefrontSource, /className="sf-brand-marquee__logo"/);
  assert.doesNotMatch(storefrontSource.slice(storefrontSource.indexOf("function HomeBrandStrip"), storefrontSource.indexOf("function HomeWhySection")), /className="h-full w-full object-contain/);
  assert.match(stylesheetSource, /\.sf-brand-marquee__logo[\s\S]*?width: auto;[\s\S]*?height: auto;[\s\S]*?max-width: 100%;[\s\S]*?max-height: 100%;/);
});
