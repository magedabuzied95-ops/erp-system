import assert from "node:assert/strict";
import test from "node:test";

import db from "../server/database/db.js";
import { attachVariantSearchMetadata, loadProductsWithVariantsPayload } from "../server/controllers/productsController.js";

test("article search metadata keeps all product colors and selects matched variant", () => {
  const fullProduct = {
    id: 101,
    product_id: 101,
    variants: [
      { variant_id: 1, color: "White", size: "40", article_code: "ART-WHT-40" },
      { variant_id: 2, color: "Black", size: "41", article_code: "ART-BLK-41" },
      { variant_id: 3, color: "Gold", size: "42", article_code: "ART-GLD-42" },
    ],
  };

  const productFromCard = attachVariantSearchMetadata(fullProduct, "");
  const productFromArticleSearch = attachVariantSearchMetadata(fullProduct, "ART-BLK-41");
  const cardColors = new Set(productFromCard.variants.map((variant) => variant.color));
  const searchColors = new Set(productFromArticleSearch.variants.map((variant) => variant.color));

  assert.equal(cardColors.size, 3);
  assert.equal(searchColors.size, 3);
  assert.deepEqual([...searchColors].sort(), [...cardColors].sort());
  assert.equal(productFromArticleSearch.variants.length, fullProduct.variants.length);
  assert.notEqual(searchColors.size, 1);
  assert.equal(productFromArticleSearch.search_match_type, "variant_article");
  assert.equal(productFromArticleSearch.matched_variant_id, 2);
  assert.equal(productFromArticleSearch.matched_color, "Black");
});

test("GET /api/products/with-variants annotates article matches without narrowing product colors", async (t) => {
  const candidateProductResult = await db.query(
    `
    SELECT
      p.id AS product_id,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(pv.color), ''), 'default'))::int AS color_count
    FROM products p
    INNER JOIN product_variants pv ON pv.product_id = p.id
    WHERE pv.is_active IS DISTINCT FROM FALSE
      AND pv.deleted_at IS NULL
      AND NULLIF(TRIM(pv.article_code), '') IS NOT NULL
    GROUP BY p.id
    HAVING COUNT(DISTINCT COALESCE(NULLIF(TRIM(pv.color), ''), 'default')) >= 3
    ORDER BY p.id DESC
    LIMIT 1
    `
  );

  const candidateProductId = candidateProductResult.rows?.[0]?.product_id || null;
  const expectedColorCount = Number(candidateProductResult.rows?.[0]?.color_count || 0);
  if (!candidateProductId) {
    t.skip("No real product with at least 3 article-searchable colors was found");
    return;
  }

  const candidateVariantResult = await db.query(
    `
    SELECT
      id AS variant_id,
      product_id,
      color,
      article_code,
      sku,
      barcode
    FROM product_variants
    WHERE product_id = $1
      AND is_active IS DISTINCT FROM FALSE
      AND deleted_at IS NULL
      AND NULLIF(TRIM(article_code), '') IS NOT NULL
    ORDER BY id ASC
    LIMIT 1
    `,
    [candidateProductId]
  );

  const candidateVariant = candidateVariantResult.rows?.[0] || null;
  if (!candidateVariant) {
    t.skip("The selected product did not have a searchable variant row");
    return;
  }

  const queryValue = candidateVariant.article_code;
  const payload = await loadProductsWithVariantsPayload({
    query: {
      search: queryValue,
    },
  });

  const product = Array.isArray(payload?.products)
    ? payload.products.find((item) => String(item.id ?? item.product_id ?? "") === String(candidateProductId))
    : null;

  assert.ok(product, "Expected the searched product to be present in the response");
  assert.equal(product.search_match_type, "variant_article");
  assert.equal(String(product.matched_variant_id ?? ""), String(candidateVariant.variant_id ?? ""));
  assert.equal(String(product.matched_color ?? ""), String(candidateVariant.color ?? ""));
  assert.equal(String(product.matched_article ?? ""), String(candidateVariant.article_code || ""));
  assert.equal(String(product.matched_sku ?? ""), String(candidateVariant.sku || ""));
  assert.ok(Object.prototype.hasOwnProperty.call(product, "matched_color_id"));
  assert.equal(product.matched_color_id ?? null, null);

  const productColors = new Set(
    (Array.isArray(product.variants) ? product.variants : []).map((variant) => String(variant.color || "").trim()).filter(Boolean)
  );
  assert.equal(productColors.size, expectedColorCount);
  assert.notEqual(productColors.size, 1);
  assert.ok(productColors.size >= 3);
  assert.ok(productColors.has(String(candidateVariant.color ?? "").trim()));
});
