import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import db from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  createJournalEntry,
  recordCashDrawerEvent,
  recordFinancialAccountActivity,
} from "../services/accountingService.js";

const router = express.Router();
const expenseUploadDir = path.join(process.cwd(), "uploads", "expenses");

router.get("/health", (req, res) => res.json({ success: true, module: "expenses" }));

if (!fs.existsSync(expenseUploadDir)) {
  fs.mkdirSync(expenseUploadDir, { recursive: true });
}

const expenseAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, expenseUploadDir),
    filename: (_req, file, cb) => {
      const safeOriginal = String(file.originalname || "attachment")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 140);
      cb(null, `${Date.now()}-${safeOriginal}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    if (allowedMimeTypes.has(file.mimetype)) return cb(null, true);
    return cb(new Error("Only invoice images and PDF attachments are allowed"));
  },
  limits: {
    fileSize: Number(process.env.EXPENSE_ATTACHMENT_MAX_BYTES || 10 * 1024 * 1024),
    files: 1,
  },
});

const EXPENSE_TYPES = [
  "electricity",
  "water",
  "rent",
  "salaries",
  "shipping",
  "maintenance",
  "groceries_supplies",
  "marketing",
  "supplier_related",
  "employee_advance",
  "other",
];

const APPROVAL_STATUSES = ["draft", "pending_approval", "approved", "rejected", "paid"];
const ACTIVE_ADVANCE_STATUSES = ["pending", "partial", "partially_deducted", "included_in_payroll"];
const ADVANCE_STATUSES = [...ACTIVE_ADVANCE_STATUSES, "settled", "deducted", "cancelled"];
const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"];

const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const optionalId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const clean = (value = "") => String(value || "").trim();
const pick = (value, allowed, fallback) => (allowed.includes(clean(value).toLowerCase()) ? clean(value).toLowerCase() : fallback);
const tenantScope = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));
let employeeColumnsCache = null;

const normalizeExpenseType = (value) => {
  const raw = clean(value).toLowerCase();
  const normalized = raw.replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases = {
    employee_advance: "employee_advance",
    employee_advances: "employee_advance",
    advance: "employee_advance",
    staff_advance: "employee_advance",
    groceries_supplies: "groceries_supplies",
    groceries_and_supplies: "groceries_supplies",
    utilities_electricity: "electricity",
    utilities_water: "water",
  };
  return aliases[normalized] || normalized;
};

const isEmployeeAdvanceType = (value) => normalizeExpenseType(value) === "employee_advance";

const resolveDeductionMonth = (payload = {}) => {
  const explicit = clean(payload.deduction_month || payload.deductionMonth);
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  return String(payload.expense_date || payload.expenseDate || payload.date || new Date().toISOString()).slice(0, 7);
};

const getTableColumns = async (clientOrPool, tableName) => {
  const result = await clientOrPool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const getEmployeeColumns = async (clientOrPool = db) => {
  if (!employeeColumnsCache) {
    employeeColumnsCache = await getTableColumns(clientOrPool, "employees");
  }
  return employeeColumnsCache;
};

const employeeDisplayNameSql = async ({ alias, source, fallback = "''", clientOrPool = db }) => {
  const columns = await getEmployeeColumns(clientOrPool);
  const parts = [];
  const resolvedFields = [];

  for (const column of ["full_name", "employee_name", "display_name"]) {
    if (!columns.has(column)) continue;
    parts.push(`NULLIF(${alias}.${column}, '')`);
    resolvedFields.push(column);
  }

  if (columns.has("first_name") || columns.has("last_name")) {
    const firstName = columns.has("first_name") ? `${alias}.first_name` : "''";
    const lastName = columns.has("last_name") ? `${alias}.last_name` : "''";
    parts.push(`NULLIF(TRIM(CONCAT_WS(' ', ${firstName}, ${lastName})), '')`);
    resolvedFields.push(["first_name", "last_name"].filter((column) => columns.has(column)).join("+"));
  }

  if (columns.has("job_title")) {
    parts.push(`NULLIF(${alias}.job_title, '')`);
    resolvedFields.push("job_title");
  }

  const expression = `COALESCE(${[...parts, fallback].join(", ")})`;
  console.log("[expenses-employee-name]", {
    source,
    alias,
    resolved_field: resolvedFields.join(",") || "fallback",
  });
  return expression;
};

const ensureExpensesSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS expense_categories (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      name VARCHAR(255) NOT NULL,
      type_key VARCHAR(80) NOT NULL DEFAULT 'other',
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      title VARCHAR(255) NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      category VARCHAR(120),
      note TEXT,
      payment_method VARCHAR(80) DEFAULT 'cash',
      status VARCHAR(50) NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT 'Expense'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS category VARCHAR(120)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS note TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(80) DEFAULT 'cash'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'draft'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS expense_type VARCHAR(80) NOT NULL DEFAULT 'other'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS category_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS warehouse_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS employee_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS supplier_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS expense_date DATE NOT NULL DEFAULT CURRENT_DATE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS notes TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS attachment_url TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS money_account_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS financial_account_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS cashbox_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS approved_by BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS rejected_by BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS paid_by BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS recurring_expense_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS journal_entry_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`UPDATE expenses SET notes = COALESCE(notes, note, '') WHERE notes IS NULL`);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS expense_attachments (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      expense_id BIGINT REFERENCES expenses(id) ON DELETE CASCADE,
      file_name VARCHAR(255) NOT NULL,
      file_url TEXT,
      mime_type VARCHAR(120),
      file_size BIGINT,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_advances (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      deducted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      deduction_month VARCHAR(7) NOT NULL,
      deduction_status VARCHAR(40) NOT NULL DEFAULT 'pending',
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      notes TEXT,
      expense_id BIGINT NULL,
      money_account_id BIGINT NULL,
      payroll_reference VARCHAR(120),
      created_by BIGINT,
      deducted_by BIGINT,
      deducted_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS money_account_id BIGINT NULL`);
  await clientOrPool.query(`
    UPDATE employee_advances
    SET remaining_amount = GREATEST(COALESCE(amount, 0) - COALESCE(deducted_amount, 0), 0)
    WHERE remaining_amount IS NULL OR remaining_amount = 0
  `);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      title VARCHAR(255) NOT NULL,
      expense_type VARCHAR(80) NOT NULL DEFAULT 'other',
      category_id BIGINT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(80) DEFAULT 'cash',
      branch_id BIGINT NULL,
      warehouse_id BIGINT NULL,
      supplier_id BIGINT NULL,
      employee_id BIGINT NULL,
      financial_account_id BIGINT NULL,
      frequency VARCHAR(30) NOT NULL DEFAULT 'monthly',
      next_due_date DATE NOT NULL DEFAULT CURRENT_DATE,
      auto_create BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      last_created_expense_id BIGINT NULL,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS expense_approvals (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      expense_id BIGINT REFERENCES expenses(id) ON DELETE CASCADE,
      action VARCHAR(40) NOT NULL,
      actor_id BIGINT,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date ON expenses (tenant_id, expense_date DESC, id DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_tenant_status ON expenses (tenant_id, status)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_advances_employee_status ON employee_advances (tenant_id, employee_id, deduction_status)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_expenses_due ON recurring_expenses (tenant_id, is_active, next_due_date)`);

  await normalizeEmployeeAdvanceRows(clientOrPool);

  await seedDefaultCategories(clientOrPool);
};

const normalizeEmployeeAdvanceRows = async (clientOrPool = db) => {
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'pending'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`
    UPDATE expenses
    SET expense_type = 'employee_advance',
        category = COALESCE(NULLIF(category, ''), 'employee_advance'),
        updated_at = NOW()
    WHERE (
        LOWER(COALESCE(expense_type, '')) IN ('employee advance', 'employee_advance', 'advance', 'staff advance')
        OR LOWER(COALESCE(category, '')) IN ('employee advance', 'employee_advance', 'advance', 'staff advance')
      )
      AND COALESCE(expense_type, '') <> 'employee_advance'
  `);
  await clientOrPool.query(`
    INSERT INTO employee_advances (
      tenant_id, employee_id, amount, deduction_month, deduction_status, status, notes, expense_id, created_by, created_at, updated_at
    )
    SELECT
      e.tenant_id,
      e.employee_id,
      COALESCE(e.amount, 0),
      to_char(COALESCE(e.expense_date, e.created_at::date, CURRENT_DATE), 'YYYY-MM'),
      'pending',
      'pending',
      COALESCE(NULLIF(e.notes, ''), NULLIF(e.note, '')),
      e.id,
      NULL,
      COALESCE(e.created_at, NOW()),
      NOW()
    FROM expenses e
    WHERE e.employee_id IS NOT NULL
      AND COALESCE(e.amount, 0) > 0
      AND (
        LOWER(COALESCE(e.expense_type, '')) = 'employee_advance'
        OR LOWER(COALESCE(e.category, '')) IN ('employee advance', 'employee_advance', 'advance', 'staff advance')
      )
      AND NOT EXISTS (
        SELECT 1 FROM employee_advances ea WHERE ea.expense_id = e.id
      )
  `);
  await clientOrPool.query(`
    UPDATE employee_advances
    SET remaining_amount = GREATEST(COALESCE(amount, 0) - COALESCE(deducted_amount, 0), 0),
        deduction_status = CASE
          WHEN deduction_status IN ('settled', 'deducted') THEN 'settled'
          WHEN deduction_status = 'included_in_payroll' THEN 'included_in_payroll'
          WHEN COALESCE(deducted_amount, 0) >= COALESCE(amount, 0) AND COALESCE(amount, 0) > 0 THEN 'settled'
          WHEN COALESCE(deducted_amount, 0) > 0 AND deduction_status IN ('pending', 'partial', 'partially_deducted') THEN 'partial'
          ELSE deduction_status
        END,
        status = CASE
          WHEN deduction_status = 'cancelled' THEN 'cancelled'
          WHEN deduction_status IN ('settled', 'deducted') OR (COALESCE(deducted_amount, 0) >= COALESCE(amount, 0) AND COALESCE(amount, 0) > 0) THEN 'settled'
          WHEN deduction_status = 'included_in_payroll' THEN 'included_in_payroll'
          ELSE 'pending'
        END,
        updated_at = NOW()
    WHERE remaining_amount IS DISTINCT FROM GREATEST(COALESCE(amount, 0) - COALESCE(deducted_amount, 0), 0)
       OR deduction_status IN ('partially_deducted', 'deducted')
       OR status IS NULL
       OR (deduction_status IN ('pending', 'partial', 'partially_deducted') AND status <> 'pending')
       OR (deduction_status = 'included_in_payroll' AND status <> 'included_in_payroll')
       OR (deduction_status = 'cancelled' AND status <> 'cancelled')
       OR (deduction_status IN ('settled', 'deducted') AND status <> 'settled')
  `);
};

const seedDefaultCategories = async (clientOrPool = db) => {
  const categories = [
    ["Utilities - Electricity", "electricity"],
    ["Utilities - Water", "water"],
    ["Rent", "rent"],
    ["Salaries", "salaries"],
    ["Shipping", "shipping"],
    ["Maintenance", "maintenance"],
    ["Groceries / Supplies", "groceries_supplies"],
    ["Marketing", "marketing"],
    ["Supplier Related", "supplier_related"],
    ["Employee Advance", "employee_advance"],
    ["Other", "other"],
  ];

  for (const [name, typeKey] of categories) {
    await clientOrPool.query(
      `
      INSERT INTO expense_categories (tenant_id, name, type_key, is_active)
      SELECT NULL, $1::varchar, $2::varchar, TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM expense_categories WHERE tenant_id IS NULL AND LOWER(name) = LOWER($1::varchar)
      )
      `,
      [name, typeKey]
    );
  }
};

const ensureExpensePermissions = async (clientOrPool = db) => {
  const permissions = [
    ["expenses", "view"],
    ["expenses", "create"],
    ["expenses", "edit"],
    ["expenses", "delete"],
    ["expenses", "approve"],
    ["expenses", "pay"],
    ["expenses", "reports"],
    ["expenses.advances", "view"],
    ["expenses.advances", "create"],
    ["expenses.advances", "deduct"],
  ];

  await clientOrPool.query(`ALTER TABLE IF EXISTS permissions ADD COLUMN IF NOT EXISTS description TEXT`);
  for (const [moduleName, action] of permissions) {
    await clientOrPool.query(
      `
      INSERT INTO permissions (module, action, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (module, action) DO UPDATE
      SET description = COALESCE(permissions.description, EXCLUDED.description)
      `,
      [moduleName, action, `${action} ${moduleName}`]
    );
  }

  await clientOrPool.query(
    `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE LOWER(REPLACE(COALESCE(r.name, ''), '_', ' ')) IN ('admin', 'super admin', 'superadmin', 'accountant')
      AND (
        p.module = 'expenses'
        OR p.module = 'expenses.advances'
      )
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
      )
    `
  );
};

router.use(async (_req, _res, next) => {
  try {
    await ensureExpensesSchema();
    await ensureExpensePermissions();
    next();
  } catch (error) {
    next(error);
  }
});

const buildExpenseSelect = async () => {
  const employeeNameExpr = await employeeDisplayNameSql({
    source: "expenses-list",
    alias: "emp",
    fallback: "''",
  });

  return `
  SELECT
    e.*,
    COALESCE(ec.name, e.category, '') AS category_name,
    COALESCE(b.name, '') AS branch_name,
    COALESCE(w.name, '') AS warehouse_name,
    ${employeeNameExpr} AS employee_name,
    COALESCE(s.name, '') AS supplier_name,
    COALESCE(fa.name, '') AS financial_account_name,
    COALESCE(u.name, '') AS approved_by_name
  FROM expenses e
  LEFT JOIN expense_categories ec ON ec.id = e.category_id
  LEFT JOIN branches b ON b.id = e.branch_id
  LEFT JOIN warehouses w ON w.id = e.warehouse_id
  LEFT JOIN employees emp ON emp.id = e.employee_id
  LEFT JOIN suppliers s ON s.id = e.supplier_id
  LEFT JOIN financial_accounts fa ON fa.id = e.financial_account_id
  LEFT JOIN users u ON u.id = e.approved_by
`;
};

const buildExpenseFilters = (req, tenantId) => {
  const where = [];
  const params = [];
  if (tenantId !== null) {
    params.push(tenantId);
    where.push(`e.tenant_id = $${params.length}`);
  }
  if (req.query.search) {
    params.push(`%${clean(req.query.search)}%`);
    where.push(`(
      e.title ILIKE $${params.length}
      OR e.notes ILIKE $${params.length}
      OR e.category ILIKE $${params.length}
      OR EXISTS (
        SELECT 1
        FROM employees emp_search
        WHERE emp_search.id = e.employee_id
          AND COALESCE(emp_search.full_name, emp_search.employee_code, '') ILIKE $${params.length}
      )
    )`);
  }
  for (const [queryKey, column] of [
    ["status", "e.status"],
    ["category_id", "e.category_id"],
    ["branch_id", "e.branch_id"],
    ["employee_id", "e.employee_id"],
    ["supplier_id", "e.supplier_id"],
    ["expense_type", "e.expense_type"],
  ]) {
    if (!req.query[queryKey]) continue;
    params.push(req.query[queryKey]);
    where.push(`${column}::text = $${params.length}::text`);
  }
  if (req.query.from) {
    params.push(req.query.from);
    where.push(`e.expense_date >= $${params.length}::date`);
  }
  if (req.query.to) {
    params.push(req.query.to);
    where.push(`e.expense_date <= $${params.length}::date`);
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
};

router.get("/dashboard", protect, permit("expenses", "view"), async (req, res) => {
  const tenantId = tenantScope(req);
  const tenantClause = tenantId === null ? "" : "WHERE tenant_id = $1";
  const tenantParams = tenantId === null ? [] : [tenantId];
  const expensesTenantClause = tenantId === null ? "" : "AND e.tenant_id = $1";
  const advanceTenantClause = tenantId === null ? "" : "AND tenant_id = $1";
  const employeeNameExpr = await employeeDisplayNameSql({
    source: "expenses-dashboard-by-employee",
    alias: "emp",
    fallback: "'Unlinked employee'",
  });
  const purchaseColumns = await getTableColumns(db, "purchases").catch(() => new Set());
  const purchaseTotalExpr = ["total_cost", "total", "total_amount", "grand_total", "net_total", "subtotal"]
    .filter((column) => purchaseColumns.has(column))
    .map((column) => `NULLIF(${column}, 0)`)
    .join(", ") || "0";

  const [
    summary,
    byCategory,
    byBranch,
    byEmployee,
    monthlyTrend,
    advances,
    recurringDue,
    revenue,
    cogs,
  ] = await Promise.all([
    db.query(
      `
      SELECT
        COALESCE(SUM(amount), 0)::numeric AS total,
        COALESCE(SUM(CASE WHEN expense_date = CURRENT_DATE THEN amount ELSE 0 END), 0)::numeric AS today,
        COALESCE(SUM(CASE WHEN date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE) THEN amount ELSE 0 END), 0)::numeric AS month,
        COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approval,
        COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count
      FROM expenses e
      WHERE 1=1 ${expensesTenantClause}
      `,
      tenantParams
    ),
    db.query(
      `
      SELECT COALESCE(ec.name, e.category, e.expense_type, 'Other') AS label, COALESCE(SUM(e.amount), 0)::numeric AS value
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE 1=1 ${expensesTenantClause}
      GROUP BY label
      ORDER BY value DESC
      LIMIT 8
      `,
      tenantParams
    ),
    db.query(
      `
      SELECT COALESCE(b.name, 'No branch assigned') AS label, COALESCE(SUM(e.amount), 0)::numeric AS value
      FROM expenses e
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE 1=1 ${expensesTenantClause}
      GROUP BY label
      ORDER BY value DESC
      LIMIT 8
      `,
      tenantParams
    ),
    db.query(
      `
      SELECT ${employeeNameExpr} AS label, COALESCE(SUM(e.amount), 0)::numeric AS value
      FROM expenses e
      LEFT JOIN employees emp ON emp.id = e.employee_id
      WHERE 1=1 ${expensesTenantClause}
      GROUP BY label
      ORDER BY value DESC
      LIMIT 8
      `,
      tenantParams
    ),
    db.query(
      `
      SELECT to_char(date_trunc('month', expense_date), 'YYYY-MM') AS month, COALESCE(SUM(amount), 0)::numeric AS value
      FROM expenses e
      WHERE expense_date >= CURRENT_DATE - INTERVAL '12 months' ${expensesTenantClause}
      GROUP BY 1
      ORDER BY 1
      `,
      tenantParams
    ),
    db.query(
      `
      SELECT
        COALESCE(SUM(GREATEST(COALESCE(remaining_amount, amount - COALESCE(deducted_amount, 0)), 0)), 0)::numeric AS outstanding,
        COUNT(*)::int AS count
      FROM employee_advances
      WHERE deduction_status IN ('pending', 'partial', 'partially_deducted', 'included_in_payroll') ${advanceTenantClause}
      `,
      tenantParams
    ),
    db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM recurring_expenses
      WHERE is_active = TRUE
        AND next_due_date <= CURRENT_DATE + INTERVAL '7 days'
        ${advanceTenantClause}
      `,
      tenantParams
    ),
    db.query(`SELECT COALESCE(SUM(total), 0)::numeric AS value FROM orders ${tenantClause ? `${tenantClause} AND` : "WHERE"} COALESCE(status, '') NOT IN ('cancelled', 'returned')`, tenantParams).catch(() => ({ rows: [{ value: 0 }] })),
    db.query(`SELECT COALESCE(SUM(COALESCE(${purchaseTotalExpr})), 0)::numeric AS value FROM purchases ${tenantClause ? `${tenantClause} AND` : "WHERE"} COALESCE(status, '') NOT IN ('cancelled')`, tenantParams).catch(() => ({ rows: [{ value: 0 }] })),
  ]);

  const totalExpenses = numeric(summary.rows[0]?.total);
  const profitImpact = numeric(revenue.rows[0]?.value) - numeric(cogs.rows[0]?.value) - totalExpenses;
  res.json({
    success: true,
    dashboard: {
      summary: {
        total: totalExpenses,
        today: numeric(summary.rows[0]?.today),
        month: numeric(summary.rows[0]?.month),
        pending_approval: numeric(summary.rows[0]?.pending_approval),
        paid_count: numeric(summary.rows[0]?.paid_count),
        advances_outstanding: numeric(advances.rows[0]?.outstanding),
        advances_count: numeric(advances.rows[0]?.count),
        recurring_due: numeric(recurringDue.rows[0]?.count),
        profit_impact: profitImpact,
      },
      by_category: byCategory.rows,
      by_branch: byBranch.rows,
      by_employee: byEmployee.rows,
      monthly_trend: monthlyTrend.rows,
    },
  });
});

