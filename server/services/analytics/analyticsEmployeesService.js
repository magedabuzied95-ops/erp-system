import db from "../../database/db.js";
import { coalesceColumnExpr } from "./accountingCanon.js";
import { orderFilterClauses } from "./analyticsOrderFilters.js";
import {
  WarningCollector,
  buildDelta,
  buildEnvelope,
  safeRatio,
  toFiniteNumber,
  toMoney,
} from "./analyticsComparison.js";
import { canonicalOrderClauses, nanSafe, orderRevenueExpr } from "./analyticsMetrics.js";

/**
 * R9 — Employee & Channel Intelligence.
 *
 * WHO SOLD IT, WHO RANG IT UP, AND THROUGH WHICH CHANNEL. Three different questions, and
 * conflating any two of them produces a number that looks like performance and is not.
 *
 * THE ATTRIBUTION PROBLEM, AND WHY THIS FILE DOES NOT SOLVE IT WITH A CONSTANT
 *
 * `orders` has no `employee_id`. It has SIX columns that could carry a seller, and the
 * frozen metric contract declares a precedence over three of them:
 *
 *     SELLER_ATTRIBUTION_PRECEDENCE = [seller_user_id, sales_employee_id, salesperson_id]
 *
 * `resolveSellerAttributionField` picks the first that EXISTS as a column. On production
 * that is `seller_user_id` — which is populated on ZERO of 572 canonical orders. A
 * precedence resolved by existence therefore attributes nothing at all, and a page built
 * on it would report every order as unattributed while the data plainly says otherwise.
 *
 * Measured on production, 572 canonical orders:
 *
 *     seller_user_id       0     ( 0.0%)  the contract's first choice, empty
 *     sales_employee_id  510     (89.2%)  but sales_employees has ZERO rows,
 *     salesperson_id     510     (89.2%)  and these two columns are IDENTICAL on
 *                                          572/572 rows, so they are one column
 *     salesperson_name   510     (89.2%)  five real names, stable id<->name mapping
 *     seller_name        510     (89.2%)  but DIFFERS from salesperson_name on 86 rows
 *     cashier_user_id    569     (99.5%)  resolves 569/569 to a real users row
 *
 * So the seller IDs point at an empty table — joining them yields 100% unknown — while
 * the NAME captured on the order at sale time carries the attribution. That is not an
 * invention: it is the value the till recorded, and no name in the data carries two ids.
 *
 * This file therefore resolves the attribution field FROM MEASURED COVERAGE at query
 * time, reports which field it chose and what that field covers in `meta.attribution`,
 * and the UI prints it on screen. Below ATTRIBUTION_FLOOR it refuses to publish a seller
 * breakdown at all rather than showing one that is mostly "unknown".
 *
 * Nothing is ever redistributed. The orders with no seller are their own bucket, always
 * visible, with their own share — because spreading them across the named sellers would
 * be inventing performance that nobody earned.
 *
 * NOT built, deliberately:
 *
 *   Commission and payroll   /employees/commissions and /employees/sales-performance
 *                            already own those, with their own rules. A second commission
 *                            number is worse than none.
 *   Targets or quotas        No target exists anywhere in the schema. A percentage
 *                            against an invented denominator is a fabricated metric.
 *   Per-employee profit      COGS is attributable to a LINE, and a line has no seller —
 *                            only the order does. Splitting an order's cost across its
 *                            lines to reach a seller margin would be an allocation the
 *                            data does not support. Revenue and units only.
 */

/* ------------------------------------------------------------------ contract */

/**
 * Candidate attribution fields, in declared preference order.
 *
 * Order breaks ties only. The FIELD ACTUALLY CHOSEN is whichever covers the most orders
 * in the requested window, because a column that exists and is empty attributes nothing.
 *
 * `kind: "name"` reads a denormalised name captured on the order. `kind: "join"` resolves
 * an id against a table — and is only usable if that table has rows for those ids.
 */
export const SELLER_CANDIDATES = Object.freeze([
  { field: "salesperson_name", kind: "name", label: "salesperson_name" },
  { field: "seller_name", kind: "name", label: "seller_name" },
  { field: "seller_user_id", kind: "join", table: "users", label: "seller_user_id -> users" },
  { field: "sales_employee_id", kind: "join", table: "sales_employees", label: "sales_employee_id -> sales_employees" },
  { field: "salesperson_id", kind: "join", table: "sales_employees", label: "salesperson_id -> sales_employees" },
]);

/**
 * Below this share of orders, a seller breakdown is not published at all.
 *
 * A chart in which two thirds of revenue sits in "unknown" is not a breakdown, it is a
 * picture of missing data wearing a breakdown's clothes. The KPIs and the channel view
 * still work; only the seller dimension withdraws, and it says why.
 */
export const ATTRIBUTION_FLOOR = 0.2;

