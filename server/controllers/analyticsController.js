import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

const DEFAULT_EMPTY = [];

const analyticsDebugEnabled = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.ERP_ANALYTICS_DEBUG || "").toLowerCase());

const logAnalyticsDebug = (tag, payload = {}) => {
  if (!analyticsDebugEnabled()) return;
  console.info(tag, payload);
};

const safeRows = async (query, params = [], fallback = DEFAULT_EMPTY) => {
  try {
    const result = await db.query(query, params);
    return result.rows;
  } catch (error) {
    console.log("ANALYTICS QUERY FAILED:", error.message);
    return fallback;
  }
};

const safeScalar = async (query, params = [], fallback = 0) => {
  const rows = await safeRows(query, params, []);
  if (!rows.length) return fallback;
  const value = rows[0];
  const firstKey = Object.keys(value)[0];
  return Number(value[firstKey] || fallback) || fallback;
};

const getScope = (req) => {
  const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
  const where = tenantId === null ? "" : " WHERE tenant_id = $1";
  return { tenantId, where, params: tenantId === null ? [] : [tenantId] };
};

const parseDateValue = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const parseNumberValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseAnalyticsFilters = (req = {}) => ({
  startDate: parseDateValue(req.query?.startDate),
  endDate: parseDateValue(req.query?.endDate),
  branchId: parseNumberValue(req.query?.branchId),
  warehouseId: parseNumberValue(req.query?.warehouseId),
});

const getAnalysisWindowDays = (filters = {}) => {
  if (filters.startDate && filters.endDate) {
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return Math.max(diff, 1);
    }
  }

  return 30;
};

const buildWhereClause = ({
  alias,
  tenantId,
  filters = {},
  dateColumn = "created_at",
  branchColumn = null,
  warehouseColumn = null,
}) => {
  const params = [];
  const clauses = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (tenantId !== null && tenantId !== undefined) {
    clauses.push(`${alias}.tenant_id = ${add(tenantId)}`);
  }

  if (filters.startDate) {
    clauses.push(`DATE(${alias}.${dateColumn}) >= ${add(filters.startDate)}`);
  }

  if (filters.endDate) {
    clauses.push(`DATE(${alias}.${dateColumn}) <= ${add(filters.endDate)}`);
  }

  if (branchColumn && filters.branchId !== null && filters.branchId !== undefined) {
    clauses.push(`${alias}.${branchColumn} = ${add(filters.branchId)}`);
  }

  if (warehouseColumn && filters.warehouseId !== null && filters.warehouseId !== undefined) {
    clauses.push(`${alias}.${warehouseColumn} = ${add(filters.warehouseId)}`);
  }

  return {
    where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
    add,
  };
};

const getBestSeller = async (tenantId, filters = {}) => {
  const scope = buildWhereClause({
    alias: "o",
    tenantId,
    filters,
    dateColumn: "created_at",
    branchColumn: "branch_id",
  });
  const rows = await safeRows(
    `
    SELECT
      COALESCE(oi.product_name, p.name, 'Unknown') AS name,
      COALESCE(SUM(oi.quantity), 0) AS total_qty,
      COALESCE(SUM(oi.total_amount), 0) AS revenue
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN orders o ON o.id = oi.order_id
    ${scope.where}
    GROUP BY COALESCE(oi.product_name, p.name, 'Unknown')
    ORDER BY total_qty DESC, revenue DESC
    LIMIT 1
    `,
    scope.params,
    []
  );

  if (!rows.length) {
    return { name: "No sales yet", total_qty: 0, revenue: 0 };
  }

  return {
    name: rows[0].name,
    total_qty: Number(rows[0].total_qty || 0),
    revenue: Number(rows[0].revenue || 0),
  };
};

const getRevenueSummary = async (tenantId, filters = {}) => {
  const ordersScope = buildWhereClause({
    alias: "o",
    tenantId,
    filters,
    dateColumn: "created_at",
    branchColumn: "branch_id",
  });
  const customersScope = buildWhereClause({
    alias: "c",
    tenantId,
    filters,
    dateColumn: "created_at",
  });
  const receivablesScope = {
    where: `${ordersScope.where}${ordersScope.where ? " AND" : " WHERE"} o.payment_status IS DISTINCT FROM 'paid'`,
    params: [...ordersScope.params],
  };
  const [revenue, orders, customers, pendingReceivables] = await Promise.all([
    safeScalar(`SELECT COALESCE(SUM(o.total_amount), 0) AS value FROM orders o${ordersScope.where}`, ordersScope.params, 0),
    safeScalar(`SELECT COUNT(*) AS value FROM orders o${ordersScope.where}`, ordersScope.params, 0),
    safeScalar(`SELECT COUNT(*) AS value FROM customers c${customersScope.where}`, customersScope.params, 0),
    safeScalar(
      `SELECT COALESCE(SUM(GREATEST(o.total_amount - o.paid_amount, 0)), 0) AS value FROM orders o${receivablesScope.where}`,
      receivablesScope.params,
      0
    ),
  ]);

  return {
    revenue,
    orders,
    customers,
    pendingReceivables,
  };
};

