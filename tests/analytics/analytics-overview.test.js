// R2 — Executive Overview.
//
// assembleOverview is a pure function over three query result sets, so the whole
// contract (masking, coverage policy, comparison, exchange handling, warnings) is
// testable without a database. Live DB behaviour is covered by
// analytics-overview.db.test.js.
import test from "node:test";
import assert from "node:assert/strict";

import {
  METRIC_DIRECTION,
  assembleOverview,
  buildHighlights,
} from "../../server/services/analytics/analyticsOverviewService.js";
import { assertNoRestrictedFields } from "../../server/services/analytics/analyticsScope.js";
import { WARNING_CODES } from "../../server/services/analytics/analyticsComparison.js";

const FILTERS = {
  tenantId: 1,
  from: "2026-06-01",
  to: "2026-06-30",
  days: 30,
  comparisonMode: "previous_period",
  comparison: { from: "2026-05-02", to: "2026-05-31" },
};

const NO_COMPARISON = { ...FILTERS, comparisonMode: "none", comparison: null };

/** 100 orders, 10,000 net revenue, 4,000 cost, 200 units all costed. */
const baseInput = (overrides = {}) => ({
  ordersRow: {
    totals: {
      orders_current: 100, orders_previous: 80,
      revenue_current: 10000, revenue_previous: 8000,
      gross_current: 11000, gross_previous: 8800,
      discount_current: 1000, discount_previous: 800,
      invoice_discount_current: 0, coupon_discount_current: 0,
      credit_retained_current: 0, exchange_orders_current: 0,
      ...(overrides.totals || {}),
    },
    item_totals: {
      units_current: 200, units_previous: 160,
      cogs_current: 4000, cogs_previous: 3200,
      costed_units_current: 200, costed_units_previous: 160,
      ...(overrides.itemTotals || {}),
    },
    trend: overrides.trend || [
      { bucket: "2026-06-01T00:00:00.000Z", orders: 50, net_sales: 5000, units: 100, cogs: 2000, costed_units: 100 },
      { bucket: "2026-06-02T00:00:00.000Z", orders: 50, net_sales: 5000, units: 100, cogs: 2000, costed_units: 100 },
    ],
  },
  contextRow: {
    returns_current: 500, returns_previous: 400,
    returned_units_current: 10, sold_units_current: 210,
    new_customers_current: 12, new_customers_previous: 9,
    inventory_value: 55000, units_in_stock: 500, costed_units_in_stock: 500,
    legacy_products_stock: 500, orphan_return_items: 0,
    ...(overrides.contextRow || {}),
  },
  categoryRows: overrides.categoryRows || [
    { category: "رجالي", net_sales: 6000, units: 120, cogs: 2400, costed_units: 120 },
    { category: "حريمي", net_sales: 4000, units: 80, cogs: 1600, costed_units: 80 },
  ],
  filters: overrides.filters || FILTERS,
  granularity: "day",
  includeCost: overrides.includeCost ?? true,
  includeProfit: overrides.includeProfit ?? true,
});

const build = (overrides) => assembleOverview(baseInput(overrides));

/* ------------------------------------------------------------------ core maths */

test("net sales deducts returns from the order-scan revenue", () => {
  const { data } = build();
  // 10,000 revenue - 500 returns
  assert.equal(data.kpis.netSales.current, 9500);
  assert.equal(data.kpis.netSales.previous, 7600); // 8000 - 400
});

test("gross profit is net sales minus COGS, and margin derives from both", () => {
  const { data } = build();
  assert.equal(data.kpis.grossProfit.current, 5500); // 9500 - 4000
  assert.ok(Math.abs(data.kpis.grossMargin.current - 5500 / 9500) < 1e-9);
});

test("average order value and items per order use the correct denominators", () => {
  const { data } = build();
  assert.equal(data.kpis.averageOrderValue.current, 95); // 9500 / 100
  assert.equal(data.kpis.itemsPerOrder.current, 2); // 200 / 100
});

test("discount and return rates are shares of gross sales", () => {
  const { data } = build();
  assert.ok(Math.abs(data.kpis.discountRate.current - 1000 / 11000) < 1e-9);
  assert.ok(Math.abs(data.kpis.returnRate.current - 500 / 11000) < 1e-9);
});

test("a zero denominator yields null, not zero", () => {
  const { data } = build({ totals: { orders_current: 0, revenue_current: 0, gross_current: 0 } });
  assert.equal(data.kpis.averageOrderValue.current, null);
  assert.equal(data.kpis.itemsPerOrder.current, null);
  assert.equal(data.kpis.discountRate.current, null);
});

