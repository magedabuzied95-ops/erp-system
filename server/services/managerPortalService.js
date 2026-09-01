import { randomBytes } from "node:crypto";
import db from "../database/db.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { calculateTodayProfit, getDashboardOverview, getHourlySales, getLowStock, getSalesTrend, getTopProducts, getAiInsights, personalOrderClause } from "./dashboardAnalyticsService.js";
import { aggregatePaymentDistribution } from "./managerPortalPaymentDistribution.js";
import { getSetting } from "./settingsService.js";
import { verifyProfitToken, nullProfitFieldsInOverview, stripInvoiceProfit, stripProfitFromInsights, buildDailyProfitBlock } from "./managerProfitLock.js";
import { getStaffTaskDashboard, createStaffTask, updateStaffTaskStatus, addStaffTaskComment, updateStaffTaskDetails, deleteStaffTask, listStaffTaskTemplates, saveStaffTaskTemplate, setStaffTaskTemplateActive, deleteStaffTaskTemplate, getStaffTaskTemplateCompliance, generateDueTaskInstancesFromTemplates } from "./staffTasksService.js";
import {
  answerAdminChatRing,
  sendAdminChatRing,
  listEmployeeChatThreads,
  getAdminEmployeeChatThread,
  sendAdminEmployeeChatMessage,
  markAdminEmployeeChatThreadRead,
  markAdminEmployeeChatThreadDelivered,
  updateAdminEmployeeChatThreadPrefs,
  starAdminEmployeeChatMessage,
  listStarredChatMessages,
} from "./employeeChatService.js";
import { getUnreadCount, listNotifications, markAsRead, markAllAsRead, createNotification } from "./notificationsService.js";
import {
  approveInventoryCountSession,
  getInventoryCountSession,
  listInventoryCountSessions,
  rejectInventoryCountSession,
} from "./inventoryCountService.js";
import { listRecentDisplayRefillAlerts } from "./displayRefillAlertService.js";
import { getRolePermissions } from "./rolesService.js";
import { listEmployeePortalRequests, reviewEmployeePortalRequest } from "./employeePayrollPortalService.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";
import { repairArabicMojibakeText } from "../utils/textEncoding.js";
import { diffOperationItems } from "../utils/orderOperationDiff.js";
import { attachOperationVariantLabels } from "../utils/operationVariantLabels.js";

const tokenBytes = 32;
const DEFAULT_MANAGER_PORTAL_APP_URL = "https://erp-system-ten-green.vercel.app";
const clean = (value = "") => String(value ?? "").trim();
const lower = (value = "") => clean(value).toLowerCase();
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};
const jsonObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const repairManagerPortalPayload = (value) => {
  if (typeof value === "string") return repairArabicMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairManagerPortalPayload);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repairManagerPortalPayload(item)]));
  }
  return value;
};
const toBool = (value) => value === true || value === "true" || value === "1" || value === 1;
const isManagerRole = (role = "") => {
  const normalized = lower(role).replace(/[\s_-]+/g, "_");
  return ["manager", "admin", "super_admin", "superadmin"].includes(normalized);
};
const isManagerPortalAccessEnabled = (row = {}) => {
  if (toBool(row.manager_portal_enabled)) return true;
  const normalizedFields = [row.role, row.job_title, row.position]
    .map((value) => lower(value).replace(/[\s_-]+/g, " "))
    .filter(Boolean)
    .join(" ");
  return [
    "manager",
    "branch manager",
    "branch_manager",
    "admin",
    "super admin",
    "superadmin",
    "super_admin",
    "مدير",
    "مدير فرع",
  ].some((needle) => normalizedFields.includes(lower(needle).replace(/[\s_-]+/g, " ")));
};

const DEFAULT_MANAGER_NOTIFICATION_SETTINGS = {
  messages: { sound: true, toast: true, push: true },
  tasks: { sound: true, toast: true, push: true },
  attendance: { sound: true, toast: true, push: true },
  sales: { sound: true, toast: true, push: true },
  stock: { sound: true, toast: true, push: true },
  ai_leads: { sound: true, toast: true, push: true },
};

const defaultManagerPermissions = [
  "dashboard.view",
  "products.view",
  "orders.view",
  "purchases.view",
  "suppliers.view",
  "inventory.view",
  "warehouses.view",
  "branches.view",
  "reports.view",
  "settings.view",
  "users.view",
  "roles.view",
  "attendance.view",
  "attendance.create",
  "attendance.edit",
  "attendance.export",
  "attendance.print",
  "marketing.view",
  "marketing.create",
  "marketing.update",
  "marketing.delete",
  "marketing.publish",
  "marketing.settings",
  "website.view",
  "website.orders",
  "website.settings",
  "notifications.view",
  "notifications.manage",
  "staff_tasks.view",
  "staff_tasks.create",
  "staff_tasks.update",
  "staff_tasks.manage",
  "expenses.view",
  "expenses.create",
  "expenses.edit",
  "expenses.delete",
  "expenses.approve",
  "expenses.pay",
  "expenses.reports",
  "expenses.advances.view",
  "expenses.advances.create",
  "expenses.advances.deduct",
  "pos.expenses.create",
  "pos.expenses.view_shift_total",
  "money_accounts.view",
  "money_accounts.manage",
  "money_transactions.view",
  "money_transactions.adjust",
  "money_transfers.create",
  "treasury.dashboard.view",
  "loyalty.view",
  "loyalty.create",
  "loyalty.edit",
  "loyalty.export",
  "employees.view",
  "employees.export",
  "employees.print",
];

let schemaReady = false;
let schemaPromise = null;
const tableExistsCache = new Map();
const columnExistsCache = new Map();

const tableExists = async (tableName) => {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName);
  const result = await db.query("SELECT to_regclass($1) AS regclass", [`public.${tableName}`]);
  const exists = Boolean(result.rows[0]?.regclass);
  tableExistsCache.set(tableName, exists);
  return exists;
};

const columnExists = async (tableName, columnName) => {
  const cacheKey = `${tableName}.${columnName}`;
  if (columnExistsCache.has(cacheKey)) return columnExistsCache.get(cacheKey);
  const result = await db.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName]
  );
  const exists = result.rows.length > 0;
  columnExistsCache.set(cacheKey, exists);
  return exists;
};

const safeQuery = async (sql, params = [], fallback = []) => {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (error) {
    console.warn("[manager-portal] query failed", { message: error?.message || String(error), code: error?.code || "" });
    return fallback;
  }
};

const mergeManagerNotificationSettings = (stored = {}) => {
  const source = jsonObject(stored);
  const categorySource = jsonObject(source.notifications || source);
  const next = { ...DEFAULT_MANAGER_NOTIFICATION_SETTINGS };
  for (const [category, defaults] of Object.entries(DEFAULT_MANAGER_NOTIFICATION_SETTINGS)) {
    const current = jsonObject(categorySource[category]);
    next[category] = {
      sound: current.sound !== undefined ? Boolean(current.sound) : Boolean(defaults.sound),
      toast: current.toast !== undefined ? Boolean(current.toast) : Boolean(defaults.toast),
      push: current.push !== undefined ? Boolean(current.push) : Boolean(defaults.push),
    };
  }
  return {
    ...source,
    notifications: next,
  };
};

const resolveBranchScope = (manager = {}) => {
  const stored = jsonObject(manager.manager_portal_settings || manager.notification_settings || {});
  if (stored.scope_all_branches === true || stored.branch_scope === "all") return "all";
  return manager.branch_id ? "branch" : "all";
};

// Role -> permissions is near-static, but was queried on every authenticated request
// for role-based managers (those without the manager_portal_enabled short-circuit).
// Cache successful DB lookups briefly so hot paths skip the extra round-trip; changes
// still propagate within the TTL and any lookup failure falls back to a live query.
const rolePermissionsCache = new Map();
const ROLE_PERMISSIONS_TTL_MS = 60_000;

const resolveManagerPermissions = async ({ tenantId = null, role = "", enabled = false } = {}) => {
  if (enabled) return defaultManagerPermissions;
  const roleName = clean(role);
  if (!roleName) return defaultManagerPermissions;
  const cacheKey = `${tenantId ?? ""}:${roleName.toLowerCase()}`;
  const cached = rolePermissionsCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const rolePermissions = await getRolePermissions({ db, roleId: roleName, tenantId });
    if (rolePermissions?.permissions?.length) {
      rolePermissionsCache.set(cacheKey, { value: rolePermissions.permissions, expires: Date.now() + ROLE_PERMISSIONS_TTL_MS });
      return rolePermissions.permissions;
    }
  } catch (error) {
    console.warn("[manager-portal] role permission lookup failed", { role: roleName, message: error?.message || String(error) });
  }
  if (isManagerRole(roleName)) return defaultManagerPermissions;
  return [];
};

export const generateManagerPortalToken = () => {
  return randomBytes(tokenBytes).toString("hex");
};

export const buildManagerPortalLink = (token) => {
  const origin = getPublicAppUrl() || clean(process.env.PUBLIC_APP_URL) || DEFAULT_MANAGER_PORTAL_APP_URL;
  const normalizedOrigin = clean(origin).replace(/\/+$/, "");
  return normalizedOrigin ? `${normalizedOrigin}/manager-portal/${encodeURIComponent(token)}` : `/manager-portal/${encodeURIComponent(token)}`;
};

