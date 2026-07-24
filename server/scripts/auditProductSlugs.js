import db, { withReadOnlyDbSession } from "../database/db.js";
import { buildProductBaseSlug, productSlugWithId } from "../utils/productSlug.js";

const targetIds = [113, 115, 128, 130, 137];

const rows = await withReadOnlyDbSession(async (client) => {
  const duplicates = await client.query(`
    WITH active_variants AS (
      SELECT product_id, COUNT(*)::int AS variant_count, ARRAY_AGG(sku ORDER BY id) FILTER (WHERE COALESCE(TRIM(sku), '') <> '') AS sample_skus
      FROM product_variants
      WHERE is_active IS DISTINCT FROM FALSE AND deleted_at IS NULL
      GROUP BY product_id
    ),
    duplicate_slugs AS (
      SELECT LOWER(TRIM(slug)) AS slug_key
      FROM products
      WHERE COALESCE(TRIM(slug), '') <> ''
      GROUP BY LOWER(TRIM(slug))
      HAVING COUNT(*) > 1
    )
    SELECT p.id, p.name, COALESCE(b.name, p.brand, '') AS brand, p.slug, p.canonical_slug,
           COALESCE(av.variant_count, 0) AS variant_count,
           COALESCE(av.sample_skus, ARRAY[]::text[]) AS sample_skus
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN active_variants av ON av.product_id = p.id
    WHERE LOWER(TRIM(p.slug)) IN (SELECT slug_key FROM duplicate_slugs)
       OR p.id = ANY($1::bigint[])
    ORDER BY LOWER(TRIM(p.slug)), p.id
  `, [targetIds]);
  return duplicates.rows || [];
}, { route: "auditProductSlugs" });

const report = rows.map((row) => {
  const base = buildProductBaseSlug({ brand: row.brand, name: row.name, fallback: row.id });
  return {
    product_id: Number(row.id),
    product_name: row.name,
    current_slug: row.slug || "",
    canonical_slug: row.canonical_slug || "",
    variant_count: Number(row.variant_count || 0),
    sample_skus: (row.sample_skus || []).slice(0, 5),
    old_link: row.slug ? `https://m1store-egy.com/product/${row.slug}` : "",
    proposed_link: `https://m1store-egy.com/product/${productSlugWithId(base, row.id)}`,
  };
});

console.log(JSON.stringify({ count: report.length, products: report }, null, 2));
await db.end?.();
