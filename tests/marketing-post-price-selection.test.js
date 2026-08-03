import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server/controllers/marketingController.js", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../src/modules/marketing/components/PostEditorModal.jsx", import.meta.url), "utf8");
const socialCopySource = await readFile(new URL("../src/modules/marketing/components/socialAiCopy.js", import.meta.url), "utf8");

test("marketing posts prefer the ordinary selling price over the sale price", () => {
  assert.match(serverSource, /resolveCurrentSellingPrice/);
  assert.match(serverSource, /row\.purchase_selling_price/);
  assert.doesNotMatch(serverSource, /customOriginalPrice/);
  assert.doesNotMatch(serverSource, /if \(marketingSaleIsActive\(row, now\)\) return salePrice/);
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

test("bag posts receive bag hashtags instead of shoe hashtags", () => {
  assert.match(serverSource, /#bags #backpack #شنط #شنط_ظهر #new_arrival/);
  assert.doesNotMatch(serverSource, /hashtags: "#fashion #shoes #new_arrival #shopping"/);
  assert.match(editorSource, /productHashtagCategory/);
});

test("social previews use the current tenant name instead of a fixed ERP Store label", () => {
  assert.match(editorSource, /getCurrentTenant/);
  assert.match(editorSource, /currentTenant\.companyName/);
  assert.doesNotMatch(editorSource, />ERP Store</);
  assert.doesNotMatch(editorSource, />erp\.store</);
});

test("bag captions open with a back-to-school seasonal campaign", () => {
  assert.match(serverSource, /موسم العودة إلى المدارس بدأ/);
  assert.match(serverSource, /جهّز أولادك للمدرسة بشنطة عملية ومريحة/);
});

test("generated captions use a full storefront link without duplicating hashtags", () => {
  assert.match(socialCopySource, /publicStorefrontUrl\(rawLink\)/);
  assert.match(socialCopySource, /شنطة عملية ومريحة لكل يوم مدرسي/);
  assert.doesNotMatch(socialCopySource, /hashtags\.length \? hashtags\.join\(" "\)/);
  assert.match(editorSource, /product_url: productUrl/);
});