export const ensureManagerPortalSchema = async (clientOrPool = db) => {
  if (schemaReady) return;
  if (clientOrPool === db && schemaPromise) return schemaPromise;

  const runEnsure = async () => {
    await ensureAttendanceSchema(clientOrPool);
    await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS manager_portal_token TEXT`);
    await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS manager_portal_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS manager_portal_settings JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_manager_portal_token ON employees (manager_portal_token) WHERE manager_portal_token IS NOT NULL AND manager_portal_token <> ''`);
    await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employees_manager_portal_settings ON employees USING GIN (manager_portal_settings)`);
  };

  if (clientOrPool !== db) {
    await runEnsure();
    return;
  }

  schemaPromise = runEnsure()
    .then(() => {
      schemaReady = true;
    })
    .finally(() => {
      schemaPromise = null;
    });

  return schemaPromise;
};

export const regenerateManagerPortalToken = async ({ employeeId, tenantId = null, clientOrPool = db } = {}) => {
  await ensureManagerPortalSchema(clientOrPool);
  if (!employeeId) {
    const error = new Error("Employee is required");
    error.status = 400;
    throw error;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateManagerPortalToken();
    try {
      const result = await clientOrPool.query(
        `
        UPDATE employees
        SET manager_portal_token = $3,
            updated_at = NOW()
        WHERE id::text = $1::text
          AND COALESCE(is_deleted, FALSE) = FALSE
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        RETURNING id, manager_portal_token
        `,
        [employeeId, tenantId, token]
      );
      if (!result.rows[0]) {
        const error = new Error("Employee not found");
        error.status = 404;
        throw error;
      }
      return result.rows[0].manager_portal_token;
    } catch (error) {
      if (String(error?.code) === "23505" && attempt < 4) continue;
      throw error;
    }
  }

  const error = new Error("Unable to generate manager portal token");
  error.status = 500;
  throw error;
};

export const repairMissingManagerPortalTokens = async ({ tenantId = null, clientOrPool = db, limit = 500 } = {}) => {
  await ensureManagerPortalSchema(clientOrPool);
  const result = await clientOrPool.query(
    `
    SELECT id
    FROM employees
    WHERE COALESCE(is_deleted, FALSE) = FALSE
      AND LOWER(COALESCE(status, 'active')) = 'active'
      AND (
        COALESCE(manager_portal_enabled, FALSE) = TRUE
        OR LOWER(COALESCE(role, '')) IN ('manager', 'admin', 'super_admin', 'superadmin')
        OR LOWER(COALESCE(job_title, '')) IN ('manager', 'branch manager', 'branch_manager', 'admin', 'super_admin', 'superadmin', 'super admin', 'مدير', 'مدير فرع')
        OR LOWER(COALESCE(position, '')) IN ('manager', 'branch manager', 'branch_manager', 'admin', 'super_admin', 'superadmin', 'super admin', 'مدير', 'مدير فرع')
      )
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND (manager_portal_token IS NULL OR manager_portal_token = '')
    ORDER BY id ASC
    LIMIT $2
    `,
    [tenantId, Math.max(1, Math.min(Number(limit) || 500, 5000))]
  );

  const repaired = [];
  for (const row of result.rows) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = generateManagerPortalToken();
      try {
        const update = await clientOrPool.query(
          `
          UPDATE employees
          SET manager_portal_token = $3,
              updated_at = NOW()
          WHERE id::text = $1::text
            AND COALESCE(is_deleted, FALSE) = FALSE
            AND LOWER(COALESCE(status, 'active')) = 'active'
            AND (
              COALESCE(manager_portal_enabled, FALSE) = TRUE
              OR LOWER(COALESCE(role, '')) IN ('manager', 'admin', 'super_admin', 'superadmin')
              OR LOWER(COALESCE(job_title, '')) IN ('manager', 'branch manager', 'branch_manager', 'admin', 'super_admin', 'superadmin', 'super admin', 'مدير', 'مدير فرع')
              OR LOWER(COALESCE(position, '')) IN ('manager', 'branch manager', 'branch_manager', 'admin', 'super_admin', 'superadmin', 'super admin', 'مدير', 'مدير فرع')
            )
            AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
            AND (manager_portal_token IS NULL OR manager_portal_token = '')
          RETURNING id, manager_portal_token
          `,
          [row.id, tenantId, token]
        );
        if (update.rows[0]) repaired.push(update.rows[0]);
        break;
      } catch (error) {
        if (String(error?.code) === "23505" && attempt < 4) continue;
        throw error;
      }
    }
  }

  return {
    scanned: result.rows.length,
    repaired_count: repaired.length,
    repaired,
  };
};

export const loadManagerPortalByToken = async (token) => {
  await ensureManagerPortalSchema(db);
  const result = await db.query(
    `
    SELECT
      e.id,
      e.tenant_id,
      e.user_id,
      e.employee_code,
      e.full_name,
      e.role,
      e.job_title,
      e.position,
      e.department,
      e.salary,
      e.status,
      COALESCE(e.is_deleted, FALSE) AS is_deleted,
      COALESCE(e.manager_portal_enabled, FALSE) AS manager_portal_enabled,
      e.branch_id,
      e.manager_portal_token,
      e.manager_portal_settings,
      b.name AS branch_name,
      u.email AS user_email
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.manager_portal_token = $1
      AND COALESCE(e.is_deleted, FALSE) = FALSE
      AND LOWER(COALESCE(e.status, 'active')) = 'active'
      AND (
        COALESCE(e.manager_portal_enabled, FALSE) = TRUE
        OR LOWER(COALESCE(e.role, '')) IN ('manager', 'admin', 'super_admin', 'superadmin')
        OR LOWER(COALESCE(e.job_title, '')) IN ('manager', 'branch manager', 'branch_manager', 'admin', 'super_admin', 'superadmin', 'super admin', 'مدير', 'مدير فرع')
        OR LOWER(COALESCE(e.position, '')) IN ('manager', 'branch manager', 'branch_manager', 'admin', 'super_admin', 'superadmin', 'super admin', 'مدير', 'مدير فرع')
      )
    LIMIT 1
    `,
    [token]
  );
  const row = result.rows[0] || null;
  if (!row) return null;

  const permissions = await resolveManagerPermissions({ tenantId: row.tenant_id, role: row.role, enabled: row.manager_portal_enabled });
  return {
    ...row,
    permissions,
    notification_settings: mergeManagerNotificationSettings(row.manager_portal_settings || {}),
    branch_scope: resolveBranchScope(row),
  };
};

export const inspectManagerPortalTokenMatch = async (token) => {
  await ensureManagerPortalSchema(db);
  const result = await db.query(
    `
    SELECT
      id,
      tenant_id,
      role,
      status,
      COALESCE(is_deleted, FALSE) AS is_deleted,
      LOWER(COALESCE(status, 'active')) = 'active' AS is_active
    FROM employees
    WHERE manager_portal_token = $1
    LIMIT 1
    `,
    [token]
  );
  return result.rows[0] || null;
};

export const updateManagerPortalSettings = async ({ employeeId, tenantId = null, settings = {} } = {}) => {
  await ensureManagerPortalSchema(db);
  if (!employeeId) {
    const error = new Error("Employee is required");
    error.status = 400;
    throw error;
  }
  const normalized = mergeManagerNotificationSettings(settings);
  const result = await db.query(
    `
    UPDATE employees
    SET manager_portal_settings = $3::jsonb,
        updated_at = NOW()
    WHERE id::text = $1::text
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    RETURNING manager_portal_settings
    `,
    [employeeId, tenantId, JSON.stringify(normalized)]
  );
  return mergeManagerNotificationSettings(result.rows[0]?.manager_portal_settings || normalized);
};

export const getManagerPortalMe = async (manager = {}) => ({
  manager: {
    id: manager.id,
    tenant_id: manager.tenant_id,
    user_id: manager.user_id || null,
    employee_code: manager.employee_code || "",
    full_name: manager.full_name || "",
    role: manager.role || "manager",
    job_title: manager.job_title || "",
    position: manager.position || "",
    department: manager.department || "",
    salary: null,
    branch_id: manager.branch_id || null,
    branch_name: manager.branch_name || "",
    manager_portal_enabled: Boolean(manager.manager_portal_enabled),
    user_email: manager.user_email || "",
    branch_scope: manager.branch_scope || resolveBranchScope(manager),
  },
  permissions: Array.isArray(manager.permissions) ? manager.permissions : [],
  notification_settings: mergeManagerNotificationSettings(manager.notification_settings || {}),
});

const branchFilterValue = (manager = {}) => (manager.branch_scope === "all" ? null : numberOrNull(manager.branch_id));
export const canViewProfitForManager = (manager = {}) =>
  Array.isArray(manager.permissions) &&
  manager.permissions.some((permission) =>
    ["treasury.dashboard.view", "accounting.view", "accounting.reports", "reports.view", "money_accounts.view"].includes(permission)
  );

const resolveProfitOk = async (manager = {}, profitToken = "") => {
  if (!canViewProfitForManager(manager)) return false;
  const result = await verifyProfitToken(profitToken, { managerId: manager.id, tenantId: manager.tenant_id });
  return Boolean(result && result.valid);
};

const publicInvoiceUrlForOrder = (order = {}) => {
  const origin = getPublicAppUrl() || clean(process.env.PUBLIC_APP_URL) || DEFAULT_MANAGER_PORTAL_APP_URL;
  const normalizedOrigin = clean(origin).replace(/\/+$/, "");
  const identifier = clean(order.invoice_number || order.public_order_number || order.display_order_number || order.public_token || order.id);
  return normalizedOrigin && identifier ? `${normalizedOrigin}/invoice/${encodeURIComponent(identifier)}` : "";
};

// Resolve the optional order_items / products / product_variants columns once so
// both the single-invoice and batched hydration paths share identical SQL fragments.
const resolveInvoiceItemExprs = async () => {
  const [
    hasOrderItemColor,
    hasOrderItemSize,
    hasOrderItemSku,
    hasOrderItemBarcode,
    hasOrderItemImageUrl,
    hasOrderItemProductImage,
    hasOrderItemVariantImage,
    hasOrderItemTaxAmount,
    hasProductSku,
    hasProductBarcode,
    hasProductImageUrl,
    hasVariantSku,
    hasVariantBarcode,
    hasVariantImageUrl,
  ] = await Promise.all([
    columnExists("order_items", "color").catch(() => false),
    columnExists("order_items", "size").catch(() => false),
    columnExists("order_items", "sku").catch(() => false),
    columnExists("order_items", "barcode").catch(() => false),
    columnExists("order_items", "image_url").catch(() => false),
    columnExists("order_items", "product_image").catch(() => false),
    columnExists("order_items", "variant_image").catch(() => false),
    columnExists("order_items", "tax_amount").catch(() => false),
    columnExists("products", "sku").catch(() => false),
    columnExists("products", "barcode").catch(() => false),
    columnExists("products", "image_url").catch(() => false),
    columnExists("product_variants", "sku").catch(() => false),
    columnExists("product_variants", "barcode").catch(() => false),
    columnExists("product_variants", "image_url").catch(() => false),
  ]);
  return {
    itemColorExpr: hasOrderItemColor ? "NULLIF(oi.color, '')" : "NULL",
    itemSizeExpr: hasOrderItemSize ? "NULLIF(oi.size, '')" : "NULL",
    itemSkuExpr: hasOrderItemSku ? "NULLIF(oi.sku, '')" : "NULL",
    itemBarcodeExpr: hasOrderItemBarcode ? "NULLIF(oi.barcode, '')" : "NULL",
    itemImageExpr: hasOrderItemImageUrl ? "NULLIF(oi.image_url, '')" : "NULL",
    itemProductImageExpr: hasOrderItemProductImage ? "NULLIF(oi.product_image, '')" : "NULL",
    itemVariantImageExpr: hasOrderItemVariantImage ? "NULLIF(oi.variant_image, '')" : "NULL",
    productSkuExpr: hasProductSku ? "NULLIF(p.sku, '')" : "NULL",
    productBarcodeExpr: hasProductBarcode ? "NULLIF(p.barcode, '')" : "NULL",
    productImageExpr: hasProductImageUrl ? "NULLIF(p.image_url, '')" : "NULL",
    variantSkuExpr: hasVariantSku ? "NULLIF(pv.sku, '')" : "NULL",
    variantBarcodeExpr: hasVariantBarcode ? "NULLIF(pv.barcode, '')" : "NULL",
    variantImageExpr: hasVariantImageUrl ? "NULLIF(pv.image_url, '')" : "NULL",
    hasOrderItemTaxAmount,
  };
};

const invoiceItemsSelectColumns = (e) => `
          oi.id,
          oi.order_id,
          oi.product_id,
          oi.variant_id,
          COALESCE(NULLIF(oi.product_name, ''), p.name, 'منتج') AS product_name,
          COALESCE(${e.itemColorExpr}, NULLIF(pv.color, ''), '') AS color,
          COALESCE(${e.itemSizeExpr}, NULLIF(pv.size, ''), '') AS size,
          COALESCE(${e.itemSkuExpr}, ${e.variantSkuExpr}, ${e.productSkuExpr}, '') AS sku,
          COALESCE(${e.itemBarcodeExpr}, ${e.variantBarcodeExpr}, ${e.productBarcodeExpr}, '') AS barcode,
          COALESCE(${e.itemImageExpr}, ${e.itemProductImageExpr}, ${e.itemVariantImageExpr}, ${e.variantImageExpr}, ${e.productImageExpr}, '') AS image_url,
          COALESCE(oi.quantity, 0)::numeric AS quantity,
          COALESCE(oi.sale_price, 0)::numeric AS price,
          0::numeric AS discount_amount,
          ${e.hasOrderItemTaxAmount ? "COALESCE(oi.tax_amount, 0)::numeric" : "0::numeric"} AS tax_amount,
          COALESCE(oi.total_amount, COALESCE(oi.sale_price, 0) * COALESCE(oi.quantity, 0), 0)::numeric AS line_total`;

// Build the manager-portal invoice detail object from an order row + its items.
// profitAllowed is resolved once by the caller (avoids a per-invoice profit check).
// Exported for parity tests: single-invoice and batched hydration must produce
// byte-identical objects for the same (order, items, profitAllowed).
export const buildManagerPortalInvoiceObject = (order, items, profitAllowed) => {
  const subtotal = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const total = Number(order.total_amount ?? order.total ?? subtotal);
  // discount_amount is all-inclusive (item + invoice + loyalty + coupon, see analyticsMetrics
  // D-02), so it stays the single total. The parts are reported ALONGSIDE it, never added to it,
  // so a manager looking at an invoice can see WHY it was discounted rather than only by how much.
  const discount = Number(order.discount_amount ?? order.invoice_discount_amount ?? order.coupon_discount_amount ?? 0);
  const couponDiscount = Number(order.coupon_discount_amount || 0);
  const invoiceDiscount = Number(order.invoice_discount_amount || 0);
  const loyaltyDiscount = Number(order.loyalty_discount_amount || 0);
  const shipping = Number(order.shipping_fee ?? order.delivery_fee ?? order.shipping_cost ?? order.service_fee ?? 0);
  const tax = Number(order.tax_amount ?? order.vat_amount ?? order.total_tax ?? 0);
  const paid = Number(order.paid_amount ?? order.amount_paid ?? order.total_paid ?? 0);
  const profit = profitAllowed ? Number(order.profit ?? order.gross_profit ?? order.net_profit ?? 0) : null;
  const cost = profitAllowed ? Number(order.cost_amount ?? order.cogs_amount ?? order.total_cost ?? 0) : null;
  return {
    id: order.id,
    order_id: order.id,
    invoice_number: order.invoice_number || `INV-${order.id}`,
    public_order_number: order.public_order_number || order.display_order_number || "",
    status: order.status || "",
    created_at: order.created_at,
    updated_at: order.updated_at,
    branch_id: order.branch_id || null,
    customer_name: order.customer_name || order.customer_record_name || "عميل نقدي",
    customer_phone: order.customer_phone || order.phone || order.customer_record_phone || "",
    customer_address: order.customer_address || order.shipping_address_line || order.detailed_address || order.address || "",
    customer_type: order.customer_type || (order.customer_id ? "registered" : "walk_in"),
    seller_name: order.seller_name || order.sales_employee_name || order.salesperson_name || order.cashier_name || "",
    cashier_name: order.cashier_name || "",
    branch_name: order.branch_name || "",
    payment_method: order.payment_method || "",
    payment_type: order.payment_type || order.payment_method || "",
    payment_status: order.payment_status || "",
    payment_breakdown: Array.isArray(order.payment_breakdown) ? order.payment_breakdown : [],
    treasury_name: order.treasury_name || order.cash_drawer_name || order.money_account_name || "",
    transfer_proof_status: order.transfer_proof_status || order.shipping_proof_status || "",
    cod_amount: Number(order.cod_amount || 0),
    subtotal,
    discount,
    coupon_code: order.coupon_code || "",
    coupon_discount: couponDiscount,
    invoice_discount: invoiceDiscount,
    invoice_discount_reason: order.invoice_discount_reason || "",
    loyalty_discount: loyaltyDiscount,
    shipping,
    tax,
    total,
    paid_amount: paid,
    remaining_amount: Math.max(0, total - paid),
    profit,
    cost,
    permissions: {
      can_view_profit: profitAllowed,
    },
    public_invoice_url: order.public_invoice_url || order.invoice_public_url || order.public_invoice_short_url || order.short_invoice_url || publicInvoiceUrlForOrder(order),
    items,
  };
};

export const getManagerPortalInvoiceDetail = async ({ manager = {}, invoiceId, profitToken = "" } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const orderId = numberOrNull(invoiceId);
  if (!orderId) {
    const error = new Error("Invoice is required");
    error.status = 400;
    throw error;
  }
  if (!(await tableExists("orders"))) {
    const error = new Error("Invoice not found");
    error.status = 404;
    throw error;
  }

  const hasBranches = await tableExists("branches");
  const hasCustomers = await tableExists("customers");
  const params = [orderId];
  const tenantClause = tenantId ? (params.push(tenantId), ` AND (o.tenant_id = $${params.length}::bigint OR o.tenant_id IS NULL)`) : "";
  const branchClause = branchId ? (params.push(branchId), ` AND o.branch_id = $${params.length}::bigint`) : "";
  const orderRows = await safeQuery(
    `
    SELECT
      o.*,
      ${hasBranches ? "COALESCE(b.name, '')" : "''"} AS branch_name,
      ${hasCustomers ? "COALESCE(c.name, '')" : "''"} AS customer_record_name,
      ${hasCustomers ? "COALESCE(c.phone, '')" : "''"} AS customer_record_phone
    FROM orders o
    ${hasBranches ? "LEFT JOIN branches b ON b.id = o.branch_id" : ""}
    ${hasCustomers ? "LEFT JOIN customers c ON c.id = o.customer_id" : ""}
    WHERE o.id = $1
      ${tenantClause}
      ${branchClause}
    LIMIT 1
    `,
    params,
    []
  );
  const order = orderRows[0] || null;
  if (!order) {
    const error = new Error("Invoice not found");
    error.status = 404;
    throw error;
  }

  const exprs = await resolveInvoiceItemExprs();
  const items = (await tableExists("order_items"))
    ? await safeQuery(
        `
        SELECT ${invoiceItemsSelectColumns(exprs)}
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE oi.order_id = $1
        ORDER BY oi.id ASC
        `,
        [order.id],
        []
      )
    : [];

  const profitAllowed = await resolveProfitOk(manager, profitToken);
  return buildManagerPortalInvoiceObject(order, items, profitAllowed);
};

// Batched hydration for the dashboard "today invoices" list. Fetches every scoped order
// row and all of their items in exactly TWO queries — replacing the previous N+1 that ran
// ~2 queries per invoice plus a redundant per-invoice profit-token check. profitOk is
// resolved once by the caller. Returns a Map keyed by String(order.id); the caller keeps
// the original ordering and falls back to the base row for ids that resolve out of scope,
// matching the prior `getManagerPortalInvoiceDetail(...).catch(() => base)` behavior.
export const getManagerPortalInvoiceDetailsBatch = async ({ manager = {}, invoiceIds = [], profitOk = false } = {}) => {
  const ids = Array.from(new Set(invoiceIds.map((id) => numberOrNull(id)).filter((id) => id != null)));
  if (!ids.length) return new Map();
  if (!(await tableExists("orders"))) return new Map();

  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const hasBranches = await tableExists("branches");
  const hasCustomers = await tableExists("customers");
  const params = [ids];
  const tenantClause = tenantId ? (params.push(tenantId), ` AND (o.tenant_id = $${params.length}::bigint OR o.tenant_id IS NULL)`) : "";
  const branchClause = branchId ? (params.push(branchId), ` AND o.branch_id = $${params.length}::bigint`) : "";
  const orderRows = await safeQuery(
    `
    SELECT
      o.*,
      ${hasBranches ? "COALESCE(b.name, '')" : "''"} AS branch_name,
      ${hasCustomers ? "COALESCE(c.name, '')" : "''"} AS customer_record_name,
      ${hasCustomers ? "COALESCE(c.phone, '')" : "''"} AS customer_record_phone
    FROM orders o
    ${hasBranches ? "LEFT JOIN branches b ON b.id = o.branch_id" : ""}
    ${hasCustomers ? "LEFT JOIN customers c ON c.id = o.customer_id" : ""}
    WHERE o.id = ANY($1::bigint[])
      ${tenantClause}
      ${branchClause}
    `,
    params,
    []
  );
  if (!orderRows.length) return new Map();

  const scopedIds = orderRows.map((row) => row.id);
  const exprs = await resolveInvoiceItemExprs();
  const itemRows = (await tableExists("order_items"))
    ? await safeQuery(
        `
        SELECT ${invoiceItemsSelectColumns(exprs)}
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE oi.order_id = ANY($1::bigint[])
        ORDER BY oi.order_id ASC, oi.id ASC
        `,
        [scopedIds],
        []
      )
    : [];

  const itemsByOrder = new Map();
  for (const item of itemRows) {
    const key = String(item.order_id);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push(item);
  }

  const detailByOrder = new Map();
  for (const order of orderRows) {
    detailByOrder.set(String(order.id), buildManagerPortalInvoiceObject(order, itemsByOrder.get(String(order.id)) || [], profitOk));
  }
  return detailByOrder;
};

export const getManagerPortalDashboard = async ({ manager = {}, filters = {}, profitToken = "" } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const [overview, staffDashboard, lowStock, aiInsights, refillAlerts, paymentBreakdown, leads, attendanceRows] = await Promise.all([
    getDashboardOverview({ tenantId, filters: { ...filters, branchId: branchId || filters.branchId || null, range: "today" } }),
    getStaffTaskDashboard({ tenantId, branchId }),
    getLowStock({ tenantId, limit: 12 }),
    getAiInsights({ tenantId }),
    listRecentDisplayRefillAlerts({ limit: 20 }).then((rows) => rows.filter((row) => (tenantId ? numberOrNull(row.tenant_id) === tenantId || row.tenant_id === null : true) && (branchId ? numberOrNull(row.branch_id) === branchId : true))),
    tableExists("orders").then(async (ordersExist) => {
      if (!ordersExist) return [];
      const [hasPaymentMethod, hasPaymentBreakdown, hasTotalAmount, hasTotal, hasCashAmount, hasCardAmount, hasWalletAmount] = await Promise.all([
        columnExists("orders", "payment_method"),
        columnExists("orders", "payment_breakdown"),
        columnExists("orders", "total_amount"),
        columnExists("orders", "total"),
        columnExists("orders", "cash_amount"),
        columnExists("orders", "card_amount"),
        columnExists("orders", "wallet_payment_amount"),
      ]);
      if (!hasPaymentMethod && !hasPaymentBreakdown) return [];
      const totalExpr = hasTotalAmount && hasTotal
        ? "COALESCE(o.total_amount, o.total, 0)"
        : hasTotalAmount
        ? "COALESCE(o.total_amount, 0)"
        : hasTotal
        ? "COALESCE(o.total, 0)"
        : "0";
      const params = [];
      const tenantClause = tenantId ? (params.push(tenantId), ` AND o.tenant_id = $${params.length}`) : "";
      const branchClause = branchId ? (params.push(branchId), ` AND o.branch_id = $${params.length}`) : "";
      // Distribute each included sale's real payment allocations (orders.payment_breakdown)
      // across its actual payment methods. A split payment (دفع مقسم) is never treated as a
      // payment method: every allocation is aggregated into its real method. Orders without
      // stored allocations fall back to their single payment_method. The WHERE clause is
      // unchanged, so report inclusion/exclusion (cancelled/canceled/void) is preserved.
      const distributionRows = await safeQuery(
        `
        SELECT
          ${hasPaymentMethod ? "o.payment_method" : "NULL"} AS payment_method,
          ${totalExpr} AS total_amount,
          ${hasPaymentBreakdown ? "o.payment_breakdown" : "'[]'::jsonb"} AS payment_breakdown,
          ${hasCashAmount ? "COALESCE(o.cash_amount, 0)" : "0"} AS cash_amount,
          ${hasCardAmount ? "COALESCE(o.card_amount, 0)" : "0"} AS card_amount,
          ${hasWalletAmount ? "COALESCE(o.wallet_payment_amount, 0)" : "0"} AS wallet_payment_amount
        FROM orders o
        WHERE o.created_at >= date_trunc('day', NOW())
          AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
          ${tenantClause}
          ${branchClause}
        `,
        params,
        []
      );
      return aggregatePaymentDistribution(distributionRows);
    }).catch(() => []),
    safeQuery(
      `
      SELECT
        s.id,
        s.session_id,
        s.hot_lead,
        s.lead_score,
        s.ai_insight,
        s.updated_at
      FROM ai_support_sessions s
      WHERE ($1::bigint IS NULL OR s.tenant_id = $1::bigint)
        AND COALESCE(s.hot_lead, FALSE) = TRUE
      ORDER BY s.updated_at DESC
      LIMIT 8
      `,
      [tenantId],
      []
    ),
    safeQuery(
      `
      SELECT DISTINCT ON (al.employee_id)
        al.employee_id,
        COALESCE(al.status, '') AS status,
        al.check_in_at,
        al.check_out_at,
        al.late_minutes
      FROM attendance_logs al
      WHERE al.attendance_date = CURRENT_DATE
        AND ($1::bigint IS NULL OR al.tenant_id = $1::bigint)
        ${branchId ? "AND al.branch_id = $2::bigint" : ""}
      ORDER BY al.employee_id, al.updated_at DESC, al.id DESC
      `,
      branchId ? [tenantId, branchId] : [tenantId],
      []
    ),
  ]);

  const todaySales = Number(overview?.today?.sales || 0);
  const activeEmployeesNow = attendanceRows.filter((row) => ["checked_in", "late"].includes(lower(row.status || "")) || row.check_in_at).length;
  const lateEmployees = attendanceRows.filter((row) => Number(row.late_minutes || 0) > 0 || lower(row.status || "") === "late").length;
  const absentEmployees = Array.isArray(staffDashboard?.byEmployee)
    ? staffDashboard.byEmployee.filter((employee) => employee.attendance_status === "absent").length
    : 0;
  const profitOk = await resolveProfitOk(manager, profitToken);
  if (!profitOk) nullProfitFieldsInOverview(overview);
  if (Array.isArray(overview?.recentInvoices) && overview.recentInvoices.length) {
    const detailByOrder = await getManagerPortalInvoiceDetailsBatch({
      manager,
      invoiceIds: overview.recentInvoices.map((invoice) => invoice.id),
      profitOk,
    }).catch(() => new Map());
    overview.recentInvoices = overview.recentInvoices.map((invoice) => detailByOrder.get(String(invoice.id)) || invoice);
    if (!profitOk) overview.recentInvoices = overview.recentInvoices.map(stripInvoiceProfit);
  }

  return {
    generated_at: new Date().toISOString(),
    today_sales_total: todaySales,
    invoice_count: Number(overview?.today?.orders || 0),
    payment_breakdown: paymentBreakdown,
    active_employees_now: activeEmployeesNow,
    late_employees: lateEmployees,
    absent_employees: absentEmployees,
    pending_tasks: Number(staffDashboard?.summary?.open || 0),
    completed_tasks: Number(staffDashboard?.summary?.completed || 0),
    overdue_tasks: Number(staffDashboard?.summary?.overdue || 0),
    low_stock: lowStock,
    refill_alerts: refillAlerts,
    new_leads: leads,
    ai_insights: profitOk ? (aiInsights || []) : stripProfitFromInsights(aiInsights || []),
    recent_tasks: staffDashboard?.recentTasks || [],
    task_history: staffDashboard?.history || [],
    overview,
    task_summary: staffDashboard?.summary || {},
  };
};

export const getManagerPortalStaff = async ({ manager = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const [taskDashboard, salesRows, attendanceRows, advanceRows, pendingPortalRequests, photoRows] = await Promise.all([
    getStaffTaskDashboard({ tenantId, branchId }),
    tableExists("orders").then(async (ordersExist) => {
      if (!ordersExist) return [];
      const hasSalesEmployee = await columnExists("orders", "sales_employee_id");
      if (!hasSalesEmployee) return [];
      const params = [tenantId];
      const tenantClause = `($1::bigint IS NULL OR o.tenant_id = $1::bigint)`;
      const branchClause = branchId ? (params.push(branchId), ` AND o.branch_id = $${params.length}`) : "";
      const todayClause = `AND o.created_at >= date_trunc('day', NOW())`;
      return safeQuery(
        `
        SELECT
          COALESCE(o.sales_employee_id, o.cashier_id, o.created_by) AS employee_id,
          COUNT(*)::int AS invoice_count,
          COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS sales_total
        FROM orders o
        WHERE ${tenantClause}
          ${todayClause}
          AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
          ${branchClause}
        GROUP BY COALESCE(o.sales_employee_id, o.cashier_id, o.created_by)
        `,
        params,
        []
      );
    }).catch(() => []),
    safeQuery(
      `
      SELECT DISTINCT ON (al.employee_id)
        al.employee_id,
        al.check_in_at,
        al.check_out_at,
        al.check_in,
        al.check_out,
        al.status,
        al.late_minutes,
        al.updated_at
      FROM attendance_logs al
      WHERE al.attendance_date = CURRENT_DATE
        AND ($1::bigint IS NULL OR al.tenant_id = $1::bigint)
        ${branchId ? "AND al.branch_id = $2::bigint" : ""}
      ORDER BY al.employee_id, al.updated_at DESC, al.id DESC
      `,
      branchId ? [tenantId, branchId] : [tenantId],
      []
    ),
    tableExists("employee_advances").then((advancesExist) => {
      if (!advancesExist) return [];
      return safeQuery(
        `
        SELECT
          ranked.employee_id,
          COALESCE(SUM(COALESCE(ranked.remaining_amount, ranked.amount, 0)), 0) AS total_advances
        FROM (
          SELECT
            ea.employee_id,
            ea.amount,
            ea.remaining_amount,
            ROW_NUMBER() OVER (PARTITION BY ea.employee_id ORDER BY ea.created_at DESC, ea.id DESC) AS row_number
          FROM employee_advances ea
          WHERE ($1::bigint IS NULL OR ea.tenant_id = $1::bigint)
        ) ranked
        WHERE ranked.row_number <= 20
        GROUP BY ranked.employee_id
        `,
        [tenantId],
        []
      );
    }).catch(() => []),
    listEmployeePortalRequests({ tenantId, status: "pending", limit: 200 }).catch(() => []),
    safeQuery(
      `
      SELECT e.id AS employee_id, e.photo_url
      FROM employees e
      WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
        AND e.photo_url IS NOT NULL AND e.photo_url <> ''
      `,
      [tenantId],
      []
    ).catch(() => []),
  ]);

  const photoByEmployee = new Map((photoRows || []).map((row) => [String(row.employee_id), row.photo_url]));
  const salesByEmployee = new Map(salesRows.map((row) => [String(row.employee_id), row]));
  const attendanceByEmployee = new Map(attendanceRows.map((row) => [String(row.employee_id), row]));
  const advancesByEmployee = new Map(advanceRows.map((row) => [String(row.employee_id), row]));

  const staff = (taskDashboard?.byEmployee || []).map((row) => {
    const sales = salesByEmployee.get(String(row.employee_id)) || {};
    const attendance = attendanceByEmployee.get(String(row.employee_id)) || {};
    const advances = advancesByEmployee.get(String(row.employee_id)) || {};
    const checkInTime = attendance.check_in_at || attendance.check_in || row.check_in_time || null;
    const checkOutTime = attendance.check_out_at || attendance.check_out || null;
    const attendanceStatus = attendance.status || row.attendance_status || "absent";
    const shiftEndTime = checkOutTime || (checkInTime ? new Date() : null);
    const shiftDurationHours = checkInTime && shiftEndTime
      ? Math.max(0, (new Date(shiftEndTime).getTime() - new Date(checkInTime).getTime()) / 36e5)
      : 0;
    return {
      ...row,
      photo_url: photoByEmployee.get(String(row.employee_id)) || row.photo_url || null,
      attendance_status: attendanceStatus,
      check_in_time: checkInTime,
      check_out_time: checkOutTime,
      late_minutes: Number(attendance.late_minutes || 0),
      shift_duration_hours: Number(shiftDurationHours.toFixed(2)),
      total_advances: Number(advances.total_advances || 0),
      sales_today: Number(sales.sales_total || 0),
      invoices_count: Number(sales.invoice_count || 0),
      expected_commission: null,
      open_tasks: Number(row.open_tasks || 0),
      completed_tasks: Number(row.completed_tasks || 0),
      last_activity: attendance.updated_at || row.online_last_seen_at || row.check_in_time || null,
    };
  });

  const staffEmployeeIds = new Set(staff.map((employee) => String(employee.employee_id)));
  const advanceRequests = (pendingPortalRequests || []).filter((request) => (
    clean(request.request_type).toLowerCase() === "advance"
    && staffEmployeeIds.has(String(request.employee_id))
  ));

  return {
    summary: taskDashboard?.summary || {},
    staff,
    advance_requests: advanceRequests,
    recent_tasks: taskDashboard?.recentTasks || [],
    history: taskDashboard?.history || [],
  };
};

export const reviewManagerPortalAdvanceRequest = async ({ manager = {}, requestId, status, adminNote = "" } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const requestedStatus = clean(status).toLowerCase();
  if (!["approved", "rejected"].includes(requestedStatus)) {
    const error = new Error("Status must be approved or rejected");
    error.status = 400;
    throw error;
  }

  const staffState = await getManagerPortalStaff({ manager });
  const request = (staffState.advance_requests || []).find((item) => String(item.id) === String(requestId));
  if (!request) {
    const error = new Error("Advance request not found or already reviewed");
    error.status = 404;
    throw error;
  }

  return reviewEmployeePortalRequest({
    tenantId,
    requestId,
    status: requestedStatus,
    adminNote,
    reviewedBy: manager.user_id || manager.id || null,
    createAdvance: requestedStatus === "approved",
  });
};

export const getManagerPortalTasks = async ({ manager = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const taskDashboard = await getStaffTaskDashboard({ tenantId, branchId });
  return {
    summary: taskDashboard?.summary || {},
    tasks: repairManagerPortalPayload(taskDashboard?.recentTasks || []),
    history: repairManagerPortalPayload(taskDashboard?.history || []),
  };
};

export const getManagerPortalSales = async ({ manager = {}, profitToken = "" } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const monthFilters = { branchId, range: "month" };
  const todayFilters = { branchId, range: "today" };
  const yesterdayFilters = { branchId, range: "yesterday" };
  const hasOrders = await tableExists("orders");
  const hasOrderItems = await tableExists("order_items");
  const hasProducts = await tableExists("products");
  const hasCategories = await tableExists("categories");
  const hasBrands = await tableExists("brands");
  const hasAiSupportSessions = await tableExists("ai_support_sessions");
  const hasAiAgentConversationColumn = await columnExists("orders", "ai_agent_conversation_id");
  const hasAiAgentStatusColumn = await columnExists("orders", "ai_agent_status");

  const [overview, trend7d, hourly, topProducts, recentInvoices, aiInsights, comparisonRows, sellerRows, categoryRows, brandRows, customerConversionRows, aiConversionRows, todayProfit, yesterdayProfit] = await Promise.all([
    getDashboardOverview({ tenantId, filters: monthFilters }),
    getSalesTrend({ tenantId, filters: monthFilters, days: 31 }),
    getHourlySales({ tenantId, filters: monthFilters }),
    getTopProducts({ tenantId, filters: monthFilters }),
    tableExists("orders").then((exists) => (exists ? safeQuery(
      `
      SELECT id, invoice_number, customer_name, COALESCE(total_amount, total, 0) AS total, payment_status, created_at
      FROM orders
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        ${branchId ? "AND branch_id = $2::bigint" : ""}
      ORDER BY created_at DESC
      LIMIT 12
      `,
      branchId ? [tenantId, branchId] : [tenantId],
      []
    ) : [])).catch(() => []),
    getAiInsights({ tenantId }),
    hasOrders
      ? safeQuery(
          `
          SELECT
            COALESCE(SUM(CASE WHEN o.created_at >= CURRENT_DATE AND o.created_at < CURRENT_DATE + INTERVAL '1 day' THEN COALESCE(o.total_amount, o.total, 0) ELSE 0 END), 0) AS today_sales,
            COUNT(*) FILTER (WHERE o.created_at >= CURRENT_DATE AND o.created_at < CURRENT_DATE + INTERVAL '1 day')::int AS today_orders,
            COALESCE(AVG(NULLIF(COALESCE(o.total_amount, o.total, 0), 0)) FILTER (WHERE o.created_at >= CURRENT_DATE AND o.created_at < CURRENT_DATE + INTERVAL '1 day'), 0) AS today_aov,
            COALESCE(SUM(CASE WHEN o.created_at >= CURRENT_DATE - INTERVAL '1 day' AND o.created_at < CURRENT_DATE THEN COALESCE(o.total_amount, o.total, 0) ELSE 0 END), 0) AS yesterday_sales,
            COUNT(*) FILTER (WHERE o.created_at >= CURRENT_DATE - INTERVAL '1 day' AND o.created_at < CURRENT_DATE)::int AS yesterday_orders,
            COALESCE(AVG(NULLIF(COALESCE(o.total_amount, o.total, 0), 0)) FILTER (WHERE o.created_at >= CURRENT_DATE - INTERVAL '1 day' AND o.created_at < CURRENT_DATE), 0) AS yesterday_aov
          FROM orders o
          WHERE LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
            ${branchId ? "AND o.branch_id = $2::bigint" : ""}
            AND ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
            AND o.created_at >= CURRENT_DATE - INTERVAL '1 day'
            AND o.created_at < CURRENT_DATE + INTERVAL '1 day'
          `,
          branchId ? [tenantId, branchId] : [tenantId],
          [],
        )
      : [],
    hasOrders
      ? safeQuery(
          `
          SELECT
            COALESCE(o.sales_employee_id, o.seller_user_id, o.created_by)::text AS seller_key,
            COALESCE(NULLIF(e.full_name, ''), NULLIF(o.seller_name, ''), 'Unassigned seller') AS seller_name,
            COUNT(DISTINCT o.id)::int AS orders_count,
            COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS revenue
          FROM orders o
          LEFT JOIN employees e ON e.id = o.sales_employee_id
          WHERE LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
            AND o.created_at >= date_trunc('month', CURRENT_DATE)
            ${branchId ? "AND o.branch_id = $2::bigint" : ""}
            AND ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
          GROUP BY COALESCE(o.sales_employee_id, o.seller_user_id, o.created_by)::text, COALESCE(NULLIF(e.full_name, ''), NULLIF(o.seller_name, ''), 'Unassigned seller')
          HAVING COUNT(DISTINCT o.id) > 0
          ORDER BY revenue DESC, orders_count DESC, seller_name ASC
          `,
          branchId ? [tenantId, branchId] : [tenantId],
          [],
        )
      : [],
    hasOrderItems && hasProducts
      ? safeQuery(
          `
          SELECT
            COALESCE(NULLIF(c.name, ''), NULLIF(p.product_type, ''), 'Uncategorized') AS name,
            COALESCE(SUM(oi.quantity), 0)::int AS quantity,
            COALESCE(SUM(COALESCE(oi.total_amount, oi.price * oi.quantity, oi.sale_price * oi.quantity, 0)), 0) AS revenue
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN products p ON p.id = oi.product_id
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
            AND o.created_at >= date_trunc('month', CURRENT_DATE)
            ${branchId ? "AND o.branch_id = $2::bigint" : ""}
            AND ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
          GROUP BY COALESCE(NULLIF(c.name, ''), NULLIF(p.product_type, ''), 'Uncategorized')
          ORDER BY revenue DESC, quantity DESC, name ASC
          LIMIT 1
          `,
          branchId ? [tenantId, branchId] : [tenantId],
          [],
        )
      : [],
    hasOrderItems && hasProducts && hasBrands
      ? safeQuery(
          `
          SELECT
            COALESCE(NULLIF(b.name, ''), 'Unbranded') AS name,
            COALESCE(SUM(oi.quantity), 0)::int AS quantity,
            COALESCE(SUM(COALESCE(oi.total_amount, oi.price * oi.quantity, oi.sale_price * oi.quantity, 0)), 0) AS revenue
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN products p ON p.id = oi.product_id
          LEFT JOIN brands b ON b.id = p.brand_id
          WHERE LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
            AND o.created_at >= date_trunc('month', CURRENT_DATE)
            ${branchId ? "AND o.branch_id = $2::bigint" : ""}
            AND ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
          GROUP BY COALESCE(NULLIF(b.name, ''), 'Unbranded')
          ORDER BY revenue DESC, quantity DESC, name ASC
          LIMIT 1
          `,
          branchId ? [tenantId, branchId] : [tenantId],
          [],
        )
      : [],
    hasOrders
      ? safeQuery(
          `
          SELECT
            COUNT(*)::int AS total_orders,
            COUNT(*) FILTER (WHERE o.customer_id IS NOT NULL)::int AS customer_linked_orders,
            COALESCE(ROUND(COUNT(*) FILTER (WHERE o.customer_id IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100, 2), 0) AS customer_link_rate,
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(o.channel, '')) IN ('web_chat', 'website', 'storefront', 'online', 'instagram', 'facebook', 'whatsapp')
            )::int AS online_orders,
            COALESCE(ROUND(COUNT(*) FILTER (
              WHERE LOWER(COALESCE(o.channel, '')) IN ('web_chat', 'website', 'storefront', 'online', 'instagram', 'facebook', 'whatsapp')
            )::numeric / NULLIF(COUNT(*), 0) * 100, 2), 0) AS online_order_share
          FROM orders o
          WHERE LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
            AND o.created_at >= date_trunc('month', CURRENT_DATE)
            ${branchId ? "AND o.branch_id = $2::bigint" : ""}
            AND ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
          `,
          branchId ? [tenantId, branchId] : [tenantId],
          [],
        )
      : [],
    hasAiSupportSessions && hasAiAgentConversationColumn && hasAiAgentStatusColumn && hasOrders
      ? safeQuery(
          `
          WITH sessions AS (
            SELECT s.session_id
            FROM ai_support_sessions s
            WHERE ($1::bigint IS NULL OR s.tenant_id = $1::bigint)
              AND s.created_at >= date_trunc('month', CURRENT_DATE)
          ),
          converted AS (
            SELECT DISTINCT o.ai_agent_conversation_id AS session_id
            FROM orders o
            WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
              AND o.created_at >= date_trunc('month', CURRENT_DATE)
              AND o.ai_agent_status = 'confirmed'
              AND COALESCE(o.ai_agent_conversation_id, '') <> ''
          )
          SELECT
            COUNT(*)::int AS ai_sessions,
            COUNT(converted.session_id)::int AS ai_confirmed_orders,
            COALESCE(ROUND(COUNT(converted.session_id)::numeric / NULLIF(COUNT(*), 0) * 100, 2), 0) AS ai_conversion_rate
          FROM sessions
          LEFT JOIN converted ON converted.session_id = sessions.session_id
          `,
          [tenantId],
          [],
        )
      : [],
    calculateTodayProfit({ tenantId, filters: todayFilters }),
    calculateTodayProfit({ tenantId, filters: yesterdayFilters }),
  ]);
  const rawDailyProfit = Number(todayProfit || 0);
  const rawYesterdayProfit = Number(yesterdayProfit || 0);
  const rawProfitGrowth = rawYesterdayProfit !== 0
    ? ((rawDailyProfit - rawYesterdayProfit) / Math.abs(rawYesterdayProfit)) * 100
    : rawDailyProfit !== 0 ? 100 : 0;
  const dailyProfitAuthorized = await resolveProfitOk(manager, profitToken);
  if (!dailyProfitAuthorized) nullProfitFieldsInOverview(overview);
  const comparison = comparisonRows[0] || {};
  const sellerStats = sellerRows || [];
  const topSeller = sellerStats[0] || null;
  const worstSeller = sellerStats.length > 1 ? sellerStats[sellerStats.length - 1] : sellerStats[0] || null;
  const bestCategory = categoryRows[0] || null;
  const bestBrand = brandRows[0] || null;
  const conversionSummary = customerConversionRows[0] || {};
  const aiConversionSummary = aiConversionRows[0] || {};
  return {
    daily_profit: buildDailyProfitBlock({ authorized: dailyProfitAuthorized, profit: rawDailyProfit, sales: Number(comparison.today_sales || 0), changePercent: rawProfitGrowth }),
    overview,
    trend: trend7d,
    trend_7d: trend7d,
    hourly,
    top_products: topProducts,
    recent_invoices: recentInvoices,
    ai_insights: dailyProfitAuthorized ? aiInsights : stripProfitFromInsights(aiInsights),
    comparison: {
      today_sales: Number(comparison.today_sales ?? 0),
      yesterday_sales: Number(comparison.yesterday_sales || 0),
      today_orders: Number(comparison.today_orders ?? 0),
      yesterday_orders: Number(comparison.yesterday_orders || 0),
      today_average_invoice: Number(comparison.today_aov ?? 0),
      yesterday_average_invoice: Number(comparison.yesterday_aov || 0),
      sales_delta: Number(comparison.today_sales || 0) - Number(comparison.yesterday_sales || 0),
      orders_delta: Number(comparison.today_orders || 0) - Number(comparison.yesterday_orders || 0),
      average_invoice_delta: Number(comparison.today_aov || 0) - Number(comparison.yesterday_aov || 0),
      sales_growth: Number(comparison.yesterday_sales || 0) > 0 ? ((Number(comparison.today_sales || 0) - Number(comparison.yesterday_sales || 0)) / Number(comparison.yesterday_sales || 0)) * 100 : Number(comparison.today_sales || 0) ? 100 : 0,
      orders_growth: Number(comparison.yesterday_orders || 0) > 0 ? ((Number(comparison.today_orders || 0) - Number(comparison.yesterday_orders || 0)) / Number(comparison.yesterday_orders || 0)) * 100 : Number(comparison.today_orders || 0) ? 100 : 0,
      average_invoice_growth: Number(comparison.yesterday_aov || 0) > 0 ? ((Number(comparison.today_aov || 0) - Number(comparison.yesterday_aov || 0)) / Number(comparison.yesterday_aov || 0)) * 100 : Number(comparison.today_aov || 0) ? 100 : 0,
    },
    leaders: {
      top_seller: topSeller,
      worst_seller: worstSeller,
    },
    best_category: bestCategory,
    best_brand: bestBrand,
    conversion_indicators: {
      customer_linked_orders: Number(conversionSummary.customer_linked_orders || 0),
      customer_link_rate: Number(conversionSummary.customer_link_rate || 0),
      online_orders: Number(conversionSummary.online_orders || 0),
      online_order_share: Number(conversionSummary.online_order_share || 0),
      ai_sessions: Number(aiConversionSummary.ai_sessions || 0),
      ai_confirmed_orders: Number(aiConversionSummary.ai_confirmed_orders || 0),
      ai_conversion_rate: Number(aiConversionSummary.ai_conversion_rate || 0),
    },
  };
};

/* ======================================================
   OPERATIONS FEED — invoice edits, returns, exchanges
   Every operation that moves goods or money AFTER the sale
   was rung up, with the money trail attached: which drawer
   shift took (or gave back) the difference, and how much.
====================================================== */

const OPERATION_RANGES = {
  today: "CREATED_AT >= CURRENT_DATE",
  yesterday: "CREATED_AT >= CURRENT_DATE - INTERVAL '1 day'",
  week: "CREATED_AT >= CURRENT_DATE - INTERVAL '7 days'",
  month: "CREATED_AT >= CURRENT_DATE - INTERVAL '30 days'",
  all: "TRUE",
};

const operationRangeClause = (range = "month", column = "a.created_at") => {
  const key = lower(range) || "month";
  const template = OPERATION_RANGES[key] || OPERATION_RANGES.month;
  return template.replaceAll("CREATED_AT", column);
};

// Credit carried over from the invoice being replaced is not money the customer handed
// over, so it can never answer "دفع الفرق إزاي؟" — only the real tenders can. A split
// settlement keeps every method instead of collapsing to whichever one came first.
const CREDIT_PAYMENT_METHODS = ["exchange_credit", "return_credit", "store_credit"];
const settlementMethodsFromBreakdown = (breakdown, fallbackMethod = "", fallbackAmount = 0) => {
  let rows = breakdown;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows || "[]"); } catch { rows = []; }
  }
  const totals = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const method = lower(clean(row?.method || row?.payment_method));
    const amount = toNumber(row?.amount);
    if (!method || CREDIT_PAYMENT_METHODS.includes(method) || amount <= 0.009) continue;
    totals.set(method, Number(((totals.get(method) || 0) + amount).toFixed(2)));
  }
  if (!totals.size) {
    const method = lower(clean(fallbackMethod));
    const amount = toNumber(fallbackAmount);
    return method && amount > 0.009 ? [{ method, amount: Number(amount.toFixed(2)) }] : [];
  }
  return Array.from(totals, ([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount);
};

const cashEventLabel = (eventType = "") => {
  const key = lower(eventType);
  if (key === "cash_in") return "نقدية دخلت الدرج";
  if (key === "refund_cash" || key === "cash_out") return "نقدية خرجت من الدرج";
  return key;
};

// The one question a manager actually asks about an edit: did the drawer see the
// difference? A settlement with no ledger row at all is money that moved on the
// invoice but never in the till, and that is what `balanced: false` flags.
const buildOperationMoneyTrail = ({ cashEvent = null, accountEntry = null, expectedDifference = 0 } = {}) => {
  const cashAmount = cashEvent ? toNumber(cashEvent.amount) : 0;
  const accountAmount = accountEntry ? Math.abs(toNumber(accountEntry.amount)) : 0;
  const recorded = cashAmount || accountAmount;
  const expected = Math.abs(toNumber(expectedDifference));
  return {
    recorded_in_shift: Boolean(cashEvent?.shift_id),
    shift_id: numberOrNull(cashEvent?.shift_id),
    shift_opened_at: cashEvent?.shift_opened_at || null,
    shift_status: clean(cashEvent?.shift_status || ""),
    shift_cashier_name: repairManagerPortalPayload(clean(cashEvent?.shift_cashier_name || "")),
    cash_event_type: clean(cashEvent?.event_type || ""),
    cash_event_label: cashEvent ? cashEventLabel(cashEvent.event_type) : "",
    cash_amount: cashAmount,
    account_amount: accountAmount,
    account_name: repairManagerPortalPayload(clean(accountEntry?.financial_account_name || "")),
    recorded_amount: recorded,
    expected_amount: expected,
    // Deferred difference (آجل / رصيد للعميل) is legitimately absent from the drawer,
    // so only flag a gap when money was supposed to change hands right now.
    balanced: expected <= 0.009 ? true : Math.abs(recorded - expected) <= 0.009,
  };
};

const emptyOperationsSummary = () => ({
  total: 0,
  edits: 0,
  returns: 0,
  exchanges: 0,
  refunded_amount: 0,
  collected_amount: 0,
  unbalanced: 0,
});

const summarizeOperations = (operations = []) => {
  const summary = emptyOperationsSummary();
  for (const operation of operations) {
    summary.total += 1;
    if (operation.kind === "edit") summary.edits += 1;
    if (operation.kind === "return") summary.returns += 1;
    if (operation.kind === "exchange") summary.exchanges += 1;
    const difference = toNumber(operation.difference);
    if (difference < 0) summary.refunded_amount += Math.abs(difference);
    if (difference > 0) summary.collected_amount += difference;
    if (operation.money && operation.money.balanced === false) summary.unbalanced += 1;
  }
  summary.refunded_amount = Number(summary.refunded_amount.toFixed(2));
  summary.collected_amount = Number(summary.collected_amount.toFixed(2));
  return summary;
};

const buildCashEvent = (row = {}) =>
  row.cash_shift_id || row.cash_event_type
    ? {
        event_type: row.cash_event_type,
        amount: row.cash_amount,
        shift_id: row.cash_shift_id,
        shift_opened_at: row.cash_shift_opened_at,
        shift_status: row.cash_shift_status,
        shift_cashier_name: row.cash_shift_cashier_name,
      }
    : null;

const buildAccountEntry = (row = {}) =>
  row.account_amount !== null && row.account_amount !== undefined
    ? { amount: row.account_amount, financial_account_name: row.account_name }
    : null;

// A POS edit snapshot is whatever the till posted. When it carried the ids but not
// the product_name, the diff can only say "منتج" — useless to a manager reviewing an
// exchange. One lookup over every unnamed line in the page fills them back in.
const resolveMissingOperationItemNames = async (operations = []) => {
  const unnamed = [];
  for (const operation of operations) {
    for (const item of [...(operation.items_out || []), ...(operation.items_in || [])]) {
      if (clean(item.name) && clean(item.name) !== "منتج") continue;
      if (!item.variant_id && !item.product_id) continue;
      unnamed.push(item);
    }
  }
  if (!unnamed.length) return;

  const variantIds = [...new Set(unnamed.map((item) => numberOrNull(item.variant_id)).filter(Boolean))];
  const productIds = [...new Set(unnamed.map((item) => numberOrNull(item.product_id)).filter(Boolean))];
  const [variantRows, productRows] = await Promise.all([
    variantIds.length && (await tableExists("product_variants"))
      ? safeQuery(
          `
          SELECT pv.id, COALESCE(NULLIF(p.name, ''), '') AS product_name,
                 COALESCE(NULLIF(pv.color, ''), '') AS color,
                 COALESCE(NULLIF(pv.size, ''), '') AS size
          FROM product_variants pv
          LEFT JOIN products p ON p.id = pv.product_id
          WHERE pv.id = ANY($1::bigint[])
          `,
          [variantIds],
          []
        )
      : [],
    productIds.length && (await tableExists("products"))
      ? safeQuery(`SELECT id, COALESCE(NULLIF(name, ''), '') AS name FROM products WHERE id = ANY($1::bigint[])`, [productIds], [])
      : [],
  ]);

  const byVariant = new Map(variantRows.map((row) => [
    String(row.id),
    [clean(row.product_name), [clean(row.color), clean(row.size)].filter(Boolean).join(" / ")].filter(Boolean).join(" · "),
  ]));
  const byProduct = new Map(productRows.map((row) => [String(row.id), clean(row.name)]));

  for (const item of unnamed) {
    const resolved = byVariant.get(String(item.variant_id)) || byProduct.get(String(item.product_id)) || "";
    if (resolved) item.name = repairManagerPortalPayload(resolved);
  }
};

export const getManagerPortalOperations = async ({ manager = {}, query = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const range = lower(query.range || "month") || "month";
  const limit = Math.min(Math.max(Number(query.limit) || 60, 1), 200);
  const kindFilter = lower(query.kind || "all") || "all";

  const [hasOrders, hasEdits, hasReturns, hasReturnItems, hasCashEvents, hasAccountEntries, hasExchangeColumn, hasDisposition, hasPaymentMethod, hasPaymentBreakdown] = await Promise.all([
    tableExists("orders"),
    tableExists("order_edit_audits"),
    tableExists("returns"),
    tableExists("return_items"),
    tableExists("cash_drawer_shift_events"),
    tableExists("financial_account_entries"),
    columnExists("orders", "exchange_mode"),
    columnExists("returns", "disposition"),
    columnExists("orders", "payment_method"),
    columnExists("orders", "payment_breakdown"),
  ]);
  if (!hasOrders) return { operations: [], summary: emptyOperationsSummary(), range, kind: kindFilter, total: 0 };

  const branchClause = branchId ? "AND o.branch_id = $2::bigint" : "";
  const params = branchId ? [tenantId, branchId] : [tenantId];

  const cashJoinTemplate = hasCashEvents
    ? `
      LEFT JOIN LATERAL (
        SELECT ev.event_type, ev.amount, ev.shift_id, ev.created_at,
               sh.opened_at AS shift_opened_at,
               sh.status AS shift_status,
               COALESCE(NULLIF(su.name, ''), NULLIF(su.email, ''), '') AS shift_cashier_name
        FROM cash_drawer_shift_events ev
        LEFT JOIN cash_drawer_shifts sh ON sh.id = ev.shift_id
        LEFT JOIN users su ON su.id = sh.opened_by
        WHERE ev.source_type = '__SOURCE_TYPE__'
          AND ev.source_id = __SOURCE_ID__
          AND ($1::bigint IS NULL OR ev.tenant_id = $1::bigint)
        ORDER BY ev.id ASC
        LIMIT 1
      ) cash ON TRUE`
    : "";
  const accountJoinTemplate = hasAccountEntries
    ? `
      LEFT JOIN LATERAL (
        SELECT fe.amount, fe.entry_type, COALESCE(fa.name, '') AS financial_account_name
        FROM financial_account_entries fe
        LEFT JOIN financial_accounts fa ON fa.id = fe.financial_account_id
        WHERE fe.source_type = '__SOURCE_TYPE__'
          AND fe.source_id = __SOURCE_ID__
          AND ($1::bigint IS NULL OR fe.tenant_id = $1::bigint)
        ORDER BY fe.id ASC
        LIMIT 1
      ) acct ON TRUE`
    : "";
  const bindLateral = (sql, sourceType, sourceIdExpr) =>
    sql.replaceAll("__SOURCE_TYPE__", sourceType).replaceAll("__SOURCE_ID__", sourceIdExpr);

  const cashSelect = hasCashEvents
    ? `cash.event_type AS cash_event_type, cash.amount AS cash_amount, cash.shift_id AS cash_shift_id,
       cash.shift_opened_at AS cash_shift_opened_at, cash.shift_status AS cash_shift_status,
       cash.shift_cashier_name AS cash_shift_cashier_name,`
    : `NULL::text AS cash_event_type, NULL::numeric AS cash_amount, NULL::bigint AS cash_shift_id,
       NULL::timestamp AS cash_shift_opened_at, NULL::text AS cash_shift_status,
       NULL::text AS cash_shift_cashier_name,`;
  const accountSelect = hasAccountEntries
    ? `acct.amount AS account_amount, acct.financial_account_name AS account_name,`
    : `NULL::numeric AS account_amount, NULL::text AS account_name,`;

  const editRows = hasEdits
    ? await safeQuery(
        `
        SELECT
          a.id, a.order_id, a.old_items, a.new_items, a.old_total, a.new_total, a.reason, a.created_at,
          COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'غير معروف') AS actor_name,
          o.invoice_number, o.customer_name, o.customer_phone, o.branch_id,
          COALESCE(o.total_amount, o.total, 0) AS order_total,
          o.edit_payment_difference,
          o.shift_id AS order_shift_id,
          COALESCE(b.name, '') AS branch_name,
          ${cashSelect}
          ${accountSelect}
          a.id AS audit_id
        FROM order_edit_audits a
        JOIN orders o ON o.id = a.order_id
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN branches b ON b.id = o.branch_id
        ${bindLateral(cashJoinTemplate, "order_edit", "a.id")}
        ${bindLateral(accountJoinTemplate, "order_edit", "a.id")}
        WHERE ($1::bigint IS NULL OR a.tenant_id = $1::bigint OR a.tenant_id IS NULL)
          ${branchClause}
          AND ${operationRangeClause(range, "a.created_at")}
        ORDER BY a.created_at DESC
        LIMIT ${limit}
        `,
        params,
        []
      )
    : [];

  const returnRows = hasReturns
    ? await safeQuery(
        `
        SELECT
          r.id, r.order_id, r.return_number, r.reason, r.refund_amount, r.refund_method,
          COALESCE(r.exchange_difference, 0) AS exchange_difference,
          r.restock, ${hasDisposition ? "COALESCE(r.disposition, '')" : "''"} AS disposition,
          r.metadata, r.created_at, r.shift_id AS return_shift_id,
          COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'غير معروف') AS actor_name,
          o.invoice_number, o.customer_name, o.customer_phone, o.branch_id,
          COALESCE(o.total_amount, o.total, 0) AS order_total,
          o.shift_id AS order_shift_id,
          COALESCE(b.name, '') AS branch_name,
          ${cashSelect}
          ${accountSelect}
          r.id AS return_row_id
        FROM returns r
        JOIN orders o ON o.id = r.order_id
        LEFT JOIN users u ON u.id = r.created_by
        LEFT JOIN branches b ON b.id = o.branch_id
        ${bindLateral(cashJoinTemplate, "return", "r.id")}
        ${bindLateral(accountJoinTemplate, "return", "r.id")}
        WHERE ($1::bigint IS NULL OR r.tenant_id = $1::bigint OR r.tenant_id IS NULL)
          ${branchClause}
          AND ${operationRangeClause(range, "r.created_at")}
        ORDER BY r.created_at DESC
        LIMIT ${limit}
        `,
        params,
        []
      )
    : [];

  const returnIds = returnRows.map((row) => Number(row.id)).filter(Boolean);
  const returnItemRows = hasReturnItems && returnIds.length
    ? await safeQuery(
        `
        SELECT ri.return_id, ri.quantity, ri.refund_amount, ri.restock, oi.variant_id,
               COALESCE(NULLIF(oi.product_name, ''), 'منتج') AS product_name
        FROM return_items ri
        LEFT JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE ri.return_id = ANY($1::bigint[])
        `,
        [returnIds],
        []
      )
    : [];
  const returnItemsByReturn = new Map();
  for (const row of returnItemRows) {
    const key = String(row.return_id);
    const quantity = toNumber(row.quantity);
    const list = returnItemsByReturn.get(key) || [];
    list.push({
      name: repairManagerPortalPayload(clean(row.product_name)),
      variant_id: numberOrNull(row.variant_id),
      quantity,
      line_total: toNumber(row.refund_amount),
      price: quantity > 0 ? Number((toNumber(row.refund_amount) / quantity).toFixed(2)) : toNumber(row.refund_amount),
      restock: Boolean(row.restock),
    });
    returnItemsByReturn.set(key, list);
  }

  const exchangeOrderRows = hasExchangeColumn
    ? await safeQuery(
        `
        SELECT
          o.id, o.invoice_number, o.customer_name, o.customer_phone, o.branch_id, o.created_at,
          COALESCE(o.total_amount, o.total, 0) AS order_total,
          COALESCE(o.exchange_credit_amount, 0) AS exchange_credit_amount,
          COALESCE(o.exchange_difference, 0) AS exchange_difference,
          COALESCE(o.exchange_invoice_number, '') AS exchange_invoice_number,
          COALESCE(o.paid_amount, 0) AS paid_amount,
          ${hasPaymentMethod ? "COALESCE(o.payment_method, '')" : "''"} AS payment_method,
          ${hasPaymentBreakdown ? "COALESCE(o.payment_breakdown, '[]'::jsonb)" : "'[]'::jsonb"} AS payment_breakdown,
          o.shift_id AS order_shift_id,
          COALESCE(b.name, '') AS branch_name,
          COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), NULLIF(o.cashier_name, ''), 'غير معروف') AS actor_name
        FROM orders o
        LEFT JOIN branches b ON b.id = o.branch_id
        LEFT JOIN users u ON u.id = o.created_by
        WHERE COALESCE(o.exchange_mode, FALSE) = TRUE
          AND ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
          ${branchClause}
          AND ${operationRangeClause(range, "o.created_at")}
        ORDER BY o.created_at DESC
        LIMIT ${limit}
        `,
        params,
        []
      )
    : [];

  const exchangeOrderIds = exchangeOrderRows.map((row) => Number(row.id)).filter(Boolean);
  const exchangeItemRows = exchangeOrderIds.length
    ? await safeQuery(
        `
        SELECT oi.order_id, oi.quantity, oi.variant_id, COALESCE(NULLIF(oi.product_name, ''), 'منتج') AS product_name,
               COALESCE(oi.total_amount, 0) AS total_amount
        FROM order_items oi
        WHERE oi.order_id = ANY($1::bigint[])
        `,
        [exchangeOrderIds],
        []
      )
    : [];
  const exchangeItemsByOrder = new Map();
  for (const row of exchangeItemRows) {
    const key = String(row.order_id);
    const quantity = toNumber(row.quantity);
    const list = exchangeItemsByOrder.get(key) || [];
    list.push({
      name: repairManagerPortalPayload(clean(row.product_name)),
      variant_id: numberOrNull(row.variant_id),
      quantity,
      line_total: toNumber(row.total_amount),
      price: quantity > 0 ? Number((toNumber(row.total_amount) / quantity).toFixed(2)) : toNumber(row.total_amount),
    });
    exchangeItemsByOrder.set(key, list);
  }

  const operations = [];

  for (const row of editRows) {
    const oldTotal = toNumber(row.old_total);
    const newTotal = toNumber(row.new_total);
    const difference = Number((newTotal - oldTotal).toFixed(2));
    const diff = diffOperationItems(row.old_items, row.new_items);
    // Item names come out of a JSONB snapshot written by the POS, so they carry the
    // same mojibake risk as every other stored Arabic string in this portal.
    const repairItems = (items) => items.map((item) => ({ ...item, name: repairManagerPortalPayload(item.name) }));
    diff.removed = repairItems(diff.removed);
    diff.added = repairItems(diff.added);
    const settlement = jsonObject(row.edit_payment_difference);
    // Only the newest edit owns edit_payment_difference; older audits keep their
    // totals but lose the settlement block, so match on audit id before trusting it.
    const settlementMatches = clean(settlement.edit_audit_id) === String(row.id);
    const deferred = settlementMatches ? toNumber(settlement.deferred_amount) : 0;
    const expectedCashMovement = Math.max(0, Math.abs(difference) - Math.max(0, deferred));
    // Swapping one product out and a different one in IS an exchange, whatever the
    // seller called the button. Label it by intent, not by the mechanism used.
    const looksLikeExchange = diff.comparable && diff.removed.length > 0 && diff.added.length > 0;
    operations.push({
      id: `edit-${row.id}`,
      kind: looksLikeExchange ? "exchange" : "edit",
      mechanism: "invoice_edit",
      at: row.created_at,
      order_id: Number(row.order_id),
      invoice_number: repairManagerPortalPayload(clean(row.invoice_number)) || `#${row.order_id}`,
      customer_name: repairManagerPortalPayload(clean(row.customer_name)) || "عميل",
      customer_phone: clean(row.customer_phone),
      branch_id: numberOrNull(row.branch_id),
      branch_name: repairManagerPortalPayload(clean(row.branch_name)),
      actor_name: repairManagerPortalPayload(clean(row.actor_name)),
      reason: repairManagerPortalPayload(clean(row.reason)),
      fields_only: !diff.comparable,
      old_total: oldTotal,
      new_total: newTotal,
      difference,
      items_out: diff.removed,
      items_in: diff.added,
      // One uniform field across all three mechanisms, so a reader never has to know
      // whether it is looking at an edit, a return or an exchange invoice to answer
      // "the customer paid / was paid HOW?".
      payment_methods: settlementMatches
        ? settlementMethodsFromBreakdown(
            settlement.additional_payment_breakdown,
            settlement.settlement_method,
            toNumber(settlement.collected_now) || toNumber(settlement.refund_or_credit_due) || Math.abs(difference),
          )
        : [],
      settlement: settlementMatches
        ? {
            type: clean(settlement.settlement_type),
            method: clean(settlement.settlement_method),
            collected_now: toNumber(settlement.collected_now),
            refund_or_credit_due: toNumber(settlement.refund_or_credit_due),
            deferred_amount: deferred,
            original_paid_amount: toNumber(settlement.original_paid_amount),
          }
        : null,
      money: buildOperationMoneyTrail({
        cashEvent: buildCashEvent(row),
        accountEntry: buildAccountEntry(row),
        expectedDifference: expectedCashMovement,
      }),
      order_shift_id: numberOrNull(row.order_shift_id),
    });
  }

  for (const row of returnRows) {
    const metadata = jsonObject(row.metadata);
    const exchangeDifference = toNumber(row.exchange_difference);
    const isExchange = lower(metadata.mode) === "exchange"
      || clean(row.reason).includes("استبدال")
      || Math.abs(exchangeDifference) > 0.009;
    const refundAmount = toNumber(row.refund_amount);
    const refundMethod = lower(row.refund_method) || "cash";
    const orderTotal = toNumber(row.order_total);
    operations.push({
      id: `return-${row.id}`,
      kind: isExchange ? "exchange" : "return",
      mechanism: "return",
      at: row.created_at,
      order_id: Number(row.order_id),
      return_id: Number(row.id),
      return_number: repairManagerPortalPayload(clean(row.return_number)),
      invoice_number: repairManagerPortalPayload(clean(row.invoice_number)) || `#${row.order_id}`,
      customer_name: repairManagerPortalPayload(clean(row.customer_name)) || "عميل",
      customer_phone: clean(row.customer_phone),
      branch_id: numberOrNull(row.branch_id),
      branch_name: repairManagerPortalPayload(clean(row.branch_name)),
      actor_name: repairManagerPortalPayload(clean(row.actor_name)),
      reason: repairManagerPortalPayload(clean(row.reason)),
      fields_only: false,
      old_total: orderTotal,
      new_total: Number((orderTotal - refundAmount).toFixed(2)),
      difference: Number((-refundAmount).toFixed(2)),
      refund_amount: refundAmount,
      refund_method: refundMethod,
      payment_methods: refundAmount > 0.009 ? [{ method: refundMethod, amount: refundAmount }] : [],
      exchange_difference: exchangeDifference,
      restocked: row.restock === true || lower(row.disposition) === "restock",
      disposition: clean(row.disposition),
      items_out: returnItemsByReturn.get(String(row.id)) || [],
      items_in: [],
      settlement: null,
      // A wallet / exchange-credit refund never touches a drawer: the money stays with
      // the shop as store credit, so nothing is expected in the till for it.
      money: buildOperationMoneyTrail({
        cashEvent: buildCashEvent(row),
        accountEntry: buildAccountEntry(row),
        expectedDifference: ["wallet", "customer_wallet", "exchange_credit"].includes(refundMethod) ? 0 : refundAmount,
      }),
      order_shift_id: numberOrNull(row.order_shift_id),
      return_shift_id: numberOrNull(row.return_shift_id),
    });
  }

  for (const row of exchangeOrderRows) {
    const credit = toNumber(row.exchange_credit_amount);
    const total = toNumber(row.order_total);
    const dueNow = Math.max(0, Number((total - credit).toFixed(2)));
    operations.push({
      id: `exchange-order-${row.id}`,
      kind: "exchange",
      mechanism: "exchange_invoice",
      at: row.created_at,
      order_id: Number(row.id),
      invoice_number: repairManagerPortalPayload(clean(row.invoice_number)) || `#${row.id}`,
      original_invoice_number: repairManagerPortalPayload(clean(row.exchange_invoice_number)),
      customer_name: repairManagerPortalPayload(clean(row.customer_name)) || "عميل",
      customer_phone: clean(row.customer_phone),
      branch_id: numberOrNull(row.branch_id),
      branch_name: repairManagerPortalPayload(clean(row.branch_name)),
      actor_name: repairManagerPortalPayload(clean(row.actor_name)),
      reason: "فاتورة استبدال",
      fields_only: false,
      old_total: credit,
      new_total: total,
      difference: Number((total - credit).toFixed(2)),
      exchange_credit_amount: credit,
      exchange_difference: toNumber(row.exchange_difference),
      remaining_customer_credit: Math.max(0, Number((credit - total).toFixed(2))),
      payment_method: lower(clean(row.payment_method)),
      payment_methods: settlementMethodsFromBreakdown(row.payment_breakdown, row.payment_method, dueNow),
      items_out: [],
      items_in: exchangeItemsByOrder.get(String(row.id)) || [],
      settlement: null,
      money: {
        recorded_in_shift: Boolean(row.order_shift_id),
        shift_id: numberOrNull(row.order_shift_id),
        shift_opened_at: null,
        shift_status: "",
        shift_cashier_name: "",
        cash_event_type: "",
        cash_event_label: "",
        cash_amount: 0,
        account_amount: 0,
        account_name: "",
        recorded_amount: toNumber(row.paid_amount),
        expected_amount: dueNow,
        balanced: Math.abs(toNumber(row.paid_amount) - dueNow) <= 0.009,
      },
      order_shift_id: numberOrNull(row.order_shift_id),
    });
  }

  operations.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
  const filtered = kindFilter === "all" ? operations : operations.filter((operation) => operation.kind === kindFilter);
  const page = filtered.slice(0, limit);
  await resolveMissingOperationItemNames(page);
  // Same product out and in is only readable once the size/colour is on the line.
  await attachOperationVariantLabels(page.flatMap((operation) => [...(operation.items_out || []), ...(operation.items_in || [])]));

  // Each source is capped independently, so a source that came back exactly full may
  // be hiding older rows — and then the counts below describe the window, not the
  // period. Say so rather than letting the totals read as complete.
  const truncated = [editRows, returnRows, exchangeOrderRows].some((rows) => rows.length >= limit)
    || filtered.length > page.length;

  return {
    operations: page,
    summary: summarizeOperations(operations),
    range,
    kind: kindFilter,
    total: filtered.length,
    truncated,
  };
};