const getProfitSummary = async (tenantId, filters = {}) => {
  const ordersScope = buildWhereClause({
    alias: "o",
    tenantId,
    filters,
    dateColumn: "created_at",
    branchColumn: "branch_id",
  });
  const purchasesScope = buildWhereClause({
    alias: "p",
    tenantId,
    filters,
    dateColumn: "created_at",
    warehouseColumn: "warehouse_id",
  });
  const expensesScope = buildWhereClause({
    alias: "e",
    tenantId,
    filters,
    dateColumn: "created_at",
  });
  const cashboxScope = buildWhereClause({
    alias: "c",
    tenantId,
    filters,
    dateColumn: "created_at",
  });
  const payablesScope = {
    where: `${purchasesScope.where}${purchasesScope.where ? " AND" : " WHERE"} p.payment_status IS DISTINCT FROM 'paid'`,
    params: [...purchasesScope.params],
  };

  const [revenue, purchases, expenses, cashBalance, pendingPayables] = await Promise.all([
    safeScalar(`SELECT COALESCE(SUM(o.total_amount), 0) AS value FROM orders o${ordersScope.where}`, ordersScope.params, 0),
    safeScalar(`SELECT COALESCE(SUM(p.total), 0) AS value FROM purchases p${purchasesScope.where}`, purchasesScope.params, 0),
    safeScalar(`SELECT COALESCE(SUM(e.amount), 0) AS value FROM expenses e${expensesScope.where}`, expensesScope.params, 0),
    safeScalar(
      `SELECT COALESCE(c.balance, 0) AS value FROM cashbox c${cashboxScope.where} ORDER BY c.created_at DESC LIMIT 1`,
      cashboxScope.params,
      0
    ),
    safeScalar(
      `SELECT COALESCE(SUM(GREATEST(p.total - p.paid_amount, 0)), 0) AS value FROM purchases p${payablesScope.where}`,
      payablesScope.params,
      0
    ),
  ]);

  return {
    revenue,
    purchases,
    expenses,
    profit: revenue - purchases - expenses,
    cashBalance,
    pendingPayables,
  };
};

const buildSeries = async (tenantId, filters = {}) => {
  const scope = buildWhereClause({
    alias: "o",
    tenantId,
    filters,
    dateColumn: "created_at",
    branchColumn: "branch_id",
  });

  const revenueSeries = await safeRows(
    `
    SELECT
      TO_CHAR(DATE_TRUNC('day', o.created_at), 'Dy') AS name,
      COALESCE(SUM(o.total_amount), 0) AS revenue,
      COALESCE(SUM(o.paid_amount), 0) AS profit,
      COUNT(*)::INT AS orders
    FROM orders o
    ${scope.where}
    GROUP BY DATE_TRUNC('day', o.created_at)
    ORDER BY DATE_TRUNC('day', o.created_at) ASC
    LIMIT 7
    `,
    scope.params,
    []
  );

  const channelSeries = await safeRows(
    `
    SELECT
      COALESCE(o.channel, 'pos') AS name,
      COUNT(*)::INT AS value
    FROM orders o
    ${scope.where}
    GROUP BY COALESCE(o.channel, 'pos')
    ORDER BY value DESC
    LIMIT 6
    `,
    scope.params,
    []
  );

  return {
    revenueSeries,
    channelSeries,
  };
};

