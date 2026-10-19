import db from "../database/db.js";
import { CLIP_MODEL_ID, embedImage } from "../lib/clipImageEmbedder.js";

/**
 * "Which of our shoes does this photo look like?" — cosine similarity between
 * the customer's photo and every stocked product photo's CLIP vector
 * (ai_product_image_visual_index.image_embedding, filled by
 * server/lib/clipImageIndexWriter.js). No text is involved, so a shoe whose
 * model name nobody can read off the photo is still found.
 *
 * The vectors (~11k × 512) live in memory per tenant. A refresh every TTL
 * re-reads the light columns and the live stock, but downloads a vector only
 * when its row is new or was re-embedded since the last load.
 */

const CACHE_TTL_MS = Math.max(5_000, Number(process.env.VISUAL_EMBEDDING_CACHE_TTL_MS || 60_000));
const DIM = 512;

const text = (value = "") => String(value ?? "").trim();
const colorKey = (value = "") => text(value).toLowerCase().replace(/\s+/g, " ");

const tableColumns = async (clientOrPool, tableName) => {
  const result = await clientOrPool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const parseVector = (value) => {
  const list = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(list) || list.length !== DIM) return null;
  const vector = Float32Array.from(list, Number);
  let sum = 0;
  for (let index = 0; index < DIM; index += 1) sum += vector[index] * vector[index];
  const norm = Math.sqrt(sum);
  if (!norm || !Number.isFinite(norm)) return null;
  // Stored vectors are rounded to 5 decimals; re-normalise so dot = cosine.
  for (let index = 0; index < DIM; index += 1) vector[index] /= norm;
  return vector;
};

/**
 * Live stock, read at every refresh (the index row's own `stock` is only as
 * fresh as the last reindex). In stock = an active, undeleted variant with
 * stock > 0 — of that colour when the photo carries one — or, for a product
 * without variants, products.stock > 0. Hidden/deleted products drop out.
 */
const loadStockState = async (clientOrPool, tenantId) => {
  const [productColumns, variantColumns] = await Promise.all([
    tableColumns(clientOrPool, "products"),
    tableColumns(clientOrPool, "product_variants").catch(() => new Set()),
  ]);
  const productClauses = [];
  if (productColumns.has("deleted_at")) productClauses.push("p.deleted_at IS NULL");
  if (productColumns.has("is_active")) productClauses.push("COALESCE(p.is_active, TRUE) = TRUE");
  const productStock = productColumns.has("stock") ? "COALESCE(p.stock, 0)" : "0";
  const products = await clientOrPool.query(
    `SELECT p.id, ${productStock} AS stock FROM products p WHERE p.tenant_id = $1 ${productClauses.map((clause) => `AND ${clause}`).join(" ")}`,
    [tenantId]
  );
  const activeProducts = new Map(products.rows.map((row) => [String(row.id), Number(row.stock || 0)]));

  const variantProducts = new Set();
  const stockedProducts = new Set();
  const stockedColors = new Set();
  const variantColors = new Set();
  if (variantColumns.has("product_id") && variantColumns.has("stock")) {
    const variantClauses = [];
    if (variantColumns.has("deleted_at")) variantClauses.push("pv.deleted_at IS NULL");
    if (variantColumns.has("is_active")) variantClauses.push("COALESCE(pv.is_active, TRUE) = TRUE");
    const colorExpr = variantColumns.has("color") ? "COALESCE(pv.color, '')" : "''";
    const variants = await clientOrPool.query(
      `
      SELECT pv.product_id, ${colorExpr} AS color, BOOL_OR(COALESCE(pv.stock, 0) > 0) AS in_stock
      FROM product_variants pv JOIN products p ON p.id = pv.product_id
      WHERE p.tenant_id = $1 ${variantClauses.map((clause) => `AND ${clause}`).join(" ")}
      GROUP BY pv.product_id, ${colorExpr}
      `,
      [tenantId]
    );
    for (const row of variants.rows) {
      const productId = String(row.product_id);
      variantProducts.add(productId);
      variantColors.add(`${productId}:${colorKey(row.color)}`);
      if (row.in_stock) {
        stockedProducts.add(productId);
        stockedColors.add(`${productId}:${colorKey(row.color)}`);
      }
    }
  }
  return { activeProducts, variantProducts, stockedProducts, stockedColors, variantColors };
};

export const isEntryInStock = (entry, stock) => {
  const productId = String(entry.product_id);
  if (!stock.activeProducts.has(productId)) return false;
  if (!stock.variantProducts.has(productId)) return stock.activeProducts.get(productId) > 0;
  if (!stock.stockedProducts.has(productId)) return false;
  const color = colorKey(entry.color);
  if (!color) return true;
  if (stock.stockedColors.has(`${productId}:${color}`)) return true;
  // A gallery colour name the variants don't use (typo, other language) does
  // not make the product unavailable — the product-level answer stands.
  return !stock.variantColors.has(`${productId}:${color}`);
};

/**
 * @param {object} deps  injectable for tests
 * @param {(tenantId:number) => Promise<Array>} deps.loadMeta   light rows with embedding_updated_at
 * @param {(ids:Array) => Promise<Map>} deps.loadVectors        id → vector json
 * @param {(tenantId:number) => Promise<object>} deps.loadStock
 * @param {(buffer:Buffer) => Promise<Float32Array>} deps.embed
 */
