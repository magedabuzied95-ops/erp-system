import { getFinancialReportsSummary, getProfitLossReport } from "./accountingService.js";

const tableColumnCache = new Map();

const queryable = (clientOrPool) => clientOrPool;

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const numericFilter = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseDateFilter = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const getTenantScope = (tenantId) => {
  if (tenantId === undefined) return null;
  if (tenantId === null) return null;
  const parsed = Number(tenantId);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const firstColumn = (columns, names = []) => names.find((name) => columns.has(name)) || null;

const columnExpr = (alias, columns, names = [], fallback = "0") => {
  const picked = firstColumn(columns, names);
  return picked ? `${alias}.${picked}` : fallback;
};

const coalesceColumnExpr = (alias, columns, names = [], fallback = "0") => {
  const expressions = names.filter((name) => columns.has(name)).map((name) => `${alias}.${name}`);
  return expressions.length ? `COALESCE(${[...expressions, fallback].join(", ")})` : fallback;
};

const positiveCoalesceColumnExpr = (alias, columns, names = [], fallback = "0") => {
  const expressions = names.filter((name) => columns.has(name)).map((name) => `NULLIF(${alias}.${name}, 0)`);
  return expressions.length ? `COALESCE(${[...expressions, fallback].join(", ")})` : fallback;
};

const whereSql = (clauses = []) => (clauses.length ? `WHERE ${clauses.join(" AND ")}` : "");

const getTableColumns = async (clientOrPool, tableName) => {
  const key = String(tableName || "");
  if (tableColumnCache.has(key)) return tableColumnCache.get(key);
  const dbClient = queryable(clientOrPool);
  const result = await dbClient.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [key]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnCache.set(key, columns);
  return columns;
};

const addScopedWhere = ({ clauses, params, alias, columns, tenantId, fromDate, toDate, branchId, dateColumns = ["created_at"] }) => {
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (tenantId !== null && columns.has("tenant_id")) clauses.push(`${alias}.tenant_id = ${add(tenantId)}`);
  const dateColumn = firstColumn(columns, dateColumns);
  if (dateColumn && fromDate) clauses.push(`DATE(${alias}.${dateColumn}) >= ${add(fromDate)}`);
  if (dateColumn && toDate) clauses.push(`DATE(${alias}.${dateColumn}) <= ${add(toDate)}`);
  if (branchId && columns.has("branch_id")) clauses.push(`${alias}.branch_id = ${add(branchId)}`);
  return { add };
};

const activeOrderClauses = (columns, alias = "o") => {
  const statusExpr = columns.has("status") ? `LOWER(COALESCE(${alias}.status, ''))` : "''";
  const paymentStatusExpr = columns.has("payment_status") ? `LOWER(COALESCE(${alias}.payment_status, ''))` : "''";
  const personalExpr = columns.has("is_personal_transaction") ? `COALESCE(${alias}.is_personal_transaction, FALSE)` : "FALSE";
  return [
    `${statusExpr} NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft', 'ai_draft')`,
    `${paymentStatusExpr} NOT IN ('cancelled', 'canceled', 'void', 'refunded')`,
    `${personalExpr} = FALSE`,
  ];
};

const activePurchaseClauses = (columns, alias = "p") => {
  const statusExpr = columns.has("status") ? `LOWER(COALESCE(${alias}.status, ''))` : "''";
  return [`${statusExpr} NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft', 'reversed')`];
};

const buildFilters = (data = {}) => ({
  tenantId: getTenantScope(data.tenantId ?? data.tenant_id),
  fromDate: parseDateFilter(data.fromDate || data.from_date || data.from),
  toDate: parseDateFilter(data.toDate || data.to_date || data.to),
  branchId: numericFilter(data.branchId || data.branch_id),
});

const resolveMoneyDirectionExpr = (alias, columns) => {
  if (columns.has("direction")) {
    return `CASE WHEN LOWER(COALESCE(${alias}.direction, '')) = 'in' THEN 1 WHEN LOWER(COALESCE(${alias}.direction, '')) = 'out' THEN -1 ELSE 0 END`;
  }
  return "0";
};

const getOrderRevenueSnapshot = async (dbClient, filters = {}) => {
  const orderColumns = await getTableColumns(dbClient, "orders");
  if (!orderColumns.size) {
    return {
      revenue: 0,
      discounts: 0,
      returns: 0,
      net_revenue: 0,
    };
  }

  const totalExpr = coalesceColumnExpr("o", orderColumns, ["total_amount", "total", "total_price", "grand_total", "net_total"], "0");
  const discountColumns = ["discount_amount", "invoice_discount_amount", "coupon_discount_amount"]
    .filter((column) => orderColumns.has(column));
  const discountExpr = discountColumns.length
    ? discountColumns.map((column) => `COALESCE(o.${column}, 0)`).join(" + ")
    : "0";

  const clauses = [];
  const params = [];
  addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, ...filters });
  clauses.push(...activeOrderClauses(orderColumns, "o"));

  const revenueResult = await dbClient.query(
    `
    SELECT
      COALESCE(SUM(${totalExpr}), 0)::numeric AS revenue,
      COALESCE(SUM(${discountExpr}), 0)::numeric AS discounts
    FROM orders o
    ${whereSql(clauses)}
    `,
    params
  );

  const returnsColumns = await getTableColumns(dbClient, "returns");
  let returns = 0;
  if (returnsColumns.size) {
    const returnClauses = [];
    const returnParams = [];
    addScopedWhere({
      clauses: returnClauses,
      params: returnParams,
      alias: "r",
      columns: returnsColumns,
      tenantId: filters.tenantId,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      branchId: null,
      dateColumns: ["created_at"],
    });
    if (filters.branchId && orderColumns.has("branch_id")) {
      returnParams.push(filters.branchId);
      returnClauses.push(`o.branch_id = $${returnParams.length}`);
    }
    if (returnsColumns.has("status")) {
      returnClauses.push(`LOWER(COALESCE(r.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')`);
    }

    const returnsResult = await dbClient.query(
      `
      SELECT COALESCE(SUM(COALESCE(r.refund_amount, 0)), 0)::numeric AS returns
      FROM returns r
      ${returnsColumns.has("order_id") ? "LEFT JOIN orders o ON o.id = r.order_id" : ""}
      ${whereSql(returnClauses)}
      `,
      returnParams
    );
    returns = roundMoney(returnsResult.rows[0]?.returns || 0);
  }

  const revenue = roundMoney(revenueResult.rows[0]?.revenue || 0);
  const discounts = roundMoney(revenueResult.rows[0]?.discounts || 0);
  return {
    revenue,
    discounts,
    returns,
    net_revenue: roundMoney(revenue - discounts - returns),
  };
};

