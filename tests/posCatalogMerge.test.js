import assert from "node:assert/strict";
import test from "node:test";

import { countUniqueVariantColors, mergeCatalogProducts } from "../src/modules/pos/lib/posCatalogMerge.js";

test("article search merge keeps full product variants and matched selection metadata", () => {
  const fullProductFromCard = {
    product_id: 10,
    variants: [
      { variant_id: 101, color: "White", size: "40" },
      { variant_id: 102, color: "Black", size: "41" },
      { variant_id: 103, color: "Gold", size: "42" },
    ],
  };
  const fullArticleSearchProduct = {
    ...fullProductFromCard,
    search_match_type: "variant_article",
    matched_variant_id: 102,
    matched_color: "Black",
  };
  const articleSearchProduct = {
    product_id: 10,
    search_match_type: "variant_article",
    matched_variant_id: 102,
    matched_color: "Black",
    variants: [{ variant_id: 102, color: "Black", size: "41", article_code: "ART-BLK-41" }],
  };

  const [modalProductFromFullResponse] = mergeCatalogProducts([], [fullArticleSearchProduct]);
  const [modalProduct] = mergeCatalogProducts([fullProductFromCard], [articleSearchProduct]);

  assert.equal(modalProductFromFullResponse.variants.length, 3);
  assert.equal(countUniqueVariantColors(modalProductFromFullResponse), 3);
  assert.equal(modalProductFromFullResponse.matched_variant_id, 102);
  assert.equal(modalProduct.variants.length, 3);
  assert.equal(countUniqueVariantColors(modalProduct), 3);
  assert.equal(modalProduct.matched_variant_id, 102);
  assert.equal(modalProduct.matched_color, "Black");
  assert.ok(modalProduct.variants.some((variant) => variant.color === "White"));
  assert.ok(modalProduct.variants.some((variant) => variant.color === "Gold"));
});