export const EMPLOYEE_DIMENSIONS = Object.freeze(["seller", "cashier", "channel", "branch"]);
export const DEFAULT_EMPLOYEE_DIMENSION = "seller";

export const EMPLOYEE_SORTS = Object.freeze({
  net_sales: "net_sales",
  orders: "orders",
  units: "units",
  average_order: "average_order_value",
  last_sale: "last_sale_at",
  seller: "seller",
});
export const DEFAULT_EMPLOYEE_SORT = "net_sales";

/** The label an unattributed order carries. Never a seller name, never redistributed. */
export const UNATTRIBUTED_KEY = "__unattributed__";

/* ----------------------------------------------------------------------- scope */

const loadColumns = async (client) => {
  const read = async (table) => {
    const result = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
      [table]
    );
    return new Set(result.rows.map((row) => row.column_name));
  };
  const [orderColumns, itemColumns, userColumns, salesEmployeeColumns, branchColumns, returnColumns, returnItemColumns] =
    await Promise.all([
      read("orders"), read("order_items"), read("users"), read("sales_employees"),
      read("branches"), read("returns"), read("return_items"),
    ]);
  return { orderColumns, itemColumns, userColumns, salesEmployeeColumns, branchColumns, returnColumns, returnItemColumns };
};

const TIME_BUCKETS = Object.freeze({
  hour: "date_trunc('hour', o.created_at)",
  day: "date_trunc('day', o.created_at)",
  week: "date_trunc('week', o.created_at)",
  month: "date_trunc('month', o.created_at)",
});

const buildScope = ({ filters, columns }) => {
  const { orderColumns } = columns;
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

  const orderClauses = [];
  if (tenantId !== null && orderColumns.has("tenant_id")) orderClauses.push("o.tenant_id = $1");
  orderClauses.push(...orderFilterClauses({ filters, orderColumns, bind }).clauses);
  orderClauses.push(...canonicalOrderClauses(orderColumns).clauses);

  const widestFrom = comparison && comparison.from < from ? previousFrom : currentFrom;
  const widestTo = comparison && comparison.to > to ? previousTo : currentTo;
  orderClauses.push(`o.created_at >= ${widestFrom}::date AND o.created_at < (${widestTo}::date + INTERVAL '1 day')`);

  return {
    params,
    bind,
    tenantId,
    tenantScoped: tenantId !== null,
    currentFrom, currentTo, previousFrom, previousTo,
    hasComparison: Boolean(comparison),
    orderWhere: orderClauses.join(" AND "),
    inCurrent: `o.created_at >= ${currentFrom}::date AND o.created_at < (${currentTo}::date + INTERVAL '1 day')`,
    inPrevious: previousFrom
      ? `o.created_at >= ${previousFrom}::date AND o.created_at < (${previousTo}::date + INTERVAL '1 day')`
      : "FALSE",
  };
};

/* ------------------------------------------------------------- attribution */

/**
 * Choose the seller field by measuring it, not by assuming it.
 *
 * One query counts, for every candidate that exists as a column, how many orders in the
 * window carry a usable value — and for a join candidate, how many of those ids actually
 * resolve to a row. A join whose target table is empty scores zero and loses, which is
 * exactly what should happen to `sales_employee_id` against an empty `sales_employees`.
 *
 * Returns the winner plus the full scoreboard, so the UI can say what it used and a
 * reader can see what it rejected.
 */
