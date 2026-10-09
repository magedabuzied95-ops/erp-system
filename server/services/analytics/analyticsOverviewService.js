/**
 * Executive Overview — R2.
 *
 * Assembles the KPIs, trend, category contribution and deterministic highlights for
 * GET /api/analytics/v2/overview, entirely from the R1 foundation.
 *
 * Design rules enforced here:
 *   - Three database round trips. Conditional aggregates over shared scans, not one
 *     query per KPI, and not one unreadable mega-query.
 *   - Permission masking happens HERE, in the service. Columns the caller may not see
 *     are omitted from the SELECT list, so they never enter the response.
 *   - A failing query throws. It is never converted into a zero (D-11).
 *   - Every number traces to docs/analytics/metric-contract.md v1.0.0.
 */

import db from "../../database/db.js";
import { addScopedWhere, coalesceColumnExpr, whereSql } from "./accountingCanon.js";
import { orderFilterClauses } from "./analyticsOrderFilters.js";
import {
  COGS_COVERAGE_CRITICAL_THRESHOLD,
  COGS_COVERAGE_WARN_THRESHOLD,
  WARNING_CODES,
  WarningCollector,
  applyCogsCoveragePolicy,
  buildDelta,
  safeRatio,
  toFiniteNumber,
  toMoney,
} from "./analyticsComparison.js";
import { normalizePaymentMethodKey, paymentMethodSettlement } from "../../../shared/paymentMethods.js";
import {
  CONTRACT_VERSION,
  buildCostContext,
  canonicalOrderClauses,
  discountAmountExpr,
  discountBreakdownExprs,
  exchangeCreditRetainedExpr,
  grossSalesExpr,
  categoryNameExpr,
  lineNetSalesExpr,
  nanSafe,
  onHandUnitCostExpr,
  orderRevenueExpr,
  orphanExchangeExpr,
  variantStockClauses,
  variantStockExpr,
} from "./analyticsMetrics.js";
import { resolveGranularity } from "./analyticsFilters.js";

/** Permission keys. These are the real names registered in permissionMiddleware. */
export const ANALYTICS_PERMISSIONS = Object.freeze({
  view: "reports:view",
  cost: "reports:cost",
  profit: "reports:profit",
});

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

export const __clearColumnCache = () => TABLE_COLUMN_CACHE.clear();

/**
 * Metric direction semantics. An increase in returns or discount rate is NOT good, so
 * the frontend must not colour purely by sign. Exposed per KPI as `favourable`.
 */
export const METRIC_DIRECTION = Object.freeze({
  netSales: "higher",
  grossProfit: "higher",
  grossMargin: "higher",
  orders: "higher",
  averageOrderValue: "higher",
  itemsSold: "higher",
  itemsPerOrder: "higher",
  discountRate: "lower",
  returns: "lower",
  returnRate: "lower",
  newCustomers: "higher",
  inventoryValue: "neutral",
});

/* ------------------------------------------------------------------ query 1: orders */

/**
 * One scan of orders joined to order_items, producing the current window and the
 * comparison window side by side via FILTER clauses, plus the per-bucket trend.
 *
 * Returns rows keyed by bucket; the caller folds them into totals and a series.
 */
