import db from "../../database/db.js";
import {
  WarningCollector,
  buildDelta,
  buildEnvelope,
  safeRatio,
  toFiniteNumber,
  toMoney,
} from "./analyticsComparison.js";
import { canonicalOrderClauses, orderRevenueExpr } from "./analyticsMetrics.js";

/**
 * R6 — Customer Intelligence.
 *
 * Management analytics about the customer base. This is NOT the Customer 360 drawer in
 * the AI Inbox — that answers "who is this person I am talking to right now"; this
 * answers "which parts of the customer base are growing and which are slipping away".
 *
 * PRIVACY IS A DESIGN CONSTRAINT HERE, not a filter applied at the end:
 *
 *   - `customers.phone` and `customers.email` are NEVER selected by any query in this
 *     file, for any caller, at any permission level. A report about segments does not
 *     need contact details, and a payload that carries them can be exported, cached and
 *     forwarded. Someone who needs to phone a customer opens the customer record, where
 *     that access is logged against the customer, not against a spreadsheet.
 *   - Customer NAMES appear only in the top-customer list, and only for a caller holding
 *     `customers:view` — the same permission the customer screen itself requires. Without
 *     it the identical rows come back ranked and anonymised, so the shape of the business
 *     (how concentrated revenue is, how big the top decile is) is still fully visible
 *     without exposing who anyone is.
 *
 * TWO SEGMENTATIONS, SHOWN SIDE BY SIDE, because they disagree and the disagreement is
 * the useful part. `customers.loyalty_tier` is what the loyalty programme has decided;
 * the behavioural segmentation below is what the orders actually say. A Gold customer who
 * has not bought in five months is exactly the row a manager needs to see, and either
 * segmentation alone hides it.
 *
 * NOT read: `customers.total_spent` and `customers.total_orders`. They are denormalised
 * columns maintained by the order write path, and reading them here would create a second
 * definition of what a customer is worth. Every figure is computed from `orders` under the
 * canonical predicate — the same one the Executive Overview and Sales Intelligence use.
 * The denormalised columns are still compared against the canonical total once per
 * summary request, and a material gap is reported as CUSTOMER_TOTALS_DIVERGENCE, because
 * a drifting cache is a real operational fault rather than something to paper over.
 */

/* ------------------------------------------------------------------ thresholds */

/**
 * Behavioural segmentation, v1. Exported so the UI tooltip, the tests and this SQL all
 * read the same numbers instead of three copies drifting apart.
 *
 * The bands are deliberately generous. A shoe shop's repeat cycle is months, not weeks,
 * so calling a customer "at risk" after 30 quiet days would flag most of a healthy base.
 */
export const CUSTOMER_SEGMENT_RULES = Object.freeze({
  atRiskAfterDays: 60,
  dormantAfterDays: 180,
});

/**
 * Every segment a customer can land in. The set is total: `classifyCustomerSegment`
 * returns one of these for every combination of inputs, so an unclassified remainder
 * would mean the rules grew a hole rather than something to display quietly.
 */
export const CUSTOMER_SEGMENTS = Object.freeze([
  "new",
  "new_repeat",
  "active_repeat",
  "recent",
  "at_risk",
  "dormant",
  "never_ordered",
]);

/**
 * Classify one customer from three facts: did they order inside the window, had they
 * ordered before it, and how long ago was their most recent order.
 *
 * Order matters. "Ordered in this window" always wins over recency, because a customer
 * who bought yesterday is not at risk no matter what the gap before that was.
 */
export const classifyCustomerSegment = ({ orderedInWindow, orderedBefore, daysSinceLastOrder, lifetimeOrders }) => {
  if (orderedInWindow) {
    // Acquired in this window. Whether they have already come back is the single most
    // useful thing to know about a new customer, so it gets its own segment rather than
    // being folded into "new" — a window in which 13 customers each bought six times is a
    // completely different business from one in which 13 bought once.
    if (!orderedBefore) return (lifetimeOrders ?? 0) > 1 ? "new_repeat" : "new";
    // They ordered before this window and ordered again inside it. That is a repeat
    // purchase by definition; lifetimeOrders cannot be 1 here.
    return "active_repeat";
  }
  if (daysSinceLastOrder === null || daysSinceLastOrder === undefined) return "never_ordered";
  if (daysSinceLastOrder >= CUSTOMER_SEGMENT_RULES.dormantAfterDays) return "dormant";
  if (daysSinceLastOrder >= CUSTOMER_SEGMENT_RULES.atRiskAfterDays) return "at_risk";
  // Bought recently but not inside the selected window — still an engaged customer, and
  // calling them "active" would be a lie about the window the manager chose.
  return "recent";
};

