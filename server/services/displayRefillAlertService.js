import db from "../database/db.js";
import { createEmployeePortalNotification } from "./employeePayrollPortalService.js";
import { emitToRooms } from "../utils/socket.js";

const clean = (value = "") => String(value ?? "").trim();
const textOrNull = (value) => {
  const next = clean(value);
  return next || null;
};
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};
const stockNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
const normalizeTextComparable = (value = "") => clean(value).toLowerCase().replace(/\s+/g, " ").replace(/^eu\s+/i, "").replace(/^size\s+/i, "");
const normalizeSizeComparable = (value = "") => {
  const raw = clean(value);
  if (!raw) return "";
  const numeric = raw.match(/\d+(?:\.\d+)?/)?.[0];
  if (numeric) return numeric;
  return normalizeTextComparable(raw);
};
const sizeNumber = (value = "") => {
  const parsed = Number(String(value ?? "").match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
};
const normalizeColorComparable = (value = "") => normalizeTextComparable(value);
const normalizeComparable = (value = "") => normalizeTextComparable(value);
const normalizeStockValue = (row = {}) =>
  stockNumber(firstDefined(row.stock, row.quantity, row.stock_quantity, row.available_quantity, row.available_stock, row.current_stock, row.remaining_stock));
const normalizeSoldQuantity = (row = {}) => {
  const value = firstDefined(row.quantity, row.qty, row.sold_quantity, row.item_quantity, row.item_qty, row.count, row.amount);
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
};

const resolveDefaultTenantBranch = async (tenantId) => {
  const result = await db.query(
    `
    SELECT id
    FROM branches
    WHERE tenant_id = $1
      AND COALESCE(is_active, TRUE) = TRUE
      AND COALESCE(is_default, FALSE) = TRUE
    ORDER BY id ASC
    LIMIT 1
    `,
    [numberOrNull(tenantId)]
  );
  return numberOrNull(result.rows[0]?.id);
};

const resolveItemBranchId = async ({ item = {}, order = {}, tenantId = null, reqUser = null } = {}) => {
  const candidates = [
    ["item.branch_id", item.branch_id],
    ["order.branch_id", order.branch_id],
    ["req.user.branch_id", reqUser?.branch_id || reqUser?.branchId],
  ];
  for (const [source, value] of candidates) {
    const branchId = numberOrNull(value);
    if (branchId) {
      console.info("[display-refill-alert:branch-resolved]", { source, branch_id: branchId, tenant_id: numberOrNull(tenantId) });
      return branchId;
    }
  }
  const fallback = await resolveDefaultTenantBranch(tenantId);
  console.info("[display-refill-alert:branch-resolved]", {
    source: fallback ? "tenant.default_branch" : "unresolved",
    branch_id: fallback,
    tenant_id: numberOrNull(tenantId),
  });
  return fallback;
};

// Historical alerts created with the previous rule are intentionally not auto-deleted here.
// They cannot be safely reconstructed from current stock alone.
// Admin review SQL example:
// SELECT id, employee_id, order_id, product_id, color_name, sold_size, replacement_size, created_at
// FROM employee_display_refill_alerts
// WHERE status = 'pending'
// ORDER BY created_at DESC, id DESC;

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
          branch_id BIGINT NULL,
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
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL`);
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
      await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_display_refill_pending_active ON employee_display_refill_alerts (COALESCE(product_id, 0), COALESCE(branch_id, 0), LOWER(COALESCE(color_name, '')), LOWER(COALESCE(sold_size, ''))) WHERE status = 'pending'`);
    };
    if (clientOrPool === db) schemaReadyPromise = run();
    else return run();
  }
  return schemaReadyPromise;
};

const parseSizeNumber = (value = "") => {
  const normalized = clean(value).replace(/[^0-9.]+/g, " ");
  const parsed = Number(normalized.match(/\d+(?:\.\d+)?/)?.[0] || NaN);
  return Number.isFinite(parsed) ? parsed : null;
};

