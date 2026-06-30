import db from "../database/db.js";

const normalizeText = (value = "") => String(value ?? "").trim();

const normalizeStatus = (value = "") => {
  const status = normalizeText(value).toLowerCase();
  return ["pending", "processing", "ready", "printed", "failed"].includes(status) ? status : "pending";
};

const normalizeSource = (value = "") => {
  const source = normalizeText(value).toLowerCase();
  return ["product_create", "color_add", "thermal_ready", "purchase"].includes(source) ? source : "thermal_ready";
};

const normalizeVariantIds = (value = []) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [...new Set(rawValues.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))].sort((a, b) => a - b);
};

const parseVariantIds = (value = []) => {
  if (Array.isArray(value)) return normalizeVariantIds(value);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return normalizeVariantIds(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
};

const queueRowFromDb = (row = {}) => ({
  ...row,
  id: row.id ?? null,
  tenant_id: row.tenant_id ?? null,
  product_id: row.product_id ?? null,
  color: normalizeText(row.color),
  color_key: normalizeText(row.color_key).toLowerCase(),
  image_url: normalizeText(row.image_url),
  thermal_image_url: normalizeText(row.thermal_image_url),
  status: normalizeStatus(row.status),
  source: normalizeSource(row.source),
  label_count: Number(row.label_count || 0),
  variant_ids: Array.isArray(row.variant_ids)
    ? normalizeVariantIds(row.variant_ids)
    : parseVariantIds(row.variant_ids),
  error_message: normalizeText(row.error_message),
  printed_at: row.printed_at || null,
  printed_by: row.printed_by ?? null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  product_name: normalizeText(row.product_name),
  product_image_url: normalizeText(row.product_image_url),
  product_thermal_image_url: normalizeText(row.product_thermal_image_url),
  product_thermal_image_status: normalizeText(row.product_thermal_image_status),
});

let schemaReadyPromise = null;

export const ensureBarcodePrintQueueSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS barcode_print_queue (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          color TEXT NOT NULL DEFAULT '',
          color_key TEXT NOT NULL,
          image_url TEXT NOT NULL DEFAULT '',
          thermal_image_url TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          source TEXT NOT NULL DEFAULT 'thermal_ready',
          label_count INTEGER NOT NULL DEFAULT 0,
          variant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          error_message TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          printed_at TIMESTAMP NULL,
          printed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL
        )
      `);
      await clientOrPool.query(`
        ALTER TABLE barcode_print_queue
        ADD COLUMN IF NOT EXISTS error_message TEXT NOT NULL DEFAULT ''
      `);
      await clientOrPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_barcode_print_queue_active_unique
        ON barcode_print_queue (tenant_id, product_id, color_key)
        WHERE status <> 'printed'
      `);
      await clientOrPool.query(`
        CREATE INDEX IF NOT EXISTS idx_barcode_print_queue_tenant_status_updated
        ON barcode_print_queue (tenant_id, status, updated_at DESC, id DESC)
      `);
      await clientOrPool.query(`
        CREATE INDEX IF NOT EXISTS idx_barcode_print_queue_product
        ON barcode_print_queue (tenant_id, product_id, color_key, updated_at DESC, id DESC)
      `);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const normalizeQueuePayload = ({
  tenantId = null,
  productId = null,
  color = "",
  colorKey = "",
  imageUrl = "",
  thermalImageUrl = "",
  status = "pending",
  source = "thermal_ready",
  labelCount = 0,
  variantIds = [],
  errorMessage = "",
  printedAt = null,
  printedBy = null,
} = {}) => {
  const normalizedVariantIds = normalizeVariantIds(variantIds);
  return {
    tenantId: Number(tenantId) || null,
    productId: Number(productId) || null,
    color: normalizeText(color),
    colorKey: normalizeText(colorKey || imageUrl).toLowerCase(),
    imageUrl: normalizeText(imageUrl),
    thermalImageUrl: normalizeText(thermalImageUrl),
    status: normalizeStatus(status),
    source: normalizeSource(source),
    labelCount: Math.max(1, Number(labelCount || normalizedVariantIds.length || 0) || 0),
    variantIds: normalizedVariantIds,
    errorMessage: normalizeText(errorMessage),
    printedAt: printedAt ? new Date(printedAt) : null,
    printedBy: printedBy === null || printedBy === undefined || printedBy === "" ? null : Number(printedBy) || null,
  };
};

