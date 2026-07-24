import db, { withReadOnlyDbSession } from "../database/db.js";
import { buildMetaCatalogFeed } from "../services/metaCatalogFeedService.js";

const result = await withReadOnlyDbSession(async (client) => {
  const duplicateSlugs = await client.query(`
    SELECT LOWER(TRIM(slug)) AS slug, COUNT(*)::int AS count
    FROM products
    WHERE COALESCE(TRIM(slug), '') <> ''
    GROUP BY LOWER(TRIM(slug))
    HAVING COUNT(*) > 1
  `);
  const emptySlugs = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM products
    WHERE COALESCE(TRIM(slug), '') = '' OR COALESCE(TRIM(canonical_slug), '') = ''
  `);
  const skuProduct = await client.query(`
    SELECT p.id, p.name, p.slug, pv.sku
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.sku = 'ADS-IMP-7-WHT-40'
    LIMIT 1
  `);
  return {
    duplicate_slug_count: duplicateSlugs.rowCount || 0,
    duplicate_slugs: duplicateSlugs.rows || [],
    empty_slug_count: Number(emptySlugs.rows[0]?.count || 0),
    target_product: skuProduct.rows[0] || null,
  };
}, { route: "verifyProductSlugsAndMetaFeed" });

const feed = await buildMetaCatalogFeed();
const targetItem = (feed.items || []).find((item) => item.id === "ADS-IMP-7-WHT-40");
const invalidLinks = (feed.items || []).filter((item) => !String(item.link || "").includes("/product/"));
const objectObjectImages = feed.xml.includes("[object Object]");

const verification = {
  ...result,
  feed_item_count: feed.items?.length || 0,
  invalid_feed_link_count: invalidLinks.length,
  object_object_image_found: objectObjectImages,
  target_feed_item: targetItem || null,
  target_matches_product_130:
    Number(result.target_product?.id || 0) === 130 &&
    Boolean(targetItem?.link?.endsWith(`/product/${result.target_product.slug}`)),
};

console.log(JSON.stringify(verification, null, 2));

if (
  verification.duplicate_slug_count ||
  verification.empty_slug_count ||
  verification.invalid_feed_link_count ||
  verification.object_object_image_found ||
  !verification.target_matches_product_130
) {
  process.exitCode = 1;
}

await db.end?.();
