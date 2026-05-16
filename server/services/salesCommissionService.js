import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

const DEFAULT_SETTINGS = {
  allow_sale_without_salesperson: true,
  fixed_commission_mode: "fixed_per_invoice",
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const normalizeFixedMode = (value = "") =>
  String(value || "").trim() === "fixed_per_item" ? "fixed_per_item" : "fixed_per_invoice";

const normalizeCommissionType = (value = "") =>
  String(value || "").trim() === "fixed" ? "fixed" : "percent";

const normalizeIds = (value = []) => {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
};

export const resolveTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));

export const ensureSalesCommissionSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS sales_employees (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(80),
      phone VARCHAR(80),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      commission_type VARCHAR(20) NOT NULL DEFAULT 'percent',
      commission_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS code VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS phone VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS commission_type VARCHAR(20) NOT NULL DEFAULT 'percent'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS commission_value NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_sales_employees_tenant_active ON sales_employees (tenant_id, is_active, name)`);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS sales_commission_settings (
      tenant_id BIGINT PRIMARY KEY,
      allow_sale_without_salesperson BOOLEAN NOT NULL DEFAULT TRUE,
      fixed_commission_mode VARCHAR(30) NOT NULL DEFAULT 'fixed_per_invoice',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_name VARCHAR(255)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_commission_type VARCHAR(20)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_commission_value NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_fixed_mode VARCHAR(30)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_salesperson_created ON orders (tenant_id, salesperson_id, created_at DESC)`);

  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_commissions ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'legacy'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_commissions ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_commissions ADD COLUMN IF NOT EXISTS net_sale_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_commissions ADD COLUMN IF NOT EXISTS snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`);
};

export const getSalesSettings = async (clientOrPool = db, tenantId = null) => {
  await ensureSalesCommissionSchema(clientOrPool);
  const settingsTenantId = tenantId ?? 0;
  const result = await clientOrPool.query(
    `SELECT * FROM sales_commission_settings WHERE tenant_id = $1 LIMIT 1`,
    [settingsTenantId]
  );
  const row = result.rows[0] || {};
  return {
    allow_sale_without_salesperson: row.allow_sale_without_salesperson ?? DEFAULT_SETTINGS.allow_sale_without_salesperson,
    fixed_commission_mode: normalizeFixedMode(row.fixed_commission_mode || DEFAULT_SETTINGS.fixed_commission_mode),
  };
};

export const upsertSalesSettings = async (clientOrPool = db, tenantId = null, settings = {}) => {
  await ensureSalesCommissionSchema(clientOrPool);
  const settingsTenantId = tenantId ?? 0;
  const next = {
    allow_sale_without_salesperson: toBool(settings.allow_sale_without_salesperson, DEFAULT_SETTINGS.allow_sale_without_salesperson),
    fixed_commission_mode: normalizeFixedMode(settings.fixed_commission_mode || DEFAULT_SETTINGS.fixed_commission_mode),
  };
  const result = await clientOrPool.query(
    `
    INSERT INTO sales_commission_settings (tenant_id, allow_sale_without_salesperson, fixed_commission_mode)
    VALUES ($1,$2,$3)
    ON CONFLICT (tenant_id) DO UPDATE
    SET allow_sale_without_salesperson = EXCLUDED.allow_sale_without_salesperson,
        fixed_commission_mode = EXCLUDED.fixed_commission_mode,
        updated_at = NOW()
    RETURNING *
    `,
    [settingsTenantId, next.allow_sale_without_salesperson, next.fixed_commission_mode]
  );
  return {
    allow_sale_without_salesperson: result.rows[0].allow_sale_without_salesperson,
    fixed_commission_mode: result.rows[0].fixed_commission_mode,
  };
};

export const listSalesEmployees = async ({ tenantId = null, includeInactive = false } = {}) => {
  await ensureSalesCommissionSchema(db);
  const result = await db.query(
    `
    SELECT *
    FROM sales_employees
    WHERE ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)
      AND ($2::boolean = TRUE OR is_active = TRUE)
    ORDER BY is_active DESC, name ASC, id ASC
    `,
    [tenantId, includeInactive]
  );
  return result.rows.map((row) => ({
    ...row,
    commission_value: toNumber(row.commission_value),
    excluded_product_ids: normalizeIds(row.excluded_product_ids),
  }));
};

export const saveSalesEmployee = async ({ tenantId = null, id = null, data = {} } = {}) => {
  await ensureSalesCommissionSchema(db);
  const payload = {
    name: String(data.name || "").trim(),
    code: String(data.code || "").trim() || null,
    phone: String(data.phone || "").trim() || null,
    is_active: toBool(data.is_active, true),
    commission_type: normalizeCommissionType(data.commission_type),
    commission_value: Math.max(0, toNumber(data.commission_value)),
    excluded_product_ids: normalizeIds(data.excluded_product_ids),
  };

  if (!payload.name) {
    const error = new Error("Sales employee name is required");
    error.status = 400;
    throw error;
  }

  if (id) {
    const result = await db.query(
      `
      UPDATE sales_employees
      SET name = $1,
          code = $2,
          phone = $3,
          is_active = $4,
          commission_type = $5,
          commission_value = $6,
          excluded_product_ids = $7::jsonb,
          updated_at = NOW()
      WHERE id = $8
        AND ($9::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $9::bigint)
      RETURNING *
      `,
      [payload.name, payload.code, payload.phone, payload.is_active, payload.commission_type, payload.commission_value, JSON.stringify(payload.excluded_product_ids), id, tenantId]
    );
    if (!result.rows[0]) {
      const error = new Error("Sales employee not found");
      error.status = 404;
      throw error;
    }
    return result.rows[0];
  }

  const result = await db.query(
    `
    INSERT INTO sales_employees (tenant_id, name, code, phone, is_active, commission_type, commission_value, excluded_product_ids)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    RETURNING *
    `,
    [tenantId, payload.name, payload.code, payload.phone, payload.is_active, payload.commission_type, payload.commission_value, JSON.stringify(payload.excluded_product_ids)]
  );
  return result.rows[0];
};

export const getSalespersonSnapshot = async (clientOrPool, { tenantId = null, salespersonId = null } = {}) => {
  await ensureSalesCommissionSchema(clientOrPool);
  if (!salespersonId) return null;
  const result = await clientOrPool.query(
    `
    SELECT *
    FROM sales_employees
    WHERE id = $1
      AND is_active = TRUE
      AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
    LIMIT 1
    `,
    [salespersonId, tenantId]
  );
  const employee = result.rows[0];
  if (!employee) return null;
  const settings = await getSalesSettings(clientOrPool, tenantId);
  return {
    salesperson_id: employee.id,
    salesperson_name: employee.name,
    commission_type: normalizeCommissionType(employee.commission_type),
    commission_value: toNumber(employee.commission_value),
    fixed_mode: settings.fixed_commission_mode,
    excluded_product_ids: normalizeIds(employee.excluded_product_ids),
  };
};

const calculateLineCommission = ({ lineAmount = 0, quantity = 0, commissionType = "percent", commissionValue = 0, fixedMode = "fixed_per_invoice", invoiceFixedAlreadyApplied = false }) => {
  if (lineAmount <= 0 || quantity <= 0 || commissionValue <= 0) return { amount: 0, fixedApplied: false };
  if (commissionType === "percent") return { amount: lineAmount * (commissionValue / 100), fixedApplied: false };
  if (fixedMode === "fixed_per_item") return { amount: quantity * commissionValue, fixedApplied: false };
  if (invoiceFixedAlreadyApplied) return { amount: 0, fixedApplied: false };
  return { amount: commissionValue, fixedApplied: true };
};

export const recordSalesCommissionForOrder = async (client, { tenantId = null, order = {}, items = [], createdBy = null } = {}) => {
  await ensureSalesCommissionSchema(client);
  const salespersonId = order.salesperson_id || order.sales_employee_id || null;
  if (!salespersonId || ["cancelled", "canceled", "void"].includes(String(order.status || "").toLowerCase())) {
    return { recorded: false, totalCommission: 0, rows: [] };
  }

  const excluded = new Set(normalizeIds(order.salesperson_excluded_product_ids));
  const commissionType = normalizeCommissionType(order.salesperson_commission_type);
  const commissionValue = toNumber(order.salesperson_commission_value);
  const fixedMode = normalizeFixedMode(order.salesperson_fixed_mode);
  let invoiceFixedApplied = false;
  let totalCommission = 0;
  const rows = [];

  for (const item of items) {
    const productId = Number(item.product_id || 0);
    if (productId && excluded.has(productId)) continue;
    const quantity = Math.max(0, toNumber(item.quantity));
    const returnedQuantity = Math.max(0, toNumber(item.returned_quantity));
    const netQuantity = Math.max(0, quantity - returnedQuantity);
    const grossLine = toNumber(item.total_amount, toNumber(item.sale_price) * quantity);
    const lineAmount = quantity > 0 ? grossLine * (netQuantity / quantity) : 0;
    const result = calculateLineCommission({
      lineAmount,
      quantity: netQuantity,
      commissionType,
      commissionValue,
      fixedMode,
      invoiceFixedAlreadyApplied: invoiceFixedApplied,
    });
    invoiceFixedApplied = invoiceFixedApplied || result.fixedApplied;
    if (result.amount <= 0) continue;
    totalCommission += result.amount;
    const insert = await client.query(
      `
      INSERT INTO employee_commissions (
        tenant_id, employee_id, order_id, order_item_id, product_id, category_id,
        commission_rule_id, rule_type, scope_type, sale_amount, net_sale_amount,
        commission_amount, status, branch_id, shift_id, created_by, source, snapshot
      )
      VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,'salesperson',$8,$9,$10,$11,$12,$13,$14,'salesperson',$15::jsonb)
      RETURNING *
      `,
      [
        tenantId,
        salespersonId,
        order.id,
        item.id || item.order_item_id || null,
        item.product_id || null,
        item.category_id || null,
        commissionType,
        grossLine,
        lineAmount,
        result.amount,
        ["paid", "completed", "partial", "partially_paid"].includes(String(order.payment_status || "").toLowerCase()) ? "earned" : "pending",
        order.branch_id || null,
        order.shift_id || null,
        createdBy,
        JSON.stringify({
          salesperson_name: order.salesperson_name,
          commission_type: commissionType,
          commission_value: commissionValue,
          fixed_mode: fixedMode,
          excluded_product_ids: [...excluded],
        }),
      ]
    );
    rows.push(insert.rows[0]);
  }

  return { recorded: rows.length > 0, totalCommission, rows };
};

const dateWhere = (alias, params, { startDate, endDate }) => {
  const clauses = [];
  if (startDate) {
    params.push(startDate);
    clauses.push(`${alias}.created_at >= $${params.length}`);
  }
  if (endDate) {
    params.push(endDate);
    clauses.push(`${alias}.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }
  return clauses;
};