const buildInventoryIntelligence = async (tenantId, filters = {}) => {
  const productsScope = buildWhereClause({
    alias: "p",
    tenantId,
    filters,
    dateColumn: "created_at",
  });
  const movementsScope = buildWhereClause({
    alias: "m",
    tenantId,
    filters,
    dateColumn: "created_at",
    warehouseColumn: "warehouse_id",
  });
  const warehouseScope = buildWhereClause({
    alias: "wi",
    tenantId,
    filters,
    dateColumn: "created_at",
    warehouseColumn: "warehouse_id",
  });

  const [lowStockItems, deadStockItems, predictedSales, smartAlerts, inventoryValue, movementSummary] =
    await Promise.all([
      filters.warehouseId !== null
        ? safeRows(
            `
            SELECT
              p.id,
              p.name,
              p.sku,
              COALESCE(wi.stock, 0) AS stock,
              COALESCE(p.low_stock_alert, 0) AS threshold,
              p.status
            FROM products p
            LEFT JOIN product_variants v ON v.product_id = p.id
            LEFT JOIN warehouse_inventory wi ON wi.variant_id = v.id
            ${warehouseScope.where}
              ${warehouseScope.where ? "AND" : "WHERE"} COALESCE(wi.stock, 0) <= COALESCE(p.low_stock_alert, 0)
            ORDER BY COALESCE(wi.stock, 0) ASC
            LIMIT 12
            `,
            warehouseScope.params,
            []
          )
        : safeRows(
            `
            SELECT
              p.id,
              p.name,
              p.sku,
              COALESCE(p.stock, 0) AS stock,
              COALESCE(p.low_stock_alert, 0) AS threshold,
              p.status
            FROM products p
            ${productsScope.where}
              ${productsScope.where ? "AND" : "WHERE"} COALESCE(p.stock, 0) <= COALESCE(p.low_stock_alert, 0)
            ORDER BY COALESCE(p.stock, 0) ASC
            LIMIT 12
            `,
            productsScope.params,
            []
          ),
      filters.warehouseId !== null
        ? safeRows(
            `
            SELECT
              p.id,
              p.name,
              p.sku,
              COALESCE(v.color, 'Default') AS color,
              COALESCE(v.size, 'One size') AS size,
              COALESCE(wi.stock, 0) AS stock,
              COALESCE(MAX(o.created_at), v.created_at, p.created_at) AS last_sale_at
            FROM products p
            LEFT JOIN product_variants v ON v.product_id = p.id
            LEFT JOIN warehouse_inventory wi ON wi.variant_id = v.id
            LEFT JOIN order_items oi ON (oi.variant_id = v.id OR (oi.product_id = p.id AND oi.variant_id IS NULL))
              ${tenantId === null ? "" : "AND oi.tenant_id = $1"}
            LEFT JOIN orders o ON o.id = oi.order_id
            ${warehouseScope.where}
              ${warehouseScope.where ? "AND" : "WHERE"} COALESCE(wi.stock, 0) > 0
            GROUP BY p.id, p.name, p.sku, v.color, v.size, wi.stock, v.created_at, p.created_at
            HAVING COALESCE(MAX(o.created_at), v.created_at, p.created_at) < NOW() - INTERVAL '60 days'
            ORDER BY stock DESC
            LIMIT 12
            `,
            warehouseScope.params,
            []
          )
        : safeRows(
            `
            SELECT
              p.id,
              p.name,
              p.sku,
              COALESCE(v.color, 'Default') AS color,
              COALESCE(v.size, 'One size') AS size,
              COALESCE(v.stock, p.stock, 0) AS stock,
              COALESCE(MAX(o.created_at), v.created_at, p.created_at) AS last_sale_at
            FROM products p
            LEFT JOIN product_variants v ON v.product_id = p.id
            LEFT JOIN order_items oi ON (oi.variant_id = v.id OR (oi.product_id = p.id AND oi.variant_id IS NULL))
              ${tenantId === null ? "" : "AND oi.tenant_id = $1"}
            LEFT JOIN orders o ON o.id = oi.order_id
            ${productsScope.where}
              ${productsScope.where ? "AND" : "WHERE"} COALESCE(v.stock, p.stock, 0) > 0
            GROUP BY p.id, p.name, p.sku, v.color, v.size, v.stock, p.stock, v.created_at, p.created_at
            HAVING COALESCE(MAX(o.created_at), v.created_at, p.created_at) < NOW() - INTERVAL '60 days'
            ORDER BY stock DESC
            LIMIT 12
            `,
            productsScope.params,
            []
          ),
      safeRows(
        `
        SELECT
          TO_CHAR(DATE_TRUNC('day', m.created_at), 'Dy') AS label,
          COALESCE(SUM(m.quantity), 0) AS value
        FROM inventory_movements m
        ${movementsScope.where}
          ${movementsScope.where ? "AND" : "WHERE"} m.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE_TRUNC('day', m.created_at)
        ORDER BY DATE_TRUNC('day', m.created_at) ASC
        `,
        movementsScope.params,
        []
      ),
      safeRows(
        `
        SELECT
          'Next 7 days' AS label,
          COALESCE(SUM(COALESCE(stock, 0)), 0) * 1.08 AS value,
          84 AS confidence
        FROM products p
        ${productsScope.where}
        `,
        productsScope.params,
        []
      ),
      filters.warehouseId !== null
        ? safeRows(
            `
            SELECT
              COALESCE(SUM(COALESCE(wi.stock, 0) * COALESCE(p.cost_price, 0)), 0) AS value
            FROM products p
            LEFT JOIN product_variants v ON v.product_id = p.id
            LEFT JOIN warehouse_inventory wi ON wi.variant_id = v.id
            ${warehouseScope.where}
            `,
            warehouseScope.params,
            []
          )
        : safeRows(
            `
            SELECT
              COALESCE(SUM(COALESCE(p.stock, 0) * COALESCE(p.cost_price, 0)), 0) AS value
            FROM products p
            ${productsScope.where}
            `,
            productsScope.params,
            []
          ),
      safeRows(
        `
        SELECT
          COALESCE(m.movement_type, 'adjustment') AS name,
          COUNT(*)::INT AS value
        FROM inventory_movements m
        ${movementsScope.where}
        GROUP BY COALESCE(m.movement_type, 'adjustment')
        ORDER BY value DESC
        `,
        movementsScope.params,
        []
      ),
    ]);

  return {
    lowStockItems,
    deadStockItems,
    predictedSales,
    smartAlerts: smartAlerts.length
      ? smartAlerts
      : [
          { id: 1, title: "Restock alert", message: "Low stock items detected.", severity: "high" },
          { id: 2, title: "Dead stock alert", message: "Slow-moving products identified.", severity: "medium" },
        ],
    inventoryValue: inventoryValue[0]?.value || 0,
    movementSummary,
  };
};