/* ======================================================
   THE SHOP'S DAY, NOT THE CALENDAR'S

   A shop that trades past midnight does not have a day that ends at 00:00. Bounding this
   card by CURRENT_DATE cut the open drawer's evening off the tape the moment the calendar
   turned, while the drawer figure beside it — computed by shift_id, with no date bound —
   went on reporting the whole night. So the day here runs from one business-day start to
   the next: 04:00 → 04:00 by default, which puts a whole trading night inside one window
   and makes the midnight problem structurally impossible rather than patched around.

   The manager can also name the window outright: ?from=<instant>&to=<instant>.
====================================================== */

const DEFAULT_BUSINESS_DAY_START_HOUR = 4;
// A manager asking for a decade of invoices would time the request out and truncate against
// the row cap anyway. Wide enough for any real question, bounded enough to stay answerable.
const MAX_WINDOW_DAYS = 92;

const resolveBusinessDayStartHour = async () => {
  const stored = await getSetting("pos.business_day_start_hour", DEFAULT_BUSINESS_DAY_START_HOUR)
    .catch(() => DEFAULT_BUSINESS_DAY_START_HOUR);
  const hour = Number(stored);
  if (!Number.isFinite(hour)) return DEFAULT_BUSINESS_DAY_START_HOUR;
  return Math.min(Math.max(Math.trunc(hour), 0), 23);
};

