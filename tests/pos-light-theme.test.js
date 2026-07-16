import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("POS light mode uses scoped readable catalog and checkout surfaces", () => {
  const page = read("../src/modules/pos/pages/POSPro.jsx");
  const grid = read("../src/modules/pos/components/ProductGrid.jsx");
  const cart = read("../src/modules/pos/components/CartSidebar.jsx");
  const styles = read("../src/modules/pos/pages/POSPro.m1.css");

  assert.match(page, /import "\.\/POSPro\.m1\.css"/);
  assert.match(page, /pos-pro-shell/);
  assert.match(page, /pos-catalog-panel/);
  assert.match(grid, /pos-product-card/);
  assert.match(grid, /pos-product-price-value/);
  assert.match(cart, /pos-customer-picker/);
  assert.match(cart, /pos-cart-totals/);
  assert.match(cart, /pos-payment-panel/);
  assert.match(styles, /html\[data-theme="light"\] \.pos-pro-shell \.pos-product-card/);
  assert.match(styles, /--pos-light-text: #25231f/);
});
