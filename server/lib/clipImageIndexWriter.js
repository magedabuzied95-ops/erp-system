import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db from "../database/db.js";
import { CLIP_MODEL_ID, embedImage, isClipModelAvailable } from "./clipImageEmbedder.js";

/**
 * Fills ai_product_image_visual_index.image_embedding with CLIP vectors.
 *
 * Shared by the one-off backfill (server/scripts/backfillClipEmbeddings.js)
 * and the indexer hook that embeds a product's new photos after it is saved.
 * It writes ONLY image_embedding / embedding_model / embedding_updated_at:
 * updated_at and every text column stay as the indexer left them.
 *
 * A row is "done" when embedding_model is the current CLIP_MODEL_ID. A photo
 * that cannot be read or decoded is marked `failed:<model>` so it is not
 * retried on every pass (pass retryFailed to try them again).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FAILED_MODEL_ID = `failed:${CLIP_MODEL_ID}`;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

// Where express serves /uploads from (server.js mounts all three).
const UPLOAD_ROOTS = [...new Set([
  process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : "",
  path.resolve(process.cwd(), "uploads"),
  path.resolve(here, "..", "uploads"),
  path.resolve(here, "..", "..", "uploads"),
].filter(Boolean))];

const text = (value = "") => String(value ?? "").trim();

/** The path under /uploads/ when the URL is one of ours, else "". */
export const localUploadsRelativePath = (imageUrl = "") => {
  const raw = text(imageUrl);
  if (!raw) return "";
  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return "";
    }
  }
  pathname = pathname.split(/[?#]/)[0];
  const match = pathname.match(/^\/?uploads\/(.+)$/);
  if (!match) return "";
  let relative;
  try {
    relative = decodeURIComponent(match[1]);
  } catch {
    return "";
  }
  if (!relative || relative.split(/[\\/]/).includes("..")) return "";
  return relative;
};

export const loadImageBytes = async (imageUrl, { fetchImpl = globalThis.fetch, uploadRoots = UPLOAD_ROOTS } = {}) => {
  const relative = localUploadsRelativePath(imageUrl);
  if (relative) {
    for (const root of uploadRoots) {
      const candidate = path.resolve(root, relative);
      if (!candidate.startsWith(`${root}${path.sep}`)) continue;
      try {
        const buffer = await fs.readFile(candidate);
        if (buffer.length) return { buffer, source: "local" };
      } catch {
        // not under this root — try the next, then the network
      }
    }
  }
  const raw = text(imageUrl);
  if (!/^https?:\/\//i.test(raw)) throw new Error("image_not_found_locally");
  const response = await fetchImpl(raw, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  if (!response.ok) throw new Error(`image_fetch_http_${response.status}`);
  const type = text(response.headers.get("content-type")).toLowerCase();
  if (type && !type.startsWith("image/") && !type.startsWith("application/octet-stream")) {
    throw new Error(`image_fetch_not_image:${type.slice(0, 40)}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("image_fetch_empty");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("image_fetch_too_large");
  return { buffer, source: "remote" };
};

/** 5 decimals keeps a row near 4 KB of jsonb; the rounding error is ~1e-5 per dim. */
export const serializeEmbedding = (vector) => JSON.stringify(Array.from(vector, (value) => Math.round(value * 1e5) / 1e5));

const numberList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : [values]).map(Number).filter((value) => Number.isFinite(value) && value > 0).map(Math.trunc))];

/**
 * Distinct images still missing a current vector, active in-stock products
 * first. One entry per (tenant, image URL): the product row, its variant rows
 * and its gallery rows often share a photo, and it is embedded once.
 */
export const selectPendingImages = async (clientOrPool = db, { limit = 32, tenantId = null, productIds = null, retryFailed = false } = {}) => {
  const params = [CLIP_MODEL_ID];
  const where = ["COALESCE(i.embedding_model, '') <> $1"];
  if (!retryFailed) {
    params.push(FAILED_MODEL_ID);
    where.push(`COALESCE(i.embedding_model, '') <> $${params.length}`);
  }
  if (tenantId) {
    params.push(Number(tenantId));
    where.push(`i.tenant_id = $${params.length}::bigint`);
  }
  const ids = productIds ? numberList(productIds) : null;
  if (ids) {
    if (!ids.length) return [];
    params.push(ids);
    where.push(`i.product_id = ANY($${params.length}::bigint[])`);
  }
  params.push(Math.max(1, Math.trunc(Number(limit) || 32)));
  const result = await clientOrPool.query(
    `
    SELECT i.tenant_id, LOWER(TRIM(i.image_url)) AS image_key, MIN(i.image_url) AS image_url,
           BOOL_OR(COALESCE(i.stock, 0) > 0 OR EXISTS (
             SELECT 1 FROM product_variants pv
             WHERE pv.product_id = i.product_id AND COALESCE(pv.stock, 0) > 0
               AND COALESCE(pv.is_active, TRUE) = TRUE AND pv.deleted_at IS NULL
           )) AS in_stock,
           MIN(i.id) AS first_id
    FROM ai_product_image_visual_index i
    WHERE ${where.join(" AND ")}
    GROUP BY i.tenant_id, LOWER(TRIM(i.image_url))
    ORDER BY in_stock DESC, first_id ASC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows;
};

export const countPendingImages = async (clientOrPool = db, { tenantId = null, retryFailed = false } = {}) => {
  const params = [CLIP_MODEL_ID];
  const where = ["COALESCE(embedding_model, '') <> $1"];
  if (!retryFailed) {
    params.push(FAILED_MODEL_ID);
    where.push(`COALESCE(embedding_model, '') <> $${params.length}`);
  }
  if (tenantId) {
    params.push(Number(tenantId));
    where.push(`tenant_id = $${params.length}::bigint`);
  }
  const result = await clientOrPool.query(
    `SELECT COUNT(DISTINCT (tenant_id, LOWER(TRIM(image_url))))::int AS images, COUNT(*)::int AS rows
     FROM ai_product_image_visual_index WHERE ${where.join(" AND ")}`,
    params
  );
  return result.rows[0] || { images: 0, rows: 0 };
};

const writeImageEmbedding = async (clientOrPool, { tenantId, imageKey, vector }) => {
  const result = await clientOrPool.query(
    `
    UPDATE ai_product_image_visual_index
    SET image_embedding = $3::jsonb, embedding_model = $4, embedding_updated_at = NOW()
    WHERE tenant_id = $1 AND LOWER(TRIM(image_url)) = $2
    `,
    [tenantId, imageKey, vector ? serializeEmbedding(vector) : null, vector ? CLIP_MODEL_ID : FAILED_MODEL_ID]
  );
  return result.rowCount || 0;
};

/**
 * Embed one batch of pending images.
 * @returns {Promise<{ picked, embedded, failed, rows, errors }>}
 */
export const embedPendingImages = async ({
  clientOrPool = db,
  limit = 32,
  tenantId = null,
  productIds = null,
  retryFailed = false,
  embed = embedImage,
  loadBytes = loadImageBytes,
  onImage = null,
} = {}) => {
  const pending = await selectPendingImages(clientOrPool, { limit, tenantId, productIds, retryFailed });
  const summary = { picked: pending.length, embedded: 0, failed: 0, rows: 0, errors: [] };
  for (const item of pending) {
    const startedAt = Date.now();
    let vector = null;
    let error = null;
    let source = "";
    try {
      const loaded = await loadBytes(item.image_url);
      source = loaded.source;
      vector = await embed(loaded.buffer);
    } catch (caught) {
      error = caught;
    }
    // A model that failed to load is not the photo's fault: stop instead of
    // stamping every row as failed.
    if (error && /clip_model|no such file|ENOENT.*\.onnx|InferenceSession/i.test(String(error?.message || error))) throw error;
    summary.rows += await writeImageEmbedding(clientOrPool, { tenantId: item.tenant_id, imageKey: item.image_key, vector });
    if (vector) summary.embedded += 1;
    else {
      summary.failed += 1;
      summary.errors.push({ image_url: item.image_url, error: String(error?.message || error).slice(0, 200) });
    }
    onImage?.({ image_url: item.image_url, ok: Boolean(vector), source, durationMs: Date.now() - startedAt, error: error ? String(error?.message || error) : "" });
  }
  return summary;
};

// ── Indexer hook ────────────────────────────────────────────────────────────
// After a product's images are (re)indexed, embed whatever is new. Runs on the
// pool a few seconds later — the indexer may still be inside the caller's
// transaction, whose rows are not visible yet — and one image at a time, so a
// customer's photo search queued on the same embedder waits for one image at
// most. CLIP_INDEX_ON_WRITE=0 turns it off.
const HOOK_DELAY_MS = 5_000;
const HOOK_MAX_IMAGES_PER_RUN = 200;
const hookProductIds = new Set();
let hookAllProducts = false;
let hookTimer = null;
let hookRunning = false;

const runHook = async () => {
  hookTimer = null;
  if (hookRunning) return;
  hookRunning = true;
  const all = hookAllProducts;
  const ids = [...hookProductIds];
  hookAllProducts = false;
  hookProductIds.clear();
  try {
    if (!(await isClipModelAvailable())) return;
    let total = 0;
    while (total < HOOK_MAX_IMAGES_PER_RUN) {
      const batch = await embedPendingImages({ limit: 16, productIds: all ? null : ids });
      total += batch.picked;
      if (batch.picked < 16) break;
    }
    if (total) console.log("[clip-index] embedded new product images", { images: total, products: all ? "all" : ids.length });
  } catch (error) {
    console.warn("[clip-index] embedding new product images failed", { message: error?.message || String(error) });
  } finally {
    hookRunning = false;
    if (hookAllProducts || hookProductIds.size) scheduleClipEmbedding({ all: hookAllProducts, productIds: [...hookProductIds] });
  }
};

export const scheduleClipEmbedding = ({ productIds = [], all = false } = {}) => {
  if (process.env.CLIP_INDEX_ON_WRITE === "0") return;
  if (all) hookAllProducts = true;
  for (const id of numberList(productIds)) hookProductIds.add(id);
  if (!hookAllProducts && !hookProductIds.size) return;
  if (hookTimer || hookRunning) return;
  hookTimer = setTimeout(() => { runHook().catch(() => {}); }, HOOK_DELAY_MS);
  hookTimer.unref?.();
};

export { FAILED_MODEL_ID };