const parseInstant = (value) => {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

/*
 * The default window is resolved in SQL, never in JS: the server process runs on UTC by
 * contract ([[app-timezone-entry-vs-storage]]) while the database session reads on Cairo, so
 * "the business day containing now" is only correct when the database answers it. `+ INTERVAL
 * '1 day'` rather than 24 hours so the window still starts at 04:00 across a DST change.
 */
const resolveDayWindow = async ({ from, to, startHour }) => {
  const requestedFrom = parseInstant(from);
  const requestedTo = parseInstant(to);

  if (requestedFrom || requestedTo) {
    const windowStart = requestedFrom || new Date(requestedTo.getTime() - 86_400_000);
    const windowEnd = requestedTo && requestedTo > windowStart
      ? requestedTo
      : new Date(windowStart.getTime() + 86_400_000);
    const maxEnd = new Date(windowStart.getTime() + MAX_WINDOW_DAYS * 86_400_000);
    return {
      windowStart,
      windowEnd: windowEnd > maxEnd ? maxEnd : windowEnd,
      isCustom: true,
    };
  }

  // NOT safeQuery. safeQuery swallows the error and returns [], and the fallback below is a
  // rolling 24 hours — which is last night plus today, i.e. indistinguishable from the very
  // bug this card was fixed for. A silent degrade here would read as "the fix did not work",
  // so the failure is logged and declared in the payload instead of being hidden.
  let row = null;
  let degraded = false;
  try {
    const result = await db.query(
      `
      SELECT day_start AS window_start, day_start + INTERVAL '1 day' AS window_end
      FROM (
        SELECT date_trunc('day', NOW() - make_interval(hours => $1::int)) + make_interval(hours => $1::int) AS day_start
      ) t
      `,
      [startHour]
    );
    row = result.rows[0] || null;
  } catch (error) {
    degraded = true;
    console.error("[manager-portal] business-day window query failed — the day card is falling back to a rolling 24 hours", {
      message: error?.message || String(error),
      code: error?.code || "",
      startHour,
    });
  }
  if (row?.window_start && row?.window_end) {
    return { windowStart: new Date(row.window_start), windowEnd: new Date(row.window_end), isCustom: false };
  }
  const now = new Date();
  return {
    windowStart: new Date(now.getTime() - 86_400_000),
    windowEnd: now,
    isCustom: false,
    degraded: degraded || true,
  };
};

// The day, read the way the shop is organised: one list of branches, each opening onto the
// drawers under it, and picking a drawer narrows the whole card to that till — its invoices,
// then its money at the bottom. The dashboard KPIs answer "the whole tenant today"; this
// answers "this drawer today", which is the question a manager asks when a close disagrees.
// Deliberately its own endpoint — heavier than the home, and it re-runs on every pick.
export const getManagerPortalDaySummary = async ({ manager = {}, query = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  // A branch-scoped manager can never widen past their own branch, whatever they send.
  const forcedBranchId = branchFilterValue(manager);
  const requestedBranchId = lower(clean(query.branch_id)) === "all" ? null : numberOrNull(query.branch_id);
  const branchId = forcedBranchId || requestedBranchId;
  const shiftId = lower(clean(query.shift_id)) === "all" ? null : numberOrNull(query.shift_id);

  const startHour = await resolveBusinessDayStartHour();
  const { windowStart, windowEnd, isCustom, degraded: windowDegraded } = await resolveDayWindow({
    from: query.from,
    to: query.to,
    startHour,
  });

  const [hasShifts, hasExpenses, hasBranches, hasCashEvents, hasReturns] = await Promise.all([
    tableExists("cash_drawer_shifts"),
    tableExists("expenses"),
    tableExists("branches"),
    tableExists("cash_drawer_shift_events"),
    tableExists("returns"),
  ]);

  // Scoped by what the manager is ALLOWED to see, never by what they currently have picked —
  // filtering this by the selection would delete every other branch from the list and strand
  // them on the one they just chose.
  const branches = hasBranches
    ? await safeQuery(
        `
        SELECT b.id, COALESCE(NULLIF(b.name, ''), 'فرع') AS name
        FROM branches b
        WHERE ($1::bigint IS NULL OR b.tenant_id = $1::bigint)
          AND ($2::bigint IS NULL OR b.id = $2::bigint)
        ORDER BY b.name ASC
        `,
        [tenantId, forcedBranchId],
        []
      )
    : [];

  // Every drawer the manager may see, for the list itself — NOT narrowed by the current pick,
  // for the same reason the branch list is not. A drawer belongs to the window if it OVERLAPS
  // it, not if it opened inside it: a shift opened at 20:00 and still running at 02:00 is one
  // trading night, and the 04:00 boundary keeps it whole.
  const shiftRows = hasShifts
    ? await safeQuery(
        `
        SELECT
          s.id, s.branch_id, s.opened_by, s.status, s.opened_at, s.closed_at,
          COALESCE(s.opening_cash, 0) AS opening_cash,
          COALESCE(s.expected_cash, 0) AS stored_expected_cash,
          s.actual_cash,
          ${hasBranches ? "COALESCE(b.name, '')" : "''"} AS branch_name,
          COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'كاشير #' || s.opened_by) AS cashier_name
        FROM cash_drawer_shifts s
        ${hasBranches ? "LEFT JOIN branches b ON b.id = s.branch_id" : ""}
        LEFT JOIN users u ON u.id = s.opened_by
        WHERE ($1::bigint IS NULL OR s.tenant_id = $1::bigint)
          AND ($2::bigint IS NULL OR s.branch_id = $2::bigint)
          AND s.opened_at < $4
          AND (s.closed_at IS NULL OR s.closed_at >= $3)
        ORDER BY s.opened_at DESC
        LIMIT 60
        `,
        [tenantId, forcedBranchId, windowStart, windowEnd],
        []
      )
    : [];

  // What the figures below cover: one drawer if picked, else every drawer in the picked
  // branch, else everything visible.
  const scopedShifts = shiftId
    ? shiftRows.filter((row) => Number(row.id) === shiftId)
    : branchId
      ? shiftRows.filter((row) => numberOrNull(row.branch_id) === branchId)
      : shiftRows;
  const scopedShiftIds = scopedShifts.map((row) => Number(row.id)).filter(Boolean);

  // Picking a drawer scopes by shift_id ALONE — a sale rung on another till in the same branch
  // is not this drawer's money, however much the branch matches. It also drops the time bound:
  // a picked drawer IS the window, and it has to be, because the drawer figure at the bottom
  // is computed over the whole shift. Windowing the tape but not the total is how the two came
  // to disagree in the first place.
  const orderParams = [tenantId];
  let orderScopeClause = "";
  let orderWindowClause = "";
  if (shiftId) {
    orderParams.push(shiftId);
    orderScopeClause = ` AND o.shift_id = $${orderParams.length}`;
  } else {
    orderParams.push(windowStart, windowEnd);
    orderWindowClause = ` AND o.created_at >= $${orderParams.length - 1} AND o.created_at < $${orderParams.length}`;
    if (branchId) {
      orderParams.push(branchId);
      orderScopeClause = ` AND o.branch_id = $${orderParams.length}`;
    }
  }
  const orderRows = await safeQuery(
    `
    SELECT
      o.id,
      COALESCE(NULLIF(o.invoice_number, ''), '#' || o.id) AS invoice_number,
      COALESCE(NULLIF(o.customer_name, ''), '') AS customer_name,
      COALESCE(NULLIF(o.seller_name, ''), NULLIF(o.salesperson_name, ''), NULLIF(o.cashier_name, ''), '') AS seller_name,
      o.created_at,
      COALESCE(NULLIF(o.payment_method, ''), 'unknown') AS payment_method,
      COALESCE(o.total_amount, o.total, 0) AS total_amount,
      COALESCE(o.payment_breakdown, '[]'::jsonb) AS payment_breakdown,
      COALESCE(o.cash_amount, 0) AS cash_amount,
      COALESCE(o.card_amount, 0) AS card_amount,
      COALESCE(o.wallet_payment_amount, 0) AS wallet_payment_amount
    FROM orders o
    WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
      AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
      ${personalOrderClause("o")}
      ${orderWindowClause}
      ${orderScopeClause}
    ORDER BY o.created_at DESC
    LIMIT 300
    `,
    orderParams,
    []
  );

  const expenseParams = [tenantId];
  let expenseScopeClause = "";
  let expenseWindowClause = "";
  if (shiftId) {
    expenseParams.push(shiftId);
    expenseScopeClause = ` AND e.shift_id = $${expenseParams.length}`;
  } else {
    expenseParams.push(windowStart, windowEnd);
    expenseWindowClause = ` AND COALESCE(e.created_at, e.expense_date::timestamptz) >= $${expenseParams.length - 1}`
      + ` AND COALESCE(e.created_at, e.expense_date::timestamptz) < $${expenseParams.length}`;
    if (branchId) {
      expenseParams.push(branchId);
      expenseScopeClause = ` AND e.branch_id = $${expenseParams.length}`;
    }
  }
  const expenseRows = hasExpenses
    ? await safeQuery(
        `
        SELECT
          e.id,
          COALESCE(NULLIF(e.title, ''), 'مصروف') AS title,
          COALESCE(e.amount, 0) AS amount,
          COALESCE(NULLIF(e.payment_method, ''), 'cash') AS payment_method,
          COALESCE(e.category, '') AS category,
          COALESCE(e.expense_type, '') AS expense_type,
          COALESCE(e.notes, '') AS notes,
          e.created_at,
          e.shift_id,
          ${hasBranches ? "COALESCE(b.name, '')" : "''"} AS branch_name,
          COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), '') AS created_by_name,
          (
            LOWER(COALESCE(e.expense_type, '')) IN ('employee_advance', 'employee advance', 'advance', 'staff advance')
            OR LOWER(COALESCE(e.category, '')) IN ('employee_advance', 'employee advance', 'advance', 'staff advance')
          ) AS is_employee_advance
        FROM expenses e
        ${hasBranches ? "LEFT JOIN branches b ON b.id = e.branch_id" : ""}
        LEFT JOIN users u ON u.id = e.created_by
        WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
          AND LOWER(COALESCE(e.status, '')) NOT IN ('rejected', 'cancelled', 'canceled', 'void')
          ${expenseWindowClause}
          ${expenseScopeClause}
        ORDER BY e.created_at DESC
        LIMIT 200
        `,
        expenseParams,
        []
      )
    : [];

  // The drawer figure has ONE definition, and it is buildPosShiftReport's net_cash_expected:
  // opening + cash sales + cash-in − cash expenses − cash returns − cash-out. Reproduced here
  // as laterals so N shifts cost one round trip instead of N reports — keep the two in step.
  const allShiftIds = shiftRows.map((row) => Number(row.id)).filter(Boolean);
  const drawerRows = allShiftIds.length
    ? await safeQuery(
        `
        SELECT
          s.id,
          COALESCE(s.opening_cash, 0)
            + COALESCE(sales.cash_total, 0)
            + COALESCE(ev.cash_in, 0)
            - COALESCE(exp.cash_total, 0)
            - COALESCE(ret.cash_total, 0)
            - COALESCE(ev.cash_out, 0) AS expected_cash
        FROM cash_drawer_shifts s
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(COALESCE(o.cash_amount, 0)), 0) AS cash_total
          FROM orders o
          WHERE o.shift_id = s.id
            AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
            AND COALESCE(o.is_personal_transaction, FALSE) = FALSE
        ) sales ON TRUE
        ${hasCashEvents ? `
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(e.amount) FILTER (WHERE LOWER(COALESCE(e.event_type, '')) = 'cash_in'), 0) AS cash_in,
            COALESCE(SUM(e.amount) FILTER (WHERE LOWER(COALESCE(e.event_type, '')) = 'cash_out'), 0) AS cash_out
          FROM cash_drawer_shift_events e
          WHERE e.shift_id = s.id
        ) ev ON TRUE` : "LEFT JOIN LATERAL (SELECT 0 AS cash_in, 0 AS cash_out) ev ON TRUE"}
        ${hasExpenses ? `
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(x.amount) FILTER (WHERE LOWER(COALESCE(x.payment_method, 'cash')) = 'cash'), 0) AS cash_total
          FROM expenses x
          WHERE x.shift_id = s.id
            AND LOWER(COALESCE(x.status, '')) NOT IN ('rejected', 'cancelled', 'canceled', 'void')
        ) exp ON TRUE` : "LEFT JOIN LATERAL (SELECT 0 AS cash_total) exp ON TRUE"}
        ${hasReturns ? `
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(r.refund_amount) FILTER (WHERE LOWER(COALESCE(NULLIF(r.refund_method, ''), 'cash')) = 'cash'), 0) AS cash_total
          FROM returns r
          WHERE r.shift_id = s.id
        ) ret ON TRUE` : "LEFT JOIN LATERAL (SELECT 0 AS cash_total) ret ON TRUE"}
        WHERE s.id = ANY($1::bigint[])
        `,
        [allShiftIds],
        []
      )
    : [];
  const expectedByShift = new Map(drawerRows.map((row) => [String(row.id), toNumber(row.expected_cash)]));

  const buildShift = (row) => {
    const status = lower(clean(row.status)) || "open";
    return {
      id: Number(row.id),
      status,
      branch_id: numberOrNull(row.branch_id),
      branch_name: repairManagerPortalPayload(clean(row.branch_name)),
      cashier_name: repairManagerPortalPayload(clean(row.cashier_name)),
      cashier_user_id: numberOrNull(row.opened_by),
      opened_at: row.opened_at,
      closed_at: row.closed_at,
      opening_cash: toNumber(row.opening_cash),
      // A closed drawer reports what was actually counted; an open one has to be computed.
      expected_cash: status === "open"
        ? (expectedByShift.get(String(row.id)) ?? toNumber(row.stored_expected_cash))
        : toNumber(row.actual_cash ?? row.stored_expected_cash),
    };
  };

  const shiftsByBranch = new Map();
  for (const row of shiftRows) {
    const key = String(numberOrNull(row.branch_id) ?? "none");
    const list = shiftsByBranch.get(key) || [];
    list.push(buildShift(row));
    shiftsByBranch.set(key, list);
  }

  const expenses = expenseRows.map((row) => ({
    id: Number(row.id),
    title: repairManagerPortalPayload(clean(row.title)),
    amount: toNumber(row.amount),
    payment_method: lower(clean(row.payment_method)) || "cash",
    category: repairManagerPortalPayload(clean(row.category)),
    expense_type: clean(row.expense_type),
    notes: repairManagerPortalPayload(clean(row.notes)),
    at: row.created_at,
    branch_name: repairManagerPortalPayload(clean(row.branch_name)),
    actor_name: repairManagerPortalPayload(clean(row.created_by_name)),
    is_employee_advance: row.is_employee_advance === true,
  }));
  const sumAmounts = (rows) => Number(rows.reduce((sum, row) => sum + row.amount, 0).toFixed(2));

  const drawerShifts = scopedShifts.map(buildShift);

  return {
    generated_at: new Date().toISOString(),
    // The window the figures actually cover, echoed back so the card can state it rather than
    // leave the manager guessing, and so the pickers seed from the server's answer instead of
    // recomputing "the business day" in a browser on a different clock.
    window: {
      from: windowStart.toISOString(),
      to: windowEnd.toISOString(),
      business_day_start_hour: startHour,
      is_custom: isCustom,
      // True only when the business-day query failed and the card fell back to a rolling
      // 24 hours. Declared so "yesterday is still showing" is answerable from the payload.
      degraded: Boolean(windowDegraded),
      // A picked drawer overrides the window: its tape is its whole life, so the totals below
      // reconcile with its cash figure.
      scoped_to_shift: Boolean(shiftId),
    },
    selection: {
      branch_id: branchId,
      shift_id: shiftId,
      branch_locked: Boolean(forcedBranchId),
    },
    branches: branches.map((row) => ({
      id: Number(row.id),
      name: repairManagerPortalPayload(clean(row.name)),
      shifts: shiftsByBranch.get(String(row.id)) || [],
    })),
    invoices: orderRows.map((row) => ({
      id: Number(row.id),
      invoice_number: repairManagerPortalPayload(clean(row.invoice_number)),
      customer_name: repairManagerPortalPayload(clean(row.customer_name)),
      seller_name: repairManagerPortalPayload(clean(row.seller_name)),
      total: toNumber(row.total_amount),
      payment_method: lower(clean(row.payment_method)),
      at: row.created_at,
    })),
    sales: {
      total: Number(orderRows.reduce((sum, row) => sum + toNumber(row.total_amount), 0).toFixed(2)),
      invoice_count: orderRows.length,
    },
    payment_methods: aggregatePaymentDistribution(orderRows),
    expenses: {
      total: sumAmounts(expenses),
      cash_total: sumAmounts(expenses.filter((row) => row.payment_method === "cash")),
      advances_total: sumAmounts(expenses.filter((row) => row.is_employee_advance)),
      count: expenses.length,
      items: expenses,
    },
    drawer: {
      expected_total: Number(drawerShifts.reduce((sum, row) => sum + row.expected_cash, 0).toFixed(2)),
      shifts: drawerShifts,
    },
  };
};