router.get("/", protect, permit("expenses", "view"), async (req, res) => {
  const tenantId = tenantScope(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const filters = buildExpenseFilters(req, tenantId);
  const expenseSelect = await buildExpenseSelect();

  const rows = await db.query(
    `${expenseSelect} ${filters.where} ORDER BY e.expense_date DESC, e.id DESC LIMIT $${filters.params.length + 1} OFFSET $${filters.params.length + 2}`,
    [...filters.params, limit, offset]
  );
  const total = await db.query(`SELECT COUNT(*)::int AS count FROM expenses e ${filters.where}`, filters.params);
  res.json({
    success: true,
    expenses: rows.rows,
    pagination: { page, limit, total: Number(total.rows[0]?.count || 0), totalPages: Math.ceil(Number(total.rows[0]?.count || 0) / limit) },
  });
});

const applyUploadedAttachment = (payload, file) => {
  if (!file) return payload;
  return {
    ...payload,
    attachment_name: file.originalname || file.filename,
    attachment_url: `/uploads/expenses/${file.filename}`,
  };
};

const readExpensePayload = (body = {}) => {
  const amount = numeric(body.amount);
  const expenseType = normalizeExpenseType(body.expense_type || body.expenseType || body.category);
  return {
    title: clean(body.title),
    amount,
    expense_type: EXPENSE_TYPES.includes(expenseType) ? expenseType : "other",
    category_id: optionalId(body.category_id || body.categoryId),
    category: isEmployeeAdvanceType(expenseType) ? "employee_advance" : clean(body.category),
    payment_method: clean(body.payment_method || body.paymentMethod || "cash").toLowerCase(),
    branch_id: optionalId(body.branch_id || body.branchId),
    warehouse_id: optionalId(body.warehouse_id || body.warehouseId),
    employee_id: optionalId(body.employee_id || body.employeeId),
    supplier_id: optionalId(body.supplier_id || body.supplierId),
    expense_date: body.expense_date || body.date || new Date().toISOString().slice(0, 10),
    deduction_month: resolveDeductionMonth(body),
    notes: clean(body.notes || body.note),
    attachment_url: clean(body.attachment_url || body.attachmentUrl || body.attachment),
    attachment_name: clean(body.attachment_name || body.attachmentName || body.attachment),
    money_account_id: optionalId(body.money_account_id || body.moneyAccountId || body.payment_account_id || body.paymentAccountId),
    financial_account_id: optionalId(body.financial_account_id || body.financialAccountId || body.account_id || body.accountId),
    cashbox_id: optionalId(body.cashbox_id || body.cashboxId),
    status: pick(body.status, APPROVAL_STATUSES, "draft"),
  };
};

router.post("/", protect, permit("expenses", "create"), expenseAttachmentUpload.single("attachment"), async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const payload = applyUploadedAttachment(readExpensePayload(req.body), req.file);
    if (!payload.title || payload.amount <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Expense title and positive amount are required" });
    }
    if (payload.expense_type === "employee_advance" && !payload.employee_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Employee is required for employee advance expenses" });
    }

    const result = await client.query(
      `
      INSERT INTO expenses (
        tenant_id, title, amount, expense_type, category_id, category, payment_method,
        branch_id, warehouse_id, employee_id, supplier_id, expense_date, notes,
        attachment_url, attachment_name, money_account_id, financial_account_id, cashbox_id, status, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW())
      RETURNING *
      `,
      [
        tenantId,
        payload.title,
        payload.amount,
        payload.expense_type,
        payload.category_id,
        payload.category,
        payload.payment_method,
        payload.branch_id,
        payload.warehouse_id,
        payload.employee_id,
        payload.supplier_id,
        payload.expense_date,
        payload.notes,
        payload.attachment_url,
        payload.attachment_name,
        payload.money_account_id,
        payload.financial_account_id,
        payload.cashbox_id,
        payload.status,
      ]
    );

    if (payload.attachment_name || payload.attachment_url) {
      await client.query(
        `
        INSERT INTO expense_attachments (tenant_id, expense_id, file_name, file_url, created_by)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [tenantId, result.rows[0].id, payload.attachment_name || "Attachment", payload.attachment_url, req.user?.id || null]
      );
    }

    let advance = null;
    if (payload.expense_type === "employee_advance") {
      const advanceResult = await client.query(
        `
        INSERT INTO employee_advances (
          tenant_id, employee_id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status, notes, expense_id, money_account_id, created_by, created_at, updated_at
        )
        VALUES ($1,$2,$3,0,$3,$4,'pending','pending',$5,$6,$7,$8,NOW(),NOW())
        RETURNING *
        `,
        [tenantId, payload.employee_id, payload.amount, payload.deduction_month, payload.notes, result.rows[0].id, payload.money_account_id, req.user?.id || null]
      );
      advance = advanceResult.rows[0];
      console.log("[expenses] advance created", {
        source: "expense-create",
        advance_id: advance.id,
        expense_id: result.rows[0].id,
        employee_id: payload.employee_id,
        amount: payload.amount,
        deduction_month: payload.deduction_month,
        remaining_amount: advance.remaining_amount,
        deduction_status: advance.deduction_status,
        status: advance.status || "pending",
      });
    }

    await client.query("COMMIT");
    res.status(201).json({ success: true, expense: result.rows[0], advance });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[expenses] create failed", error);
    res.status(500).json({ success: false, message: error.message || "Failed to create expense" });
  } finally {
    client.release();
  }
});

router.put("/:id", protect, permit("expenses", "edit"), expenseAttachmentUpload.single("attachment"), async (req, res) => {
  const tenantId = tenantScope(req);
  const payload = applyUploadedAttachment(readExpensePayload(req.body), req.file);
  if (!payload.title || payload.amount <= 0) {
    return res.status(400).json({ success: false, message: "Expense title and positive amount are required" });
  }
  if (payload.expense_type === "employee_advance" && !payload.employee_id) {
    return res.status(400).json({ success: false, message: "Employee is required for employee advance expenses" });
  }

  const params = [
    req.params.id,
    payload.title,
    payload.amount,
    payload.expense_type,
    payload.category_id,
    payload.category,
    payload.payment_method,
    payload.branch_id,
    payload.warehouse_id,
    payload.employee_id,
    payload.supplier_id,
    payload.expense_date,
    payload.notes,
    payload.attachment_url,
    payload.attachment_name,
    payload.money_account_id,
    payload.financial_account_id,
    payload.cashbox_id,
    payload.status,
  ];
  let tenantClause = "";
  if (tenantId !== null) {
    params.push(tenantId);
    tenantClause = `AND tenant_id = $${params.length}`;
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
    `
    UPDATE expenses
    SET title = $2, amount = $3, expense_type = $4, category_id = $5, category = $6,
        payment_method = $7, branch_id = $8, warehouse_id = $9, employee_id = $10,
        supplier_id = $11, expense_date = $12, notes = $13, attachment_url = $14,
        attachment_name = $15, money_account_id = $16, financial_account_id = $17, cashbox_id = $18, status = $19,
        updated_at = NOW()
    WHERE id = $1 ${tenantClause}
      AND status <> 'paid'
    RETURNING *
    `,
    params
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Expense not found or already paid" });
    }

    let advance = null;
    if (payload.expense_type === "employee_advance") {
      const existingAdvance = await client.query(
        `
        SELECT id
        FROM employee_advances
        WHERE expense_id = $1
          AND deduction_status IN ('pending', 'partial', 'partially_deducted', 'included_in_payroll')
        ORDER BY id ASC
        LIMIT 1
        `,
        [result.rows[0].id]
      );
      if (existingAdvance.rowCount) {
        const updateAdvance = await client.query(
          `
          UPDATE employee_advances
          SET employee_id = $2,
              amount = $3,
              remaining_amount = GREATEST($3 - COALESCE(deducted_amount, 0), 0),
              deduction_status = CASE
                WHEN COALESCE(deducted_amount, 0) >= $3 THEN 'settled'
                WHEN deduction_status = 'included_in_payroll' THEN 'included_in_payroll'
                WHEN COALESCE(deducted_amount, 0) > 0 THEN 'partial'
                ELSE 'pending'
              END,
              status = CASE
                WHEN COALESCE(deducted_amount, 0) >= $3 THEN 'settled'
                WHEN deduction_status = 'included_in_payroll' THEN 'included_in_payroll'
                ELSE 'pending'
              END,
              deduction_month = $4,
              notes = $5,
              money_account_id = $6,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
          `,
          [existingAdvance.rows[0].id, payload.employee_id, payload.amount, payload.deduction_month, payload.notes, payload.money_account_id]
        );
        advance = updateAdvance.rows[0] || null;
      } else {
        const advanceResult = await client.query(
        `
        INSERT INTO employee_advances (
          tenant_id, employee_id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status, notes, expense_id, money_account_id, created_by, created_at, updated_at
        )
        VALUES ($1,$2,$3,0,$3,$4,'pending','pending',$5,$6,$7,$8,NOW(),NOW())
        RETURNING *
        `,
        [result.rows[0].tenant_id, payload.employee_id, payload.amount, payload.deduction_month, payload.notes, result.rows[0].id, payload.money_account_id, req.user?.id || null]
        );
        advance = advanceResult.rows[0];
      }
      console.log("[expenses] advance created", {
        source: "expense-update",
        advance_id: advance?.id || null,
        expense_id: result.rows[0].id,
        employee_id: payload.employee_id,
        amount: payload.amount,
        deduction_month: payload.deduction_month,
        remaining_amount: advance?.remaining_amount,
        deduction_status: advance?.deduction_status,
        status: advance?.status || "pending",
      });
    } else {
      await client.query(
        `
        UPDATE employee_advances
        SET deduction_status = 'cancelled',
            status = 'cancelled',
            updated_at = NOW()
        WHERE expense_id = $1
          AND deduction_status IN ('pending', 'partial', 'partially_deducted', 'included_in_payroll')
        `,
        [result.rows[0].id]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, expense: result.rows[0], advance });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[expenses] update failed", error);
    res.status(500).json({ success: false, message: error.message || "Failed to update expense" });
  } finally {
    client.release();
  }
});

router.delete("/:id", protect, permit("expenses", "delete"), async (req, res) => {
  const tenantId = tenantScope(req);
  const params = [req.params.id];
  const tenantClause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
      UPDATE employee_advances
      SET deduction_status = 'cancelled',
          status = 'cancelled',
          updated_at = NOW()
      WHERE expense_id = $1
        AND deduction_status IN ('pending', 'partial', 'partially_deducted', 'included_in_payroll')
      `,
      [req.params.id]
    );
    const result = await client.query(`DELETE FROM expenses WHERE id = $1 ${tenantClause} AND status <> 'paid' RETURNING id`, params);
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Expense not found or already paid" });
    }
    await client.query("COMMIT");
    res.json({ success: true, deleted_id: result.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[expenses] delete failed", error);
    res.status(500).json({ success: false, message: error.message || "Failed to delete expense" });
  } finally {
    client.release();
  }
});

router.post("/:id/approve", protect, permit("expenses", "approve"), async (req, res) => {
  const tenantId = tenantScope(req);
  const params = [req.params.id, req.user?.id || null];
  const tenantClause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
  const result = await db.query(
    `
    UPDATE expenses
    SET status = 'approved', approved_by = $2, approved_at = NOW(), rejection_reason = NULL, updated_at = NOW()
    WHERE id = $1 ${tenantClause}
      AND status IN ('draft', 'pending_approval', 'rejected')
    RETURNING *
    `,
    params
  );
  if (!result.rowCount) return res.status(404).json({ success: false, message: "Expense not found or cannot be approved" });
  await db.query(`INSERT INTO expense_approvals (tenant_id, expense_id, action, actor_id) VALUES ($1,$2,'approved',$3)`, [tenantId, req.params.id, req.user?.id || null]);
  res.json({ success: true, expense: result.rows[0] });
});

router.post("/:id/reject", protect, permit("expenses", "approve"), async (req, res) => {
  const tenantId = tenantScope(req);
  const reason = clean(req.body?.reason || req.body?.rejection_reason);
  const params = [req.params.id, req.user?.id || null, reason];
  const tenantClause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
  const result = await db.query(
    `
    UPDATE expenses
    SET status = 'rejected', rejected_by = $2, rejected_at = NOW(), rejection_reason = $3, updated_at = NOW()
    WHERE id = $1 ${tenantClause}
      AND status IN ('draft', 'pending_approval', 'approved')
    RETURNING *
    `,
    params
  );
  if (!result.rowCount) return res.status(404).json({ success: false, message: "Expense not found or cannot be rejected" });
  await db.query(`INSERT INTO expense_approvals (tenant_id, expense_id, action, actor_id, reason) VALUES ($1,$2,'rejected',$3,$4)`, [tenantId, req.params.id, req.user?.id || null, reason]);
  res.json({ success: true, expense: result.rows[0] });
});

const postExpenseAccounting = async (client, expense, req) => {
  const tenantId = expense.tenant_id;
  const amount = numeric(expense.amount);
  const isAdvance = isEmployeeAdvanceType(expense.expense_type || expense.category);
  if (String(expense.payment_method || "").toLowerCase() === "cash") {
    await recordCashDrawerEvent(client, {
      tenantId,
      branchId: expense.branch_id || req.user?.branch_id || null,
      createdBy: req.user?.id || null,
      eventType: "expense_cash",
      sourceType: "expense",
      sourceId: expense.id,
      amount,
    });
  }
  await recordFinancialAccountActivity(client, {
    tenantId,
    branchId: expense.branch_id || req.user?.branch_id || null,
    moneyAccountId: expense.money_account_id || req.body?.money_account_id || req.body?.moneyAccountId || req.body?.payment_account_id || req.body?.paymentAccountId || null,
    financialAccountId: expense.financial_account_id || null,
    paymentMethod: expense.payment_method || "cash",
    entryType: isAdvance ? "employee_advance" : "expense",
    direction: -1,
    sourceType: isAdvance ? "employee_advance" : "expense",
    sourceId: expense.id,
    amount,
    notes: expense.title,
    createdBy: req.user?.id || null,
  });

  try {
    const journal = await createJournalEntry(client, {
      tenantId,
      referenceType: isAdvance ? "employee_advance" : "expense",
      referenceId: expense.id,
      description: expense.title,
      entryDate: expense.expense_date,
      createdBy: req.user?.id || null,
      isGenerated: true,
      entryType: isAdvance ? "employee_advance" : "expense",
      sourceKey: "expenses.center",
      lines: [
        { account_code: "5200", debit: amount, credit: 0, branch_id: expense.branch_id, notes: expense.title },
        { account_code: "1000", debit: 0, credit: amount, branch_id: expense.branch_id, notes: expense.payment_method || "cash" },
      ],
    });
    await client.query(`UPDATE expenses SET journal_entry_id = $1 WHERE id = $2`, [journal.id, expense.id]);
  } catch (error) {
    console.warn("[expenses] journal entry skipped", error.message);
  }
};

router.post("/:id/mark-paid", protect, permit("expenses", "pay"), async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = tenantScope(req);
    const params = [req.params.id];
    const tenantClause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
    const selected = await client.query(`SELECT * FROM expenses WHERE id = $1 ${tenantClause} FOR UPDATE`, params);
    const expense = selected.rows[0];
    if (!expense) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Expense not found" });
    }
    if (expense.status === "paid") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Expense is already paid" });
    }
    if (!["approved", "draft"].includes(expense.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Only draft or approved expenses can be paid" });
    }

    const paid = await client.query(
      `
      UPDATE expenses
      SET status = 'paid',
          paid_at = NOW(),
          paid_by = $2,
          money_account_id = COALESCE($3, money_account_id),
          financial_account_id = COALESCE($4, financial_account_id),
          payment_method = COALESCE(NULLIF($5, ''), payment_method),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        expense.id,
        req.user?.id || null,
        optionalId(req.body?.money_account_id || req.body?.moneyAccountId || req.body?.payment_account_id || req.body?.paymentAccountId),
        optionalId(req.body?.financial_account_id || req.body?.financialAccountId || req.body?.account_id || req.body?.accountId),
        clean(req.body?.payment_method || req.body?.paymentMethod),
      ]
    );
    await postExpenseAccounting(client, paid.rows[0], req);
    await client.query("COMMIT");
    res.json({ success: true, expense: paid.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[expenses] mark paid failed", error);
    res.status(500).json({ success: false, message: error.message || "Failed to mark expense paid" });
  } finally {
    client.release();
  }
});

router.get("/categories", protect, permit("expenses", "view"), async (req, res) => {
  const tenantId = tenantScope(req);
  const result = await db.query(
    `
    SELECT *
    FROM expense_categories
    WHERE (tenant_id IS NULL OR $1::bigint IS NULL OR tenant_id = $1)
      AND ($2::text IS NULL OR is_active::text = $2)
    ORDER BY is_active DESC, name ASC
    `,
    [tenantId, req.query.active || null]
  );
  res.json({ success: true, categories: result.rows });
});

router.post("/categories", protect, permit("expenses", "create"), async (req, res) => {
  const tenantId = getTenantId(req, req.user?.tenant_id);
  const name = clean(req.body?.name);
  if (!name) return res.status(400).json({ success: false, message: "Category name is required" });
  const result = await db.query(
    `
    INSERT INTO expense_categories (tenant_id, name, type_key, description, is_active, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
    RETURNING *
    `,
    [tenantId, name, pick(req.body?.type_key || req.body?.typeKey, EXPENSE_TYPES, "other"), clean(req.body?.description), req.body?.is_active !== false]
  );
  res.status(201).json({ success: true, category: result.rows[0] });
});

router.put("/categories/:id", protect, permit("expenses", "edit"), async (req, res) => {
  const tenantId = tenantScope(req);
  const params = [
    req.params.id,
    clean(req.body?.name),
    pick(req.body?.type_key || req.body?.typeKey, EXPENSE_TYPES, "other"),
    clean(req.body?.description),
    req.body?.is_active !== false,
  ];
  const tenantClause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
  const result = await db.query(
    `
    UPDATE expense_categories
    SET name = $2, type_key = $3, description = $4, is_active = $5, updated_at = NOW()
    WHERE id = $1 ${tenantClause}
    RETURNING *
    `,
    params
  );
  if (!result.rowCount) return res.status(404).json({ success: false, message: "Category not found" });
  res.json({ success: true, category: result.rows[0] });
});

router.get("/employee-advances", protect, permit("expenses.advances", "view"), async (req, res) => {
  const tenantId = tenantScope(req);
  const params = [];
  const where = [];
  const employeeNameExpr = await employeeDisplayNameSql({
    source: "expenses-employee-advances",
    alias: "e",
    fallback: "''",
  });
  if (tenantId !== null) {
    params.push(tenantId);
    where.push(`ea.tenant_id = $${params.length}`);
  }
  if (req.query.employee_id) {
    params.push(req.query.employee_id);
    where.push(`ea.employee_id::text = $${params.length}::text`);
  }
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`ea.deduction_status = $${params.length}`);
  }
  const result = await db.query(
    `
    SELECT ea.*, ${employeeNameExpr} AS employee_name
    FROM employee_advances ea
    LEFT JOIN employees e ON e.id = ea.employee_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ea.created_at DESC, ea.id DESC
    LIMIT 200
    `,
    params
  );
  res.json({ success: true, advances: result.rows });
});

router.post("/employee-advances", protect, permit("expenses.advances", "create"), async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const employeeId = optionalId(req.body?.employee_id || req.body?.employeeId);
    const amount = numeric(req.body?.amount);
    const deductionMonth = clean(req.body?.deduction_month || req.body?.deductionMonth || new Date().toISOString().slice(0, 7));
    const moneyAccountId = optionalId(req.body?.money_account_id || req.body?.moneyAccountId || req.body?.payment_account_id || req.body?.paymentAccountId);
    const financialAccountId = optionalId(req.body?.financial_account_id || req.body?.financialAccountId || req.body?.account_id || req.body?.accountId);
    const paymentMethod = clean(req.body?.payment_method || req.body?.paymentMethod || "cash").toLowerCase();
    const shouldPayNow = req.body?.paid === true || String(req.body?.status || "").toLowerCase() === "paid";
    if (!employeeId || amount <= 0 || !/^\d{4}-\d{2}$/.test(deductionMonth)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Employee, positive amount, and deduction month are required" });
    }

    const expense = await client.query(
      `
      INSERT INTO expenses (
        tenant_id, title, amount, expense_type, category, payment_method, employee_id,
        money_account_id, financial_account_id, expense_date, notes, status, created_at, updated_at
      )
      VALUES ($1,$2,$3,'employee_advance','employee_advance',$4,$5,$6,$7,($9::text || '-01')::date,$8,$10,NOW(),NOW())
      RETURNING *
      `,
      [
        tenantId,
        clean(req.body?.title) || "Employee advance",
        amount,
        paymentMethod,
        employeeId,
        moneyAccountId,
        financialAccountId,
        clean(req.body?.notes),
        deductionMonth,
        shouldPayNow ? "paid" : "approved",
      ]
    );

    const advance = await client.query(
      `
      INSERT INTO employee_advances (
        tenant_id, employee_id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status, notes, expense_id, money_account_id, created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,0,$3,$4,'pending','pending',$5,$6,$7,$8,NOW(),NOW())
      RETURNING *
      `,
      [tenantId, employeeId, amount, deductionMonth, clean(req.body?.notes), expense.rows[0].id, moneyAccountId, req.user?.id || null]
    );

    if (shouldPayNow) {
      await postExpenseAccounting(client, expense.rows[0], req);
    }
    console.log("[expenses] advance created", {
      source: "advance-create",
      advance_id: advance.rows[0]?.id,
      expense_id: expense.rows[0]?.id,
      employee_id: employeeId,
      amount,
      deduction_month: deductionMonth,
      remaining_amount: advance.rows[0]?.remaining_amount,
      deduction_status: advance.rows[0]?.deduction_status,
      status: advance.rows[0]?.status || "pending",
    });

    await client.query("COMMIT");
    res.status(201).json({ success: true, advance: advance.rows[0], expense: expense.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[expenses] advance create failed", error);
    res.status(500).json({ success: false, message: error.message || "Failed to create employee advance" });
  } finally {
    client.release();
  }
});

router.put("/employee-advances/:id", protect, permit("expenses.advances", "create"), async (req, res) => {
  const tenantId = tenantScope(req);
  const status = pick(req.body?.deduction_status || req.body?.deductionStatus, ADVANCE_STATUSES, "pending");
  const deductedAmount = numeric(req.body?.deducted_amount || req.body?.deductedAmount);
  const params = [req.params.id, status, deductedAmount, clean(req.body?.notes)];
  const tenantClause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
  const result = await db.query(
    `
    UPDATE employee_advances
    SET deduction_status = CASE
          WHEN $2 = 'cancelled' THEN 'cancelled'
          WHEN $2 IN ('settled', 'deducted') THEN 'settled'
          WHEN $2 = 'included_in_payroll' THEN 'included_in_payroll'
          WHEN LEAST($3, amount) >= amount AND amount > 0 THEN 'settled'
          WHEN LEAST($3, amount) > 0 THEN 'partial'
          ELSE 'pending'
        END,
        deducted_amount = CASE
          WHEN $2 IN ('settled', 'deducted') THEN amount
          WHEN $2 = 'included_in_payroll' THEN deducted_amount
          ELSE LEAST($3, amount)
        END,
        remaining_amount = CASE
          WHEN $2 IN ('settled', 'deducted') THEN 0
          WHEN $2 = 'included_in_payroll' THEN remaining_amount
          ELSE GREATEST(amount - LEAST($3, amount), 0)
        END,
        status = CASE
          WHEN $2 = 'cancelled' THEN 'cancelled'
          WHEN $2 IN ('settled', 'deducted') OR (LEAST($3, amount) >= amount AND amount > 0) THEN 'settled'
          WHEN $2 = 'included_in_payroll' THEN 'included_in_payroll'
          ELSE 'pending'
        END,
        notes = $4,
        updated_at = NOW()
    WHERE id = $1 ${tenantClause}
    RETURNING *
    `,
    params
  );
  if (!result.rowCount) return res.status(404).json({ success: false, message: "Advance not found" });
  res.json({ success: true, advance: result.rows[0] });
});

router.post("/employee-advances/:id/deduct", protect, permit("expenses.advances", "deduct"), async (req, res) => {
  const tenantId = tenantScope(req);
  const params = [req.params.id, req.user?.id || null, clean(req.body?.payroll_reference || req.body?.payrollReference)];
  const tenantClause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
  const result = await db.query(
    `
    UPDATE employee_advances
    SET deduction_status = 'included_in_payroll',
        status = 'included_in_payroll',
        deducted_by = $2,
        payroll_reference = NULLIF($3, ''),
        updated_at = NOW()
    WHERE id = $1 ${tenantClause}
      AND deduction_status IN ('pending', 'partial', 'partially_deducted', 'included_in_payroll')
      AND GREATEST(COALESCE(remaining_amount, amount - COALESCE(deducted_amount, 0)), 0) > 0
    RETURNING *
    `,
    params
  );
  if (!result.rowCount) return res.status(404).json({ success: false, message: "Advance not found or already settled" });
  console.log("[payroll-advance-settlement]", {
    employee_id: result.rows[0]?.employee_id,
    advance_id: result.rows[0]?.id,
    payroll_period: result.rows[0]?.deduction_month,
    advance_amount: numeric(result.rows[0]?.remaining_amount || result.rows[0]?.amount),
    included_in_preview: true,
    finalized: false,
    settlement_status: result.rows[0]?.deduction_status,
  });
  res.json({ success: true, advance: result.rows[0] });
});

router.get("/recurring", protect, permit("expenses", "view"), async (req, res) => {
  const tenantId = tenantScope(req);
  const params = [];
  const where = [];
  const employeeNameExpr = await employeeDisplayNameSql({
    source: "expenses-recurring",
    alias: "emp",
    fallback: "''",
  });
  if (tenantId !== null) {
    params.push(tenantId);
    where.push(`re.tenant_id = $${params.length}`);
  }
  if (req.query.active) {
    params.push(req.query.active === "true");
    where.push(`re.is_active = $${params.length}`);
  }
  const result = await db.query(
    `
    SELECT re.*, COALESCE(ec.name, '') AS category_name, COALESCE(b.name, '') AS branch_name, ${employeeNameExpr} AS employee_name
    FROM recurring_expenses re
    LEFT JOIN expense_categories ec ON ec.id = re.category_id
    LEFT JOIN branches b ON b.id = re.branch_id
    LEFT JOIN employees emp ON emp.id = re.employee_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY re.is_active DESC, re.next_due_date ASC, re.id DESC
    `,
    params
  );
  res.json({ success: true, recurring_expenses: result.rows });
});

router.post("/recurring", protect, permit("expenses", "create"), async (req, res) => {
  const tenantId = getTenantId(req, req.user?.tenant_id);
  const title = clean(req.body?.title);
  const amount = numeric(req.body?.amount);
  if (!title || amount <= 0) return res.status(400).json({ success: false, message: "Recurring title and positive amount are required" });
  const result = await db.query(
    `
    INSERT INTO recurring_expenses (
      tenant_id, title, expense_type, category_id, amount, payment_method, branch_id, warehouse_id,
      supplier_id, employee_id, financial_account_id, frequency, next_due_date, auto_create,
      is_active, notes, created_by, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
    RETURNING *
    `,
    [
      tenantId,
      title,
      pick(req.body?.expense_type || req.body?.expenseType, EXPENSE_TYPES, "other"),
      optionalId(req.body?.category_id || req.body?.categoryId),
      amount,
      clean(req.body?.payment_method || req.body?.paymentMethod || "cash"),
      optionalId(req.body?.branch_id || req.body?.branchId),
      optionalId(req.body?.warehouse_id || req.body?.warehouseId),
      optionalId(req.body?.supplier_id || req.body?.supplierId),
      optionalId(req.body?.employee_id || req.body?.employeeId),
      optionalId(req.body?.financial_account_id || req.body?.financialAccountId),
      pick(req.body?.frequency, RECURRING_FREQUENCIES, "monthly"),
      req.body?.next_due_date || req.body?.nextDueDate || new Date().toISOString().slice(0, 10),
      Boolean(req.body?.auto_create || req.body?.autoCreate),
      req.body?.is_active !== false,
      clean(req.body?.notes),
      req.user?.id || null,
    ]
  );
  res.status(201).json({ success: true, recurring_expense: result.rows[0] });
});

router.put("/recurring/:id", protect, permit("expenses", "edit"), async (req, res) => {
  const tenantId = tenantScope(req);
  const params = [
    req.params.id,
    clean(req.body?.title),
    pick(req.body?.expense_type || req.body?.expenseType, EXPENSE_TYPES, "other"),
    optionalId(req.body?.category_id || req.body?.categoryId),
    numeric(req.body?.amount),
    clean(req.body?.payment_method || req.body?.paymentMethod || "cash"),
    optionalId(req.body?.branch_id || req.body?.branchId),
    pick(req.body?.frequency, RECURRING_FREQUENCIES, "monthly"),
    req.body?.next_due_date || req.body?.nextDueDate || new Date().toISOString().slice(0, 10),
    Boolean(req.body?.auto_create || req.body?.autoCreate),
    req.body?.is_active !== false,
    clean(req.body?.notes),
  ];
  const tenantClause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
  const result = await db.query(
    `
    UPDATE recurring_expenses
    SET title = $2, expense_type = $3, category_id = $4, amount = $5, payment_method = $6,
        branch_id = $7, frequency = $8, next_due_date = $9, auto_create = $10,
        is_active = $11, notes = $12, updated_at = NOW()
    WHERE id = $1 ${tenantClause}
    RETURNING *
    `,
    params
  );
  if (!result.rowCount) return res.status(404).json({ success: false, message: "Recurring expense not found" });
  res.json({ success: true, recurring_expense: result.rows[0] });
});

export default router;