export const resolveAttribution = async ({ client, filters, columns, timings }) => {
  const usable = SELLER_CANDIDATES.filter((candidate) => {
    if (!columns.orderColumns.has(candidate.field)) return false;
    if (candidate.kind !== "join") return true;
    // The table the id would resolve against. Empty means the id is a dangling
    // reference, not attribution, so the candidate is dropped before the probe runs.
    const lookupTable = candidate.table === "users" ? columns.userColumns : columns.salesEmployeeColumns;
    return lookupTable.size > 0;
  });

  if (!usable.length) {
    return { field: null, kind: null, coverage: null, candidates: [], reason: "NO_CANDIDATE_COLUMN" };
  }

  const selects = usable.map((candidate) => {
    if (candidate.kind === "name") {
      return `COUNT(*) FILTER (WHERE COALESCE(TRIM(o.${candidate.field}::text), '') <> '') AS "${candidate.field}"`;
    }
    // A join candidate only counts when the id RESOLVES. An id pointing at an empty
    // table is not attribution, it is a dangling reference.
    return `COUNT(*) FILTER (WHERE o.${candidate.field} IS NOT NULL AND EXISTS (SELECT 1 FROM ${candidate.table} t WHERE t.id = o.${candidate.field})) AS "${candidate.field}"`;
  });

  // Its OWN parameter list, not the shared scope's. The shared scope binds the comparison
  // window too, and this probe never reads it — Postgres rejects a bind that supplies more
  // parameters than the statement uses, so reusing it errors with 08P01.
  const params = [];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const clauses = [];
  if (filters.tenantId !== null && columns.orderColumns.has("tenant_id")) {
    clauses.push(`o.tenant_id = ${bind(filters.tenantId)}`);
  }
  if (filters.branchId && columns.orderColumns.has("branch_id")) clauses.push(`o.branch_id = ${bind(filters.branchId)}`);
  if (filters.channel && columns.orderColumns.has("channel")) {
    clauses.push(`LOWER(COALESCE(o.channel,'')) = LOWER(${bind(filters.channel)})`);
  }
  clauses.push(...canonicalOrderClauses(columns.orderColumns).clauses);
  clauses.push(
    `o.created_at >= ${bind(filters.from)}::date AND o.created_at < (${bind(filters.to)}::date + INTERVAL '1 day')`
  );

  const sql = `
    SELECT COUNT(*) AS total, ${selects.join(", ")}
    FROM orders o
    WHERE ${clauses.join(" AND ")}
  `;

  const startedAt = Date.now();
  const result = await client.query(sql, params);
  if (timings) timings.attribution = Date.now() - startedAt;

  const row = result.rows[0] || {};
  const total = toFiniteNumber(row.total) ?? 0;

  const scoreboard = usable.map((candidate) => {
    const covered = toFiniteNumber(row[candidate.field]) ?? 0;
    return { ...candidate, covered, coverage: total > 0 ? covered / total : null };
  });

  // Highest coverage wins; the declared order breaks a tie, so the choice is stable
  // between two equally populated columns rather than depending on row order.
  const ranked = [...scoreboard].sort((a, b) => {
    if (b.covered !== a.covered) return b.covered - a.covered;
    return SELLER_CANDIDATES.findIndex((c) => c.field === a.field) - SELLER_CANDIDATES.findIndex((c) => c.field === b.field);
  });

  const winner = ranked[0];
  return {
    field: winner.covered > 0 ? winner.field : null,
    kind: winner.covered > 0 ? winner.kind : null,
    table: winner.table || null,
    label: winner.covered > 0 ? winner.label : null,
    coverage: winner.coverage,
    totalOrders: total,
    attributedOrders: winner.covered,
    candidates: scoreboard.map((c) => ({ field: c.field, label: c.label, kind: c.kind, covered: c.covered, coverage: c.coverage })),
    reason: winner.covered > 0 ? null : "NO_POPULATED_CANDIDATE",
  };
};

/** SQL that turns the resolved attribution into a display key, or NULL when absent. */
const sellerKeyExpr = (attribution) => {
  if (!attribution?.field) return "NULL::text";
  if (attribution.kind === "name") return `NULLIF(TRIM(o.${attribution.field}::text), '')`;
  return `(SELECT NULLIF(TRIM(COALESCE(t.name, '')), '') FROM ${attribution.table} t WHERE t.id = o.${attribution.field})`;
};

/* ------------------------------------------------------------------- shared CTE */

/**
 * One row per contribution: an order that earned revenue, or a refund that reversed some.
 *
 * WHY A UNION AND NOT A JOIN. The first cut joined refunds onto the scoped orders by
 * order id, which silently dropped every refund raised in the window against an order
 * placed BEFORE it — and on the development data that was all of them, so seller revenue
 * came out gross by exactly the returns total. The reconciliation harness caught it on
 * its first run.
 *
 * The Executive Overview deducts refunds by RETURN date regardless of the order's date,
 * so a seller view must do the same. A refund therefore joins back to its ORIGINAL order
 * to inherit that order's seller, cashier, channel and branch, and enters the set as a
 * negative contribution. It is attributed to whoever made the sale, which is the only
 * defensible answer: nobody else earned it, so nobody else should lose it.
 *
 * Orders count only from order rows, so a refund never inflates the order count.
 */