export const getManagerPortalStockAlerts = async ({ manager = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const [lowStock, refillAlerts] = await Promise.all([
    getLowStock({ tenantId, limit: 20 }),
    listRecentDisplayRefillAlerts({ limit: 40 }).then((rows) => rows.filter((row) => (tenantId ? numberOrNull(row.tenant_id) === tenantId || row.tenant_id === null : true) && (branchId ? numberOrNull(row.branch_id) === branchId : true))),
  ]);
  return {
    low_stock: lowStock,
    refill_alerts: refillAlerts,
  };
};

export const getManagerPortalInventoryApprovals = async ({ manager = {}, query = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const page = Math.max(1, Number(query.page || 1) || 1);
  const limit = Math.min(Math.max(Number(query.limit || 10) || 10, 1), 50);
  const search = clean(query.search || "");
  const [sessionsResult, countsResult] = await Promise.all([
    listInventoryCountSessions(db, {
      tenantId,
      status: "pending_review",
      search,
      page,
      limit,
    }),
    db.query(
      `
      WITH item_totals AS (
        SELECT
          s.id,
          COALESCE(SUM(ABS(COALESCE(i.difference_quantity, i.difference_qty, 0))), 0) AS abs_diff_total
        FROM inventory_count_sessions s
        LEFT JOIN inventory_count_items i ON i.inventory_count_session_id = s.id OR i.inventory_count_id = s.id
        WHERE ($1::bigint IS NULL OR s.tenant_id = $1::bigint OR s.tenant_id IS NULL)
        GROUP BY s.id
      )
      SELECT
        COUNT(*) FILTER (WHERE s.status = 'pending_review')::int AS pending_review_count,
        COUNT(*) FILTER (WHERE s.status = 'rejected')::int AS rejected_count,
        COUNT(*) FILTER (WHERE s.status = 'completed' AND s.completed_at >= date_trunc('day', NOW()))::int AS completed_today_count,
        COALESCE(SUM(CASE WHEN s.status = 'completed' AND s.completed_at >= date_trunc('day', NOW()) THEN item_totals.abs_diff_total ELSE 0 END), 0)::int AS today_difference_total
      FROM inventory_count_sessions s
      LEFT JOIN item_totals ON item_totals.id = s.id
      WHERE ($1::bigint IS NULL OR s.tenant_id = $1::bigint OR s.tenant_id IS NULL)
      `,
      [tenantId]
    ),
  ]);

  const summary = countsResult.rows[0] || {};
  return {
    summary: {
      pending_review_count: Number(summary.pending_review_count || 0),
      rejected_count: Number(summary.rejected_count || 0),
      completed_today_count: Number(summary.completed_today_count || 0),
      today_difference_total: Number(summary.today_difference_total || 0),
    },
    sessions: sessionsResult.sessions || [],
    pagination: {
      total: sessionsResult.total,
      page: sessionsResult.page,
      limit: sessionsResult.limit,
      totalPages: sessionsResult.totalPages,
    },
  };
};

export const getManagerPortalInventoryApprovalSession = async ({ manager = {}, sessionId } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return getInventoryCountSession(db, { tenantId, sessionId });
};

export const approveManagerPortalInventoryApproval = async ({ manager = {}, sessionId } = {}) => {
  return approveInventoryCountSession(db, {
    tenantId: numberOrNull(manager.tenant_id),
    sessionId,
    approvedBy: manager.user_id || manager.id || null,
    // Reaching this service requires a valid manager-portal token. Mark the
    // actor as a reviewer explicitly because employee job titles can be
    // customized and should not fail the generic role-name check.
    user: { ...manager, role: "manager", manager_portal_verified: true },
  });
};

export const rejectManagerPortalInventoryApproval = async ({ manager = {}, sessionId, rejectionReason = "" } = {}) => {
  return rejectInventoryCountSession(db, {
    tenantId: numberOrNull(manager.tenant_id),
    sessionId,
    rejectedBy: manager.user_id || manager.id || null,
    rejectionReason,
    user: manager,
  });
};

export const getManagerPortalNotifications = async ({ manager = {}, query = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const roleKey = "manager";
  const unread = query.unread === true || query.unread === "true" || query.unread === "1";
  const [notifications, unreadCount] = await Promise.all([
    listNotifications({
      user: {
        tenant_id: tenantId,
        role_key: roleKey,
        is_super_admin: false,
      },
      limit: query.limit || 30,
      offset: query.offset || 0,
      unread,
      category: query.category || "",
    }),
    getUnreadCount({
      tenant_id: tenantId,
      role_key: roleKey,
      is_super_admin: false,
    }),
  ]);
  return {
    notifications,
    unread_count: unreadCount,
    settings: mergeManagerNotificationSettings(manager.notification_settings || {}),
  };
};

export const markManagerPortalNotificationRead = async ({ manager = {}, notificationId } = {}) => {
  return markAsRead(notificationId, {
    tenant_id: manager.tenant_id || null,
    role_key: "manager",
    is_super_admin: false,
  });
};

export const markManagerPortalNotificationsRead = async ({ manager = {} } = {}) => {
  return markAllAsRead({
    tenant_id: manager.tenant_id || null,
    role_key: "manager",
    is_super_admin: false,
  });
};

export const getManagerPortalChat = async ({ manager = {}, threadId = null, beforeId = null, limit = null } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  if (threadId) {
    const thread = await getAdminEmployeeChatThread({ tenantId, threadId, markRead: true, beforeId, limit: limit || undefined });
    return {
      thread: thread.thread || null,
      messages: thread.messages || [],
      has_more: Boolean(thread.has_more),
    };
  }
  const threads = await listEmployeeChatThreads({ tenantId, limit: 200 });
  const safeThreads = branchId ? threads.filter((thread) => numberOrNull(thread.branch_id) === branchId || !thread.branch_id) : threads;
  return {
    threads: safeThreads,
  };
};

export const getManagerPortalChatThread = async ({ manager = {}, threadId, beforeId = null, limit = null } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return getAdminEmployeeChatThread({ tenantId, threadId, markRead: !beforeId, beforeId, limit: limit || undefined });
};

export const starManagerPortalChatMessage = async ({ manager = {}, messageId } = {}) =>
  starAdminEmployeeChatMessage({ tenantId: numberOrNull(manager.tenant_id), messageId });

export const listManagerPortalStarredMessages = async ({ manager = {} } = {}) =>
  listStarredChatMessages({ actorType: "admin", tenantId: numberOrNull(manager.tenant_id) });

export const updateManagerPortalChatPrefs = async ({ manager = {}, threadId, prefs = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return updateAdminEmployeeChatThreadPrefs({ tenantId, threadId, pinned: prefs.pinned, muted_until: prefs.muted_until, archived: prefs.archived });
};

export const markManagerPortalChatDelivered = async ({ manager = {}, threadId, upToMessageId = null } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return markAdminEmployeeChatThreadDelivered({ tenantId, threadId, upToMessageId });
};

export const sendManagerPortalChat = async ({ manager = {}, threadId, body = "", file = null, replyToMessageId = null, attachmentDurationSeconds = null, clientId = null } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return sendAdminEmployeeChatMessage({
    tenantId,
    threadId,
    userId: manager.user_id || null,
    body,
    file,
    replyToMessageId,
    attachmentDurationSeconds,
    clientId,
  });
};

export const sendManagerPortalChatRing = async ({ manager = {}, threadId } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return sendAdminChatRing({ tenantId, threadId, userId: manager.user_id || null, senderName: manager.full_name || manager.name || "" });
};

export const answerManagerPortalChatRing = async ({ manager = {}, messageId } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return answerAdminChatRing({ tenantId, messageId, answeredBy: manager.full_name || manager.name || "" });
};

export const markManagerPortalChatRead = async ({ manager = {}, threadId } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return markAdminEmployeeChatThreadRead({ tenantId, threadId });
};

export const createManagerPortalTask = async ({ manager = {}, data = {} } = {}) => {
  const actor = {
    id: manager.user_id || null,
    tenant_id: manager.tenant_id || null,
    source: "manager_portal",
    role: manager.role || "manager",
    branch_id: manager.branch_id || null,
    employee_id: manager.id || null,
  };
  // The daily dedupe index keys manual tasks on (date, type, assignee,
  // source_ref). With no source_ref a manager could only create ONE manual
  // task per employee per day — the second silently came back "duplicate".
  // Every portal task gets its own ref so each one is distinct.
  const withRef = (payload) => ({
    ...payload,
    source_ref_type: payload.source_ref_type || "manager_portal",
    source_ref_id: payload.source_ref_id || `mp-${Date.now()}-${randomBytes(4).toString("hex")}`,
  });
  const rawIds = Array.isArray(data.current_assignee_ids) ? data.current_assignee_ids : Array.isArray(data.assignee_ids) ? data.assignee_ids : null;
  const assigneeIds = [...new Set((rawIds || []).map((id) => numberOrNull(id)).filter(Boolean))];
  if (assigneeIds.length > 1) {
    // One task per employee: the task model is single-assignee.
    const { current_assignee_ids: _ids, assignee_ids: _ids2, ...base } = data;
    const results = [];
    for (const employeeId of assigneeIds) {
      results.push(await createStaffTask(withRef({ ...base, current_assignee_id: employeeId }), actor));
    }
    const created = results.map((r) => r?.task).filter(Boolean);
    return { duplicate: created.length === 0, task: created[0] || null, tasks: created, created_count: created.length, requested_count: assigneeIds.length };
  }
  const single = assigneeIds.length === 1 ? { ...data, current_assignee_id: assigneeIds[0] } : data;
  return createStaffTask(withRef(single), actor);
};

export const approveManagerPortalTask = async ({ manager = {}, taskId, note = "" } = {}) => {
  return updateStaffTaskStatus(taskId, { status: "completed", note }, {
    id: manager.user_id || null,
    tenant_id: manager.tenant_id || null,
    source: "manager_portal",
    role: manager.role || "manager",
    branch_id: manager.branch_id || null,
    employee_id: manager.id || null,
  });
};

export const rejectManagerPortalTask = async ({ manager = {}, taskId, note = "" } = {}) => {
  return updateStaffTaskStatus(taskId, { status: "rejected", note }, {
    id: manager.user_id || null,
    tenant_id: manager.tenant_id || null,
    source: "manager_portal",
    role: manager.role || "manager",
    branch_id: manager.branch_id || null,
    employee_id: manager.id || null,
  });
};

export const reopenManagerPortalTask = async ({ manager = {}, taskId, note = "" } = {}) => {
  return updateStaffTaskStatus(taskId, { status: "in_progress", note }, {
    id: manager.user_id || null,
    tenant_id: manager.tenant_id || null,
    source: "manager_portal",
    role: manager.role || "manager",
    branch_id: manager.branch_id || null,
    employee_id: manager.id || null,
  });
};

export const noteManagerPortalTask = async ({ manager = {}, taskId, note = "" } = {}) => {
  return addStaffTaskComment(taskId, { comment: note }, {
    id: manager.user_id || null,
    tenant_id: manager.tenant_id || null,
    source: "manager_portal",
    role: manager.role || "manager",
    branch_id: manager.branch_id || null,
    employee_id: manager.id || null,
  });
};

export const createManagerPortalNotification = async (payload = {}) => {
  return createNotification({
    ...payload,
    role_key: payload.role_key || "manager",
  });
};

// ---------------------------------------------------------------------------
// Employee details popup (manager portal kebab menu): one month of everything
// that touches an employee's pay — sales, salary preview, advances with dates,
// bonuses/penalties, and the day-by-day attendance log with totals.
// ---------------------------------------------------------------------------
const monthRange = (month = "") => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || "").trim());
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : now.getMonth();
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    month: `${year}-${pad(monthIndex + 1)}`,
    start: `${year}-${pad(monthIndex + 1)}-01`,
    end: `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}`,
  };
};

