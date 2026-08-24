/**
 * Sales & Profit Intelligence — R3.
 *
 * Four endpoints, all built on the R1 canon and the R2 patterns:
 *   summary    KPIs + trend + deterministic highlights
 *   breakdown  one dimension at a time (product_type | brand | category)
 *   products   product matrix + rankings + paginated table, from ONE query
 *   sizes      size-level intelligence, scoped to one product_type
 *
 * Rules carried forward:
 *   - permission masking happens here; ungranted columns never enter the SQL
 *   - a failing query throws, it never becomes a zero
 *   - dimensions and sorts come from hardcoded allowlists, never from the request
 *   - every number traces to docs/analytics/metric-contract.md v1.0.0
 */

import db from "../../database/db.js";
import { coalesceColumnExpr, whereSql } from "./accountingCanon.js";
import { orderFilterClauses } from "./analyticsOrderFilters.js";
import {
  COGS_COVERAGE_CRITICAL_THRESHOLD,
  WARNING_CODES,
  WarningCollector,
  applyCogsCoveragePolicy,
  buildDelta,
  safeRatio,
  toMoney,
} from "./analyticsComparison.js";
import {
  CONTRACT_VERSION,
  buildCostContext,
  canonicalOrderClauses,
  categoryNameExpr,
  discountAmountExpr,
  grossSalesExpr,
  lineNetSalesExpr,
  nanSafe,
  orderRevenueExpr,
  productTypeExpr,
  variantStockExpr,
} from "./analyticsMetrics.js";
import { resolveGranularity } from "./analyticsFilters.js";

const TABLE_COLUMN_CACHE = new Map();

const getTableColumns = async (client, table) => {
  if (TABLE_COLUMN_CACHE.has(table)) return TABLE_COLUMN_CACHE.get(table);
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  TABLE_COLUMN_CACHE.set(table, columns);
  return columns;
};

export const __clearSalesColumnCache = () => TABLE_COLUMN_CACHE.clear();

/* -------------------------------------------------------------- allowlists */

/**
 * Breakdown dimensions available in R3.
 *
 * product_type is the default because production evidence says it is populated on
 * 100% of products, while the category ladder leaves ~76% of revenue uncategorised.
 */
export const SALES_DIMENSIONS = Object.freeze({
  product_type: { label: "product_type", expr: () => `COALESCE(${productTypeExpr()}, 'غير محدد')`, join: "" },
  brand: { label: "brand", expr: () => "COALESCE(NULLIF(TRIM(br.name), ''), 'بدون علامة')", join: "LEFT JOIN brands br ON br.id = p.brand_id" },
  category: { label: "category", expr: () => `COALESCE(${categoryNameExpr()}, 'غير مصنف')`, join: "LEFT JOIN categories cat ON cat.id = p.category_id" },
});

export const DEFAULT_SALES_DIMENSION = "product_type";

/** Sort keys map to fixed SQL. Nothing from the request is ever interpolated. */
export const SALES_SORTS = Object.freeze({
  net_sales: "net_sales",
  units: "units",
  gross_profit: "gross_profit",
  margin: "margin",
  growth: "growth",
  discount_rate: "discount_rate",
  product: "product_name",
});

export const DEFAULT_SALES_SORT = "net_sales";

/** Sizes that mean "this product has no size", not an actual size. */
export const NON_SIZE_VALUES = Object.freeze(["one size", "onesize", "مقاس واحد", "مقاس موحد", "free size", "-", "n/a"]);

/** Product types whose variants are colour-only, so size analysis is meaningless. */
export const NON_SIZED_VARIATION_MODES = Object.freeze(["color_only", "simple"]);

/* ------------------------------------------------------------ shared scope */

/**
 * Builds the order/line scope shared by every R3 query: tenant, widest date window
 * covering both comparison periods, the canonical predicate, and the product-attribute
 * filters. Returns the bound parameter list plus SQL fragments.
 */
const buildScope = ({ filters, columns }) => {
  const { orderColumns, itemColumns, productColumns, variantColumns, overrideColumns, purchaseColumns, purchaseItemColumns } = columns;
  const { tenantId, from, to, comparison, branchId } = filters;

  const params = [];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (tenantId !== null) bind(tenantId);

  const currentFrom = bind(from);
  const currentTo = bind(to);
  const previousFrom = comparison ? bind(comparison.from) : null;
  const previousTo = comparison ? bind(comparison.to) : null;

  const orderClauses = [];
  if (tenantId !== null && orderColumns.has("tenant_id")) orderClauses.push("o.tenant_id = $1");
  // Every order filter, from the one shared builder in analyticsOrderFilters.js. These
  // used to be applied service by service and had drifted badly: branchId was honoured at
  // eleven sites, channel at two, customerId at one, paymentMethod at none — while every
  // one of them came back in the response envelope as though it had been applied.
  orderClauses.push(...orderFilterClauses({ filters, orderColumns, bind }).clauses);
  orderClauses.push(...canonicalOrderClauses(orderColumns).clauses);

  const widestFrom = comparison && comparison.from < from ? previousFrom : currentFrom;
  const widestTo = comparison && comparison.to > to ? previousTo : currentTo;
  orderClauses.push(`o.created_at >= ${widestFrom}::date AND o.created_at < (${widestTo}::date + INTERVAL '1 day')`);

  const costContext = buildCostContext({
    orderColumns, itemColumns, productColumns, variantColumns,
    overrideColumns, purchaseColumns, purchaseItemColumns, tenantId,
  });

  // Product-attribute filters live on the line CTE, not the order scan.
  const lineClauses = [];
  if (filters.productType) lineClauses.push(`LOWER(TRIM(COALESCE(p.product_type,''))) = LOWER(${bind(filters.productType)})`);
  if (filters.brandId && productColumns.has("brand_id")) lineClauses.push(`p.brand_id = ${bind(filters.brandId)}`);
  if (filters.productId) lineClauses.push(`p.id = ${bind(filters.productId)}`);
  if (filters.gender && productColumns.has("gender")) lineClauses.push(`LOWER(TRIM(COALESCE(p.gender,''))) = LOWER(${bind(filters.gender)})`);
  if (filters.category) {
    lineClauses.push(
      filters.category === "__uncategorised__"
        ? `${categoryNameExpr()} IS NULL`
        : `${categoryNameExpr()} = ${bind(filters.category)}`
    );
  }
  if (tenantId !== null && itemColumns.has("tenant_id")) lineClauses.push("oi.tenant_id = $1");

  return {
    params,
    bind,
    costContext,
    currentFrom, currentTo, previousFrom, previousTo,
    inCurrent: `o.created_at >= ${currentFrom}::date AND o.created_at < (${currentTo}::date + INTERVAL '1 day')`,
    inPrevious: previousFrom ? `o.created_at >= ${previousFrom}::date AND o.created_at < (${previousTo}::date + INTERVAL '1 day')` : "FALSE",
    orderWhere: whereSql(orderClauses),
    lineWhere: lineClauses.length ? `WHERE ${lineClauses.join(" AND ")}` : "",
    // The category ladder reads cat.name, so filtering by category requires the join
    // in EVERY query that applies lineWhere, not just the category breakdown.
    filterJoins: filters.category ? "LEFT JOIN categories cat ON cat.id = p.category_id" : "",
    categoriesJoin: "LEFT JOIN categories cat ON cat.id = p.category_id",
  };
};

