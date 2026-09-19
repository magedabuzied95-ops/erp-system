import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("../server/services/inventoryCountService.js", import.meta.url), "utf8");
const portalSource = readFileSync(new URL("../src/modules/employees/pages/EmployeePortalInventory.jsx", import.meta.url), "utf8");
const portalRouteSource = readFileSync(new URL("../server/routes/employeePortal.js", import.meta.url), "utf8");
// The search box is its own component now (it owns its text, so typing does not
// re-render the count sheet); the placeholder promise lives there.
const searchSource = readFileSync(new URL("../src/modules/employees/components/CountProductSearch.jsx", import.meta.url), "utf8");

test("employee inventory lookup searches variant and color-level article codes", () => {
  assert.match(serviceSource, /buildExactMatchParts\("v", variantColumns, \["barcode", "sku", "article_code"/);
  assert.match(serviceSource, /FROM product_color_groups pcg/);
  assert.match(serviceSource, /unnest\(COALESCE\(pcg\.article_codes, '\{\}'::text\[\]\)\)/);
  assert.match(serviceSource, /exactColorArticleSql/);
  assert.match(serviceSource, /likeColorArticleSql/);
});

test("employee inventory search communicates article support", () => {
  // The placeholder is localized now, so the promise lives in the dictionaries.
  assert.match(searchSource, /placeholder=\{tt\("employeePortal\.stockCount\.searchItems"\)\}/);
  // The phone's snapshot must resolve the colour-level code too, or a code that
  // works online finds nothing on a weak line.
  assert.match(serviceSource, /const articleCodeExpr = hasColorGroups/);
  const ar = JSON.parse(readFileSync(new URL("../src/locales/ar/employeePortal.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en/employeePortal.json", import.meta.url), "utf8"));
  assert.match(ar.stockCount.searchItems, /الأرتكل/);
  assert.match(en.stockCount.searchItems, /article/i);
});

test("a search result shows the colour's own picture, never the product cover for every colour", () => {
  // The snapshot used to take its picture from an expression whose FIRST COALESCE
  // argument was the literal '' (the color_image_url column does not exist on
  // production). '' is not NULL, so every colour came back with no picture and the
  // phone fell back to the cover: three colours of one article, one identical shoe.
  assert.doesNotMatch(
    serviceSource,
    /\["color_image_url"\],\s*"''"\s*\)/,
    "a missing colour-image column must fall back to NULL so COALESCE keeps looking"
  );
  // The colour's picture comes from the gallery (primary first), then the row itself.
  assert.match(serviceSource, /pvi_by_color AS \(/);
  assert.match(serviceSource, /\$\{colorPictureExpr\} AS image_url_raw/);
  assert.doesNotMatch(serviceSource, /\$\{imageSelects\.colorImageExpr\} AS image_url_raw/);
});

test("adding a color reloads and counts every registered size including zero stock", () => {
  assert.match(portalSource, /const exactLookupValue = clean\(/);
  assert.match(portalSource, /lookupEmployeePortalInventoryVariants\(token, session\.id/);
  // Every size of the resolved colour is added, whatever the loop looks like:
  // the colour is re-resolved by code and the WHOLE run is what gets added.
  assert.match(portalSource, /of completeGroup\.variants|completeGroup\.variants\.map/);
  assert.doesNotMatch(portalSource, /completeGroup\.variants\.filter/);
  assert.match(portalRouteSource, /loadEmployeePortalInventoryColorGroup[\s\S]*?AND v\.is_active IS DISTINCT FROM FALSE[\s\S]*?AND v\.deleted_at IS NULL/);
  assert.doesNotMatch(portalRouteSource, /loadEmployeePortalInventoryColorGroup[\s\S]*?COALESCE\(v\.stock, 0\) > 0/);
});
