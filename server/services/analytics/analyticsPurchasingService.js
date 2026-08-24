import db from "../../database/db.js";
import {
  WARNING_CODES,
  WarningCollector,
  buildDelta,
  buildEnvelope,
  safeRatio,
  toFiniteNumber,
  toMoney,
} from "./analyticsComparison.js";
import {
  buildCostContext,
  canonicalOrderClauses,
  categoryNameExpr,
  nanSafe,
  orderRevenueExpr,
  productTypeExpr,
  recognisedPurchaseClauses,
} from "./analyticsMetrics.js";

/**
 * R5 — Purchasing & Supplier Intelligence.
 *
 * The question this screen answers is "what did we buy, from whom, at what price, and is
 * that price moving?" — not "list the purchase orders". Everything here is an aggregate
 * over `purchases` + `purchase_items`, never a row listing.
 *
 * THREE THINGS THAT WOULD OTHERWISE PRODUCE A WRONG NUMBER, all handled explicitly:
 *
 * 1. `purchases.total` can hold a Postgres NUMERIC NaN (legacy defect D-01). NaN
 *    propagates through SUM and turns a whole aggregate into NaN, which then renders as
 *    a blank or a dash and reads as "no purchases". Every money expression in this file
 *    goes through nanSafe(), and the rows that were NaN are COUNTED and reported as a
 *    warning rather than silently neutralised — a shop with poisoned purchase totals
 *    needs to know that, not to be protected from knowing it.
 *
 * 2. Header total and line total are two different numbers. `purchases.total` carries
 *    tax and header discount; the sum of `purchase_items.total` does not have to match
 *    it, and on real data it often does not. Spend KPIs use the HEADER (it is what was
 *    owed to the supplier); anything broken down per product or per category has to use
 *    LINES (a header cannot be attributed to a product). The two are reconciled on every
 *    request and a material gap raises PURCHASE_LINE_HEADER_DELTA rather than letting a
 *    breakdown quietly fail to add up to its own KPI.
 *
 * 3. Supplier returns are NOT a purchase-return table — this schema has none. The only
 *    supplier-return record is `supplier_return_items`, which is raised from a CUSTOMER
 *    return (a manufacturing defect sent back up the chain). Its cohort is therefore not
 *    the units purchased in the same window, and a naive "return rate" divides two
 *    unrelated populations. The rate is still useful as an operational signal, so it is
 *    reported WITH SUPPLIER_RETURN_COHORT_MISMATCH attached, never as a clean ratio.
 *
 * NOT implemented, deliberately:
 *
 *   Supplier lead time      `purchases` records one timestamp. There is no ordered-at
 *                           versus received-at pair, so elapsed time to delivery is not
 *                           derivable and any figure would be invented.
 *   Supplier debt balance   `suppliers.debt_balance` is the suppliers module's own
 *                           all-time ledger. Mixing it into a window-scoped report would
 *                           create a second, competing definition of what is owed. This
 *                           report publishes `unpaidPurchaseValue`, which is explicitly
 *                           "total minus paid, on purchases recognised IN THIS WINDOW".
 *   Reorder recommendations `/purchases/reorder-suggestions` already owns BUY_NOW /
 *                           DO_NOT_BUY and its sell-through rules. Re-deriving them here
 *                           would be a fifth place that computes what to buy.
 */

/* ------------------------------------------------------------------ allowlists */

/**
 * Breakdown dimensions. Supplier is the default: it is the axis the report exists for,
 * and unlike category it is a NOT NULL foreign key, so it is populated on every row.
 */
export const PURCHASING_DIMENSIONS = Object.freeze({
  supplier: { expr: () => "COALESCE(NULLIF(TRIM(s.name), ''), 'مورد غير محدد')", join: "LEFT JOIN suppliers s ON s.id = sl.supplier_id" },
  product_type: { expr: () => `COALESCE(${productTypeExpr()}, 'غير محدد')`, join: "LEFT JOIN products p ON p.id = sl.product_id" },
  brand: { expr: () => "COALESCE(NULLIF(TRIM(br.name), ''), 'بدون علامة')", join: "LEFT JOIN products p ON p.id = sl.product_id\nLEFT JOIN brands br ON br.id = p.brand_id" },
  category: { expr: () => `COALESCE(${categoryNameExpr()}, 'غير مصنف')`, join: "LEFT JOIN products p ON p.id = sl.product_id\nLEFT JOIN categories cat ON cat.id = p.category_id" },
});

export const DEFAULT_PURCHASING_DIMENSION = "supplier";

/** Sort keys map to fixed SQL. Nothing from the request is ever interpolated. */
export const PURCHASING_PRODUCT_SORTS = Object.freeze({
  spend: "spend",
  units: "units",
  unit_cost: "unit_cost",
  cost_change: "unit_cost_delta_percent",
  purchases: "purchase_count",
  product: "product_name",
});
export const DEFAULT_PURCHASING_PRODUCT_SORT = "spend";

export const SUPPLIER_SORTS = Object.freeze({
  spend: "spend",
  units: "units",
  purchases: "purchase_count",
  average_purchase: "average_purchase_value",
  unpaid: "unpaid_value",
  products: "product_count",
  returns: "return_units",
  supplier: "supplier_name",
});
export const DEFAULT_SUPPLIER_SORT = "spend";

/** Beyond this the sum of the lines and the header total are telling different stories. */
export const LINE_HEADER_TOLERANCE = 0.02;

/** A cost move smaller than this is noise, not a price change worth surfacing. */
export const PRICE_MOVE_THRESHOLD = 0.05;

export const MATRIX_LIMIT = 300;

/* ----------------------------------------------------------------------- scope */

const loadColumns = async (client) => {
  const read = async (table) => {
    const result = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
      [table]
    );
    return new Set(result.rows.map((row) => row.column_name));
  };
  const [
    purchaseColumns, purchaseItemColumns, productColumns, variantColumns,
    supplierColumns, orderColumns, itemColumns, overrideColumns, supplierReturnColumns,
  ] = await Promise.all([
    read("purchases"), read("purchase_items"), read("products"), read("product_variants"),
    read("suppliers"), read("orders"), read("order_items"),
    read("accounting_order_item_cost_overrides"), read("supplier_return_items"),
  ]);
  return {
    purchaseColumns, purchaseItemColumns, productColumns, variantColumns,
    supplierColumns, orderColumns, itemColumns, overrideColumns, supplierReturnColumns,
  };
};

