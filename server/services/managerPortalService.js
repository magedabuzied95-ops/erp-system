import { randomBytes } from "node:crypto";
import db from "../database/db.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { getDashboardOverview, getHourlySales, getLowStock, getSalesTrend, getTopProducts, getAiInsights } from "./dashboardAnalyticsService.js";
import { getStaffTaskDashboard, createStaffTask, updateStaffTaskStatus, addStaffTaskComment } from "./staffTasksService.js";
import {
  listEmployeeChatThreads,
  getAdminEmployeeChatThread,
  sendAdminEmployeeChatMessage,
  markAdminEmployeeChatThreadRead,
} from "./employeeChatService.js";
import { getUnreadCount, listNotifications, markAsRead, markAllAsRead, createNotification } from "./notificationsService.js";
import { listRecentDisplayRefillAlerts } from "./displayRefillAlertService.js";
import { getRolePermissions } from "./rolesService.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";

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
  messages: { sound: true, toast: true },
  tasks: { sound: true, toast: true },
  attendance: { sound: true, toast: true },
  sales: { sound: true, toast: true },
  stock: { sound: true, toast: true },
  ai_leads: { sound: true, toast: true },
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

const resolveManagerPermissions = async ({ tenantId = null, role = "", enabled = false } = {}) => {
  if (enabled) return defaultManagerPermissions;
  const roleName = clean(role);
  if (!roleName) return defaultManagerPermissions;
  try {
    const rolePermissions = await getRolePermissions({ db, roleId: roleName, tenantId });
    if (rolePermissions?.permissions?.length) return rolePermissions.permissions;
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
const canViewProfitForManager = (manager = {}) =>
  Array.isArray(manager.permissions) &&
  manager.permissions.some((permission) =>
    ["treasury.dashboard.view", "accounting.view", "accounting.reports", "reports.view", "money_accounts.view"].includes(permission)
  );

export const getManagerPortalDashboard = async ({ manager = {}, filters = {} } = {}) => {
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
      const hasPaymentMethod = await columnExists("orders", "payment_method");
      if (!hasPaymentMethod) return [];
      const params = [];
      const tenantClause = tenantId ? (params.push(tenantId), ` AND o.tenant_id = $${params.length}`) : "";
      const branchClause = branchId ? (params.push(branchId), ` AND o.branch_id = $${params.length}`) : "";
      return safeQuery(
        `
        SELECT
          COALESCE(NULLIF(LOWER(TRIM(COALESCE(o.payment_method, ''))), ''), 'unknown') AS method,
          COUNT(*)::int AS count,
          COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS total
        FROM orders o
        WHERE o.created_at >= date_trunc('day', NOW())
          AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
          ${tenantClause}
          ${branchClause}
        GROUP BY COALESCE(NULLIF(LOWER(TRIM(COALESCE(o.payment_method, ''))), ''), 'unknown')
        ORDER BY total DESC, count DESC
        `,
        params,
        []
      );
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
  if (!canViewProfitForManager(manager) && overview?.today) {
    overview.today.profit = null;
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
    ai_insights: aiInsights || [],
    overview,
    task_summary: staffDashboard?.summary || {},
  };
};

export const getManagerPortalStaff = async ({ manager = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const [taskDashboard, salesRows, attendanceRows] = await Promise.all([
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
  ]);

  const salesByEmployee = new Map(salesRows.map((row) => [String(row.employee_id), row]));
  const attendanceByEmployee = new Map(attendanceRows.map((row) => [String(row.employee_id), row]));

  const staff = (taskDashboard?.byEmployee || []).map((row) => {
    const sales = salesByEmployee.get(String(row.employee_id)) || {};
    const attendance = attendanceByEmployee.get(String(row.employee_id)) || {};
    const shiftDurationHours = row.check_in_time && attendance.check_out_at ? Math.max(0, (new Date(attendance.check_out_at).getTime() - new Date(row.check_in_time).getTime()) / 36e5) : 0;
    return {
      ...row,
      attendance_status: attendance.status || row.attendance_status || "absent",
      check_in_time: attendance.check_in_at || attendance.check_in || row.check_in_time || null,
      check_out_time: attendance.check_out_at || attendance.check_out || null,
      late_minutes: Number(attendance.late_minutes || 0),
      shift_duration_hours: Number(shiftDurationHours.toFixed(2)),
      sales_today: Number(sales.sales_total || 0),
      invoices_count: Number(sales.invoice_count || 0),
      expected_commission: null,
      open_tasks: Number(row.open_tasks || 0),
      completed_tasks: Number(row.completed_tasks || 0),
      last_activity: attendance.updated_at || row.online_last_seen_at || row.check_in_time || null,
    };
  });

  return {
    summary: taskDashboard?.summary || {},
    staff,
    recent_tasks: taskDashboard?.recentTasks || [],
    history: taskDashboard?.history || [],
  };
};

export const getManagerPortalTasks = async ({ manager = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const taskDashboard = await getStaffTaskDashboard({ tenantId, branchId });
  return {
    summary: taskDashboard?.summary || {},
    tasks: taskDashboard?.recentTasks || [],
    history: taskDashboard?.history || [],
  };
};

export const getManagerPortalSales = async ({ manager = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  const hasOrders = await tableExists("orders");
  const hasOrderItems = await tableExists("order_items");
  const hasProducts = await tableExists("products");
  const hasCategories = await tableExists("categories");
  const hasBrands = await tableExists("brands");
  const hasAiSupportSessions = await tableExists("ai_support_sessions");
  const hasAiAgentConversationColumn = await columnExists("orders", "ai_agent_conversation_id");
  const hasAiAgentStatusColumn = await columnExists("orders", "ai_agent_status");

  const [overview, trend7d, hourly, topProducts, recentInvoices, aiInsights, comparisonRows, sellerRows, categoryRows, brandRows, customerConversionRows, aiConversionRows] = await Promise.all([
    getDashboardOverview({ tenantId, filters: { branchId } }),
    getSalesTrend({ tenantId, filters: { branchId, range: "7d" }, days: 7 }),
    getHourlySales({ tenantId, filters: { branchId } }),
    getTopProducts({ tenantId, filters: { branchId } }),
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
            AND o.created_at >= NOW() - INTERVAL '30 days'
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
            AND o.created_at >= NOW() - INTERVAL '30 days'
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
            AND o.created_at >= NOW() - INTERVAL '30 days'
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
            AND o.created_at >= NOW() - INTERVAL '30 days'
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
              AND s.created_at >= NOW() - INTERVAL '30 days'
          ),
          converted AS (
            SELECT DISTINCT o.ai_agent_conversation_id AS session_id
            FROM orders o
            WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
              AND o.created_at >= NOW() - INTERVAL '30 days'
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
  ]);
  if (!canViewProfitForManager(manager) && overview?.today) {
    overview.today.profit = null;
  }
  const comparison = comparisonRows[0] || {};
  const sellerStats = sellerRows || [];
  const topSeller = sellerStats[0] || null;
  const worstSeller = sellerStats.length > 1 ? sellerStats[sellerStats.length - 1] : sellerStats[0] || null;
  const bestCategory = categoryRows[0] || null;
  const bestBrand = brandRows[0] || null;
  const conversionSummary = customerConversionRows[0] || {};
  const aiConversionSummary = aiConversionRows[0] || {};
  return {
    overview,
    trend: trend7d,
    trend_7d: trend7d,
    hourly,
    top_products: topProducts,
    recent_invoices: recentInvoices,
    ai_insights: aiInsights,
    comparison: {
      today_sales: Number(comparison.today_sales || overview?.today?.sales || 0),
      yesterday_sales: Number(comparison.yesterday_sales || 0),
      today_orders: Number(comparison.today_orders || overview?.today?.orders || 0),
      yesterday_orders: Number(comparison.yesterday_orders || 0),
      today_average_invoice: Number(comparison.today_aov || overview?.today?.averageOrderValue || 0),
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

export const getManagerPortalNotifications = async ({ manager = {}, query = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const roleKey = "manager";
  const unread = query.unread === true || query.unread === "true" || query.unread === "1";
  const notifications = await listNotifications({
    user: {
      tenant_id: tenantId,
      role_key: roleKey,
      is_super_admin: false,
    },
    limit: query.limit || 30,
    offset: query.offset || 0,
    unread,
    category: query.category || "",
  });
  const unreadCount = await getUnreadCount({
    tenant_id: tenantId,
    role_key: roleKey,
    is_super_admin: false,
  });
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

export const getManagerPortalChat = async ({ manager = {}, threadId = null } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = branchFilterValue(manager);
  if (threadId) {
    const thread = await getAdminEmployeeChatThread({ tenantId, threadId, markRead: true });
    return {
      thread: thread.thread || null,
      messages: thread.messages || [],
    };
  }
  const threads = await listEmployeeChatThreads({ tenantId, limit: 200 });
  const safeThreads = branchId ? threads.filter((thread) => numberOrNull(thread.branch_id) === branchId || !thread.branch_id) : threads;
  return {
    threads: safeThreads,
  };
};

export const getManagerPortalChatThread = async ({ manager = {}, threadId } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return getAdminEmployeeChatThread({ tenantId, threadId, markRead: true });
};

export const sendManagerPortalChat = async ({ manager = {}, threadId, body = "", file = null, replyToMessageId = null, attachmentDurationSeconds = null } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return sendAdminEmployeeChatMessage({
    tenantId,
    threadId,
    userId: manager.user_id || null,
    body,
    file,
    replyToMessageId,
    attachmentDurationSeconds,
  });
};

export const markManagerPortalChatRead = async ({ manager = {}, threadId } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  return markAdminEmployeeChatThreadRead({ tenantId, threadId });
};

export const createManagerPortalTask = async ({ manager = {}, data = {} } = {}) => {
  return createStaffTask(data, {
    id: manager.user_id || null,
    tenant_id: manager.tenant_id || null,
    source: "manager_portal",
    role: manager.role || "manager",
    branch_id: manager.branch_id || null,
    employee_id: manager.id || null,
  });
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