export const getAccountingReportsV2Dashboard = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const filters = buildFilters(data);
  const [income, receivables, payables, inventory, specials, summary] = await Promise.all([
    getAccountingReportsV2IncomeStatement(dbClient, filters),
    getAccountingReportsV2Receivables(dbClient, filters),
    getAccountingReportsV2Payables(dbClient, filters),
    getAccountingReportsV2Inventory(dbClient, filters),
    getAccountingReportsV2SpecialTransactions(dbClient, filters),
    getFinancialReportsSummary(dbClient, filters),
  ]);

  const topCustomers = Array.isArray(receivables.top_customers) ? receivables.top_customers.slice(0, 5) : [];
  const topSuppliers = Array.isArray(payables.top_suppliers) ? payables.top_suppliers.slice(0, 5) : [];
  const topInventory = Array.isArray(inventory.rows) ? inventory.rows.slice(0, 5) : [];

  return {
    filters,
    cards: {
      revenue: income.summary.revenue,
      net_revenue: income.summary.net_revenue,
      expenses: income.summary.expenses,
      net_profit: income.summary.net_profit,
      receivables_due: receivables.summary.outstanding_balance,
      payables_due: payables.summary.outstanding_balance,
      inventory_value: inventory.summary.inventory_value,
      cogs: income.summary.cogs,
      discounts: specials.summary.discounts,
      refunds: specials.summary.refunds,
    },
    highlights: {
      top_customers: topCustomers,
      top_suppliers: topSuppliers,
      top_inventory: topInventory,
      top_sales_customers: Array.isArray(summary.top_customers) ? summary.top_customers.slice(0, 5) : [],
      top_products: Array.isArray(summary.top_products) ? summary.top_products.slice(0, 5) : [],
    },
    notes: [
      income.summary.cogs_estimated
        ? "COGS is estimated from available purchase and catalog cost data and is not guaranteed as an immutable per-sale cost ledger."
        : null,
      payables.meta.branch_filter_applied === false
        ? "Branch filtering is not applied to payables because purchases do not store branch_id in the current schema."
        : null,
      specials.meta.gifts_supported === false
        ? "Gift transactions are not explicitly tagged in the current schema, so gifts cannot be reported accurately yet."
        : null,
    ].filter(Boolean),
  };
};

export const getAccountingReportsV2IncomeStatement = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const filters = buildFilters(data);
  const [report, orderRevenue] = await Promise.all([
    getProfitLossReport(dbClient, filters),
    getOrderRevenueSnapshot(dbClient, filters),
  ]);
  const revenue = roundMoney(orderRevenue.revenue);
  const returns = roundMoney(orderRevenue.returns);
  const discounts = roundMoney(orderRevenue.discounts);
  const netRevenue = roundMoney(orderRevenue.net_revenue);
  const cogs = roundMoney(report?.cogs?.total_cogs || 0);
  const expenses = roundMoney(report?.total_expenses || 0);
  const grossProfit = roundMoney(netRevenue - cogs);
  const netProfit = roundMoney(grossProfit - expenses);

  return {
    filters,
    summary: {
      revenue,
      returns,
      discounts,
      net_revenue: netRevenue,
      cogs,
      gross_profit: grossProfit,
      expenses,
      net_profit: netProfit,
      cogs_estimated: true,
      cogs_note: "Derived from available product, variant, override, and purchase cost signals. Exact historical COGS is not guaranteed for every sale line.",
    },
    lines: [
      { key: "revenue", label: "Revenue", amount: revenue, tone: "positive" },
      { key: "returns", label: "Returns / Refunds", amount: returns, tone: "negative" },
      { key: "discounts", label: "Discounts", amount: discounts, tone: "negative" },
      { key: "net_revenue", label: "Net Revenue", amount: netRevenue, tone: "neutral" },
      { key: "cogs", label: "COGS", amount: cogs, tone: "negative", estimated: true },
      { key: "gross_profit", label: "Gross Profit", amount: grossProfit, tone: grossProfit >= 0 ? "positive" : "negative" },
      { key: "expenses", label: "Expenses", amount: expenses, tone: "negative" },
      { key: "net_profit", label: "Net Profit", amount: netProfit, tone: netProfit >= 0 ? "positive" : "negative" },
    ],
    expense_breakdown: Array.isArray(report?.expenses) ? report.expenses : [],
  };
};