const loadScopedEmployee = async ({ manager = {}, employeeId }) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const id = numberOrNull(employeeId);
  if (!id) {
    const error = new Error("Employee is required");
    error.status = 400;
    throw error;
  }
  const rows = await safeQuery(
    `
    SELECT e.id, e.tenant_id, e.branch_id, e.full_name, e.employee_code, e.photo_url, e.phone, e.job_title, e.position, e.role,
           e.salary, e.hire_date, e.status
    FROM employees e
    WHERE e.id = $1::bigint
      AND e.is_deleted IS DISTINCT FROM TRUE
      AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint)
      AND ($3::bigint IS NULL OR e.branch_id = $3::bigint)
    LIMIT 1
    `,
    [id, tenantId, branchId],
    []
  );
  const employee = rows[0];
  if (!employee) {
    const error = new Error("Employee not found in your scope");
    error.status = 404;
    throw error;
  }
  return { employee, tenantId, branchId };
};

const ORDERS_EMPLOYEE_EXPR = "COALESCE(o.sales_employee_id, o.cashier_id, o.created_by)";

export const getManagerPortalEmployeeDetails = async ({ manager = {}, employeeId, month = "" } = {}) => {
  const { employee, tenantId } = await loadScopedEmployee({ manager, employeeId });
  const range = monthRange(month);
  const salesCommission = await import("./salesCommissionService.js");
  // A month still in progress must not count its remaining days as absence:
  // cap the payroll window at today so the preview reflects what has happened.
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const previewEnd = range.end > todayIso ? todayIso : range.end;

  const ordersReady = async () => (await tableExists("orders")) && (await columnExists("orders", "sales_employee_id"));
  const orderParams = [tenantId, employee.id, range.start, range.end];
  const orderWhere = `
        WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
          AND ${ORDERS_EMPLOYEE_EXPR} = $2::bigint
          AND o.created_at >= $3::date AND o.created_at < ($4::date + INTERVAL '1 day')
          AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')`;

  const [salesRows, dailySalesRows, advanceRows, penaltyRows, bonusRows, attendanceRows, payrollPreview] = await Promise.all([
    ordersReady().then((ok) => (!ok ? [] : safeQuery(
      `SELECT COUNT(*)::int AS invoice_count, COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS sales_total FROM orders o ${orderWhere}`,
      orderParams,
      []
    ))).catch(() => []),
    ordersReady().then((ok) => (!ok ? [] : safeQuery(
      `SELECT o.created_at::date AS day, COUNT(*)::int AS invoice_count, COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS sales_total
       FROM orders o ${orderWhere}
       GROUP BY o.created_at::date ORDER BY day DESC`,
      orderParams,
      []
    ))).catch(() => []),
    tableExists("employee_advances").then((ok) => (!ok ? [] : safeQuery(
      `
      SELECT id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status, notes, created_at, deducted_at
      FROM employee_advances
      WHERE employee_id = $1::bigint AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ORDER BY created_at DESC, id DESC
      LIMIT 100
      `,
      [employee.id, tenantId],
      []
    ))).catch(() => []),
    salesCommission.listEmployeePenalties({ tenantId, employeeId: employee.id }).catch(() => []),
    salesCommission.listEmployeeBonuses({ tenantId, employeeId: employee.id }).catch(() => []),
    safeQuery(
      `
      SELECT id, branch_id, attendance_date, check_in_at, check_out_at, check_in, check_out, status,
             work_minutes, worked_hours, late_minutes, early_leave_minutes, overtime_minutes, notes
      FROM attendance_logs
      WHERE employee_id = $1::bigint AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND attendance_date BETWEEN $3::date AND $4::date
      ORDER BY attendance_date DESC
      `,
      [employee.id, tenantId, range.start, range.end],
      []
    ),
    salesCommission.getPayrollPreview({ tenantId, employeeId: employee.id, filters: { month: range.month, startDate: range.start, endDate: previewEnd } })
      .catch((error) => {
        console.warn("[manager-portal] payroll preview skipped", error?.message || error);
        return null;
      }),
  ]);

  const toHours = (minutes) => Number((Number(minutes || 0) / 60).toFixed(2));
  const attendance = attendanceRows.map((row) => {
    const checkIn = row.check_in_at || row.check_in || null;
    const checkOut = row.check_out_at || row.check_out || null;
    const workMinutes = Number(row.work_minutes || 0) || (checkIn && checkOut ? Math.max(0, (new Date(checkOut) - new Date(checkIn)) / 60000) : 0);
    return {
      id: row.id,
      branch_id: row.branch_id,
      date: row.attendance_date,
      check_in: checkIn,
      check_out: checkOut,
      status: row.status || "checked_in",
      work_hours: toHours(workMinutes),
      late_minutes: Number(row.late_minutes || 0),
      early_leave_minutes: Number(row.early_leave_minutes || 0),
      overtime_minutes: Number(row.overtime_minutes || 0),
      notes: row.notes || "",
    };
  });
  const attendanceTotals = attendance.reduce(
    (acc, row) => ({
      days: acc.days + 1,
      work_hours: Number((acc.work_hours + row.work_hours).toFixed(2)),
      late_minutes: acc.late_minutes + row.late_minutes,
      early_leave_minutes: acc.early_leave_minutes + row.early_leave_minutes,
      overtime_minutes: acc.overtime_minutes + row.overtime_minutes,
      late_days: acc.late_days + (row.late_minutes > 0 ? 1 : 0),
    }),
    { days: 0, work_hours: 0, late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0, late_days: 0 }
  );

  const inMonth = (row, dateKey) => {
    const d = String(row[dateKey] || row.created_at || "");
    const iso = d.length >= 10 ? (d instanceof Date ? d.toISOString() : d).slice(0, 10) : d;
    return iso >= range.start && iso <= range.end && row.status !== "cancelled";
  };
  const monthPenalties = penaltyRows.filter((row) => inMonth({ ...row, penalty_date: row.penalty_date ? new Date(row.penalty_date).toISOString() : "" }, "penalty_date"));
  const monthBonuses = bonusRows.filter((row) => inMonth({ ...row, bonus_date: row.bonus_date ? new Date(row.bonus_date).toISOString() : "" }, "bonus_date"));
  const sum = (rows, key = "amount") => Number(rows.reduce((s, r) => s + Number(r[key] || 0), 0).toFixed(2));

  const snapshot = payrollPreview?.payroll || payrollPreview?.snapshot || payrollPreview || {};
  return {
    month: range.month,
    period: { start: range.start, end: range.end },
    employee: {
      id: employee.id,
      name: employee.full_name,
      employee_code: employee.employee_code,
      photo_url: employee.photo_url || null,
      phone: employee.phone || "",
      job_title: employee.job_title || employee.position || employee.role || "",
      hire_date: employee.hire_date,
      status: employee.status,
      base_salary: Number(employee.salary || 0),
    },
    sales: {
      total: Number(salesRows[0]?.sales_total || 0),
      invoices: Number(salesRows[0]?.invoice_count || 0),
      daily: dailySalesRows.map((row) => ({ day: row.day, total: Number(row.sales_total || 0), invoices: Number(row.invoice_count || 0) })),
    },
    salary: {
      base_salary: Number(snapshot.base_salary ?? employee.salary ?? 0),
      commissions: Number(snapshot.commissions || 0),
      bonuses: Number(snapshot.bonuses ?? sum(monthBonuses)),
      approved_overtime_pay: Number(snapshot.approved_overtime_pay || 0),
      advance_deductions: Number(snapshot.advance_deductions || 0),
      penalties_total: Number(snapshot.penalties_total ?? sum(monthPenalties)),
      attendance_deduction_total: Number(snapshot.attendance_deductions?.attendance_deduction_total || snapshot.attendance_deduction_total || 0),
      deductions: Number(snapshot.deductions || 0),
      net_pay: snapshot.net_pay === undefined ? null : Number(snapshot.net_pay || 0),
      attendance_breakdown: snapshot.attendance_deductions || null,
    },
    advances: {
      total_outstanding: sum(advanceRows.filter((r) => r.status !== "cancelled"), "remaining_amount"),
      total_taken: sum(advanceRows.filter((r) => r.status !== "cancelled")),
      rows: advanceRows.map((row) => ({
        id: row.id,
        amount: Number(row.amount || 0),
        deducted_amount: Number(row.deducted_amount || 0),
        remaining_amount: Number(row.remaining_amount || 0),
        deduction_month: row.deduction_month,
        status: row.status,
        deduction_status: row.deduction_status,
        notes: row.notes || "",
        created_at: row.created_at,
        deducted_at: row.deducted_at,
      })),
    },
    bonuses: { total: sum(monthBonuses), rows: monthBonuses },
    penalties: { total: sum(monthPenalties), rows: monthPenalties },
    attendance: { totals: attendanceTotals, rows: attendance },
  };
};

