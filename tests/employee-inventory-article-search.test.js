import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("../server/services/inventoryCountService.js", import.meta.url), "utf8");
const portalSource = readFileSync(new URL("../src/modules/employees/pages/EmployeePortalInventory.jsx", import.meta.url), "utf8");
const portalRouteSource = readFileSync(new URL("../server/routes/employeePortal.js", import.meta.url), "utf8");

test("employee inventory lookup searches variant and color-level article codes", () => {
  assert.match(serviceSource, /buildExactMatchParts\("v", variantColumns, \["barcode", "sku", "article_code"/);
  assert.match(serviceSource, /FROM product_color_groups pcg/);
  assert.match(serviceSource, /unnest\(COALESCE\(pcg\.article_codes, '\{\}'::text\[\]\)\)/);
  assert.match(serviceSource, /exactColorArticleSql/);
  assert.match(serviceSource, /likeColorArticleSql/);
});

test("employee inventory search communicates article support", () => {
  // The placeholder is localized now, so the promise lives in the dictionaries.
  assert.match(portalSource, /placeholder=\{tt\("employeePortal\.stockCount\.searchItems"\)\}/);
  const ar = JSON.parse(readFileSync(new URL("../src/locales/ar/employeePortal.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en/employeePortal.json", import.meta.url), "utf8"));
  assert.match(ar.stockCount.searchItems, /الأرتكل/);
  assert.match(en.stockCount.searchItems, /article/i);
});

test("adding a color reloads and counts every registered size including zero stock", () => {
  assert.match(portalSource, /const exactLookupValue = clean\(/);
  assert.match(portalSource, /lookupEmployeePortalInventoryVariants\(token, session\.id/);
  assert.match(portalSource, /completeGroup\.variants\.map/);
  assert.match(portalRouteSource, /loadEmployeePortalInventoryColorGroup[\s\S]*?AND v\.is_active IS DISTINCT FROM FALSE[\s\S]*?AND v\.deleted_at IS NULL/);
  assert.doesNotMatch(portalRouteSource, /loadEmployeePortalInventoryColorGroup[\s\S]*?COALESCE\(v\.stock, 0\) > 0/);
});
