import assert from "node:assert/strict";
import test from "node:test";

import db from "../server/database/db.js";
import { loadProductsWithVariantsPayload } from "../server/controllers/productsController.js";

test("GET /api/products/with-variants annotates and narrows direct variant article matches", async (t) => {
  const candidateProductResult = await db.query(
    `
    SELECT
      p.id AS product_id
    FROM products p
    INNER JOIN product_variants pv ON pv.product_id = p.id
    WHERE pv.is_active IS DISTINCT FROM FALSE
      AND pv.deleted_at IS NULL
      AND COALESCE(NULLIF(TRIM(pv.article_code), ''), NULLIF(TRIM(pv.sku), ''), NULLIF(TRIM(pv.barcode), '')) IS NOT NULL
    GROUP BY p.id
    HAVING COUNT(*) >= 2
       AND COUNT(DISTINCT COALESCE(NULLIF(TRIM(pv.color), ''), 'default')) >= 2
    ORDER BY p.id DESC
    LIMIT 1
    `
  );

  const candidateProductId = candidateProductResult.rows?.[0]?.product_id || null;
  if (!candidateProductId) {
    t.skip("No real multi-color product with a direct variant identifier was found");
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
      AND COALESCE(NULLIF(TRIM(article_code), ''), NULLIF(TRIM(sku), ''), NULLIF(TRIM(barcode), '')) IS NOT NULL
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

  const queryValue = candidateVariant.article_code || candidateVariant.sku || candidateVariant.barcode;
  const payload = await loadProductsWithVariantsPayload({
    query: {
      search: queryValue,
    },
  });

  const product = Array.isArray(payload?.products)
    ? payload.products.find((item) => String(item.id ?? item.product_id ?? "") === String(candidateProductId))
    : null;

  assert.ok(product, "Expected the searched product to be present in the response");
  assert.equal(product.search_match_type, candidateVariant.article_code ? "variant_article" : candidateVariant.sku ? "sku" : "barcode");
  assert.equal(String(product.matched_variant_id ?? ""), String(candidateVariant.variant_id ?? ""));
  assert.equal(String(product.matched_color ?? ""), String(candidateVariant.color ?? ""));
  assert.equal(String(product.matched_article ?? ""), String(candidateVariant.article_code || ""));
  assert.equal(String(product.matched_sku ?? ""), String(candidateVariant.sku || ""));
  assert.ok(Object.prototype.hasOwnProperty.call(product, "matched_color_id"));
  assert.equal(product.matched_color_id ?? null, null);

  const productColors = new Set(
    (Array.isArray(product.variants) ? product.variants : []).map((variant) => String(variant.color || "").trim()).filter(Boolean)
  );
  assert.equal(productColors.size, 1);
  assert.equal(Array.from(productColors)[0], String(candidateVariant.color ?? ""));
});