const columnOr = (alias, columns, candidates, fallback) => {
  const found = candidates.find((column) => columns.has(column));
  return found ? `${alias}.${found}` : fallback;
};

const TIME_BUCKETS = Object.freeze({
  hour: "date_trunc('hour', sp.created_at)",
  day: "date_trunc('day', sp.created_at)",
  week: "date_trunc('week', sp.created_at)",
  month: "date_trunc('month', sp.created_at)",
});

/**
 * Everything every purchasing query needs: tenant, the widest window covering both
 * comparison periods, the canonical recognised-purchase predicate, and the product
 * attribute filters. Built once so the four endpoints cannot drift apart.
 */
const buildScope = ({ filters, columns }) => {
  const { purchaseColumns, purchaseItemColumns, productColumns } = columns;
  const { tenantId, from, to, comparison } = filters;

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

  const purchaseWhere = [];
  if (tenantId !== null && purchaseColumns.has("tenant_id")) purchaseWhere.push("pu.tenant_id = $1");
  if (filters.branchId && purchaseColumns.has("branch_id")) purchaseWhere.push(`pu.branch_id = ${bind(filters.branchId)}`);
  if (filters.warehouseId && purchaseColumns.has("warehouse_id")) purchaseWhere.push(`pu.warehouse_id = ${bind(filters.warehouseId)}`);
  if (filters.supplierId && purchaseColumns.has("supplier_id")) purchaseWhere.push(`pu.supplier_id = ${bind(filters.supplierId)}`);
  purchaseWhere.push(...recognisedPurchaseClauses(purchaseColumns, { alias: "pu" }));

  const widestFrom = comparison && comparison.from < from ? previousFrom : currentFrom;
  const widestTo = comparison && comparison.to > to ? previousTo : currentTo;
  purchaseWhere.push(`pu.created_at >= ${widestFrom}::date AND pu.created_at < (${widestTo}::date + INTERVAL '1 day')`);

  // Product-attribute filters apply to the LINES, not the purchase headers: a purchase
  // that contains one sneaker line and one bag line belongs to both filters, partially.
  const lineWhere = [];
  if (tenantId !== null && purchaseItemColumns.has("tenant_id")) lineWhere.push("pit.tenant_id = $1");
  if (filters.productId) lineWhere.push(`pit.product_id = ${bind(filters.productId)}`);
  if (filters.productType) lineWhere.push(`LOWER(TRIM(COALESCE(p.product_type,''))) = LOWER(${bind(filters.productType)})`);
  if (filters.brandId && productColumns.has("brand_id")) lineWhere.push(`p.brand_id = ${bind(filters.brandId)}`);
  if (filters.gender && productColumns.has("gender")) lineWhere.push(`LOWER(TRIM(COALESCE(p.gender,''))) = LOWER(${bind(filters.gender)})`);
  if (filters.category) {
    lineWhere.push(
      filters.category === "__uncategorised__"
        ? `${categoryNameExpr()} IS NULL`
        : `${categoryNameExpr()} = ${bind(filters.category)}`
    );
  }
  if (filters.search) {
    const term = bind(`%${filters.search}%`);
    lineWhere.push(`(COALESCE(p.name,'') ILIKE ${term} OR COALESCE(p.sku,'') ILIKE ${term} OR COALESCE(p.brand,'') ILIKE ${term})`);
  }

  // The category ladder reads cat.name, so a category filter needs the join in every
  // query that applies lineWhere — not only the category breakdown.
  const needsCategoryJoin = Boolean(filters.category);

  return {
    params,
    bind,
    tenantId,
    tenantScoped: tenantId !== null,
    currentFrom, currentTo, previousFrom, previousTo,
    hasComparison: Boolean(comparison),
    purchaseWhere: purchaseWhere.length ? purchaseWhere.join(" AND ") : "TRUE",
    lineWhere: lineWhere.length ? lineWhere.join(" AND ") : "TRUE",
    lineFilterJoins: [
      "LEFT JOIN products p ON p.id = pit.product_id",
      needsCategoryJoin ? "LEFT JOIN categories cat ON cat.id = p.category_id" : "",
    ].filter(Boolean).join("\n"),
  };
};

/**
 * The CTE stack every endpoint starts from.
 *
 * `scoped_purchases` is header-level (one row per purchase order) and owns the spend
 * KPIs. `scoped_lines` is line-level and owns everything attributed to a product,
 * category or supplier. Keeping them separate is what makes the header/line
 * reconciliation possible instead of hiding the gap inside one query.
 */
const purchasingCte = ({ scope, columns }) => {
  const { purchaseColumns, purchaseItemColumns } = columns;

  const headerTotal = nanSafe(columnOr("pu", purchaseColumns, ["total", "total_amount", "grand_total"], "0"));
  const headerPaid = nanSafe(columnOr("pu", purchaseColumns, ["paid_amount", "paid"], "0"));
  const headerTotalRaw = columnOr("pu", purchaseColumns, ["total", "total_amount", "grand_total"], "0");

  const quantity = `GREATEST(COALESCE(${columnOr("pit", purchaseItemColumns, ["quantity", "qty"], "0")}, 0), 0)`;
  const unitCost = nanSafe(columnOr("pit", purchaseItemColumns, ["cost_price", "unit_cost", "price"], "0"));
  const lineTotalRaw = columnOr("pit", purchaseItemColumns, ["total", "line_total", "subtotal"], "NULL");
  // A stored line total of 0 is indistinguishable from "never populated", so fall back to
  // quantity x unit cost. Both are zero for a genuinely free line, so nothing is invented.
  const lineValue = lineTotalRaw === "NULL"
    ? `(${quantity} * ${unitCost})`
    : `COALESCE(NULLIF(${nanSafe(lineTotalRaw)}, 0), ${quantity} * ${unitCost})`;

  return `
    scoped_purchases AS (
      SELECT pu.id                                         AS purchase_id,
             pu.supplier_id                                AS supplier_id,
             pu.created_at                                 AS created_at,
             ${headerTotal}                                AS total,
             ${headerPaid}                                 AS paid_amount,
             (${headerTotalRaw})::text = 'NaN'             AS total_is_nan,
             (pu.created_at >= ${scope.currentFrom}::date AND pu.created_at < (${scope.currentTo}::date + INTERVAL '1 day')) AS in_current,
             ${scope.previousFrom
                ? `(pu.created_at >= ${scope.previousFrom}::date AND pu.created_at < (${scope.previousTo}::date + INTERVAL '1 day'))`
                : "FALSE"}                                 AS in_previous
      FROM purchases pu
      WHERE ${scope.purchaseWhere}
    ),
    scoped_lines AS (
      SELECT sp.purchase_id,
             sp.supplier_id,
             sp.created_at,
             sp.in_current,
             sp.in_previous,
             pit.product_id,
             ${purchaseItemColumns.has("variant_id") ? "pit.variant_id" : "NULL::bigint"} AS variant_id,
             ${quantity}                                   AS quantity,
             ${unitCost}                                   AS unit_cost,
             ${lineValue}                                  AS line_value
      FROM purchase_items pit
      JOIN scoped_purchases sp ON sp.purchase_id = pit.purchase_id
      ${scope.lineFilterJoins}
      WHERE ${scope.lineWhere}
    )
  `;
};