/**
 * The line-level CTE every product/dimension query starts from. One place where the
 * cost joins, net quantity and line revenue are defined.
 */
const linesCte = ({ scope, itemColumns, includeCost, extraJoins = "" }) => {
  const netQty = scope.costContext.netQuantityExpr;
  const lineNet = lineNetSalesExpr(itemColumns);
  const itemDiscount = itemColumns.has("discount_amount") ? "COALESCE(oi.discount_amount, 0)" : "0";

  return `
    scoped_orders AS (
      SELECT o.id, (${scope.inCurrent}) AS in_current, (${scope.inPrevious}) AS in_previous
      FROM orders o
      ${scope.orderWhere}
    ),
    lines AS (
      SELECT
        so.in_current, so.in_previous,
        p.id                       AS product_id,
        COALESCE(NULLIF(TRIM(p.name),''), NULLIF(TRIM(oi.product_name),''), 'غير معروف') AS product_name,
        pv.id                      AS variant_id,
        ${nanSafe(lineNet)}        AS line_net,
        ${netQty}                  AS net_qty,
        ${nanSafe(itemDiscount)}   AS line_discount,
        COALESCE(oi.returned_quantity, 0) AS returned_qty,
        oi.order_id
        ${includeCost ? `, (${netQty}) * GREATEST(${scope.costContext.unitCostExpr}, 0) AS line_cogs,
        CASE WHEN GREATEST(${scope.costContext.unitCostExpr}, 0) > 0 THEN (${netQty}) ELSE 0 END AS costed_qty` : ""}
      FROM order_items oi
      JOIN scoped_orders so ON so.id = oi.order_id
      JOIN orders o ON o.id = oi.order_id
      ${scope.costContext.joins}
      ${extraJoins}
      ${scope.filterJoins}
      ${scope.lineWhere}
    )`;
};

/* ------------------------------------------------------------------ queries */

/**
 * Per-bucket line metrics need the bucket on the line, not a correlated lookup.
 * Kept as its own simple query so the summary SQL stays readable.
 */
const buildTrendQuery = ({ scope, itemColumns, includeCost, granularity }) => {
  const bucketExpr = {
    hour: "date_trunc('hour', o.created_at)",
    day: "date_trunc('day', o.created_at)",
    week: "date_trunc('week', o.created_at)",
    month: "date_trunc('month', o.created_at)",
  }[granularity] || "date_trunc('day', o.created_at)";

  const netQty = scope.costContext.netQuantityExpr;
  const lineNet = lineNetSalesExpr(itemColumns);

  return `
    SELECT ${bucketExpr} AS bucket,
           COUNT(DISTINCT o.id)::int AS orders,
           COALESCE(SUM(${nanSafe(lineNet)}), 0) AS line_net,
           COALESCE(SUM(${netQty}), 0)           AS units
           ${includeCost ? `,
           COALESCE(SUM((${netQty}) * GREATEST(${scope.costContext.unitCostExpr}, 0)), 0) AS cogs,
           COALESCE(SUM(CASE WHEN GREATEST(${scope.costContext.unitCostExpr},0) > 0 THEN (${netQty}) ELSE 0 END), 0) AS costed_units` : ""}
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    ${scope.costContext.joins}
    ${scope.filterJoins}
    ${scope.orderWhere}
      AND ${scope.inCurrent}
      ${scope.lineWhere ? scope.lineWhere.replace(/^WHERE/, "AND") : ""}
    GROUP BY ${bucketExpr}
    ORDER BY ${bucketExpr}`;
};

/**
 * Lean product aggregate used only to feed the deterministic highlight rules
 * (surging / declining / profit concentration). No stock join, no image, capped —
 * the full product query lives behind /sales/products.
 */
const buildMoversQuery = ({ scope, itemColumns, includeCost }) => `
  WITH scoped_orders AS (
    SELECT o.id, (${scope.inCurrent}) AS in_current, (${scope.inPrevious}) AS in_previous
    FROM orders o ${scope.orderWhere}
  ),
  lines AS (
    SELECT so.in_current, so.in_previous,
           COALESCE(p.id, pv.product_id) AS product_id,
           COALESCE(NULLIF(TRIM(p.name),''), NULLIF(TRIM(oi.product_name),''), 'غير معروف') AS product_name,
           ${nanSafe(lineNetSalesExpr(itemColumns))} AS line_net
           ${includeCost ? `, (${scope.costContext.netQuantityExpr}) * GREATEST(${scope.costContext.unitCostExpr}, 0) AS line_cogs,
           ${scope.costContext.netQuantityExpr} AS net_qty,
           CASE WHEN GREATEST(${scope.costContext.unitCostExpr},0) > 0 THEN (${scope.costContext.netQuantityExpr}) ELSE 0 END AS costed_qty` : ""}
    FROM order_items oi
    JOIN scoped_orders so ON so.id = oi.order_id
    JOIN orders o ON o.id = oi.order_id
    ${scope.costContext.joins}
    ${scope.filterJoins}
    ${scope.lineWhere}
  )
  SELECT product_id,
         MAX(product_name) AS product_name,
         COALESCE(SUM(line_net) FILTER (WHERE in_current),0)  AS net_sales,
         COALESCE(SUM(line_net) FILTER (WHERE in_previous),0) AS net_sales_previous
         ${includeCost ? `,
         COALESCE(SUM(line_cogs) FILTER (WHERE in_current),0)  AS cogs,
         COALESCE(SUM(net_qty) FILTER (WHERE in_current),0)    AS units,
         COALESCE(SUM(costed_qty) FILTER (WHERE in_current),0) AS costed_units` : ""}
  FROM lines
  WHERE product_id IS NOT NULL AND (in_current OR in_previous)
  GROUP BY product_id
  ORDER BY net_sales DESC
  LIMIT 150`;

/**
 * Canonical returns, identical to the Executive Overview: refund value from
 * return_items, scoped by returns.created_at (a return lands in the period it was
 * processed). Net sales is not net sales without this deduction — R2 and R3 must agree.
 */
const buildReturnsQuery = ({ scope, returnItemColumns, orderColumns, tenantScoped }) => {
  const refundExpr = coalesceColumnExpr("ri", returnItemColumns, ["refund_amount", "total", "total_amount"], "0");
  const tenantClause = tenantScoped ? "r.tenant_id = $1 AND" : "";
  return `
    SELECT
      COALESCE(SUM(${nanSafe(refundExpr)}) FILTER (
        WHERE r.created_at >= ${scope.currentFrom}::date AND r.created_at < (${scope.currentTo}::date + INTERVAL '1 day')), 0) AS returns_current,
      COALESCE(SUM(${nanSafe(refundExpr)}) FILTER (
        WHERE ${scope.previousFrom ? `r.created_at >= ${scope.previousFrom}::date AND r.created_at < (${scope.previousTo}::date + INTERVAL '1 day')` : "FALSE"}), 0) AS returns_previous
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    JOIN orders o ON o.id = r.order_id
    WHERE ${tenantClause}
      LOWER(COALESCE(r.status, '')) NOT IN ('cancelled','canceled','rejected','void','deleted')
      -- D-21: only deduct a refund whose sale is still in the counted set. A fully
      -- returned order has its status flipped and has already left every window, so
      -- deducting its refund as well reverses it twice.
      AND ${canonicalOrderClauses(orderColumns).clauses.join(" AND ")}`;
};