const buildCustomerAnalytics = async (tenantId, filters = {}) => {
  const scope = buildWhereClause({
    alias: "c",
    tenantId,
    filters,
    dateColumn: "created_at",
  });
  const orderParams = [];
  const orderClauses = [];
  const pushOrderParam = (value) => {
    orderParams.push(value);
    return `$${scope.params.length + orderParams.length}`;
  };

  if (filters.startDate) {
    orderClauses.push(`DATE(o.created_at) >= ${pushOrderParam(filters.startDate)}`);
  }

  if (filters.endDate) {
    orderClauses.push(`DATE(o.created_at) <= ${pushOrderParam(filters.endDate)}`);
  }

  const orderFilterClause = orderClauses.length ? ` AND ${orderClauses.join(" AND ")}` : "";

  const [summaryRows, topCustomers, recentCustomers] = await Promise.all([
    safeRows(
      `
      SELECT
        COUNT(*)::INT AS total_customers,
        COUNT(*) FILTER (WHERE status = 'active')::INT AS active_customers,
        COALESCE(SUM(wallet_balance), 0) AS wallet_balance,
        COALESCE(SUM(loyalty_points), 0) AS loyalty_points
      FROM customers c
      ${scope.where}
      `,
      scope.params,
      []
    ),
    safeRows(
      `
      SELECT
        COALESCE(c.name, 'Customer') AS name,
        COALESCE(SUM(o.total_amount), 0) AS revenue,
        COUNT(o.id)::INT AS orders
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id
        ${tenantId === null ? "" : "AND o.tenant_id = c.tenant_id"}
        ${orderFilterClause}
      ${scope.where}
      GROUP BY c.name
      ORDER BY revenue DESC
      LIMIT 5
      `,
      [...scope.params, ...orderParams],
      []
    ),
    safeRows(
      `
      SELECT
        id,
        name,
        phone,
        status,
        created_at
      FROM customers c
      ${scope.where}
      ORDER BY created_at DESC
      LIMIT 8
      `,
      scope.params,
      []
    ),
  ]);

  const summary = summaryRows[0] || {};

  return {
    summary: {
      totalCustomers: Number(summary.total_customers || 0),
      activeCustomers: Number(summary.active_customers || 0),
      walletBalance: Number(summary.wallet_balance || 0),
      loyaltyPoints: Number(summary.loyalty_points || 0),
    },
    topCustomers,
    recentCustomers,
  };
};

const buildInsights = async (tenantId, filters = {}) => {
  const [summary, profit, inventory, customers] = await Promise.all([
    getRevenueSummary(tenantId, filters),
    getProfitSummary(tenantId, filters),
    buildInventoryIntelligence(tenantId, filters),
    buildCustomerAnalytics(tenantId, filters),
  ]);

  const growthRate =
    summary.orders > 0 ? Math.min(30, Math.max(3, Number((summary.revenue / Math.max(summary.orders, 1)) / 1000) || 0)) : 0;

  return [
    {
      title: "Revenue acceleration detected",
      insight: `Revenue is ${summary.revenue > 0 ? "active" : "quiet"} with ${summary.orders} orders and an estimated growth bias of ${growthRate.toFixed(1)}%.`,
    },
    {
      title: "Inventory risk concentration",
      insight: `${inventory.lowStockItems.length} low-stock items and ${inventory.deadStockItems.length} dead-stock items require attention.`,
    },
    {
      title: "Margin expansion opportunity",
      insight: `Current estimated profit is ${profit.profit.toFixed(2)}. Top customers and best sellers can absorb targeted pricing and bundle strategies.`,
    },
    {
      title: "Customer retention signal",
      insight: `${customers.summary.activeCustomers} active customers are currently driving the repeat revenue base.`,
    },
  ];
};