const buildOrdersQuery = ({ orderColumns, itemColumns, costContext, scope, granularity, includeCost }) => {
  const inCurrent = `o.created_at >= ${scope.currentFrom}::date AND o.created_at < (${scope.currentTo}::date + INTERVAL '1 day')`;
  const inPrevious = scope.previousFrom
    ? `o.created_at >= ${scope.previousFrom}::date AND o.created_at < (${scope.previousTo}::date + INTERVAL '1 day')`
    : "FALSE";

  const revenue = nanSafe(orderRevenueExpr(orderColumns));
  const gross = nanSafe(grossSalesExpr(orderColumns));
  const discount = nanSafe(discountAmountExpr(orderColumns));
  const breakdown = discountBreakdownExprs(orderColumns);
  const creditRetained = exchangeCreditRetainedExpr(orderColumns);
  const orphanExchange = orphanExchangeExpr(orderColumns);
  const netQty = costContext.netQuantityExpr;

  // Order-level values must not be multiplied by the item join, so they are aggregated
  // over DISTINCT order ids using a window-free trick: aggregate items separately.
  const bucketExpr = {
    hour: "date_trunc('hour', o.created_at)",
    day: "date_trunc('day', o.created_at)",
    week: "date_trunc('week', o.created_at)",
    month: "date_trunc('month', o.created_at)",
  }[granularity] || "date_trunc('day', o.created_at)";

  return `
    WITH scoped_orders AS (
      SELECT o.id, o.created_at,
             ${bucketExpr} AS bucket,
             (${inCurrent})  AS in_current,
             (${inPrevious}) AS in_previous,
             ${revenue}         AS revenue,
             ${gross}           AS gross_sales,
             ${discount}        AS discount_amount,
             ${nanSafe(breakdown.invoice)} AS invoice_discount,
             ${nanSafe(breakdown.coupon)}  AS coupon_discount,
             ${creditRetained}  AS exchange_credit_retained,
             ${orphanExchange}  AS orphan_exchange
      FROM orders o
      ${scope.orderWhere}
    ),
    order_totals AS (
      SELECT
        COUNT(*) FILTER (WHERE in_current)::int   AS orders_current,
        COUNT(*) FILTER (WHERE in_previous)::int  AS orders_previous,
        COALESCE(SUM(revenue)      FILTER (WHERE in_current), 0)  AS revenue_current,
        COALESCE(SUM(revenue)      FILTER (WHERE in_previous), 0) AS revenue_previous,
        COALESCE(SUM(gross_sales)  FILTER (WHERE in_current), 0)  AS gross_current,
        COALESCE(SUM(gross_sales)  FILTER (WHERE in_previous), 0) AS gross_previous,
        COALESCE(SUM(discount_amount) FILTER (WHERE in_current), 0)  AS discount_current,
        COALESCE(SUM(discount_amount) FILTER (WHERE in_previous), 0) AS discount_previous,
        COALESCE(SUM(invoice_discount) FILTER (WHERE in_current), 0) AS invoice_discount_current,
        COALESCE(SUM(coupon_discount)  FILTER (WHERE in_current), 0) AS coupon_discount_current,
        COALESCE(SUM(exchange_credit_retained) FILTER (WHERE in_current), 0) AS credit_retained_current,
        COUNT(*) FILTER (WHERE in_current AND orphan_exchange)::int AS exchange_orders_current
      FROM scoped_orders
    ),
    item_totals AS (
      SELECT
        COALESCE(SUM(${netQty}) FILTER (WHERE so.in_current), 0)  AS units_current,
        COALESCE(SUM(${netQty}) FILTER (WHERE so.in_previous), 0) AS units_previous
        ${includeCost ? `,
        COALESCE(SUM((${netQty}) * GREATEST(${costContext.unitCostExpr}, 0)) FILTER (WHERE so.in_current), 0)  AS cogs_current,
        COALESCE(SUM((${netQty}) * GREATEST(${costContext.unitCostExpr}, 0)) FILTER (WHERE so.in_previous), 0) AS cogs_previous,
        COALESCE(SUM(${netQty}) FILTER (WHERE so.in_current  AND GREATEST(${costContext.unitCostExpr}, 0) > 0), 0) AS costed_units_current,
        COALESCE(SUM(${netQty}) FILTER (WHERE so.in_previous AND GREATEST(${costContext.unitCostExpr}, 0) > 0), 0) AS costed_units_previous` : ""}
      FROM order_items oi
      JOIN scoped_orders so ON so.id = oi.order_id
      JOIN orders o ON o.id = oi.order_id
      ${costContext.joins}
      ${scope.itemTenantClause}
    ),
    trend AS (
      SELECT so.bucket,
             COUNT(*)::int AS orders,
             COALESCE(SUM(so.revenue), 0) AS net_sales
      FROM scoped_orders so
      WHERE so.in_current
      GROUP BY so.bucket
    ),
    trend_items AS (
      SELECT so.bucket,
             COALESCE(SUM(${netQty}), 0) AS units
             ${includeCost ? `,
             COALESCE(SUM((${netQty}) * GREATEST(${costContext.unitCostExpr}, 0)), 0) AS cogs,
             COALESCE(SUM(${netQty}) FILTER (WHERE GREATEST(${costContext.unitCostExpr}, 0) > 0), 0) AS costed_units` : ""}
      FROM order_items oi
      JOIN scoped_orders so ON so.id = oi.order_id AND so.in_current
      JOIN orders o ON o.id = oi.order_id
      ${costContext.joins}
      ${scope.itemTenantClause}
      GROUP BY so.bucket
    )
    SELECT
      (SELECT row_to_json(order_totals) FROM order_totals) AS totals,
      (SELECT row_to_json(item_totals)  FROM item_totals)  AS item_totals,
      (SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.bucket), '[]'::json)
         FROM (
           SELECT trend.bucket, trend.orders, trend.net_sales,
                  COALESCE(trend_items.units, 0) AS units
                  ${includeCost ? ", COALESCE(trend_items.cogs, 0) AS cogs, COALESCE(trend_items.costed_units, 0) AS costed_units" : ""}
             FROM trend LEFT JOIN trend_items ON trend_items.bucket = trend.bucket
         ) t) AS trend
  `;
};

/* --------------------------------------------------------------- query 2: context */

/**
 * Returns, new customers, inventory value and category contribution in a single
 * round trip. These touch different base tables, so they are independent scalar
 * sub-selects rather than a forced join.
 */