const employeeCte = ({ scope, columns, attribution }) => {
  const revenue = orderRevenueExpr(columns.orderColumns);
  const returnsAvailable = columns.returnColumns.size > 0 && columns.returnItemColumns.size > 0;
  const refundExpr = coalesceColumnExpr("ri", columns.returnItemColumns, ["refund_amount", "total", "total_amount"], "0");
  const returnStatus = "LOWER(COALESCE(r.status, '')) NOT IN ('cancelled','canceled','rejected','void','deleted')";
  // Tenant-scoped on the ORIGINAL order. The first cut had no tenant clause here at all,
  // which aggregated refunds across every tenant into one shop's figures.
  const refundTenant = scope.tenantScoped && columns.orderColumns.has("tenant_id") ? "o.tenant_id = $1 AND " : "";

  const orderRefunds = returnsAvailable
    ? `order_refunds AS (
      SELECT o.id                                                                                    AS order_id,
             ${sellerKeyExpr(attribution)}                                                           AS seller,
             ${columns.orderColumns.has("cashier_user_id") ? "o.cashier_user_id" : "NULL::bigint"}    AS cashier_user_id,
             ${columns.orderColumns.has("channel") ? "COALESCE(NULLIF(TRIM(o.channel), ''), 'pos')" : "'pos'"} AS channel,
             ${columns.orderColumns.has("branch_id") ? "o.branch_id" : "NULL::bigint"}               AS branch_id,
             MAX(r.created_at)                                                                        AS refunded_at,
             COALESCE(SUM(${nanSafe(refundExpr)}), 0)                                                 AS refunded,
             BOOL_OR(r.created_at >= ${scope.currentFrom}::date
                 AND r.created_at < (${scope.currentTo}::date + INTERVAL '1 day'))                    AS in_current,
             ${scope.previousFrom
                ? `BOOL_OR(r.created_at >= ${scope.previousFrom}::date AND r.created_at < (${scope.previousTo}::date + INTERVAL '1 day'))`
                : "FALSE"}                                                                            AS in_previous
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      JOIN orders o  ON o.id = r.order_id
      WHERE ${refundTenant}${returnStatus}
        -- D-21: only deduct a refund whose sale is still in the counted set. A fully
        -- returned order has already left every window; deducting its refund as a
        -- negative contribution on top would reverse the same sale twice.
        AND ${canonicalOrderClauses(columns.orderColumns).clauses.join(" AND ")}
      GROUP BY 1, 2, 3, 4, 5
    )`
    : `order_refunds AS (
      SELECT NULL::bigint AS order_id, NULL::text AS seller, NULL::bigint AS cashier_user_id,
             'pos'::text AS channel, NULL::bigint AS branch_id, NULL::timestamp AS refunded_at,
             0::numeric AS refunded, FALSE AS in_current, FALSE AS in_previous
      WHERE FALSE
    )`;

  const units = columns.itemColumns.size
    ? "COALESCE(SUM(GREATEST(COALESCE(oi.quantity,0) - COALESCE(oi.returned_quantity,0), 0)), 0)"
    : "0";

  return `
    ${orderRefunds},
    scoped_orders AS (
      SELECT o.id,
             o.created_at,
             ${sellerKeyExpr(attribution)}                                                        AS seller,
             ${columns.orderColumns.has("cashier_user_id") ? "o.cashier_user_id" : "NULL::bigint"} AS cashier_user_id,
             ${columns.orderColumns.has("channel") ? "COALESCE(NULLIF(TRIM(o.channel), ''), 'pos')" : "'pos'"} AS channel,
             ${columns.orderColumns.has("branch_id") ? "o.branch_id" : "NULL::bigint"}            AS branch_id,
             ${revenue}                                                                            AS gross_revenue,
             (${scope.inCurrent})                                                                  AS in_current,
             (${scope.inPrevious})                                                                 AS in_previous
      FROM orders o
      WHERE ${scope.orderWhere}
    ),
    order_units AS (
      -- One grouped pass, never an aggregate per order.
      SELECT oi.order_id, ${units} AS units
      FROM order_items oi
      WHERE oi.order_id IN (SELECT id FROM scoped_orders)
      GROUP BY oi.order_id
    ),
    netted_orders AS (
      -- Orders contribute revenue and units and count as one order each.
      SELECT so.id, so.created_at, so.seller, so.cashier_user_id, so.channel, so.branch_id,
             so.in_current, so.in_previous,
             so.gross_revenue          AS revenue,
             COALESCE(ou.units, 0)     AS units,
             0::numeric                AS refunded,
             1                         AS order_count
      FROM scoped_orders so
      LEFT JOIN order_units ou ON ou.order_id = so.id

      UNION ALL

      -- Refunds contribute NEGATIVE revenue against the seller of the original order, and
      -- count as no order at all. A refund on an order older than the window still lands
      -- here, which is what makes this agree with the Executive Overview.
      SELECT orf.order_id, orf.refunded_at, orf.seller, orf.cashier_user_id, orf.channel, orf.branch_id,
             orf.in_current, orf.in_previous,
             -orf.refunded             AS revenue,
             0                         AS units,
             orf.refunded              AS refunded,
             0                         AS order_count
      FROM order_refunds orf
      WHERE orf.in_current OR orf.in_previous
    )
  `;
};

const runTimed = async (client, sql, params, timings, name) => {
  const startedAt = Date.now();
  const result = await client.query(sql, params);
  timings[name] = Date.now() - startedAt;
  return result;
};

/* -------------------------------------------------------------------- summary */

