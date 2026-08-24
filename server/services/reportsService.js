import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

const cache = new Map();
const CACHE_TTL_MS = 60_000;
const COLUMN_CACHE = new Map();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

const nowIsoDate = () => new Date().toISOString().slice(0, 10);

const toDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampLimit = (value) => Math.min(Math.max(Number(value || DEFAULT_LIMIT), 1), MAX_LIMIT);

export const getReportTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));

export const parseReportFilters = (query = {}) => {
  const preset = String(query.preset || query.range || "month").toLowerCase();
  const today = new Date();
  let startDate = toDate(query.startDate || query.from);
  let endDate = toDate(query.endDate || query.to);

  if (!startDate || !endDate) {
    const start = new Date(today);
    if (preset === "today") {
      startDate = nowIsoDate();
      endDate = nowIsoDate();
    } else if (preset === "week") {
      start.setDate(today.getDate() - 6);
      startDate = start.toISOString().slice(0, 10);
      endDate = nowIsoDate();
    } else {
      start.setDate(today.getDate() - 29);
      startDate = start.toISOString().slice(0, 10);
      endDate = nowIsoDate();
    }
  }

  return {
    preset,
    startDate,
    endDate,
    branchId: toNumber(query.branchId || query.branch_id),
    warehouseId: toNumber(query.warehouseId || query.warehouse_id),
    employeeId: toNumber(query.employeeId || query.employee_id),
    productId: toNumber(query.productId || query.product_id),
    categoryId: toNumber(query.categoryId || query.category_id),
    customerId: toNumber(query.customerId || query.customer_id),
    shiftId: toNumber(query.shiftId || query.shift_id),
    salespersonId: toNumber(query.salespersonId || query.salesperson_id),
    paymentMethod: query.paymentMethod || query.payment_method || "",
    search: String(query.search || "").trim(),
    page: Math.max(Number(query.page || 1), 1),
    limit: clampLimit(query.limit),
    sortBy: String(query.sortBy || query.sort_by || "").trim(),
    sortDir: String(query.sortDir || query.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc",
  };
};

const safeQuery = async (text, params = [], fallback = []) => {
  try {
    const result = await db.query(text, params);
    return result.rows;
  } catch (error) {
    console.warn("[reports] query failed:", error.message);
    return fallback;
  }
};

const safeScalar = async (text, params = [], fallback = 0) => {
  const rows = await safeQuery(text, params, []);
  const row = rows[0] || {};
  const firstKey = Object.keys(row)[0];
  return Number(row[firstKey] || fallback) || fallback;
};

const getColumns = async (table) => {
  if (COLUMN_CACHE.has(table)) return COLUMN_CACHE.get(table);
  const rows = await safeQuery(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [table],
    []
  );
  const columns = new Set(rows.map((row) => row.column_name));
  COLUMN_CACHE.set(table, columns);
  return columns;
};

const pickColumn = (columns, names = []) => names.find((name) => columns.has(name)) || null;

const col = (alias, columns, names = [], fallback = "0") => {
  const picked = pickColumn(columns, names);
  return picked ? `${alias}.${picked}` : fallback;
};

const buildWhere = ({ alias, columns, tenantId, filters, dateColumns = ["created_at"], extra = [] }) => {
  const params = [];
  const clauses = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (tenantId !== null && columns.has("tenant_id")) {
    clauses.push(`${alias}.tenant_id = ${add(tenantId)}`);
  }

  const dateColumn = pickColumn(columns, dateColumns);
  if (dateColumn && filters.startDate) clauses.push(`DATE(${alias}.${dateColumn}) >= ${add(filters.startDate)}`);
  if (dateColumn && filters.endDate) clauses.push(`DATE(${alias}.${dateColumn}) <= ${add(filters.endDate)}`);
  if (filters.branchId && columns.has("branch_id")) clauses.push(`${alias}.branch_id = ${add(filters.branchId)}`);
  if (filters.warehouseId && columns.has("warehouse_id")) clauses.push(`${alias}.warehouse_id = ${add(filters.warehouseId)}`);
  if (filters.employeeId && columns.has("employee_id")) clauses.push(`${alias}.employee_id = ${add(filters.employeeId)}`);
  if (filters.customerId && columns.has("customer_id")) clauses.push(`${alias}.customer_id = ${add(filters.customerId)}`);
  if (filters.shiftId && columns.has("shift_id")) clauses.push(`${alias}.shift_id = ${add(filters.shiftId)}`);
  if (filters.paymentMethod && columns.has("payment_method")) clauses.push(`LOWER(${alias}.payment_method) = LOWER(${add(filters.paymentMethod)})`);

  for (const item of extra) {
    const clause = typeof item === "function" ? item({ add, params }) : item;
    if (clause) clauses.push(clause);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    add,
  };
};

const buildLiteralWhere = ({ table, columns, tenantId, filters, dateColumns = ["created_at"] }) => {
  const clauses = [];
  const dateColumn = pickColumn(columns, dateColumns);
  if (tenantId !== null && columns.has("tenant_id")) clauses.push(`${table}.tenant_id = ${Number(tenantId)}`);
  if (dateColumn && filters.startDate) clauses.push(`DATE(${table}.${dateColumn}) >= '${filters.startDate}'`);
  if (dateColumn && filters.endDate) clauses.push(`DATE(${table}.${dateColumn}) <= '${filters.endDate}'`);
  if (filters.branchId && columns.has("branch_id")) clauses.push(`${table}.branch_id = ${Number(filters.branchId)}`);
  if (filters.employeeId && columns.has("employee_id")) clauses.push(`${table}.employee_id = ${Number(filters.employeeId)}`);
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
};

const cached = async (key, producer) => {
  const existing = cache.get(key);
  if (existing && Date.now() - existing.at < CACHE_TTL_MS) return existing.value;
  const value = await producer();
  cache.set(key, { at: Date.now(), value });
  return value;
};

const percentChange = (current, previous) => {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (previousValue === 0) return currentValue > 0 ? 100 : 0;
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
};

const money = (value) => `${Math.round(Number(value || 0)).toLocaleString("en-US")} EGP`;

const insight = ({ title, description, severity = "info", category = "General", metrics = {}, type = "recommendation" }) => ({
  title,
  description,
  severity,
  category,
  related_metrics: metrics,
  type,
  timestamp: new Date().toISOString(),
});

const getPreviousPeriodFilters = (filters = {}) => {
  const start = new Date(filters.startDate);
  const end = new Date(filters.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return filters;
  const days = Math.max(Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1, 1);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return {
    ...filters,
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };
};

const buildOrderScope = async (tenantId, filters) => {
  const orderColumns = await getColumns("orders");
  const itemColumns = await getColumns("order_items");
  const productColumns = await getColumns("products");
  const totalExpr = col("o", orderColumns, ["total_amount", "total", "grand_total", "net_total"], "0");
  // D-15. order_items carries NONE of these columns, so this resolved to the literal
  // "0" and every "gross profit" on this page was revenue minus nothing — that is,
  // revenue, presented as profit. The expression is kept for the day a cost column
  // exists, and costResolved records whether it found one, so a query can publish NULL
  // instead of a number that is definitionally wrong.
  const costExpr = col("oi", itemColumns, ["cost_total", "purchase_cost", "cost"], "0");
  const costResolved = costExpr !== "0";
  const qtyExpr = col("oi", itemColumns, ["quantity", "qty"], "0");
  const itemTotalExpr = col("oi", itemColumns, ["total_amount", "total", "line_total", "subtotal"], "0");
  const createdExpr = col("o", orderColumns, ["created_at", "order_date", "date"], "CURRENT_DATE");
  const where = buildWhere({
    alias: "o",
    columns: orderColumns,
    tenantId,
    filters,
    dateColumns: ["created_at", "order_date", "date"],
    extra: [
      ({ add }) => (filters.salespersonId && orderColumns.has("salesperson_id") ? `o.salesperson_id = ${add(filters.salespersonId)}` : ""),
    ],
  });

  return { orderColumns, itemColumns, productColumns, totalExpr, costExpr, costResolved, qtyExpr, itemTotalExpr, createdExpr, where };
};

export const getDashboardReport = async ({ tenantId, filters }) => {
  const cacheKey = `dashboard:${tenantId || "all"}:${JSON.stringify(filters)}`;
  return cached(cacheKey, async () => {
    const orders = await buildOrderScope(tenantId, filters);
    const purchaseColumns = await getColumns("purchases");
    const productColumns = await getColumns("products");
    const customerColumns = await getColumns("customers");
    const expenseColumns = await getColumns("expenses");
    const attendanceColumns = await getColumns("attendance_logs");
    const loyaltyColumns = await getColumns("customer_loyalty_history");

    const purchaseWhere = buildWhere({ alias: "p", columns: purchaseColumns, tenantId, filters, dateColumns: ["created_at", "purchase_date", "date"] });
    const expenseWhere = buildWhere({ alias: "e", columns: expenseColumns, tenantId, filters, dateColumns: ["created_at", "expense_date", "date"] });
    const customerWhere = buildWhere({ alias: "c", columns: customerColumns, tenantId, filters, dateColumns: ["created_at"] });
    const attendanceWhere = buildWhere({ alias: "al", columns: attendanceColumns, tenantId, filters, dateColumns: ["attendance_date", "created_at"] });
    const loyaltyWhere = buildWhere({ alias: "lh", columns: loyaltyColumns, tenantId, filters, dateColumns: ["created_at"] });

    const purchaseTotalExpr = col("p", purchaseColumns, ["total", "total_amount", "grand_total"], "0");
    const expenseAmountExpr = col("e", expenseColumns, ["amount", "total", "total_amount"], "0");
    const stockExpr = col("p", productColumns, ["stock", "quantity"], "0");
    const priceExpr = col("p", productColumns, ["purchase_price", "cost_price", "price"], "0");
    const loyaltyPointsExpr = col("lh", loyaltyColumns, ["points_change"], "0");

    const [totalSales, ordersCount, purchaseCost, expenses, inventoryValue, customersCount, workedMinutes, loyaltyRedemptions] = await Promise.all([
      safeScalar(`SELECT COALESCE(SUM(${orders.totalExpr}), 0) AS value FROM orders o ${orders.where.where}`, orders.where.params),
      safeScalar(`SELECT COUNT(*) AS value FROM orders o ${orders.where.where}`, orders.where.params),
      safeScalar(`SELECT COALESCE(SUM(${purchaseTotalExpr}), 0) AS value FROM purchases p ${purchaseWhere.where}`, purchaseWhere.params),
      safeScalar(`SELECT COALESCE(SUM(${expenseAmountExpr}), 0) AS value FROM expenses e ${expenseWhere.where}`, expenseWhere.params),
      safeScalar(`SELECT COALESCE(SUM((${stockExpr}) * (${priceExpr})), 0) AS value FROM products p ${productColumns.has("tenant_id") && tenantId !== null ? "WHERE p.tenant_id = $1" : ""}`, productColumns.has("tenant_id") && tenantId !== null ? [tenantId] : []),
      safeScalar(`SELECT COUNT(*) AS value FROM customers c ${customerWhere.where}`, customerWhere.params),
      safeScalar(`SELECT COALESCE(SUM(al.work_minutes), 0) AS value FROM attendance_logs al ${attendanceWhere.where}`, attendanceWhere.params),
      loyaltyColumns.size
        ? safeScalar(`SELECT COALESCE(SUM(ABS(${loyaltyPointsExpr})), 0) AS value FROM customer_loyalty_history lh ${loyaltyWhere.where}${loyaltyWhere.where ? " AND" : "WHERE"} ${loyaltyPointsExpr} < 0`, loyaltyWhere.params)
        : 0,
    ]);

    const netProfit = totalSales - purchaseCost - expenses;
    const avgOrderValue = ordersCount > 0 ? totalSales / ordersCount : 0;
    const employeeProductivity = workedMinutes > 0 ? totalSales / (workedMinutes / 60) : 0;

    const dailySales = await safeQuery(
      `
      SELECT DATE(${orders.createdExpr}) AS label, COALESCE(SUM(${orders.totalExpr}), 0)::numeric AS value
      FROM orders o
      ${orders.where.where}
      GROUP BY DATE(${orders.createdExpr})
      ORDER BY DATE(${orders.createdExpr}) ASC
      LIMIT 60
      `,
      orders.where.params
    );

    const monthlyRevenue = await safeQuery(
      `
      SELECT TO_CHAR(DATE_TRUNC('month', ${orders.createdExpr}), 'YYYY-MM') AS label, COALESCE(SUM(${orders.totalExpr}), 0)::numeric AS value
      FROM orders o
      ${orders.where.where}
      GROUP BY DATE_TRUNC('month', ${orders.createdExpr})
      ORDER BY DATE_TRUNC('month', ${orders.createdExpr}) ASC
      LIMIT 24
      `,
      orders.where.params
    );

    const ordersByHour = await safeQuery(
      `
      SELECT EXTRACT(HOUR FROM ${orders.createdExpr})::int AS label, COUNT(*)::int AS value
      FROM orders o
      ${orders.where.where}
      GROUP BY EXTRACT(HOUR FROM ${orders.createdExpr})
      ORDER BY label ASC
      `,
      orders.where.params
    );

    const paymentMethods = await safeQuery(
      `
      SELECT COALESCE(NULLIF(o.payment_method, ''), 'Unknown') AS label, COALESCE(SUM(${orders.totalExpr}), 0)::numeric AS value
      FROM orders o
      ${orders.where.where}
      GROUP BY COALESCE(NULLIF(o.payment_method, ''), 'Unknown')
      ORDER BY value DESC
      LIMIT 10
      `,
      orders.where.params
    );

    const salesByBranch = await safeQuery(
      `
      SELECT COALESCE(b.name, 'No branch assigned') AS label, COALESCE(SUM(${orders.totalExpr}), 0)::numeric AS value
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      ${orders.where.where}
      GROUP BY COALESCE(b.name, 'No branch assigned')
      ORDER BY value DESC
      LIMIT 10
      `,
      orders.where.params
    );

    const topProducts = await getSalesRows(tenantId, filters, { mode: "topProducts", limit: 10 });
    const topEmployees = await getEmployeeRows(tenantId, filters, { limit: 10 });
    const attendanceTrend = await safeQuery(
      `
      SELECT al.attendance_date AS label, COUNT(*)::int AS value
      FROM attendance_logs al
      ${attendanceWhere.where}
      GROUP BY al.attendance_date
      ORDER BY al.attendance_date ASC
      LIMIT 60
      `,
      attendanceWhere.params
    );

    return {
      filters,
      kpis: {
        totalSales,
        netProfit,
        ordersCount,
        averageOrderValue: avgOrderValue,
        expenses,
        inventoryValue,
        customersCount,
        employeeProductivity,
        loyaltyRedemptions,
      },
      charts: {
        dailySales,
        weeklySales: dailySales,
        monthlyRevenue,
        profitTrend: monthlyRevenue.map((item) => ({ ...item, value: Number(item.value || 0) - expenses / Math.max(monthlyRevenue.length, 1) })),
        ordersByHour,
        salesByBranch,
        topEmployees,
        topProducts,
        paymentMethods,
        attendanceTrend,
      },
    };
  });
};

export const getSalesRows = async (tenantId, filters, options = {}) => {
  const mode = options.mode || "summary";
  const limit = clampLimit(options.limit || filters.limit);
  const offset = (filters.page - 1) * filters.limit;
  const orders = await buildOrderScope(tenantId, filters);

  if (mode === "topProducts" || mode === "worstProducts") {
    const productName = col("p", orders.productColumns, ["name"], col("oi", orders.itemColumns, ["product_name"], "'Unknown'"));
    const productWhere = [];
    const params = [...orders.where.params];
    let where = orders.where.where;
    if (filters.productId && orders.itemColumns.has("product_id")) {
      params.push(filters.productId);
      productWhere.push(`oi.product_id = $${params.length}`);
    }
    if (productWhere.length) where += `${where ? " AND " : "WHERE "}${productWhere.join(" AND ")}`;
    const direction = mode === "worstProducts" ? "ASC" : "DESC";
    return safeQuery(
      `
      SELECT
        ${productName} AS name,
        COALESCE(SUM(${orders.qtyExpr}), 0)::numeric AS quantity,
        COALESCE(SUM(${orders.itemTotalExpr}), 0)::numeric AS revenue,
        ${orders.costResolved
          ? `COALESCE(SUM(${orders.itemTotalExpr}) - SUM(${orders.costExpr}), 0)::numeric`
          : "NULL::numeric"} AS gross_profit
      FROM order_items oi
      LEFT JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      ${where}
      GROUP BY ${productName}
      ORDER BY quantity ${direction}, revenue ${direction}
      LIMIT $${params.length + 1}
      `,
      [...params, limit]
    );
  }

  const groupExpr =
    mode === "branch"
      ? "COALESCE(b.name, 'No branch assigned')"
      : mode === "hour"
        ? `EXTRACT(HOUR FROM ${orders.createdExpr})::text`
        : mode === "payment"
          ? "COALESCE(NULLIF(o.payment_method, ''), 'Unknown')"
          : mode === "employee"
            ? "COALESCE(se.name, o.salesperson_name, e.full_name, 'Unlinked employee')"
            : `DATE(${orders.createdExpr})::text`;

  const joins =
    mode === "branch"
      ? "LEFT JOIN branches b ON b.id = o.branch_id"
      : mode === "employee"
        ? "LEFT JOIN sales_employees se ON se.id = o.salesperson_id LEFT JOIN employees e ON e.id = o.employee_id"
        : "";

  const discountExpr = col("o", orders.orderColumns, ["discount_amount", "discount", "invoice_discount"], "0");

  return safeQuery(
    `
    SELECT
      ${groupExpr} AS name,
      COUNT(*)::int AS orders_count,
      COALESCE(SUM(${orders.totalExpr}), 0)::numeric AS revenue,
      COALESCE(AVG(${orders.totalExpr}), 0)::numeric AS average_order,
      COALESCE(SUM(COALESCE(${discountExpr}, 0)), 0)::numeric AS discounts
    FROM orders o
    ${joins}
    ${orders.where.where}
    GROUP BY ${groupExpr}
    ORDER BY revenue DESC
    LIMIT $${orders.where.params.length + 1}
    OFFSET $${orders.where.params.length + 2}
    `,
    [...orders.where.params, limit, offset]
  );
};

export const getEmployeeRows = async (tenantId, filters, options = {}) => {
  const limit = clampLimit(options.limit || filters.limit);
  const employeeColumns = await getColumns("employees");
  const attendanceColumns = await getColumns("attendance_logs");
  const assignmentColumns = await getColumns("shift_opening_assignments");
  const orderColumns = await getColumns("orders");
  const where = buildWhere({ alias: "e", columns: employeeColumns, tenantId, filters, dateColumns: ["created_at"] });
  const attendanceWhere = buildLiteralWhere({
    table: "attendance_logs",
    columns: attendanceColumns,
    tenantId,
    filters,
    dateColumns: ["attendance_date", "created_at"],
  });
  const assignmentWhere = buildLiteralWhere({
    table: "shift_opening_assignments",
    columns: assignmentColumns,
    tenantId,
    filters,
    dateColumns: ["assigned_at", "created_at"],
  });
  const salesWhere = buildLiteralWhere({
    table: "orders",
    columns: orderColumns,
    tenantId,
    filters,
    dateColumns: ["created_at", "order_date", "date"],
  });
  const salesSubquery = orderColumns.has("employee_id")
    ? `
      SELECT employee_id, COUNT(*) AS orders_count, SUM(${col("orders", orderColumns, ["total_amount", "total"], "0")}) AS revenue
      FROM orders
      ${salesWhere}
      GROUP BY employee_id
    `
    : `
      SELECT NULL::bigint AS employee_id, 0::int AS orders_count, 0::numeric AS revenue
      WHERE FALSE
    `;
  return safeQuery(
    `
    SELECT
      e.id,
      e.full_name AS name,
      e.employee_code,
      COALESCE(att.present_days, 0)::int AS present_days,
      COALESCE(att.late_minutes, 0)::numeric AS late_minutes,
      COALESCE(att.missing_checkouts, 0)::int AS missing_checkouts,
      COALESCE(att.worked_hours, 0)::numeric AS worked_hours,
      COALESCE(att.overtime_minutes, 0)::numeric AS overtime_minutes,
      COALESCE(openings.total_openings, 0)::int AS total_openings,
      openings.last_opening_date,
      COALESCE(sales.orders_count, 0)::int AS orders_count,
      COALESCE(sales.revenue, 0)::numeric AS revenue,
      ROUND((COALESCE(sales.revenue, 0) / GREATEST(COALESCE(att.worked_hours, 0), 1))::numeric, 2) AS productivity_score
    FROM employees e
    LEFT JOIN (
      SELECT
        employee_id,
        COUNT(*) AS present_days,
        SUM(COALESCE(late_minutes, 0)) AS late_minutes,
        SUM(CASE WHEN check_out_at IS NULL AND check_out IS NULL THEN 1 ELSE 0 END) AS missing_checkouts,
        SUM(COALESCE(work_minutes, 0)) / 60.0 AS worked_hours,
        SUM(COALESCE(overtime_minutes, 0)) AS overtime_minutes
      FROM attendance_logs
      ${attendanceWhere}
      GROUP BY employee_id
    ) att ON att.employee_id = e.id
    LEFT JOIN (
      SELECT employee_id, COUNT(*) AS total_openings, MAX(assigned_at) AS last_opening_date
      FROM shift_opening_assignments
      ${assignmentWhere}
      GROUP BY employee_id
    ) openings ON openings.employee_id = e.id
    LEFT JOIN (
      ${salesSubquery}
    ) sales ON sales.employee_id = e.id
    ${where.where}
    ORDER BY productivity_score DESC, revenue DESC, e.full_name ASC
    LIMIT $${where.params.length + 1}
    `,
    [...where.params, limit]
  );
};

export const getInventoryRows = async (tenantId, filters) => {
  const productColumns = await getColumns("products");
  const where = buildWhere({ alias: "p", columns: productColumns, tenantId, filters, dateColumns: ["created_at"] });
  const stockExpr = col("p", productColumns, ["stock", "quantity"], "0");
  const priceExpr = col("p", productColumns, ["purchase_price", "cost_price", "price"], "0");
  return safeQuery(
    `
    SELECT
      p.id,
      ${col("p", productColumns, ["name"], "'Unknown'")} AS name,
      ${stockExpr}::numeric AS stock,
      ${priceExpr}::numeric AS unit_cost,
      (${stockExpr} * ${priceExpr})::numeric AS inventory_value,
      CASE
        WHEN ${stockExpr} <= 0 THEN 'out_of_stock'
        WHEN ${stockExpr} <= COALESCE(${col("p", productColumns, ["min_stock", "reorder_level"], "5")}, 5) THEN 'low_stock'
        ELSE 'in_stock'
      END AS stock_status
    FROM products p
    ${where.where}
    ORDER BY inventory_value DESC
    LIMIT $${where.params.length + 1}
    `,
    [...where.params, filters.limit]
  );
};

export const getCustomerRows = async (tenantId, filters) => {
  const customerColumns = await getColumns("customers");
  const orderColumns = await getColumns("orders");
  const where = buildWhere({ alias: "c", columns: customerColumns, tenantId, filters, dateColumns: ["created_at"] });
  const totalExpr = col("o", orderColumns, ["total_amount", "total", "grand_total"], "0");
  return safeQuery(
    `
    SELECT
      c.id,
      ${col("c", customerColumns, ["name", "full_name", "customer_name"], "'Customer'")} AS name,
      ${col("c", customerColumns, ["phone"], "''")} AS phone,
      COUNT(o.id)::int AS orders_count,
      COALESCE(SUM(${totalExpr}), 0)::numeric AS lifetime_value,
      COALESCE(AVG(${totalExpr}), 0)::numeric AS average_order,
      COALESCE(MAX(o.created_at), c.created_at) AS last_order_at,
      COALESCE(${col("c", customerColumns, ["loyalty_points"], "0")}, 0)::numeric AS loyalty_points
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    ${where.where}
    GROUP BY c.id
    ORDER BY lifetime_value DESC, orders_count DESC
    LIMIT $${where.params.length + 1}
    `,
    [...where.params, filters.limit]
  );
};

export const getFinancialRows = async (tenantId, filters) => {
  const dashboard = await getDashboardReport({ tenantId, filters });
  return [
    { name: "Revenue", value: dashboard.kpis.totalSales },
    { name: "Purchase costs", value: dashboard.kpis.totalSales - dashboard.kpis.netProfit - dashboard.kpis.expenses },
    { name: "Expenses", value: dashboard.kpis.expenses },
    { name: "Gross profit", value: dashboard.kpis.totalSales - (dashboard.kpis.totalSales - dashboard.kpis.netProfit - dashboard.kpis.expenses) },
    { name: "Net profit", value: dashboard.kpis.netProfit },
    { name: "Inventory value", value: dashboard.kpis.inventoryValue },
  ];
};

export const getRestockPredictions = async (tenantId, filters) => {
  const productColumns = await getColumns("products");
  const orderColumns = await getColumns("orders");
  const itemColumns = await getColumns("order_items");
  if (!productColumns.size || !orderColumns.size || !itemColumns.size || !itemColumns.has("product_id")) return [];

  const stockExpr = col("p", productColumns, ["stock", "quantity"], "0");
  const productName = col("p", productColumns, ["name"], "'Unknown'");
  const qtyExpr = col("oi", itemColumns, ["quantity", "qty"], "0");
  const orders = await buildOrderScope(tenantId, filters);
  const start = new Date(filters.startDate);
  const end = new Date(filters.endDate);
  const days = Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    ? 30
    : Math.max(Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1, 1);

  return safeQuery(
    `
    SELECT
      p.id,
      ${productName} AS name,
      ${stockExpr}::numeric AS stock,
      COALESCE(SUM(${qtyExpr}), 0)::numeric AS sold_quantity,
      ROUND((COALESCE(SUM(${qtyExpr}), 0) / $${orders.where.params.length + 1})::numeric, 2) AS daily_velocity,
      CASE
        WHEN COALESCE(SUM(${qtyExpr}), 0) <= 0 THEN NULL
        ELSE ROUND((${stockExpr} / NULLIF((COALESCE(SUM(${qtyExpr}), 0) / $${orders.where.params.length + 1}), 0))::numeric, 1)
      END AS estimated_days_remaining
    FROM products p
    LEFT JOIN order_items oi ON oi.product_id = p.id
    LEFT JOIN orders o ON o.id = oi.order_id
    ${orders.where.where}
    GROUP BY p.id
    HAVING COALESCE(SUM(${qtyExpr}), 0) > 0
    ORDER BY estimated_days_remaining ASC NULLS LAST, daily_velocity DESC
    LIMIT 20
    `,
    [...orders.where.params, days],
    []
  );
};

export const getBusinessInsights = async ({ tenantId, filters }) => {
  const cacheKey = `insights:${tenantId || "all"}:${JSON.stringify(filters)}`;
  return cached(cacheKey, async () => {
    const previousFilters = getPreviousPeriodFilters(filters);
    const [dashboard, previousDashboard, salesRows, employees, inventory, customers, financial, restockPredictions] = await Promise.all([
      getDashboardReport({ tenantId, filters }),
      getDashboardReport({ tenantId, filters: previousFilters }),
      getSalesRows(tenantId, filters, { mode: "hour", limit: 24 }),
      getEmployeeRows(tenantId, filters, { limit: 20 }),
      getInventoryRows(tenantId, filters),
      getCustomerRows(tenantId, filters),
      getFinancialRows(tenantId, filters),
      getRestockPredictions(tenantId, filters),
    ]);

    const insights = [];
    const salesDelta = percentChange(dashboard.kpis.totalSales, previousDashboard.kpis.totalSales);
    const expenseDelta = percentChange(dashboard.kpis.expenses, previousDashboard.kpis.expenses);
    const profitMargin = dashboard.kpis.totalSales > 0 ? (dashboard.kpis.netProfit / dashboard.kpis.totalSales) * 100 : 0;
    const previousProfitMargin = previousDashboard.kpis.totalSales > 0 ? (previousDashboard.kpis.netProfit / previousDashboard.kpis.totalSales) * 100 : 0;
    const profitMarginDelta = profitMargin - previousProfitMargin;

    if (Math.abs(salesDelta) >= 5) {
      insights.push(insight({
        title: salesDelta >= 0 ? "Sales momentum is improving" : "Sales dropped versus the previous period",
        description: `Sales ${salesDelta >= 0 ? "increased" : "decreased"} ${Math.abs(salesDelta).toFixed(1)}% compared with the previous matching period.`,
        severity: salesDelta >= 0 ? "success" : salesDelta <= -15 ? "critical" : "warning",
        category: "Sales",
        type: salesDelta >= 0 ? "positive" : "warning",
        metrics: {
          current_sales: dashboard.kpis.totalSales,
          previous_sales: previousDashboard.kpis.totalSales,
          change_percent: Number(salesDelta.toFixed(1)),
        },
      }));
    }

    const bestHour = [...salesRows].sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))[0];
    if (bestHour?.name) {
      insights.push(insight({
        title: `Peak revenue hour is ${bestHour.name}:00`,
        description: `The strongest sales window generated ${money(bestHour.revenue)}. Consider staffing and promotions around this hour.`,
        severity: "info",
        category: "Sales",
        type: "opportunity",
        metrics: { hour: bestHour.name, revenue: Number(bestHour.revenue || 0), orders: Number(bestHour.orders_count || 0) },
      }));
    }

    if (expenseDelta > Math.max(salesDelta, 0) + 10 && dashboard.kpis.expenses > 0) {
      insights.push(insight({
        title: "Expenses are growing faster than revenue",
        description: `Expenses increased ${expenseDelta.toFixed(1)}% while sales changed ${salesDelta.toFixed(1)}%. Review expense categories before margin compression appears.`,
        severity: expenseDelta > 25 ? "critical" : "warning",
        category: "Financial",
        type: "anomaly",
        metrics: { expense_change_percent: Number(expenseDelta.toFixed(1)), sales_change_percent: Number(salesDelta.toFixed(1)) },
      }));
    }

    insights.push(insight({
      title: profitMarginDelta >= 0 ? "Net profit margin improved" : "Net profit margin needs attention",
      description: `Current net margin is ${profitMargin.toFixed(1)}%, ${profitMarginDelta >= 0 ? "up" : "down"} ${Math.abs(profitMarginDelta).toFixed(1)} points versus the previous period.`,
      severity: profitMarginDelta >= 0 ? "success" : "warning",
      category: "Financial",
      type: profitMarginDelta >= 0 ? "positive" : "recommendation",
      metrics: { net_profit_margin: Number(profitMargin.toFixed(1)), previous_margin: Number(previousProfitMargin.toFixed(1)) },
    }));

    const urgentRestock = restockPredictions.filter((item) => Number(item.estimated_days_remaining || 999) <= 7);
    urgentRestock.slice(0, 5).forEach((item) => {
      insights.push(insight({
        title: `${item.name} may run out in ${item.estimated_days_remaining} days`,
        description: `Current stock is ${Number(item.stock || 0)} with average velocity of ${Number(item.daily_velocity || 0)} units/day. Prepare a restock order.`,
        severity: Number(item.estimated_days_remaining || 999) <= 3 ? "critical" : "warning",
        category: "Inventory",
        type: "recommendation",
        metrics: {
          product_id: item.id,
          stock: Number(item.stock || 0),
          daily_velocity: Number(item.daily_velocity || 0),
          estimated_days_remaining: Number(item.estimated_days_remaining || 0),
        },
      }));
    });

    const deadStock = inventory.filter((item) => Number(item.stock || 0) > 0 && Number(item.inventory_value || 0) > 0 && !restockPredictions.some((sold) => String(sold.id) === String(item.id)));
    if (deadStock.length > 0) {
      insights.push(insight({
        title: "Dead stock detected",
        description: `${deadStock.length} stocked items did not sell during the selected period. Consider markdowns, bundles, or transfers.`,
        severity: "warning",
        category: "Inventory",
        type: "opportunity",
        metrics: { dead_stock_count: deadStock.length },
      }));
    }

    const topEmployee = employees.find((employee) => Number(employee.revenue || 0) > 0) || employees[0];
    if (topEmployee) {
      insights.push(insight({
        title: `${topEmployee.name} leads employee productivity`,
        description: `Productivity score is ${Number(topEmployee.productivity_score || 0).toFixed(1)} with ${money(topEmployee.revenue)} in attributed sales.`,
        severity: "success",
        category: "Employees",
        type: "positive",
        metrics: {
          employee_id: topEmployee.id,
          productivity_score: Number(topEmployee.productivity_score || 0),
          revenue: Number(topEmployee.revenue || 0),
        },
      }));
    }

    const missingCheckouts = employees.reduce((sum, employee) => sum + Number(employee.missing_checkouts || 0), 0);
    if (missingCheckouts > 0) {
      insights.push(insight({
        title: "Missing checkouts need cleanup",
        description: `${missingCheckouts} attendance records are missing checkout. Payroll and worked-hours reports may need review.`,
        severity: missingCheckouts >= 5 ? "critical" : "warning",
        category: "Attendance",
        type: "warning",
        metrics: { missing_checkouts: missingCheckouts },
      }));
    }

    const heavyOpeners = employees.filter((employee) => Number(employee.total_openings || 0) >= 5);
    heavyOpeners.slice(0, 3).forEach((employee) => {
      insights.push(insight({
        title: `${employee.name} opened ${employee.total_openings} shifts`,
        description: "Opening shift balance is concentrated. If this was not intentional, rotate openers next week.",
        severity: "info",
        category: "Shift Rotation",
        type: "recommendation",
        metrics: { employee_id: employee.id, total_openings: Number(employee.total_openings || 0) },
      }));
    });

    const vipCustomers = customers.filter((customer) => Number(customer.lifetime_value || 0) > 0).slice(0, 3);
    const vipRevenue = vipCustomers.reduce((sum, customer) => sum + Number(customer.lifetime_value || 0), 0);
    if (dashboard.kpis.totalSales > 0 && vipRevenue > 0) {
      insights.push(insight({
        title: "VIP customers are driving revenue",
        description: `Top ${vipCustomers.length} customers generated ${((vipRevenue / dashboard.kpis.totalSales) * 100).toFixed(1)}% of selected-period revenue.`,
        severity: "success",
        category: "Customers",
        type: "positive",
        metrics: { vip_revenue: vipRevenue, revenue_share_percent: Number(((vipRevenue / dashboard.kpis.totalSales) * 100).toFixed(1)) },
      }));
    }

    const churnRisk = customers.filter((customer) => {
      if (!customer.last_order_at || Number(customer.orders_count || 0) < 2) return false;
      const daysSince = (Date.now() - new Date(customer.last_order_at).getTime()) / 86400000;
      return daysSince > 45;
    });
    if (churnRisk.length > 0) {
      insights.push(insight({
        title: "Repeat customer churn risk detected",
        description: `${churnRisk.length} repeat customers have not ordered recently. Launch a win-back campaign or loyalty reminder.`,
        severity: "warning",
        category: "Customers",
        type: "recommendation",
        metrics: { churn_risk_customers: churnRisk.length },
      }));
    }

    if (dashboard.kpis.loyaltyRedemptions <= 0 && customers.some((customer) => Number(customer.loyalty_points || 0) > 0)) {
      insights.push(insight({
        title: "Loyalty usage is low",
        description: "Customers have point balances but no redemptions in the selected period. Promote wallet/loyalty benefits at checkout.",
        severity: "info",
        category: "Loyalty",
        type: "opportunity",
        metrics: { loyalty_redemptions: dashboard.kpis.loyaltyRedemptions },
      }));
    }

    const priority = { critical: 0, warning: 1, success: 2, info: 3 };
    const sortedInsights = insights.sort((a, b) => (priority[a.severity] ?? 9) - (priority[b.severity] ?? 9));
    return {
      filters,
      generated_at: new Date().toISOString(),
      summary: {
        total: sortedInsights.length,
        critical: sortedInsights.filter((item) => item.severity === "critical").length,
        warning: sortedInsights.filter((item) => item.severity === "warning").length,
        success: sortedInsights.filter((item) => item.severity === "success").length,
        info: sortedInsights.filter((item) => item.severity === "info").length,
      },
      insights: sortedInsights,
      recommendations: sortedInsights.filter((item) => ["recommendation", "opportunity"].includes(item.type)).slice(0, 8),
      restock_predictions: restockPredictions,
      employee_intelligence: employees.slice(0, 10),
      customer_intelligence: {
        vip_customers: vipCustomers,
        churn_risk: churnRisk.slice(0, 10),
      },
      financial_snapshot: financial,
    };
  });
};

export const getReportPayload = async ({ type, tenantId, filters }) => {
  if (type === "dashboard") return getDashboardReport({ tenantId, filters });
  if (type === "insights") return getBusinessInsights({ tenantId, filters });
  if (type === "employees") return { filters, rows: await getEmployeeRows(tenantId, filters) };
  if (type === "inventory") return { filters, rows: await getInventoryRows(tenantId, filters) };
  if (type === "customers") return { filters, rows: await getCustomerRows(tenantId, filters) };
  if (type === "financial") return { filters, rows: await getFinancialRows(tenantId, filters) };
  return {
    filters,
    rows: await getSalesRows(tenantId, filters, { mode: filters.groupBy || "summary" }),
  };
};

export const toCsv = (rows = []) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
};
