import db from "../database/db.js";
import { createEmployeePortalNotification } from "./employeePayrollPortalService.js";
import { emitToRooms } from "../utils/socket.js";

const clean = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};
const stockNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
const normalizeComparable = (value = "") =>
  clean(value).toLowerCase().replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ");

let schemaReadyPromise = null;

export const ensureDisplayRefillAlertSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise || clientOrPool !== db) {
    const run = async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS employee_display_refill_alerts (
          id BIGSERIAL PRIMARY KEY,
          employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          order_id BIGINT NULL,
          invoice_number VARCHAR(160) NULL,
          product_id BIGINT NULL,
          variant_id BIGINT NULL,
          product_name TEXT NOT NULL DEFAULT '',
          color_name VARCHAR(160) NOT NULL DEFAULT '',
          sold_size VARCHAR(80) NOT NULL DEFAULT '',
          replacement_size VARCHAR(80) NULL,
          remaining_stock INTEGER NOT NULL DEFAULT 0,
          image_url TEXT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'pending',
          is_read BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_at TIMESTAMP NULL,
          resolved_by_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
          CONSTRAINT employee_display_refill_alerts_status_check CHECK (status IN ('pending', 'resolved'))
        )
      `);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS employee_id BIGINT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS order_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(160) NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS product_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS variant_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS color_name VARCHAR(160) NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS sold_size VARCHAR(80) NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS replacement_size VARCHAR(80) NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS remaining_stock INTEGER NOT NULL DEFAULT 0`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS image_url TEXT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'pending'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS resolved_by_employee_id BIGINT NULL`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_display_refill_employee_status ON employee_display_refill_alerts (employee_id, status, is_read, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_display_refill_order ON employee_display_refill_alerts (order_id)`);
    };
    if (clientOrPool === db) schemaReadyPromise = run();
    else return run();
  }
  return schemaReadyPromise;
};

const parseSizeNumber = (value = "") => {
  const normalized = clean(value).replace(/[٠-٩۰-۹]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10));
  const parsed = Number(normalized.match(/\d+(?:\.\d+)?/)?.[0] || NaN);
  return Number.isFinite(parsed) ? parsed : null;
};

const variantImageFromRows = (rows = [], color = "") => {
  const normalizedColor = normalizeComparable(color);
  const sameColor = rows.find((row) => clean(row.variant_image_url) && (!normalizedColor || normalizeComparable(row.color) === normalizedColor));
  return clean(sameColor?.variant_image_url || rows.find((row) => clean(row.variant_image_url))?.variant_image_url);
};

const normalizeAlert = (row = {}) => ({
  id: row.id,
  employee_id: row.employee_id,
  order_id: row.order_id,
  invoice_number: row.invoice_number || "",
  product_id: row.product_id,
  variant_id: row.variant_id,
  product_name: row.product_name || "",
  color_name: row.color_name || "",
  sold_size: row.sold_size || "",
  replacement_size: row.replacement_size || null,
  remaining_stock: stockNumber(row.remaining_stock),
  image_url: row.image_url || "",
  status: row.status || "pending",
  is_read: Boolean(row.is_read),
  created_at: row.created_at,
  resolved_at: row.resolved_at || null,
  resolved_by_employee_id: row.resolved_by_employee_id || null,
});

const loadOrderItems = async ({ orderId, sellerEmployeeId } = {}) => {
  const result = await db.query(
    `
    SELECT
      o.id AS order_id,
      o.tenant_id,
      o.invoice_number,
      o.public_order_number,
      o.display_order_number,
      o.sales_employee_id AS order_sales_employee_id,
      oi.id AS order_item_id,
      oi.product_id,
      oi.variant_id,
      oi.product_name,
      COALESCE(NULLIF(oi.color, ''), NULLIF(pv.color, '')) AS color_name,
      COALESCE(NULLIF(oi.size, ''), NULLIF(pv.size, '')) AS sold_size,
      COALESCE(NULLIF(oi.variant_image, ''), NULLIF(pv.image_url, ''), NULLIF(sold_pvi.image_url, '')) AS sold_variant_image_url,
      COALESCE(NULLIF(oi.product_image, ''), NULLIF(p.image_url, '')) AS product_image_url
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN LATERAL (
      SELECT image_url
      FROM product_variant_images pvi
      WHERE pvi.product_id = oi.product_id
        AND NULLIF(pvi.image_url, '') IS NOT NULL
        AND (oi.variant_id IS NULL OR pvi.variant_id = oi.variant_id OR pvi.variant_id IS NULL)
      ORDER BY (pvi.variant_id = oi.variant_id) DESC, pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
      LIMIT 1
    ) sold_pvi ON TRUE
    WHERE oi.order_id = $1
      AND ($2::bigint IS NULL OR COALESCE(oi.sales_employee_id, o.sales_employee_id) = $2)
    `,
    [numberOrNull(orderId), numberOrNull(sellerEmployeeId)]
  );
  return result.rows;
};