export const getEmployeesSummary = async ({ filters, permissions = {}, client = db }) => {
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  const attribution = await resolveAttribution({ client, filters, columns, timings });
  reportAttribution(collector, attribution);

  const granularity = filters.granularity && filters.granularity !== "auto"
    ? filters.granularity
    : filters.days <= 2 ? "hour" : filters.days <= 62 ? "day" : filters.days <= 240 ? "week" : "month";
  const bucket = (TIME_BUCKETS[granularity] || TIME_BUCKETS.day).replace(/o\.created_at/g, "no.created_at");

  const sql = `
    WITH ${employeeCte({ scope, columns, attribution })},
    totals AS (
      SELECT
        COALESCE(SUM(order_count) FILTER (WHERE in_current), 0) AS orders_current,
        COALESCE(SUM(order_count) FILTER (WHERE in_previous), 0) AS orders_previous,
        COALESCE(SUM(revenue) FILTER (WHERE in_current), 0)                         AS revenue_current,
        COALESCE(SUM(revenue) FILTER (WHERE in_previous), 0)                        AS revenue_previous,
        COALESCE(SUM(units) FILTER (WHERE in_current), 0)                           AS units_current,
        COUNT(DISTINCT seller) FILTER (WHERE in_current AND seller IS NOT NULL AND order_count = 1)     AS sellers_current,
        COUNT(DISTINCT seller) FILTER (WHERE in_previous AND seller IS NOT NULL AND order_count = 1)    AS sellers_previous,
        COUNT(DISTINCT cashier_user_id) FILTER (WHERE in_current AND cashier_user_id IS NOT NULL AND order_count = 1) AS cashiers_current,
        COUNT(DISTINCT channel) FILTER (WHERE in_current AND order_count = 1) AS channels_current,
        COALESCE(SUM(order_count) FILTER (WHERE in_current AND seller IS NULL), 0) AS unattributed_orders,
        COALESCE(SUM(revenue) FILTER (WHERE in_current AND seller IS NULL), 0)      AS unattributed_revenue
      FROM netted_orders
    ),
    per_seller AS (
      SELECT seller, COALESCE(SUM(revenue), 0) AS revenue
      FROM netted_orders WHERE in_current AND seller IS NOT NULL
      GROUP BY seller
    ),
    trend AS (
      SELECT ${bucket}                                  AS bucket,
             COALESCE(SUM(no.order_count), 0)           AS orders,
             COALESCE(SUM(no.revenue), 0)               AS revenue,
             COUNT(DISTINCT no.seller) FILTER (WHERE no.seller IS NOT NULL AND no.order_count = 1) AS sellers
      FROM netted_orders no
      WHERE no.in_current
      GROUP BY 1
    )
    SELECT
      (SELECT row_to_json(t) FROM totals t) AS totals,
      (SELECT COALESCE(json_agg(json_build_object('seller', seller, 'revenue', revenue) ORDER BY revenue DESC), '[]'::json) FROM per_seller) AS sellers,
      (SELECT COALESCE(json_agg(json_build_object('bucket', bucket, 'orders', orders, 'revenue', revenue, 'sellers', sellers) ORDER BY bucket), '[]'::json) FROM trend) AS trend
  `;

  const result = await runTimed(client, sql, scope.params, timings, "summary");
  const row = result.rows[0] || {};
  const totals = row.totals || {};
  const sellerRows = row.sellers || [];

  const revenueCurrent = toFiniteNumber(totals.revenue_current) ?? 0;
  const revenuePrevious = scope.hasComparison ? toFiniteNumber(totals.revenue_previous) ?? 0 : null;
  const ordersCurrent = toFiniteNumber(totals.orders_current) ?? 0;
  const ordersPrevious = scope.hasComparison ? toFiniteNumber(totals.orders_previous) ?? 0 : null;
  const unattributedRevenue = toFiniteNumber(totals.unattributed_revenue) ?? 0;
  const unattributedOrders = toFiniteNumber(totals.unattributed_orders) ?? 0;

  const sellerShares = sellerRows
    .map((entry) => toFiniteNumber(entry.revenue) ?? 0)
    .filter((value) => value > 0)
    .sort((a, b) => b - a);
  const attributedRevenue = sellerShares.reduce((sum, value) => sum + value, 0);

  if (unattributedOrders > 0) {
    collector.add(
      "SELLER_UNATTRIBUTED_ORDERS",
      "Some orders carry no seller. They are shown as their own bucket and are never shared out across the named sellers.",
      { orders: unattributedOrders, revenue: toMoney(unattributedRevenue), share: safeRatio(unattributedOrders, ordersCurrent) }
    );
  }

  return buildEnvelope({
    meta: {
      permissions: { cost: Boolean(permissions.cost), profit: Boolean(permissions.profit) },
      granularity,
      timings,
      attribution,
      // Stated so the page can print it: revenue is canonical order revenue net of
      // returns, and no per-seller profit exists because COGS lives on the line.
      basis: { revenue: "canonical_order_revenue_net_of_returns", profit: "not_attributable_to_a_seller" },
    },
    data: {
      kpis: {
        sellerNetSales: buildDelta(toMoney(revenueCurrent), revenuePrevious === null ? null : toMoney(revenuePrevious), { collector, metric: "sellerNetSales" }),
        sellerOrders: buildDelta(ordersCurrent, ordersPrevious, { collector, metric: "sellerOrders" }),
        sellerUnits: { current: toFiniteNumber(totals.units_current) ?? 0 },
        activeSellers: buildDelta(
          toFiniteNumber(totals.sellers_current) ?? 0,
          scope.hasComparison ? toFiniteNumber(totals.sellers_previous) ?? 0 : null,
          { collector, metric: "activeSellers" }
        ),
        activeCashiers: { current: toFiniteNumber(totals.cashiers_current) ?? 0 },
        activeChannels: { current: toFiniteNumber(totals.channels_current) ?? 0 },
        averageOrderValue: { current: toMoney(safeRatio(revenueCurrent, ordersCurrent)) },
        salesPerSeller: { current: toMoney(safeRatio(attributedRevenue, toFiniteNumber(totals.sellers_current) ?? 0)) },
        attributionCoverage: { current: attribution.coverage },
        unattributedNetSales: { current: toMoney(unattributedRevenue) },
      },
      concentration: buildSellerConcentration(sellerShares, attributedRevenue),
      unattributed: { orders: unattributedOrders, revenue: toMoney(unattributedRevenue), share: safeRatio(unattributedRevenue, revenueCurrent) },
      trend: (row.trend || []).map((entry) => ({
        bucket: entry.bucket,
        orders: toFiniteNumber(entry.orders) ?? 0,
        revenue: toMoney(toFiniteNumber(entry.revenue) ?? 0),
        sellers: toFiniteNumber(entry.sellers) ?? 0,
      })),
      highlights: buildEmployeeHighlights({
        attribution,
        sellerShares,
        attributedRevenue,
        unattributedRevenue,
        revenueCurrent,
        revenuePrevious,
        sellers: toFiniteNumber(totals.sellers_current) ?? 0,
      }),
    },
    filters,
    collector,
  });
};