const isSameQueueState = (existing = {}, next = {}) => {
  const existingIds = normalizeVariantIds(existing.variant_ids || []);
  const nextIds = normalizeVariantIds(next.variantIds || []);
  return (
    normalizeText(existing.color).toLowerCase() === normalizeText(next.color).toLowerCase() &&
    normalizeText(existing.color_key).toLowerCase() === normalizeText(next.colorKey).toLowerCase() &&
    normalizeText(existing.image_url) === normalizeText(next.imageUrl) &&
    normalizeText(existing.thermal_image_url) === normalizeText(next.thermalImageUrl) &&
    normalizeText(existing.error_message) === normalizeText(next.errorMessage) &&
    normalizeStatus(existing.status) === normalizeStatus(next.status) &&
    normalizeSource(existing.source) === normalizeSource(next.source) &&
    Number(existing.label_count || 0) === Number(next.labelCount || 0) &&
    JSON.stringify(existingIds) === JSON.stringify(nextIds) &&
    String(existing.printed_by ?? "") === String(next.printedBy ?? "") &&
    normalizeText(existing.printed_at || "") === normalizeText(next.printedAt || "")
  );
};

export const upsertBarcodePrintQueueItem = async (payload = {}) => {
  await ensureBarcodePrintQueueSchema();
  const next = normalizeQueuePayload(payload);
  if (!next.tenantId || !next.productId || !next.colorKey) {
    return { skipped: true, row: null };
  }

  const existingResult = await db.query(
    `
    SELECT *
    FROM barcode_print_queue
    WHERE tenant_id = $1
      AND product_id = $2
      AND color_key = $3
      AND status <> 'printed'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [next.tenantId, next.productId, next.colorKey]
  );
  const existingRow = existingResult.rows[0] ? queueRowFromDb(existingResult.rows[0]) : null;
  if (existingRow && isSameQueueState(existingRow, next)) {
    console.log("BARCODE_PRINT_QUEUE_SKIPPED_DUPLICATE", {
      tenantId: next.tenantId,
      productId: next.productId,
      color: next.color,
      colorKey: next.colorKey,
      status: next.status,
      source: next.source,
      labelCount: next.labelCount,
      variantIds: next.variantIds,
    });
    return { skipped: true, row: existingRow };
  }

  const result = await db.query(
    `
    INSERT INTO barcode_print_queue (
      tenant_id,
      product_id,
      color,
      color_key,
      image_url,
      thermal_image_url,
      error_message,
      status,
      source,
      label_count,
      variant_ids,
      printed_at,
      printed_by,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, NOW(), NOW())
    ON CONFLICT (tenant_id, product_id, color_key) WHERE status <> 'printed'
    DO UPDATE SET
      color = EXCLUDED.color,
      image_url = EXCLUDED.image_url,
      thermal_image_url = EXCLUDED.thermal_image_url,
      error_message = EXCLUDED.error_message,
      status = EXCLUDED.status,
      source = EXCLUDED.source,
      label_count = EXCLUDED.label_count,
      variant_ids = EXCLUDED.variant_ids,
      printed_at = EXCLUDED.printed_at,
      printed_by = EXCLUDED.printed_by,
      updated_at = NOW()
    RETURNING *
    `,
    [
      next.tenantId,
      next.productId,
      next.color,
      next.colorKey,
      next.imageUrl,
      next.thermalImageUrl,
      next.errorMessage,
      next.status,
      next.source,
      next.labelCount,
      JSON.stringify(next.variantIds),
      next.printedAt,
      next.printedBy,
    ]
  );
  const row = queueRowFromDb(result.rows[0] || {});
  console.log("BARCODE_PRINT_QUEUE_UPSERTED", {
    tenantId: row.tenant_id,
    productId: row.product_id,
    color: row.color,
    colorKey: row.color_key,
    status: row.status,
    source: row.source,
    labelCount: row.label_count,
    variantIds: row.variant_ids,
  });
  return { skipped: false, row };
};

export const listBarcodePrintQueueItems = async ({
  tenantId = null,
  includePrinted = false,
  productId = null,
  status = "",
} = {}) => {
  await ensureBarcodePrintQueueSchema();
  const values = [Number(tenantId) || null];
  const filters = ["q.tenant_id = $1"];
  if (!includePrinted) {
    filters.push("q.status <> 'printed'");
  }
  if (Number.isFinite(Number(productId)) && Number(productId) > 0) {
    values.push(Number(productId));
    filters.push(`q.product_id = $${values.length}`);
  }
  const requestedStatus = normalizeText(status).toLowerCase();
  if (requestedStatus && ["pending", "processing", "ready", "printed", "failed"].includes(requestedStatus)) {
    const normalizedStatus = normalizeStatus(requestedStatus);
    values.push(normalizedStatus);
    filters.push(`q.status = $${values.length}`);
  }
  const result = await db.query(
    `
    SELECT
      q.*,
      p.name AS product_name,
      p.image_url AS product_image_url,
      p.thermal_image_url AS product_thermal_image_url,
      p.thermal_image_status AS product_thermal_image_status
    FROM barcode_print_queue q
    LEFT JOIN products p
      ON p.id = q.product_id
     AND p.tenant_id = q.tenant_id
    WHERE ${filters.join(" AND ")}
    ORDER BY
      CASE q.status
        WHEN 'ready' THEN 0
        WHEN 'processing' THEN 1
        WHEN 'pending' THEN 2
        WHEN 'failed' THEN 3
        WHEN 'printed' THEN 4
        ELSE 4
      END,
      q.updated_at DESC,
      q.id DESC
    `,
    values
  );
  return (Array.isArray(result.rows) ? result.rows : []).map(queueRowFromDb);
};

export const markBarcodePrintQueuePrinted = async ({ id = null, tenantId = null, printedBy = null } = {}) => {
  await ensureBarcodePrintQueueSchema();
  const result = await db.query(
    `
    UPDATE barcode_print_queue
    SET status = 'printed',
        printed_at = NOW(),
        printed_by = $3,
        error_message = '',
        updated_at = NOW()
    WHERE id = $1
      AND tenant_id = $2
    RETURNING *
    `,
    [Number(id) || null, Number(tenantId) || null, printedBy === null || printedBy === undefined || printedBy === "" ? null : Number(printedBy) || null]
  );
  const row = result.rows[0] ? queueRowFromDb(result.rows[0]) : null;
  if (row) {
    console.log("BARCODE_PRINT_QUEUE_MARK_PRINTED", {
      id: row.id,
      tenantId: row.tenant_id,
      productId: row.product_id,
      colorKey: row.color_key,
      status: row.status,
      printedBy: row.printed_by,
    });
  }
  return row;
};

const BARCODE_QUEUE_REGENERATION_IN_FLIGHT = new Map();
const BARCODE_QUEUE_REGENERATION_TIMEOUT_MS = 15 * 60 * 1000;

const loadBarcodePrintQueueItemById = async ({ id = null, tenantId = null } = {}) => {
  const result = await db.query(
    `
    SELECT
      q.*,
      p.name AS product_name,
      p.image_url AS product_image_url,
      p.thermal_image_url AS product_thermal_image_url,
      p.thermal_image_status AS product_thermal_image_status
    FROM barcode_print_queue q
    LEFT JOIN products p
      ON p.id = q.product_id
     AND p.tenant_id = q.tenant_id
    WHERE q.id = $1
      AND q.tenant_id = $2
    LIMIT 1
    `,
    [Number(id) || null, Number(tenantId) || null]
  );
  return result.rows[0] ? queueRowFromDb(result.rows[0]) : null;
};

const syncThermalImageToVariantRows = async ({
  productId = null,
  tenantId = null,
  variantIds = [],
  thermalImageUrl = "",
} = {}) => {
  const ids = [...new Set((Array.isArray(variantIds) ? variantIds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))];
  const safeUrl = normalizeText(thermalImageUrl);
  if (!ids.length || !productId || !safeUrl) return 0;

  const generatedAt = new Date().toISOString();
  const hasTenantFilter = tenantId !== null && tenantId !== undefined && String(tenantId).trim() !== "";
  const result = await db.query(
    hasTenantFilter
      ? `
        UPDATE product_variants
        SET thermal_image_url = $1,
            thermal_image_status = 'ready',
            thermal_image_generated_at = $2,
            thermal_image_error = '',
            updated_at = NOW()
        WHERE product_id = $3
          AND id = ANY($4::bigint[])
          AND ($5::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $5::bigint)
        `
      : `
        UPDATE product_variants
        SET thermal_image_url = $1,
            thermal_image_status = 'ready',
            thermal_image_generated_at = $2,
            thermal_image_error = '',
            updated_at = NOW()
        WHERE product_id = $3
          AND id = ANY($4::bigint[])
        `,
    hasTenantFilter
      ? [safeUrl, generatedAt, productId, ids, Number(tenantId) || null]
      : [safeUrl, generatedAt, productId, ids]
  );
  return Number(result.rowCount || 0);
};

export const requeueBarcodePrintQueueItem = async ({ id = null, tenantId = null } = {}) => {
  await ensureBarcodePrintQueueSchema();
  const currentRow = await loadBarcodePrintQueueItemById({ id, tenantId });
  if (!currentRow) return null;

  const queueKey = `${currentRow.tenant_id || "tenant"}|${currentRow.product_id || "product"}|${currentRow.color_key || ""}`;
  if (BARCODE_QUEUE_REGENERATION_IN_FLIGHT.has(queueKey)) {
    console.log("BARCODE_QUEUE_REGENERATE_SKIPPED_DUPLICATE", {
      id: currentRow.id,
      tenantId: currentRow.tenant_id,
      productId: currentRow.product_id,
      colorKey: currentRow.color_key,
      status: currentRow.status,
    });
    return currentRow;
  }

  const processingResult = await upsertBarcodePrintQueueItem({
    tenantId: currentRow.tenant_id,
    productId: currentRow.product_id,
    color: currentRow.color,
    colorKey: currentRow.color_key,
    imageUrl: currentRow.image_url || currentRow.product_image_url || "",
    thermalImageUrl: currentRow.thermal_image_url || currentRow.product_thermal_image_url || "",
    status: "processing",
    source: currentRow.source || "thermal_ready",
    labelCount: currentRow.label_count,
    variantIds: currentRow.variant_ids,
    errorMessage: "",
  });
  const processingRow = processingResult?.row || currentRow;

  console.log("BARCODE_QUEUE_REGENERATE_STARTED", {
    id: processingRow.id,
    tenantId: processingRow.tenant_id,
    productId: processingRow.product_id,
    color: processingRow.color,
    colorKey: processingRow.color_key,
    imageUrl: processingRow.image_url,
    variantIds: processingRow.variant_ids,
  });

  const jobState = {
    finished: false,
    timedOut: false,
    timer: null,
  };

  const finalizeFailed = async (errorMessage = "") => {
    await upsertBarcodePrintQueueItem({
      tenantId: processingRow.tenant_id,
      productId: processingRow.product_id,
      color: processingRow.color,
      colorKey: processingRow.color_key,
      imageUrl: processingRow.image_url || processingRow.product_image_url || "",
      thermalImageUrl: currentRow.thermal_image_url || currentRow.product_thermal_image_url || "",
      status: "failed",
      source: processingRow.source || "thermal_ready",
      labelCount: processingRow.label_count,
      variantIds: processingRow.variant_ids,
      errorMessage,
    }).catch((queueError) => {
      console.warn("[barcode-print-queue] failed state sync failed", {
        id: processingRow.id,
        message: queueError?.message || String(queueError),
      });
    });
  };

  const job = (async () => {
    try {
      const { regenerateThermalImageForProductImage } = await import("./thermalArtworkService.js");
      const result = await regenerateThermalImageForProductImage({
        entityType: "product",
        productId: processingRow.product_id,
        tenantId: processingRow.tenant_id,
        sourceImageUrl: processingRow.image_url || processingRow.product_image_url || "",
        existingThermalImageUrl: currentRow.thermal_image_url || currentRow.product_thermal_image_url || "",
        productName: processingRow.product_name || currentRow.product_name || "",
        regenerate: true,
      });

      if (!result?.success || !result?.thermal_image_url) {
        const errorMessage = result?.error || "Thermal regeneration failed";
        await finalizeFailed(errorMessage);
        console.error("BARCODE_QUEUE_REGENERATE_FAILED", {
          id: processingRow.id,
          tenantId: processingRow.tenant_id,
          productId: processingRow.product_id,
          color: processingRow.color,
          colorKey: processingRow.color_key,
          message: errorMessage,
        });
        return {
          success: false,
          error: errorMessage,
        };
      }

      if (jobState.timedOut) {
        console.warn("BARCODE_QUEUE_REGENERATE_COMPLETED_AFTER_TIMEOUT", {
          id: processingRow.id,
          tenantId: processingRow.tenant_id,
          productId: processingRow.product_id,
          colorKey: processingRow.color_key,
          thermalImageUrl: result.thermal_image_url,
        });
        return result;
      }

      if (Array.isArray(processingRow.variant_ids) && processingRow.variant_ids.length) {
        await syncThermalImageToVariantRows({
          productId: processingRow.product_id,
          tenantId: processingRow.tenant_id,
          variantIds: processingRow.variant_ids,
          thermalImageUrl: result.thermal_image_url,
        });
      }

      const readyResult = await upsertBarcodePrintQueueItem({
        tenantId: processingRow.tenant_id,
        productId: processingRow.product_id,
        color: processingRow.color,
        colorKey: processingRow.color_key,
        imageUrl: processingRow.image_url || processingRow.product_image_url || "",
        thermalImageUrl: result.thermal_image_url,
        status: "ready",
        source: processingRow.source || "thermal_ready",
        labelCount: processingRow.label_count,
        variantIds: processingRow.variant_ids,
        errorMessage: "",
      });

      console.log("BARCODE_QUEUE_REGENERATE_COMPLETED", {
        id: readyResult?.row?.id || processingRow.id,
        tenantId: processingRow.tenant_id,
        productId: processingRow.product_id,
        color: processingRow.color,
        colorKey: processingRow.color_key,
        thermalImageUrl: result.thermal_image_url,
      });

      return result;
    } catch (error) {
      await finalizeFailed(error?.message || String(error));
      console.error("BARCODE_QUEUE_REGENERATE_FAILED", {
        id: processingRow.id,
        tenantId: processingRow.tenant_id,
        productId: processingRow.product_id,
        color: processingRow.color,
        colorKey: processingRow.color_key,
        message: error?.message || String(error),
        stack: error?.stack,
      });
      return {
        success: false,
        error: error?.message || String(error),
      };
    } finally {
      jobState.finished = true;
      if (jobState.timer) {
        clearTimeout(jobState.timer);
      }
      BARCODE_QUEUE_REGENERATION_IN_FLIGHT.delete(queueKey);
    }
  })();

  BARCODE_QUEUE_REGENERATION_IN_FLIGHT.set(queueKey, job);
  jobState.timer = setTimeout(() => {
    if (jobState.finished) return;
    jobState.timedOut = true;
    BARCODE_QUEUE_REGENERATION_IN_FLIGHT.delete(queueKey);
    void finalizeFailed("Thermal regeneration timed out").catch(() => {});
    console.error("BARCODE_QUEUE_REGENERATE_FAILED", {
      id: processingRow.id,
      tenantId: processingRow.tenant_id,
      productId: processingRow.product_id,
      color: processingRow.color,
      colorKey: processingRow.color_key,
      message: "Thermal regeneration timed out",
    });
  }, BARCODE_QUEUE_REGENERATION_TIMEOUT_MS);

  void job.catch((error) => {
    console.error("[barcode-print-queue] regeneration job uncaught error", {
      id: processingRow.id,
      message: error?.message || String(error),
      stack: error?.stack,
    });
  });

  return processingRow;
};

export const deleteBarcodePrintQueueItem = async ({ id = null, tenantId = null } = {}) => {
  await ensureBarcodePrintQueueSchema();
  const result = await db.query(
    `
    DELETE FROM barcode_print_queue
    WHERE id = $1
      AND tenant_id = $2
    RETURNING *
    `,
    [Number(id) || null, Number(tenantId) || null]
  );
  return result.rows[0] ? queueRowFromDb(result.rows[0]) : null;
};

export const findBarcodePrintQueueItemByProductColorKey = async ({ tenantId = null, productId = null, colorKey = "" } = {}) => {
  await ensureBarcodePrintQueueSchema();
  const result = await db.query(
    `
    SELECT *
    FROM barcode_print_queue
    WHERE tenant_id = $1
      AND product_id = $2
      AND color_key = $3
      AND status <> 'printed'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [Number(tenantId) || null, Number(productId) || null, normalizeText(colorKey).toLowerCase()]
  );
  return result.rows[0] ? queueRowFromDb(result.rows[0]) : null;
};

export { queueRowFromDb as normalizeBarcodePrintQueueRow };