const variantImageFromRows = (rows = [], color = "") => {
  const normalizedColor = normalizeColorComparable(color);
  const sameColor = rows.find((row) => clean(row.variant_image_url) && (!normalizedColor || normalizeColorComparable(firstDefined(row.color, row.variant_color, row.color_name, row.product_color)) === normalizedColor));
  return clean(sameColor?.variant_image_url || rows.find((row) => clean(row.variant_image_url))?.variant_image_url);
};

const rowMatchesSoldVariant = (row = {}, soldVariantId = null, soldSize = "", soldColor = "", soldColorId = null) => {
  const rowVariantId = numberOrNull(row.id);
  if (soldVariantId && rowVariantId && rowVariantId === soldVariantId) return true;
  const rowColorId = numberOrNull(row.color_id);
  if (soldColorId && rowColorId && rowColorId === soldColorId) return true;
  const rowSize = normalizeSizeComparable(row.size);
  const soldSizeComparable = normalizeSizeComparable(soldSize);
  const rowColor = normalizeColorComparable(firstDefined(row.color, row.variant_color, row.color_name, row.product_color, row.product_variant_color));
  const soldColorComparable = normalizeColorComparable(soldColor);
  return Boolean(
    soldSizeComparable &&
      rowSize &&
      rowSize === soldSizeComparable &&
      (!soldColorComparable || !rowColor || rowColor === soldColorComparable)
  );
};