export const getSalesCommissionReport = async ({ tenantId = null, filters = {} } = {}) => {
  await ensureSalesCommissionSchema(db);
  const params = [tenantId];
  const clauses = [
    "($1::bigint IS NULL OR o.tenant_id IS NULL OR o.tenant_id = $1::bigint)",
    "o.salesperson_id IS NOT NULL",
    "LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')",
  ];
  clauses.push(...dateWhere("o", params, filters));
  if (filters.branchId) {
    params.push(filters.branchId);
    clauses.push(`o.branch_id = $${params.length}`);
  }
  if (filters.employeeId) {
    params.push(filters.employeeId);
    clauses.push(`o.salesperson_id = $${params.length}`);
  }

  const result = await db.query(
    `
    WITH line_base AS (
      SELECT
        o.id AS order_id,
        o.salesperson_id,
        COALESCE(o.salesperson_name, se.name, 'Unassigned') AS salesperson_name,
        o.salesperson_commission_type,
        o.salesperson_commission_value,
        COALESCE(o.salesperson_fixed_mode, 'fixed_per_invoice') AS fixed_mode,
        COALESCE(o.branch_id, 0) AS branch_id,
        oi.id AS order_item_id,
        COALESCE(oi.product_id, 0) AS product_id,
        COALESCE(oi.quantity, 0)::numeric AS quantity,
        COALESCE(oi.returned_quantity, 0)::numeric AS returned_quantity,
        COALESCE(oi.total_amount, COALESCE(oi.sale_price, 0) * COALESCE(oi.quantity, 0))::numeric AS gross_line,
        CASE
          WHEN COALESCE(oi.quantity, 0) > 0
          THEN COALESCE(oi.total_amount, COALESCE(oi.sale_price, 0) * COALESCE(oi.quantity, 0))::numeric
               * GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.returned_quantity, 0), 0)::numeric
               / COALESCE(oi.quantity, 1)::numeric
          ELSE 0
        END AS net_line,
        COALESCE(o.salesperson_excluded_product_ids, '[]'::jsonb) AS excluded
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN sales_employees se ON se.id = o.salesperson_id
      WHERE ${clauses.join(" AND ")}
    ),
    eligible AS (
      SELECT *,
        NOT (product_id::text IN (SELECT jsonb_array_elements_text(excluded))) AS commission_eligible
      FROM line_base
    ),
    order_summary AS (
      SELECT
        order_id,
        salesperson_id,
        MAX(salesperson_name) AS salesperson_name,
        SUM(quantity)::numeric AS total_items_sold,
        SUM(returned_quantity)::numeric AS returns_refunds,
        SUM(gross_line)::numeric AS total_sales,
        SUM(net_line)::numeric AS net_sales,
        SUM(CASE WHEN commission_eligible THEN net_line ELSE 0 END)::numeric AS eligible_net_sales,
        SUM(CASE
          WHEN commission_eligible AND salesperson_commission_type = 'percent'
            THEN net_line * COALESCE(salesperson_commission_value, 0) / 100
          WHEN commission_eligible AND salesperson_commission_type = 'fixed' AND fixed_mode = 'fixed_per_item'
            THEN GREATEST(quantity - returned_quantity, 0) * COALESCE(salesperson_commission_value, 0)
          ELSE 0
        END)::numeric AS line_commissions,
        MAX(CASE
          WHEN salesperson_commission_type = 'fixed' AND fixed_mode = 'fixed_per_invoice'
          THEN COALESCE(salesperson_commission_value, 0)
          ELSE 0
        END)::numeric AS invoice_fixed_commission
      FROM eligible
      GROUP BY order_id, salesperson_id
    )
    SELECT
      salesperson_id,
      MAX(salesperson_name) AS salesperson_name,
      COUNT(*)::int AS total_invoices,
      SUM(total_items_sold)::numeric AS total_items_sold,
      SUM(returns_refunds)::numeric AS returns_refunds,
      SUM(total_sales)::numeric AS total_sales,
      SUM(net_sales)::numeric AS net_sales,
      SUM(
        line_commissions
        + CASE WHEN eligible_net_sales > 0 THEN invoice_fixed_commission ELSE 0 END
      )::numeric AS earned_commissions
    FROM order_summary
    GROUP BY salesperson_id
    ORDER BY net_sales DESC, earned_commissions DESC
    `,
    params
  );

  const rows = result.rows.map((row) => ({
    ...row,
    total_invoices: toNumber(row.total_invoices),
    total_items_sold: toNumber(row.total_items_sold),
    returns_refunds: toNumber(row.returns_refunds),
    total_sales: toNumber(row.total_sales),
    net_sales: toNumber(row.net_sales),
    earned_commissions: toNumber(row.earned_commissions),
  }));
  return {
    rows,
    summary: rows.reduce(
      (acc, row) => ({
        total_sales: acc.total_sales + row.total_sales,
        total_invoices: acc.total_invoices + row.total_invoices,
        total_items_sold: acc.total_items_sold + row.total_items_sold,
        returns_refunds: acc.returns_refunds + row.returns_refunds,
        net_sales: acc.net_sales + row.net_sales,
        earned_commissions: acc.earned_commissions + row.earned_commissions,
      }),
      { total_sales: 0, total_invoices: 0, total_items_sold: 0, returns_refunds: 0, net_sales: 0, earned_commissions: 0 }
    ),
  };
};

export const getPayrollPreview = async ({ tenantId = null, employeeId, filters = {} } = {}) => {
  await ensureSalesCommissionSchema(db);
  const employeeResult = await db.query(
    `SELECT * FROM sales_employees WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint) LIMIT 1`,
    [employeeId, tenantId]
  );
  const employee = employeeResult.rows[0];
  if (!employee) {
    const error = new Error("Sales employee not found");
    error.status = 404;
    throw error;
  }
  const report = await getSalesCommissionReport({ tenantId, filters: { ...filters, employeeId } });
  const commissions = toNumber(report.summary.earned_commissions);
  const baseSalary = toNumber(filters.base_salary ?? filters.baseSalary);
  const bonuses = toNumber(filters.bonuses);
  const deductions = toNumber(filters.deductions);
  return {
    employee: {
      id: employee.id,
      name: employee.name,
      code: employee.code,
    },
    payroll: {
      base_salary: baseSalary,
      commissions,
      bonuses,
      deductions,
      final_salary: baseSalary + commissions + bonuses - deductions,
    },
    commission_report: report,
  };
};