const buildContextQuery = ({ scope, includeCost, returnColumns, returnItemColumns, customerColumns, variantColumns, productColumns, orderColumns, itemColumns, costContext }) => {
  const refundExpr = coalesceColumnExpr("ri", returnItemColumns, ["refund_amount", "total", "total_amount"], "0");
  const returnsAvailable = returnColumns.size > 0 && returnItemColumns.size > 0;

  const returnsBlock = returnsAvailable
    ? `
      (SELECT COALESCE(SUM(${nanSafe(refundExpr)}), 0)
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         JOIN orders o ON o.id = r.order_id
        WHERE ${scope.returnTenant}
          AND LOWER(COALESCE(r.status, '')) NOT IN ('cancelled','canceled','rejected','void','deleted')
          AND ${scope.refundedOrderCanonical}
          AND r.created_at >= ${scope.currentFrom}::date AND r.created_at < (${scope.currentTo}::date + INTERVAL '1 day')
      ) AS returns_current,
      (SELECT COALESCE(SUM(${nanSafe(refundExpr)}), 0)
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         JOIN orders o ON o.id = r.order_id
        WHERE ${scope.returnTenant}
          AND LOWER(COALESCE(r.status, '')) NOT IN ('cancelled','canceled','rejected','void','deleted')
          AND ${scope.refundedOrderCanonical}
          AND ${scope.previousFrom ? `r.created_at >= ${scope.previousFrom}::date AND r.created_at < (${scope.previousTo}::date + INTERVAL '1 day')` : "FALSE"}
      ) AS returns_previous,
      (SELECT COUNT(*)::int FROM return_items ri
         LEFT JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE oi.id IS NULL) AS orphan_return_items`
    : `NULL::numeric AS returns_current, NULL::numeric AS returns_previous, 0::int AS orphan_return_items`;

  const returnedUnitsExpr = itemColumns.has("returned_quantity") ? "COALESCE(oi.returned_quantity, 0)" : "0";
  const soldUnitsExpr = coalesceColumnExpr("oi", itemColumns, ["quantity", "qty"], "0");

  const customersBlock = customerColumns.size
    ? `
      (SELECT COUNT(*)::int FROM customers c
        WHERE ${scope.customerTenant}
          AND c.created_at >= ${scope.currentFrom}::date AND c.created_at < (${scope.currentTo}::date + INTERVAL '1 day')
      ) AS new_customers_current,
      (SELECT COUNT(*)::int FROM customers c
        WHERE ${scope.customerTenant}
          AND ${scope.previousFrom ? `c.created_at >= ${scope.previousFrom}::date AND c.created_at < (${scope.previousTo}::date + INTERVAL '1 day')` : "FALSE"}
      ) AS new_customers_previous`
    : `NULL::int AS new_customers_current, NULL::int AS new_customers_previous`;

  // Inventory value is a cost figure and is omitted entirely without reports:cost.
  const inventoryBlock = includeCost && variantColumns.size
    ? `
      (SELECT COALESCE(SUM(${variantStockExpr({ variantColumns })} * GREATEST(${onHandUnitCostExpr({ variantColumns, productColumns })}, 0)), 0)
         FROM product_variants pv
         LEFT JOIN products p ON p.id = pv.product_id
        WHERE ${scope.variantTenant}
          ${variantStockClauses({ variantColumns }).map((clause) => `AND ${clause}`).join(" ")}
      ) AS inventory_value,
      (SELECT COALESCE(SUM(${variantStockExpr({ variantColumns })}), 0)
         FROM product_variants pv
        WHERE ${scope.variantTenant}
          ${variantStockClauses({ variantColumns }).map((clause) => `AND ${clause}`).join(" ")}
      ) AS units_in_stock,
      (SELECT COALESCE(SUM(${variantStockExpr({ variantColumns })}), 0)
         FROM product_variants pv
         LEFT JOIN products p ON p.id = pv.product_id
        WHERE ${scope.variantTenant}
          AND GREATEST(${onHandUnitCostExpr({ variantColumns, productColumns })}, 0) > 0
          ${variantStockClauses({ variantColumns }).map((clause) => `AND ${clause}`).join(" ")}
      ) AS costed_units_in_stock,
      (SELECT COALESCE(SUM(COALESCE(p.stock, 0)), 0) FROM products p WHERE ${scope.productTenant}) AS legacy_products_stock`
    : `NULL::numeric AS inventory_value, NULL::numeric AS units_in_stock, NULL::numeric AS costed_units_in_stock, NULL::numeric AS legacy_products_stock`;

  return `
    SELECT
      ${returnsBlock},
      (SELECT COALESCE(SUM(${returnedUnitsExpr}), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
        ${scope.orderWhere} AND o.created_at >= ${scope.currentFrom}::date AND o.created_at < (${scope.currentTo}::date + INTERVAL '1 day')
      ) AS returned_units_current,
      (SELECT COALESCE(SUM(${soldUnitsExpr}), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
        ${scope.orderWhere} AND o.created_at >= ${scope.currentFrom}::date AND o.created_at < (${scope.currentTo}::date + INTERVAL '1 day')
      ) AS sold_units_current,
      ${customersBlock},
      ${inventoryBlock}
  `;
};

/* -------------------------------------------------------------- query 3: categories */

const buildCategoryQuery = ({ scope, costContext, includeCost, itemColumns }) => {
  const lineNet = lineNetSalesExpr(itemColumns);
  const netQty = costContext.netQuantityExpr;
  // Resolved via the ERP category ladder, not categories.category_id alone - see
  // categoryNameExpr. Joining on category_id returns nothing in production.
  const categoryExpr = categoryNameExpr();
  return `
    SELECT
      ${categoryExpr} AS category,
      COALESCE(SUM(${nanSafe(lineNet)}), 0) AS net_sales,
      COALESCE(SUM(${netQty}), 0)           AS units
      ${includeCost ? `,
      COALESCE(SUM((${netQty}) * GREATEST(${costContext.unitCostExpr}, 0)), 0) AS cogs,
      COALESCE(SUM(${netQty}) FILTER (WHERE GREATEST(${costContext.unitCostExpr}, 0) > 0), 0) AS costed_units` : ""}
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    ${costContext.joins}
    LEFT JOIN categories cat ON cat.id = p.category_id
    ${scope.orderWhere}
      AND o.created_at >= ${scope.currentFrom}::date AND o.created_at < (${scope.currentTo}::date + INTERVAL '1 day')
      ${scope.itemTenantClauseAnd}
    GROUP BY ${categoryExpr}
    ORDER BY net_sales DESC
  `;
};

/* ---------------------------------------------------------- query 4: payment mix */