const loadSameColorVariants = async ({ tenantId, productId, colorName } = {}) => {
  const result = await db.query(
    `
    SELECT
      pv.id,
      pv.product_id,
      pv.color,
      pv.size,
      COALESCE(pv.stock, 0) AS stock,
      COALESCE(NULLIF(pv.image_url, ''), NULLIF(pv.image, ''), NULLIF(pvi.image_url, '')) AS variant_image_url
    FROM product_variants pv
    LEFT JOIN LATERAL (
      SELECT image_url
      FROM product_variant_images pvi
      WHERE pvi.product_id = pv.product_id
        AND NULLIF(pvi.image_url, '') IS NOT NULL
        AND (pvi.variant_id = pv.id OR pvi.variant_id IS NULL)
        AND (NULLIF(pvi.color_name, '') IS NULL OR LOWER(pvi.color_name) = LOWER(COALESCE(pv.color, '')))
      ORDER BY (pvi.variant_id = pv.id) DESC, pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
      LIMIT 1
    ) pvi ON TRUE
    WHERE pv.product_id = $1
      AND ($2::bigint IS NULL OR pv.tenant_id = $2::bigint OR pv.tenant_id IS NULL)
      AND LOWER(COALESCE(pv.color, '')) = LOWER($3)
      AND COALESCE(pv.stock, 0) > 0
      AND COALESCE(pv.is_active, TRUE) = TRUE
      AND pv.deleted_at IS NULL
    `,
    [numberOrNull(productId), numberOrNull(tenantId), clean(colorName)]
  );
  return result.rows;
};

const resolveReplacementVariant = (variants = [], soldSize = "") => {
  const soldNumber = parseSizeNumber(soldSize);
  const sorted = variants
    .map((row) => ({ ...row, size_number: parseSizeNumber(row.size) }))
    .filter((row) => clean(row.size))
    .sort((a, b) => {
      if (a.size_number !== null && b.size_number !== null) return a.size_number - b.size_number;
      if (a.size_number !== null) return -1;
      if (b.size_number !== null) return 1;
      return clean(a.size).localeCompare(clean(b.size), "en");
    });
  if (soldNumber !== null) return sorted.find((row) => row.size_number !== null && row.size_number > soldNumber) || null;
  const soldIndex = sorted.findIndex((row) => normalizeComparable(row.size) === normalizeComparable(soldSize));
  return soldIndex >= 0 ? sorted[soldIndex + 1] || null : null;
};

const duplicateExists = async ({ employeeId, productId, colorName, soldSize, replacementSize } = {}) => {
  const result = await db.query(
    `
    SELECT id
    FROM employee_display_refill_alerts
    WHERE employee_id = $1
      AND COALESCE(product_id, 0) = COALESCE($2::bigint, 0)
      AND LOWER(COALESCE(color_name, '')) = LOWER($3::text)
      AND LOWER(COALESCE(sold_size, '')) = LOWER($4::text)
      AND COALESCE(LOWER(replacement_size), '') = COALESCE(LOWER($5::text), '')
      AND status = 'pending'
      AND created_at >= CURRENT_DATE
    LIMIT 1
    `,
    [numberOrNull(employeeId), numberOrNull(productId), clean(colorName), clean(soldSize), replacementSize ? clean(replacementSize) : null]
  );
  return result.rows[0] || null;
};

const insertAlert = async (alert = {}) => {
  const result = await db.query(
    `
    INSERT INTO employee_display_refill_alerts (
      employee_id, order_id, invoice_number, product_id, variant_id, product_name, color_name,
      sold_size, replacement_size, remaining_stock, image_url
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
    `,
    [
      numberOrNull(alert.employee_id),
      numberOrNull(alert.order_id),
      clean(alert.invoice_number),
      numberOrNull(alert.product_id),
      numberOrNull(alert.variant_id),
      clean(alert.product_name),
      clean(alert.color_name),
      clean(alert.sold_size),
      alert.replacement_size ? clean(alert.replacement_size) : null,
      stockNumber(alert.remaining_stock),
      clean(alert.image_url) || null,
    ]
  );
  return normalizeAlert(result.rows[0]);
};