const runTimed = async (client, sql, params, timings, name) => {
  const startedAt = Date.now();
  const result = await client.query(sql, params);
  timings[name] = Date.now() - startedAt;
  return result;
};

/** Money that the caller is not allowed to see is absent from the payload, not blanked. */
const money = (value, includeCost) => (includeCost ? toMoney(toFiniteNumber(value) ?? 0) : null);

const restrictedMoney = (current, previous, includeCost, collector, metric) => {
  if (!includeCost) return { current: null, restricted: true };
  return buildDelta(toMoney(toFiniteNumber(current) ?? 0), previous === null ? null : toMoney(toFiniteNumber(previous) ?? 0), { collector, metric });
};

const countDelta = (current, previous, collector, metric) =>
  buildDelta(toFiniteNumber(current) ?? 0, previous === null ? null : toFiniteNumber(previous) ?? 0, { collector, metric });

/**
 * Raise the NaN warning when — and only when — poisoned rows were actually found.
 * The guard is always on; the warning is evidence that it did something.
 */
const reportNaN = (collector, nanRows) => {
  const rows = toFiniteNumber(nanRows) ?? 0;
  if (rows > 0) {
    collector.add(
      WARNING_CODES.NAN_VALUES_IGNORED,
      "Some purchase totals are stored as NaN and were treated as zero. The underlying rows need correcting.",
      { rows }
    );
  }
  return rows;
};

/** Header spend versus the sum of its own lines, so a breakdown never silently disagrees. */
const reportLineHeaderDelta = (collector, headerSpend, lineSpend) => {
  const header = toFiniteNumber(headerSpend);
  const lines = toFiniteNumber(lineSpend);
  if (header === null || lines === null || header === 0) return null;
  const ratio = Math.abs(header - lines) / Math.abs(header);
  if (ratio > LINE_HEADER_TOLERANCE) {
    collector.add(
      "PURCHASE_LINE_HEADER_DELTA",
      "Purchase line values do not sum to the purchase totals. Spend KPIs use the totals; every per-product and per-category figure uses the lines, so the two will not match.",
      { headerSpend: toMoney(header), lineSpend: toMoney(lines), deltaPercent: ratio }
    );
  }
  return ratio;
};

/* -------------------------------------------------------------------- summary */