const buildOrderTotalsQuery = ({ scope, orderColumns }) => {
  const revenue = nanSafe(orderRevenueExpr(orderColumns));
  const gross = nanSafe(grossSalesExpr(orderColumns));
  const discount = nanSafe(discountAmountExpr(orderColumns));
  return `
    SELECT COUNT(*) FILTER (WHERE ${scope.inCurrent})::int  AS orders_current,
           COUNT(*) FILTER (WHERE ${scope.inPrevious})::int AS orders_previous,
           COALESCE(SUM(${revenue}) FILTER (WHERE ${scope.inCurrent}),0)   AS revenue_current,
           COALESCE(SUM(${revenue}) FILTER (WHERE ${scope.inPrevious}),0)  AS revenue_previous,
           COALESCE(SUM(${gross}) FILTER (WHERE ${scope.inCurrent}),0)     AS gross_current,
           COALESCE(SUM(${gross}) FILTER (WHERE ${scope.inPrevious}),0)    AS gross_previous,
           COALESCE(SUM(${discount}) FILTER (WHERE ${scope.inCurrent}),0)  AS discount_current,
           COALESCE(SUM(${discount}) FILTER (WHERE ${scope.inPrevious}),0) AS discount_previous
    FROM orders o
    ${scope.orderWhere}`;
};

const buildLineTotalsQuery = ({ scope, itemColumns, includeCost }) => `
  WITH ${linesCte({ scope, itemColumns, includeCost })}
  SELECT COUNT(DISTINCT order_id) FILTER (WHERE in_current)::int  AS line_orders_current,
         COUNT(DISTINCT order_id) FILTER (WHERE in_previous)::int AS line_orders_previous,
         COALESCE(SUM(line_net) FILTER (WHERE in_previous),0)     AS line_net_previous,
         COALESCE(SUM(net_qty) FILTER (WHERE in_current),0)      AS units_current,
         COALESCE(SUM(net_qty) FILTER (WHERE in_previous),0)     AS units_previous,
         COALESCE(SUM(line_net) FILTER (WHERE in_current),0)     AS line_net_current,
         COALESCE(SUM(line_discount) FILTER (WHERE in_current),0) AS item_discount_current,
         COALESCE(SUM(returned_qty) FILTER (WHERE in_current),0) AS returned_units_current
         ${includeCost ? `,
         COALESCE(SUM(line_cogs) FILTER (WHERE in_current),0)    AS cogs_current,
         COALESCE(SUM(line_cogs) FILTER (WHERE in_previous),0)   AS cogs_previous,
         COALESCE(SUM(costed_qty) FILTER (WHERE in_current),0)   AS costed_units_current,
         COALESCE(SUM(costed_qty) FILTER (WHERE in_previous),0)  AS costed_units_previous` : ""}
  FROM lines`;

const buildBreakdownQuery = ({ scope, itemColumns, includeCost, dimension }) => {
  const spec = SALES_DIMENSIONS[dimension] || SALES_DIMENSIONS[DEFAULT_SALES_DIMENSION];
  const dimExpr = spec.expr();
  const extraJoins = [spec.join, dimension === "category" ? "" : ""].filter(Boolean).join("\n");

  return `
    WITH scoped_orders AS (
      SELECT o.id, (${scope.inCurrent}) AS in_current, (${scope.inPrevious}) AS in_previous
      FROM orders o ${scope.orderWhere}
    ),
    lines AS (
      SELECT so.in_current, so.in_previous,
             ${dimExpr} AS dim,
             ${nanSafe(lineNetSalesExpr(itemColumns))} AS line_net,
             ${scope.costContext.netQuantityExpr}      AS net_qty,
             oi.order_id
             ${includeCost ? `, (${scope.costContext.netQuantityExpr}) * GREATEST(${scope.costContext.unitCostExpr}, 0) AS line_cogs,
             CASE WHEN GREATEST(${scope.costContext.unitCostExpr},0) > 0 THEN (${scope.costContext.netQuantityExpr}) ELSE 0 END AS costed_qty` : ""}
      FROM order_items oi
      JOIN scoped_orders so ON so.id = oi.order_id
      JOIN orders o ON o.id = oi.order_id
      ${scope.costContext.joins}
      ${extraJoins}
      ${dimension === "category" ? "" : scope.filterJoins}
      ${scope.lineWhere}
    )
    SELECT dim,
           COALESCE(SUM(line_net) FILTER (WHERE in_current),0)  AS net_sales,
           COALESCE(SUM(line_net) FILTER (WHERE in_previous),0) AS net_sales_previous,
           COALESCE(SUM(net_qty)  FILTER (WHERE in_current),0)  AS units,
           COALESCE(SUM(net_qty)  FILTER (WHERE in_previous),0) AS units_previous,
           COUNT(DISTINCT order_id) FILTER (WHERE in_current)::int AS orders
           ${includeCost ? `,
           COALESCE(SUM(line_cogs) FILTER (WHERE in_current),0)  AS cogs,
           COALESCE(SUM(costed_qty) FILTER (WHERE in_current),0) AS costed_units` : ""}
    FROM lines
    WHERE in_current OR in_previous
    GROUP BY dim
    ORDER BY net_sales DESC`;
};

/**
 * One product-level query serving the matrix, the rankings and the table.
 * Capped at MATRIX_LIMIT rows by net sales; truncation is reported, never silent.
 */
export const MATRIX_LIMIT = 300;

const buildProductsQuery = ({ scope, itemColumns, includeCost, variantColumns }) => {
  const stockJoin = variantColumns.has("stock")
    ? `LEFT JOIN (
         SELECT product_id, SUM(${variantStockExpr({ variantColumns, alias: "v" })}) AS stock
         FROM product_variants v
         WHERE ${variantColumns.has("deleted_at") ? "v.deleted_at IS NULL AND" : ""} COALESCE(v.is_active, TRUE)
         GROUP BY product_id
       ) stk ON stk.product_id = agg.product_id`
    : "";

  return `
    WITH scoped_orders AS (
      SELECT o.id, (${scope.inCurrent}) AS in_current, (${scope.inPrevious}) AS in_previous
      FROM orders o ${scope.orderWhere}
    ),
    lines AS (
      SELECT so.in_current, so.in_previous,
             COALESCE(p.id, pv.product_id) AS product_id,
             COALESCE(NULLIF(TRIM(p.name),''), NULLIF(TRIM(oi.product_name),''), 'غير معروف') AS product_name,
             COALESCE(${productTypeExpr()}, 'غير محدد') AS product_type,
             COALESCE(NULLIF(TRIM(br.name),''), 'بدون علامة') AS brand,
             ${nanSafe(lineNetSalesExpr(itemColumns))} AS line_net,
             ${scope.costContext.netQuantityExpr}      AS net_qty,
             ${itemColumns.has("discount_amount") ? "COALESCE(oi.discount_amount,0)" : "0"} AS line_discount,
             COALESCE(oi.returned_quantity,0) AS returned_qty,
             oi.order_id
             ${includeCost ? `, (${scope.costContext.netQuantityExpr}) * GREATEST(${scope.costContext.unitCostExpr}, 0) AS line_cogs,
             CASE WHEN GREATEST(${scope.costContext.unitCostExpr},0) > 0 THEN (${scope.costContext.netQuantityExpr}) ELSE 0 END AS costed_qty` : ""}
      FROM order_items oi
      JOIN scoped_orders so ON so.id = oi.order_id
      JOIN orders o ON o.id = oi.order_id
      ${scope.costContext.joins}
      LEFT JOIN brands br ON br.id = p.brand_id
      ${scope.filterJoins}
      ${scope.lineWhere}
    ),
    agg AS (
      SELECT product_id,
             MAX(product_name) AS product_name,
             MAX(product_type) AS product_type,
             MAX(brand)        AS brand,
             COALESCE(SUM(line_net) FILTER (WHERE in_current),0)   AS net_sales,
             COALESCE(SUM(line_net) FILTER (WHERE in_previous),0)  AS net_sales_previous,
             COALESCE(SUM(net_qty)  FILTER (WHERE in_current),0)   AS units,
             COALESCE(SUM(net_qty)  FILTER (WHERE in_previous),0)  AS units_previous,
             COALESCE(SUM(line_discount) FILTER (WHERE in_current),0) AS discount,
             COALESCE(SUM(returned_qty)  FILTER (WHERE in_current),0) AS returned_units,
             COUNT(DISTINCT order_id) FILTER (WHERE in_current)::int  AS orders
             ${includeCost ? `,
             COALESCE(SUM(line_cogs) FILTER (WHERE in_current),0)  AS cogs,
             COALESCE(SUM(costed_qty) FILTER (WHERE in_current),0) AS costed_units` : ""}
      FROM lines
      WHERE product_id IS NOT NULL AND (in_current OR in_previous)
      GROUP BY product_id
    )
    SELECT agg.*,
           ${variantColumns.has("stock") ? "COALESCE(stk.stock, 0)" : "NULL::numeric"} AS current_stock,
           ${"COALESCE(pr.image_url, '')"} AS image_url
    FROM agg
    ${stockJoin}
    LEFT JOIN products pr ON pr.id = agg.product_id
    ORDER BY agg.net_sales DESC
    LIMIT ${MATRIX_LIMIT}`;
};