/** Raise the attribution warnings once, from one place, so the codes cannot drift. */
const reportAttribution = (collector, attribution) => {
  if (!attribution.field) {
    collector.add(
      "SELLER_ATTRIBUTION_UNAVAILABLE",
      "No column on the order carries a usable seller, so sales cannot be attributed to a person in this period. Channel and cashier views are unaffected.",
      { candidates: attribution.candidates, reason: attribution.reason }
    );
    return;
  }
  if (attribution.coverage !== null && attribution.coverage < ATTRIBUTION_FLOOR) {
    collector.add(
      "SELLER_ATTRIBUTION_TOO_THIN",
      "Too few orders carry a seller for a per-person breakdown to mean anything, so it is not shown.",
      { field: attribution.field, coverage: attribution.coverage, floor: ATTRIBUTION_FLOOR }
    );
    return;
  }
  if (attribution.coverage !== null && attribution.coverage < 1) {
    collector.add(
      "SELLER_ATTRIBUTION_PARTIAL",
      "Not every order carries a seller. The figures below cover only the ones that do, and the remainder is shown separately.",
      { field: attribution.field, coverage: attribution.coverage }
    );
  }
};

/**
 * Concentration of revenue across sellers. Same shape as the supplier version, and the
 * same rule: fewer than two sellers means there is nothing to concentrate.
 */
export const buildSellerConcentration = (shares, total) => {
  if (!Array.isArray(shares) || shares.length < 2 || !total || total <= 0) {
    return { sellerCount: Array.isArray(shares) ? shares.length : 0, topShare: null, topThreeShare: null, hhi: null };
  }
  const fractions = shares.map((value) => value / total);
  return {
    sellerCount: shares.length,
    topShare: fractions[0] ?? null,
    topThreeShare: fractions.slice(0, 3).reduce((sum, value) => sum + value, 0),
    hhi: fractions.reduce((sum, value) => sum + value * value, 0),
  };
};

/** Deterministic highlights. Every one is a fact already in the payload. */
export const buildEmployeeHighlights = ({
  attribution, sellerShares, attributedRevenue, unattributedRevenue, revenueCurrent, revenuePrevious, sellers,
}) => {
  const highlights = [];

  if (!attribution?.field) {
    highlights.push({
      code: "ATTRIBUTION_UNAVAILABLE",
      severity: "warning",
      messageKey: "highlights.attributionUnavailable",
      metric: "attributionCoverage",
      values: {},
    });
    return highlights;
  }

  if (attribution.coverage !== null && attribution.coverage < 0.95 && revenueCurrent > 0) {
    highlights.push({
      code: "ATTRIBUTION_PARTIAL",
      severity: attribution.coverage < ATTRIBUTION_FLOOR ? "warning" : "info",
      messageKey: "highlights.attributionPartial",
      metric: "attributionCoverage",
      values: { coveragePercent: attribution.coverage, unattributedValue: toMoney(unattributedRevenue) },
    });
  }

  const concentration = buildSellerConcentration(sellerShares, attributedRevenue);
  if (concentration.topShare !== null && concentration.topShare >= 0.5) {
    highlights.push({
      code: "SELLER_CONCENTRATION_HIGH",
      severity: "info",
      messageKey: "highlights.sellerConcentration",
      metric: "topShare",
      values: { sharePercent: concentration.topShare, sellers: concentration.sellerCount },
    });
  }

  if (revenuePrevious !== null && revenuePrevious > 0) {
    const change = (revenueCurrent - revenuePrevious) / revenuePrevious;
    if (Math.abs(change) >= 0.2) {
      highlights.push({
        code: change > 0 ? "TEAM_SALES_UP" : "TEAM_SALES_DOWN",
        severity: change > 0 ? "info" : "warning",
        messageKey: change > 0 ? "highlights.teamUp" : "highlights.teamDown",
        metric: "sellerNetSales",
        values: { changePercent: Math.abs(change), sellers },
      });
    }
  }

  return highlights;
};