export const getPurchasingSummary = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  const granularity = filters.granularity && filters.granularity !== "auto"
    ? filters.granularity
    : filters.days <= 2 ? "hour" : filters.days <= 62 ? "day" : filters.days <= 240 ? "week" : "month";
  const bucket = TIME_BUCKETS[granularity] || TIME_BUCKETS.day;

  const sql = `
    WITH ${purchasingCte({ scope, columns })},
    header_totals AS (
      SELECT
        COUNT(*) FILTER (WHERE in_current)                                        AS purchases_current,
        COUNT(*) FILTER (WHERE in_previous)                                       AS purchases_previous,
        COALESCE(SUM(total) FILTER (WHERE in_current), 0)                         AS spend_current,
        COALESCE(SUM(total) FILTER (WHERE in_previous), 0)                        AS spend_previous,
        COALESCE(SUM(GREATEST(total - paid_amount, 0)) FILTER (WHERE in_current), 0)  AS unpaid_current,
        COALESCE(SUM(GREATEST(total - paid_amount, 0)) FILTER (WHERE in_previous), 0) AS unpaid_previous,
        COUNT(DISTINCT supplier_id) FILTER (WHERE in_current)                     AS suppliers_current,
        COUNT(DISTINCT supplier_id) FILTER (WHERE in_previous)                    AS suppliers_previous,
        COUNT(*) FILTER (WHERE total_is_nan)                                      AS nan_rows
      FROM scoped_purchases
    ),
    line_totals AS (
      SELECT
        COALESCE(SUM(quantity) FILTER (WHERE in_current), 0)                      AS units_current,
        COALESCE(SUM(quantity) FILTER (WHERE in_previous), 0)                     AS units_previous,
        COALESCE(SUM(line_value) FILTER (WHERE in_current), 0)                    AS line_spend_current,
        COALESCE(SUM(line_value) FILTER (WHERE in_previous), 0)                   AS line_spend_previous,
        COUNT(DISTINCT product_id) FILTER (WHERE in_current AND product_id IS NOT NULL) AS products_current,
        COUNT(DISTINCT product_id) FILTER (WHERE in_previous AND product_id IS NOT NULL) AS products_previous
      FROM scoped_lines
    ),
    concentration AS (
      SELECT supplier_id, SUM(total) AS spend
      FROM scoped_purchases
      WHERE in_current
      GROUP BY supplier_id
    ),
    trend AS (
      SELECT ${bucket}                       AS bucket,
             COUNT(*)                        AS purchases,
             COALESCE(SUM(sp.total), 0)      AS spend
      FROM scoped_purchases sp
      WHERE sp.in_current
      GROUP BY 1
    ),
    trend_units AS (
      SELECT ${bucket.replace(/sp\./g, "sl.")} AS bucket,
             COALESCE(SUM(sl.quantity), 0)     AS units
      FROM scoped_lines sl
      WHERE sl.in_current
      GROUP BY 1
    )
    SELECT
      (SELECT row_to_json(h) FROM header_totals h)  AS headers,
      (SELECT row_to_json(l) FROM line_totals l)    AS lines,
      (SELECT COALESCE(json_agg(json_build_object('supplierId', supplier_id, 'spend', spend) ORDER BY spend DESC), '[]'::json) FROM concentration) AS concentration,
      (SELECT COALESCE(json_agg(json_build_object('bucket', t.bucket, 'purchases', t.purchases, 'spend', t.spend, 'units', COALESCE(tu.units, 0)) ORDER BY t.bucket), '[]'::json)
         FROM trend t LEFT JOIN trend_units tu ON tu.bucket = t.bucket) AS trend
  `;

  const result = await runTimed(client, sql, scope.params, timings, "summary");
  const row = result.rows[0] || {};
  const headers = row.headers || {};
  const lines = row.lines || {};
  const concentrationRows = row.concentration || [];
  const trendRows = row.trend || [];

  reportNaN(collector, headers.nan_rows);
  if (includeCost) reportLineHeaderDelta(collector, headers.spend_current, lines.line_spend_current);

  const spendCurrent = toFiniteNumber(headers.spend_current) ?? 0;
  const unitsCurrent = toFiniteNumber(lines.units_current) ?? 0;
  const purchasesCurrent = toFiniteNumber(headers.purchases_current) ?? 0;
  const unitsPrevious = scope.hasComparison ? toFiniteNumber(lines.units_previous) ?? 0 : null;
  const spendPrevious = scope.hasComparison ? toFiniteNumber(headers.spend_previous) ?? 0 : null;
  const purchasesPrevious = scope.hasComparison ? toFiniteNumber(headers.purchases_previous) ?? 0 : null;

  const concentration = buildConcentration(concentrationRows, spendCurrent, includeCost);
  const relationship = await loadPurchaseVsSales({ filters, columns, client, timings, includeCost, spendCurrent });
  const supplierReturns = await loadSupplierReturns({ filters, columns, client, timings, collector, unitsCurrent });

  return buildEnvelope({
    meta: {
      permissions: { cost: includeCost, profit: Boolean(permissions.profit) },
      granularity,
      timings,
      // Spend is header-level; anything per-product is line-level. Stated in the payload
      // so the UI can say so on screen rather than leaving a manager to guess.
      basis: { spend: "purchase_header_total", attribution: "purchase_line_value" },
    },
    data: {
      kpis: {
        purchaseSpend: restrictedMoney(headers.spend_current, spendPrevious, includeCost, collector, "purchaseSpend"),
        purchaseOrders: countDelta(purchasesCurrent, purchasesPrevious, collector, "purchaseOrders"),
        purchaseUnits: countDelta(unitsCurrent, unitsPrevious, collector, "purchaseUnits"),
        averagePurchaseValue: includeCost
          ? buildDelta(
              toMoney(safeRatio(spendCurrent, purchasesCurrent)),
              spendPrevious === null ? null : toMoney(safeRatio(spendPrevious, purchasesPrevious)),
              { collector, metric: "averagePurchaseValue" }
            )
          : { current: null, restricted: true },
        averageUnitCost: includeCost
          ? buildDelta(
              toMoney(safeRatio(toFiniteNumber(lines.line_spend_current), unitsCurrent)),
              spendPrevious === null ? null : toMoney(safeRatio(toFiniteNumber(lines.line_spend_previous), unitsPrevious)),
              { collector, metric: "averageUnitCost" }
            )
          : { current: null, restricted: true },
        activeSuppliers: countDelta(
          headers.suppliers_current,
          scope.hasComparison ? headers.suppliers_previous : null,
          collector,
          "activeSuppliers"
        ),
        purchasedProducts: countDelta(
          lines.products_current,
          scope.hasComparison ? lines.products_previous : null,
          collector,
          "purchasedProducts"
        ),
        unpaidPurchaseValue: restrictedMoney(
          headers.unpaid_current,
          scope.hasComparison ? headers.unpaid_previous : null,
          includeCost,
          collector,
          "unpaidPurchaseValue"
        ),
        supplierReturnUnits: { current: supplierReturns.units },
      },
      trend: trendRows.map((entry) => ({
        bucket: entry.bucket,
        purchases: toFiniteNumber(entry.purchases) ?? 0,
        units: toFiniteNumber(entry.units) ?? 0,
        spend: money(entry.spend, includeCost),
      })),
      concentration,
      supplierReturns,
      purchaseVsSales: relationship,
      highlights: buildPurchasingHighlights({
        spendCurrent, spendPrevious, unitsCurrent, unitsPrevious,
        concentration, relationship, supplierReturns, includeCost,
        unpaid: toFiniteNumber(headers.unpaid_current) ?? 0,
      }),
    },
    filters,
    collector,
  });
};

/**
 * Supplier concentration.
 *
 * Three figures rather than one, because they answer different questions: the top
 * supplier's share is exposure to a single relationship, the top three is exposure to a
 * small group, and HHI is how evenly the whole spend is spread. HHI is the sum of squared
 * shares — 1.0 is a single supplier, 0.1 is roughly ten equal ones.
 *
 * Fewer than two suppliers yields no concentration at all rather than a meaningless 100%.
 */
export const buildConcentration = (rows, totalSpend, includeCost) => {
  const spends = rows
    .map((entry) => ({ supplierId: entry.supplierId, spend: toFiniteNumber(entry.spend) ?? 0 }))
    .filter((entry) => entry.spend > 0)
    .sort((a, b) => b.spend - a.spend);

  const total = toFiniteNumber(totalSpend) ?? 0;
  if (!includeCost) return { supplierCount: spends.length, topShare: null, topThreeShare: null, hhi: null, restricted: true };
  if (spends.length < 2 || total <= 0) {
    return { supplierCount: spends.length, topShare: null, topThreeShare: null, hhi: null };
  }

  const shares = spends.map((entry) => entry.spend / total);
  return {
    supplierCount: spends.length,
    topShare: shares[0] ?? null,
    topThreeShare: shares.slice(0, 3).reduce((sum, share) => sum + share, 0),
    hhi: shares.reduce((sum, share) => sum + share * share, 0),
  };
};

/**
 * Purchasing against selling, in the same window.
 *
 * The ratio is spend divided by COGS: above 1 the shop is buying stock faster than it is
 * selling it, below 1 it is drawing down. COGS comes from the canonical cost ladder via
 * buildCostContext — the same one accounting and R2/R3 use — so this cannot become a
 * fifth definition of cost of goods.
 *
 * Both sides are null when the caller may not see cost; a ratio built from one visible
 * side and one hidden one would leak the hidden one.
 */