const buildSizesQuery = ({ scope, itemColumns, includeCost }) => {
  const nonSize = NON_SIZE_VALUES.map((value) => `'${value}'`).join(", ");
  const sizeExpr = "COALESCE(NULLIF(TRIM(oi.size), ''), NULLIF(TRIM(pv.size), ''))";

  return `
    WITH scoped_orders AS (
      SELECT o.id, (${scope.inCurrent}) AS in_current, (${scope.inPrevious}) AS in_previous
      FROM orders o ${scope.orderWhere}
    ),
    sold AS (
      SELECT ${sizeExpr} AS size,
             so.in_current, so.in_previous,
             ${nanSafe(lineNetSalesExpr(itemColumns))} AS line_net,
             ${scope.costContext.netQuantityExpr}      AS net_qty
             ${includeCost ? `, (${scope.costContext.netQuantityExpr}) * GREATEST(${scope.costContext.unitCostExpr}, 0) AS line_cogs` : ""}
      FROM order_items oi
      JOIN scoped_orders so ON so.id = oi.order_id
      JOIN orders o ON o.id = oi.order_id
      ${scope.costContext.joins}
      ${scope.filterJoins}
      ${scope.lineWhere}
    ),
    sold_agg AS (
      SELECT size,
             COALESCE(SUM(net_qty) FILTER (WHERE in_current),0)  AS units,
             COALESCE(SUM(net_qty) FILTER (WHERE in_previous),0) AS units_previous,
             COALESCE(SUM(line_net) FILTER (WHERE in_current),0) AS net_sales
             ${includeCost ? `, COALESCE(SUM(line_cogs) FILTER (WHERE in_current),0) AS cogs` : ""}
      FROM sold
      WHERE size IS NOT NULL AND LOWER(size) NOT IN (${nonSize})
      GROUP BY size
    ),
    stock_agg AS (
      SELECT NULLIF(TRIM(pv.size),'') AS size, SUM(COALESCE(pv.stock,0)) AS stock
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE ${scope.params.length && scope.orderWhere.includes("$1") ? "pv.tenant_id = $1 AND" : ""}
            pv.deleted_at IS NULL AND COALESCE(pv.is_active, TRUE)
            AND NULLIF(TRIM(pv.size),'') IS NOT NULL
            AND LOWER(TRIM(pv.size)) NOT IN (${nonSize})
            AND LOWER(TRIM(COALESCE(p.variation_mode,''))) NOT IN (${NON_SIZED_VARIATION_MODES.map((v) => `'${v}'`).join(", ")})
            ${scope.sizeProductFilter || ""}
      GROUP BY 1
    )
    SELECT COALESCE(sold_agg.size, stock_agg.size) AS size,
           COALESCE(sold_agg.units, 0)          AS units,
           COALESCE(sold_agg.units_previous, 0) AS units_previous,
           COALESCE(sold_agg.net_sales, 0)      AS net_sales,
           ${includeCost ? "COALESCE(sold_agg.cogs, 0)" : "NULL::numeric"} AS cogs,
           COALESCE(stock_agg.stock, 0)         AS current_stock
    FROM sold_agg FULL OUTER JOIN stock_agg ON stock_agg.size = sold_agg.size
    ORDER BY units DESC, net_sales DESC`;
};

/* ------------------------------------------------------------- orchestration */

const loadColumns = async (client) => {
  const [orderColumns, itemColumns, productColumns, variantColumns, overrideColumns, purchaseColumns, purchaseItemColumns, returnItemColumns] =
    await Promise.all([
      getTableColumns(client, "orders"),
      getTableColumns(client, "order_items"),
      getTableColumns(client, "products"),
      getTableColumns(client, "product_variants"),
      getTableColumns(client, "accounting_order_item_cost_overrides"),
      getTableColumns(client, "purchases"),
      getTableColumns(client, "purchase_items"),
      getTableColumns(client, "return_items"),
    ]);
  return { orderColumns, itemColumns, productColumns, variantColumns, overrideColumns, purchaseColumns, purchaseItemColumns, returnItemColumns };
};

const num = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * Bind only the parameters a statement actually uses, renumbered densely.
 *
 * These queries share one parameter list but reference different subsets — the trend
 * query uses the tenant, the current window and the product filter, but not the
 * comparison window. Slicing to the highest index leaves a hole, and Postgres rejects a
 * statement containing a parameter it can neither reference nor type
 * ("could not determine data type of parameter $5"). Renumbering closes the hole.
 */
