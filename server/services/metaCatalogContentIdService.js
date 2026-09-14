import db from "../database/db.js";
import { onCacheInvalidatePattern } from "./cacheService.js";
import { metaCatalogItemId } from "../../shared/metaPurchaseEvent.js";

/*
  The Meta catalogue feed publishes a size under its SKU only while no other published size
  carries the same SKU; a duplicated SKU goes out as product-variant. The pixel and the server
  Purchase event only ever saw the SKU, so every view, add-to-cart and purchase of those sizes
  named an id the catalogue does not have.

  The shop cannot know which SKUs are duplicated from one product row, so the set of duplicated
  SKU keys is read here -- with the feed's own count, so the two cannot drift -- and each size in
  the storefront payloads carries `meta_content_id`, the exact id the feed publishes it under.
  metaCatalogContentId prefers that id; without it (a cold set, an old saved cart) the events
  fall back to the SKU as before.
*/

// A SKU is only "taken twice" when two PUBLISHED rows carry it: archived colours, deleted sizes
// and hidden products do not count. The feed's variant_sku_counts CTE is this query.
export const META_PUBLISHED_SKU_COUNTS_SQL = `
      SELECT LOWER(TRIM(v.sku)) AS sku_key, COUNT(*) AS sku_count
      FROM product_variants v
      JOIN products vp ON vp.id = v.product_id
      WHERE COALESCE(TRIM(v.sku), '') <> ''
        AND vp.is_active IS DISTINCT FROM FALSE
        AND COALESCE(NULLIF(LOWER(TRIM(vp.status)), ''), 'active') = 'active'
        AND vp.is_storefront_visible IS DISTINCT FROM FALSE
        AND v.is_active IS DISTINCT FROM FALSE
        AND COALESCE(v.is_storefront_visible, TRUE) = TRUE
        AND v.deleted_at IS NULL
      GROUP BY LOWER(TRIM(v.sku))`;

const DUPLICATE_SKU_KEYS_SQL = `SELECT sku_key FROM (${META_PUBLISHED_SKU_COUNTS_SQL}) counts WHERE sku_count > 1`;

// Same freshness as the Meta feed's own cache; a catalogue change retires it sooner, but not
// within a minute of the last read (every till sale invalidates the storefront).
export const META_CONTENT_ID_TTL_MS = 15 * 60 * 1000;
export const META_CONTENT_ID_MIN_RELOAD_MS = 60 * 1000;

export const skuKey = (sku = "") => String(sku ?? "").trim().toLowerCase();

let snapshot = null;
let inflight = null;

export const resetMetaContentIdSnapshot = (next = null) => {
  snapshot = next;
  inflight = null;
};

export const metaContentIdSnapshotIsFresh = (current, now = Date.now()) => {
  if (!current) return false;
  const age = now - Number(current.loadedAt || 0);
  if (age < META_CONTENT_ID_MIN_RELOAD_MS) return true;
  return !current.stale && age < META_CONTENT_ID_TTL_MS;
};

onCacheInvalidatePattern((pattern) => {
  if (snapshot && (pattern === "*" || pattern.startsWith("storefront"))) snapshot.stale = true;
});

// Never throws: a failed read keeps the last set (or none), and the events use the SKU.
export const ensureMetaDuplicateSkuKeys = async ({ query = (sql) => db.query(sql), now = Date.now } = {}) => {
  if (metaContentIdSnapshotIsFresh(snapshot, now())) return snapshot.keys;
  if (!inflight) {
    inflight = Promise.resolve()
      .then(() => query(DUPLICATE_SKU_KEYS_SQL))
      .then((result) => {
        snapshot = { keys: new Set((result?.rows || []).map((row) => skuKey(row.sku_key)).filter(Boolean)), loadedAt: now() };
        return snapshot.keys;
      })
      .catch((error) => {
        console.warn("[meta-content-id] duplicate SKU read failed; events keep the SKU", error?.message || error);
        // Retried after the minimum reload gap, not on every listing request.
        snapshot = { keys: snapshot?.keys || null, loadedAt: now(), stale: true };
        return snapshot.keys;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
};

// "" while the set has never loaded: the caller then leaves the field out.
export const metaContentIdFor = ({ productId, variantId, sku } = {}, keys = snapshot?.keys || null) => {
  if (!keys || !productId || !variantId) return "";
  const cleanSku = String(sku ?? "").trim();
  return metaCatalogItemId({ productId, variantId, sku: cleanSku, skuUnique: Boolean(cleanSku) && !keys.has(skuKey(cleanSku)) });
};

export const attachMetaContentIds = (product = {}, keys = snapshot?.keys || null) => {
  if (!product || !keys || !Array.isArray(product.variants)) return product;
  return {
    ...product,
    variants: product.variants.map((variant) => {
      const id = metaContentIdFor({ productId: variant?.product_id || product.id, variantId: variant?.id, sku: variant?.sku }, keys);
      return id ? { ...variant, meta_content_id: id } : variant;
    }),
  };
};