/* --------------------------------------------------------------- comparison */

test("percentage change against a zero base is null and raises a warning", () => {
  const { data, warnings } = build({ totals: { revenue_previous: 0, orders_previous: 0 } });
  assert.equal(data.kpis.netSales.previous, -400); // 0 revenue - 400 returns
  const orders = data.kpis.orders;
  assert.equal(orders.previous, 0);
  assert.equal(orders.deltaPercent, null);
  assert.ok(warnings.some((warning) => warning.code === WARNING_CODES.COMPARISON_BASE_ZERO));
});

test("with no comparison selected, previous values are null rather than zero", () => {
  const { data } = build({ filters: NO_COMPARISON });
  assert.equal(data.kpis.netSales.previous, null);
  assert.equal(data.kpis.netSales.deltaPercent, null);
  assert.equal(data.comparison, null);
});

test("metric direction marks lower-is-better metrics so colour is not sign-driven", () => {
  const { data } = build();
  assert.equal(data.kpis.returns.favourable, "lower");
  assert.equal(data.kpis.returnRate.favourable, "lower");
  assert.equal(data.kpis.discountRate.favourable, "lower");
  assert.equal(data.kpis.netSales.favourable, "higher");
  assert.equal(data.kpis.inventoryValue.favourable, "neutral");
  assert.equal(METRIC_DIRECTION.grossMargin, "higher");
});

/* ------------------------------------------------------- permission masking */

test("without reports:profit no profit value reaches the payload", () => {
  const { data, meta } = build({ includeProfit: false });
  assert.equal(data.kpis.grossProfit.current, null);
  assert.equal(data.kpis.grossProfit.previous, null);
  assert.equal(data.kpis.grossProfit.delta, null);
  assert.equal(data.kpis.grossProfit.restricted, true);
  assert.equal(data.kpis.grossMargin.current, null);
  assert.equal(meta.permissions.profit, false);

  const leaked = assertNoRestrictedFields(data, { cost: true, profit: false });
  assert.deepEqual(leaked, [], `restricted profit values leaked: ${leaked.join(", ")}`);
});

test("without reports:cost neither cost nor inventory value reaches the payload", () => {
  const { data, meta } = build({ includeCost: false, includeProfit: false });
  assert.equal(data.kpis.inventoryValue.current, null);
  assert.equal(data.kpis.inventoryValue.restricted, true);
  assert.equal(meta.cogsCoverage, null);

  const leaked = assertNoRestrictedFields(data, { cost: false, profit: false });
  assert.deepEqual(leaked, [], `restricted cost values leaked: ${leaked.join(", ")}`);
});

test("masked trend and category rows carry no profit numbers", () => {
  const { data } = build({ includeProfit: false });
  for (const point of data.trend) assert.equal(point.grossProfit, null);
  for (const row of data.categories.rows) assert.equal(row.grossProfit, null);
});

test("non-financial KPIs remain fully visible when profit is masked", () => {
  const { data } = build({ includeProfit: false });
  assert.equal(data.kpis.netSales.current, 9500);
  assert.equal(data.kpis.orders.current, 100);
  assert.equal(data.kpis.itemsSold.current, 200);
});

/* ---------------------------------------------------------- COGS coverage */

test("full coverage reports 1 and leaves profit intact", () => {
  const { data, meta, warnings } = build();
  assert.equal(meta.cogsCoverage, 1);
  assert.equal(data.kpis.grossProfit.current, 5500);
  assert.ok(!warnings.some((warning) => warning.code === WARNING_CODES.COGS_COVERAGE_LOW));
});

test("coverage between 50% and 95% warns but still shows profit", () => {
  const { data, meta, warnings } = build({ itemTotals: { costed_units_current: 140 } }); // 140/200 = 0.70
  assert.ok(Math.abs(meta.cogsCoverage - 0.7) < 1e-9);
  assert.equal(data.kpis.grossProfit.current, 5500, "profit must still be shown at 70% coverage");
  assert.ok(warnings.some((warning) => warning.code === WARNING_CODES.COGS_COVERAGE_LOW));
});

test("coverage below 50% blanks profit and margin with an explicit reason", () => {
  const { data, warnings } = build({ itemTotals: { costed_units_current: 80 } }); // 80/200 = 0.40
  assert.equal(data.kpis.grossProfit.current, null);
  assert.equal(data.kpis.grossMargin.current, null);
  assert.equal(data.kpis.grossProfit.unavailableReason, "COGS_COVERAGE_CRITICAL");
  assert.ok(warnings.some((warning) => warning.code === WARNING_CODES.COGS_COVERAGE_CRITICAL));
  // Unavailable is not the same as restricted.
  assert.ok(!data.kpis.grossProfit.restricted);
});