export const densifyParams = (sql, params) => {
  const used = [...new Set([...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
  if (!used.length) return { sql, params: [] };
  const remap = new Map(used.map((index, position) => [index, position + 1]));
  return {
    sql: sql.replace(/\$(\d+)/g, (_match, index) => "$" + remap.get(Number(index))),
    params: used.map((index) => params[index - 1]),
  };
};

const runTimed = async (client, sql, params, timings, name) => {
  const bound = densifyParams(sql, params);
  const startedAt = Date.now();
  const result = await client.query(bound.sql, bound.params);
  timings[name] = Date.now() - startedAt;
  return result;
};


/* ------------------------------------------------------------------ summary */

export const getSalesSummary = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const includeProfit = Boolean(permissions.profit) && includeCost;
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns, includeCost });
  const granularity = resolveGranularity(filters.granularity, filters.days);
  const timings = {};

  const [orderRes, lineRes, trendRes, moversRes, returnsRes] = await Promise.all([
    runTimed(client, buildOrderTotalsQuery({ scope, orderColumns: columns.orderColumns }), scope.params, timings, "orders"),
    runTimed(client, buildLineTotalsQuery({ scope, itemColumns: columns.itemColumns, includeCost }), scope.params, timings, "lines"),
    runTimed(client, buildTrendQuery({ scope, itemColumns: columns.itemColumns, includeCost, granularity }), scope.params, timings, "trend"),
    runTimed(client, buildMoversQuery({ scope, itemColumns: columns.itemColumns, includeCost }), scope.params, timings, "movers"),
    columns.returnItemColumns.size
      ? runTimed(client, buildReturnsQuery({ scope, returnItemColumns: columns.returnItemColumns, orderColumns: columns.orderColumns, tenantScoped: filters.tenantId !== null }), scope.params, timings, "returns")
      : Promise.resolve({ rows: [{ returns_current: null, returns_previous: null }] }),
  ]);

  const totals = orderRes.rows[0] || {};
  const lineTotals = lineRes.rows[0] || {};

  // Returns are deducted here, exactly as the Executive Overview does, so R2 and R3
  // report the same net sales for the same window.
  const returnsRow = returnsRes.rows[0] || {};
  const returnsCurrent = toMoney(num(returnsRow.returns_current));
  const returnsPrevious = filters.comparison ? toMoney(num(returnsRow.returns_previous)) : null;
  const deductReturns = (value, returned) => (value === null ? null : toMoney(value - (returned ?? 0)));

  // With a product-attribute filter active, the order-level figure would describe the
  // whole store rather than the filtered slice, so the basis switches to line level.
  // Returns cannot follow - they are not attributable to a product line - so the switch
  // is disclosed instead of silently changing what "net sales" means.
  const productFiltered = Boolean(
    filters.productType || filters.brandId || filters.category || filters.gender || filters.productId
  );

  const netSales = productFiltered
    ? toMoney(num(lineTotals.line_net_current) ?? 0)
    : deductReturns(toMoney(num(totals.revenue_current) ?? 0), returnsCurrent);

  const netSalesPrev = !filters.comparison
    ? null
    : productFiltered
      ? toMoney(num(lineTotals.line_net_previous) ?? 0)
      : deductReturns(toMoney(num(totals.revenue_previous) ?? 0), returnsPrevious);

  if (productFiltered) {
    collector.add(
      "FILTERED_EXCLUDES_RETURNS",
      "With a product filter active, totals are line-level and before unattributed returns.",
      {}
    );
  }
  const orders = productFiltered ? num(lineTotals.line_orders_current) ?? 0 : num(totals.orders_current) ?? 0;
  const ordersPrev = !filters.comparison ? null : productFiltered ? num(lineTotals.line_orders_previous) ?? 0 : num(totals.orders_previous) ?? 0;
  const units = num(lineTotals.units_current) ?? 0;
  const unitsPrev = filters.comparison ? num(lineTotals.units_previous) ?? 0 : null;
  const gross = toMoney(num(totals.gross_current) ?? 0);
  const grossPrev = filters.comparison ? toMoney(num(totals.gross_previous) ?? 0) : null;
  const discount = toMoney(num(totals.discount_current) ?? 0);
  const discountPrev = filters.comparison ? toMoney(num(totals.discount_previous) ?? 0) : null;

  const cogs = includeCost ? toMoney(num(lineTotals.cogs_current) ?? 0) : null;
  const cogsPrev = includeCost && filters.comparison ? toMoney(num(lineTotals.cogs_previous) ?? 0) : null;
  const costedUnits = includeCost ? num(lineTotals.costed_units_current) ?? 0 : null;
  const cogsCoverage = includeCost ? safeRatio(costedUnits, units) : null;

  const grossProfit = includeProfit && cogs !== null ? toMoney(netSales - cogs) : null;
  const grossProfitPrev = includeProfit && cogsPrev !== null && netSalesPrev !== null ? toMoney(netSalesPrev - cogsPrev) : null;

  const DIRECTION = {
    netSales: "higher", grossProfit: "higher", grossMargin: "higher", itemsSold: "higher",
    orders: "higher", averageOrderValue: "higher", discountRate: "lower", returnRate: "lower",
  };
  const kpi = (key, current, previous) => ({
    ...buildDelta(current, previous, { collector, metric: key }),
    favourable: DIRECTION[key] || "neutral",
  });

  const kpis = {
    netSales: kpi("netSales", netSales, netSalesPrev),
    grossProfit: kpi("grossProfit", grossProfit, grossProfitPrev),
    grossMargin: kpi("grossMargin", safeRatio(grossProfit, netSales), safeRatio(grossProfitPrev, netSalesPrev)),
    itemsSold: kpi("itemsSold", units, unitsPrev),
    orders: kpi("orders", orders, ordersPrev),
    averageOrderValue: kpi("averageOrderValue", safeRatio(netSales, orders), safeRatio(netSalesPrev, ordersPrev)),
    discountRate: kpi("discountRate", safeRatio(discount, gross), safeRatio(discountPrev, grossPrev)),
    // Return rate by value against gross sales, matching the Executive Overview.
    // Unit-level returns are reported separately because attribution differs.
    returnRate: kpi("returnRate", safeRatio(returnsCurrent, gross), safeRatio(returnsPrevious, grossPrev)),
    returns: kpi("returns", returnsCurrent, returnsPrevious),
  };

  if (includeProfit) {
    const policed = applyCogsCoveragePolicy({
      coverage: cogsCoverage,
      values: { grossProfit: kpis.grossProfit.current, grossMargin: kpis.grossMargin.current },
      collector,
      uncostedUnits: costedUnits === null ? null : Math.max(units - costedUnits, 0),
    });
    if (policed.grossProfit === null) {
      kpis.grossProfit = { ...kpis.grossProfit, current: null, delta: null, deltaPercent: null, unavailableReason: "COGS_COVERAGE_CRITICAL" };
      kpis.grossMargin = { ...kpis.grossMargin, current: null, delta: null, deltaPercent: null, unavailableReason: "COGS_COVERAGE_CRITICAL" };
    }
  } else {
    for (const key of ["grossProfit", "grossMargin"]) {
      kpis[key] = { ...kpis[key], current: null, previous: null, delta: null, deltaPercent: null, restricted: true };
    }
  }

  const trend = (trendRes.rows || []).map((row) => {
    const bucketNet = toMoney(num(row.line_net) ?? 0);
    const bucketCogs = includeProfit ? toMoney(num(row.cogs)) : null;
    const bucketUnits = num(row.units) ?? 0;
    const coverage = includeProfit ? safeRatio(num(row.costed_units), bucketUnits) : null;
    const available = includeProfit && bucketCogs !== null && (coverage === null || coverage >= COGS_COVERAGE_CRITICAL_THRESHOLD);
    const profit = available ? toMoney(bucketNet - bucketCogs) : null;
    return {
      bucket: row.bucket,
      netSales: bucketNet,
      grossProfit: profit,
      grossMargin: safeRatio(profit, bucketNet),
      orders: num(row.orders) ?? 0,
      units: bucketUnits,
      cogsCoverage: coverage,
    };
  });

  // Highlight inputs. Product-level rules need per-product movement, which the lean
  // movers query supplies; the rule engine itself stays in one place.
  const movers = (moversRes.rows || []).map((row) => {
    const netSalesValue = toMoney(num(row.net_sales) ?? 0);
    const previousValue = filters.comparison ? toMoney(num(row.net_sales_previous) ?? 0) : null;
    const moverUnits = includeProfit ? num(row.units) ?? 0 : 0;
    const moverCogs = includeProfit ? toMoney(num(row.cogs)) : null;
    const moverCoverage = includeProfit ? safeRatio(num(row.costed_units), moverUnits) : null;
    const profitAvailable = includeProfit && moverCogs !== null && (moverCoverage === null || moverCoverage >= COGS_COVERAGE_CRITICAL_THRESHOLD);
    return {
      productId: row.product_id,
      productName: row.product_name,
      netSales: netSalesValue,
      netSalesPrevious: previousValue,
      growth: buildDelta(netSalesValue, previousValue).deltaPercent,
      grossProfit: profitAvailable ? toMoney(netSalesValue - moverCogs) : null,
    };
  });

  const highlights = buildSalesHighlights({ kpis, products: movers, cogsCoverage });

  return {
    data: {
      period: { from: filters.from, to: filters.to, days: filters.days, granularity },
      comparison: filters.comparison ? { ...filters.comparison, mode: filters.comparisonMode } : null,
      kpis,
      trend,
      highlights,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      contractVersion: CONTRACT_VERSION,
      cogsCoverage,
      permissions: { cost: includeCost, profit: includeProfit },
      timings,
    },
    warnings: collector.list(),
  };
};

