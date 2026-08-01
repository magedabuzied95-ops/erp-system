import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("../server/services/inventoryCountService.js", import.meta.url), "utf8");
const portalSource = readFileSync(new URL("../src/modules/employees/pages/EmployeePortalInventory.jsx", import.meta.url), "utf8");

test("employee inventory lookup searches variant and color-level article codes", () => {
  assert.match(serviceSource, /buildExactMatchParts\("v", variantColumns, \["barcode", "sku", "article_code"/);
  assert.match(serviceSource, /FROM product_color_groups pcg/);
  assert.match(serviceSource, /unnest\(COALESCE\(pcg\.article_codes, '\{\}'::text\[\]\)\)/);
  assert.match(serviceSource, /exactColorArticleSql/);
  assert.match(serviceSource, /likeColorArticleSql/);
});

test("employee inventory search communicates article support", () => {
  assert.match(portalSource, /placeholder="ابحث بالاسم أو الباركود أو الأرتكل"/);
});