/** Segments that mean "this customer is currently buying". */
export const ENGAGED_SEGMENTS = Object.freeze(["new", "new_repeat", "active_repeat", "recent"]);
/**
 * Segments that constitute a repeat purchase.
 *
 * Repeat means "has bought more than once", NOT "existed before the selected window".
 * Confusing the two reports a repeat rate of 0% for a shop whose customers were all won
 * this quarter and have each already bought six times — the exact opposite of the truth,
 * and exactly what the first cut of this file did until the dev data caught it.
 */
export const REPEAT_SEGMENTS = Object.freeze(["new_repeat", "active_repeat"]);
/** Segments that mean "this customer has stopped". */
export const LAPSED_SEGMENTS = Object.freeze(["at_risk", "dormant"]);

export const CUSTOMER_DIMENSIONS = Object.freeze(["segment", "tier", "channel", "branch"]);
export const DEFAULT_CUSTOMER_DIMENSION = "segment";

export const CUSTOMER_SORTS = Object.freeze({
  net_sales: "net_sales",
  orders: "orders",
  units: "units",
  average_order: "average_order_value",
  last_order: "last_order_at",
  first_order: "first_order_at",
});
export const DEFAULT_CUSTOMER_SORT = "net_sales";

/** Beyond this the denormalised customer totals have drifted from the canonical figure. */
export const TOTALS_DIVERGENCE_TOLERANCE = 0.02;

/* ----------------------------------------------------------------------- scope */

const loadColumns = async (client) => {
  const read = async (table) => {
    const result = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
      [table]
    );
    return new Set(result.rows.map((row) => row.column_name));
  };
  const [customerColumns, orderColumns, itemColumns, branchColumns] = await Promise.all([
    read("customers"), read("orders"), read("order_items"), read("branches"),
  ]);
  return { customerColumns, orderColumns, itemColumns, branchColumns };
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

  // The order scan is NOT limited to the window: segmentation needs each customer's
  // whole order history to know whether a purchase inside the window was their first and
  // how long the gap before it was. The window filter is applied per aggregate instead.
  const orderClauses = [];
  if (tenantId !== null && orderColumns.has("tenant_id")) orderClauses.push("o.tenant_id = $1");
  if (filters.branchId && orderColumns.has("branch_id")) orderClauses.push(`o.branch_id = ${bind(filters.branchId)}`);
  if (filters.channel && orderColumns.has("channel")) orderClauses.push(`LOWER(COALESCE(o.channel,'')) = LOWER(${bind(filters.channel)})`);
  if (filters.customerId) orderClauses.push(`o.customer_id = ${bind(filters.customerId)}`);
  orderClauses.push(...canonicalOrderClauses(orderColumns).clauses);
  // A walk-in sale carries no customer_id. It is real revenue but it is not a customer,
  // so it is excluded here and its absence is reported rather than silently dropped.
  orderClauses.push("o.customer_id IS NOT NULL");

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
    beforeCurrent: `o.created_at < ${currentFrom}::date`,
  };
};

/**
 * One row per customer who has ever ordered, carrying everything the segmentation and
 * every KPI need. Built once per request so the sections cannot disagree about who is
 * active.
 *
 * `revenue` is the canonical order revenue expression — the same one the Executive
 * Overview sums — so a customer total and the company total are the same arithmetic.
 */
