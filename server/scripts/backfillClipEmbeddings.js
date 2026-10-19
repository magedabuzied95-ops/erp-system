/**
 * Fill ai_product_image_visual_index.image_embedding with CLIP vectors for
 * every indexed product photo — active, in-stock products first.
 *
 * Resumable: a row whose embedding_model is already the current model is
 * skipped, so stopping and re-running picks up where it left off. Photos that
 * cannot be read are marked failed and skipped next time (--retry-failed).
 * Writes ONLY image_embedding / embedding_model / embedding_updated_at.
 *
 * Usage (inside the backend container):
 *   node server/scripts/backfillClipEmbeddings.js
 *   node server/scripts/backfillClipEmbeddings.js --tenant=1 --batch=32 --max=500
 *   node server/scripts/backfillClipEmbeddings.js --count     (just report what is left)
 *   node server/scripts/backfillClipEmbeddings.js --retry-failed
 */
import "dotenv/config";

import db from "../database/db.js";
import { CLIP_MODEL_ID, CLIP_MODEL_PATH, isClipModelAvailable } from "../lib/clipImageEmbedder.js";
import { countPendingImages, embedPendingImages } from "../lib/clipImageIndexWriter.js";

const arg = (name, fallback = null) => {
  const hit = process.argv.slice(2).find((item) => item === `--${name}` || item.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};

const tenantId = Number(arg("tenant", 0)) || null;
const batchSize = Math.max(1, Math.min(256, Number(arg("batch", 32)) || 32));
const maxImages = Number(arg("max", 0)) || Infinity;
const retryFailed = Boolean(arg("retry-failed", false));
const countOnly = Boolean(arg("count", false));

const mb = (bytes) => Math.round(bytes / 1024 / 1024);
const formatDuration = (ms) => {
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h${String(minutes).padStart(2, "0")}m` : `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
};

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log(`[clip-backfill] ${signal}: finishing the current batch, then stopping (send again to abort)`);
  });
}

const main = async () => {
  const before = await countPendingImages(db, { tenantId, retryFailed });
  console.log("[clip-backfill] start", {
    model: CLIP_MODEL_ID,
    tenant: tenantId || "all",
    pending_images: before.images,
    pending_rows: before.rows,
    batch: batchSize,
    max: Number.isFinite(maxImages) ? maxImages : "all",
  });
  if (countOnly || !before.images) return;
  if (!(await isClipModelAvailable())) throw new Error(`CLIP model missing at ${CLIP_MODEL_PATH}`);

  const target = Math.min(before.images, maxImages);
  const startedAt = Date.now();
  const totals = { images: 0, embedded: 0, failed: 0, rows: 0, local: 0, remote: 0, embedMs: 0 };
  while (!stopping && totals.images < target) {
    const batch = await embedPendingImages({
      limit: Math.min(batchSize, target - totals.images),
      tenantId,
      retryFailed,
      onImage: (info) => {
        if (info.source) totals[info.source] = (totals[info.source] || 0) + 1;
        totals.embedMs += info.durationMs;
        if (!info.ok) console.warn("[clip-backfill] skipped", { image_url: info.image_url, error: info.error.slice(0, 160) });
      },
    });
    if (!batch.picked) break;
    totals.images += batch.picked;
    totals.embedded += batch.embedded;
    totals.failed += batch.failed;
    totals.rows += batch.rows;
    const elapsed = Date.now() - startedAt;
    const perImage = elapsed / totals.images;
    console.log(
      `[clip-backfill] ${totals.images}/${target} images (${Math.round((totals.images / target) * 100)}%)`
      + ` ok=${totals.embedded} failed=${totals.failed} rows=${totals.rows}`
      + ` local=${totals.local} remote=${totals.remote}`
      + ` ${Math.round(perImage)}ms/img elapsed=${formatDuration(elapsed)} eta=${formatDuration(perImage * (target - totals.images))}`
      + ` rss=${mb(process.memoryUsage().rss)}MB`
    );
  }
  const after = await countPendingImages(db, { tenantId, retryFailed: false });
  console.log("[clip-backfill] done", {
    ...totals,
    duration: formatDuration(Date.now() - startedAt),
    still_pending_images: after.images,
    stopped_early: stopping,
  });
};

main()
  .catch((error) => {
    console.error("[clip-backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end().catch(() => {});
    // The WASM runtime keeps worker threads alive.
    setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
  });