/* ---------------------------------------------------------------- breakdown */

export const getSalesBreakdown = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const includeProfit = Boolean(permissions.profit) && includeCost;
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns, includeCost });
  const dimension = SALES_DIMENSIONS[filters.dimension] ? filters.dimension : DEFAULT_SALES_DIMENSION;
  const timings = {};

  const result = await runTimed(
    client,
    buildBreakdownQuery({ scope, itemColumns: columns.itemColumns, includeCost, dimension }),
    scope.params, timings, "breakdown"
  );

  const rows = result.rows || [];
  const total = rows.reduce((sum, row) => sum + Number(row.net_sales || 0), 0);

  const mapped = rows.map((row) => {
    const netSales = toMoney(num(row.net_sales) ?? 0);
    const previous = filters.comparison ? toMoney(num(row.net_sales_previous) ?? 0) : null;
    const unitsCount = num(row.units) ?? 0;
    const rowCogs = includeProfit ? toMoney(num(row.cogs)) : null;
    const coverage = includeProfit ? safeRatio(num(row.costed_units), unitsCount) : null;
    const available = includeProfit && rowCogs !== null && (coverage === null || coverage >= COGS_COVERAGE_CRITICAL_THRESHOLD);
    const profit = available ? toMoney(netSales - rowCogs) : null;
    return {
      key: row.dim,
      netSales,
      contribution: safeRatio(netSales, total),
      units: unitsCount,
      orders: num(row.orders) ?? 0,
      grossProfit: profit,
      grossMargin: safeRatio(profit, netSales),
      ...buildDelta(netSales, previous, { collector, metric: `breakdown.${row.dim}` }),
    };
  });

  // The uncategorised bucket must stay visible, never be dropped or merged away.
  if (dimension === "category") {
    const uncategorised = mapped.find((row) => row.key === "غير مصنف");
    const share = uncategorised ? safeRatio(uncategorised.netSales, total) : null;
    if (share !== null && share > 0.2) {
      collector.add(WARNING_CODES.UNCATEGORISED_SALES_HIGH, "A large share of sales has no category assigned.", {
        uncategorisedShare: share,
        uncategorisedValue: uncategorised.netSales,
      });
    }
  }

  // Line-level totals exclude returns, because a refund cannot be reliably attributed
  // back to the product line that produced it (D-19: orphan return_items exist). The
  // summary deducts returns at order level, so this total is legitimately higher.
  // Disclose it rather than let the two numbers silently disagree.
  collector.add(
    "BREAKDOWN_EXCLUDES_RETURNS",
    "Breakdown totals are before returns; returns are deducted at summary level only.",
    {}
  );

  return {
    data: { dimension, rows: mapped, total: toMoney(total), quality: assessDimensionQuality(dimension, mapped, total) },
    meta: {
      generatedAt: new Date().toISOString(),
      contractVersion: CONTRACT_VERSION,
      availableDimensions: Object.keys(SALES_DIMENSIONS),
      permissions: { cost: includeCost, profit: includeProfit },
      timings,
    },
    warnings: collector.list(),
  };
};


/**
 * Whether a dimension actually segments the selected data.
 *
 * A breakdown where everything collapses into the unknown bucket is not an insight,
 * it is a chart of one bar. The UI uses this to disable or annotate the dimension
 * instead of rendering a giant "بدون علامة" column. Computed per request, so a
 * dimension that is useless for one period becomes available again for another -
 * production's current shape is never hardcoded into the client.
 */
export const UNKNOWN_DIMENSION_KEYS = Object.freeze(["بدون علامة", "غير مصنف", "غير محدد"]);

export const assessDimensionQuality = (dimension, rows, total) => {
  const unknownRows = rows.filter((row) => UNKNOWN_DIMENSION_KEYS.includes(row.key));
  const unknownValue = unknownRows.reduce((sum, row) => sum + (row.netSales || 0), 0);
  const meaningful = rows.filter((row) => !UNKNOWN_DIMENSION_KEYS.includes(row.key) && (row.netSales || 0) > 0);
  const unknownShare = safeRatio(unknownValue, total);

  return {
    dimension,
    distinctMeaningfulValues: meaningful.length,
    unknownContribution: toMoney(unknownValue),
    unknownContributionPercent: unknownShare,
    // Useful means: at least two real buckets, and the unknown bucket is not the story.
    usable: meaningful.length >= 2 && (unknownShare === null || unknownShare < 0.9),
  };
};

/* ----------------------------------------------------------------- products */

/**
 * Quadrant classification.
 *
 * Thresholds are the period's own medians, so they adapt to the data instead of
 * hard-coding an EGP figure that would be meaningless in another period or currency.
 * A median needs something to split, so fewer than 4 products yields no quadrants.
 */
export const classifyQuadrants = (products) => {
  const withProfit = products.filter((p) => typeof p.grossMargin === "number");
  if (products.length < 4 || withProfit.length < 4) {
    return { medianNetSales: null, medianMargin: null, classified: products.map((p) => ({ ...p, quadrant: null })) };
  }
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const medianNetSales = median(products.map((p) => p.netSales));
  const medianMargin = median(withProfit.map((p) => p.grossMargin));

  return {
    medianNetSales,
    medianMargin,
    classified: products.map((product) => {
      if (typeof product.grossMargin !== "number") return { ...product, quadrant: null };
      const highSales = product.netSales >= medianNetSales;
      const highMargin = product.grossMargin >= medianMargin;
      return {
        ...product,
        quadrant: highSales
          ? highMargin ? "star" : "volume_low_margin"
          : highMargin ? "margin_opportunity" : "underperformer",
      };
    }),
  };
};

