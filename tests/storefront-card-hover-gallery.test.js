import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/storefront/Storefront.jsx", import.meta.url),
  "utf8"
);

test("product cards hydrate full gallery details on hover", () => {
  assert.match(source, /const \[hoverProductDetails, setHoverProductDetails\] = useState\(null\)/);
  assert.match(source, /prefetchStorefrontProductDetails\(productIdentifier\)\.then/);
  assert.match(source, /setHoverProductDetails\(detailProduct\)/);
  assert.match(source, /setHoverProductDetails\(null\)/);
  assert.match(source, /productCardSecondaryImageFor\(hoverProductDetails \|\| \{\}/);
});

test("the second card image fades in and receives the same hover zoom", () => {
  assert.match(source, /sf-card-secondary-image[\s\S]{0,500}group-hover\/card-image:scale-\[1\.18\]/);
  assert.match(source, /sf-card-secondary-image[\s\S]{0,600}group-hover\/card-image:opacity-100/);
  assert.match(source, /sf-card-primary-image[\s\S]{0,700}group-hover\/card-image:opacity-0/);
});

test("hover never falls back to a different color image", () => {
  assert.match(source, /const hasColorScope = Boolean\(activeColorGroup \|\| variantColorName\(variant \|\| \{\}\) !== "Default"\)/);
  assert.match(source, /hasColorScope\s*\? colorScopedCandidates\s*:\s*\[\.\.\.colorScopedCandidates, cardImages\[1\], cardImages\[0\]\]/);
  assert.match(source, /getActiveColorGroup\(hoverProductDetails, variantColorKey\(hoverDetailVariant \|\| \{\}\) \|\| selectedColorKey\)/);
});

test("hover collects images from every size variant of the same color", () => {
  assert.match(source, /const productCardColorScopedImages =/);
  assert.match(source, /const sameColorVariants = Array\.isArray\(activeColorGroup\?\.variants\)/);
  assert.match(source, /const sameColorVariantImages = sameColorVariants\.flatMap/);
  assert.match(source, /\.\.\.sameColorVariantImages/);
  assert.match(source, /colorVariant\?\.additional_images/);
  assert.match(source, /const variantImagesList = productCardColorScopedImages\(activeColorGroup, variant\)/);
});