export const getAccountingReportsV2Receivables = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const filters = buildFilters(data);
  const [orderColumns, customerColumns] = await Promise.all([
    getTableColumns(dbClient, "orders"),
    getTableColumns(dbClient, "customers"),
  ]);
  if (!orderColumns.size) {
    return {
      filters,
      summary: { total_credit_sales: 0, collected_amount: 0, outstanding_balance: 0, customers_count: 0 },
      top_customers: [],
      rows: [],
      meta: { supported: false },
    };
  }

  const totalExpr = coalesceColumnExpr("o", orderColumns, ["total_amount", "total", "total_price", "grand_total", "net_total"], "0");
  const paidExpr = coalesceColumnExpr("o", orderColumns, ["paid_amount", "amount_paid"], "0");
  const customerNameExpr = orderColumns.has("customer_name")
    ? "NULLIF(o.customer_name, '')"
    : "NULL";
  const customerJoin = customerColumns.size && orderColumns.has("customer_id")
    ? `LEFT JOIN customers c ON c.id = o.customer_id${customerColumns.has("tenant_id") ? " AND c.tenant_id = o.tenant_id" : ""}`
    : "";
  const resolvedCustomerNameExpr = customerJoin
    ? `COALESCE(${customerNameExpr}, NULLIF(${columnExpr("c", customerColumns, ["name"], "''")}, ''), 'Walk-in Customer')`
    : `COALESCE(${customerNameExpr}, 'Walk-in Customer')`;
  const invoiceExpr = coalesceColumnExpr("o", orderColumns, ["invoice_number", "display_order_number", "public_order_number"], "('ORD-' || o.id)");
  const dateExpr = columnExpr("o", orderColumns, ["created_at", "updated_at"], "CURRENT_TIMESTAMP");

  const clauses = [];
  const params = [];
  addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, ...filters });
  clauses.push(...activeOrderClauses(orderColumns, "o"));
  clauses.push(`GREATEST((${totalExpr}) - COALESCE(${paidExpr}, 0), 0) > 0`);

  const summaryResult = await dbClient.query(
    `
    SELECT
      COALESCE(SUM(${totalExpr}), 0)::numeric AS total_credit_sales,
      COALESCE(SUM(COALESCE(${paidExpr}, 0)), 0)::numeric AS collected_amount,
      COALESCE(SUM(GREATEST((${totalExpr}) - COALESCE(${paidExpr}, 0), 0)), 0)::numeric AS outstanding_balance,
      COUNT(DISTINCT COALESCE(o.customer_id, 0))::int AS customers_count
    FROM orders o
    ${whereSql(clauses)}
    `,
    params
  );

  const topCustomersResult = await dbClient.query(
    `
    SELECT
      COALESCE(o.customer_id, 0) AS customer_id,
      ${resolvedCustomerNameExpr} AS customer_name,
      COUNT(*)::int AS orders_count,
      COALESCE(SUM(${totalExpr}), 0)::numeric AS total_credit_sales,
      COALESCE(SUM(COALESCE(${paidExpr}, 0)), 0)::numeric AS collected_amount,
      COALESCE(SUM(GREATEST((${totalExpr}) - COALESCE(${paidExpr}, 0), 0)), 0)::numeric AS outstanding_balance
    FROM orders o
    ${customerJoin}
    ${whereSql(clauses)}
    GROUP BY COALESCE(o.customer_id, 0), ${resolvedCustomerNameExpr}
    ORDER BY outstanding_balance DESC, total_credit_sales DESC
    LIMIT 10
    `,
    params
  );

  const rowsResult = await dbClient.query(
    `
    SELECT
      o.id,
      ${invoiceExpr} AS reference,
      ${resolvedCustomerNameExpr} AS customer_name,
      ${dateExpr} AS transaction_date,
      COALESCE(${totalExpr}, 0)::numeric AS invoice_total,
      COALESCE(${paidExpr}, 0)::numeric AS collected_amount,
      GREATEST((${totalExpr}) - COALESCE(${paidExpr}, 0), 0)::numeric AS outstanding_balance,
      COALESCE(o.status, '') AS status,
      COALESCE(o.payment_status, '') AS payment_status,
      COALESCE(o.branch_id, NULL) AS branch_id
    FROM orders o
    ${customerJoin}
    ${whereSql(clauses)}
    ORDER BY ${dateExpr} DESC, o.id DESC
    LIMIT 200
    `,
    params
  );

  return {
    filters,
    summary: {
      total_credit_sales: roundMoney(summaryResult.rows[0]?.total_credit_sales || 0),
      collected_amount: roundMoney(summaryResult.rows[0]?.collected_amount || 0),
      outstanding_balance: roundMoney(summaryResult.rows[0]?.outstanding_balance || 0),
      customers_count: Number(summaryResult.rows[0]?.customers_count || 0),
    },
    top_customers: topCustomersResult.rows.map((row) => ({
      customer_id: Number(row.customer_id || 0) || null,
      customer_name: row.customer_name || "Walk-in Customer",
      orders_count: Number(row.orders_count || 0),
      total_credit_sales: roundMoney(row.total_credit_sales || 0),
      collected_amount: roundMoney(row.collected_amount || 0),
      outstanding_balance: roundMoney(row.outstanding_balance || 0),
    })),
    rows: rowsResult.rows.map((row) => ({
      id: Number(row.id),
      reference: row.reference || `ORD-${row.id}`,
      customer_name: row.customer_name || "Walk-in Customer",
      transaction_date: row.transaction_date,
      invoice_total: roundMoney(row.invoice_total || 0),
      collected_amount: roundMoney(row.collected_amount || 0),
      outstanding_balance: roundMoney(row.outstanding_balance || 0),
      status: row.status || "",
      payment_status: row.payment_status || "",
      branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
    })),
    meta: { supported: true },
  };
};

