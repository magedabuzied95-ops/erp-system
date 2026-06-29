import process from "node:process";

import db from "../database/db.js";
import { generateThermalArtwork } from "../services/thermalArtworkService.js";

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
      v.id,
      v.product_id,
      v.tenant_id,
      v.sku,
      v.article_code,
      v.color,
      v.image_url,
      v.thermal_image_url,
      v.thermal_image_status,
      p.name AS product_name
    FROM product_variants v
    LEFT JOIN products p ON p.id = v.product_id
    WHERE v.id > $1
      AND COALESCE(NULLIF(v.image_url, ''), '') <> ''
      AND (
        COALESCE(NULLIF(v.thermal_image_url, ''), '') = ''
        OR LOWER(COALESCE(NULLIF(v.thermal_image_status, ''), 'pending')) <> 'ready'
      )
    ORDER BY v.id ASC
    LIMIT $2
    `,
    [lastId, batchSize]
  );

  return result.rows;
};

const processBatch = async ({ entityType, rows, counters }) => {
  for (const row of rows) {
    try {
      const result = await generateThermalArtwork({
        entityType,
        tenantId: row.tenant_id,
        productId: entityType === "variant" ? row.product_id : row.id,
        variantId: entityType === "variant" ? row.id : null,
        sourceImageUrl: row.image_url || "",
        existingThermalImageUrl: row.thermal_image_url || "",
        regenerate: false,
        productName:
          entityType === "variant"
            ? row.product_name || row.color || row.sku || row.article_code || `variant-${row.id}`
            : row.name || `product-${row.id}`,
      });

      if (result?.success) {
        if (result?.cached) {
          counters.cached += 1;
        } else {
          counters.generated += 1;
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