test("a trend bucket with critically thin coverage reports null profit, not zero", () => {
  const { data } = build({
    trend: [
      { bucket: "2026-06-01T00:00:00.000Z", orders: 50, net_sales: 5000, units: 100, cogs: 2000, costed_units: 100 },
      { bucket: "2026-06-02T00:00:00.000Z", orders: 50, net_sales: 5000, units: 100, cogs: 100, costed_units: 10 },
    ],
  });
  assert.equal(data.trend[0].grossProfit, 3000);
  assert.equal(data.trend[1].grossProfit, null, "a 10% coverage bucket must not draw a profit line");
  assert.equal(data.trend[1].netSales, 5000, "net sales stays visible");
});

/* -------------------------------------------------------------- categories */

test("the other bucket exposes its own value and never hides a dominant amount", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    category: `cat-${index}`, net_sales: 1000 - index * 10, units: 10, cogs: 400, costed_units: 10,
  }));
  const { data } = build({ categoryRows: rows });
  assert.equal(data.categories.rows.length, 8);
  assert.ok(data.categories.other, "an other bucket must exist when categories are truncated");
  assert.ok(data.categories.other.netSales > 0);
  assert.equal(data.categories.other.categoryCount, 4);

  const shown = data.categories.rows.reduce((sum, row) => sum + row.netSales, 0);
  assert.ok(Math.abs(shown + data.categories.other.netSales - data.categories.total) < 0.02);
});

test("heavily uncategorised sales raise a warning and are surfaced in the other bucket", () => {
  const { data, warnings } = build({
    categoryRows: [
      { category: "رجالي", net_sales: 1000, units: 10, cogs: 400, costed_units: 10 },
      { category: null, net_sales: 9000, units: 90, cogs: 3600, costed_units: 90 },
    ],
  });
  assert.ok(warnings.some((warning) => warning.code === WARNING_CODES.UNCATEGORISED_SALES_HIGH));
  assert.equal(data.categories.other.includesUncategorised, true);
  assert.equal(data.categories.other.netSales, 9000);
});

/* --------------------------------------------------------------- exchanges */

test("retained exchange credit is disclosed as a warning", () => {
  const { warnings } = build({ totals: { credit_retained_current: 200, exchange_orders_current: 1 } });
  const credit = warnings.find((warning) => warning.code === WARNING_CODES.EXCHANGE_CREDIT_RETAINED);
  assert.ok(credit, "retained credit must be disclosed");
  assert.equal(credit.creditRetained, 200);
  assert.ok(warnings.some((warning) => warning.code === WARNING_CODES.EXCHANGE_COGS_UNREVERSED));
});

/* ---------------------------------------------------------------- warnings */

test("orphan return lines and stock divergence are reported", () => {
  const { warnings } = build({
    contextRow: { orphan_return_items: 2, legacy_products_stock: 777, units_in_stock: 236, costed_units_in_stock: 236 },
  });
  assert.ok(warnings.some((warning) => warning.code === WARNING_CODES.ORPHAN_RETURN_ITEMS));
  const divergence = warnings.find((warning) => warning.code === WARNING_CODES.STOCK_SOURCE_DIVERGENCE);
  assert.ok(divergence);
  assert.equal(divergence.productsStock, 777);
  assert.equal(divergence.variantsStock, 236);
});

test("stock divergence is not reported to callers who cannot see cost", () => {
  const { warnings } = build({
    includeCost: false, includeProfit: false,
    contextRow: { legacy_products_stock: 777, units_in_stock: 236 },
  });
  assert.ok(!warnings.some((warning) => warning.code === WARNING_CODES.STOCK_SOURCE_DIVERGENCE));
});

/* -------------------------------------------------------------- highlights */

test("highlights are codes and raw values only - no prose from the backend", () => {
  const { data } = build({ totals: { revenue_previous: 5000 } });
  for (const highlight of data.highlights) {
    assert.ok(highlight.code, "highlight needs a code");
    assert.ok(highlight.severity, "highlight needs a severity");
    assert.ok(highlight.metric, "highlight needs a metric");
    assert.ok(highlight.messageKey, "highlight needs a messageKey");
    assert.ok(!/[؀-ۿ]/.test(JSON.stringify(highlight)), "no Arabic prose may come from the backend");
  }
});