export const createVisualEmbeddingSearch = ({
  loadMeta,
  loadVectors,
  loadStock,
  embed,
  ttlMs = CACHE_TTL_MS,
  now = () => Date.now(),
} = {}) => {
  const caches = new Map();

  const refresh = async (tenantId) => {
    const previous = caches.get(tenantId);
    const vectors = previous?.vectors || new Map();
    const [meta, stock] = await Promise.all([loadMeta(tenantId), loadStock(tenantId)]);
    const missing = meta.filter((row) => {
      const cached = vectors.get(String(row.id));
      return !cached || cached.stamp !== String(row.embedding_updated_at);
    });
    if (missing.length) {
      const loaded = await loadVectors(missing.map((row) => row.id));
      for (const row of missing) {
        const vector = loaded.has(String(row.id)) ? parseVector(loaded.get(String(row.id))) : null;
        if (vector) vectors.set(String(row.id), { vector, stamp: String(row.embedding_updated_at) });
      }
    }
    const liveIds = new Set(meta.map((row) => String(row.id)));
    for (const id of vectors.keys()) if (!liveIds.has(id)) vectors.delete(id);
    const entries = [];
    for (const row of meta) {
      const cached = vectors.get(String(row.id));
      if (!cached) continue;
      entries.push({
        id: String(row.id),
        product_id: row.product_id,
        variant_id: row.variant_id ?? null,
        color: text(row.color),
        image_url: text(row.image_url),
        product_name: text(row.product_name),
        vector: cached.vector,
      });
    }
    const state = { loadedAt: now(), vectors, entries, stock };
    caches.set(tenantId, state);
    return state;
  };

  const inflight = new Map();
  const getState = async (tenantId) => {
    const current = caches.get(tenantId);
    if (current && now() - current.loadedAt < ttlMs) return current;
    if (!inflight.has(tenantId)) {
      inflight.set(tenantId, refresh(tenantId).finally(() => inflight.delete(tenantId)));
    }
    // A stale cache answers while the refresh runs; only a cold start waits.
    if (current) {
      inflight.get(tenantId).catch((error) => {
        console.warn("[visual-embedding-search] refresh failed", { tenantId, message: error?.message || String(error) });
      });
      return current;
    }
    return inflight.get(tenantId);
  };

  /** Rank cached entries against a query vector. Exposed for tests. */
  const rank = (state, queryVector, { limit = 15, onlyInStock = true } = {}) => {
    const best = new Map();
    for (const entry of state.entries) {
      if (onlyInStock && !isEntryInStock(entry, state.stock)) continue;
      let dot = 0;
      const vector = entry.vector;
      for (let index = 0; index < DIM; index += 1) dot += vector[index] * queryVector[index];
      const key = `${entry.product_id}:${colorKey(entry.color)}`;
      const current = best.get(key);
      if (!current || dot > current.similarity) best.set(key, { entry, similarity: dot });
    }
    const coloured = new Set();
    for (const { entry } of best.values()) if (colorKey(entry.color)) coloured.add(String(entry.product_id));
    return [...best.values()]
      // A colourless gallery photo only speaks for the product when none of
      // its colours made the list.
      .filter(({ entry }) => colorKey(entry.color) || !coloured.has(String(entry.product_id)))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, Math.max(1, Math.trunc(Number(limit) || 15)))
      .map(({ entry, similarity }) => ({
        product_id: entry.product_id,
        variant_id: entry.variant_id,
        color: entry.color,
        image_url: entry.image_url,
        product_name: entry.product_name,
        similarity: Math.round(similarity * 10000) / 10000,
      }));
  };

  const findNearestProductImages = async ({ tenantId, imageBuffer, limit = 15, onlyInStock = true } = {}) => {
    const tenant = Math.trunc(Number(tenantId));
    if (!Number.isFinite(tenant) || tenant <= 0 || !imageBuffer?.length) return [];
    const [state, queryVector] = await Promise.all([getState(tenant), embed(imageBuffer)]);
    if (!state.entries.length) return [];
    return rank(state, queryVector, { limit, onlyInStock });
  };

  return { findNearestProductImages, rank, getState, clear: () => caches.clear() };
};

const defaultSearch = createVisualEmbeddingSearch({
  loadMeta: async (tenantId) => {
    const result = await db.query(
      `
      SELECT id, product_id, variant_id, color, image_url, product_name, embedding_updated_at
      FROM ai_product_image_visual_index
      WHERE tenant_id = $1 AND embedding_model = $2 AND image_embedding IS NOT NULL
      `,
      [tenantId, CLIP_MODEL_ID]
    );
    return result.rows;
  },
  loadVectors: async (ids) => {
    const out = new Map();
    for (let start = 0; start < ids.length; start += 2000) {
      const chunk = ids.slice(start, start + 2000);
      const result = await db.query(
        `SELECT id, image_embedding FROM ai_product_image_visual_index WHERE id = ANY($1::bigint[])`,
        [chunk]
      );
      for (const row of result.rows) out.set(String(row.id), row.image_embedding);
    }
    return out;
  },
  loadStock: (tenantId) => loadStockState(db, tenantId),
  embed: embedImage,
});

/**
 * @returns {Promise<Array<{ product_id, variant_id, color, image_url, product_name, similarity }>>}
 *   one row per product + colour, best first; similarity is cosine in [-1, 1]
 *   (same-shoe photos typically ≥ 0.85, same-style shoes ~0.75–0.85).
 */
export const findNearestProductImages = (options) => defaultSearch.findNearestProductImages(options);

export default { findNearestProductImages };