const loadPurchaseVsSales = async ({ filters, columns, client, timings, includeCost, spendCurrent }) => {
  if (!includeCost) return { purchaseSpend: null, cogs: null, netSales: null, stockBuildRatio: null, restricted: true };

  const { orderColumns, itemColumns, productColumns, variantColumns, overrideColumns, purchaseColumns, purchaseItemColumns } = columns;
  const costContext = buildCostContext({
    orderColumns, itemColumns, productColumns, variantColumns,
    overrideColumns, purchaseColumns, purchaseItemColumns, tenantId: filters.tenantId,
  });

  const params = [];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.tenantId !== null) bind(filters.tenantId);
  const from = bind(filters.from);
  const to = bind(filters.to);

  const orderClauses = [];
  if (filters.tenantId !== null && orderColumns.has("tenant_id")) orderClauses.push("o.tenant_id = $1");
  if (filters.branchId && orderColumns.has("branch_id")) orderClauses.push(`o.branch_id = ${bind(filters.branchId)}`);
  orderClauses.push(...canonicalOrderClauses(orderColumns).clauses);
  orderClauses.push(`o.created_at >= ${from}::date AND o.created_at < (${to}::date + INTERVAL '1 day')`);

  const sql = `
    WITH sold AS (
      SELECT ${costContext.cogsExpr} AS cogs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      ${costContext.joins}
      WHERE ${orderClauses.join(" AND ")}
    ),
    revenue AS (
      SELECT COALESCE(SUM(${orderRevenueExpr(orderColumns)}), 0) AS net_sales
      FROM orders o
      WHERE ${orderClauses.join(" AND ")}
    )
    SELECT (SELECT cogs FROM sold) AS cogs, (SELECT net_sales FROM revenue) AS net_sales
  `;

  const result = await runTimed(client, sql, params, timings, "purchaseVsSales");
  const row = result.rows[0] || {};
  const cogs = toFiniteNumber(row.cogs);
  const spend = toFiniteNumber(spendCurrent) ?? 0;

  return {
    purchaseSpend: toMoney(spend),
    cogs: toMoney(cogs),
    netSales: toMoney(toFiniteNumber(row.net_sales)),
    // null, not 0, when nothing was sold: "bought without selling" is a real state that a
    // ratio cannot express, and 0 would read as "bought nothing".
    stockBuildRatio: safeRatio(spend, cogs),
  };
};

/**
 * Supplier returns, with their cohort caveat attached.
 *
 * supplier_return_items is raised from a customer return, so its population is not the
 * units purchased in this window. The rate is published because it is operationally
 * useful — a supplier whose goods keep coming back is a real signal — but never as a
 * clean ratio, and never without the warning.
 */
const loadSupplierReturns = async ({ filters, columns, client, timings, collector, unitsCurrent }) => {
  const { supplierReturnColumns } = columns;
  if (!supplierReturnColumns.size) {
    return { units: 0, suppliers: 0, rate: null, available: false };
  }

  const params = [];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const clauses = [];
  if (filters.tenantId !== null && supplierReturnColumns.has("tenant_id")) clauses.push(`sri.tenant_id = ${bind(filters.tenantId)}`);
  if (filters.supplierId && supplierReturnColumns.has("supplier_id")) clauses.push(`sri.supplier_id = ${bind(filters.supplierId)}`);
  clauses.push(`sri.created_at >= ${bind(filters.from)}::date AND sri.created_at < (${bind(filters.to)}::date + INTERVAL '1 day')`);
  if (supplierReturnColumns.has("status")) {
    clauses.push("LOWER(COALESCE(sri.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void')");
  }

  const sql = `
    SELECT COALESCE(SUM(GREATEST(COALESCE(sri.quantity, 0), 0)), 0) AS units,
           COUNT(DISTINCT sri.supplier_id) FILTER (WHERE sri.supplier_id IS NOT NULL) AS suppliers
    FROM supplier_return_items sri
    WHERE ${clauses.join(" AND ")}
  `;

  const result = await runTimed(client, sql, params, timings, "supplierReturns");
  const row = result.rows[0] || {};
  const units = toFiniteNumber(row.units) ?? 0;
  const rate = safeRatio(units, unitsCurrent);

  if (units > 0) {
    collector.add(
      "SUPPLIER_RETURN_COHORT_MISMATCH",
      "Supplier returns are raised from customer returns, so they are not drawn from the units purchased in this window. Read the rate as a signal, not as a proportion of these purchases.",
      { units, comparedAgainstUnits: unitsCurrent }
    );
  }

  return { units, suppliers: toFiniteNumber(row.suppliers) ?? 0, rate, available: true };
};

/**
 * Deterministic highlights. Every one states a fact already visible in the payload and
 * carries the numbers it was derived from — nothing here is a prediction or a score.
 */
export const buildPurchasingHighlights = ({
  spendCurrent, spendPrevious, unitsCurrent, unitsPrevious,
  concentration, relationship, supplierReturns, includeCost, unpaid,
}) => {
  const highlights = [];

  if (includeCost && spendPrevious !== null && spendPrevious > 0) {
    const change = (spendCurrent - spendPrevious) / spendPrevious;
    if (Math.abs(change) >= 0.2) {
      highlights.push({
        code: change > 0 ? "PURCHASE_SPEND_UP" : "PURCHASE_SPEND_DOWN",
        severity: "info",
        messageKey: change > 0 ? "highlights.spendUp" : "highlights.spendDown",
        metric: "purchaseSpend",
        values: { percent: Math.abs(change), current: toMoney(spendCurrent), previous: toMoney(spendPrevious) },
      });
    }
  }

  if (includeCost && relationship?.stockBuildRatio !== null && relationship?.stockBuildRatio !== undefined) {
    if (relationship.stockBuildRatio >= 1.5) {
      highlights.push({
        code: "STOCK_BUILDING_FASTER_THAN_SALES",
        severity: "warning",
        messageKey: "highlights.stockBuilding",
        metric: "stockBuildRatio",
        values: { ratio: relationship.stockBuildRatio, spend: relationship.purchaseSpend, cogs: relationship.cogs },
      });
    } else if (relationship.stockBuildRatio > 0 && relationship.stockBuildRatio <= 0.5) {
      highlights.push({
        code: "STOCK_DRAWING_DOWN",
        severity: "info",
        messageKey: "highlights.stockDrawdown",
        metric: "stockBuildRatio",
        values: { ratio: relationship.stockBuildRatio, spend: relationship.purchaseSpend, cogs: relationship.cogs },
      });
    }
  }

  if (includeCost && concentration?.topShare !== null && concentration?.topShare >= 0.5) {
    highlights.push({
      code: "SUPPLIER_CONCENTRATION_HIGH",
      severity: "warning",
      messageKey: "highlights.concentration",
      metric: "topShare",
      values: { share: concentration.topShare, suppliers: concentration.supplierCount },
    });
  }

  if (includeCost && unpaid > 0) {
    highlights.push({
      code: "UNPAID_PURCHASES",
      severity: "info",
      messageKey: "highlights.unpaid",
      metric: "unpaidPurchaseValue",
      values: { amount: toMoney(unpaid) },
    });
  }

  if (supplierReturns?.units > 0) {
    highlights.push({
      code: "SUPPLIER_RETURNS_RAISED",
      severity: "info",
      messageKey: "highlights.supplierReturns",
      metric: "supplierReturnUnits",
      values: { units: supplierReturns.units, suppliers: supplierReturns.suppliers },
    });
  }

  if (unitsPrevious !== null && unitsPrevious === 0 && unitsCurrent > 0) {
    highlights.push({
      code: "PURCHASING_RESUMED",
      severity: "info",
      messageKey: "highlights.resumed",
      metric: "purchaseUnits",
      values: { units: unitsCurrent },
    });
  }

  return highlights;
};