test("highlights fire on material movements and stay capped at five", () => {
  const highlights = buildHighlights({
    kpis: {
      netSales: { current: 10000, previous: 5000, delta: 5000, deltaPercent: 1 },
      grossMargin: { current: 0.2, previous: 0.3, delta: -0.1 },
      returnRate: { current: 0.064, previous: 0.031, delta: 0.033 },
      averageOrderValue: { current: 120, previous: 100, delta: 20, deltaPercent: 0.2 },
    },
    cogsCoverage: 0.72,
  });
  assert.ok(highlights.length <= 5);
  const codes = highlights.map((item) => item.code);
  assert.ok(codes.includes("SALES_UP"));
  assert.ok(codes.includes("MARGIN_DOWN_SALES_UP"), "falling margin with rising sales is the key management signal");
  assert.ok(codes.includes("RETURN_RATE_UP"));
  assert.ok(codes.includes("COGS_COVERAGE_LOW"));

  // Ordered most-severe first. This fixture produces warnings and positives only,
  // so assert the ordering invariant rather than the presence of a critical.
  const rank = { critical: 0, warning: 1, positive: 2, info: 3 };
  const ranks = highlights.map((item) => rank[item.severity]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "highlights must be ordered by severity");
  assert.equal(highlights[0].severity, "warning");
});

test("severity escalates to critical past the hard thresholds", () => {
  const highlights = buildHighlights({
    kpis: {
      netSales: { current: 5000, previous: 10000, delta: -5000, deltaPercent: -0.5 },
      grossMargin: { current: 0.2, previous: 0.2, delta: 0 },
      returnRate: { current: 0.09, previous: 0.02, delta: 0.07 },
      averageOrderValue: { current: 100, previous: 100, delta: 0, deltaPercent: 0 },
    },
    cogsCoverage: 0.4,
  });
  const bySeverity = Object.fromEntries(highlights.map((item) => [item.code, item.severity]));
  assert.equal(bySeverity.SALES_DOWN, "critical", "a 50% sales drop is critical");
  assert.equal(bySeverity.RETURN_RATE_UP, "critical", "a 7-point return-rate rise is critical");
  assert.equal(bySeverity.COGS_COVERAGE_LOW, "critical", "coverage below 50% is critical");
  assert.equal(highlights[0].severity, "critical");
});

test("no highlight fires when nothing moved materially", () => {
  const highlights = buildHighlights({
    kpis: {
      netSales: { current: 1000, previous: 1000, delta: 0, deltaPercent: 0 },
      grossMargin: { current: 0.3, previous: 0.3, delta: 0 },
      returnRate: { current: 0.01, previous: 0.01, delta: 0 },
      averageOrderValue: { current: 100, previous: 100, delta: 0, deltaPercent: 0 },
    },
    cogsCoverage: 0.99,
  });
  assert.deepEqual(highlights, []);
});

/* ------------------------------------------------------------------- shape */

test("the response envelope carries period, contract version and query timings", () => {
  const { data, meta } = build();
  assert.equal(data.period.from, "2026-06-01");
  assert.equal(data.period.to, "2026-06-30");
  assert.equal(data.period.granularity, "day");
  assert.equal(meta.contractVersion, "1.0.0");
  assert.ok(meta.generatedAt);
  assert.equal(typeof meta.timings, "object");
});

test("the payload contains no presentation details", () => {
  const serialised = JSON.stringify(build());
  for (const token of ["color", "colour", "#", "icon", "className", "tailwind"]) {
    assert.ok(!serialised.toLowerCase().includes(token.toLowerCase()), `backend leaked presentation detail: ${token}`);
  }
});

test("an empty period returns verified zeros, never nulls-as-zero or fabricated data", () => {
  const { data } = build({
    totals: { orders_current: 0, orders_previous: 0, revenue_current: 0, revenue_previous: 0, gross_current: 0, gross_previous: 0, discount_current: 0, discount_previous: 0 },
    itemTotals: { units_current: 0, units_previous: 0, cogs_current: 0, cogs_previous: 0, costed_units_current: 0, costed_units_previous: 0 },
    contextRow: { returns_current: 0, returns_previous: 0, new_customers_current: 0, new_customers_previous: 0, inventory_value: 0, units_in_stock: 0, costed_units_in_stock: 0, legacy_products_stock: 0, orphan_return_items: 0 },
    trend: [],
    categoryRows: [],
  });
  assert.equal(data.kpis.netSales.current, 0);
  assert.equal(data.kpis.orders.current, 0);
  assert.equal(data.kpis.averageOrderValue.current, null, "AOV with no orders is undefined, not zero");
  assert.deepEqual(data.trend, []);
  assert.deepEqual(data.categories.rows, []);
  assert.equal(data.categories.other, null);
});
