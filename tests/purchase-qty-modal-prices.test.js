import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const purchaseOrder = readFileSync(
  new URL("../src/modules/purchases/pages/PurchaseOrder.jsx", import.meta.url),
  "utf8",
);

test("multi-product purchase quantity preview includes one price set per product", () => {
  assert.match(purchaseOrder, /purchasePrice:\s*money\(/);
  assert.match(purchaseOrder, /sellingPrice:\s*money\(/);
  assert.match(purchaseOrder, /salePrice:\s*money\(/);
  assert.match(purchaseOrder, /function MultiProductPurchaseQtyModal/);
  assert.match(purchaseOrder, /updateProductPrice\(product\.key, field, event\.target\.value\)/);
  assert.match(purchaseOrder, /priceInput\(product, "purchasePrice"/);
  assert.match(purchaseOrder, /priceInput\(product, "sellingPrice"/);
  assert.match(purchaseOrder, /priceInput\(product, "salePrice"/);
});

test("purchase quantity preview reuses saved prices across every size of a product", () => {
  assert.match(purchaseOrder, /const firstUsefulPrice = \(values = \[\]\)/);
  assert.match(purchaseOrder, /const sharedPrices = \{/);
  assert.match(purchaseOrder, /\.\.\.priceSources\.flatMap\(\(\{ variant \}\) => \[variant\.cost_price, variant\.last_purchase_cost/);
  assert.match(purchaseOrder, /purchasePrice:\s*money\(sharedPrices\.purchasePrice\)/);
  assert.match(purchaseOrder, /sellingPrice:\s*money\(sharedPrices\.sellingPrice\)/);
  assert.match(purchaseOrder, /salePrice:\s*money\(sharedPrices\.salePrice\)/);
});

test("zero current prices do not hide historical purchase prices", () => {
  assert.match(purchaseOrder, /const costPrice = firstUsefulPrice\(\[/);
  assert.match(purchaseOrder, /variant\?\.last_purchase_cost/);
  assert.match(purchaseOrder, /variant\?\.last_purchase_price/);
  assert.match(purchaseOrder, /const sellingPrice = firstUsefulPrice\(\[[\s\S]*?variant\?\.purchase_selling_price/);
  assert.match(purchaseOrder, /const salePrice = firstUsefulPrice\(\[[\s\S]*?variant\?\.discount_price/);
});

test("article is visible on purchase quantity product cards and review rows", () => {
  // The card label is localized now; it used to be a bare `Article {articleCode}`.
  assert.match(purchaseOrder, /t\("purchases\.create\.articleCode", \{ code: articleCode \}\)/);
  assert.match(purchaseOrder, /\{labels\.article \|\| "Article"\}/);
  assert.match(purchaseOrder, /firstText\(product\.group\?\.article_code, firstVariant\.article_code\)/);
});

test("both halves of every purchase-quantity label table define article", () => {
  /*
   * `labels.article` existed only in the English halves, so Arabic fell through
   * to the `|| "Article"` fallback and leaked English into an Arabic screen.
   * The per-hit bilingual detector cannot see this: it treats an `isArabic ? {}
   * : {}` pair as working bilingual without checking that the two halves carry
   * the SAME keys. Both label tables in this file are asserted symmetric.
   */
  const labels = purchaseOrder.match(/article: "[^"]+"/g) || [];
  const arabic = labels.filter((label) => /[؀-ۿ]/.test(label));
  assert.equal(labels.length, 4, `expected 4 article labels (2 tables x 2 halves), found ${labels.length}`);
  assert.equal(arabic.length, 2, `expected 2 Arabic article labels, found ${arabic.length}`);
});

test("applying selected products copies each product price set into all of its invoice lines", () => {
  assert.match(purchaseOrder, /applyProductPurchaseQty = \(editedProducts = \[\]\)/);
  assert.match(purchaseOrder, /toArray\(editedProducts\)\.flatMap/);
  assert.match(purchaseOrder, /toArray\(product\.rows\)\.map/);
  assert.match(purchaseOrder, /unit_cost:\s*money\(row\.purchasePrice\)/);
  assert.match(purchaseOrder, /selling_price:\s*money\(row\.sellingPrice\)/);
  assert.match(purchaseOrder, /sale_price:\s*money\(row\.salePrice\)/);
  assert.match(purchaseOrder, /onApply=\{applyProductPurchaseQty\}/);
});

test("product cards support multi-select and a single review action", () => {
  assert.match(purchaseOrder, /const \[purchaseQtySelection, setPurchaseQtySelection\] = useState\(\[\]\)/);
  assert.match(purchaseOrder, /togglePurchaseQtySelection/);
  assert.match(purchaseOrder, /purchaseQtySelection\.length/);
  assert.match(purchaseOrder, /onClick=\{openPurchaseQtyPreview\}/);
  assert.match(purchaseOrder, /purchaseQtySelected=\{purchaseQtySelected\}/);
  assert.match(purchaseOrder, /aria-pressed=\{purchaseQtySelected\}/);
});
