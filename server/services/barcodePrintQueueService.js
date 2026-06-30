import db from "../database/db.js";

const normalizeText = (value = "") => String(value ?? "").trim();

const normalizeStatus = (value = "") => {
  const status = normalizeText(value).toLowerCase();
  return ["pending", "ready", "printed", "failed"].includes(status) ? status : "pending";
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
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          printed_at TIMESTAMP NULL,
          printed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL
        )
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
      status,
      source,
      label_count,
      variant_ids,
      printed_at,
      printed_by,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, NOW(), NOW())
    ON CONFLICT (tenant_id, product_id, color_key) WHERE status <> 'printed'
    DO UPDATE SET
      color = EXCLUDED.color,
      image_url = EXCLUDED.image_url,
      thermal_image_url = EXCLUDED.thermal_image_url,
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
  if (requestedStatus && ["pending", "ready", "printed", "failed"].includes(requestedStatus)) {
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
        WHEN 'pending' THEN 1
        WHEN 'failed' THEN 2
        WHEN 'printed' THEN 3
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

export const requeueBarcodePrintQueueItem = async ({ id = null, tenantId = null } = {}) => {
  await ensureBarcodePrintQueueSchema();
  const result = await db.query(
    `
    UPDATE barcode_print_queue
    SET status = 'pending',
        printed_at = NULL,
        printed_by = NULL,
        updated_at = NOW()
    WHERE id = $1
      AND tenant_id = $2
    RETURNING *
    `,
    [Number(id) || null, Number(tenantId) || null]
  );
  return result.rows[0] ? queueRowFromDb(result.rows[0]) : null;
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

export { queueRowFromDb as normalizeBarcodePrintQueueRow };