const buildReorderSuggestions = async (tenantId, filters = {}) => {
  const daysWindow = getAnalysisWindowDays(filters);
  const ordersScope = buildWhereClause({
    alias: "o",
    tenantId,
    filters,
    dateColumn: "created_at",
    branchColumn: "branch_id",
  });

  const stockRows = await safeRows(
    filters.warehouseId !== null
      ? `
      SELECT
        p.id AS product_id,
        v.id AS variant_id,
        COALESCE(p.name, 'Unknown') AS product_name,
        COALESCE(v.color, 'Default') AS color,
        COALESCE(v.size, 'One size') AS size,
        COALESCE(v.sku, p.sku, 'n/a') AS sku,
        COALESCE(SUM(wi.stock), 0) AS current_stock
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      LEFT JOIN warehouse_inventory wi ON wi.variant_id = v.id
      LEFT JOIN warehouses w ON w.id = wi.warehouse_id
      WHERE p.tenant_id = $1
        AND w.id = $2
      GROUP BY p.id, v.id, p.name, v.color, v.size, v.sku, p.sku
      `
      : `
      SELECT
        p.id AS product_id,
        v.id AS variant_id,
        COALESCE(p.name, 'Unknown') AS product_name,
        COALESCE(v.color, 'Default') AS color,
        COALESCE(v.size, 'One size') AS size,
        COALESCE(v.sku, p.sku, 'n/a') AS sku,
        COALESCE(v.stock, p.stock, 0) AS current_stock
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE p.tenant_id = $1
      GROUP BY p.id, v.id, p.name, v.color, v.size, v.sku, p.sku, v.stock, p.stock
      `,
    filters.warehouseId !== null ? [tenantId, filters.warehouseId] : [tenantId],
    []
  );

  const salesRows = await safeRows(
    `
    SELECT
      COALESCE(v.product_id, p.id, oi.product_id) AS product_id,
      oi.variant_id AS variant_id,
      COALESCE(p.name, oi.product_name, 'Unknown') AS product_name,
      COALESCE(v.color, 'Default') AS color,
      COALESCE(v.size, 'One size') AS size,
      COALESCE(v.sku, oi.sku, p.sku, 'n/a') AS sku,
      COALESCE(SUM(oi.quantity), 0) AS sold_qty
    FROM order_items oi
    LEFT JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_variants v ON v.id = oi.variant_id
    ${ordersScope.where}
    GROUP BY COALESCE(v.product_id, p.id, oi.product_id), oi.variant_id, COALESCE(p.name, oi.product_name, 'Unknown'), COALESCE(v.color, 'Default'), COALESCE(v.size, 'One size'), COALESCE(v.sku, oi.sku, p.sku, 'n/a')
    `,
    ordersScope.params,
    []
  );

  const stockMap = new Map();
  stockRows.forEach((row) => {
    const key = `${row.product_id || "p"}:${row.variant_id || "v0"}`;
    stockMap.set(key, {
      product_id: row.product_id,
      variant_id: row.variant_id,
      product_name: row.product_name,
      color: row.color,
      size: row.size,
      sku: row.sku,
      current_stock: Number(row.current_stock || 0),
      sold_qty: 0,
    });
  });

  salesRows.forEach((row) => {
    const key = `${row.product_id || "p"}:${row.variant_id || "v0"}`;
    const current = stockMap.get(key) || {
      product_id: row.product_id,
      variant_id: row.variant_id,
      product_name: row.product_name,
      color: row.color,
      size: row.size,
      sku: row.sku,
      current_stock: 0,
      sold_qty: 0,
    };
    current.sold_qty = Number(row.sold_qty || 0);
    stockMap.set(key, current);
  });

  const suggestions = Array.from(stockMap.values())
    .map((item) => {
      const averageDailySales = item.sold_qty / Math.max(daysWindow, 1);
      const estimatedDaysRemaining = averageDailySales > 0 ? item.current_stock / averageDailySales : item.current_stock > 0 ? 999 : 0;
      const targetCoverageDays = 30;
      const suggestedReorderQuantity = averageDailySales > 0
        ? Math.max(0, Math.ceil(averageDailySales * targetCoverageDays - item.current_stock))
        : item.current_stock === 0
          ? 10
          : 0;

      const riskLevel =
        item.current_stock <= 0 || estimatedDaysRemaining <= 7
          ? "critical"
          : estimatedDaysRemaining <= 14
            ? "warning"
            : "healthy";

      return {
        product_name: item.product_name,
        color: item.color,
        size: item.size,
        sku: item.sku,
        current_stock: item.current_stock,
        average_daily_sales: Number(averageDailySales.toFixed(2)),
        estimated_days_remaining: Number.isFinite(estimatedDaysRemaining) ? Number(estimatedDaysRemaining.toFixed(1)) : 0,
        suggested_reorder_quantity: suggestedReorderQuantity,
        risk_level: riskLevel,
      };
    })
    .filter((item) => item.risk_level !== "healthy" || item.suggested_reorder_quantity > 0)
    .sort((a, b) => {
      const rank = { critical: 0, warning: 1, healthy: 2 };
      return rank[a.risk_level] - rank[b.risk_level] || a.estimated_days_remaining - b.estimated_days_remaining;
    })
    .slice(0, 20);

  return suggestions;
};