export const getAccountingReportsV2Payables = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const filters = buildFilters(data);
  const [purchaseColumns, supplierColumns] = await Promise.all([
    getTableColumns(dbClient, "purchases"),
    getTableColumns(dbClient, "suppliers"),
  ]);
  if (!purchaseColumns.size) {
    return {
      filters,
      summary: { total_unpaid_purchases: 0, paid_amount: 0, outstanding_balance: 0, suppliers_count: 0 },
      top_suppliers: [],
      rows: [],
      meta: { supported: false, branch_filter_applied: false },
    };
  }

  const totalExpr = coalesceColumnExpr("p", purchaseColumns, ["total", "total_amount", "grand_total", "net_total"], "0");
  const paidExpr = coalesceColumnExpr("p", purchaseColumns, ["supplier_paid_amount", "paid_amount", "amount_paid"], "0");
  const referenceExpr = coalesceColumnExpr("p", purchaseColumns, ["purchase_number", "legacy_purchase_number"], "('PUR-' || p.id)");
  const dateExpr = columnExpr("p", purchaseColumns, ["created_at", "updated_at"], "CURRENT_TIMESTAMP");
  const supplierJoin = supplierColumns.size && purchaseColumns.has("supplier_id")
    ? `LEFT JOIN suppliers s ON s.id = p.supplier_id${supplierColumns.has("tenant_id") ? " AND s.tenant_id = p.tenant_id" : ""}`
    : "";
  const supplierNameExpr = supplierJoin
    ? `COALESCE(NULLIF(${columnExpr("s", supplierColumns, ["name"], "''")}, ''), 'Supplier')`
    : "'Supplier'";

  const clauses = [];
  const params = [];
  addScopedWhere({
    clauses,
    params,
    alias: "p",
    columns: purchaseColumns,
    tenantId: filters.tenantId,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    branchId: null,
  });
  clauses.push(...activePurchaseClauses(purchaseColumns, "p"));
  clauses.push(`GREATEST((${totalExpr}) - COALESCE(${paidExpr}, 0), 0) > 0`);

  const summaryResult = await dbClient.query(
    `
    SELECT
      COALESCE(SUM(${totalExpr}), 0)::numeric AS total_unpaid_purchases,
      COALESCE(SUM(COALESCE(${paidExpr}, 0)), 0)::numeric AS paid_amount,
      COALESCE(SUM(GREATEST((${totalExpr}) - COALESCE(${paidExpr}, 0), 0)), 0)::numeric AS outstanding_balance,
      COUNT(DISTINCT COALESCE(p.supplier_id, 0))::int AS suppliers_count
    FROM purchases p
    ${whereSql(clauses)}
    `,
    params
  );

  const topSuppliersResult = await dbClient.query(
    `
    SELECT
      COALESCE(p.supplier_id, 0) AS supplier_id,
      ${supplierNameExpr} AS supplier_name,
      COUNT(*)::int AS purchases_count,
      COALESCE(SUM(${totalExpr}), 0)::numeric AS total_unpaid_purchases,
      COALESCE(SUM(COALESCE(${paidExpr}, 0)), 0)::numeric AS paid_amount,
      COALESCE(SUM(GREATEST((${totalExpr}) - COALESCE(${paidExpr}, 0), 0)), 0)::numeric AS outstanding_balance
    FROM purchases p
    ${supplierJoin}
    ${whereSql(clauses)}
    GROUP BY COALESCE(p.supplier_id, 0), ${supplierNameExpr}
    ORDER BY outstanding_balance DESC, total_unpaid_purchases DESC
    LIMIT 10
    `,
    params
  );

  const rowsResult = await dbClient.query(
    `
    SELECT
      p.id,
      ${referenceExpr} AS reference,
      ${supplierNameExpr} AS supplier_name,
      ${dateExpr} AS transaction_date,
      COALESCE(${totalExpr}, 0)::numeric AS invoice_total,
      COALESCE(${paidExpr}, 0)::numeric AS paid_amount,
      GREATEST((${totalExpr}) - COALESCE(${paidExpr}, 0), 0)::numeric AS outstanding_balance,
      COALESCE(p.status, '') AS status,
      COALESCE(p.payment_status, '') AS payment_status
    FROM purchases p
    ${supplierJoin}
    ${whereSql(clauses)}
    ORDER BY ${dateExpr} DESC, p.id DESC
    LIMIT 200
    `,
    params
  );

  return {
    filters,
    summary: {
      total_unpaid_purchases: roundMoney(summaryResult.rows[0]?.total_unpaid_purchases || 0),
      paid_amount: roundMoney(summaryResult.rows[0]?.paid_amount || 0),
      outstanding_balance: roundMoney(summaryResult.rows[0]?.outstanding_balance || 0),
      suppliers_count: Number(summaryResult.rows[0]?.suppliers_count || 0),
    },
    top_suppliers: topSuppliersResult.rows.map((row) => ({
      supplier_id: Number(row.supplier_id || 0) || null,
      supplier_name: row.supplier_name || "Supplier",
      purchases_count: Number(row.purchases_count || 0),
      total_unpaid_purchases: roundMoney(row.total_unpaid_purchases || 0),
      paid_amount: roundMoney(row.paid_amount || 0),
      outstanding_balance: roundMoney(row.outstanding_balance || 0),
    })),
    rows: rowsResult.rows.map((row) => ({
      id: Number(row.id),
      reference: row.reference || `PUR-${row.id}`,
      supplier_name: row.supplier_name || "Supplier",
      transaction_date: row.transaction_date,
      invoice_total: roundMoney(row.invoice_total || 0),
      paid_amount: roundMoney(row.paid_amount || 0),
      outstanding_balance: roundMoney(row.outstanding_balance || 0),
      status: row.status || "",
      payment_status: row.payment_status || "",
    })),
    meta: {
      supported: true,
      branch_filter_applied: false,
      branch_filter_note: "Purchases do not currently store branch_id, so branch-level payables filtering is not available.",
    },
  };
};

