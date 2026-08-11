import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/modules/products/pages/ProductDetails.jsx", "utf8");

test("product details resolves product and color images through the shared backend asset resolver", () => {
  assert.match(source, /import \{ resolveProductImageUrl \} from "\.\.\/\.\.\/\.\.\/shared\/lib\/imageUrls"/);
  assert.match(source, /const resolveImageUrl = \(value\) => resolveProductImageUrl\(value\)/);
  assert.match(source, /images: normalizeVariantImages\(Array\.isArray\(source\.images\) \? source\.images : source\.color_images\)/);
});

test("nested color image records expose resolved URLs to both primary and thumbnail renders", () => {
  assert.match(source, /const normalizeVariantImages =/);
  assert.match(source, /image_url: imageUrl/);
  assert.match(source, /preview: imageUrl/);
  assert.match(source, /src=\{group\.image_url \|\| group\.images\?\.find/);
  assert.match(source, /src=\{image\.image_url \|\| image\.preview\}/);
});
