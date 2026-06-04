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
const stockNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
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
const normalizeColorComparable = (value = "") => normalizeTextComparable(value);
const normalizeComparable = (value = "") => normalizeTextComparable(value);
const normalizeStockValue = (row = {}) =>
  stockNumber(firstDefined(row.stock, row.quantity, row.stock_quantity, row.available_quantity, row.available_stock, row.current_stock, row.remaining_stock));
const normalizeSoldQuantity = (row = {}) => {
  const value = firstDefined(row.quantity, row.qty, row.sold_quantity, row.item_quantity, row.item_qty, row.count, row.amount);
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
};
const tableColumnCache = new Map();
const getTableColumns = async (tableName) => {
  if (tableColumnCache.has(tableName)) return tableColumnCache.get(tableName);
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnCache.set(tableName, columns);
  return columns;
};
const textColumnTerms = (alias, columns, candidates = []) =>
  candidates.filter((column) => columns.has(column)).map((column) => `NULLIF(${alias}.${column}::text, '')`);
const textCoalesceSql = (terms = [], fallback = "NULL::text") => (terms.length ? `COALESCE(${terms.join(", ")})` : fallback);
const numericCoalesceSql = (alias, columns, candidates = [], fallback = "0") => {
  const terms = candidates.filter((column) => columns.has(column)).map((column) => `NULLIF(${alias}.${column}::text, '')::numeric`);
  return terms.length ? `COALESCE(${terms.join(", ")}, ${fallback})` : fallback;
};
const variantScopeSql = ({ variantColumns, productColumns, tenantParam = "$2", productParam = "$3", branchParam = null } = {}) => {
  const tenantConditions = [];
  if (variantColumns.has("tenant_id")) {
    tenantConditions.push(`pv.tenant_id = ${tenantParam}::bigint`, "pv.tenant_id IS NULL");
  }
  if (productColumns.has("tenant_id")) tenantConditions.push(`p.tenant_id = ${tenantParam}::bigint`);
  return [
    tenantConditions.length ? `AND (${tenantParam}::bigint IS NULL OR ${tenantConditions.join(" OR ")})` : "",
    productParam && variantColumns.has("product_id") ? `AND (${productParam}::bigint IS NULL OR pv.product_id = ${productParam}::bigint)` : "",
    branchParam && variantColumns.has("branch_id") ? `AND (${branchParam}::bigint IS NULL OR pv.branch_id = ${branchParam}::bigint OR pv.branch_id IS NULL)` : "",
    variantColumns.has("is_active") ? "AND COALESCE(pv.is_active, TRUE) = TRUE" : "",
    variantColumns.has("deleted_at") ? "AND pv.deleted_at IS NULL" : "",
  ]
    .filter(Boolean)
    .join("\n      ");
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
// SELECT id, tenant_id, branch_id, employee_id, order_id, product_id, color_name, sold_size, replacement_size, created_at
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
          tenant_id BIGINT NULL,
          employee_id BIGINT NULL REFERENCES employees(id) ON DELETE CASCADE,
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
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ADD COLUMN IF NOT EXISTS employee_id BIGINT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS employee_display_refill_alerts ALTER COLUMN employee_id DROP NOT NULL`);
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
      await clientOrPool.query(`
        UPDATE employee_display_refill_alerts a
        SET tenant_id = COALESCE(
          a.tenant_id,
          (SELECT o.tenant_id FROM orders o WHERE o.id = a.order_id LIMIT 1),
          (SELECT e.tenant_id FROM employees e WHERE e.id = a.employee_id LIMIT 1)
        )
        WHERE a.tenant_id IS NULL
      `);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_display_refill_employee_status ON employee_display_refill_alerts (employee_id, status, is_read, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_display_refill_tenant_branch_status ON employee_display_refill_alerts (tenant_id, branch_id, status, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_display_refill_order ON employee_display_refill_alerts (order_id)`);
      await clientOrPool.query(`DROP INDEX IF EXISTS uq_display_refill_pending_active`);
      await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_display_refill_pending_active ON employee_display_refill_alerts (COALESCE(tenant_id, 0), COALESCE(product_id, 0), COALESCE(branch_id, 0), LOWER(COALESCE(color_name, '')), LOWER(COALESCE(sold_size, ''))) WHERE status = 'pending'`);
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
  tenant_id: row.tenant_id,
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
  const [orderItemColumns, variantColumns, productColumns] = await Promise.all([
    getTableColumns("order_items"),
    getTableColumns("product_variants"),
    getTableColumns("products"),
  ]);
  const colorNameSql = textCoalesceSql([
    ...textColumnTerms("oi", orderItemColumns, ["color", "selected_color", "variant_color", "color_name"]),
    ...textColumnTerms("pv", variantColumns, ["color", "color_name", "selected_color", "variant_color"]),
    ...textColumnTerms("p", productColumns, ["color", "color_name", "selected_color", "variant_color"]),
  ]);
  const colorIdSql = orderItemColumns.has("color_id") ? "NULLIF(oi.color_id::text, '')" : "NULL::text";
  const soldSizeSql = textCoalesceSql([
    ...textColumnTerms("oi", orderItemColumns, ["size", "selected_size", "variant_size", "sold_size"]),
    ...textColumnTerms("pv", variantColumns, ["size", "size_name", "selected_size", "variant_size"]),
    ...textColumnTerms("p", productColumns, ["size", "size_name", "selected_size", "fixed_size_label"]),
  ]);
  const soldVariantImageSql = textCoalesceSql([
    ...textColumnTerms("oi", orderItemColumns, ["variant_image", "variant_image_url", "image_url"]),
    ...textColumnTerms("pv", variantColumns, ["image_url", "image", "variant_image_url"]),
    "NULLIF(sold_pvi.image_url::text, '')",
  ]);
  const productImageSql = textCoalesceSql([
    ...textColumnTerms("oi", orderItemColumns, ["product_image", "product_image_url"]),
    ...textColumnTerms("p", productColumns, ["image_url", "image"]),
  ]);
  const sellerEmployeeSql = orderItemColumns.has("sales_employee_id")
    ? "AND ($2::bigint IS NULL OR COALESCE(oi.sales_employee_id, o.sales_employee_id) = $2)"
    : "AND ($2::bigint IS NULL OR o.sales_employee_id = $2)";
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
      ${colorNameSql} AS color_name,
      ${colorIdSql} AS color_id,
      ${soldSizeSql} AS sold_size,
      ${soldVariantImageSql} AS sold_variant_image_url,
      ${productImageSql} AS product_image_url
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    LEFT JOIN products p ON p.id = COALESCE(oi.product_id, pv.product_id)
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
      ${sellerEmployeeSql}
    `,
    [numberOrNull(orderId), numberOrNull(sellerEmployeeId)]
  );
  console.info("[display-refill-alert:loaded-items]", {
    order_id: numberOrNull(orderId),
    items_count: result.rows.length,
  });
  return result.rows;
};

