import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/storefront/Storefront.jsx", import.meta.url),
  "utf8"
);

// The product listing pages (Men / Women / Kids / Offers / Bags / Crocs / Slippers /
// Large sizes / brand / search) all render through ProductGrid -> ProductCard, so the
// image loading policy for every listing route is defined in this one place.

test("listing grid keeps only the first visible row eager", () => {
  assert.match(source, /eagerImage=\{index < columnCount\}/);
  assert.match(source, /return width >= 768 \? 4 : 2;/);
});

test("exactly one listing image is flagged as the LCP candidate", () => {
  assert.match(source, /priorityImage=\{index === 0\}/);
  // Guard against regressing into "prioritise the whole first row", which would make
  // the high-priority hint meaningless.
  assert.equal(source.match(/priorityImage=\{index === 0\}/g).length, 1);
  assert.doesNotMatch(source, /priorityImage=\{index < columnCount\}/);
});

test("primary card image carries the full loading policy", () => {
  assert.match(source, /loading=\{eagerImage \? "eager" : "lazy"\}/);
  assert.match(source, /fetchPriority=\{priorityImage \? "high" : undefined\}/);
  assert.match(source, /decoding="async"/);
});

test("card images reserve layout space to protect CLS", () => {
  const primaryImage = source.slice(source.indexOf("sf-card-primary-image") - 1200, source.indexOf("sf-card-primary-image") + 1200);
  assert.match(primaryImage, /width="360"/);
  assert.match(primaryImage, /height="432"/);
});

test("card images stay responsive through the shared storefront image helper", () => {
  assert.match(source, /\{\.\.\.responsiveImageProps\(displayImage, imagePreset\)\}/);
  assert.match(source, /const responsiveImageProps = \(value, preset = "grid"\) => getStorefrontResponsiveImageProps\(imageFor\(value\), preset\)/);
});

test("below-the-fold cards keep containment so offscreen work is skipped", () => {
  assert.match(source, /contentVisibility: "auto", containIntrinsicSize: "240px 340px"/);
  // Containment must never apply to the eager (above-the-fold) cards.
  assert.match(source, /style=\{eagerImage \? undefined : \{ contentVisibility: "auto"/);
});

test("the hover/secondary image is never eager or prioritised", () => {
  const secondaryImage = source.slice(source.indexOf("sf-card-secondary-image") - 400, source.indexOf("sf-card-secondary-image") + 900);
  assert.match(secondaryImage, /loading="lazy"/);
  assert.doesNotMatch(secondaryImage, /fetchPriority/);
});

test("priorityImage participates in the ProductCard memo comparison", () => {
  assert.match(source, /prev\.priorityImage === next\.priorityImage/);
});