const buildDeadStockAnalysis = async (tenantId, filters = {}) => {
  const ordersScope = buildWhereClause({
    alias: "o",
    tenantId,
    filters,
    dateColumn: "created_at",
    branchColumn: "branch_id",
  });
  const productScope = buildWhereClause({
    alias: "p",
    tenantId,
    filters,
    dateColumn: "created_at",
  });

  const rows = await safeRows(
    filters.warehouseId !== null
      ? `
      WITH sales AS (
        SELECT
          COALESCE(v.product_id, p.id, oi.product_id) AS product_id,
          oi.variant_id AS variant_id,
          MAX(o.created_at) AS last_sold_date,
          COALESCE(SUM(oi.quantity), 0) AS sold_qty
        FROM order_items oi
        LEFT JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants v ON v.id = oi.variant_id
        ${ordersScope.where}
        GROUP BY COALESCE(v.product_id, p.id, oi.product_id), oi.variant_id
      ),
      stock AS (
        SELECT
          p.id AS product_id,
          v.id AS variant_id,
          COALESCE(p.name, 'Unknown') AS product,
          COALESCE(v.color, 'Default') AS color,
          COALESCE(v.size, 'One size') AS size,
          COALESCE(v.sku, p.sku, 'n/a') AS sku,
          COALESCE(SUM(wi.stock), 0) AS stock_qty,
          COALESCE(SUM(wi.stock * COALESCE(v.cost_price, p.cost_price, 0)), 0) AS blocked_capital
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id
        LEFT JOIN warehouse_inventory wi ON wi.variant_id = v.id
        LEFT JOIN warehouses w ON w.id = wi.warehouse_id
        WHERE p.tenant_id = $1
          AND w.id = $2
        GROUP BY p.id, v.id, p.name, v.color, v.size, v.sku, p.sku, v.cost_price, p.cost_price
      )
      SELECT
        stock.product,
        stock.color,
        stock.size,
        stock.sku,
        stock.stock_qty,
        sales.last_sold_date,
        CASE
          WHEN sales.last_sold_date IS NULL THEN 9999
          ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400))
        END AS days_without_sales,
        stock.blocked_capital,
        CASE
          WHEN stock.stock_qty <= 0 THEN 95
          WHEN sales.last_sold_date IS NULL THEN 90
          ELSE LEAST(100, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) + stock.stock_qty))
        END AS risk_score,
        CASE
          WHEN stock.stock_qty <= 0 THEN 'healthy'
          WHEN sales.last_sold_date IS NULL THEN 'clearance'
          WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) >= 90 THEN 'clearance'
          WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) >= 60 THEN 'discount'
          WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) >= 30 THEN 'bundle'
          WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) >= 14 THEN 'transfer'
          ELSE 'healthy'
        END AS recommendation
      FROM stock
      LEFT JOIN sales ON sales.product_id = stock.product_id AND COALESCE(sales.variant_id, 0) = COALESCE(stock.variant_id, 0)
      WHERE stock.stock_qty > 0
      ORDER BY risk_score DESC, blocked_capital DESC
      LIMIT 50
      `
      : `
      WITH sales AS (
        SELECT
          COALESCE(v.product_id, p.id, oi.product_id) AS product_id,
          oi.variant_id AS variant_id,
          MAX(o.created_at) AS last_sold_date,
          COALESCE(SUM(oi.quantity), 0) AS sold_qty
        FROM order_items oi
        LEFT JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants v ON v.id = oi.variant_id
        ${ordersScope.where}
        GROUP BY COALESCE(v.product_id, p.id, oi.product_id), oi.variant_id
      ),
      stock AS (
        SELECT
          p.id AS product_id,
          v.id AS variant_id,
          COALESCE(p.name, 'Unknown') AS product,
          COALESCE(v.color, 'Default') AS color,
          COALESCE(v.size, 'One size') AS size,
          COALESCE(v.sku, p.sku, 'n/a') AS sku,
          COALESCE(v.stock, p.stock, 0) AS stock_qty,
          COALESCE(COALESCE(v.stock, p.stock, 0) * COALESCE(v.cost_price, p.cost_price, 0), 0) AS blocked_capital
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id
        ${productScope.where}
      )
      SELECT
        stock.product,
        stock.color,
        stock.size,
        stock.sku,
        stock.stock_qty,
        sales.last_sold_date,
        CASE
          WHEN sales.last_sold_date IS NULL THEN 9999
          ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400))
        END AS days_without_sales,
        stock.blocked_capital,
        CASE
          WHEN stock.stock_qty <= 0 THEN 95
          WHEN sales.last_sold_date IS NULL THEN 90
          ELSE LEAST(100, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) + stock.stock_qty))
        END AS risk_score,
        CASE
          WHEN stock.stock_qty <= 0 THEN 'healthy'
          WHEN sales.last_sold_date IS NULL THEN 'clearance'
          WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) >= 90 THEN 'clearance'
          WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) >= 60 THEN 'discount'
          WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) >= 30 THEN 'bundle'
          WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - sales.last_sold_date)) / 86400) >= 14 THEN 'transfer'
          ELSE 'healthy'
        END AS recommendation
      FROM stock
      LEFT JOIN sales ON sales.product_id = stock.product_id AND COALESCE(sales.variant_id, 0) = COALESCE(stock.variant_id, 0)
      WHERE stock.stock_qty > 0
      ORDER BY risk_score DESC, blocked_capital DESC
      LIMIT 50
      `,
    filters.warehouseId !== null ? [tenantId, filters.warehouseId] : ordersScope.params,
    []
  );

  return rows.map((row) => ({
    product: row.product,
    variant: [row.color, row.size].filter(Boolean).join(" / "),
    sku: row.sku,
    stock_quantity: Number(row.stock_qty || 0),
    last_sold_date: row.last_sold_date || null,
    days_without_sales: Number(row.days_without_sales || 0),
    estimated_blocked_capital: Number(row.blocked_capital || 0),
    risk_score: Number(row.risk_score || 0),
    recommendation: row.recommendation || "healthy",
  }));
};