/**
 * The period's invoices split across the payment methods that actually paid them.
 *
 * `orders.payment_method` is NOT the source. A sale paid half in cash and half on a card
 * stores the single word `mixed` there, so grouping by that column puts the whole invoice
 * under one method on every normal sale and hides the split ones behind a label that is
 * not a payment method at all. The authoritative record is `orders.payment_breakdown` —
 * one `{ method, amount }` allocation per real payment — which is also what the till
 * reconciles against (see shared/paymentMethods.js and managerPortalPaymentDistribution).
 *
 * So allocations are the primary source and the stored column is a fallback used ONLY for
 * an invoice that carries no allocation array at all (pre-split-canonicalisation rows).
 *
 * Normalisation (`visa` -> `card`, `insta_pay` -> `instapay`) deliberately does NOT
 * happen in SQL. Spelling it out here as well as in shared/paymentMethods.js would be two
 * copies of one rule, and the day they drift the report quietly splits one method into
 * two rows. SQL groups by the raw stored string — a bounded set — and the JS layer merges.
 *
 * An amount that is not a usable number becomes NULL rather than 0, so it can be COUNTed
 * and reported instead of silently shrinking a method's total (D-01).
 */
const buildPaymentMixQuery = ({ scope, orderColumns }) => {
  const revenue = nanSafe(orderRevenueExpr(orderColumns));
  // jsonb_array_elements throws on a non-array, and the column held objects and nulls
  // before the 2026-08-13 canonicalisation migration, so the type is checked first.
  const allocations = orderColumns.has("payment_breakdown")
    ? "(CASE WHEN jsonb_typeof(o.payment_breakdown) = 'array' THEN o.payment_breakdown ELSE '[]'::jsonb END)"
    : "'[]'::jsonb";
  const storedMethod = orderColumns.has("payment_method") ? "LOWER(TRIM(COALESCE(o.payment_method, '')))" : "''";
  const rawAmount = "(alloc->>'amount')";
  // A jsonb number casts cleanly; a stringified number is tolerated because the POS has
  // written both. Anything else is NULL, which is counted rather than treated as zero.
  const allocationAmount = `CASE
        WHEN jsonb_typeof(alloc->'amount') = 'number' THEN ${rawAmount}::numeric
        WHEN jsonb_typeof(alloc->'amount') = 'string' AND ${rawAmount} ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN ${rawAmount}::numeric
        ELSE NULL
      END`;

  return `
    WITH scoped AS (
      SELECT
        o.id                       AS order_id,
        ${storedMethod}            AS stored_method,
        ${allocations}             AS allocations,
        ${revenue}                 AS revenue
      FROM orders o
      ${scope.orderWhere}
        AND o.created_at >= ${scope.currentFrom}::date AND o.created_at < (${scope.currentTo}::date + INTERVAL '1 day')
    ),
    allocated AS (
      SELECT
        s.order_id,
        LOWER(TRIM(COALESCE(alloc->>'method', alloc->>'payment_method', ''))) AS method,
        ${allocationAmount} AS amount
      FROM scoped s
      CROSS JOIN LATERAL jsonb_array_elements(s.allocations) AS alloc
      UNION ALL
      SELECT s.order_id, s.stored_method, s.revenue
      FROM scoped s
      WHERE jsonb_array_length(s.allocations) = 0
    )
    SELECT
      method,
      COALESCE(SUM(amount), 0)                        AS amount,
      COUNT(DISTINCT order_id)::int                   AS orders,
      COUNT(*) FILTER (WHERE amount IS NULL)::int     AS unusable
    FROM allocated
    WHERE amount IS NULL OR amount <> 0
    GROUP BY method
    ORDER BY amount DESC
  `;
};

/* -------------------------------------------------------------------- highlights */

const HIGHLIGHT_THRESHOLDS = Object.freeze({
  salesChange: 0.05,
  marginPoints: 2,
  returnRatePoints: 0.02,
  aovChange: 0.08,
  cogsCoverage: COGS_COVERAGE_WARN_THRESHOLD,
});

/**
 * Deterministic highlights. No LLM, no prose in SQL: each highlight carries a stable
 * code plus the raw values, and the frontend renders the Arabic wording from
 * messageKey. Capped at 5, ordered by severity.
 */