export const createDisplayRefillAlertsForOrder = async ({ orderId, sellerEmployeeId } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const safeOrderId = numberOrNull(orderId);
  const safeEmployeeId = numberOrNull(sellerEmployeeId);
  console.info("[display-refill-alert:check]", { orderId: safeOrderId, sellerEmployeeId: safeEmployeeId });
  if (!safeOrderId || !safeEmployeeId) {
    console.info("[display-refill-alert:skipped]", { reason: "missing_order_or_seller", orderId, sellerEmployeeId });
    return [];
  }

  const items = await loadOrderItems({ orderId: safeOrderId, sellerEmployeeId: safeEmployeeId });
  const created = [];
  for (const item of items) {
    const colorName = clean(item.color_name);
    const soldSize = clean(item.sold_size);
    const productId = numberOrNull(item.product_id);
    if (!productId || !colorName || !soldSize) {
      console.info("[display-refill-alert:skipped]", { reason: "missing_product_color_or_size", orderId: safeOrderId, orderItemId: item.order_item_id });
      continue;
    }
    const variants = await loadSameColorVariants({ tenantId: item.tenant_id, productId, colorName });
    const replacement = resolveReplacementVariant(variants, soldSize);
    const replacementSize = replacement ? clean(replacement.size) : null;
    const duplicate = await duplicateExists({
      employeeId: safeEmployeeId,
      productId,
      colorName,
      soldSize,
      replacementSize,
    });
    if (duplicate) {
      console.info("[display-refill-alert:skipped]", { reason: "duplicate_pending_today", alertId: duplicate.id, productId, colorName, soldSize, replacementSize });
      continue;
    }

    const imageUrl = clean(item.sold_variant_image_url) ||
      variantImageFromRows(variants, colorName) ||
      clean(item.product_image_url);
    const invoiceNumber = clean(item.invoice_number || item.display_order_number || item.public_order_number || safeOrderId);
    const alert = await insertAlert({
      employee_id: safeEmployeeId,
      order_id: safeOrderId,
      invoice_number: invoiceNumber,
      product_id: productId,
      variant_id: replacement?.id || item.variant_id || null,
      product_name: item.product_name,
      color_name: colorName,
      sold_size: soldSize,
      replacement_size: replacementSize,
      remaining_stock: replacement?.stock || 0,
      image_url: imageUrl,
    });
    const body = replacementSize
      ? `اعرض مقاس ${replacementSize} بدل ${soldSize} من ${clean(item.product_name)} - ${colorName}`
      : `لا يوجد مقاس بديل متاح بعد بيع ${soldSize} من ${clean(item.product_name)} - ${colorName}`;
    await createEmployeePortalNotification({
      tenantId: item.tenant_id,
      employeeId: safeEmployeeId,
      type: "display_refill_alert",
      orderId: safeOrderId,
      invoiceNumber,
      title: "نواقص العرض",
      body,
      actionUrl: "",
      metadata: {
        tab: "display-refill",
        display_refill_alert_id: alert.id,
        product_id: productId,
        color_name: colorName,
        sold_size: soldSize,
        replacement_size: replacementSize,
        image_url: imageUrl,
      },
    }).catch((error) => console.warn("[display-refill-alert:notification-skipped]", { alertId: alert.id, message: error?.message || String(error) }));
    emitToRooms([`employee:${safeEmployeeId}`], "employee_portal:display_refill_alert", {
      alert,
      badge: { tag: "display_refill_alert", tab: "display-refill" },
      at: new Date().toISOString(),
    });
    console.info("[display-refill-alert:created]", {
      alertId: alert.id,
      employeeId: safeEmployeeId,
      orderId: safeOrderId,
      productId,
      colorName,
      soldSize,
      replacementSize,
      remainingStock: alert.remaining_stock,
    });
    created.push(alert);
  }
  return created;
};

export const listDisplayRefillAlertsForEmployee = async ({ employeeId, status = "pending", limit = 50 } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const params = [numberOrNull(employeeId)];
  const statusClause = clean(status) && clean(status) !== "all"
    ? (params.push(clean(status)), `AND status = $${params.length}`)
    : "";
  params.push(Math.max(1, Math.min(100, Number(limit || 50))));
  const result = await db.query(
    `
    SELECT *
    FROM employee_display_refill_alerts
    WHERE employee_id = $1
      ${statusClause}
    ORDER BY status ASC, created_at DESC, id DESC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows.map(normalizeAlert);
};

export const markDisplayRefillAlertRead = async ({ employeeId, alertId } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const result = await db.query(
    `
    UPDATE employee_display_refill_alerts
    SET is_read = TRUE
    WHERE id = $1
      AND employee_id = $2
    RETURNING *
    `,
    [numberOrNull(alertId), numberOrNull(employeeId)]
  );
  return result.rows[0] ? normalizeAlert(result.rows[0]) : null;
};

export const resolveDisplayRefillAlert = async ({ employeeId, alertId } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const result = await db.query(
    `
    UPDATE employee_display_refill_alerts
    SET status = 'resolved',
        is_read = TRUE,
        resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
        resolved_by_employee_id = $2
    WHERE id = $1
      AND employee_id = $2
    RETURNING *
    `,
    [numberOrNull(alertId), numberOrNull(employeeId)]
  );
  const alert = result.rows[0] ? normalizeAlert(result.rows[0]) : null;
  console.info("[display-refill-alert:resolved]", { alertId: numberOrNull(alertId), employeeId: numberOrNull(employeeId), found: Boolean(alert) });
  return alert;
};