export const getSalesProducts = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const includeProfit = Boolean(permissions.profit) && includeCost;
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns, includeCost });
  const timings = {};

  const result = await runTimed(
    client,
    buildProductsQuery({ scope, itemColumns: columns.itemColumns, includeCost, variantColumns: columns.variantColumns }),
    scope.params, timings, "products"
  );

  const rows = (result.rows || []).map((row) => {
    const netSales = toMoney(num(row.net_sales) ?? 0);
    const previous = filters.comparison ? toMoney(num(row.net_sales_previous) ?? 0) : null;
    const unitsCount = num(row.units) ?? 0;
    const rowCogs = includeProfit ? toMoney(num(row.cogs)) : null;
    const coverage = includeProfit ? safeRatio(num(row.costed_units), unitsCount) : null;
    const available = includeProfit && rowCogs !== null && (coverage === null || coverage >= COGS_COVERAGE_CRITICAL_THRESHOLD);
    const profit = available ? toMoney(netSales - rowCogs) : null;
    const delta = buildDelta(netSales, previous);
    return {
      productId: row.product_id,
      productName: row.product_name,
      productType: row.product_type,
      brand: row.brand,
      imageUrl: row.image_url || "",
      netSales,
      netSalesPrevious: previous,
      growth: delta.deltaPercent,
      units: unitsCount,
      unitsPrevious: filters.comparison ? num(row.units_previous) ?? 0 : null,
      orders: num(row.orders) ?? 0,
      grossProfit: profit,
      grossMargin: safeRatio(profit, netSales),
      discountRate: safeRatio(toMoney(num(row.discount) ?? 0), netSales + (num(row.discount) ?? 0)),
      returnedUnits: num(row.returned_units) ?? 0,
      currentStock: includeCost || columns.variantColumns.has("stock") ? num(row.current_stock) : null,
    };
  });

  if (rows.length >= MATRIX_LIMIT) {
    collector.add(
      "PRODUCT_LIST_TRUNCATED",
      `Only the top ${MATRIX_LIMIT} products by net sales are included.`,
      { limit: MATRIX_LIMIT }
    );
  }

  const { classified, medianNetSales, medianMargin } = classifyQuadrants(rows);

  // Server-side sort + page over the aggregated set. Sort keys come from an allowlist.
  const sortKey = SALES_SORTS[filters.sort] ? filters.sort : DEFAULT_SALES_SORT;
  const direction = filters.sortDir === "asc" ? 1 : -1;
  const search = String(filters.search || "").trim().toLowerCase();

  const filtered = search
    ? classified.filter((row) =>
        row.productName.toLowerCase().includes(search) ||
        String(row.brand || "").toLowerCase().includes(search) ||
        String(row.productType || "").toLowerCase().includes(search))
    : classified;

  const sortValue = (row) => {
    switch (sortKey) {
      case "units": return row.units;
      case "gross_profit": return row.grossProfit ?? -Infinity;
      case "margin": return row.grossMargin ?? -Infinity;
      case "growth": return row.growth ?? -Infinity;
      case "discount_rate": return row.discountRate ?? -Infinity;
      case "product": return row.productName;
      default: return row.netSales;
    }
  };
  const sorted = [...filtered].sort((a, b) => {
    const av = sortValue(a); const bv = sortValue(b);
    if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * direction;
    return (av - bv) * direction;
  });

  const page = Math.max(filters.page || 1, 1);
  const limit = Math.min(Math.max(filters.limit || 25, 1), 100);
  const start = (page - 1) * limit;

  return {
    data: {
      table: sorted.slice(start, start + limit),
      pagination: { page, limit, total: sorted.length, pages: Math.max(Math.ceil(sorted.length / limit), 1) },
      matrix: {
        points: classified.map((row) => ({
          productId: row.productId, productName: row.productName, productType: row.productType,
          netSales: row.netSales, units: row.units, grossProfit: row.grossProfit,
          grossMargin: row.grossMargin, currentStock: row.currentStock, quadrant: row.quadrant,
        })),
        medianNetSales, medianMargin,
      },
      rankings: buildRankings(classified, filters.comparison),
      sort: { key: sortKey, direction: direction === 1 ? "asc" : "desc" },
    },
    meta: {
      generatedAt: new Date().toISOString(),
      contractVersion: CONTRACT_VERSION,
      availableSorts: Object.keys(SALES_SORTS),
      permissions: { cost: includeCost, profit: includeProfit },
      timings,
    },
    warnings: collector.list(),
  };
};

const RANKING_SIZE = 5;

/** Rankings are selections over the already-aggregated set, not a second aggregation. */
export const buildRankings = (products, hasComparison) => {
  const top = (key, direction = -1, filterFn = () => true) =>
    [...products]
      .filter(filterFn)
      .sort((a, b) => ((a[key] ?? -Infinity) - (b[key] ?? -Infinity)) * direction)
      .slice(0, RANKING_SIZE);

  const rankings = {
    topBySales: top("netSales"),
    topByUnits: top("units"),
    topByProfit: products.some((p) => typeof p.grossProfit === "number") ? top("grossProfit") : [],
  };

  if (hasComparison) {
    // Growth is only meaningful for products that sold in the comparison period too.
    const comparable = (row) => typeof row.growth === "number" && (row.netSalesPrevious || 0) > 0;
    rankings.fastestGrowth = top("growth", -1, comparable);
    rankings.largestDecline = top("growth", 1, comparable);
  }

  return rankings;
};

/* -------------------------------------------------------------------- sizes */

/**
 * Size intelligence.
 *
 * Scoped to ONE product_type at a time, because size ranges are not comparable across
 * types — production holds sneakers 17-50, slippers 37-45, bags 14-inch..20-inch. Mixing
 * them produces a meaningless axis. Colour-only products and the "One Size" family are
 * excluded and the exclusion is disclosed.
 */