export const createManagerPortalEmployeeAdjustment = async ({ manager = {}, employeeId, payload = {} } = {}) => {
  const { employee, tenantId } = await loadScopedEmployee({ manager, employeeId });
  const type = String(payload.type || "").trim().toLowerCase();
  const salesCommission = await import("./salesCommissionService.js");
  const data = {
    amount: payload.amount,
    reason: payload.reason,
    notes: payload.notes || `manager-portal:${manager.id || ""}`,
    date: payload.date,
  };
  const userId = manager.user_id || null;
  if (type === "bonus") {
    const row = await salesCommission.createEmployeeBonus({ tenantId, employeeId: employee.id, userId, data });
    return { type, row };
  }
  if (type === "deduction" || type === "penalty") {
    const row = await salesCommission.createEmployeePenalty({ tenantId, employeeId: employee.id, userId, data, defaultStatus: "approved" });
    return { type: "deduction", row };
  }
  const error = new Error("Adjustment type must be bonus or deduction");
  error.status = 400;
  throw error;
};

export const cancelManagerPortalEmployeeAdjustment = async ({ manager = {}, employeeId, kind, adjustmentId } = {}) => {
  const { employee, tenantId } = await loadScopedEmployee({ manager, employeeId });
  const type = String(kind || "").trim().toLowerCase();
  const salesCommission = await import("./salesCommissionService.js");
  if (type === "bonus") {
    const row = await salesCommission.cancelEmployeeBonus({ tenantId, employeeId: employee.id, id: adjustmentId });
    return { type, row };
  }
  if (type === "deduction" || type === "penalty") {
    const existing = (await salesCommission.listEmployeePenalties({ tenantId, employeeId: employee.id, includeCancelled: true }))
      .find((row) => String(row.id) === String(adjustmentId));
    if (!existing) {
      const error = new Error("Deduction not found");
      error.status = 404;
      throw error;
    }
    const row = await salesCommission.cancelEmployeePenalty({ tenantId, id: adjustmentId });
    return { type: "deduction", row };
  }
  const error = new Error("Adjustment type must be bonus or deduction");
  error.status = 400;
  throw error;
};