const customerCte = ({ scope, columns }) => {
  const revenue = orderRevenueExpr(columns.orderColumns);
  const units = columns.itemColumns.size
    ? `(SELECT COALESCE(SUM(GREATEST(COALESCE(oi.quantity,0) - COALESCE(oi.returned_quantity,0), 0)), 0)
         FROM order_items oi WHERE oi.order_id = o.id)`
    : "0";

  return `
    scoped_orders AS (
      SELECT o.id,
             o.customer_id,
             o.created_at,
             ${columns.orderColumns.has("channel") ? "COALESCE(NULLIF(o.channel, ''), 'pos')" : "'pos'"} AS channel,
             ${columns.orderColumns.has("branch_id") ? "o.branch_id" : "NULL::bigint"}                   AS branch_id,
             ${revenue}                                                                                  AS revenue,
             ${units}                                                                                    AS units,
             (${scope.inCurrent})                                                                        AS in_current,
             (${scope.inPrevious})                                                                       AS in_previous,
             (${scope.beforeCurrent})                                                                    AS before_current
      FROM orders o
      WHERE ${scope.orderWhere}
    ),
    per_customer AS (
      SELECT so.customer_id,
             COUNT(*)                                                        AS lifetime_orders,
             COALESCE(SUM(so.revenue), 0)                                    AS lifetime_revenue,
             MIN(so.created_at)                                              AS first_order_at,
             MAX(so.created_at)                                              AS last_order_at,
             COUNT(*) FILTER (WHERE so.in_current)                           AS orders_current,
             COALESCE(SUM(so.revenue) FILTER (WHERE so.in_current), 0)       AS revenue_current,
             COALESCE(SUM(so.units)   FILTER (WHERE so.in_current), 0)       AS units_current,
             COUNT(*) FILTER (WHERE so.in_previous)                          AS orders_previous,
             COALESCE(SUM(so.revenue) FILTER (WHERE so.in_previous), 0)      AS revenue_previous,
             BOOL_OR(so.before_current)                                      AS ordered_before,
             MAX(so.created_at) FILTER (WHERE so.in_current)                 AS last_order_in_window,
             (ARRAY_AGG(so.channel ORDER BY so.created_at DESC))[1]          AS latest_channel,
             (ARRAY_AGG(so.branch_id ORDER BY so.created_at DESC))[1]        AS latest_branch_id
      FROM scoped_orders so
      GROUP BY so.customer_id
    ),
    segmented AS (
      SELECT pc.*,
             GREATEST(EXTRACT(DAY FROM (${scope.currentTo}::date + INTERVAL '1 day') - pc.last_order_at), 0)::int AS days_since_last_order,
             CASE
               WHEN pc.orders_current > 0 AND NOT COALESCE(pc.ordered_before, FALSE) AND pc.lifetime_orders > 1 THEN 'new_repeat'
               WHEN pc.orders_current > 0 AND NOT COALESCE(pc.ordered_before, FALSE) THEN 'new'
               WHEN pc.orders_current > 0                                            THEN 'active_repeat'
               WHEN GREATEST(EXTRACT(DAY FROM (${scope.currentTo}::date + INTERVAL '1 day') - pc.last_order_at), 0) >= ${CUSTOMER_SEGMENT_RULES.dormantAfterDays} THEN 'dormant'
               WHEN GREATEST(EXTRACT(DAY FROM (${scope.currentTo}::date + INTERVAL '1 day') - pc.last_order_at), 0) >= ${CUSTOMER_SEGMENT_RULES.atRiskAfterDays}  THEN 'at_risk'
               ELSE 'recent'
             END AS segment
      FROM per_customer pc
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

export const getCustomersSummary = async ({ filters, permissions = {}, client = db }) => {
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  const granularity = filters.granularity && filters.granularity !== "auto"
    ? filters.granularity
    : filters.days <= 2 ? "hour" : filters.days <= 62 ? "day" : filters.days <= 240 ? "week" : "month";
  const bucket = TIME_BUCKETS[granularity] || TIME_BUCKETS.day;

  const tierExpr = columns.customerColumns.has("loyalty_tier")
    ? "COALESCE(NULLIF(TRIM(c.loyalty_tier), ''), 'غير مصنف')"
    : "'غير مصنف'";

  const sql = `
    WITH ${customerCte({ scope, columns })},
    totals AS (
      SELECT
        COUNT(*)                                                             AS customers_with_orders,
        COUNT(*) FILTER (WHERE orders_current > 0)                           AS active_current,
        COUNT(*) FILTER (WHERE orders_previous > 0)                          AS active_previous,
        COUNT(*) FILTER (WHERE segment IN ('new', 'new_repeat'))              AS new_current,
        COUNT(*) FILTER (WHERE orders_current > 0 AND lifetime_orders > 1)    AS returning_current,
        COUNT(*) FILTER (WHERE segment = 'at_risk')                          AS at_risk,
        COUNT(*) FILTER (WHERE segment = 'dormant')                          AS dormant,
        COALESCE(SUM(orders_current), 0)                                     AS orders_current,
        COALESCE(SUM(orders_previous), 0)                                    AS orders_previous,
        COALESCE(SUM(revenue_current), 0)                                    AS revenue_current,
        COALESCE(SUM(revenue_previous), 0)                                   AS revenue_previous,
        COALESCE(SUM(units_current), 0)                                      AS units_current,
        COALESCE(SUM(lifetime_revenue), 0)                                   AS lifetime_revenue_canonical
      FROM segmented
    ),
    segments AS (
      SELECT segment,
             COUNT(*)                              AS customers,
             COALESCE(SUM(revenue_current), 0)     AS revenue,
             COALESCE(SUM(orders_current), 0)      AS orders
      FROM segmented GROUP BY segment
    ),
    tiers AS (
      SELECT ${tierExpr}                            AS tier,
             COUNT(*)                               AS customers,
             COALESCE(SUM(sg.revenue_current), 0)   AS revenue,
             COUNT(*) FILTER (WHERE sg.segment = ANY(ARRAY['at_risk','dormant']))  AS lapsed
      FROM segmented sg
      JOIN customers c ON c.id = sg.customer_id
      GROUP BY 1
    ),
    base AS (
      SELECT COUNT(*)                                                                    AS total_customers,
             COUNT(*) FILTER (WHERE c.created_at >= ${scope.currentFrom}::date
                                AND c.created_at < (${scope.currentTo}::date + INTERVAL '1 day')) AS registered_in_window,
             COALESCE(SUM(${columns.customerColumns.has("total_spent") ? "NULLIF(c.total_spent, 'NaN'::numeric)" : "0"}), 0) AS denormalised_total_spent
      FROM customers c
      WHERE ${scope.tenantScoped ? "c.tenant_id = $1" : "TRUE"}
        ${columns.customerColumns.has("deleted_at") ? "AND c.deleted_at IS NULL" : ""}
    ),
    trend AS (
      SELECT ${bucket}                                                     AS bucket,
             COUNT(DISTINCT o.customer_id)                                 AS active_customers,
             COUNT(*)                                                      AS orders,
             COALESCE(SUM(so.revenue), 0)                                  AS revenue
      FROM scoped_orders so
      JOIN orders o ON o.id = so.id
      WHERE so.in_current
      GROUP BY 1
    ),
    new_trend AS (
      SELECT ${bucket.replace(/o\.created_at/g, "sg.first_order_at")}       AS bucket,
             COUNT(*)                                                       AS new_customers
      FROM segmented sg
      WHERE sg.segment IN ('new', 'new_repeat')
      GROUP BY 1
    ),
    walkins AS (
      SELECT COUNT(*) AS orders, COALESCE(SUM(${orderRevenueExpr(columns.orderColumns)}), 0) AS revenue
      FROM orders o
      WHERE ${scope.tenantScoped && columns.orderColumns.has("tenant_id") ? "o.tenant_id = $1 AND " : ""}
            o.customer_id IS NULL
        AND ${canonicalOrderClauses(columns.orderColumns).clauses.join(" AND ")}
        AND ${scope.inCurrent}
    )
    SELECT
      (SELECT row_to_json(t) FROM totals t)   AS totals,
      (SELECT row_to_json(b) FROM base b)     AS base,
      (SELECT row_to_json(w) FROM walkins w)  AS walkins,
      (SELECT COALESCE(json_agg(json_build_object('segment', segment, 'customers', customers, 'revenue', revenue, 'orders', orders)), '[]'::json) FROM segments) AS segments,
      (SELECT COALESCE(json_agg(json_build_object('tier', tier, 'customers', customers, 'revenue', revenue, 'lapsed', lapsed) ORDER BY customers DESC), '[]'::json) FROM tiers) AS tiers,
      (SELECT COALESCE(json_agg(json_build_object('bucket', t.bucket, 'activeCustomers', t.active_customers, 'orders', t.orders, 'revenue', t.revenue, 'newCustomers', COALESCE(n.new_customers, 0)) ORDER BY t.bucket), '[]'::json)
         FROM trend t LEFT JOIN new_trend n ON n.bucket = t.bucket) AS trend
  `;

  const result = await runTimed(client, sql, scope.params, timings, "summary");
  const row = result.rows[0] || {};
  const totals = row.totals || {};
  const base = row.base || {};
  const walkins = row.walkins || {};

  const activeCurrent = toFiniteNumber(totals.active_current) ?? 0;
  const activePrevious = scope.hasComparison ? toFiniteNumber(totals.active_previous) ?? 0 : null;
  const ordersCurrent = toFiniteNumber(totals.orders_current) ?? 0;
  const ordersPrevious = scope.hasComparison ? toFiniteNumber(totals.orders_previous) ?? 0 : null;
  const revenueCurrent = toFiniteNumber(totals.revenue_current) ?? 0;
  const revenuePrevious = scope.hasComparison ? toFiniteNumber(totals.revenue_previous) ?? 0 : null;
  const returningCurrent = toFiniteNumber(totals.returning_current) ?? 0;

  // The denormalised cache versus the canonical sum. A drifting cache is a real fault:
  // the customer screen, the loyalty tier and this report would each show a different
  // lifetime value, and only one of them can be right.
  const canonicalLifetime = toFiniteNumber(totals.lifetime_revenue_canonical) ?? 0;
  const denormalised = toFiniteNumber(base.denormalised_total_spent) ?? 0;
  if (canonicalLifetime > 0) {
    const drift = Math.abs(canonicalLifetime - denormalised) / canonicalLifetime;
    if (drift > TOTALS_DIVERGENCE_TOLERANCE) {
      collector.add(
        "CUSTOMER_TOTALS_DIVERGENCE",
        "The stored customers.total_spent column disagrees with the canonical order total. Every figure here uses the canonical total; the stored column needs rebuilding.",
        { canonical: toMoney(canonicalLifetime), stored: toMoney(denormalised), deltaPercent: drift }
      );
    }
  }

  const walkinOrders = toFiniteNumber(walkins.orders) ?? 0;
  if (walkinOrders > 0) {
    collector.add(
      "WALK_IN_ORDERS_EXCLUDED",
      "Orders with no customer record are excluded from every figure on this page, because they cannot be attributed to a customer.",
      { orders: walkinOrders, revenue: toMoney(toFiniteNumber(walkins.revenue) ?? 0) }
    );
  }

  const segments = (row.segments || []).map((entry) => ({
    segment: entry.segment,
    customers: toFiniteNumber(entry.customers) ?? 0,
    orders: toFiniteNumber(entry.orders) ?? 0,
    revenue: toMoney(toFiniteNumber(entry.revenue) ?? 0),
  }));

  // Totality check. classifyCustomerSegment is total by construction, so a customer that
  // landed outside the known set means the SQL and the JS rules have diverged.
  const unknownSegments = segments.filter((entry) => !CUSTOMER_SEGMENTS.includes(entry.segment));
  if (unknownSegments.length) {
    collector.add(
      "CUSTOMER_SEGMENT_UNCLASSIFIED",
      "Customer segmentation produced a class the contract does not describe.",
      { segments: unknownSegments.map((entry) => entry.segment) }
    );
  }

  return buildEnvelope({
    meta: {
      permissions: { cost: Boolean(permissions.cost), customers: Boolean(permissions.customers) },
      granularity,
      timings,
      segmentRules: CUSTOMER_SEGMENT_RULES,
      // Named so the UI can state on screen that money here is canonical order revenue,
      // not the denormalised customer column.
      basis: { revenue: "canonical_order_revenue", segmentation: "orders_not_loyalty_tier" },
    },
    data: {
      kpis: {
        totalCustomers: { current: toFiniteNumber(base.total_customers) ?? 0 },
        activeCustomers: buildDelta(activeCurrent, activePrevious, { collector, metric: "activeCustomers" }),
        newCustomers: { current: toFiniteNumber(totals.new_current) ?? 0 },
        returningCustomers: { current: returningCurrent },
        repeatPurchaseRate: { current: safeRatio(returningCurrent, activeCurrent) },
        customerOrders: buildDelta(ordersCurrent, ordersPrevious, { collector, metric: "customerOrders" }),
        customerRevenue: buildDelta(toMoney(revenueCurrent), revenuePrevious === null ? null : toMoney(revenuePrevious), { collector, metric: "customerRevenue" }),
        averageCustomerValue: { current: toMoney(safeRatio(revenueCurrent, activeCurrent)) },
        averageOrderValue: { current: toMoney(safeRatio(revenueCurrent, ordersCurrent)) },
        ordersPerCustomer: { current: safeRatio(ordersCurrent, activeCurrent) },
        lapsedCustomers: { current: (toFiniteNumber(totals.at_risk) ?? 0) + (toFiniteNumber(totals.dormant) ?? 0) },
        registeredInWindow: { current: toFiniteNumber(base.registered_in_window) ?? 0 },
      },
      segments,
      tiers: (row.tiers || []).map((entry) => ({
        tier: entry.tier,
        customers: toFiniteNumber(entry.customers) ?? 0,
        revenue: toMoney(toFiniteNumber(entry.revenue) ?? 0),
        lapsed: toFiniteNumber(entry.lapsed) ?? 0,
      })),
      trend: (row.trend || []).map((entry) => ({
        bucket: entry.bucket,
        activeCustomers: toFiniteNumber(entry.activeCustomers) ?? 0,
        newCustomers: toFiniteNumber(entry.newCustomers) ?? 0,
        orders: toFiniteNumber(entry.orders) ?? 0,
        revenue: toMoney(toFiniteNumber(entry.revenue) ?? 0),
      })),
      excludedWalkIns: { orders: walkinOrders, revenue: toMoney(toFiniteNumber(walkins.revenue) ?? 0) },
      highlights: buildCustomerHighlights({ segments, activeCurrent, activePrevious, returningCurrent, revenueCurrent }),
    },
    filters,
    collector,
  });
};

/**
 * Deterministic highlights. Each states a fact already in the payload and carries the
 * numbers behind it. Nothing here scores, predicts or ranks by a hidden model.
 */
export const buildCustomerHighlights = ({ segments, activeCurrent, activePrevious, returningCurrent, revenueCurrent }) => {
  const highlights = [];
  const bySegment = Object.fromEntries(segments.map((entry) => [entry.segment, entry]));

  const lapsed = (bySegment.at_risk?.customers ?? 0) + (bySegment.dormant?.customers ?? 0);
  const engaged = ENGAGED_SEGMENTS.reduce((sum, key) => sum + (bySegment[key]?.customers ?? 0), 0);

  if (lapsed > 0 && engaged > 0 && lapsed > engaged) {
    highlights.push({
      code: "LAPSED_EXCEEDS_ENGAGED",
      severity: "warning",
      messageKey: "highlights.lapsedExceedsEngaged",
      metric: "lapsedCustomers",
      values: { lapsed, engaged },
    });
  }

  if (bySegment.at_risk?.customers > 0) {
    highlights.push({
      code: "AT_RISK_CUSTOMERS",
      severity: "info",
      messageKey: "highlights.atRisk",
      metric: "atRisk",
      values: { customers: bySegment.at_risk.customers, afterDays: CUSTOMER_SEGMENT_RULES.atRiskAfterDays },
    });
  }

  const wonCustomers = (bySegment.new?.customers ?? 0) + (bySegment.new_repeat?.customers ?? 0);
  if (wonCustomers > 0) {
    highlights.push({
      code: "NEW_CUSTOMERS_WON",
      severity: "info",
      messageKey: "highlights.newCustomers",
      metric: "newCustomers",
      values: {
        customers: wonCustomers,
        alreadyRepeated: bySegment.new_repeat?.customers ?? 0,
        revenueValue: toMoney((bySegment.new?.revenue ?? 0) + (bySegment.new_repeat?.revenue ?? 0)),
      },
    });
  }

  if (activePrevious !== null && activePrevious > 0) {
    const change = (activeCurrent - activePrevious) / activePrevious;
    if (Math.abs(change) >= 0.2) {
      highlights.push({
        code: change > 0 ? "ACTIVE_BASE_GROWING" : "ACTIVE_BASE_SHRINKING",
        severity: change > 0 ? "info" : "warning",
        messageKey: change > 0 ? "highlights.baseGrowing" : "highlights.baseShrinking",
        metric: "activeCustomers",
        values: { changePercent: Math.abs(change), currentCount: activeCurrent, previousCount: activePrevious },
      });
    }
  }

  if (activeCurrent > 0 && returningCurrent === 0 && revenueCurrent > 0) {
    highlights.push({
      code: "NO_REPEAT_PURCHASES",
      severity: "warning",
      messageKey: "highlights.noRepeat",
      metric: "repeatPurchaseRate",
      values: { active: activeCurrent },
    });
  }

  return highlights;
};

/* ------------------------------------------------------------------ breakdown */

export const getCustomersBreakdown = async ({ filters, permissions = {}, client = db }) => {
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  const requested = CUSTOMER_DIMENSIONS.includes(filters.dimension) ? filters.dimension : DEFAULT_CUSTOMER_DIMENSION;

  const dimensionSql = {
    segment: { expr: "sg.segment", join: "" },
    tier: {
      expr: columns.customerColumns.has("loyalty_tier") ? "COALESCE(NULLIF(TRIM(c.loyalty_tier), ''), 'غير مصنف')" : "'غير مصنف'",
      join: "JOIN customers c ON c.id = sg.customer_id",
    },
    channel: { expr: "COALESCE(NULLIF(sg.latest_channel, ''), 'pos')", join: "" },
    branch: { expr: "COALESCE(NULLIF(TRIM(b.name), ''), 'بدون فرع')", join: "LEFT JOIN branches b ON b.id = sg.latest_branch_id" },
  }[requested];

  const sql = `
    WITH ${customerCte({ scope, columns })},
    grouped AS (
      SELECT ${dimensionSql.expr}                          AS key,
             COUNT(*)                                      AS customers,
             COUNT(*) FILTER (WHERE sg.orders_current > 0) AS active_customers,
             COALESCE(SUM(sg.orders_current), 0)           AS orders,
             COALESCE(SUM(sg.revenue_current), 0)          AS revenue,
             COALESCE(SUM(sg.units_current), 0)            AS units,
             COALESCE(SUM(sg.revenue_previous), 0)         AS revenue_previous
      FROM segmented sg
      ${dimensionSql.join}
      GROUP BY 1
    )
    SELECT * FROM grouped ORDER BY revenue DESC NULLS LAST, customers DESC
  `;

  const result = await runTimed(client, sql, scope.params, timings, "breakdown");
  const rows = result.rows || [];
  const totalRevenue = rows.reduce((sum, row) => sum + (toFiniteNumber(row.revenue) ?? 0), 0);
  const totalCustomers = rows.reduce((sum, row) => sum + (toFiniteNumber(row.customers) ?? 0), 0);

  const mapped = rows.map((row) => {
    const revenue = toFiniteNumber(row.revenue) ?? 0;
    const revenuePrevious = scope.hasComparison ? toFiniteNumber(row.revenue_previous) ?? 0 : null;
    const customers = toFiniteNumber(row.customers) ?? 0;
    const orders = toFiniteNumber(row.orders) ?? 0;
    return {
      key: row.key,
      customers,
      activeCustomers: toFiniteNumber(row.active_customers) ?? 0,
      orders,
      units: toFiniteNumber(row.units) ?? 0,
      revenue: toMoney(revenue),
      revenueShare: safeRatio(revenue, totalRevenue),
      customerShare: safeRatio(customers, totalCustomers),
      averageCustomerValue: toMoney(safeRatio(revenue, customers)),
      averageOrderValue: toMoney(safeRatio(revenue, orders)),
      growth: revenuePrevious !== null && revenuePrevious > 0 ? (revenue - revenuePrevious) / revenuePrevious : null,
    };
  });

  return buildEnvelope({
    meta: {
      permissions: { customers: Boolean(permissions.customers) },
      dimension: requested,
      availableDimensions: CUSTOMER_DIMENSIONS,
      timings,
      segmentRules: CUSTOMER_SEGMENT_RULES,
    },
    data: {
      dimension: requested,
      rows: mapped,
      totals: { customers: totalCustomers, revenue: toMoney(totalRevenue) },
    },
    filters,
    collector,
  });
};

/* ----------------------------------------------------------------------- list */

/**
 * Top customers.
 *
 * Names are present only for a caller holding `customers:view`. Without it the row keeps
 * every number and loses only the identity — `customerName` is null and `anonymised` is
 * true, so the UI renders "عميل #3" rather than pretending the row does not exist. A
 * report that silently drops rows a caller may not fully see would understate the totals
 * on the same page.
 *
 * `phone` and `email` are not selected for anyone.
 */
export const getCustomersList = async ({ filters, permissions = {}, client = db }) => {
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};
  const showNames = Boolean(permissions.customers);

  const sortKey = CUSTOMER_SORTS[filters.sort] || CUSTOMER_SORTS[DEFAULT_CUSTOMER_SORT];
  const sortDir = filters.sortDir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(filters.limit || 25, 1), 200);
  const offset = ((filters.page || 1) - 1) * limit;

  const searchClause = filters.search && showNames
    ? `AND COALESCE(c.name, '') ILIKE ${scope.bind(`%${filters.search}%`)}`
    : "";

  const sql = `
    WITH ${customerCte({ scope, columns })},
    listed AS (
      SELECT sg.customer_id,
             ${showNames ? "COALESCE(NULLIF(TRIM(c.name), ''), 'عميل بدون اسم')" : "NULL::text"} AS customer_name,
             ${columns.customerColumns.has("loyalty_tier") ? "COALESCE(NULLIF(TRIM(c.loyalty_tier), ''), 'غير مصنف')" : "'غير مصنف'"} AS tier,
             sg.segment,
             sg.orders_current                        AS orders,
             sg.revenue_current                       AS net_sales,
             sg.units_current                         AS units,
             sg.lifetime_orders,
             sg.lifetime_revenue,
             sg.first_order_at,
             sg.last_order_at,
             sg.days_since_last_order,
             CASE WHEN sg.orders_current > 0 THEN sg.revenue_current / sg.orders_current END AS average_order_value
      FROM segmented sg
      JOIN customers c ON c.id = sg.customer_id
      WHERE TRUE ${searchClause}
    )
    SELECT *, COUNT(*) OVER () AS total_rows, SUM(net_sales) OVER () AS grand_net_sales
    FROM listed
    ORDER BY ${sortKey} ${sortDir} NULLS LAST, customer_id ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const result = await runTimed(client, sql, scope.params, timings, "list");
  const rows = result.rows || [];
  const total = rows.length ? toFiniteNumber(rows[0].total_rows) ?? rows.length : 0;
  const grand = rows.length ? toFiniteNumber(rows[0].grand_net_sales) ?? 0 : 0;

  if (!showNames) {
    collector.add(
      "CUSTOMER_NAMES_RESTRICTED",
      "Customer names are hidden because this account does not hold the customers permission. Every figure on this page is unaffected.",
      {}
    );
  }

  return buildEnvelope({
    meta: {
      permissions: { customers: showNames },
      timings,
      sort: { key: filters.sort && CUSTOMER_SORTS[filters.sort] ? filters.sort : DEFAULT_CUSTOMER_SORT, direction: sortDir.toLowerCase() },
      availableSorts: Object.keys(CUSTOMER_SORTS),
      // Stated explicitly so nobody has to read the SQL to know what is NOT here.
      privacy: { contactDetails: "never_returned", names: showNames ? "visible" : "restricted" },
    },
    data: {
      rows: rows.map((row, index) => ({
        customerId: toFiniteNumber(row.customer_id),
        customerName: showNames ? row.customer_name : null,
        anonymised: !showNames,
        rank: offset + index + 1,
        tier: row.tier,
        segment: row.segment,
        orders: toFiniteNumber(row.orders) ?? 0,
        units: toFiniteNumber(row.units) ?? 0,
        netSales: toMoney(toFiniteNumber(row.net_sales) ?? 0),
        salesShare: safeRatio(toFiniteNumber(row.net_sales) ?? 0, grand),
        averageOrderValue: toMoney(toFiniteNumber(row.average_order_value)),
        lifetimeOrders: toFiniteNumber(row.lifetime_orders) ?? 0,
        lifetimeRevenue: toMoney(toFiniteNumber(row.lifetime_revenue) ?? 0),
        firstOrderAt: row.first_order_at,
        lastOrderAt: row.last_order_at,
        daysSinceLastOrder: toFiniteNumber(row.days_since_last_order),
      })),
      pagination: { page: filters.page || 1, limit, total, pages: limit > 0 ? Math.ceil(total / limit) : 1 },
    },
    filters,
    collector,
  });
};

export { buildScope, customerCte, loadColumns, runTimed };