/* ------------------------------------------------------------------ breakdown */

export const getPurchasingBreakdown = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  const dimensionKey = PURCHASING_DIMENSIONS[filters.dimension] ? filters.dimension : DEFAULT_PURCHASING_DIMENSION;
  const dimension = PURCHASING_DIMENSIONS[dimensionKey];

  const sql = `
    WITH ${purchasingCte({ scope, columns })},
    grouped AS (
      SELECT ${dimension.expr()}                                      AS key,
             COALESCE(SUM(sl.line_value) FILTER (WHERE sl.in_current), 0)  AS spend,
             COALESCE(SUM(sl.quantity)   FILTER (WHERE sl.in_current), 0)  AS units,
             COALESCE(SUM(sl.line_value) FILTER (WHERE sl.in_previous), 0) AS spend_previous,
             COALESCE(SUM(sl.quantity)   FILTER (WHERE sl.in_previous), 0) AS units_previous,
             COUNT(DISTINCT sl.purchase_id) FILTER (WHERE sl.in_current)   AS purchase_count,
             COUNT(DISTINCT sl.product_id)  FILTER (WHERE sl.in_current AND sl.product_id IS NOT NULL) AS product_count
      FROM scoped_lines sl
      ${dimension.join}
      GROUP BY 1
    )
    SELECT * FROM grouped WHERE spend > 0 OR units > 0 ORDER BY spend DESC NULLS LAST, units DESC
  `;

  const result = await runTimed(client, sql, scope.params, timings, "breakdown");
  const rows = result.rows || [];
  const totalSpend = rows.reduce((sum, row) => sum + (toFiniteNumber(row.spend) ?? 0), 0);
  const totalUnits = rows.reduce((sum, row) => sum + (toFiniteNumber(row.units) ?? 0), 0);

  const mapped = rows.map((row) => {
    const spend = toFiniteNumber(row.spend) ?? 0;
    const units = toFiniteNumber(row.units) ?? 0;
    const spendPrevious = scope.hasComparison ? toFiniteNumber(row.spend_previous) ?? 0 : null;
    return {
      key: row.key,
      spend: money(spend, includeCost),
      units,
      purchaseCount: toFiniteNumber(row.purchase_count) ?? 0,
      productCount: toFiniteNumber(row.product_count) ?? 0,
      averageUnitCost: includeCost ? toMoney(safeRatio(spend, units)) : null,
      spendShare: includeCost ? safeRatio(spend, totalSpend) : null,
      unitShare: safeRatio(units, totalUnits),
      growth: includeCost && spendPrevious !== null ? safeRatio(spend - spendPrevious, spendPrevious) : null,
    };
  });

  // A dimension where everything lands in one bucket is not a segmentation. Say so rather
  // than drawing a single 100% bar and calling it analysis.
  const meaningful = mapped.filter((row) => row.key && !String(row.key).startsWith("غير") && !String(row.key).startsWith("بدون")).length;
  if (mapped.length > 0 && meaningful < 2) {
    collector.add(
      "DIMENSION_NOT_USABLE",
      "This dimension has no meaningful segmentation for the purchases in this period.",
      { dimension: dimensionKey, distinctMeaningfulValues: meaningful }
    );
  }

  return buildEnvelope({
    meta: {
      permissions: { cost: includeCost },
      dimension: dimensionKey,
      availableDimensions: Object.keys(PURCHASING_DIMENSIONS),
      timings,
      basis: { attribution: "purchase_line_value" },
    },
    data: {
      dimension: dimensionKey,
      rows: mapped,
      totals: { spend: money(totalSpend, includeCost), units: totalUnits },
    },
    filters,
    collector,
  });
};

/* ------------------------------------------------------------------- products */

/**
 * Top purchased products, and the price move behind each one.
 *
 * The unit cost is quantity-weighted (total line value over total units), not an average
 * of unit costs — an average of averages would let a single-unit line at an odd price
 * outweigh a hundred-unit line at the real price.
 *
 * A price move is only reported when BOTH windows have units. Comparing a real price
 * against nothing produces an infinite change, and reporting it as +100% would invent a
 * price rise that never happened.
 */
