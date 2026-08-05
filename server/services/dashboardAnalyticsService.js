import db from "../database/db.js";
import { groupLowStockAlerts } from "../utils/lowStockAlertGrouping.js";

const daySql = "date_trunc('day', NOW())";
const yesterdaySql = "date_trunc('day', NOW()) - INTERVAL '1 day'";

const toNumber = (value) => Number(value || 0);
const tableExistsCache = new Map();
const columnExistsCache = new Map();
const ERP_PERF_DEBUG = ["1", "true", "yes", "on"].includes(String(process.env.ERP_PERF_DEBUG || "").toLowerCase());

const logPerf = (message, payload = {}) => {
  if (!ERP_PERF_DEBUG) return;
  console.log(message, payload);
};

const resolveDateRange = ({ range = "today", dateFrom = "", dateTo = "" } = {}) => {
  if (range === "yesterday") return { sql: "CURRENT_DATE - INTERVAL '1 day'", endSql: "CURRENT_DATE" };
  if (range === "7d") return { sql: "CURRENT_DATE - INTERVAL '6 days'", endSql: "CURRENT_DATE + INTERVAL '1 day'" };
  if (range === "month") return { sql: "date_trunc('month', NOW())", endSql: "NOW()" };
  if (range === "custom" && dateFrom && dateTo) return { custom: true, dateFrom, dateTo };
  return { sql: "CURRENT_DATE", endSql: "CURRENT_DATE + INTERVAL '1 day'" };
};

const dateClause = (alias, filters, params) => {
  const range = resolveDateRange(filters);
  if (range.custom) {
    params.push(range.dateFrom);
    const from = `$${params.length}`;
    params.push(range.dateTo);
    const to = `$${params.length}`;
    return ` AND ${alias}.created_at >= ${from}::timestamp AND ${alias}.created_at < (${to}::date + INTERVAL '1 day')`;
  }
  return ` AND ${alias}.created_at >= ${range.sql} AND ${alias}.created_at < ${range.endSql}`;
};

const branchClause = (alias, filters, params) => {
  const branchId = String(filters?.branchId || "").trim();
  if (!branchId || branchId === "all") return "";
  params.push(branchId);
  return ` AND ${alias}.branch_id = $${params.length}::bigint`;
};