export const getAccountingReportsV2CashAccounts = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const filters = buildFilters(data);
  const [financialColumns, moneyAccountColumns, moneyTransactionColumns] = await Promise.all([
    getTableColumns(dbClient, "financial_accounts"),
    getTableColumns(dbClient, "money_accounts"),
    getTableColumns(dbClient, "money_transactions"),
  ]);

  if (!financialColumns.size) {
    return {
      filters,
      summary: { opening_balance: 0, incoming: 0, outgoing: 0, closing_balance: 0, accounts_count: 0 },
      rows: [],
      transactions: [],
      meta: { supported: false },
    };
  }

  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const clauses = [];
  if (filters.tenantId !== null && financialColumns.has("tenant_id")) clauses.push(`fa.tenant_id = ${add(filters.tenantId)}`);
  if (financialColumns.has("is_active")) clauses.push("fa.is_active = TRUE");
  if (filters.branchId && financialColumns.has("branch_id")) clauses.push(`fa.branch_id = ${add(filters.branchId)}`);
  const moneyDirectionExpr = resolveMoneyDirectionExpr("mt", moneyTransactionColumns);
  const fromParam = filters.fromDate ? add(filters.fromDate) : null;
  const toParam = filters.toDate ? add(filters.toDate) : null;
  const branchParam = filters.branchId ? add(filters.branchId) : null;

  const rowsResult = await dbClient.query(
    `
    SELECT
      fa.id,
      fa.name,
      fa.account_type,
      fa.branch_id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM money_accounts ma_chk
          WHERE ma_chk.financial_account_id = fa.id
          ${moneyAccountColumns.has("tenant_id") ? "AND ma_chk.tenant_id = fa.tenant_id" : ""}
          ${filters.branchId && moneyAccountColumns.has("branch_id") ? `AND (ma_chk.branch_id = ${branchParam} OR ma_chk.branch_id IS NULL)` : ""}
        )
        THEN COALESCE((
          SELECT SUM(COALESCE(ma_open.opening_balance, 0))
          FROM money_accounts ma_open
          WHERE ma_open.financial_account_id = fa.id
          ${moneyAccountColumns.has("tenant_id") ? "AND ma_open.tenant_id = fa.tenant_id" : ""}
          ${filters.branchId && moneyAccountColumns.has("branch_id") ? `AND (ma_open.branch_id = ${branchParam} OR ma_open.branch_id IS NULL)` : ""}
        ), 0)
        ELSE COALESCE(fa.opening_balance, 0)
      END::numeric AS base_opening_balance,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM money_accounts ma_chk
          WHERE ma_chk.financial_account_id = fa.id
          ${moneyAccountColumns.has("tenant_id") ? "AND ma_chk.tenant_id = fa.tenant_id" : ""}
          ${filters.branchId && moneyAccountColumns.has("branch_id") ? `AND (ma_chk.branch_id = ${branchParam} OR ma_chk.branch_id IS NULL)` : ""}
        )
        THEN COALESCE((
          SELECT SUM(COALESCE(ma_current.current_balance, 0))
          FROM money_accounts ma_current
          WHERE ma_current.financial_account_id = fa.id
          ${moneyAccountColumns.has("tenant_id") ? "AND ma_current.tenant_id = fa.tenant_id" : ""}
          ${filters.branchId && moneyAccountColumns.has("branch_id") ? `AND (ma_current.branch_id = ${branchParam} OR ma_current.branch_id IS NULL)` : ""}
        ), 0)
        ELSE COALESCE(fa.current_balance, 0)
      END::numeric AS base_current_balance,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN ${fromParam ? `DATE(mt.created_at) < ${fromParam}` : "FALSE"}
              ${branchParam ? `AND mt.branch_id = ${branchParam}` : ""}
            THEN (${moneyDirectionExpr}) * mt.amount
            ELSE 0
          END
        )
        FROM money_transactions mt
        JOIN money_accounts ma_tx ON ma_tx.id = mt.account_id
        WHERE ma_tx.financial_account_id = fa.id
          ${moneyAccountColumns.has("tenant_id") ? "AND ma_tx.tenant_id = fa.tenant_id" : ""}
          ${moneyTransactionColumns.has("tenant_id") ? "AND mt.tenant_id = fa.tenant_id" : ""}
          ${filters.branchId && moneyAccountColumns.has("branch_id") ? `AND (ma_tx.branch_id = ${branchParam} OR ma_tx.branch_id IS NULL)` : ""}
      ), 0)::numeric AS prior_delta,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN ${fromParam ? `DATE(mt.created_at) >= ${fromParam}` : "TRUE"}
              AND ${toParam ? `DATE(mt.created_at) <= ${toParam}` : "TRUE"}
              ${branchParam ? `AND mt.branch_id = ${branchParam}` : ""}
              AND LOWER(COALESCE(mt.direction, '')) = 'in'
            THEN mt.amount
            ELSE 0
          END
        )
        FROM money_transactions mt
        JOIN money_accounts ma_tx ON ma_tx.id = mt.account_id
        WHERE ma_tx.financial_account_id = fa.id
          ${moneyAccountColumns.has("tenant_id") ? "AND ma_tx.tenant_id = fa.tenant_id" : ""}
          ${moneyTransactionColumns.has("tenant_id") ? "AND mt.tenant_id = fa.tenant_id" : ""}
          ${filters.branchId && moneyAccountColumns.has("branch_id") ? `AND (ma_tx.branch_id = ${branchParam} OR ma_tx.branch_id IS NULL)` : ""}
      ), 0)::numeric AS incoming,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN ${fromParam ? `DATE(mt.created_at) >= ${fromParam}` : "TRUE"}
              AND ${toParam ? `DATE(mt.created_at) <= ${toParam}` : "TRUE"}
              ${branchParam ? `AND mt.branch_id = ${branchParam}` : ""}
              AND LOWER(COALESCE(mt.direction, '')) = 'out'
            THEN mt.amount
            ELSE 0
          END
        )
        FROM money_transactions mt
        JOIN money_accounts ma_tx ON ma_tx.id = mt.account_id
        WHERE ma_tx.financial_account_id = fa.id
          ${moneyAccountColumns.has("tenant_id") ? "AND ma_tx.tenant_id = fa.tenant_id" : ""}
          ${moneyTransactionColumns.has("tenant_id") ? "AND mt.tenant_id = fa.tenant_id" : ""}
          ${filters.branchId && moneyAccountColumns.has("branch_id") ? `AND (ma_tx.branch_id = ${branchParam} OR ma_tx.branch_id IS NULL)` : ""}
      ), 0)::numeric AS outgoing
    FROM financial_accounts fa
    ${whereSql(clauses)}
    ORDER BY fa.account_type ASC, fa.name ASC
    `,
    params
  );

  const rows = rowsResult.rows.map((row) => {
    const opening = filters.fromDate
      ? roundMoney(toNumber(row.base_opening_balance) + toNumber(row.prior_delta))
      : roundMoney(row.base_opening_balance || 0);
    const incoming = roundMoney(row.incoming || 0);
    const outgoing = roundMoney(row.outgoing || 0);
    const closing = filters.fromDate || filters.toDate
      ? roundMoney(opening + incoming - outgoing)
      : roundMoney(row.base_current_balance || opening + incoming - outgoing);
    return {
      id: Number(row.id),
      name: row.name || "",
      account_type: row.account_type || "",
      branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
      opening_balance: opening,
      incoming,
      outgoing,
      closing_balance: closing,
    };
  });

  const txClauses = [];
  const txParams = [];
  addScopedWhere({
    clauses: txClauses,
    params: txParams,
    alias: "mt",
    columns: moneyTransactionColumns,
    tenantId: filters.tenantId,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    branchId: filters.branchId,
    dateColumns: ["created_at"],
  });

  const transactions = moneyTransactionColumns.size
    ? (await dbClient.query(
        `
        SELECT
          mt.id,
          mt.created_at,
          mt.direction,
          mt.transaction_type,
          mt.reference_type,
          mt.reference_id,
          mt.payment_method,
          mt.notes,
          mt.amount::numeric AS amount,
          ma.name AS account_name,
          fa.name AS financial_account_name
        FROM money_transactions mt
        LEFT JOIN money_accounts ma ON ma.id = mt.account_id
        LEFT JOIN financial_accounts fa ON fa.id = ma.financial_account_id
        ${whereSql(txClauses)}
        ORDER BY mt.created_at DESC, mt.id DESC
        LIMIT 300
        `,
        txParams
      )).rows.map((row) => ({
        id: Number(row.id),
        created_at: row.created_at,
        direction: row.direction || "",
        transaction_type: row.transaction_type || "",
        reference_type: row.reference_type || "",
        reference_id: row.reference_id === null || row.reference_id === undefined ? null : Number(row.reference_id),
        payment_method: row.payment_method || "",
        notes: row.notes || "",
        amount: roundMoney(row.amount || 0),
        account_name: row.financial_account_name || row.account_name || "",
      }))
    : [];

  const summary = rows.reduce(
    (acc, row) => {
      acc.opening_balance = roundMoney(acc.opening_balance + row.opening_balance);
      acc.incoming = roundMoney(acc.incoming + row.incoming);
      acc.outgoing = roundMoney(acc.outgoing + row.outgoing);
      acc.closing_balance = roundMoney(acc.closing_balance + row.closing_balance);
      return acc;
    },
    { opening_balance: 0, incoming: 0, outgoing: 0, closing_balance: 0 }
  );

  return {
    filters,
    summary: {
      ...summary,
      accounts_count: rows.length,
    },
    rows,
    transactions,
    meta: { supported: true },
  };
};