export const getSalesSizes = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const includeProfit = Boolean(permissions.profit) && includeCost;
  const collector = new WarningCollector();
  const columns = await loadColumns(client);

  if (!filters.productType) {
    collector.add(
      "SIZE_SCOPE_REQUIRED",
      "Size analysis needs a single product type, because size ranges are not comparable across types.",
      {}
    );
    return {
      data: { productType: null, rows: [], totals: null },
      meta: { generatedAt: new Date().toISOString(), contractVersion: CONTRACT_VERSION, permissions: { cost: includeCost, profit: includeProfit }, timings: {} },
      warnings: collector.list(),
    };
  }

  const scope = buildScope({ filters, columns, includeCost });
  // Stock side must be filtered by the same product attributes as the sales side.
  scope.sizeProductFilter = `AND LOWER(TRIM(COALESCE(p.product_type,''))) = LOWER('${String(filters.productType).replace(/'/g, "''")}')`;
  if (filters.gender) scope.sizeProductFilter += ` AND LOWER(TRIM(COALESCE(p.gender,''))) = LOWER('${String(filters.gender).replace(/'/g, "''")}')`;

  const timings = {};
  const result = await runTimed(
    client,
    buildSizesQuery({ scope, itemColumns: columns.itemColumns, includeCost, variantColumns: columns.variantColumns }),
    scope.params, timings, "sizes"
  );

  const days = Math.max(filters.days || 1, 1);
  const rows = (result.rows || []).map((row) => {
    const unitsCount = num(row.units) ?? 0;
    const netSales = toMoney(num(row.net_sales) ?? 0);
    const stock = num(row.current_stock) ?? 0;
    const rowCogs = includeProfit ? toMoney(num(row.cogs)) : null;
    return {
      size: row.size,
      units: unitsCount,
      unitsPrevious: filters.comparison ? num(row.units_previous) ?? 0 : null,
      netSales,
      grossProfit: rowCogs === null ? null : toMoney(netSales - rowCogs),
      currentStock: stock,
      // Average units per day over the SELECTED window. This is a description of the
      // period, not a forecast — no days-to-stockout is derived from it.
      unitsPerDay: Number((unitsCount / days).toFixed(3)),
      // Demand relative to what is on hand. null when there is no stock to compare against.
      salesToStockRatio: safeRatio(unitsCount, stock),
    };
  });

  const totalUnits = rows.reduce((sum, row) => sum + row.units, 0);
  const totalStock = rows.reduce((sum, row) => sum + row.currentStock, 0);

  // Sizes that sold but have nothing left are the actionable signal.
  const soldOut = rows.filter((row) => row.units > 0 && row.currentStock === 0);
  if (soldOut.length) {
    collector.add("SIZES_SOLD_OUT", "Some sizes sold in this period and now have no stock.", {
      sizes: soldOut.map((row) => row.size).slice(0, 12),
      count: soldOut.length,
    });
  }

  collector.add("SIZE_SCOPE_APPLIED", "Colour-only products and one-size variants are excluded from size analysis.", {
    productType: filters.productType,
    excludedVariationModes: NON_SIZED_VARIATION_MODES,
    excludedSizeValues: NON_SIZE_VALUES,
  });

  return {
    data: {
      productType: filters.productType,
      gender: filters.gender || null,
      // Whether size analysis is meaningful for this product type at all. Bags are
      // colour-only with inch/one-size labels, so a size axis says nothing; the UI
      // renders a not-applicable state rather than an empty chart.
      applicable: rows.length > 0 && rows.some((row) => row.units > 0 || row.currentStock > 0),
      rows,
      totals: {
        units: totalUnits,
        currentStock: totalStock,
        sizesWithSales: rows.filter((row) => row.units > 0).length,
        sizesWithStock: rows.filter((row) => row.currentStock > 0).length,
        soldOutSizes: soldOut.length,
      },
    },
    meta: {
      generatedAt: new Date().toISOString(),
      contractVersion: CONTRACT_VERSION,
      periodDays: days,
      permissions: { cost: includeCost, profit: includeProfit },
      timings,
    },
    warnings: collector.list(),
  };
};

/* --------------------------------------------------------------- highlights */

const HIGHLIGHT_LIMIT = 5;

/**
 * Deterministic sales highlights. Backend emits codes and raw values only; the
 * frontend renders the Arabic wording from messageKey.
 */
export const buildSalesHighlights = ({ kpis, products = [], sizes = [], cogsCoverage }) => {
  const highlights = [];
  const pct = (delta) => (delta?.deltaPercent === null || delta?.deltaPercent === undefined ? null : delta.deltaPercent);

  const salesPct = pct(kpis.netSales);
  if (salesPct !== null && Math.abs(salesPct) >= 0.05) {
    highlights.push({
      code: salesPct > 0 ? "SALES_GROWING" : "SALES_DECLINING",
      severity: salesPct > 0 ? "positive" : salesPct <= -0.15 ? "critical" : "warning",
      metric: "netSales", entityId: null,
      currentValue: kpis.netSales.current, comparisonValue: kpis.netSales.previous,
      changePercent: salesPct,
      messageKey: salesPct > 0 ? "highlights.salesGrowing" : "highlights.salesDeclining",
    });
  }

  if (kpis.grossMargin?.delta !== null && kpis.grossMargin?.delta !== undefined) {
    const points = kpis.grossMargin.delta * 100;
    if (points <= -2 && salesPct !== null && salesPct > 0) {
      highlights.push({
        code: "MARGIN_DOWN_SALES_UP", severity: "warning", metric: "grossMargin", entityId: null,
        currentValue: kpis.grossMargin.current, comparisonValue: kpis.grossMargin.previous,
        changePoints: points, messageKey: "highlights.marginDownSalesUp",
      });
    }
  }

  const surging = products.filter((p) => typeof p.growth === "number" && p.growth >= 0.5 && (p.netSalesPrevious || 0) > 0)
    .sort((a, b) => b.growth - a.growth)[0];
  if (surging) {
    highlights.push({
      code: "PRODUCT_SURGING", severity: "positive", metric: "netSales", entityId: surging.productId,
      entityName: surging.productName,
      currentValue: surging.netSales, comparisonValue: surging.netSalesPrevious,
      changePercent: surging.growth, messageKey: "highlights.productSurging",
    });
  }

  const declining = products.filter((p) => typeof p.growth === "number" && p.growth <= -0.4 && (p.netSalesPrevious || 0) > 0)
    .sort((a, b) => a.growth - b.growth)[0];
  if (declining) {
    highlights.push({
      code: "PRODUCT_DECLINING", severity: "warning", metric: "netSales", entityId: declining.productId,
      entityName: declining.productName,
      currentValue: declining.netSales, comparisonValue: declining.netSalesPrevious,
      changePercent: declining.growth, messageKey: "highlights.productDeclining",
    });
  }

  // Profit concentration: the top 3 products carrying most of the profit is a risk.
  const withProfit = products.filter((p) => typeof p.grossProfit === "number" && p.grossProfit > 0);
  if (withProfit.length >= 5) {
    const totalProfit = withProfit.reduce((sum, p) => sum + p.grossProfit, 0);
    const top3 = [...withProfit].sort((a, b) => b.grossProfit - a.grossProfit).slice(0, 3)
      .reduce((sum, p) => sum + p.grossProfit, 0);
    const share = safeRatio(top3, totalProfit);
    if (share !== null && share >= 0.6) {
      highlights.push({
        code: "PROFIT_CONCENTRATION_HIGH", severity: "warning", metric: "grossProfit", entityId: null,
        currentValue: share, comparisonValue: null, messageKey: "highlights.profitConcentration",
      });
    }
  }

  const discountRate = kpis.discountRate?.current;
  if (typeof discountRate === "number" && discountRate >= 0.15) {
    highlights.push({
      code: "DISCOUNT_DEPENDENCY_HIGH", severity: "warning", metric: "discountRate", entityId: null,
      currentValue: discountRate, comparisonValue: kpis.discountRate.previous,
      messageKey: "highlights.discountDependency",
    });
  }

  // Size concentration: a few sizes carrying most demand affects buying decisions.
  const sizeUnits = sizes.reduce((sum, row) => sum + (row.units || 0), 0);
  if (sizes.length >= 5 && sizeUnits > 0) {
    const top3 = [...sizes].sort((a, b) => b.units - a.units).slice(0, 3).reduce((sum, row) => sum + row.units, 0);
    const share = safeRatio(top3, sizeUnits);
    if (share !== null && share >= 0.6) {
      highlights.push({
        code: "SIZE_DEMAND_CONCENTRATION", severity: "info", metric: "units", entityId: null,
        currentValue: share, comparisonValue: null, messageKey: "highlights.sizeConcentration",
      });
    }
  }

  if (typeof cogsCoverage === "number" && cogsCoverage < 0.95) {
    highlights.push({
      code: "COGS_COVERAGE_LOW",
      severity: cogsCoverage < COGS_COVERAGE_CRITICAL_THRESHOLD ? "critical" : "warning",
      metric: "cogsCoverage", entityId: null,
      currentValue: cogsCoverage, comparisonValue: null, messageKey: "highlights.cogsCoverageLow",
    });
  }

  const rank = { critical: 0, warning: 1, positive: 2, info: 3 };
  return highlights.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)).slice(0, HIGHLIGHT_LIMIT);
};
