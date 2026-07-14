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

test("brand carousel advances exactly one logo every four seconds and loops", () => {
  assert.match(storefrontSource, /setInterval\([\s\S]*?4000\)/);
  assert.match(storefrontSource, /currentIndex < brandItems\.length \? currentIndex \+ 1/);
  assert.match(storefrontSource, /brandSlideIndex \* brandStepPx/);
  assert.match(storefrontSource, /brandSlideIndex < brandItems\.length/);
  assert.match(stylesheetSource, /sf-brand-marquee__track--stepping[\s\S]*?transition: transform 650ms/);
  assert.doesNotMatch(stylesheetSource, /@keyframes sfBrandMarqueePause/);
});

test("brand logos preserve their original aspect ratio without cropping", () => {
  assert.match(storefrontSource, /className="sf-brand-marquee__logo"/);
  assert.doesNotMatch(storefrontSource.slice(storefrontSource.indexOf("function HomeBrandStrip"), storefrontSource.indexOf("function HomeWhySection")), /className="h-full w-full object-contain/);
  assert.match(stylesheetSource, /\.sf-brand-marquee__logo[\s\S]*?width: auto;[\s\S]*?height: auto;[\s\S]*?max-width: 100%;[\s\S]*?max-height: 100%;/);
});
