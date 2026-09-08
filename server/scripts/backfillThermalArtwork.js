/**
 * Draw the thermal label artwork for the whole catalogue.
 *
 * One drawing per product colour (the label prints the colour, not the size
 * row), newest product first so the shelves that are being labelled today get
 * their artwork before last year's stock. The run is resumable: every colour
 * is marked ready the moment its file is written, and a re-run with the same
 * `--refresh-before` skips what is already done, so a container restart in
 * the middle costs at most the colour that was in flight.
 *
 *   node server/scripts/backfillThermalArtwork.js [--refresh-before=<ISO time>] [--limit=<n>] [--dry-run]
 *
 * Without `--refresh-before` only colours with no artwork are drawn. With it,
 * artwork drawn before that moment is redrawn as well — the way to move the
 * catalogue onto a new version of the engine without touching the colours
 * the owner already approved.
 */
import process from "node:process";

import db from "../database/db.js";
import { generateThermalArtwork } from "../services/thermalArtworkService.js";
import { syncThermalImageToVariantGroup } from "../services/thermalColorJobPlanner.js";

const argValue = (name) => {
  const arg = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : "";
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

export const parseRefreshBefore = (raw) => {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`--refresh-before is not a date: ${raw}`);
  return parsed.toISOString();
};

const refreshBefore = parseRefreshBefore(argValue("refresh-before") || process.env.THERMAL_BACKFILL_REFRESH_BEFORE || "");
const limit = Math.max(0, Number(argValue("limit") || process.env.THERMAL_BACKFILL_LIMIT || 0) || 0);
const dryRun = hasFlag("dry-run");

// The colour's photo: the colour's primary gallery image, else the row's own.
const COLOUR_IMAGE_SQL = "COALESCE(NULLIF(pvi.image_url, ''), NULLIF(v.image_url, ''))";
const COLOUR_KEY_SQL = "LOWER(TRIM(COALESCE(v.color, '')))";
const ROW_READY_SQL =
  "LOWER(COALESCE(NULLIF(v.thermal_image_status, ''), 'pending')) = 'ready' AND COALESCE(NULLIF(v.thermal_image_url, ''), '') <> ''";
const PRODUCT_READY_SQL =
  "LOWER(COALESCE(NULLIF(p.thermal_image_status, ''), 'pending')) = 'ready' AND COALESCE(NULLIF(p.thermal_image_url, ''), '') <> ''";

/**
 * "Done" means ready artwork that is new enough. Without a cutoff any ready
 * artwork counts; with one, only artwork generated at or after it. Artwork
 * from before the column existed has no timestamp: it is old, not unknown,
 * so the comparison must read false rather than NULL — a NULL inside
 * BOOL_OR would make the whole colour vanish from the queue.
 */
export const doneClause = (readySql, generatedAtSql, cutoff = refreshBefore) =>
  cutoff ? `(${readySql} AND COALESCE(${generatedAtSql} >= $1::timestamptz, false))` : `(${readySql})`;

const cutoffParams = () => (refreshBefore ? [refreshBefore] : []);

export const colourQueueSql = (cutoff = refreshBefore) => `
    SELECT
      v.product_id,
      MAX(v.tenant_id) AS tenant_id,
      MAX(p.name) AS product_name,
      MAX(v.color) AS color,
      ${COLOUR_KEY_SQL} AS color_key,
      ${COLOUR_IMAGE_SQL} AS primary_image_url,
      ARRAY_AGG(v.id ORDER BY v.id ASC) AS variant_ids,
      MIN(v.id) AS representative_variant_id,
      MAX(v.thermal_image_url) FILTER (WHERE ${ROW_READY_SQL}) AS existing_thermal_url,
      MAX(v.thermal_image_generated_at) AS generated_at,
      MAX(p.created_at) AS product_created_at
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN LATERAL (
      SELECT pvi.image_url
      FROM product_variant_images pvi
      WHERE pvi.product_id = v.product_id
        AND LOWER(TRIM(COALESCE(pvi.color_name, pvi.color_value, ''))) = ${COLOUR_KEY_SQL}
        AND COALESCE(NULLIF(pvi.image_url, ''), '') <> ''
      ORDER BY pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
      LIMIT 1
    ) pvi ON TRUE
    WHERE ${COLOUR_IMAGE_SQL} IS NOT NULL
    GROUP BY v.product_id, color_key, primary_image_url
    HAVING NOT BOOL_OR(${doneClause(ROW_READY_SQL, "v.thermal_image_generated_at", cutoff)})
    ORDER BY MAX(p.created_at) DESC, v.product_id DESC, color_key ASC
`;

export const fetchColourQueue = async () => {
  const result = await db.query(colourQueueSql(), cutoffParams());
  return result.rows;
};

/**
 * Product-level artwork only matters where no colour carries a photo (a
 * simple product, or one whose photos live on the product alone); everywhere
 * else the label reads the colour's artwork, and drawing the product as well
 * would double the run for nothing.
 */
export const productQueueSql = (cutoff = refreshBefore) => `
    SELECT p.id, p.tenant_id, p.name, p.image_url, p.thermal_image_url, p.created_at
    FROM products p
    WHERE COALESCE(NULLIF(p.image_url, ''), '') <> ''
      AND NOT ${doneClause(PRODUCT_READY_SQL, "p.thermal_image_generated_at", cutoff)}
      AND NOT EXISTS (
        SELECT 1
        FROM product_variants v
        LEFT JOIN product_variant_images pvi
          ON pvi.product_id = v.product_id
         AND LOWER(TRIM(COALESCE(pvi.color_name, pvi.color_value, ''))) = ${COLOUR_KEY_SQL}
        WHERE v.product_id = p.id
          AND ${COLOUR_IMAGE_SQL} IS NOT NULL
      )
    ORDER BY p.created_at DESC, p.id DESC
`;