export const getAccountingReportsV2Inventory = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const filters = buildFilters(data);
  const [summaryReport, incomeReport, variantColumns, productColumns, warehouseInventoryColumns] = await Promise.all([
    getFinancialReportsSummary(dbClient, filters),
    getAccountingReportsV2IncomeStatement(dbClient, filters),
    getTableColumns(dbClient, "product_variants"),
    getTableColumns(dbClient, "products"),
    getTableColumns(dbClient, "warehouse_inventory"),
  ]);

  const rows = [];

  if (variantColumns.size) {
    const params = [];
    const add = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    const clauses = [];
    if (filters.tenantId !== null && variantColumns.has("tenant_id")) clauses.push(`pv.tenant_id = ${add(filters.tenantId)}`);
    if (filters.branchId && variantColumns.has("branch_id")) clauses.push(`pv.branch_id = ${add(filters.branchId)}`);
    if (variantColumns.has("deleted_at")) clauses.push("pv.deleted_at IS NULL");
    const stockSubquery = warehouseInventoryColumns.size
      ? `(
          SELECT COALESCE(SUM(wi.stock), 0)
          FROM warehouse_inventory wi
          WHERE wi.variant_id = pv.id
          ${filters.branchId && warehouseInventoryColumns.has("branch_id") ? `AND wi.branch_id = ${add(filters.branchId)}` : ""}
        )`
      : "NULL";
    const unitCostExpr = positiveCoalesceColumnExpr(
      "pv",
      variantColumns,
      ["average_cost", "last_purchase_cost", "purchase_price", "last_purchase_price", "cost_price", "price"],
      positiveCoalesceColumnExpr("p", productColumns, ["average_cost", "last_purchase_cost", "purchase_price", "last_purchase_price", "cost_price", "price"], "0")
    );
    const rowsResult = await dbClient.query(
      `
      SELECT
        pv.id AS variant_id,
        p.id AS product_id,
        p.name AS product_name,
        COALESCE(NULLIF(CONCAT_WS(' / ', NULLIF(pv.color, ''), NULLIF(pv.size, '')), ''), NULLIF(pv.sku, ''), ('Variant #' || pv.id)) AS variant_name,
        COALESCE(NULLIF(${stockSubquery}, 0), COALESCE(pv.stock, 0))::numeric AS stock_qty,
        GREATEST(${unitCostExpr}, 0)::numeric AS unit_cost
      FROM product_variants pv
      LEFT JOIN products p ON p.id = pv.product_id
      ${whereSql(clauses)}
      ORDER BY stock_qty DESC, product_name ASC
      LIMIT 300
      `,
      params
    );
    rows.push(
      ...rowsResult.rows
        .map((row) => ({
          key: `variant-${row.variant_id}`,
          product_id: Number(row.product_id || 0) || null,
          variant_id: Number(row.variant_id || 0) || null,
          product_name: row.product_name || "Product",
          item_name: row.variant_name || row.product_name || "Variant",
          stock_qty: roundMoney(row.stock_qty || 0),
          unit_cost: roundMoney(row.unit_cost || 0),
          inventory_value: roundMoney(toNumber(row.stock_qty) * toNumber(row.unit_cost)),
          source: "variant",
        }))
        .filter((row) => row.stock_qty > 0 || row.inventory_value > 0)
    );
  }

  if (productColumns.size) {
    const params = [];
    const add = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    const clauses = [];
    if (filters.tenantId !== null && productColumns.has("tenant_id")) clauses.push(`p.tenant_id = ${add(filters.tenantId)}`);
    const standaloneOnly = variantColumns.size ? "AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)" : "";
    const unitCostExpr = positiveCoalesceColumnExpr("p", productColumns, ["average_cost", "last_purchase_cost", "purchase_price", "last_purchase_price", "cost_price", "price"], "0");
    const rowsResult = await dbClient.query(
      `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        COALESCE(p.stock, 0)::numeric AS stock_qty,
        GREATEST(${unitCostExpr}, 0)::numeric AS unit_cost
      FROM products p
      ${whereSql(clauses)}
      ${standaloneOnly}
      ORDER BY stock_qty DESC, product_name ASC
      LIMIT 150
      `,
      params
    );
    rows.push(
      ...rowsResult.rows
        .map((row) => ({
          key: `product-${row.product_id}`,
          product_id: Number(row.product_id || 0) || null,
          variant_id: null,
          product_name: row.product_name || "Product",
          item_name: row.product_name || "Product",
          stock_qty: roundMoney(row.stock_qty || 0),
          unit_cost: roundMoney(row.unit_cost || 0),
          inventory_value: roundMoney(toNumber(row.stock_qty) * toNumber(row.unit_cost)),
          source: "product",
        }))
        .filter((row) => row.stock_qty > 0 || row.inventory_value > 0)
    );
  }

  rows.sort((a, b) => b.inventory_value - a.inventory_value || b.stock_qty - a.stock_qty || a.item_name.localeCompare(b.item_name));
  const limitedRows = rows.slice(0, 200);

  return {
    filters,
    summary: {
      inventory_value: roundMoney(summaryReport?.inventory_valuation || limitedRows.reduce((sum, row) => sum + row.inventory_value, 0)),
      inventory_lines: limitedRows.length,
      total_units: roundMoney(limitedRows.reduce((sum, row) => sum + row.stock_qty, 0)),
      cogs: roundMoney(incomeReport.summary.cogs || 0),
      cogs_estimated: incomeReport.summary.cogs_estimated === true,
      cogs_note: incomeReport.summary.cogs_note,
    },
    rows: limitedRows,
    meta: { supported: true },
  };
};

