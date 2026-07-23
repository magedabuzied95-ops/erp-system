import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classificationGroupsToFieldOptions } from "../src/modules/products/lib/productClassifications.js";

test("bag type exposes only active options and does not seed fixed types", () => {
  const options = classificationGroupsToFieldOptions([{
    key: "bag_type",
    options: [
      { id: 1, value: "tote", label_ar: "توت", label_en: "Tote", is_active: true },
      { id: 2, value: "shoulder", label_ar: "كتف", label_en: "Shoulder", is_active: false },
    ],
  }], { bagType: "" }, { includeInactive: false, includeCurrentValue: false });
  assert.deepEqual(options.bagType.map((option) => option.value), ["tote"]);
});

test("product form shows bag type only when product type is bags", () => {
  const source = readFileSync(new URL("../src/modules/products/components/ProductForm.jsx", import.meta.url), "utf8");
  assert.match(source, /productType[\s\S]*===\s*"bags"[\s\S]*classificationOptions\.bagType/);
});

test("storefront renders active bag type classification options", () => {
  const source = readFileSync(new URL("../src/storefront/pages/StorefrontProductListingPage.jsx", import.meta.url), "utf8");
  assert.match(source, /bagTypeOptions=\{classificationOptions\.bagType\}/);
  assert.match(source, /normalizeStorefrontProductTypeValue\(selectedType\)\s*===\s*"bags"/);
  assert.match(source, /product\.bag_type/);
});

test("bag type schema seeds the requested options without overwriting later admin changes", () => {
  const source = readFileSync(new URL("../server/services/productClassificationsService.js", import.meta.url), "utf8");
  const expectedValues = [
    "handbag",
    "shoulder-bag",
    "crossbody-bag",
    "tote-bag",
    "waist-bag",
    "school-bag",
    "clutch",
    "bucket-bag",
  ];
  expectedValues.forEach((value) => assert.match(source, new RegExp(`'${value}'`)));
  assert.match(source, /ON CONFLICT \(group_id, value\) DO NOTHING/);
});