export const getPurchasingProducts = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  const sortKey = PURCHASING_PRODUCT_SORTS[filters.sort] || PURCHASING_PRODUCT_SORTS[DEFAULT_PURCHASING_PRODUCT_SORT];
  const sortDir = filters.sortDir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(filters.limit || 25, 1), 200);
  const offset = ((filters.page || 1) - 1) * limit;

  const sql = `
    WITH ${purchasingCte({ scope, columns })},
    per_product AS (
      SELECT sl.product_id,
             COALESCE(SUM(sl.line_value) FILTER (WHERE sl.in_current), 0)  AS spend,
             COALESCE(SUM(sl.quantity)   FILTER (WHERE sl.in_current), 0)  AS units,
             COALESCE(SUM(sl.line_value) FILTER (WHERE sl.in_previous), 0) AS spend_previous,
             COALESCE(SUM(sl.quantity)   FILTER (WHERE sl.in_previous), 0) AS units_previous,
             COUNT(DISTINCT sl.purchase_id) FILTER (WHERE sl.in_current)   AS purchase_count,
             COUNT(DISTINCT sl.supplier_id) FILTER (WHERE sl.in_current)   AS supplier_count,
             MAX(sl.created_at) FILTER (WHERE sl.in_current)               AS last_purchased_at
      FROM scoped_lines sl
      WHERE sl.product_id IS NOT NULL
      GROUP BY sl.product_id
    ),
    priced AS (
      SELECT pp.*,
             CASE WHEN pp.units > 0 THEN pp.spend / pp.units END                   AS unit_cost,
             CASE WHEN pp.units_previous > 0 THEN pp.spend_previous / pp.units_previous END AS unit_cost_previous,
             CASE
               WHEN pp.units > 0 AND pp.units_previous > 0 AND (pp.spend_previous / pp.units_previous) > 0
               THEN ((pp.spend / pp.units) - (pp.spend_previous / pp.units_previous)) / (pp.spend_previous / pp.units_previous)
             END                                                                   AS unit_cost_delta_percent
      FROM per_product pp
      WHERE pp.units > 0 OR pp.units_previous > 0
    ),
    joined AS (
      SELECT pr.*,
             COALESCE(NULLIF(TRIM(p.name), ''), 'منتج محذوف')       AS product_name,
             ${columns.productColumns.has("sku") ? "p.sku" : "NULL::text"}          AS sku,
             ${columns.productColumns.has("brand") ? "p.brand" : "NULL::text"}      AS brand,
             COALESCE(${productTypeExpr()}, 'غير محدد')             AS product_type
      FROM priced pr
      LEFT JOIN products p ON p.id = pr.product_id
    )
    SELECT *, COUNT(*) OVER () AS total_rows
    FROM joined
    ORDER BY ${sortKey} ${sortDir} NULLS LAST, product_name ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const result = await runTimed(client, sql, scope.params, timings, "products");
  const rows = result.rows || [];
  const total = rows.length ? toFiniteNumber(rows[0].total_rows) ?? rows.length : 0;

  const mapped = rows.map((row) => {
    const deltaPercent = toFiniteNumber(row.unit_cost_delta_percent);
    return {
      productId: toFiniteNumber(row.product_id),
      productName: row.product_name,
      sku: row.sku,
      brand: row.brand,
      productType: row.product_type,
      units: toFiniteNumber(row.units) ?? 0,
      unitsPrevious: scope.hasComparison ? toFiniteNumber(row.units_previous) ?? 0 : null,
      spend: money(row.spend, includeCost),
      unitCost: includeCost ? toMoney(toFiniteNumber(row.unit_cost)) : null,
      unitCostPrevious: includeCost ? toMoney(toFiniteNumber(row.unit_cost_previous)) : null,
      // null when either window had no units: an unmeasurable move, not a zero one.
      unitCostDeltaPercent: includeCost ? deltaPercent : null,
      priceMove: !includeCost || deltaPercent === null
        ? null
        : Math.abs(deltaPercent) < PRICE_MOVE_THRESHOLD ? "stable" : deltaPercent > 0 ? "up" : "down",
      purchaseCount: toFiniteNumber(row.purchase_count) ?? 0,
      supplierCount: toFiniteNumber(row.supplier_count) ?? 0,
      lastPurchasedAt: row.last_purchased_at,
    };
  });

  if (!scope.hasComparison) {
    collector.add(
      "PRICE_TREND_NEEDS_COMPARISON",
      "Choose a comparison period to see how each product's purchase price moved.",
      {}
    );
  }

  return buildEnvelope({
    meta: {
      permissions: { cost: includeCost },
      timings,
      sort: { key: filters.sort && PURCHASING_PRODUCT_SORTS[filters.sort] ? filters.sort : DEFAULT_PURCHASING_PRODUCT_SORT, direction: sortDir.toLowerCase() },
      availableSorts: Object.keys(PURCHASING_PRODUCT_SORTS),
      priceMoveThreshold: PRICE_MOVE_THRESHOLD,
      basis: { attribution: "purchase_line_value", unitCost: "quantity_weighted" },
    },
    data: {
      rows: mapped,
      pagination: { page: filters.page || 1, limit, total, pages: limit > 0 ? Math.ceil(total / limit) : 1 },
    },
    filters,
    collector,
  });
};

/* ------------------------------------------------------------------ suppliers */

/**
 * Supplier performance.
 *
 * Spend here is HEADER-level per supplier, because a purchase order belongs entirely to
 * one supplier — unlike a product, which does not. Units and product counts come from the
 * lines. Both are labelled in meta.basis so the two columns are never read as one number.
 */
export const getPurchasingSuppliers = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  const sortKey = SUPPLIER_SORTS[filters.sort] || SUPPLIER_SORTS[DEFAULT_SUPPLIER_SORT];
  const sortDir = filters.sortDir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(filters.limit || 25, 1), 200);
  const offset = ((filters.page || 1) - 1) * limit;

  const returnsCte = columns.supplierReturnColumns.size
    ? `
    supplier_returns AS (
      SELECT sri.supplier_id,
             COALESCE(SUM(GREATEST(COALESCE(sri.quantity, 0), 0)), 0) AS return_units
      FROM supplier_return_items sri
      WHERE ${scope.tenantScoped && columns.supplierReturnColumns.has("tenant_id") ? "sri.tenant_id = $1 AND " : ""}
            sri.created_at >= ${scope.currentFrom}::date
        AND sri.created_at < (${scope.currentTo}::date + INTERVAL '1 day')
        ${columns.supplierReturnColumns.has("status") ? "AND LOWER(COALESCE(sri.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void')" : ""}
      GROUP BY sri.supplier_id
    ),`
    : "supplier_returns AS (SELECT NULL::bigint AS supplier_id, 0::numeric AS return_units WHERE FALSE),";

  const sql = `
    WITH ${purchasingCte({ scope, columns })},
    ${returnsCte}
    header_per_supplier AS (
      SELECT sp.supplier_id,
             COALESCE(SUM(sp.total) FILTER (WHERE sp.in_current), 0)                         AS spend,
             COALESCE(SUM(sp.total) FILTER (WHERE sp.in_previous), 0)                        AS spend_previous,
             COUNT(*) FILTER (WHERE sp.in_current)                                           AS purchase_count,
             COUNT(*) FILTER (WHERE sp.in_previous)                                          AS purchase_count_previous,
             COALESCE(SUM(GREATEST(sp.total - sp.paid_amount, 0)) FILTER (WHERE sp.in_current), 0) AS unpaid_value,
             MAX(sp.created_at) FILTER (WHERE sp.in_current)                                 AS last_purchase_at
      FROM scoped_purchases sp
      GROUP BY sp.supplier_id
    ),
    lines_per_supplier AS (
      SELECT sl.supplier_id,
             COALESCE(SUM(sl.quantity) FILTER (WHERE sl.in_current), 0)  AS units,
             COALESCE(SUM(sl.quantity) FILTER (WHERE sl.in_previous), 0) AS units_previous,
             COALESCE(SUM(sl.line_value) FILTER (WHERE sl.in_current), 0)  AS line_spend,
             COALESCE(SUM(sl.line_value) FILTER (WHERE sl.in_previous), 0) AS line_spend_previous,
             COUNT(DISTINCT sl.product_id) FILTER (WHERE sl.in_current AND sl.product_id IS NOT NULL) AS product_count
      FROM scoped_lines sl
      GROUP BY sl.supplier_id
    ),
    joined AS (
      SELECT h.supplier_id,
             COALESCE(NULLIF(TRIM(s.name), ''), 'مورد غير محدد') AS supplier_name,
             ${columns.supplierColumns.has("status") ? "s.status" : "NULL::text"} AS supplier_status,
             h.spend, h.spend_previous, h.purchase_count, h.purchase_count_previous,
             h.unpaid_value, h.last_purchase_at,
             COALESCE(l.units, 0)                AS units,
             COALESCE(l.units_previous, 0)       AS units_previous,
             COALESCE(l.line_spend, 0)           AS line_spend,
             COALESCE(l.line_spend_previous, 0)  AS line_spend_previous,
             COALESCE(l.product_count, 0)        AS product_count,
             COALESCE(r.return_units, 0)         AS return_units,
             CASE WHEN h.purchase_count > 0 THEN h.spend / h.purchase_count END AS average_purchase_value
      FROM header_per_supplier h
      LEFT JOIN lines_per_supplier l ON l.supplier_id = h.supplier_id
      LEFT JOIN suppliers s          ON s.id = h.supplier_id
      LEFT JOIN supplier_returns r   ON r.supplier_id = h.supplier_id
      WHERE h.spend > 0 OR h.purchase_count > 0
    )
    SELECT *,
           COUNT(*) OVER ()                    AS total_rows,
           SUM(spend) OVER ()                  AS grand_spend
    FROM joined
    ORDER BY ${sortKey} ${sortDir} NULLS LAST, supplier_name ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const result = await runTimed(client, sql, scope.params, timings, "suppliers");
  const rows = result.rows || [];
  const total = rows.length ? toFiniteNumber(rows[0].total_rows) ?? rows.length : 0;
  const grandSpend = rows.length ? toFiniteNumber(rows[0].grand_spend) ?? 0 : 0;

  const mapped = rows.map((row) => {
    const spend = toFiniteNumber(row.spend) ?? 0;
    const spendPrevious = scope.hasComparison ? toFiniteNumber(row.spend_previous) ?? 0 : null;
    const units = toFiniteNumber(row.units) ?? 0;
    const unitsPrevious = scope.hasComparison ? toFiniteNumber(row.units_previous) ?? 0 : null;
    const lineSpend = toFiniteNumber(row.line_spend) ?? 0;
    const lineSpendPrevious = toFiniteNumber(row.line_spend_previous) ?? 0;

    // Weighted unit cost per supplier, and only comparable when both windows have units.
    const unitCost = units > 0 ? lineSpend / units : null;
    const unitCostPrevious = unitsPrevious !== null && unitsPrevious > 0 ? lineSpendPrevious / unitsPrevious : null;

    return {
      supplierId: toFiniteNumber(row.supplier_id),
      supplierName: row.supplier_name,
      status: row.supplier_status,
      spend: money(spend, includeCost),
      spendShare: includeCost ? safeRatio(spend, grandSpend) : null,
      spendGrowth: includeCost && spendPrevious !== null && spendPrevious > 0 ? (spend - spendPrevious) / spendPrevious : null,
      units,
      unitsPrevious,
      purchaseCount: toFiniteNumber(row.purchase_count) ?? 0,
      productCount: toFiniteNumber(row.product_count) ?? 0,
      averagePurchaseValue: includeCost ? toMoney(toFiniteNumber(row.average_purchase_value)) : null,
      averageUnitCost: includeCost ? toMoney(unitCost) : null,
      unitCostDeltaPercent:
        includeCost && unitCost !== null && unitCostPrevious !== null && unitCostPrevious > 0
          ? (unitCost - unitCostPrevious) / unitCostPrevious
          : null,
      unpaidValue: includeCost ? toMoney(toFiniteNumber(row.unpaid_value)) : null,
      returnUnits: toFiniteNumber(row.return_units) ?? 0,
      // Rate against units bought from THIS supplier in the window. Same cohort caveat as
      // the summary; the warning is raised there and applies to this column too.
      returnRate: safeRatio(toFiniteNumber(row.return_units) ?? 0, units),
      lastPurchaseAt: row.last_purchase_at,
    };
  });

  if (mapped.some((row) => row.returnUnits > 0)) {
    collector.add(
      "SUPPLIER_RETURN_COHORT_MISMATCH",
      "Supplier returns are raised from customer returns, so the return rate is not a proportion of the units purchased in this window.",
      {}
    );
  }

  return buildEnvelope({
    meta: {
      permissions: { cost: includeCost },
      timings,
      sort: { key: filters.sort && SUPPLIER_SORTS[filters.sort] ? filters.sort : DEFAULT_SUPPLIER_SORT, direction: sortDir.toLowerCase() },
      availableSorts: Object.keys(SUPPLIER_SORTS),
      basis: { spend: "purchase_header_total", units: "purchase_line_quantity" },
    },
    data: {
      rows: mapped,
      pagination: { page: filters.page || 1, limit, total, pages: limit > 0 ? Math.ceil(total / limit) : 1 },
    },
    filters,
    collector,
  });
};

export { buildScope, purchasingCte, loadColumns, runTimed };