/* ------------------------------------------------------------------ breakdown */

export const getEmployeesBreakdown = async ({ filters, permissions = {}, client = db }) => {
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  const attribution = await resolveAttribution({ client, filters, columns, timings });
  reportAttribution(collector, attribution);

  const requested = EMPLOYEE_DIMENSIONS.includes(filters.dimension) ? filters.dimension : DEFAULT_EMPLOYEE_DIMENSION;

  // A seller breakdown below the floor withdraws rather than drawing a mostly-unknown
  // chart. Every other dimension is unaffected, because none of them depends on it.
  const sellerUnusable =
    requested === "seller" && (!attribution.field || (attribution.coverage ?? 0) < ATTRIBUTION_FLOOR);

  if (sellerUnusable) {
    return buildEnvelope({
      meta: { dimension: requested, availableDimensions: EMPLOYEE_DIMENSIONS, attribution, timings, permissions: {} },
      data: { dimension: requested, rows: [], totals: { revenue: null, orders: 0 }, withheld: true },
      filters,
      collector,
    });
  }

  const dimensionSql = {
    seller: { expr: `COALESCE(no.seller, '${UNATTRIBUTED_KEY}')`, join: "" },
    cashier: {
      expr: `COALESCE(NULLIF(TRIM(u.name), ''), '${UNATTRIBUTED_KEY}')`,
      join: "LEFT JOIN users u ON u.id = no.cashier_user_id",
    },
    channel: { expr: "COALESCE(NULLIF(TRIM(no.channel), ''), 'pos')", join: "" },
    branch: {
      expr: `COALESCE(NULLIF(TRIM(b.name), ''), '${UNATTRIBUTED_KEY}')`,
      join: "LEFT JOIN branches b ON b.id = no.branch_id",
    },
  }[requested];

  const sql = `
    WITH ${employeeCte({ scope, columns, attribution })},
    grouped AS (
      SELECT ${dimensionSql.expr}                                            AS key,
             COALESCE(SUM(no.order_count) FILTER (WHERE no.in_current), 0) AS orders,
             COALESCE(SUM(no.revenue) FILTER (WHERE no.in_current), 0)       AS revenue,
             COALESCE(SUM(no.units) FILTER (WHERE no.in_current), 0)         AS units,
             COALESCE(SUM(no.revenue) FILTER (WHERE no.in_previous), 0)      AS revenue_previous,
             MAX(no.created_at) FILTER (WHERE no.in_current)                 AS last_sale_at
      FROM netted_orders no
      ${dimensionSql.join}
      GROUP BY 1
    )
    SELECT * FROM grouped WHERE orders > 0 ORDER BY revenue DESC NULLS LAST
  `;

  const result = await runTimed(client, sql, scope.params, timings, "breakdown");
  const rows = result.rows || [];
  const totalRevenue = rows.reduce((sum, row) => sum + (toFiniteNumber(row.revenue) ?? 0), 0);
  const totalOrders = rows.reduce((sum, row) => sum + (toFiniteNumber(row.orders) ?? 0), 0);

  const mapped = rows.map((row) => {
    const revenue = toFiniteNumber(row.revenue) ?? 0;
    const revenuePrevious = scope.hasComparison ? toFiniteNumber(row.revenue_previous) ?? 0 : null;
    const orders = toFiniteNumber(row.orders) ?? 0;
    return {
      key: row.key,
      unattributed: row.key === UNATTRIBUTED_KEY,
      orders,
      units: toFiniteNumber(row.units) ?? 0,
      revenue: toMoney(revenue),
      revenueShare: safeRatio(revenue, totalRevenue),
      orderShare: safeRatio(orders, totalOrders),
      averageOrderValue: toMoney(safeRatio(revenue, orders)),
      growth: revenuePrevious !== null && revenuePrevious > 0 ? (revenue - revenuePrevious) / revenuePrevious : null,
      lastSaleAt: row.last_sale_at,
    };
  });

  const meaningful = mapped.filter((row) => !row.unattributed).length;
  if (mapped.length > 0 && meaningful < 2) {
    collector.add(
      "DIMENSION_NOT_USABLE",
      "This dimension has no meaningful segmentation in this period.",
      { dimension: requested, distinctMeaningfulValues: meaningful }
    );
  }

  return buildEnvelope({
    meta: {
      dimension: requested,
      availableDimensions: EMPLOYEE_DIMENSIONS,
      attribution,
      timings,
      permissions: { cost: Boolean(permissions.cost) },
      basis: { revenue: "canonical_order_revenue_net_of_returns" },
    },
    data: {
      dimension: requested,
      rows: mapped,
      totals: { revenue: toMoney(totalRevenue), orders: totalOrders },
      withheld: false,
    },
    filters,
    collector,
  });
};

