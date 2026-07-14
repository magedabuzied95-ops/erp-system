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

test("brand marquee moves for six seconds and pauses for four seconds", () => {
  assert.match(stylesheetSource, /@keyframes sfBrandMarqueePause/);
  assert.match(stylesheetSource, /60%\s*\{\s*transform: translate3d\(-50%, 0, 0\)/);
  assert.match(stylesheetSource, /100%\s*\{\s*transform: translate3d\(-50%, 0, 0\)/);
  assert.match(stylesheetSource, /animation: sfBrandMarqueePause 10s linear infinite/);
});
