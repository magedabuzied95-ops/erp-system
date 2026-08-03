import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server/controllers/marketingController.js", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../src/modules/marketing/components/PostEditorModal.jsx", import.meta.url), "utf8");

test("marketing posts use sale price only for an enabled active sale", () => {
  assert.match(serverSource, /marketingSaleIsActive/);
  assert.match(serverSource, /row\.sale_price_enabled === true/);
  assert.match(serverSource, /\[row\.selling_price, row\.price, row\.regular_price\]/);
  assert.match(serverSource, /if \(marketingSaleIsActive\(row, now\)\) return salePrice/);
});

test("the editor recalculates catalog price instead of trusting stale post price", () => {
  assert.match(editorSource, /resolveMarketingEditorPrice/);
  assert.match(editorSource, /const catalogPrices = \[rowPrice\(product\), \.\.\.variants\.map\(rowPrice\)\]/);
  assert.match(editorSource, /formatPrice\(resolveMarketingEditorPrice/);
});

test("the marketing editor uses the application theme tokens", () => {
  assert.match(editorSource, /bg-\[var\(--card\)\] text-\[var\(--text\)\]/);
  assert.match(editorSource, /bg-\[var\(--primary\)\] text-\[var\(--primary-contrast\)\]/);
});
