import process from "node:process";

import db from "../database/db.js";
import { generateThermalArtwork } from "../services/thermalArtworkService.js";
import { syncThermalImageToVariantGroup } from "../services/thermalColorJobPlanner.js";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const parseBatchSize = () => {
  const cliArg = process.argv.find((arg) => arg.startsWith("--batch-size="));
  const envValue = process.env.THERMAL_BACKFILL_BATCH_SIZE;
  const raw = cliArg ? cliArg.split("=").slice(1).join("=") : envValue;
  const parsed = Number(raw || DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return clamp(Math.round(parsed), 1, MAX_BATCH_SIZE);
};

const batchSize = parseBatchSize();

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const countCandidates = async (tableName) => {
  if (tableName === "product_variants") {
    const result = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT
          v.product_id,
          LOWER(TRIM(COALESCE(v.color, ''))) AS color_key,
          COALESCE(NULLIF(pvi.image_url, ''), NULLIF(v.image_url, ''), NULLIF(v.variant_image_url, ''), NULLIF(v.color_image_url, '')) AS primary_image_url
        FROM product_variants v
        LEFT JOIN LATERAL (
          SELECT pvi.image_url
          FROM product_variant_images pvi
          WHERE pvi.product_id = v.product_id
            AND LOWER(TRIM(COALESCE(pvi.color_name, pvi.color_value, ''))) = LOWER(TRIM(COALESCE(v.color, '')))
          ORDER BY pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
          LIMIT 1
        ) pvi ON TRUE
        WHERE COALESCE(NULLIF(pvi.image_url, ''), NULLIF(v.image_url, ''), NULLIF(v.variant_image_url, ''), NULLIF(v.color_image_url, '')) IS NOT NULL
        GROUP BY v.product_id, color_key, primary_image_url
        HAVING NOT BOOL_OR(
          LOWER(COALESCE(NULLIF(v.thermal_image_status, ''), 'pending')) = 'ready'
          AND COALESCE(
            NULLIF(v.thermal_image_url, ''),
            NULLIF(v.variant_color_thermal_image_url, ''),
            NULLIF(v.color_thermal_image_url, ''),
            NULLIF(v.product_thermal_image_url, '')
          ) <> ''
        )
      ) grouped
      `
    );
    return Number(result.rows[0]?.count || 0);
  }
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE COALESCE(NULLIF(image_url, ''), '') <> ''
      AND (
        COALESCE(NULLIF(thermal_image_url, ''), '') = ''
        OR LOWER(COALESCE(NULLIF(thermal_image_status, ''), 'pending')) <> 'ready'
      )
    `
  );

  return Number(result.rows[0]?.count || 0);
};

const fetchProductBatch = async (lastId = 0) => {
  const result = await db.query(
    `
    SELECT id, tenant_id, name, image_url, thermal_image_url, thermal_image_status
    FROM products
    WHERE id > $1
      AND COALESCE(NULLIF(image_url, ''), '') <> ''
      AND (
        COALESCE(NULLIF(thermal_image_url, ''), '') = ''
        OR LOWER(COALESCE(NULLIF(thermal_image_status, ''), 'pending')) <> 'ready'
      )
    ORDER BY id ASC
    LIMIT $2
    `,
    [lastId, batchSize]
  );

  return result.rows;
};

const fetchVariantBatch = async (lastId = 0) => {
  const result = await db.query(
    `
    SELECT
      v.product_id,
      v.tenant_id,
      p.name AS product_name,
      LOWER(TRIM(COALESCE(v.color, ''))) AS color_key,
      COALESCE(NULLIF(pvi.image_url, ''), NULLIF(v.image_url, ''), NULLIF(v.variant_image_url, ''), NULLIF(v.color_image_url, '')) AS primary_image_url,
      MIN(v.id) AS id,
      ARRAY_AGG(v.id ORDER BY v.id ASC) AS variant_ids,
      MIN(v.id) AS representative_variant_id,
      MAX(COALESCE(NULLIF(v.thermal_image_url, ''), NULLIF(v.variant_color_thermal_image_url, ''), NULLIF(v.color_thermal_image_url, ''), NULLIF(v.product_thermal_image_url, ''))) AS existing_thermal_url
    FROM product_variants v
    LEFT JOIN products p ON p.id = v.product_id
    LEFT JOIN LATERAL (
      SELECT pvi.image_url
      FROM product_variant_images pvi
      WHERE pvi.product_id = v.product_id
        AND LOWER(TRIM(COALESCE(pvi.color_name, pvi.color_value, ''))) = LOWER(TRIM(COALESCE(v.color, '')))
      ORDER BY pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
      LIMIT 1
    ) pvi ON TRUE
    WHERE v.id > $1
      AND COALESCE(NULLIF(pvi.image_url, ''), NULLIF(v.image_url, ''), NULLIF(v.variant_image_url, ''), NULLIF(v.color_image_url, '')) IS NOT NULL
    GROUP BY v.product_id, v.tenant_id, p.name, color_key, primary_image_url
    HAVING NOT BOOL_OR(
      LOWER(COALESCE(NULLIF(v.thermal_image_status, ''), 'pending')) = 'ready'
      AND COALESCE(
        NULLIF(v.thermal_image_url, ''),
        NULLIF(v.variant_color_thermal_image_url, ''),
        NULLIF(v.color_thermal_image_url, ''),
        NULLIF(v.product_thermal_image_url, '')
      ) <> ''
    )
    ORDER BY MIN(v.id) ASC
    LIMIT $2
    `,
    [lastId, batchSize]
  );

  return result.rows;
};