export const fetchProductQueue = async () => {
  const result = await db.query(productQueueSql(), cutoffParams());
  return result.rows;
};

const formatDuration = (ms) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} h`;
};

const drawColour = async (row) => {
  const result = await generateThermalArtwork({
    entityType: "variant",
    tenantId: row.tenant_id,
    productId: row.product_id,
    variantId: row.representative_variant_id,
    sourceImageUrl: row.primary_image_url,
    existingThermalImageUrl: "",
    // Old artwork is being replaced, so the cached file under the old key
    // must not be served back.
    regenerate: Boolean(row.existing_thermal_url),
    productName: row.product_name || row.color || `variant-${row.representative_variant_id}`,
  });
  if (!result?.success || !result?.thermal_image_url) {
    throw new Error(result?.error || "Thermal generation returned failure");
  }
  await syncThermalImageToVariantGroup({
    productId: row.product_id,
    tenantId: row.tenant_id,
    variantIds: row.variant_ids || [row.representative_variant_id],
    thermalImageUrl: result.thermal_image_url,
    thermalImageStatus: "ready",
    thermalImageGeneratedAt: new Date().toISOString(),
  });
  return result;
};

const drawProduct = async (row) => {
  const result = await generateThermalArtwork({
    entityType: "product",
    tenantId: row.tenant_id,
    productId: row.id,
    sourceImageUrl: row.image_url,
    existingThermalImageUrl: "",
    regenerate: Boolean(row.thermal_image_url),
    productName: row.name || `product-${row.id}`,
  });
  if (!result?.success || !result?.thermal_image_url) {
    throw new Error(result?.error || "Thermal generation returned failure");
  }
  return result;
};

const runQueue = async ({ entityType, rows, draw, describe, counters, startedAt, totalPlanned }) => {
  for (const row of rows) {
    if (limit && counters.processed >= limit) break;
    const label = describe(row);
    const itemStarted = Date.now();
    if (dryRun) {
      console.log("THERMAL_BACKFILL_WOULD_DRAW", { entityType, ...label });
      counters.processed += 1;
      continue;
    }
    try {
      const result = await draw(row);
      counters[result?.cached ? "cached" : "generated"] += 1;
      console.log("THERMAL_BACKFILL_ITEM_DONE", {
        entityType,
        ...label,
        thermalImageUrl: result.thermal_image_url,
        cached: Boolean(result?.cached),
        ms: Date.now() - itemStarted,
      });
    } catch (error) {
      counters.failed += 1;
      console.error("THERMAL_BACKFILL_ITEM_FAILED", { entityType, ...label, message: error?.message });
    } finally {
      counters.processed += 1;
      const elapsed = Date.now() - startedAt;
      const perItem = elapsed / counters.processed;
      console.log("THERMAL_BACKFILL_PROGRESS", {
        processed: counters.processed,
        total: totalPlanned,
        generated: counters.generated,
        cached: counters.cached,
        failed: counters.failed,
        elapsed: formatDuration(elapsed),
        eta: formatDuration(perItem * Math.max(0, totalPlanned - counters.processed)),
      });
    }
  }
};

const main = async () => {
  const startedAt = Date.now();
  const [colours, products] = await Promise.all([fetchColourQueue(), fetchProductQueue()]);
  const totalPlanned = limit ? Math.min(limit, colours.length + products.length) : colours.length + products.length;
  console.log("THERMAL_BACKFILL_STARTED", {
    refreshBefore,
    limit: limit || null,
    dryRun,
    colours: colours.length,
    products: products.length,
    redraws: colours.filter((row) => row.existing_thermal_url).length + products.filter((row) => row.thermal_image_url).length,
    first: colours[0] ? { productId: colours[0].product_id, name: colours[0].product_name, color: colours[0].color } : null,
    startedAt: new Date(startedAt).toISOString(),
  });

  const counters = { processed: 0, generated: 0, cached: 0, failed: 0 };
  await runQueue({
    entityType: "variant",
    rows: colours,
    draw: drawColour,
    describe: (row) => ({ productId: row.product_id, name: row.product_name, color: row.color, variantId: row.representative_variant_id }),
    counters,
    startedAt,
    totalPlanned,
  });
  await runQueue({
    entityType: "product",
    rows: products,
    draw: drawProduct,
    describe: (row) => ({ productId: row.id, name: row.name }),
    counters,
    startedAt,
    totalPlanned,
  });

  console.log("THERMAL_BACKFILL_COMPLETED", { ...counters, durationMs: Date.now() - startedAt });
  // What is still missing after this pass: failures, or rows added while it ran.
  const [coloursLeft, productsLeft] = await Promise.all([fetchColourQueue(), fetchProductQueue()]);
  console.log("THERMAL_BACKFILL_REMAINING", { colours: coloursLeft.length, products: productsLeft.length });
};

const invokedDirectly = Boolean(process.argv[1]) && /backfillThermalArtwork\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  main()
    .then(() => process.exit(process.exitCode || 0))
    .catch((error) => {
      console.error("THERMAL_BACKFILL_FATAL", { message: error?.message, stack: error?.stack });
      process.exit(1);
    });
}