export const buildHighlights = ({ kpis, cogsCoverage }) => {
  const highlights = [];
  const push = (entry) => highlights.push(entry);

  const pct = (delta) => (delta?.deltaPercent === null || delta?.deltaPercent === undefined ? null : delta.deltaPercent);

  const salesPct = pct(kpis.netSales);
  if (salesPct !== null && Math.abs(salesPct) >= HIGHLIGHT_THRESHOLDS.salesChange) {
    push({
      code: salesPct > 0 ? "SALES_UP" : "SALES_DOWN",
      severity: salesPct > 0 ? "positive" : salesPct <= -0.15 ? "critical" : "warning",
      metric: "netSales",
      currentValue: kpis.netSales.current,
      comparisonValue: kpis.netSales.previous,
      changePercent: salesPct,
      messageKey: salesPct > 0 ? "highlights.salesUp" : "highlights.salesDown",
    });
  }

  // Margin deteriorating while sales grow is the single most useful management signal.
  if (kpis.grossMargin?.current !== null && kpis.grossMargin?.previous !== null && kpis.grossMargin?.delta !== null) {
    const points = kpis.grossMargin.delta * 100;
    if (Math.abs(points) >= HIGHLIGHT_THRESHOLDS.marginPoints) {
      const salesGrew = salesPct !== null && salesPct > 0;
      push({
        code: points < 0 ? (salesGrew ? "MARGIN_DOWN_SALES_UP" : "MARGIN_DOWN") : "MARGIN_UP",
        severity: points < 0 ? "warning" : "positive",
        metric: "grossMargin",
        currentValue: kpis.grossMargin.current,
        comparisonValue: kpis.grossMargin.previous,
        changePoints: points,
        messageKey: points < 0 ? (salesGrew ? "highlights.marginDownSalesUp" : "highlights.marginDown") : "highlights.marginUp",
      });
    }
  }

  if (kpis.returnRate?.current !== null && kpis.returnRate?.previous !== null && kpis.returnRate?.delta !== null) {
    const points = kpis.returnRate.delta;
    if (points >= HIGHLIGHT_THRESHOLDS.returnRatePoints) {
      push({
        code: "RETURN_RATE_UP",
        severity: points >= 0.05 ? "critical" : "warning",
        metric: "returnRate",
        currentValue: kpis.returnRate.current,
        comparisonValue: kpis.returnRate.previous,
        changePoints: points,
        messageKey: "highlights.returnRateUp",
      });
    }
  }

  const aovPct = pct(kpis.averageOrderValue);
  if (aovPct !== null && Math.abs(aovPct) >= HIGHLIGHT_THRESHOLDS.aovChange) {
    push({
      code: aovPct > 0 ? "AOV_UP" : "AOV_DOWN",
      severity: aovPct > 0 ? "positive" : "info",
      metric: "averageOrderValue",
      currentValue: kpis.averageOrderValue.current,
      comparisonValue: kpis.averageOrderValue.previous,
      changePercent: aovPct,
      messageKey: aovPct > 0 ? "highlights.aovUp" : "highlights.aovDown",
    });
  }

  if (cogsCoverage !== null && cogsCoverage < HIGHLIGHT_THRESHOLDS.cogsCoverage) {
    push({
      code: "COGS_COVERAGE_LOW",
      severity: cogsCoverage < COGS_COVERAGE_CRITICAL_THRESHOLD ? "critical" : "warning",
      metric: "cogsCoverage",
      currentValue: cogsCoverage,
      comparisonValue: null,
      messageKey: "highlights.cogsCoverageLow",
    });
  }

  const rank = { critical: 0, warning: 1, positive: 2, info: 3 };
  return highlights.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)).slice(0, 5);
};

/* ------------------------------------------------------------------ orchestration */

export const getExecutiveOverview = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const includeProfit = Boolean(permissions.profit) && includeCost;
  const collector = new WarningCollector();

  const [orderColumns, itemColumns, productColumns, variantColumns, overrideColumns, purchaseColumns, purchaseItemColumns, returnColumns, returnItemColumns, customerColumns] =
    await Promise.all([
      getTableColumns(client, "orders"),
      getTableColumns(client, "order_items"),
      getTableColumns(client, "products"),
      getTableColumns(client, "product_variants"),
      getTableColumns(client, "accounting_order_item_cost_overrides"),
      getTableColumns(client, "purchases"),
      getTableColumns(client, "purchase_items"),
      getTableColumns(client, "returns"),
      getTableColumns(client, "return_items"),
      getTableColumns(client, "customers"),
    ]);

  const { tenantId, from, to, comparison, days, granularity: requestedGranularity, branchId } = filters;
  const granularity = resolveGranularity(requestedGranularity, days);

  // $1 is always the tenant id when scoped, which buildCostContext relies on.
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
  // Every order filter, from the one shared builder. branchId used to be applied here by
  // hand while channel, paymentMethod, customerId, shiftId and salespersonId were ignored
  // on this page but honoured on others.
  const orderFilters = orderFilterClauses({ filters, orderColumns, bind });
  orderClauses.push(...orderFilters.clauses);
  orderClauses.push(...canonicalOrderClauses(orderColumns).clauses);
  // The scan must cover both windows so FILTER can split them.
  const widestFrom = comparison && comparison.from < from ? previousFrom : currentFrom;
  const widestTo = comparison && comparison.to > to ? previousTo : currentTo;
  orderClauses.push(`o.created_at >= ${widestFrom}::date AND o.created_at < (${widestTo}::date + INTERVAL '1 day')`);

  const costContext = buildCostContext({
    orderColumns, itemColumns, productColumns, variantColumns,
    overrideColumns, purchaseColumns, purchaseItemColumns, tenantId,
  });

  const tenantClause = (alias, columns) =>
    tenantId !== null && columns.has("tenant_id") ? `${alias}.tenant_id = $1` : "TRUE";

  const scope = {
    orderWhere: whereSql(orderClauses),
    itemTenantClause: tenantId !== null && itemColumns.has("tenant_id") ? "WHERE oi.tenant_id = $1" : "",
    itemTenantClauseAnd: tenantId !== null && itemColumns.has("tenant_id") ? "AND oi.tenant_id = $1" : "",
    returnTenant: tenantClause("r", returnColumns),
    /*
     * D-21. A refund is only a deduction if the sale it reverses is still IN the counted
     * set. When a whole order is returned this ERP flips its status to `returned`, which
     * already removes the sale from every window — deducting the refund on top subtracts
     * revenue that was never added, and the screens that do not deduct it then disagree
     * with the ones that do.
     *
     * Found by the reconciliation harness the first time a real return landed on
     * production: customer revenue read 161,320 while the Overview read 159,620, a
     * constant 1,700 apart at every window, which was exactly the returned order's total.
     */
    refundedOrderCanonical: canonicalOrderClauses(orderColumns).clauses.join(" AND "),
    customerTenant: tenantClause("c", customerColumns),
    variantTenant: tenantClause("pv", variantColumns),
    productTenant: tenantClause("p", productColumns),
    currentFrom, currentTo, previousFrom, previousTo,
  };

  const ordersSql = buildOrdersQuery({ orderColumns, itemColumns, costContext, scope, granularity, includeCost });
  const contextSql = buildContextQuery({
    scope, includeCost, returnColumns, returnItemColumns, customerColumns,
    variantColumns, productColumns, orderColumns, itemColumns, costContext,
  });
  const categorySql = buildCategoryQuery({ scope, costContext, includeCost, itemColumns });
  const paymentMixSql = buildPaymentMixQuery({ scope, orderColumns });

  const timings = {};
  // Postgres rejects a bind that supplies more parameters than the statement's highest
  // $N. The three queries share one binder but reference different subsets (the category
  // query never touches the comparison window), so each gets exactly the prefix it uses.
  const timed = async (name, sql) => {
    const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    const startedAt = Date.now();
    const result = await client.query(sql, params.slice(0, highest));
    timings[name] = Date.now() - startedAt;
    return result;
  };

  // Four round trips. A failure here propagates as a 500 - never a zero.
  const [ordersResult, contextResult, categoryResult, paymentMixResult] = await Promise.all([
    timed("orders", ordersSql),
    timed("context", contextSql),
    timed("categories", categorySql),
    timed("paymentMix", paymentMixSql),
  ]);

  return assembleOverview({
    ordersRow: ordersResult.rows[0] || {},
    contextRow: contextResult.rows[0] || {},
    categoryRows: categoryResult.rows || [],
    paymentMixRows: paymentMixResult.rows || [],
    filters, granularity, includeCost, includeProfit, collector, timings,
  });
};