const processBatch = async ({ entityType, rows, counters }) => {
  const batchRows = rows;
  for (const row of batchRows) {
    try {
      if (entityType === "variant" && row.existing_thermal_url) {
        counters.cached += 1;
        console.log("THERMAL_COLOR_JOB_SKIPPED_EXISTING", {
          entityType,
          productId: row.product_id || null,
          color: row.color || row.color_key || "",
          sourceImageUrl: row.primary_image_url || "",
          thermalImageUrl: row.existing_thermal_url,
          variantIds: row.variant_ids || [],
        });
        await syncThermalImageToVariantGroup({
          productId: row.product_id || null,
          tenantId: row.tenant_id,
          variantIds: row.variant_ids || [],
          thermalImageUrl: row.existing_thermal_url,
          thermalImageStatus: "ready",
          thermalImageGeneratedAt: new Date().toISOString(),
        });
      } else {
        const result = await generateThermalArtwork({
          entityType,
          tenantId: row.tenant_id,
          productId: entityType === "variant" ? row.product_id : row.id,
          variantId: entityType === "variant" ? row.representative_variant_id || row.id : null,
          sourceImageUrl: row.primary_image_url || row.image_url || "",
          existingThermalImageUrl: row.existing_thermal_url || row.thermal_image_url || "",
          regenerate: false,
          productName:
            entityType === "variant"
              ? row.product_name || row.color || row.sku || row.article_code || `variant-${row.representative_variant_id || row.id}`
              : row.name || `product-${row.id}`,
        });

        if (result?.success) {
          if (result?.cached) {
            counters.cached += 1;
          } else {
            counters.generated += 1;
          }
          if (entityType === "variant" && result?.thermal_image_url) {
            await syncThermalImageToVariantGroup({
              productId: row.product_id,
              tenantId: row.tenant_id,
              variantIds: row.variant_ids || [row.representative_variant_id || row.id],
              thermalImageUrl: result.thermal_image_url,
              thermalImageStatus: "ready",
              thermalImageGeneratedAt: new Date().toISOString(),
            });
          }
        } else {
          counters.failed += 1;
          console.error("THERMAL_BACKFILL_ITEM_FAILED", {
            entityType,
            id: row.id,
            productId: entityType === "variant" ? row.product_id : row.id,
            tenantId: row.tenant_id,
            message: result?.error || "Thermal generation returned failure",
          });
        }
      }
    } catch (error) {
      counters.failed += 1;
      console.error("THERMAL_BACKFILL_ITEM_FAILED", {
        entityType,
        id: row.id,
        productId: entityType === "variant" ? row.product_id : row.id,
        tenantId: row.tenant_id,
        message: error?.message,
        stack: error?.stack,
      });
    } finally {
      counters.processed += 1;
    }
  }
};

const runEntityBackfill = async ({ entityType, fetchBatch, total }) => {
  const counters = {
    processed: 0,
    generated: 0,
    cached: 0,
    failed: 0,
  };

  let lastId = 0;
  while (true) {
    const rows = await fetchBatch(lastId);
    if (!rows.length) break;

    await processBatch({ entityType, rows, counters });
    lastId = rows[rows.length - 1].id;

    console.log("THERMAL_BACKFILL_PROGRESS", {
      entityType,
      processed: counters.processed,
      total,
      generated: counters.generated,
      cached: counters.cached,
      failed: counters.failed,
      batchSize,
      lastId,
    });

    await sleep(0);
  }

  return counters;
};

const main = async () => {
  const startedAt = Date.now();
  const [productsTotal, variantsTotal] = await Promise.all([
    countCandidates("products"),
    countCandidates("product_variants"),
  ]);

  console.log("THERMAL_BACKFILL_STARTED", {
    batchSize,
    productsTotal,
    variantsTotal,
    total: productsTotal + variantsTotal,
    startedAt: new Date(startedAt).toISOString(),
  });

  const productCounters = await runEntityBackfill({
    entityType: "product",
    fetchBatch: fetchProductBatch,
    total: productsTotal,
  });

  const variantCounters = await runEntityBackfill({
    entityType: "variant",
    fetchBatch: fetchVariantBatch,
    total: variantsTotal,
  });

  console.log("THERMAL_BACKFILL_COMPLETED", {
    batchSize,
    products: productCounters,
    variants: variantCounters,
    totalProcessed: productCounters.processed + variantCounters.processed,
    totalGenerated: productCounters.generated + variantCounters.generated,
    totalCached: productCounters.cached + variantCounters.cached,
    totalFailed: productCounters.failed + variantCounters.failed,
    durationMs: Date.now() - startedAt,
  });
};

main().catch((error) => {
  console.error("THERMAL_BACKFILL_FATAL", {
    message: error?.message,
    stack: error?.stack,
  });
  process.exitCode = 1;
});