const buildCustomerIntelligence = async (tenantId, filters = {}) => {
  const scope = buildWhereClause({
    alias: "o",
    tenantId,
    filters,
    dateColumn: "created_at",
    branchColumn: "branch_id",
  });
  const orderJoinClause = scope.where ? scope.where.replace(/^ WHERE\s+/i, " AND ") : "";

  const rows = await safeRows(
    `
    WITH customer_sales AS (
      SELECT
        c.id AS customer_id,
        COALESCE(c.name, 'Customer') AS customer_name,
        c.phone,
        c.email,
        COUNT(o.id)::INT AS total_orders,
        COALESCE(SUM(o.total_amount), 0) AS total_spent,
        COALESCE(AVG(o.total_amount), 0) AS average_order_value,
        MAX(o.created_at) AS last_order_date
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id ${orderJoinClause}
      GROUP BY c.id, c.name, c.phone, c.email
    ),
    product_mix AS (
      SELECT
        COALESCE(o.customer_id, 0) AS customer_id,
        COALESCE(string_agg(DISTINCT COALESCE(oi.product_name, p.name, 'Product'), ', '), '') AS favorite_products,
        COALESCE(string_agg(DISTINCT COALESCE(cat.name, 'Uncategorized'), ', '), '') AS favorite_categories
      FROM order_items oi
      LEFT JOIN orders o ON o.id = oi.order_id ${orderJoinClause}
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      GROUP BY COALESCE(o.customer_id, 0)
    )
    SELECT
      cs.customer_name,
      cs.phone,
      cs.email,
      cs.total_orders,
      cs.total_spent,
      cs.average_order_value,
      cs.last_order_date,
      CASE
        WHEN cs.last_order_date IS NULL THEN 9999
        ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - cs.last_order_date)) / 86400))
      END AS days_since_last_order,
      COALESCE(pm.favorite_products, '') AS favorite_products,
      COALESCE(pm.favorite_categories, '') AS favorite_categories,
      CASE
        WHEN cs.total_spent >= 5000 OR cs.total_orders >= 10 THEN 'VIP'
        WHEN cs.total_orders >= 5 OR cs.total_spent >= 1000 THEN 'Loyal'
        WHEN cs.total_orders <= 2 AND cs.last_order_date IS NOT NULL AND EXTRACT(EPOCH FROM (NOW() - cs.last_order_date)) / 86400 <= 30 THEN 'New'
        WHEN cs.last_order_date IS NULL OR EXTRACT(EPOCH FROM (NOW() - cs.last_order_date)) / 86400 >= 90 THEN 'Inactive'
        ELSE 'At Risk'
      END AS customer_segment,
      CASE
        WHEN cs.total_spent >= 5000 OR cs.total_orders >= 10 THEN 'reward'
        WHEN cs.total_orders >= 5 OR cs.total_spent >= 1000 THEN 'upsell'
        WHEN cs.last_order_date IS NULL OR EXTRACT(EPOCH FROM (NOW() - cs.last_order_date)) / 86400 >= 90 THEN 'win-back'
        WHEN EXTRACT(EPOCH FROM (NOW() - cs.last_order_date)) / 86400 >= 30 THEN 'follow-up'
        ELSE 'normal'
      END AS recommendation
    FROM customer_sales cs
    LEFT JOIN product_mix pm ON pm.customer_id = cs.customer_id
    ORDER BY cs.total_spent DESC, cs.total_orders DESC, cs.last_order_date DESC NULLS LAST
    LIMIT 50
    `,
    scope.params,
    []
  );

  return rows.map((row) => ({
    customer_name: row.customer_name,
    phone: row.phone,
    email: row.email,
    total_orders: Number(row.total_orders || 0),
    total_spent: Number(row.total_spent || 0),
    average_order_value: Number(row.average_order_value || 0),
    last_order_date: row.last_order_date || null,
    days_since_last_order: Number(row.days_since_last_order || 0),
    favorite_products: row.favorite_products || "",
    favorite_categories: row.favorite_categories || "",
    customer_segment: row.customer_segment || "New",
    recommendation: row.recommendation || "normal",
  }));
};

export async function getAnalyticsOverview(req, res) {
  try {
    const { tenantId } = getScope(req);
    const filters = parseAnalyticsFilters(req);
    const summary = await getRevenueSummary(tenantId, filters);
    const profit = await getProfitSummary(tenantId, filters);
    const bestSeller = await getBestSeller(tenantId, filters);
    const inventory = await buildInventoryIntelligence(tenantId, filters);

    const overview = {
      kpis: [
        { label: "Revenue", value: Number(summary.revenue || 0), delta: 0, trend: "flat" },
        { label: "Profit", value: Number(profit.profit || 0), delta: 0, trend: "flat" },
        { label: "Orders", value: Number(summary.orders || 0), delta: 0, trend: "flat" },
        { label: "Customers", value: Number(summary.customers || 0), delta: 0, trend: "flat" },
        { label: "Low Stock", value: Number(inventory.lowStockItems.length || 0), delta: 0, trend: "flat" },
        { label: "Best Seller", value: bestSeller.name, delta: 0, trend: "flat" },
      ],
      summary: {
        revenue: summary.revenue,
        profit: profit.profit,
        orders: summary.orders,
        customers: summary.customers,
        lowStockCount: Number(inventory.lowStockItems.length || 0),
        deadStockCount: Number(inventory.deadStockItems.length || 0),
        bestSeller: bestSeller.name,
        forecastedGrowth: 0,
      },
      bestSeller,
      pendingReceivables: Number(summary.pendingReceivables || 0),
      pendingPayables: Number(profit.pendingPayables || 0),
      cashBalance: Number(profit.cashBalance || 0),
    };

    logAnalyticsDebug("[analytics]", {
      endpoint: "overview",
      filters,
      totals: overview.summary,
      source_tables: ["orders", "order_items", "customers", "products", "purchases", "expenses", "cashbox"],
    });
    logAnalyticsDebug("[data-source]", { endpoint: "overview", query_counts: { low_stock_items: inventory.lowStockItems.length, dead_stock_items: inventory.deadStockItems.length } });

    return res.status(200).json({ success: true, overview });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Analytics Overview",
      error: error.message,
    });
  }
}