/**
 * Payment mix: one row per real payment method, plus the three settlement totals.
 *
 * Merging happens HERE, over the raw strings SQL grouped by, using the one normaliser the
 * POS, the till and the manager portal already share. `visa` and `card` are the same
 * method and must land on one row; two rows would look like two payment rails.
 *
 * `mixed` and an empty method are NOT silently folded into anything. They mean the
 * invoice never recorded which method paid it, so they get their own settlement class and
 * a warning carrying the amount — a report that spread them across the real methods would
 * be inventing the answer the manager asked for.
 *
 * The totals are PAID amounts on the period's invoices, which is not net sales: deposits
 * pay part of an invoice, returns are deducted from sales but not from what was collected,
 * and a deferred invoice reads as paid while nothing moved. netSales rides along so the UI
 * can state the gap instead of letting a manager assume the two must match.
 *
 * Exported for tests: the whole contract is a pure function over SQL rows.
 */
export const assemblePaymentMix = ({ rows = [], netSales = null, collector = new WarningCollector() } = {}) => {
  const merged = new Map();
  let unusableRows = 0;

  for (const row of rows) {
    unusableRows += Number(row?.unusable || 0);
    const key = normalizePaymentMethodKey(row?.method) || "unknown";
    const amount = toFiniteNumber(row?.amount);
    if (amount === null) {
      // The SUM itself is unreadable: count it rather than contributing a zero that
      // would understate the method with nothing on screen to say so.
      unusableRows += 1;
      continue;
    }
    const existing = merged.get(key) || { method: key, amount: 0, orders: 0 };
    existing.amount += amount;
    existing.orders += Number(row?.orders || 0);
    merged.set(key, existing);
  }

  const settlementOf = (method) =>
    method === "unknown" || method === "mixed" ? "unattributed" : paymentMethodSettlement(method);

  const totals = { collected: 0, pending: 0, credit: 0, unattributed: 0, all: 0 };
  for (const row of merged.values()) {
    totals[settlementOf(row.method)] += row.amount;
    totals.all += row.amount;
  }

  const result = {
    rows: Array.from(merged.values())
      .map((row) => ({
        method: row.method,
        settlement: settlementOf(row.method),
        amount: toMoney(row.amount),
        orders: row.orders,
        share: safeRatio(row.amount, totals.all),
      }))
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    totals: {
      collected: toMoney(totals.collected),
      pending: toMoney(totals.pending),
      credit: toMoney(totals.credit),
      unattributed: toMoney(totals.unattributed),
      all: toMoney(totals.all),
    },
    netSales,
  };

  if (unusableRows > 0) {
    collector.add(
      WARNING_CODES.NAN_VALUES_IGNORED,
      "Some payment allocations do not carry a usable amount, so the payment mix understates those methods.",
      { rows: unusableRows, metric: "paymentMix.amount" }
    );
  }
  if (totals.unattributed > 0) {
    collector.add(
      WARNING_CODES.PAYMENT_MIX_UNATTRIBUTED,
      "Some invoices record no payment method, so their value cannot be attributed to one.",
      { amount: toMoney(totals.unattributed), share: safeRatio(totals.unattributed, totals.all) }
    );
  }

  return result;
};

/**
 * Pure assembly of the four result sets into the response contract.
 * Exported so tests can drive it without a database.
 */
