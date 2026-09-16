// SellerSKU → M1 variant mapping.
// Suggestions: an exact (case-insensitive) SKU match against exactly one live variant, else an
// exact barcode match. Suggestions are never applied automatically - a person maps, or explicitly
// accepts the unambiguous exact-SKU suggestions in bulk.

import db from "../../database/db.js";
import { amazonMarketplaceId } from "./amazonConfig.js";
import { AMAZON_AUDIT_EVENTS, auditAmazon } from "./amazonAudit.js";
import { AMAZON_ERROR_CATEGORY, AmazonApiError } from "./amazonErrors.js";

export const MAPPING_STATUSES = Object.freeze(["mapped", "unmapped", "conflict", "missing_m1_sku"]);

const LIVE_VARIANT_SQL = `
  pv.deleted_at IS NULL
  AND pv.is_active IS DISTINCT FROM FALSE
  AND COALESCE(p.status, 'active') NOT IN ('archived', 'deleted')
  AND p.is_active IS DISTINCT FROM FALSE
`;

const tenantScope = (alias, param) => `(${alias}.tenant_id = ${param} OR ${alias}.tenant_id IS NULL)`;

export const listSkuMappings = async ({ tenantId, status = "", search = "", limit = 100, offset = 0, database = db }) => {
  const params = [tenantId, amazonMarketplaceId()];
  const where = ["m.tenant_id = $1", "m.marketplace_id = $2"];
  if (status && MAPPING_STATUSES.includes(status)) {
    params.push(status);
    where.push(`m.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    where.push(`(lower(m.seller_sku) LIKE $${params.length} OR lower(COALESCE(m.asin,'')) LIKE $${params.length} OR lower(COALESCE(m.amazon_title,'')) LIKE $${params.length} OR lower(COALESCE(pv.sku,'')) LIKE $${params.length} OR lower(COALESCE(p.name,'')) LIKE $${params.length})`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500), Math.max(Number(offset) || 0, 0));
  const rows = await database.query(
    `SELECT m.id, m.seller_sku, m.asin, m.amazon_title, m.status, m.match_method, m.candidate_count,
            m.suggestion_method, m.mapped_by, m.mapped_at, m.updated_at,
            m.variant_id, pv.sku AS m1_sku, pv.size, pv.color, pv.stock AS m1_stock,
            (pv.deleted_at IS NOT NULL OR pv.is_active = FALSE) AS variant_archived,
            m.product_id, p.name AS product_name,
            m.suggested_variant_id, spv.sku AS suggested_sku, spv.size AS suggested_size, spv.color AS suggested_color,
            sp.name AS suggested_product_name,
            l.listing_status, l.fulfillment_channel
     FROM amazon_sku_mappings m
     LEFT JOIN product_variants pv ON pv.id = m.variant_id
     LEFT JOIN products p ON p.id = COALESCE(m.product_id, pv.product_id)
     LEFT JOIN product_variants spv ON spv.id = m.suggested_variant_id
     LEFT JOIN products sp ON sp.id = spv.product_id
     LEFT JOIN amazon_listings l ON l.tenant_id = m.tenant_id AND l.marketplace_id = m.marketplace_id AND lower(l.seller_sku) = lower(m.seller_sku)
     WHERE ${where.join(" AND ")}
     ORDER BY CASE m.status WHEN 'conflict' THEN 0 WHEN 'missing_m1_sku' THEN 1 WHEN 'unmapped' THEN 2 ELSE 3 END, lower(m.seller_sku)
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const totals = await database.query(
    `SELECT status, COUNT(*)::int AS count FROM amazon_sku_mappings WHERE tenant_id = $1 AND marketplace_id = $2 GROUP BY status`,
    [tenantId, amazonMarketplaceId()]
  );
  return {
    rows: rows.rows,
    totals: Object.fromEntries(MAPPING_STATUSES.map((key) => [key, totals.rows.find((row) => row.status === key)?.count || 0])),
  };
};

const findCandidates = async ({ tenantId, sellerSku, database }) => {
  const bySku = await database.query(
    `SELECT pv.id, pv.product_id FROM product_variants pv JOIN products p ON p.id = pv.product_id
     WHERE ${tenantScope("pv", "$1")} AND lower(trim(pv.sku)) = lower(trim($2)) AND ${LIVE_VARIANT_SQL}
     LIMIT 5`,
    [tenantId, sellerSku]
  );
  if (bySku.rows.length) return { method: "exact_sku", rows: bySku.rows };
  const byBarcode = await database.query(
    `SELECT pv.id, pv.product_id FROM product_variants pv JOIN products p ON p.id = pv.product_id
     WHERE ${tenantScope("pv", "$1")} AND lower(trim(pv.barcode)) = lower(trim($2)) AND ${LIVE_VARIANT_SQL}
     LIMIT 5`,
    [tenantId, sellerSku]
  );
  if (byBarcode.rows.length) return { method: "exact_barcode", rows: byBarcode.rows };
  return { method: null, rows: [] };
};

// Recomputes suggestions and statuses. Never changes an existing mapping's variant.
export const refreshSkuSuggestions = async ({ tenantId, database = db }) => {
  const result = { checked: 0, suggested: 0, conflicts: 0, missing: 0 };
  const rows = await database.query(
    `SELECT m.id, m.seller_sku, m.status, m.variant_id,
            (pv.id IS NULL OR pv.deleted_at IS NOT NULL OR pv.is_active = FALSE OR NULLIF(trim(pv.sku),'') IS NULL
              OR p.is_active = FALSE OR COALESCE(p.status,'active') IN ('archived','deleted')) AS variant_unusable
     FROM amazon_sku_mappings m
     LEFT JOIN product_variants pv ON pv.id = m.variant_id
     LEFT JOIN products p ON p.id = pv.product_id
     WHERE m.tenant_id = $1 AND m.marketplace_id = $2`,
    [tenantId, amazonMarketplaceId()]
  );
  for (const row of rows.rows) {
    result.checked += 1;
    if (row.status === "mapped" || row.status === "missing_m1_sku") {
      const nextStatus = row.variant_id && !row.variant_unusable ? "mapped" : "missing_m1_sku";
      if (nextStatus !== row.status) {
        await database.query(`UPDATE amazon_sku_mappings SET status = $2, updated_at = NOW() WHERE id = $1`, [row.id, nextStatus]);
      }
      if (nextStatus === "missing_m1_sku") result.missing += 1;
      continue;
    }
    const candidates = await findCandidates({ tenantId, sellerSku: row.seller_sku, database });
    const single = candidates.rows.length === 1 ? candidates.rows[0] : null;
    const status = candidates.rows.length > 1 ? "conflict" : "unmapped";
    await database.query(
      `UPDATE amazon_sku_mappings
       SET status = $2, suggested_variant_id = $3, suggestion_method = $4, candidate_count = $5, updated_at = NOW()
       WHERE id = $1`,
      [row.id, status, single?.id || null, single ? candidates.method : candidates.rows.length > 1 ? candidates.method : null, candidates.rows.length]
    );
    if (single) result.suggested += 1;
    if (status === "conflict") result.conflicts += 1;
  }
  return result;
};

const loadMapping = async ({ tenantId, mappingId, database }) => {
  const result = await database.query(
    `SELECT * FROM amazon_sku_mappings WHERE id = $1 AND tenant_id = $2 AND marketplace_id = $3`,
    [mappingId, tenantId, amazonMarketplaceId()]
  );
  if (!result.rows[0]) throw new AmazonApiError("mapping not found", { category: AMAZON_ERROR_CATEGORY.INVALID_REQUEST, status: 404 });
  return result.rows[0];
};

const syncOrderItemMappings = async ({ tenantId, sellerSku, variantId, productId, database }) => {
  await database.query(
    `UPDATE amazon_order_items SET mapped_variant_id = $3, mapped_product_id = $4, updated_at = NOW()
     WHERE tenant_id = $1 AND lower(seller_sku) = lower($2)`,
    [tenantId, sellerSku, variantId, productId]
  );
};

export const mapSku = async ({ tenantId, mappingId, variantId, req = null, matchMethod = "manual", database = db }) => {
  const mapping = await loadMapping({ tenantId, mappingId, database });
  const variant = await database.query(
    `SELECT pv.id, pv.product_id, pv.sku FROM product_variants pv JOIN products p ON p.id = pv.product_id
     WHERE pv.id = $1 AND ${tenantScope("pv", "$2")} AND ${LIVE_VARIANT_SQL}`,
    [variantId, tenantId]
  );
  const target = variant.rows[0];
  if (!target) {
    throw new AmazonApiError("M1 variant not found or archived", { category: AMAZON_ERROR_CATEGORY.INVALID_REQUEST, status: 404 });
  }
  if (!String(target.sku || "").trim()) {
    throw new AmazonApiError("this M1 variant has no SKU", { category: AMAZON_ERROR_CATEGORY.INVALID_REQUEST, status: 422 });
  }
  const other = await database.query(
    `SELECT seller_sku FROM amazon_sku_mappings
     WHERE tenant_id = $1 AND marketplace_id = $2 AND variant_id = $3 AND status = 'mapped' AND id <> $4`,
    [tenantId, amazonMarketplaceId(), target.id, mapping.id]
  );
  if (other.rows[0]) {
    throw new AmazonApiError(`this M1 variant is already mapped to Amazon SKU ${other.rows[0].seller_sku}`, {
      category: AMAZON_ERROR_CATEGORY.INVALID_REQUEST,
      status: 409,
      code: "VARIANT_ALREADY_MAPPED",
    });
  }
  const method = matchMethod === "manual" && mapping.suggested_variant_id && Number(mapping.suggested_variant_id) === Number(target.id)
    ? `${mapping.suggestion_method || "suggested"}_confirmed`
    : matchMethod;
  await database.query(
    `UPDATE amazon_sku_mappings
     SET status = 'mapped', variant_id = $2, product_id = $3, match_method = $4,
         mapped_by = $5, mapped_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [mapping.id, target.id, target.product_id, method, req?.user?.id ?? null]
  );
  await syncOrderItemMappings({ tenantId, sellerSku: mapping.seller_sku, variantId: target.id, productId: target.product_id, database });
  await auditAmazon({
    req,
    tenantId,
    eventType: AMAZON_AUDIT_EVENTS.SKU_MAPPED,
    details: { seller_sku: mapping.seller_sku, variant_id: target.id, product_id: target.product_id, previous_variant_id: mapping.variant_id || null, match_method: method },
  });
  return { id: mapping.id, seller_sku: mapping.seller_sku, variant_id: target.id, product_id: target.product_id, match_method: method };
};

export const unmapSku = async ({ tenantId, mappingId, req = null, database = db }) => {
  const mapping = await loadMapping({ tenantId, mappingId, database });
  await database.query(
    `UPDATE amazon_sku_mappings
     SET status = 'unmapped', variant_id = NULL, product_id = NULL, match_method = NULL,
         mapped_by = $2, mapped_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [mapping.id, req?.user?.id ?? null]
  );
  await syncOrderItemMappings({ tenantId, sellerSku: mapping.seller_sku, variantId: null, productId: null, database });
  await auditAmazon({
    req,
    tenantId,
    eventType: AMAZON_AUDIT_EVENTS.SKU_UNMAPPED,
    details: { seller_sku: mapping.seller_sku, previous_variant_id: mapping.variant_id || null },
  });
  return { id: mapping.id, seller_sku: mapping.seller_sku };
};

// Only unambiguous exact-SKU suggestions (one live candidate). Barcode suggestions stay manual.
export const acceptExactSkuSuggestions = async ({ tenantId, req = null, database = db }) => {
  const candidates = await database.query(
    `SELECT id, suggested_variant_id FROM amazon_sku_mappings
     WHERE tenant_id = $1 AND marketplace_id = $2 AND status = 'unmapped'
       AND suggestion_method = 'exact_sku' AND candidate_count = 1 AND suggested_variant_id IS NOT NULL`,
    [tenantId, amazonMarketplaceId()]
  );
  const summary = { accepted: 0, skipped: 0, errors: [] };
  for (const row of candidates.rows) {
    try {
      await mapSku({ tenantId, mappingId: row.id, variantId: row.suggested_variant_id, req, matchMethod: "exact_sku_bulk", database });
      summary.accepted += 1;
    } catch (error) {
      summary.skipped += 1;
      if (summary.errors.length < 20) summary.errors.push({ mapping_id: row.id, message: error.message });
    }
  }
  return summary;
};

export const searchM1Variants = async ({ tenantId, query = "", limit = 20, database = db }) => {
  const term = String(query || "").trim().toLowerCase();
  if (term.length < 2) return [];
  const result = await database.query(
    `SELECT pv.id AS variant_id, pv.product_id, pv.sku, pv.barcode, pv.size, pv.color, pv.stock, p.name AS product_name,
            EXISTS (SELECT 1 FROM amazon_sku_mappings m WHERE m.variant_id = pv.id AND m.status = 'mapped') AS already_mapped
     FROM product_variants pv JOIN products p ON p.id = pv.product_id
     WHERE ${tenantScope("pv", "$1")} AND ${LIVE_VARIANT_SQL}
       AND (lower(pv.sku) LIKE $2 OR lower(COALESCE(pv.barcode,'')) = $3 OR lower(p.name) LIKE $2)
     ORDER BY (lower(pv.sku) = $3) DESC, p.name, pv.color, pv.size
     LIMIT $4`,
    [tenantId, `%${term}%`, term, Math.min(Math.max(Number(limit) || 20, 1), 50)]
  );
  return result.rows;
};

// M1-centric view: which live variants are linked to Amazon.
export const listM1ProductsWithAmazonStatus = async ({ tenantId, search = "", onlyLinked = false, limit = 100, offset = 0, database = db }) => {
  const params = [tenantId, amazonMarketplaceId()];
  const where = [tenantScope("pv", "$1"), LIVE_VARIANT_SQL];
  if (onlyLinked) where.push("m.id IS NOT NULL");
  if (search) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    where.push(`(lower(pv.sku) LIKE $${params.length} OR lower(p.name) LIKE $${params.length} OR lower(COALESCE(m.seller_sku,'')) LIKE $${params.length})`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500), Math.max(Number(offset) || 0, 0));
  const result = await database.query(
    `SELECT pv.id AS variant_id, pv.product_id, p.name AS product_name, pv.sku, pv.size, pv.color, pv.stock,
            m.seller_sku, m.asin, m.status AS mapping_status, l.listing_status, l.fulfillment_channel,
            l.merchant_quantity, COALESCE(l.offer_price, l.listing_price) AS amazon_price, l.last_synced_at
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     LEFT JOIN amazon_sku_mappings m ON m.variant_id = pv.id AND m.status = 'mapped' AND m.tenant_id = $1 AND m.marketplace_id = $2
     LEFT JOIN amazon_listings l ON l.tenant_id = $1 AND l.marketplace_id = $2 AND lower(l.seller_sku) = lower(m.seller_sku)
     WHERE ${where.join(" AND ")}
     ORDER BY (m.id IS NULL), p.name, pv.color, pv.size
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows;
};