export async function getSalesAnalytics(req, res) {
  try {
    const { tenantId } = getScope(req);
    const filters = parseAnalyticsFilters(req);
    const series = await buildSeries(tenantId, filters);
    const topProductsScope = buildWhereClause({
      alias: "o",
      tenantId,
      filters,
      dateColumn: "created_at",
      branchColumn: "branch_id",
    });
    const topProducts = await safeRows(
      `
      SELECT
        COALESCE(oi.product_name, p.name, 'Unknown') AS name,
        COALESCE(SUM(oi.quantity), 0) AS quantity,
        COALESCE(SUM(oi.total_amount), 0) AS revenue
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN orders o ON o.id = oi.order_id
      ${topProductsScope.where}
      GROUP BY COALESCE(oi.product_name, p.name, 'Unknown')
      ORDER BY quantity DESC, revenue DESC
      LIMIT 10
      `,
      topProductsScope.params,
      []
    );

    logAnalyticsDebug("[analytics]", {
      endpoint: "sales",
      filters,
      dataset_sizes: {
        revenueSeries: series.revenueSeries?.length || 0,
        channelSeries: series.channelSeries?.length || 0,
        topProducts: topProducts.length,
      },
      source_tables: ["orders", "order_items", "products"],
    });

    return res.status(200).json({
      success: true,
      sales: {
        ...series,
        topProducts,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Sales Analytics",
      error: error.message,
    });
  }
}

export async function getProfitAnalytics(req, res) {
  try {
    const { tenantId } = getScope(req);
    const filters = parseAnalyticsFilters(req);
    const summary = await getProfitSummary(tenantId, filters);
    const ordersScope = buildWhereClause({
      alias: "o",
      tenantId,
      filters,
      dateColumn: "created_at",
      branchColumn: "branch_id",
    });
    const purchasesScope = buildWhereClause({
      alias: "p",
      tenantId,
      filters,
      dateColumn: "created_at",
      warehouseColumn: "warehouse_id",
    });
    const expensesScope = buildWhereClause({
      alias: "e",
      tenantId,
      filters,
      dateColumn: "created_at",
    });

    const monthlyOrders = await safeRows(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', o.created_at), 'Mon') AS month,
        COALESCE(SUM(total_amount), 0) AS revenue
      FROM orders o
      ${ordersScope.where}
      GROUP BY DATE_TRUNC('month', o.created_at)
      ORDER BY DATE_TRUNC('month', o.created_at) ASC
      LIMIT 12
      `,
      ordersScope.params,
      []
    );

    const monthlyPurchases = await safeRows(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', p.created_at), 'Mon') AS month,
        COALESCE(SUM(total), 0) AS purchases
      FROM purchases p
      ${purchasesScope.where}
      GROUP BY DATE_TRUNC('month', p.created_at)
      ORDER BY DATE_TRUNC('month', p.created_at) ASC
      LIMIT 12
      `,
      purchasesScope.params,
      []
    );

    const monthlyExpenses = await safeRows(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', e.created_at), 'Mon') AS month,
        COALESCE(SUM(amount), 0) AS expenses
      FROM expenses e
      ${expensesScope.where}
      GROUP BY DATE_TRUNC('month', e.created_at)
      ORDER BY DATE_TRUNC('month', e.created_at) ASC
      LIMIT 12
      `,
      expensesScope.params,
      []
    );

    const monthlyMap = new Map();
    [monthlyOrders, monthlyPurchases, monthlyExpenses].forEach((rows) => {
      rows.forEach((row) => {
        const key = row.month;
        if (!monthlyMap.has(key)) {
          monthlyMap.set(key, { month: key, revenue: 0, purchases: 0, expenses: 0 });
        }
        const current = monthlyMap.get(key);
        if (row.revenue !== undefined) current.revenue = Number(row.revenue || 0);
        if (row.purchases !== undefined) current.purchases = Number(row.purchases || 0);
        if (row.expenses !== undefined) current.expenses = Number(row.expenses || 0);
        monthlyMap.set(key, current);
      });
    });

    const monthly = Array.from(monthlyMap.values()).map((row) => ({
      ...row,
      profit: Number(row.revenue || 0) - Number(row.purchases || 0) - Number(row.expenses || 0),
    }));

    return res.status(200).json({
      success: true,
      profit: {
        ...summary,
        monthly,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Profit Analytics",
      error: error.message,
    });
  }
}

export async function getInventoryIntelligence(req, res) {
  try {
    const { tenantId } = getScope(req);
    const filters = parseAnalyticsFilters(req);
    const inventory = await buildInventoryIntelligence(tenantId, filters);
    return res.status(200).json({
      success: true,
      inventory,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Inventory Intelligence",
      error: error.message,
    });
  }
}

export async function getCustomerAnalytics(req, res) {
  try {
    const { tenantId } = getScope(req);
    const filters = parseAnalyticsFilters(req);
    const customerAnalytics = await buildCustomerAnalytics(tenantId, filters);
    return res.status(200).json({
      success: true,
      customers: customerAnalytics,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Customer Analytics",
      error: error.message,
    });
  }
}

export async function getAiInsights(req, res) {
  try {
    const { tenantId } = getScope(req);
    const filters = parseAnalyticsFilters(req);
    const items = await buildInsights(tenantId, filters);
    return res.status(200).json({
      success: true,
      aiInsights: {
        items,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch AI Insights",
      error: error.message,
    });
  }
}

export async function getReorderSuggestions(req, res) {
  try {
    const { tenantId } = getScope(req);
    const filters = parseAnalyticsFilters(req);
    const items = await buildReorderSuggestions(tenantId, filters);
    return res.status(200).json({
      success: true,
      reorderSuggestions: {
        items,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(200).json({
      success: true,
      reorderSuggestions: {
        items: [],
      },
    });
  }
}

export async function getDeadStockAnalysis(req, res) {
  try {
    const { tenantId } = getScope(req);
    const filters = parseAnalyticsFilters(req);
    const items = await buildDeadStockAnalysis(tenantId, filters);
    return res.status(200).json({
      success: true,
      deadStock: {
        items,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(200).json({
      success: true,
      deadStock: {
        items: [],
      },
    });
  }
}

export async function getCustomerIntelligence(req, res) {
  try {
    const { tenantId } = getScope(req);
    const filters = parseAnalyticsFilters(req);
    const items = await buildCustomerIntelligence(tenantId, filters);
    return res.status(200).json({
      success: true,
      customerIntelligence: {
        items,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(200).json({
      success: true,
      customerIntelligence: {
        items: [],
      },
    });
  }
}
