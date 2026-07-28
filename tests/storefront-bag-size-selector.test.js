import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url),
  "utf8"
);

test("bag product details temporarily hide the size selector card", () => {
  assert.match(source, /const isBagProduct =/);
  assert.match(source, /const hideSizeSelector = isBagProduct\(product\)/);
  assert.match(source, /\{!hideSizeSelector \? <div className="sf-product-option-card/);
  for (const productType of ["bag", "bags", "handbag", "handbags", "شنط", "شنطة", "حقائب", "حقيبة"]) {
    assert.match(source, new RegExp(`"${productType}"`));
  }
});
