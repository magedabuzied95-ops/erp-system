import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProductTypeValue } from "../server/services/productClassificationsService.js";
import { CANONICAL_PRODUCT_TYPE_OPTIONS, normalizeCanonicalProductType } from "../src/modules/products/lib/productClassifications.js";

test("product types are constrained to the five approved catalog values", () => {
  const cases = {
    croc: "crocs",
    bag: "bags",
    handbag: "bags",
    sneaker: "sneakers",
    shoes: "sneakers",
    "running shoes": "sneakers",
    slide: "slippers",
    slipper: "slippers",
    "winter collection": "winter_collection",
    product: "sneakers",
  };

  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(normalizeProductTypeValue(input, "sneakers"), expected, input);
  }
  assert.equal(normalizeProductTypeValue("unexpected-ai-value", "sneakers"), "sneakers");
  assert.equal(normalizeProductTypeValue(""), "");
  assert.deepEqual(CANONICAL_PRODUCT_TYPE_OPTIONS.map((option) => option.value), ["crocs", "bags", "sneakers", "winter_collection", "slippers"]);
  assert.equal(normalizeCanonicalProductType("footwear"), "sneakers");
  assert.equal(normalizeCanonicalProductType("Uncategorized"), "sneakers");
});