const tableExists = async (tableName) => {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName);
  const startedAt = Date.now();
  logPerf("[dashboard] query start", { name: "tableExists", tableName });
  try {
    const result = await db.query("SELECT to_regclass($1) AS regclass", [`public.${tableName}`]);
    const exists = Boolean(result.rows[0]?.regclass);
    tableExistsCache.set(tableName, exists);
    logPerf("[dashboard] query end", { name: "tableExists", tableName, durationMs: Date.now() - startedAt, rows: result.rowCount });
    return exists;
  } catch (error) {
    console.error("[dashboard] query error", {
      name: "tableExists",
      tableName,
      durationMs: Date.now() - startedAt,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return false;
  }
};

const columnExists = async (tableName, columnName) => {
  const cacheKey = `${tableName}.${columnName}`;
  if (columnExistsCache.has(cacheKey)) return columnExistsCache.get(cacheKey);
  const startedAt = Date.now();
  logPerf("[dashboard] query start", { name: "columnExists", tableName, columnName });
  try {
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
    logPerf("[dashboard] query end", { name: "columnExists", tableName, columnName, durationMs: Date.now() - startedAt, rows: result.rowCount });
    return exists;
  } catch (error) {
    console.error("[dashboard] query error", {
      name: "columnExists",
      tableName,
      columnName,
      durationMs: Date.now() - startedAt,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return false;
  }
};

const tenantClause = (alias, tenantId, params) => {
  if (tenantId === null || tenantId === undefined) return "";
  params.push(tenantId);
  return ` AND ${alias}.tenant_id = $${params.length}`;
};

const personalOrderClause = (alias = "o") => ` AND COALESCE(${alias}.is_personal_transaction, FALSE) = FALSE`;

const emptyRows = [];
const LOW_STOCK_ALERT_MAX = 2;

const safeQuery = async (sql, params = [], fallback = emptyRows, name = "dashboardQuery") => {
  const startedAt = Date.now();
  logPerf("[dashboard] query start", { name, params: params.length });
  try {
    const result = await db.query(sql, params);
    logPerf("[dashboard] query end", { name, durationMs: Date.now() - startedAt, rows: result.rowCount });
    return result.rows;
  } catch (error) {
    console.error("[dashboard] query error", {
      name,
      durationMs: Date.now() - startedAt,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return fallback;
  }
};

export const warmDashboardMetadataCache = async () => {
  const tables = [
    "orders",
    "order_items",
    "products",
    "product_variants",
    "purchases",
    "customers",
    "cashbox",
    "expenses",
    "returns",
    "inventory_movements",
    "stock_transfers",
    "marketing_attribution_events",
  ];
  await Promise.all(tables.map((tableName) => tableExists(tableName)));
  await Promise.all([
    columnExists("orders", "tenant_id"),
    columnExists("orders", "branch_id"),
    columnExists("orders", "payment_method"),
    columnExists("orders", "source"),
    columnExists("orders", "channel"),
    columnExists("order_items", "tenant_id"),
    columnExists("products", "tenant_id"),
    columnExists("product_variants", "tenant_id"),
    columnExists("product_variants", "stock"),
    columnExists("cashbox", "status"),
  ]);
};

export const getDashboardOverview = async ({ tenantId = null, filters = {} } = {}) => {
  const params = [];
  const ordersTenant = tenantClause("o", tenantId, params);
  const ordersDate = dateClause("o", filters, params);
  const ordersBranch = branchClause("o", filters, params);
  const yesterdayParams = [];
  const yesterdayTenant = tenantClause("o", tenantId, yesterdayParams);
  const productParams = [];
  const productTenant = tenantClause("p", tenantId, productParams);
  const variantParams = [];
  const variantTenant = tenantClause("pv", tenantId, variantParams);
  const purchaseParams = [];
  const purchaseTenant = tenantClause("p", tenantId, purchaseParams);
  const customerParams = [];
  const customerTenant = tenantClause("c", tenantId, customerParams);
  const cashboxParams = [];
  const cashboxTenant = tenantClause("c", tenantId, cashboxParams);

  const [
    today,
    yesterday,
    productLow,
    variantLow,
    pendingPurchases,
    customersToday,
    activePos,
    recentInvoices,
  ] = await Promise.all([
    tableExists("orders")
      ? safeQuery(
          `
          SELECT
            COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS sales,
            COALESCE(SUM(COALESCE(o.total_amount, o.total, 0) - COALESCE(o.discount_amount, 0)), 0) AS gross,
            COUNT(*)::int AS orders,
            COALESCE(AVG(NULLIF(COALESCE(o.total_amount, o.total, 0), 0)), 0) AS aov
          FROM orders o
          WHERE 1=1
            ${ordersDate}
            ${ordersBranch}
            AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
            ${personalOrderClause("o")}
            ${ordersTenant}
          `,
          params,
          [{}],
          "overview.today"
        )
      : [{}],
    tableExists("orders")
      ? safeQuery(
          `
          SELECT
            COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS sales,
            COUNT(*)::int AS orders,
            COALESCE(AVG(NULLIF(COALESCE(o.total_amount, o.total, 0), 0)), 0) AS aov
          FROM orders o
          WHERE o.created_at >= ${yesterdaySql}
            AND o.created_at < ${daySql}
            AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
            ${personalOrderClause("o")}
            ${yesterdayTenant}
          `,
          yesterdayParams,
          [{}],
          "overview.yesterday"
        )
      : [{}],
    tableExists("products")
      ? safeQuery(
          `
          SELECT COUNT(*)::int AS count
          FROM products p
          WHERE COALESCE(p.stock, 0) <= GREATEST(COALESCE(p.low_stock_alert, 0), 1)
            AND LOWER(COALESCE(p.status, 'active')) = 'active'
            ${productTenant}
          `,
          productParams,
          [{}],
          "overview.productLow"
        )
      : [{}],
    tableExists("product_variants")
      ? safeQuery(
          `
          SELECT COUNT(*)::int AS count
          FROM product_variants pv
          WHERE COALESCE(pv.stock, 0) <= GREATEST(COALESCE(pv.low_stock_alert, 0), 1)
            ${variantTenant}
          `,
          variantParams,
          [{}],
          "overview.variantLow"
        )
      : [{}],
    tableExists("purchases")
      ? safeQuery(
          `
          SELECT COUNT(*)::int AS count
          FROM purchases p
          WHERE LOWER(COALESCE(p.status, '')) IN ('draft', 'pending', 'ordered', 'approved')
            ${purchaseTenant}
          `,
          purchaseParams,
          [{}],
          "overview.pendingPurchases"
        )
      : [{}],
    tableExists("customers")
      ? safeQuery(
          `
          SELECT COUNT(*)::int AS count
          FROM customers c
          WHERE c.created_at >= ${daySql}
            ${customerTenant}
          `,
          customerParams,
          [{}],
          "overview.customersToday"
        )
      : [{}],
    tableExists("cashbox")
      ? safeQuery(
          `
          SELECT COUNT(*)::int AS count
          FROM cashbox c
          WHERE LOWER(COALESCE(c.status, '')) = 'open'
            ${cashboxTenant}
          `,
          cashboxParams,
          [{}],
          "overview.activePos"
        )
      : [{}],
    getRecentInvoices({ tenantId, limit: 6, todayOnly: filters.range === "today" }),
  ]);

  const t = today[0] || {};
  const y = yesterday[0] || {};
  const sales = toNumber(t.sales);
  const yesterdaySales = toNumber(y.sales);
  const growth = yesterdaySales > 0 ? ((sales - yesterdaySales) / yesterdaySales) * 100 : sales > 0 ? 100 : 0;
  const profit = await calculateTodayProfit({ tenantId, filters });

  return {
    systemStatus: "live",
    generatedAt: new Date().toISOString(),
    today: {
      sales,
      profit,
      orders: toNumber(t.orders),
      averageOrderValue: toNumber(t.aov),
      customers: toNumber(customersToday[0]?.count),
    },
    kpis: {
      todaySales: { value: sales, growth },
      todayProfit: { value: profit, growth },
      todayOrders: { value: toNumber(t.orders), growth: toNumber(y.orders) ? ((toNumber(t.orders) - toNumber(y.orders)) / toNumber(y.orders)) * 100 : toNumber(t.orders) ? 100 : 0 },
      averageOrderValue: { value: toNumber(t.aov), growth: toNumber(y.aov) ? ((toNumber(t.aov) - toNumber(y.aov)) / toNumber(y.aov)) * 100 : toNumber(t.aov) ? 100 : 0 },
      activePosSessions: { value: toNumber(activePos[0]?.count), growth: 0 },
      lowStockProducts: { value: toNumber(productLow[0]?.count) + toNumber(variantLow[0]?.count), growth: 0 },
      pendingPurchaseOrders: { value: toNumber(pendingPurchases[0]?.count), growth: 0 },
      totalCustomersToday: { value: toNumber(customersToday[0]?.count), growth: 0 },
    },
    recentInvoices,
  };
};

export const calculateTodayProfit = async ({ tenantId = null, filters = {} } = {}) => {
  if (!(await tableExists("orders"))) return 0;
  const hasItems = await tableExists("order_items");
  const hasProducts = await tableExists("products");
  const hasVariants = await tableExists("product_variants");
  const hasInvoiceDiscountAmount = await columnExists("orders", "invoice_discount_amount");
  const expenseParams = [];
  const orderParams = [];
  const orderTenant = tenantClause("o", tenantId, orderParams);
  const orderDate = dateClause("o", filters, orderParams);
  const orderBranch = branchClause("o", filters, orderParams);
  const expenseTenant = tenantClause("e", tenantId, expenseParams);

  const salesRows = hasItems && (hasProducts || hasVariants)
    ? await safeQuery(
        `
        WITH order_profit AS (
          SELECT
            o.id,
            COALESCE(SUM(
              COALESCE(oi.total_amount, oi.sale_price * oi.quantity, 0) -
              (COALESCE(pv.cost_price, p.cost_price, 0) * COALESCE(oi.quantity, 0))
            ), 0) AS item_profit,
            ${hasInvoiceDiscountAmount ? "COALESCE(o.invoice_discount_amount, 0)" : "0"} AS invoice_discount
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          LEFT JOIN products p ON p.id = oi.product_id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE 1=1
            ${orderDate}
            ${orderBranch}
            AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
            ${personalOrderClause("o")}
            ${orderTenant}
          GROUP BY o.id${hasInvoiceDiscountAmount ? ", o.invoice_discount_amount" : ""}
        )
        SELECT COALESCE(SUM(item_profit - invoice_discount), 0) AS profit
        FROM order_profit
        `,
        orderParams,
        [{}],
        "profit.items"
      )
    : await safeQuery(
        `
        SELECT COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS profit
        FROM orders o
        WHERE 1=1
          ${orderDate}
          ${orderBranch}
          AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
          ${personalOrderClause("o")}
          ${orderTenant}
        `,
        orderParams,
        [{}],
        "profit.orders"
      );

  const expenses = await tableExists("expenses")
    ? await safeQuery(
        `
        SELECT COALESCE(SUM(amount), 0) AS amount
        FROM expenses e
        WHERE e.created_at >= ${daySql}
          ${expenseTenant}
        `,
        expenseParams,
        [{}],
        "profit.expenses"
      )
    : [{}];

  return toNumber(salesRows[0]?.profit) - toNumber(expenses[0]?.amount);
};

export const getSalesTrend = async ({ tenantId = null, days = 14, filters = {} } = {}) => {
  if (!(await tableExists("orders"))) return [];
  const params = [filters.range === "7d" ? 7 : filters.range === "month" ? 31 : Number(days) || 14];
  const ordersTenant = tenantClause("o", tenantId, params);
  const ordersBranch = branchClause("o", filters, params);
  return safeQuery(
    `
    WITH buckets AS (
      SELECT generate_series((CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day')::date, CURRENT_DATE, INTERVAL '1 day')::date AS day
    )
    SELECT
      b.day,
      COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS revenue,
      COUNT(o.id)::int AS orders
    FROM buckets b
    LEFT JOIN orders o ON o.created_at::date = b.day
      AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
      ${personalOrderClause("o")}
      ${ordersTenant.replace("AND o.", "AND o.")}
      ${ordersBranch}
    GROUP BY b.day
    ORDER BY b.day
    `,
    params,
    emptyRows,
    "salesTrend"
  );
};

export const getHourlySales = async ({ tenantId = null, filters = {} } = {}) => {
  if (!(await tableExists("orders"))) return [];
  const params = [];
  const ordersTenant = tenantClause("o", tenantId, params);
  const ordersDate = dateClause("o", filters, params);
  const ordersBranch = branchClause("o", filters, params);
  return safeQuery(
    `
    SELECT
      EXTRACT(HOUR FROM o.created_at)::int AS hour,
      COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS sales,
      COUNT(*)::int AS orders
    FROM orders o
    WHERE 1=1
      ${ordersDate}
      ${ordersBranch}
      AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
      ${personalOrderClause("o")}
      ${ordersTenant}
    GROUP BY hour
    ORDER BY hour
    `,
    params,
    emptyRows,
    "hourlySales"
  );
};

export const getTopProducts = async ({ tenantId = null, limit = 8, filters = {} } = {}) => {
  if (!(await tableExists("orders")) || !(await tableExists("order_items"))) return [];
  const params = [Number(limit) || 8];
  const ordersTenant = tenantClause("o", tenantId, params);
  const ordersDate = dateClause("o", filters, params);
  const ordersBranch = branchClause("o", filters, params);
  return safeQuery(
    `
    SELECT
      COALESCE(NULLIF(oi.product_name, ''), p.name, 'Unknown product') AS name,
      COALESCE(SUM(oi.quantity), 0)::int AS quantity,
      COALESCE(SUM(oi.total_amount), 0) AS revenue,
      COALESCE(MAX(p.product_type), '') AS category
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE 1=1
      ${ordersDate}
      ${ordersBranch}
      AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
      ${personalOrderClause("o")}
      ${ordersTenant}
    GROUP BY COALESCE(NULLIF(oi.product_name, ''), p.name, 'Unknown product')
    ORDER BY quantity DESC, revenue DESC
    LIMIT $1
    `,
    params,
    emptyRows,
    "topProducts"
  );
};

export const getLowStock = async ({ tenantId = null, limit = 12 } = {}) => {
  if (!(await tableExists("products"))) return [];

  const params = [LOW_STOCK_ALERT_MAX];
  const productTenant = tenantClause("p", tenantId, params);
  const hasVariants = await tableExists("product_variants");

  if (!hasVariants) {
    const simpleRows = await safeQuery(
      `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku AS product_sku,
        '' AS color,
        '' AS size,
        GREATEST(COALESCE(p.stock, 0), 0)::int AS stock,
        COALESCE(NULLIF(p.low_stock_alert, 0), $1::int)::int AS threshold,
        COALESCE(
          NULLIF(p.image_url, ''),
          NULLIF(p.image, ''),
          NULLIF(p.photo_url, ''),
          NULLIF(p.thumbnail_url, ''),
          ''
        ) AS image_url,
        NULL::bigint AS variant_id,
        p.image_url AS product_image_url
      FROM products p
      WHERE 1=1
        ${productTenant}
        AND LOWER(COALESCE(p.status, 'active')) = 'active'
        AND GREATEST(COALESCE(p.stock, 0), 0) BETWEEN 1 AND COALESCE(NULLIF(p.low_stock_alert, 0), $1::int)
      ORDER BY p.name ASC
      `,
      params,
      emptyRows,
      "lowStock.simpleOnly"
    );

    return groupLowStockAlerts(simpleRows, { fallbackThreshold: LOW_STOCK_ALERT_MAX, limit: Number(limit) || 12 });
  }

  const rows = await safeQuery(
    `
    WITH candidate_products AS (
      SELECT DISTINCT p.id
      FROM products p
      WHERE 1=1
        ${productTenant}
        AND LOWER(COALESCE(p.status, 'active')) = 'active'
        AND (
          (
            EXISTS (
              SELECT 1
              FROM product_variants pv
              WHERE pv.product_id = p.id
                AND pv.is_active IS DISTINCT FROM FALSE
                AND pv.deleted_at IS NULL
                AND GREATEST(COALESCE(pv.stock, 0), 0) BETWEEN 1 AND COALESCE(NULLIF(pv.low_stock_alert, 0), NULLIF(p.low_stock_alert, 0), $1::int)
            )
          )
          OR (
            NOT EXISTS (
              SELECT 1
              FROM product_variants pv
              WHERE pv.product_id = p.id
                AND pv.is_active IS DISTINCT FROM FALSE
                AND pv.deleted_at IS NULL
            )
            AND GREATEST(COALESCE(p.stock, 0), 0) BETWEEN 1 AND COALESCE(NULLIF(p.low_stock_alert, 0), $1::int)
          )
        )
    ),
    variant_rows AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku AS product_sku,
        COALESCE(NULLIF(TRIM(pv.color), ''), '') AS color,
        COALESCE(NULLIF(TRIM(pv.size), ''), '') AS size,
        GREATEST(COALESCE(pv.stock, 0), 0)::int AS stock,
        COALESCE(NULLIF(pv.low_stock_alert, 0), NULLIF(p.low_stock_alert, 0), $1::int)::int AS threshold,
        COALESCE(
          NULLIF(p.image_url, ''),
          NULLIF(p.image, ''),
          NULLIF(p.photo_url, ''),
          NULLIF(p.thumbnail_url, ''),
          NULLIF(pv.image_url, ''),
          ''
        ) AS image_url,
        pv.id AS variant_id,
        p.image_url AS product_image_url
      FROM candidate_products cp
      JOIN products p ON p.id = cp.id
      JOIN product_variants pv ON pv.product_id = p.id
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
    ),
    simple_rows AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku AS product_sku,
        '' AS color,
        '' AS size,
        GREATEST(COALESCE(p.stock, 0), 0)::int AS stock,
        COALESCE(NULLIF(p.low_stock_alert, 0), $1::int)::int AS threshold,
        COALESCE(
          NULLIF(p.image_url, ''),
          NULLIF(p.image, ''),
          NULLIF(p.photo_url, ''),
          NULLIF(p.thumbnail_url, ''),
          ''
        ) AS image_url,
        NULL::bigint AS variant_id,
        p.image_url AS product_image_url
      FROM candidate_products cp
      JOIN products p ON p.id = cp.id
      WHERE NOT EXISTS (
        SELECT 1
        FROM product_variants pv
        WHERE pv.product_id = p.id
          AND pv.is_active IS DISTINCT FROM FALSE
          AND pv.deleted_at IS NULL
      )
    )
    SELECT * FROM variant_rows
    UNION ALL
    SELECT * FROM simple_rows
    ORDER BY product_name ASC, color ASC, size ASC
    `,
    params,
    emptyRows,
    hasVariants ? "lowStock.raw" : "lowStock.simple"
  );

  return groupLowStockAlerts(rows, { fallbackThreshold: LOW_STOCK_ALERT_MAX, limit: Number(limit) || 12 });
};

export const getLiveActivity = async ({ tenantId = null, limit = 30 } = {}) => {
  const parts = [];
  const params = [];
  const max = Number(limit) || 30;
  if (await tableExists("orders")) {
    const clause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
    parts.push(`
      SELECT 'order' AS type, invoice_number AS title, COALESCE(total_amount, total, 0) AS amount, status, created_at
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '7 days' ${clause}
    `);
  }
  if (await tableExists("returns")) {
    const clause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
    parts.push(`
      SELECT 'refund' AS type, return_number AS title, refund_amount AS amount, status, created_at
      FROM returns
      WHERE created_at >= NOW() - INTERVAL '7 days' ${clause}
    `);
  }
  if (await tableExists("inventory_movements")) {
    const clause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
    parts.push(`
      SELECT 'inventory' AS type, movement_type AS title, quantity_change AS amount, reference_type AS status, created_at
      FROM inventory_movements
      WHERE created_at >= NOW() - INTERVAL '7 days' ${clause}
    `);
  }
  if (await tableExists("customers")) {
    const clause = tenantId === null ? "" : `AND tenant_id = $${params.push(tenantId)}`;
    parts.push(`
      SELECT 'customer' AS type, name AS title, 0 AS amount, status, created_at
      FROM customers
      WHERE created_at >= NOW() - INTERVAL '7 days' ${clause}
    `);
  }
  if (!parts.length) return [];
  return safeQuery(`SELECT * FROM (${parts.join(" UNION ALL ")}) activity ORDER BY created_at DESC LIMIT ${max}`, params, emptyRows, "liveActivity");
};

export const getBranchPerformance = async ({ tenantId = null, filters = {} } = {}) => {
  if (!(await tableExists("orders"))) return [];
  const params = [];
  const ordersTenant = tenantClause("o", tenantId, params);
  const ordersDate = dateClause("o", filters, params);
  return safeQuery(
    `
    SELECT
      COALESCE(b.name, 'Default branch') AS branch,
      COUNT(o.id)::int AS orders,
      COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS sales
    FROM orders o
    LEFT JOIN branches b ON b.id = o.branch_id
    WHERE 1=1
      ${ordersDate}
      AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
      ${personalOrderClause("o")}
      ${ordersTenant}
    GROUP BY COALESCE(b.name, 'Default branch')
    ORDER BY sales DESC
    `,
    params,
    emptyRows,
    "branchPerformance"
  );
};

export const getPaymentAnalytics = async ({ tenantId = null, filters = {} } = {}) => {
  if (!(await tableExists("orders"))) return [];
  const hasPayment = await columnExists("orders", "payment_method");
  const params = [];
  const ordersTenant = tenantClause("o", tenantId, params);
  const ordersDate = dateClause("o", filters, params);
  const ordersBranch = branchClause("o", filters, params);
  return safeQuery(
    `
    SELECT
      ${hasPayment ? "COALESCE(o.payment_method, 'unknown')" : "'unknown'"} AS method,
      COUNT(*)::int AS orders,
      COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS amount
    FROM orders o
    WHERE 1=1
      ${ordersDate}
      ${ordersBranch}
      AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
      ${personalOrderClause("o")}
      ${ordersTenant}
    GROUP BY method
    ORDER BY amount DESC
    `,
    params,
    emptyRows,
    "paymentAnalytics"
  );
};

export const getMarketingAnalytics = async ({ tenantId = null, filters = {} } = {}) => {
  if (!(await tableExists("orders"))) return { channels: [], attributedSales: 0 };
  const hasSource = await columnExists("orders", "marketing_source");
  if (!hasSource) return { channels: [], attributedSales: 0 };
  const params = [];
  const ordersTenant = tenantClause("o", tenantId, params);
  const ordersDate = dateClause("o", filters, params);
  const ordersBranch = branchClause("o", filters, params);
  const rows = await safeQuery(
    `
    SELECT
      COALESCE(NULLIF(o.marketing_source, ''), 'direct') AS source,
      COUNT(*)::int AS orders,
      COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS sales
    FROM orders o
    WHERE 1=1
      ${ordersDate}
      ${ordersBranch}
      ${ordersTenant}
      ${personalOrderClause("o")}
    GROUP BY source
    ORDER BY sales DESC
    `,
    params,
    emptyRows,
    "marketing"
  );
  return { channels: rows, attributedSales: rows.filter((row) => row.source !== "direct").reduce((sum, row) => sum + toNumber(row.sales), 0) };
};

export const getPosLive = async ({ tenantId = null } = {}) => {
  const cashboxParams = [];
  const cashboxTenant = tenantClause("c", tenantId, cashboxParams);
  const orderParams = [];
  const orderTenant = tenantClause("o", tenantId, orderParams);
  const [sessions, lastInvoice, hourly, payment] = await Promise.all([
    tableExists("cashbox")
      ? safeQuery(
          `
          SELECT c.id, c.name, c.status, c.opened_at, u.name AS cashier
          FROM cashbox c
          LEFT JOIN users u ON u.id = c.opened_by
          WHERE LOWER(COALESCE(c.status, '')) = 'open'
            ${cashboxTenant}
          ORDER BY c.opened_at DESC NULLS LAST
          `,
          cashboxParams,
          emptyRows,
          "posLive.sessions"
        )
      : [],
    tableExists("orders")
      ? safeQuery(
          `
          SELECT o.id, o.invoice_number, o.created_at, COALESCE(o.total_amount, o.total, 0) AS total, o.payment_status
          FROM orders o
          WHERE 1=1 ${orderTenant}
          ${personalOrderClause("o")}
          ORDER BY o.created_at DESC
          LIMIT 1
          `,
          orderParams,
          [{}],
          "posLive.lastInvoice"
        )
      : [{}],
    getHourlySales({ tenantId }),
    getPaymentAnalytics({ tenantId }),
  ]);
  return {
    activeCashiers: sessions.length,
    openShifts: sessions,
    currentCartCounts: 0,
    lastInvoice: lastInvoice[0] || null,
    averageCheckoutTimeSeconds: 0,
    paymentDistribution: payment,
    liveSalesStream: hourly.slice(-6),
  };
};

export const getInventoryIntelligence = async ({ tenantId = null } = {}) => {
  const [lowStock, topProducts] = await Promise.all([getLowStock({ tenantId }), getTopProducts({ tenantId })]);
  const params = [];
  const ordersTenant = tenantClause("o", tenantId, params);
  const sizeColorRows = (await tableExists("order_items"))
    ? await safeQuery(
        `
        SELECT
          COALESCE(pv.size, split_part(oi.variant_name, ' / ', 2), '') AS size,
          COALESCE(pv.color, split_part(oi.variant_name, ' / ', 1), '') AS color,
          COALESCE(SUM(oi.quantity), 0)::int AS quantity
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days'
          ${ordersTenant}
        GROUP BY pv.size, pv.color, oi.variant_name
        ORDER BY quantity DESC
        LIMIT 10
        `,
        params,
        emptyRows,
        "inventory.sizeColor"
      )
    : [];
  const hasStockTransfers = await tableExists("stock_transfers");
  const hasStockTransferStatus = hasStockTransfers ? await columnExists("stock_transfers", "status") : false;
  const pendingTransfers = hasStockTransfers
    ? hasStockTransferStatus
      ? await safeQuery("SELECT COUNT(*)::int AS count FROM stock_transfers WHERE LOWER(COALESCE(status, '')) IN ('pending', 'draft', 'in_transit')", [], [{ count: 0 }], "inventory.pendingTransfers")
      : [{ count: 0 }]
    : [{ count: 0 }];
  return {
    lowStock,
    fastMovingProducts: topProducts,
    deadStock: [],
    topSizes: sizeColorRows.filter((row) => row.size).slice(0, 5),
    topColors: sizeColorRows.filter((row) => row.color).slice(0, 5),
    warehouseAlerts: lowStock.slice(0, 5),
    pendingTransfers: toNumber(pendingTransfers[0]?.count),
  };
};

export const getAiInsights = async ({ tenantId = null } = {}) => {
  const [topProducts, inventory, branches, hourly] = await Promise.all([
    getTopProducts({ tenantId, limit: 3 }),
    getInventoryIntelligence({ tenantId }),
    getBranchPerformance({ tenantId }),
    getHourlySales({ tenantId }),
  ]);
  const insights = [];
  if (topProducts[0]) insights.push({ type: "sales", title: "Best seller", body: `${topProducts[0].name} leads with ${topProducts[0].quantity} units sold in the last 30 days.` });
  if (inventory.lowStock[0]) insights.push({ type: "inventory", title: "Reorder needed", body: `${inventory.lowStock[0].name} is at ${inventory.lowStock[0].stock} units.` });
  if (branches[0]) insights.push({ type: "branch", title: "Top branch", body: `${branches[0].branch} is the highest performing branch by sales.` });
  if (hourly[0]) {
    const peak = [...hourly].sort((a, b) => toNumber(b.sales) - toNumber(a.sales))[0];
    if (peak) insights.push({ type: "timing", title: "Busiest hour", body: `${String(peak.hour).padStart(2, "0")}:00 is currently the busiest sales hour.` });
  }
  return insights;
};

export const getRecentInvoices = async ({ tenantId = null, limit = 8, todayOnly = false } = {}) => {
  if (!(await tableExists("orders"))) return [];
  const params = [Number(limit) || 8];
  const ordersTenant = tenantClause("o", tenantId, params);
  return safeQuery(
    `
    SELECT o.id, o.invoice_number, o.customer_name, COALESCE(o.total_amount, o.total, 0) AS total, o.payment_status, o.created_at
    FROM orders o
    WHERE 1=1 ${ordersTenant}
      ${todayOnly ? `AND o.created_at >= ${daySql}` : ""}
      ${personalOrderClause("o")}
    ORDER BY o.created_at DESC
    LIMIT $1
    `,
    params,
    emptyRows,
    "recentInvoices"
  );
};