const loadVariantFallbackById = async ({ variantId, tenantId = null, productId = null } = {}) => {
  const safeVariantId = numberOrNull(variantId);
  if (!safeVariantId) return null;
  const [variantColumns, productColumns] = await Promise.all([
    getTableColumns("product_variants"),
    getTableColumns("products"),
  ]);
  const variantColorTerms = textColumnTerms("pv", variantColumns, ["color", "color_name", "selected_color", "variant_color"]);
  const variantSizeTerms = textColumnTerms("pv", variantColumns, ["size", "size_name", "selected_size", "variant_size"]);
  const variantImageTerms = textColumnTerms("pv", variantColumns, ["image_url", "image", "variant_image_url"]);
  const colorNameSql = textCoalesceSql([
    ...variantColorTerms,
    ...textColumnTerms("p", productColumns, ["color", "color_name", "selected_color", "variant_color"]),
  ]);
  const soldSizeSql = textCoalesceSql([
    ...variantSizeTerms,
    ...textColumnTerms("p", productColumns, ["size", "size_name", "selected_size", "fixed_size_label"]),
  ]);
  const scopeSql = variantScopeSql({ variantColumns, productColumns });
  const result = await db.query(
    `
    SELECT
      pv.id,
      pv.product_id,
      ${colorNameSql} AS color_name,
      ${textCoalesceSql(variantColorTerms)} AS variant_color,
      ${soldSizeSql} AS sold_size,
      ${textCoalesceSql(variantSizeTerms)} AS variant_size,
      ${numericCoalesceSql("pv", variantColumns, ["stock", "quantity", "stock_quantity", "available_quantity", "current_stock"])} AS stock,
      ${textCoalesceSql(variantImageTerms)} AS variant_image_url
    FROM product_variants pv
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE pv.id = $1
      ${scopeSql}
    LIMIT 1
    `,
    [safeVariantId, numberOrNull(tenantId), numberOrNull(productId)]
  );
  return result.rows[0] || null;
};