const normalizeAlert = (row = {}) => ({
  id: row.id,
  employee_id: row.employee_id,
  order_id: row.order_id,
  invoice_number: row.invoice_number || "",
  product_id: row.product_id,
  variant_id: row.variant_id,
  branch_id: row.branch_id,
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
      o.branch_id,
      o.sales_employee_id AS order_sales_employee_id,
      oi.id AS order_item_id,
      oi.product_id,
      oi.variant_id,
      COALESCE(oi.quantity, 1) AS sold_quantity,
      oi.product_name,
      COALESCE(NULLIF(oi.color, ''), NULLIF(oi.variant_color, ''), NULLIF(pv.color, ''), NULLIF(p.color, '')) AS color_name,
      COALESCE(NULLIF(oi.color_id::text, ''), NULLIF(pv.color_id::text, ''), NULLIF(p.color_id::text, '')) AS color_id,
      COALESCE(NULLIF(oi.size, ''), NULLIF(oi.variant_size, ''), NULLIF(pv.size, ''), NULLIF(p.size, '')) AS sold_size,
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
  console.info("[display-refill-alert:loaded-items]", {
    order_id: numberOrNull(orderId),
    items_count: result.rows.length,
  });
  return result.rows;
};

const loadSameColorVariants = async ({ tenantId, productId, colorName, soldColorId, branchId } = {}) => {
  const params = [numberOrNull(productId), numberOrNull(tenantId), clean(colorName), textOrNull(soldColorId)];
  const result = await db.query(
    `
    SELECT
      pv.id,
      pv.product_id,
      pv.color,
      pv.color AS variant_color,
      pv.color_id,
      pv.size,
      COALESCE(pv.stock, pv.quantity, pv.stock_quantity, pv.available_quantity, pv.current_stock, 0) AS stock,
      COALESCE(NULLIF(pv.image_url, ''), NULLIF(pv.image, ''), NULLIF(pvi.image_url, '')) AS variant_image_url
    FROM product_variants pv
    LEFT JOIN products p ON p.id = pv.product_id
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
      AND ($5::bigint IS NULL OR pv.branch_id = $5::bigint OR pv.branch_id IS NULL)
      AND (
        LOWER(TRIM(COALESCE(pv.color, ''))) = LOWER(TRIM($3))
        OR LOWER(TRIM(COALESCE(p.color, ''))) = LOWER(TRIM($3))
        OR ($4::text IS NOT NULL AND NULLIF(pv.color_id, 0)::text = $4::text)
      )
      AND COALESCE(pv.is_active, TRUE) = TRUE
      AND pv.deleted_at IS NULL
    `,
    [...params, numberOrNull(branchId)]
  );
  return result.rows;
};

const sortVariantsBySize = (variants = []) =>
  [...variants]
    .map((row) => ({
      ...row,
      size_number: parseSizeNumber(row.size),
      size_comparable: normalizeSizeComparable(row.size),
      stock: normalizeStockValue(row),
    }))
    .filter((row) => clean(row.size))
    .sort((a, b) => {
      if (a.size_number !== null && b.size_number !== null) return a.size_number - b.size_number;
      if (a.size_number !== null) return -1;
      if (b.size_number !== null) return 1;
      return clean(a.size).localeCompare(clean(b.size), "en");
    });

const availableSizesForVariants = (variants = []) =>
  sortVariantsBySize(variants)
    .filter((row) => normalizeStockValue(row) > 0)
    .map((row) => clean(row.size))
    .filter(Boolean);

const duplicateExists = async ({ employeeId, productId, branchId, colorName, size } = {}) => {
  const result = await db.query(
    `
    SELECT id
    FROM employee_display_refill_alerts
    WHERE employee_id = $1
      AND COALESCE(product_id, 0) = COALESCE($2::bigint, 0)
      AND COALESCE(branch_id, 0) = COALESCE($3::bigint, 0)
      AND LOWER(COALESCE(color_name, '')) = LOWER($4::text)
      AND LOWER(COALESCE(sold_size, '')) = LOWER($5::text)
      AND status = 'pending'
    LIMIT 1
    `,
    [numberOrNull(employeeId), numberOrNull(productId), numberOrNull(branchId), clean(colorName), clean(size)]
  );
  return result.rows[0] || null;
};

const insertAlert = async (alert = {}) => {
  try {
    const result = await db.query(
      `
      INSERT INTO employee_display_refill_alerts (
        employee_id, order_id, invoice_number, product_id, variant_id, product_name, color_name,
        sold_size, replacement_size, remaining_stock, image_url, branch_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
        numberOrNull(alert.branch_id),
      ]
    );
    return normalizeAlert(result.rows[0]);
  } catch (error) {
    console.error("[display-refill-alert:insert:error]", {
      product_id: numberOrNull(alert.product_id),
      variant_id: numberOrNull(alert.variant_id),
      branch_id: numberOrNull(alert.branch_id),
      color: clean(alert.color_name),
      size: clean(alert.replacement_size || alert.sold_size),
      message: error?.message || String(error),
      code: error?.code || "",
      detail: error?.detail || "",
    });
    throw error;
  }
};

export const createDisplayRefillAlertsForOrder = async ({ orderId, sellerEmployeeId, tenantId = null, order = null, items: providedItems = [], req = null } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const safeOrderId = numberOrNull(orderId);
  const safeEmployeeId = numberOrNull(sellerEmployeeId);
  const safeTenantId = numberOrNull(tenantId || order?.tenant_id);
  console.info("[display-refill-alert:service-entered]", {
    order_id: safeOrderId,
    seller_employee_id: safeEmployeeId,
    tenant_id: safeTenantId,
    items_count: providedItems.length || null,
  });
  if (!safeOrderId || !safeEmployeeId) {
    console.info("[display-refill-alert:skipped]", { reason: "missing_order_or_seller", orderId, sellerEmployeeId });
    return [];
  }

  const items = providedItems.length ? providedItems : await loadOrderItems({ orderId: safeOrderId, sellerEmployeeId: safeEmployeeId });
  const created = [];
  for (const item of items) {
    const colorName = clean(firstDefined(item.color_name, item.color, item.variant_color));
    const soldSize = clean(firstDefined(item.sold_size, item.size, item.variant_size));
    const productId = numberOrNull(item.product_id);
    const soldQuantity = normalizeSoldQuantity(item);
    const soldVariantId = numberOrNull(item.variant_id);
    const soldColorId = numberOrNull(item.color_id);
    const branchId = await resolveItemBranchId({ item, order: order || item, tenantId: safeTenantId || item.tenant_id, reqUser: req?.user || null });
    const baseDecision = {
      order_id: safeOrderId,
      product_id: productId,
      variant_id: soldVariantId,
      branch_id: branchId,
      color: colorName || null,
      sold_size: soldSize || null,
      stock_before: null,
      stock_after: null,
    };

    if (!productId || (!colorName && !soldColorId) || !soldSize) {
      console.info("[display-refill-alert:decision-input]", { ...baseDecision });
      console.info("[display-refill-alert:decision-result]", {
        product_id: productId,
        color: colorName || null,
        sold_size: soldSize || null,
        smallest_available_size: null,
        next_display_size: null,
        should_create_alert: false,
        reason: "missing_product_color_or_size",
      });
      console.info("[display-refill-alert:skipped]", { product_id: productId, color: colorName || null, sold_size: soldSize || null, reason: "missing_product_color_or_size" });
      continue;
    }

    const variants = await loadSameColorVariants({ tenantId: safeTenantId || item.tenant_id, productId, colorName, soldColorId, branchId });
    const sortedVariants = sortVariantsBySize(variants);
    const soldVariant = sortedVariants.find((row) => rowMatchesSoldVariant(row, soldVariantId, soldSize, colorName, soldColorId)) || null;
    const soldVariantStockAfter = stockNumber(soldVariant?.stock);
    const stockBefore = soldVariant ? soldVariantStockAfter + soldQuantity : null;
    const availableAfterSale = availableSizesForVariants(sortedVariants);
    const smallestAvailable = availableAfterSale[0] || null;
    const soldSizeComparable = normalizeSizeComparable(soldSize);
    const smallestComparable = normalizeSizeComparable(smallestAvailable || "");
    let nextDisplaySize = null;
    let shouldCreateAlert = false;
    let reason = "no_available_sizes";

    console.info("[display-refill-alert:decision-input]", {
      order_id: safeOrderId,
      product_id: productId,
      variant_id: soldVariantId,
      branch_id: branchId,
      sold_size: soldSize,
      color: colorName || null,
      stock_before: stockBefore,
      stock_after: soldVariantStockAfter,
    });
    console.info("[display-refill-alert:stock-state]", {
      product_id: productId,
      branch_id: branchId,
      color: colorName || null,
      sold_size: soldSize,
      available_sizes: availableAfterSale,
    });

    if (!smallestAvailable) {
      console.info("[display-refill-alert:decision-result]", {
        product_id: productId,
        color: colorName || null,
        sold_size: soldSize,
        smallest_available_size: null,
        next_display_size: null,
        should_create_alert: false,
        reason: "no_available_sizes",
      });
      console.info("[display-refill-alert:skipped]", { product_id: productId, color: colorName || null, sold_size: soldSize, reason: "no_available_sizes" });
      continue;
    }

    if (soldSizeComparable === smallestComparable) {
      shouldCreateAlert = true;
      nextDisplaySize = soldVariantStockAfter > 0 ? soldSize : availableAfterSale.find((size) => normalizeSizeComparable(size) !== soldSizeComparable) || null;
      reason = soldVariantStockAfter > 0 ? "smallest_size_still_in_stock" : "smallest_size_sold_next_available";
    } else {
      const soldSizeHasNoSmallerAvailable = !availableAfterSale.some((size) => {
        const comparable = normalizeSizeComparable(size);
        const numericLeft = sizeNumber(size);
        const numericSold = sizeNumber(soldSize);
        if (numericLeft !== null && numericSold !== null) return numericLeft < numericSold;
        return comparable && soldSizeComparable && comparable < soldSizeComparable;
      });
      if (soldSizeHasNoSmallerAvailable) {
        shouldCreateAlert = true;
        nextDisplaySize = smallestAvailable;
        reason = "no_smaller_size_available";
      } else {
        reason = "smaller_size_still_available";
      }
    }

    if (!shouldCreateAlert && soldVariantStockAfter > 0 && smallestComparable && soldSizeComparable && (sizeNumber(soldSize) || 0) <= (sizeNumber(smallestAvailable) || Infinity)) {
      shouldCreateAlert = true;
      nextDisplaySize = soldSize;
      reason = "sold_size_has_stock";
    }

    console.info("[display-refill-alert:decision-result]", {
      product_id: productId,
      color: colorName || null,
      sold_size: soldSize,
      smallest_available_size: smallestAvailable,
      next_display_size: nextDisplaySize,
      should_create_alert: shouldCreateAlert,
      reason,
    });

    if (!shouldCreateAlert || !nextDisplaySize) {
      console.info("[display-refill-alert:skipped]", { product_id: productId, color: colorName || null, sold_size: soldSize, reason });
      continue;
    }

    const duplicate = await duplicateExists({
      employeeId: safeEmployeeId,
      productId,
      branchId,
      colorName,
      size: nextDisplaySize,
    });
    if (duplicate) {
      console.info("[display-refill-alert:skipped]", { product_id: productId, color: colorName || null, sold_size: soldSize, reason: "duplicate_pending_active" });
      continue;
    }

    const imageUrl = clean(item.sold_variant_image_url) || variantImageFromRows(sortedVariants, colorName) || clean(item.product_image_url);
    const invoiceNumber = clean(item.invoice_number || item.display_order_number || item.public_order_number || safeOrderId);
    const alert = await insertAlert({
      employee_id: safeEmployeeId,
      order_id: safeOrderId,
      invoice_number: invoiceNumber,
      product_id: productId,
      variant_id: soldVariantId || item.variant_id || null,
      branch_id: branchId,
      product_name: item.product_name,
      color_name: colorName,
      sold_size: soldSize,
      replacement_size: nextDisplaySize,
      remaining_stock: soldVariantStockAfter,
      image_url: imageUrl,
    });

    const body = `ط§ط¹ط±ط¶ ${nextDisplaySize} ط¨ط¯ظ„ ${soldSize} ظ…ظ† ${clean(item.product_name)} - ${colorName}`;
    await createEmployeePortalNotification({
      tenantId: item.tenant_id,
      employeeId: safeEmployeeId,
      type: "display_refill_alert",
      orderId: safeOrderId,
      invoiceNumber,
      title: "تنبيه إعادة العرض",
      body,
      actionUrl: "",
      metadata: {
        tab: "display-refill",
        display_refill_alert_id: alert.id,
        product_id: productId,
        color_name: colorName,
        sold_size: soldSize,
        replacement_size: nextDisplaySize,
        image_url: imageUrl,
      },
    }).catch((error) => console.warn("[display-refill-alert:notification-skipped]", { alertId: alert.id, message: error?.message || String(error) }));

    emitToRooms([`employee:${safeEmployeeId}`], "employee_portal:display_refill_alert", {
      alert,
      badge: { tag: "display_refill_alert", tab: "display-refill" },
      at: new Date().toISOString(),
    });

    console.info("[display-refill-alert:created]", {
      alert_id: alert.id,
      product_id: productId,
      color: colorName,
      branch_id: branchId,
      size: nextDisplaySize,
    });
    created.push(alert);
  }
  return created;
};

export const listDisplayRefillAlertsForEmployee = async ({ employeeId, branchId = null, status = "pending", limit = 50 } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const params = [numberOrNull(employeeId), numberOrNull(branchId)];
  const branchClause = numberOrNull(branchId) ? `AND ($2::bigint IS NULL OR branch_id = $2::bigint OR branch_id IS NULL)` : "";
  const statusClause = clean(status) && clean(status) !== "all"
    ? (params.push(clean(status)), `AND status = $${params.length}`)
    : "";
  params.push(Math.max(1, Math.min(100, Number(limit || 50))));
  const result = await db.query(
    `
    SELECT *
    FROM employee_display_refill_alerts
    WHERE employee_id = $1
      ${branchClause}
      ${statusClause}
    ORDER BY status ASC, created_at DESC, id DESC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows.map(normalizeAlert);
};

export const listRecentDisplayRefillAlerts = async ({ limit = 20 } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  const result = await db.query(
    `
    SELECT *
    FROM employee_display_refill_alerts
    ORDER BY created_at DESC, id DESC
    LIMIT $1
    `,
    [safeLimit]
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