export const assembleOverview = ({ ordersRow, contextRow, categoryRows, paymentMixRows = [], filters, granularity, includeCost, includeProfit, collector = new WarningCollector(), timings = {} }) => {
  const totals = ordersRow.totals || {};
  const itemTotals = ordersRow.item_totals || {};
  const trendRows = Array.isArray(ordersRow.trend) ? ordersRow.trend : [];

  const num = (value) => (value === null || value === undefined ? null : Number(value));

  const netSalesCurrent = toMoney(num(totals.revenue_current) ?? 0);
  const netSalesPrevious = filters.comparison ? toMoney(num(totals.revenue_previous) ?? 0) : null;
  const returnsCurrent = toMoney(num(contextRow.returns_current));
  const returnsPrevious = filters.comparison ? toMoney(num(contextRow.returns_previous)) : null;

  // Net sales per the contract: gross - discount - returns. The order scan already
  // nets discount (and applies the exchange rule), so returns are deducted here.
  const netAfterReturns = (net, ret) => (net === null ? null : toMoney(net - (ret ?? 0)));
  const netSales = netAfterReturns(netSalesCurrent, returnsCurrent);
  const netSalesPrev = netAfterReturns(netSalesPrevious, returnsPrevious);

  const ordersCurrent = num(totals.orders_current) ?? 0;
  const ordersPrevious = filters.comparison ? num(totals.orders_previous) ?? 0 : null;
  const unitsCurrent = num(itemTotals.units_current) ?? 0;
  const unitsPrevious = filters.comparison ? num(itemTotals.units_previous) ?? 0 : null;
  const grossCurrent = toMoney(num(totals.gross_current) ?? 0);
  const grossPrevious = filters.comparison ? toMoney(num(totals.gross_previous) ?? 0) : null;
  const discountCurrent = toMoney(num(totals.discount_current) ?? 0);
  const discountPrevious = filters.comparison ? toMoney(num(totals.discount_previous) ?? 0) : null;

  const cogsCurrent = includeCost ? toMoney(num(itemTotals.cogs_current) ?? 0) : null;
  const cogsPrevious = includeCost && filters.comparison ? toMoney(num(itemTotals.cogs_previous) ?? 0) : null;
  const costedUnits = includeCost ? num(itemTotals.costed_units_current) ?? 0 : null;
  const cogsCoverage = includeCost ? safeRatio(costedUnits, unitsCurrent) : null;

  const grossProfitCurrent = includeProfit && cogsCurrent !== null && netSales !== null ? toMoney(netSales - cogsCurrent) : null;
  const grossProfitPrevious = includeProfit && cogsPrevious !== null && netSalesPrev !== null ? toMoney(netSalesPrev - cogsPrevious) : null;

  const kpi = (key, current, previous, extra = {}) => ({
    ...buildDelta(current, previous, { collector, metric: key }),
    favourable: METRIC_DIRECTION[key] || "neutral",
    ...extra,
  });

  const kpis = {
    netSales: kpi("netSales", netSales, netSalesPrev),
    grossProfit: kpi("grossProfit", grossProfitCurrent, grossProfitPrevious),
    grossMargin: kpi("grossMargin", safeRatio(grossProfitCurrent, netSales), safeRatio(grossProfitPrevious, netSalesPrev)),
    orders: kpi("orders", ordersCurrent, ordersPrevious),
    averageOrderValue: kpi("averageOrderValue", safeRatio(netSales, ordersCurrent), safeRatio(netSalesPrev, ordersPrevious)),
    itemsSold: kpi("itemsSold", unitsCurrent, unitsPrevious),
    itemsPerOrder: kpi("itemsPerOrder", safeRatio(unitsCurrent, ordersCurrent), safeRatio(unitsPrevious, ordersPrevious)),
    discountRate: kpi("discountRate", safeRatio(discountCurrent, grossCurrent), safeRatio(discountPrevious, grossPrevious)),
    returns: kpi("returns", returnsCurrent, returnsPrevious),
    returnRate: kpi("returnRate", safeRatio(returnsCurrent, grossCurrent), safeRatio(returnsPrevious, grossPrevious)),
    newCustomers: kpi("newCustomers", num(contextRow.new_customers_current), filters.comparison ? num(contextRow.new_customers_previous) : null),
    inventoryValue: kpi("inventoryValue", includeCost ? toMoney(num(contextRow.inventory_value)) : null, null),
  };

  // Coverage policy: warn under 95%, blank profit under 50%.
  if (includeProfit) {
    const policed = applyCogsCoveragePolicy({
      coverage: cogsCoverage,
      values: { grossProfit: kpis.grossProfit.current, grossMargin: kpis.grossMargin.current },
      collector,
      uncostedUnits: costedUnits === null ? null : Math.max(unitsCurrent - costedUnits, 0),
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
  if (!includeCost) {
    kpis.inventoryValue = { ...kpis.inventoryValue, current: null, previous: null, delta: null, deltaPercent: null, restricted: true };
  }

  /* -------------------------------------------------------------- data quality */

  if (returnsCurrent === null && (contextRow.returns_current === null || contextRow.returns_current === undefined)) {
    collector.add(WARNING_CODES.RETURNS_FALLBACK_USED, "Return tables unavailable; returns are not deducted.");
  }
  if (Number(contextRow.orphan_return_items || 0) > 0) {
    collector.add(WARNING_CODES.ORPHAN_RETURN_ITEMS, "Some return lines cannot be attributed to a sold line.", {
      rows: Number(contextRow.orphan_return_items),
    });
  }
  // Only the orphan shape — an exchange whose original was never returned. The POS
  // reverses the original first, and warning on those would fire when nothing is wrong.
  if (Number(totals.exchange_orders_current || 0) > 0) {
    collector.add(WARNING_CODES.EXCHANGE_COGS_UNREVERSED, "Exchange originals are not cost-reversed.", {
      orders: Number(totals.exchange_orders_current),
    });
  }
  const creditRetained = toMoney(num(totals.credit_retained_current));
  if (creditRetained !== null && creditRetained > 0) {
    collector.add(WARNING_CODES.EXCHANGE_CREDIT_RETAINED, "Net sales include exchange credit the customer has not consumed.", {
      creditRetained,
    });
  }
  if (includeCost) {
    const legacyStock = num(contextRow.legacy_products_stock);
    const liveStock = num(contextRow.units_in_stock);
    if (legacyStock !== null && liveStock !== null && legacyStock !== liveStock) {
      collector.add(WARNING_CODES.STOCK_SOURCE_DIVERGENCE, "products.stock disagrees with product_variants.stock.", {
        productsStock: legacyStock, variantsStock: liveStock,
      });
    }
    const stockCoverage = safeRatio(num(contextRow.costed_units_in_stock), liveStock);
    if (stockCoverage !== null && stockCoverage < COGS_COVERAGE_WARN_THRESHOLD) {
      collector.add(WARNING_CODES.INVENTORY_COST_COVERAGE_LOW, "Some on-hand units have no resolvable cost.", { coverage: stockCoverage });
    }
  }

  /* ------------------------------------------------------------------- trend */

  const trend = trendRows.map((row) => {
    const bucketNet = toMoney(num(row.net_sales) ?? 0);
    const bucketCogs = includeProfit ? toMoney(num(row.cogs)) : null;
    const bucketUnits = num(row.units) ?? 0;
    const bucketCoverage = includeProfit ? safeRatio(num(row.costed_units), bucketUnits) : null;
    // A bucket whose cost coverage is too thin reports null profit rather than a
    // misleading zero, so the chart can draw a gap instead of a false line.
    const profitAvailable = includeProfit && bucketCogs !== null && (bucketCoverage === null || bucketCoverage >= COGS_COVERAGE_CRITICAL_THRESHOLD);
    const grossProfit = profitAvailable ? toMoney(bucketNet - bucketCogs) : null;
    return {
      bucket: row.bucket,
      netSales: bucketNet,
      grossProfit,
      grossMargin: safeRatio(grossProfit, bucketNet),
      orders: num(row.orders) ?? 0,
      cogsCoverage: bucketCoverage,
    };
  });

  /* -------------------------------------------------------------- categories */

  // Sum through the shared helper, and COUNT what it refused. Number(x) || 0 would let a
  // non-finite category contribute zero and disappear from the total, understating it
  // with nothing on screen to say so — the same fault as D-01, one layer up.
  let unusableCategoryRows = 0;
  const categoryNet = (row) => {
    const value = num(row.net_sales);
    if (value === null) {
      unusableCategoryRows += 1;
      return 0;
    }
    return value;
  };

  const categoryTotal = categoryRows.reduce((sum, row) => sum + categoryNet(row), 0);
  const named = categoryRows.filter((row) => row.category);
  const unnamedTotal = categoryRows
    .filter((row) => !row.category)
    .reduce((sum, row) => sum + categoryNet(row), 0);

  const TOP_N = 8;
  const top = named.slice(0, TOP_N).map((row) => {
    const net = toMoney(num(row.net_sales) ?? 0);
    const units = num(row.units) ?? 0;
    const rowCogs = includeProfit ? toMoney(num(row.cogs)) : null;
    const coverage = includeProfit ? safeRatio(num(row.costed_units), units) : null;
    const profitAvailable = includeProfit && rowCogs !== null && (coverage === null || coverage >= COGS_COVERAGE_CRITICAL_THRESHOLD);
    const grossProfit = profitAvailable ? toMoney(net - rowCogs) : null;
    return {
      category: row.category,
      netSales: net,
      units,
      grossProfit,
      grossMargin: safeRatio(grossProfit, net),
      contribution: safeRatio(net, categoryTotal),
    };
  });

  // Never let a residual bucket hide a dominant amount: it carries its own value and
  // the number of categories it represents.
  const remainder = named.slice(TOP_N).reduce((sum, row) => sum + categoryNet(row), 0) + unnamedTotal;
  const categories = {
    rows: top,
    other: remainder > 0
      ? {
          netSales: toMoney(remainder),
          contribution: safeRatio(remainder, categoryTotal),
          categoryCount: Math.max(named.length - TOP_N, 0) + (unnamedTotal > 0 ? 1 : 0),
          includesUncategorised: unnamedTotal > 0,
        }
      : null,
    total: toMoney(categoryTotal),
  };

  if (unusableCategoryRows > 0) {
    collector.add(
      WARNING_CODES.NAN_VALUES_IGNORED,
      "Some category sales totals are not a usable number and were treated as zero, so the category breakdown understates the period.",
      { rows: unusableCategoryRows, metric: "categories.netSales" }
    );
  }

  if (unnamedTotal > 0 && categoryTotal > 0 && unnamedTotal / categoryTotal > 0.2) {
    collector.add(WARNING_CODES.UNCATEGORISED_SALES_HIGH, "A large share of sales has no category assigned.", {
      uncategorisedShare: safeRatio(unnamedTotal, categoryTotal),
      uncategorisedValue: toMoney(unnamedTotal),
    });
  }

  /* ------------------------------------------------------------ payment mix */

  const paymentMix = assemblePaymentMix({ rows: paymentMixRows, netSales, collector });

  const highlights = buildHighlights({ kpis, cogsCoverage });

  return {
    data: {
      period: { from: filters.from, to: filters.to, days: filters.days, granularity },
      comparison: filters.comparison ? { ...filters.comparison, mode: filters.comparisonMode } : null,
      kpis,
      trend,
      categories,
      paymentMix,
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