// Manager-side check-in / check-out correction. Same engine as the admin
// manual entry, scoped to the manager's branch and tagged in the audit log.
export const correctManagerPortalAttendance = async ({ manager = {}, employeeId, payload = {}, request = {} } = {}) => {
  const { employee, tenantId, branchId } = await loadScopedEmployee({ manager, employeeId });
  if (!tenantId) {
    const error = new Error("Tenant context is required");
    error.status = 400;
    throw error;
  }
  const { upsertManualAttendance } = await import("../utils/attendanceManualEntry.js");
  const { saved, created } = await upsertManualAttendance({
    tenantId,
    employeeId: employee.id,
    attendanceDate: payload.attendance_date || payload.date,
    checkInTime: payload.check_in_time || payload.check_in,
    checkOutTime: payload.check_out_time || payload.check_out,
    checkOutDate: payload.check_out_date,
    correctionScope: payload.correction_scope || payload.scope,
    reason: payload.reason,
    branchId: payload.branch_id || employee.branch_id || branchId,
    scopeBranchId: branchId,
    actor: {
      userId: manager.user_id || null,
      ip: request.ip || null,
      userAgent: request.userAgent || null,
      source: "manager_portal",
      managerEmployeeId: manager.id || null,
    },
    auditPrefix: "Manager attendance correction",
    auditAction: "attendance_manager_upsert",
  });
  return { attendance: saved, created };
};

const managerTaskActor = (manager = {}) => ({
  id: manager.user_id || null,
  tenant_id: manager.tenant_id || null,
  source: "manager_portal",
  role: manager.role || "manager",
  branch_id: manager.branch_id || null,
  employee_id: manager.id || null,
});

export const updateManagerPortalTask = async ({ manager = {}, taskId, data = {} } = {}) =>
  updateStaffTaskDetails(taskId, data, managerTaskActor(manager));

export const deleteManagerPortalTask = async ({ manager = {}, taskId } = {}) =>
  deleteStaffTask(taskId, managerTaskActor(manager));

// ---- Recurring task templates (daily / weekly fixed tasks) ----
// The portal manages the tenant's templates scoped to the manager's branch
// (or all branches for an all-scope manager). Compliance is the trailing
// 7-day window so the manager sees whether the routine actually happens.

export const getManagerPortalTaskTemplates = async ({ manager = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const [templates, compliance] = await Promise.all([
    listStaffTaskTemplates({ tenantId, branchId, template_kind: "daily,weekly", limit: 300 }, managerTaskActor(manager)),
    getStaffTaskTemplateCompliance({ tenantId, branchId, days: 7 }),
  ]);
  const employeeIds = [...new Set(templates.map((template) => numberOrNull(template.fixed_employee_id)).filter(Boolean))];
  const employeeNames = employeeIds.length
    ? await safeQuery(`SELECT id, full_name AS name FROM employees WHERE id = ANY($1::bigint[])`, [employeeIds])
    : [];
  const nameById = new Map(employeeNames.map((row) => [String(row.id), row.name]));
  return repairManagerPortalPayload(
    templates.map((template) => {
      const stats = compliance[String(template.id)] || { generated: 0, completed: 0, late: 0, last_completed_at: null };
      return {
        id: template.id,
        title: template.title_ar || template.title,
        description: template.description_ar || template.description,
        template_kind: template.template_kind,
        frequency: template.frequency,
        weekdays: Array.isArray(template.weekdays) ? template.weekdays : [],
        due_time: template.recurring_rule?.due_time || null,
        priority: template.priority,
        branch_id: template.branch_id,
        is_active: template.is_active !== false,
        fixed_employee_id: numberOrNull(template.fixed_employee_id),
        fixed_employee_name: nameById.get(String(template.fixed_employee_id)) || null,
        auto_assign_enabled: Boolean(template.auto_assign_enabled),
        assignment_strategy: template.assignment_strategy,
        checklist_items: Array.isArray(template.checklist_items) ? template.checklist_items : [],
        requires_photo: Boolean(template.requires_photo || template.photo_required),
        compliance: {
          generated: Number(stats.generated) || 0,
          completed: Number(stats.completed) || 0,
          late: Number(stats.late) || 0,
          rate: Number(stats.generated) ? Math.round((Number(stats.completed) / Number(stats.generated)) * 100) : null,
          last_completed_at: stats.last_completed_at || null,
        },
      };
    })
  );
};

export const saveManagerPortalTaskTemplate = async ({ manager = {}, templateId = null, data = {} } = {}) => {
  const actor = managerTaskActor(manager);
  const kind = String(data.template_kind || data.kind || "daily").toLowerCase() === "weekly" ? "weekly" : "daily";
  const fixedEmployeeId = numberOrNull(data.fixed_employee_id ?? data.employee_id);
  const template = await saveStaffTaskTemplate(
    {
      template_id: numberOrNull(templateId),
      tenant_id: manager.tenant_id || null,
      title: data.title,
      description: data.description,
      title_ar: data.title,
      description_ar: data.description,
      priority: data.priority || "medium",
      template_kind: kind,
      frequency: kind,
      weekdays: Array.isArray(data.weekdays) ? data.weekdays : [],
      due_time: data.due_time || null,
      branch_id: numberOrNull(data.branch_id) ?? (manager.branch_scope === "all" ? null : numberOrNull(manager.branch_id)),
      fixed_employee_id: fixedEmployeeId,
      // "Least busy at check-in" is the only auto mode; a named employee
      // disables it.
      auto_assign_enabled: !fixedEmployeeId && Boolean(data.auto_assign_enabled),
      assignment_strategy: data.assignment_strategy || "least_tasks_today",
      checklist_items: Array.isArray(data.checklist_items) ? data.checklist_items.map((item) => String(item || "").trim()).filter(Boolean) : [],
      requires_photo: Boolean(data.requires_photo),
      default_deadline_minutes: data.default_deadline_minutes || 480,
    },
    actor
  );
  if (!template) return null;
  // A brand-new template that is due today should show up today, not
  // tomorrow at the next timer tick.
  if (!templateId) {
    await generateDueTaskInstancesFromTemplates({ tenantId: template.tenant_id, templateId: template.id, actor }).catch((error) => {
      console.warn("[manager-portal] template first-day generation skipped", error.message);
    });
  }
  return template;
};

export const setManagerPortalTaskTemplateActive = async ({ manager = {}, templateId, isActive } = {}) =>
  setStaffTaskTemplateActive(templateId, isActive, managerTaskActor(manager));

export const deleteManagerPortalTaskTemplate = async ({ manager = {}, templateId } = {}) =>
  deleteStaffTaskTemplate(templateId, managerTaskActor(manager));
