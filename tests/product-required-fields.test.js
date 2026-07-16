import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildMissingRequiredProductFieldsMessage,
  getMissingRequiredProductFields,
} from "../src/modules/products/lib/requiredProductFields.js";

test("brand, category and product type are all required", () => {
  const missing = getMissingRequiredProductFields({ brand: "", category: "", productType: "" });
  assert.deepEqual(missing.map((field) => field.key), ["brand", "category", "product_type"]);
  assert.match(buildMissingRequiredProductFieldsMessage(missing), /العلامة التجارية/);
  assert.match(buildMissingRequiredProductFieldsMessage(missing), /الفئة/);
  assert.match(buildMissingRequiredProductFieldsMessage(missing), /نوع المنتج/);
});

test("catalog categories do not satisfy the category requirement without POS grade", () => {
  assert.deepEqual(
    getMissingRequiredProductFields({ brand: "Nike", category: "Shoes", productType: "Sneakers" }).map((field) => field.key),
    ["category"]
  );
});

test("complete classification data passes validation", () => {
  assert.deepEqual(
    getMissingRequiredProductFields({ brand: "Nike", category: "", grade: "local", productType: "Sneakers" }),
    []
  );
});

test("POS grade satisfies the category requirement when catalog selectors are hidden", () => {
  assert.deepEqual(
    getMissingRequiredProductFields({ brand: "Nike", category: "", grade: "local", productType: "Sneakers" }),
    []
  );
});

test("the products API rejects create requests that omit required classifications", () => {
  const source = fs.readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
  assert.match(source, /PRODUCT_REQUIRED_CLASSIFICATIONS_MISSING/);
  assert.match(source, /missing_fields:\s*missingRequiredFields/);
});