const loadSameColorVariants = async ({ tenantId, productId, colorName, branchId = null } = {}) => {
  const [variantColumns, productColumns] = await Promise.all([
    getTableColumns("product_variants"),
    getTableColumns("products"),
  ]);
  const variantColorTerms = textColumnTerms("pv", variantColumns, ["color", "color_name", "selected_color", "variant_color"]);
  const productColorTerms = textColumnTerms("p", productColumns, ["color", "color_name", "selected_color", "variant_color"]);
  const variantSizeTerms = textColumnTerms("pv", variantColumns, ["size", "size_name", "selected_size", "variant_size"]);
  const variantColorSql = textCoalesceSql(variantColorTerms);
  const colorCompareSql = [...variantColorTerms, ...productColorTerms].length
    ? `LOWER(TRIM(${textCoalesceSql([...variantColorTerms, ...productColorTerms], "''::text")})) = LOWER(TRIM($3::text))`
    : "FALSE";
  const scopeSql = variantScopeSql({ variantColumns, productColumns, productParam: null, branchParam: "$4" });
  const params = [numberOrNull(productId), numberOrNull(tenantId), clean(colorName), numberOrNull(branchId)];
  const result = await db.query(
    `
    SELECT
      pv.id,
      pv.product_id,
      ${variantColorSql} AS color,
      ${variantColorSql} AS variant_color,
      NULL::bigint AS color_id,
      ${textCoalesceSql(variantSizeTerms)} AS size,
      ${numericCoalesceSql("pv", variantColumns, ["stock", "quantity", "stock_quantity", "available_quantity", "current_stock"])} AS stock,
      ${textCoalesceSql([...textColumnTerms("pv", variantColumns, ["image_url", "image", "variant_image_url"]), "NULLIF(pvi.image_url::text, '')"])} AS variant_image_url
    FROM product_variants pv
    LEFT JOIN products p ON p.id = pv.product_id
    LEFT JOIN LATERAL (
      SELECT image_url
      FROM product_variant_images pvi
      WHERE pvi.product_id = pv.product_id
        AND NULLIF(pvi.image_url, '') IS NOT NULL
        AND (pvi.variant_id = pv.id OR pvi.variant_id IS NULL)
        AND (NULLIF(pvi.color_name, '') IS NULL OR LOWER(pvi.color_name) = LOWER(COALESCE(${variantColorSql}, '')))
      ORDER BY (pvi.variant_id = pv.id) DESC, pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
      LIMIT 1
    ) pvi ON TRUE
    WHERE pv.product_id = $1
      ${scopeSql}
      AND (${colorCompareSql})
    `,
    params
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

const duplicateExists = async ({ tenantId, productId, branchId, colorName, soldSize } = {}) => {
  const result = await db.query(
    `
    SELECT id
    FROM employee_display_refill_alerts
    WHERE COALESCE(tenant_id, 0) = COALESCE($1::bigint, 0)
      AND COALESCE(product_id, 0) = COALESCE($2::bigint, 0)
      AND COALESCE(branch_id, 0) = COALESCE($3::bigint, 0)
      AND LOWER(COALESCE(color_name, '')) = LOWER($4::text)
      AND LOWER(COALESCE(sold_size, '')) = LOWER($5::text)
      AND status = 'pending'
    LIMIT 1
    `,
    [numberOrNull(tenantId), numberOrNull(productId), numberOrNull(branchId), clean(colorName), clean(soldSize)]
  );
  return result.rows[0] || null;
};

const loadBranchEmployeeNotificationTargets = async ({ tenantId, branchId, sellerEmployeeId, limit = 100 } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeBranchId = numberOrNull(branchId);
  const safeSellerEmployeeId = numberOrNull(sellerEmployeeId);
  if (!safeBranchId && !safeSellerEmployeeId) return [];
  const result = await db.query(
    `
    SELECT id
    FROM employees
    WHERE COALESCE(is_deleted, FALSE) = FALSE
      AND LOWER(COALESCE(status, 'active')) = 'active'
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
      AND (
        ($2::bigint IS NOT NULL AND branch_id = $2::bigint)
        OR ($3::bigint IS NOT NULL AND id = $3::bigint)
      )
    ORDER BY CASE WHEN id = $3::bigint THEN 0 ELSE 1 END, id ASC
    LIMIT $4
    `,
    [safeTenantId, safeBranchId, safeSellerEmployeeId, Math.max(1, Math.min(200, Number(limit || 100)))]
  );
  return result.rows.map((row) => numberOrNull(row.id)).filter(Boolean);
};

const insertAlert = async (alert = {}) => {
  try {
    const result = await db.query(
      `
      INSERT INTO employee_display_refill_alerts (
        tenant_id, employee_id, order_id, invoice_number, product_id, variant_id, product_name, color_name,
        sold_size, replacement_size, remaining_stock, image_url, branch_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
      `,
      [
        numberOrNull(alert.tenant_id),
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
      tenant_id: numberOrNull(alert.tenant_id),
      employee_id: numberOrNull(alert.employee_id),
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
  if (!safeOrderId) {
    console.info("[display-refill-alert:skipped]", { reason: "missing_order", order_id: orderId, seller_employee_id: sellerEmployeeId, tenant_id: safeTenantId });
    return [];
  }

  const items = providedItems.length ? providedItems : await loadOrderItems({ orderId: safeOrderId, sellerEmployeeId: safeEmployeeId });
  const created = [];
  for (const item of items) {
    let colorName = clean(firstDefined(item.color_name, item.color, item.selected_color, item.selectedColor, item.variant_color, item.variantColor));
    let soldSize = clean(firstDefined(item.sold_size, item.size, item.selected_size, item.selectedSize, item.variant_size, item.variantSize));
    let productId = numberOrNull(item.product_id);
    const soldQuantity = normalizeSoldQuantity(item);
    const soldVariantId = numberOrNull(item.variant_id);
    let soldColorId = numberOrNull(item.color_id);
    const itemTenantId = safeTenantId || numberOrNull(item.tenant_id);
    const branchId = await resolveItemBranchId({ item, order: order || item, tenantId: itemTenantId, reqUser: req?.user || null });
    console.info("[display-refill-alert:service-item-input]", {
      tenant_id: itemTenantId,
      order_id: safeOrderId,
      product_id: productId,
      variant_id: soldVariantId,
      size: item.size || null,
      color: item.color || null,
      selected_size: item.selected_size || item.selectedSize || null,
      selected_color: item.selected_color || item.selectedColor || null,
      variant_size: item.variant_size || item.variantSize || null,
      variant_color: item.variant_color || item.variantColor || null,
    });
    if (soldVariantId && (!productId || (!colorName && !soldColorId) || !soldSize)) {
      const fallback = await loadVariantFallbackById({ variantId: soldVariantId, tenantId: itemTenantId, productId });
      productId = productId || numberOrNull(fallback?.product_id);
      colorName = colorName || clean(firstDefined(fallback?.color_name, fallback?.variant_color));
      soldSize = soldSize || clean(firstDefined(fallback?.sold_size, fallback?.variant_size));
      soldColorId = soldColorId || numberOrNull(fallback?.color_id);
      console.info("[display-refill-alert:variant-fallback]", {
        variant_id: soldVariantId,
        product_id: productId,
        resolved_size: soldSize || null,
        resolved_color: colorName || null,
        found: Boolean(fallback),
      });
    }
    const baseDecision = {
      tenant_id: itemTenantId,
      order_id: safeOrderId,
      product_id: productId,
      variant_id: soldVariantId,
      branch_id: branchId,
      sold_quantity: soldQuantity,
      color: colorName || null,
      sold_size: soldSize || null,
      display_quantity_before: null,
      display_quantity_after: null,
    };

    if (!productId || (!colorName && !soldColorId) || !soldSize) {
      console.info("[display-refill-alert:decision-input]", { ...baseDecision });
      console.info("[display-refill-alert:decision-result]", {
        ...baseDecision,
        product_id: productId,
        color: colorName || null,
        sold_size: soldSize || null,
        smallest_available_size: null,
        next_display_size: null,
        should_create_alert: false,
        reason: "missing_product_color_or_size",
      });
      console.info("[display-refill-alert:skipped]", { ...baseDecision, reason: "missing_product_color_or_size" });
      continue;
    }

    if (!branchId && !safeEmployeeId) {
      console.info("[display-refill-alert:decision-input]", { ...baseDecision });
      console.info("[display-refill-alert:decision-result]", {
        ...baseDecision,
        smallest_available_size: null,
        next_display_size: null,
        should_create_alert: false,
        reason: "missing_branch_for_branch_alert",
      });
      console.info("[display-refill-alert:skipped]", { ...baseDecision, reason: "missing_branch_for_branch_alert" });
      continue;
    }

    const variants = await loadSameColorVariants({ tenantId: itemTenantId, productId, colorName, branchId });
    const sortedVariants = sortVariantsBySize(variants);
    const soldVariant = sortedVariants.find((row) => rowMatchesSoldVariant(row, soldVariantId, soldSize, colorName, soldColorId)) || null;
    const providedDisplayBefore = stockNumberOrNull(firstDefined(item.display_quantity_before, item.displayQuantityBefore, item.stock_before, item.stockBefore));
    const providedDisplayAfter = stockNumberOrNull(firstDefined(item.display_quantity_after, item.displayQuantityAfter, item.stock_after, item.stockAfter));
    const soldVariantStockAfter = providedDisplayAfter ?? (soldVariant ? stockNumber(soldVariant.stock) : null);
    const stockBefore = providedDisplayBefore ?? (soldVariantStockAfter !== null ? soldVariantStockAfter + soldQuantity : null);
    const availableSizeOptions = [];
    const seenAvailableSizes = new Set();
    for (const row of sortedVariants) {
      if (normalizeStockValue(row) <= 0) continue;
      const size = clean(row.size);
      const normalized = parseSizeNumber(size);
      if (!size || normalized === null) continue;
      const key = String(normalized);
      if (seenAvailableSizes.has(key)) continue;
      seenAvailableSizes.add(key);
      availableSizeOptions.push({ size, normalized });
    }
    const availableAfterSale = availableSizeOptions.map((entry) => entry.size);
    const soldSizeNormalized = parseSizeNumber(soldSize);
    const soldSizeComparable = normalizeSizeComparable(soldSize);
    const soldSizeRemainingQty = soldSizeNormalized === null
      ? null
      : soldVariantStockAfter ?? sortedVariants
        .filter((row) => parseSizeNumber(row.size) === soldSizeNormalized)
        .reduce((sum, row) => sum + normalizeStockValue(row), 0);
    const smallerSizesAvailable = soldSizeNormalized === null
      ? []
      : availableSizeOptions.filter((entry) => entry.normalized < soldSizeNormalized).map((entry) => entry.size);
    const nextLargerSize = soldSizeNormalized === null
      ? null
      : availableSizeOptions.find((entry) => entry.normalized > soldSizeNormalized)?.size || null;
    const smallestAvailable = availableAfterSale[0] || null;
    let nextDisplaySize = null;
    let shouldCreateAlert = false;
    let replacementSource = "none";
    let reason = "no_replacement_size";

    console.info("[display-refill-alert:decision-input]", {
      tenant_id: itemTenantId,
      order_id: safeOrderId,
      product_id: productId,
      variant_id: soldVariantId,
      branch_id: branchId,
      sold_quantity: soldQuantity,
      sold_size: soldSize,
      color: colorName || null,
      display_quantity_before: stockBefore,
      display_quantity_after: soldVariantStockAfter,
      sold_size_remaining_qty: soldSizeRemainingQty,
    });
    console.info("[display-refill-alert:stock-state]", {
      tenant_id: itemTenantId,
      order_id: safeOrderId,
      product_id: productId,
      variant_id: soldVariantId,
      branch_id: branchId,
      sold_quantity: soldQuantity,
      color: colorName || null,
      sold_size: soldSize,
      display_quantity_before: stockBefore,
      display_quantity_after: soldVariantStockAfter,
      sold_size_remaining_qty: soldSizeRemainingQty,
      available_sizes: availableAfterSale,
    });

    if (soldSizeNormalized === null) {
      reason = "missing_normalized_sold_size";
    } else if (smallerSizesAvailable.length) {
      reason = "sold_size_not_smallest";
    } else if (soldSizeRemainingQty > 0) {
      shouldCreateAlert = true;
      nextDisplaySize = soldSize;
      replacementSource = "same_size_remaining";
      reason = "refill_same_size_remaining";
    } else if (nextLargerSize) {
      shouldCreateAlert = true;
      nextDisplaySize = nextLargerSize;
      replacementSource = "next_larger_size";
      reason = "refill_next_larger_size";
    } else {
      reason = "no_replacement_size";
    }

    console.info("[display-refill-alert:size-rule]", {
      tenant_id: itemTenantId,
      branch_id: branchId,
      order_id: safeOrderId,
      product_id: productId,
      variant_id: soldVariantId,
      color: colorName || null,
      sold_size: soldSize,
      normalized_sold_size: soldSizeNormalized,
      available_sizes: availableAfterSale,
      sold_size_remaining_qty: soldSizeRemainingQty,
      smaller_sizes_available: smallerSizesAvailable,
      next_larger_size: nextLargerSize,
      replacement_source: replacementSource,
      should_create_alert: shouldCreateAlert,
      reason,
    });

    console.info("[display-refill-alert:decision-result]", {
      tenant_id: itemTenantId,
      order_id: safeOrderId,
      product_id: productId,
      variant_id: soldVariantId,
      branch_id: branchId,
      sold_quantity: soldQuantity,
      color: colorName || null,
      sold_size: soldSize,
      display_quantity_before: stockBefore,
      display_quantity_after: soldVariantStockAfter,
      smallest_available_size: smallestAvailable,
      next_display_size: nextDisplaySize,
      available_sizes_after_sale: availableAfterSale,
      normalized_sold_size: soldSizeNormalized,
      sold_size_remaining_qty: soldSizeRemainingQty,
      smaller_sizes_available: smallerSizesAvailable,
      next_larger_size: nextLargerSize,
      replacement_source: replacementSource,
      should_create_alert: shouldCreateAlert,
      reason,
    });

    if (!shouldCreateAlert || !nextDisplaySize) {
      console.info("[display-refill-alert:skipped]", {
        tenant_id: itemTenantId,
        order_id: safeOrderId,
        product_id: productId,
        variant_id: soldVariantId,
        branch_id: branchId,
        sold_quantity: soldQuantity,
        color: colorName || null,
        sold_size: soldSize,
        display_quantity_before: stockBefore,
        display_quantity_after: soldVariantStockAfter,
        sold_size_remaining_qty: soldSizeRemainingQty,
        replacement_source: replacementSource,
        reason,
      });
      continue;
    }

    const duplicate = await duplicateExists({
      tenantId: itemTenantId,
      productId,
      branchId,
      colorName,
      soldSize,
    });
    if (duplicate) {
      console.info("[display-refill-alert:skipped]", {
        tenant_id: itemTenantId,
        order_id: safeOrderId,
        product_id: productId,
        variant_id: soldVariantId,
        branch_id: branchId,
        sold_quantity: soldQuantity,
        color: colorName || null,
        sold_size: soldSize,
        display_quantity_before: stockBefore,
        display_quantity_after: soldVariantStockAfter,
        reason: "duplicate_pending_active",
        duplicate_alert_id: duplicate.id,
      });
      continue;
    }

    const imageUrl = clean(item.sold_variant_image_url) || variantImageFromRows(sortedVariants, colorName) || clean(item.product_image_url);
    const invoiceNumber = clean(item.invoice_number || item.display_order_number || item.public_order_number || safeOrderId);
    const alertEmployeeId = branchId ? null : safeEmployeeId;
    const alert = await insertAlert({
      tenant_id: itemTenantId,
      employee_id: alertEmployeeId,
      order_id: safeOrderId,
      invoice_number: invoiceNumber,
      product_id: productId,
      variant_id: soldVariantId || item.variant_id || null,
      branch_id: branchId,
      product_name: item.product_name,
      color_name: colorName,
      sold_size: soldSize,
      replacement_size: nextDisplaySize,
      remaining_stock: soldSizeRemainingQty ?? soldVariantStockAfter ?? 0,
      image_url: imageUrl,
    });

    const body = `ط§ط¹ط±ط¶ ${nextDisplaySize} ط¨ط¯ظ„ ${soldSize} ظ…ظ† ${clean(item.product_name)} - ${colorName}`;
    const notificationTargetIds = await loadBranchEmployeeNotificationTargets({
      tenantId: itemTenantId,
      branchId,
      sellerEmployeeId: safeEmployeeId,
    });
    console.info("[display-refill-alert:notification-targets]", {
      alert_id: alert.id,
      tenant_id: itemTenantId,
      branch_id: branchId,
      seller_employee_id: safeEmployeeId,
      target_count: notificationTargetIds.length,
      target_employee_ids: notificationTargetIds.slice(0, 20),
    });
    await Promise.all(notificationTargetIds.map((employeeId) =>
      createEmployeePortalNotification({
        tenantId: itemTenantId,
        employeeId,
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
      }).catch((error) => console.warn("[display-refill-alert:notification-skipped]", {
        alertId: alert.id,
        employee_id: employeeId,
        message: error?.message || String(error),
      }))
    ));

    emitToRooms([branchId ? `branch:${branchId}` : null, safeEmployeeId ? `employee:${safeEmployeeId}` : null], "employee_portal:display_refill_alert", {
      alert,
      badge: { tag: "display_refill_alert", tab: "display-refill" },
      at: new Date().toISOString(),
    });

    console.info("[display-refill-alert:created]", {
      alert_id: alert.id,
      tenant_id: itemTenantId,
      employee_id: alert.employee_id || null,
      product_id: productId,
      variant_id: soldVariantId,
      color: colorName,
      branch_id: branchId,
      sold_quantity: soldQuantity,
      sold_size: soldSize,
      size: nextDisplaySize,
      display_quantity_before: stockBefore,
      display_quantity_after: soldVariantStockAfter,
      notification_target_count: notificationTargetIds.length,
    });
    created.push(alert);
  }
  return created;
};

export const listDisplayRefillAlertsForEmployee = async ({ employeeId, tenantId = null, branchId = null, status = "pending", limit = 50 } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const params = [numberOrNull(employeeId), numberOrNull(branchId), numberOrNull(tenantId)];
  const statusClause = clean(status) && clean(status) !== "all"
    ? (params.push(clean(status)), `AND status = $${params.length}`)
    : "";
  params.push(Math.max(1, Math.min(100, Number(limit || 50))));
  const result = await db.query(
    `
    SELECT *
    FROM employee_display_refill_alerts
    WHERE ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)
      AND (
        employee_id = $1
        OR (
          employee_id IS NULL
          AND $2::bigint IS NOT NULL
          AND branch_id = $2::bigint
        )
      )
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

export const markDisplayRefillAlertRead = async ({ employeeId, tenantId = null, branchId = null, alertId } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const result = await db.query(
    `
    UPDATE employee_display_refill_alerts
    SET is_read = TRUE
    WHERE id = $1
      AND ($4::bigint IS NULL OR tenant_id = $4::bigint OR tenant_id IS NULL)
      AND (
        employee_id = $2
        OR (
          employee_id IS NULL
          AND $3::bigint IS NOT NULL
          AND branch_id = $3::bigint
        )
      )
    RETURNING *
    `,
    [numberOrNull(alertId), numberOrNull(employeeId), numberOrNull(branchId), numberOrNull(tenantId)]
  );
  return result.rows[0] ? normalizeAlert(result.rows[0]) : null;
};

export const resolveDisplayRefillAlert = async ({ employeeId, tenantId = null, branchId = null, alertId } = {}) => {
  await ensureDisplayRefillAlertSchema();
  const result = await db.query(
    `
    UPDATE employee_display_refill_alerts
    SET status = 'resolved',
        is_read = TRUE,
        resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
        resolved_by_employee_id = $2
    WHERE id = $1
      AND ($4::bigint IS NULL OR tenant_id = $4::bigint OR tenant_id IS NULL)
      AND (
        employee_id = $2
        OR (
          employee_id IS NULL
          AND $3::bigint IS NOT NULL
          AND branch_id = $3::bigint
        )
      )
    RETURNING *
    `,
    [numberOrNull(alertId), numberOrNull(employeeId), numberOrNull(branchId), numberOrNull(tenantId)]
  );
  const alert = result.rows[0] ? normalizeAlert(result.rows[0]) : null;
  console.info("[display-refill-alert:resolved]", {
    alertId: numberOrNull(alertId),
    employeeId: numberOrNull(employeeId),
    tenant_id: numberOrNull(tenantId),
    branch_id: numberOrNull(branchId),
    found: Boolean(alert),
  });
  return alert;
};