/* ----------------------------------------------------------------------- list */

export const getEmployeesList = async ({ filters, permissions = {}, client = db }) => {
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  const attribution = await resolveAttribution({ client, filters, columns, timings });
  reportAttribution(collector, attribution);

  const sortKey = EMPLOYEE_SORTS[filters.sort] || EMPLOYEE_SORTS[DEFAULT_EMPLOYEE_SORT];
  const sortDir = filters.sortDir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(filters.limit || 25, 1), 100);
  const offset = ((filters.page || 1) - 1) * limit;

  if (!attribution.field || (attribution.coverage ?? 0) < ATTRIBUTION_FLOOR) {
    return buildEnvelope({
      meta: { attribution, timings, permissions: {}, withheld: true },
      data: { rows: [], pagination: { page: 1, limit, total: 0, pages: 1 }, withheld: true },
      filters,
      collector,
    });
  }

  const sql = `
    WITH ${employeeCte({ scope, columns, attribution })},
    per_seller AS (
      SELECT COALESCE(no.seller, '${UNATTRIBUTED_KEY}')                      AS seller,
             COALESCE(SUM(no.order_count) FILTER (WHERE no.in_current), 0) AS orders,
             COALESCE(SUM(no.revenue) FILTER (WHERE no.in_current), 0)       AS net_sales,
             COALESCE(SUM(no.units) FILTER (WHERE no.in_current), 0)         AS units,
             COALESCE(SUM(no.refunded) FILTER (WHERE no.in_current), 0)      AS refunded,
             COALESCE(SUM(no.revenue) FILTER (WHERE no.in_previous), 0)      AS net_sales_previous,
             MAX(no.created_at) FILTER (WHERE no.in_current)                 AS last_sale_at,
             COUNT(DISTINCT no.channel) FILTER (WHERE no.in_current AND no.order_count = 1) AS channels
      FROM netted_orders no
      GROUP BY 1
    ),
    priced AS (
      SELECT ps.*,
             CASE WHEN ps.orders > 0 THEN ps.net_sales / ps.orders END AS average_order_value
      FROM per_seller ps WHERE ps.orders > 0
    )
    SELECT *, COUNT(*) OVER () AS total_rows, SUM(net_sales) OVER () AS grand_net_sales
    FROM priced
    ORDER BY ${sortKey} ${sortDir} NULLS LAST, seller ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const result = await runTimed(client, sql, scope.params, timings, "list");
  const rows = result.rows || [];
  const total = rows.length ? toFiniteNumber(rows[0].total_rows) ?? rows.length : 0;
  const grand = rows.length ? toFiniteNumber(rows[0].grand_net_sales) ?? 0 : 0;

  return buildEnvelope({
    meta: {
      attribution,
      timings,
      permissions: { cost: Boolean(permissions.cost) },
      sort: { key: filters.sort && EMPLOYEE_SORTS[filters.sort] ? filters.sort : DEFAULT_EMPLOYEE_SORT, direction: sortDir.toLowerCase() },
      availableSorts: Object.keys(EMPLOYEE_SORTS),
      basis: { revenue: "canonical_order_revenue_net_of_returns", profit: "not_attributable_to_a_seller" },
      withheld: false,
    },
    data: {
      rows: rows.map((row) => {
        const netSales = toFiniteNumber(row.net_sales) ?? 0;
        const previous = scope.hasComparison ? toFiniteNumber(row.net_sales_previous) ?? 0 : null;
        return {
          seller: row.seller,
          unattributed: row.seller === UNATTRIBUTED_KEY,
          orders: toFiniteNumber(row.orders) ?? 0,
          units: toFiniteNumber(row.units) ?? 0,
          netSales: toMoney(netSales),
          salesShare: safeRatio(netSales, grand),
          averageOrderValue: toMoney(toFiniteNumber(row.average_order_value)),
          refunded: toMoney(toFiniteNumber(row.refunded) ?? 0),
          growth: previous !== null && previous > 0 ? (netSales - previous) / previous : null,
          channels: toFiniteNumber(row.channels) ?? 0,
          lastSaleAt: row.last_sale_at,
        };
      }),
      pagination: { page: filters.page || 1, limit, total, pages: limit > 0 ? Math.ceil(total / limit) : 1 },
    },
    filters,
    collector,
  });
};

export { buildScope, employeeCte, loadColumns, runTimed, sellerKeyExpr };