export const getAccountingReportsV2SpecialTransactions = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const filters = buildFilters(data);
  const [orderColumns, returnColumns, employeeAdvanceColumns, expenseColumns, inventoryMovementColumns] = await Promise.all([
    getTableColumns(dbClient, "orders"),
    getTableColumns(dbClient, "returns"),
    getTableColumns(dbClient, "employee_advances"),
    getTableColumns(dbClient, "expenses"),
    getTableColumns(dbClient, "inventory_movements"),
  ]);

  const rows = [];

  if (orderColumns.size) {
    const discountColumns = ["discount_amount", "invoice_discount_amount", "coupon_discount_amount"].filter((column) => orderColumns.has(column));
    if (discountColumns.length) {
      const clauses = [];
      const params = [];
      addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, ...filters });
      clauses.push(...activeOrderClauses(orderColumns, "o"));
      clauses.push(`(${discountColumns.map((column) => `COALESCE(o.${column}, 0)`).join(" + ")}) > 0`);
      const result = await dbClient.query(
        `
        SELECT
          o.id,
          ${coalesceColumnExpr("o", orderColumns, ["invoice_number", "display_order_number"], "('ORD-' || o.id)")} AS reference,
          ${columnExpr("o", orderColumns, ["created_at", "updated_at"], "CURRENT_TIMESTAMP")} AS transaction_date,
          (${discountColumns.map((column) => `COALESCE(o.${column}, 0)`).join(" + ")})::numeric AS amount,
          COALESCE(o.notes, o.order_notes, '') AS notes
        FROM orders o
        ${whereSql(clauses)}
        ORDER BY transaction_date DESC, o.id DESC
        LIMIT 120
        `,
        params
      );
      rows.push(...result.rows.map((row) => ({
        id: `discount-${row.id}`,
        category: "discount",
        label: "Order Discount",
        reference: row.reference || `ORD-${row.id}`,
        transaction_date: row.transaction_date,
        amount: roundMoney(row.amount || 0),
        notes: row.notes || "",
      })));
    }

    if (orderColumns.has("is_personal_transaction") || orderColumns.has("personal_settlement_type")) {
      const clauses = [];
      const params = [];
      addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, ...filters });
      const personalChecks = [];
      if (orderColumns.has("is_personal_transaction")) personalChecks.push("COALESCE(o.is_personal_transaction, FALSE) = TRUE");
      if (orderColumns.has("personal_settlement_type")) personalChecks.push("NULLIF(TRIM(COALESCE(o.personal_settlement_type, '')), '') IS NOT NULL");
      clauses.push(`(${personalChecks.join(" OR ")})`);
      const result = await dbClient.query(
        `
        SELECT
          o.id,
          ${coalesceColumnExpr("o", orderColumns, ["invoice_number", "display_order_number"], "('ORD-' || o.id)")} AS reference,
          ${columnExpr("o", orderColumns, ["created_at", "updated_at"], "CURRENT_TIMESTAMP")} AS transaction_date,
          ${coalesceColumnExpr("o", orderColumns, ["total_amount", "total", "total_price"], "0")}::numeric AS amount,
          COALESCE(o.personal_settlement_type, 'owner_use') AS kind,
          COALESCE(o.personal_note, o.notes, '') AS notes
        FROM orders o
        ${whereSql(clauses)}
        ORDER BY transaction_date DESC, o.id DESC
        LIMIT 60
        `,
        params
      );
      rows.push(...result.rows.map((row) => ({
        id: `owner-order-${row.id}`,
        category: "owner_use",
        label: row.kind || "Owner Use",
        reference: row.reference || `ORD-${row.id}`,
        transaction_date: row.transaction_date,
        amount: roundMoney(row.amount || 0),
        notes: row.notes || "",
      })));
    }
  }

  if (returnColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({
      clauses,
      params,
      alias: "r",
      columns: returnColumns,
      tenantId: filters.tenantId,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      branchId: null,
      dateColumns: ["created_at"],
    });
    const result = await dbClient.query(
      `
      SELECT
        r.id,
        COALESCE(r.return_number, ('RET-' || r.id)) AS reference,
        r.created_at AS transaction_date,
        COALESCE(r.refund_amount, 0)::numeric AS amount,
        COALESCE(r.reason, '') AS notes
      FROM returns r
      ${whereSql(clauses)}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 120
      `,
      params
    );
    rows.push(
      ...result.rows
        .filter((row) => roundMoney(row.amount || 0) > 0)
        .map((row) => ({
          id: `refund-${row.id}`,
          category: "refund",
          label: "Refund",
          reference: row.reference || `RET-${row.id}`,
          transaction_date: row.transaction_date,
          amount: roundMoney(row.amount || 0),
          notes: row.notes || "",
        }))
    );
  }

  if (employeeAdvanceColumns.size) {
    const params = [];
    const clauses = [];
    if (filters.tenantId !== null && employeeAdvanceColumns.has("tenant_id")) clauses.push(`ea.tenant_id = $${params.push(filters.tenantId)}`);
    const expenseJoin = expenseColumns.size && employeeAdvanceColumns.has("expense_id") ? "LEFT JOIN expenses e ON e.id = ea.expense_id" : "";
    if (filters.fromDate) clauses.push(`DATE(ea.created_at) >= $${params.push(filters.fromDate)}`);
    if (filters.toDate) clauses.push(`DATE(ea.created_at) <= $${params.push(filters.toDate)}`);
    if (filters.branchId && expenseColumns.has("branch_id")) clauses.push(`e.branch_id = $${params.push(filters.branchId)}`);
    const result = await dbClient.query(
      `
      SELECT
        ea.id,
        ea.created_at AS transaction_date,
        COALESCE(ea.amount, 0)::numeric AS amount,
        COALESCE(ea.status, ea.deduction_status, 'pending') AS status,
        COALESCE(ea.notes, '') AS notes
      FROM employee_advances ea
      ${expenseJoin}
      ${whereSql(clauses)}
      ORDER BY ea.created_at DESC, ea.id DESC
      LIMIT 120
      `,
      params
    );
    rows.push(...result.rows.map((row) => ({
      id: `advance-${row.id}`,
      category: "employee_advance",
      label: "Employee Advance",
      reference: `ADV-${row.id}`,
      transaction_date: row.transaction_date,
      amount: roundMoney(row.amount || 0),
      status: row.status || "",
      notes: row.notes || "",
    })));
  }

  if (inventoryMovementColumns.size && inventoryMovementColumns.has("movement_type")) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "im", columns: inventoryMovementColumns, ...filters, dateColumns: ["created_at"] });
    clauses.push(`UPPER(COALESCE(im.movement_type, '')) = 'OWNER_USE_OUT'`);
    const result = await dbClient.query(
      `
      SELECT
        im.id,
        im.created_at AS transaction_date,
        COALESCE(im.total_cost, ABS(COALESCE(im.quantity_change, im.quantity, 0)) * COALESCE(im.unit_cost, 0), 0)::numeric AS amount,
        COALESCE(im.notes, im.note, im.reason, '') AS notes
      FROM inventory_movements im
      ${whereSql(clauses)}
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT 60
      `,
      params
    );
    rows.push(...result.rows.map((row) => ({
      id: `owner-stock-${row.id}`,
      category: "owner_use",
      label: "Owner Use Inventory",
      reference: `INV-${row.id}`,
      transaction_date: row.transaction_date,
      amount: roundMoney(row.amount || 0),
      notes: row.notes || "",
    })));
  }

  rows.sort((a, b) => new Date(b.transaction_date || 0).getTime() - new Date(a.transaction_date || 0).getTime());

  const summary = rows.reduce(
    (acc, row) => {
      acc.total_amount = roundMoney(acc.total_amount + row.amount);
      if (row.category === "discount") acc.discounts = roundMoney(acc.discounts + row.amount);
      if (row.category === "refund") acc.refunds = roundMoney(acc.refunds + row.amount);
      if (row.category === "employee_advance") acc.employee_advances = roundMoney(acc.employee_advances + row.amount);
      if (row.category === "owner_use") acc.owner_use = roundMoney(acc.owner_use + row.amount);
      return acc;
    },
    { total_amount: 0, discounts: 0, refunds: 0, employee_advances: 0, owner_use: 0, gifts: 0 }
  );

  return {
    filters,
    summary,
    rows: rows.slice(0, 250),
    meta: {
      supported: true,
      gifts_supported: false,
      gifts_note: "No explicit gift/free-item marker was found in the current schema.",
    },
  };
};
