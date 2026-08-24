import db from "../../database/db.js";
import { getProfitLossReport } from "../accountingService.js";
import { WarningCollector, buildEnvelope, safeRatio, toFiniteNumber, toMoney } from "./analyticsComparison.js";
import { getCustomersSummary } from "./analyticsCustomersService.js";
import { getEmployeesSummary } from "./analyticsEmployeesService.js";
import { getInventorySummary } from "./analyticsInventoryService.js";
import { getPurchasingSummary } from "./analyticsPurchasingService.js";
import { getExecutiveOverview } from "./analyticsOverviewService.js";
import { getSalesSummary } from "./analyticsSalesService.js";

/**
 * R10 — Reconciliation.
 *
 * ONE engine, two front doors. This module holds the whole comparison; the CLI script
 * (`server/scripts/reconcileReportingCenter.js`) and the `/v2/reconciliation` endpoint
 * both call it and neither computes anything of its own. A reconciliation report that
 * used a second implementation would be reconciling itself against itself.
 *
 * It also computes NOTHING from raw SQL. Every figure comes from the same service the
 * corresponding screen calls, so a check can only ever compare what a manager actually
 * sees. If a screen changes, this changes with it — which is the point.
 *
 * TWO KINDS OF CHECK, and confusing them makes the report noise:
 *
 *   INTERNAL — the Reporting Center against itself. Screens that answer the same
 *   question from the same canon must agree to the cent. A failure here is a defect and
 *   the overall status goes to FAIL.
 *
 *   DECLARED — the Reporting Center against getProfitLossReport. These are EXPECTED to
 *   differ, because v2 corrects defects accounting still carries: discount counted once
 *   (D-02), exchange orders recognising amount_due_now (D-03), soft-deleted orders
 *   excluded (D-04), draft-like statuses excluded (D-05), draft expenses excluded (D-07).
 *   The delta is quantified and never fails. A delta of ZERO on a dataset containing any
 *   of those cases would be the suspicious result, because it would mean a correction had
 *   stopped being applied.
 *
 * One invariant is a SUBSET rather than an equality: inventory demand ≤ total sales,
 * because the inventory CTE keeps only variants with stock on hand and a product that
 * sold out has no stock row to sit beside. Asserting equality there reports a defect
 * where there is none.
 */

/** Internal drift beyond this is a defect, not rounding. */
export const EXACT_TOLERANCE = 0.01;

/** Every declared divergence, with the defect it corrects. Rendered beside each delta. */
export const DECLARED_DIVERGENCES = Object.freeze([
  { id: "D-02", key: "discountDoubleCount" },
  { id: "D-03", key: "exchangeRecognition" },
  { id: "D-04", key: "softDeletedExcluded" },
  { id: "D-05", key: "draftStatusExcluded" },
  { id: "D-07", key: "draftExpensesExcluded" },
]);

const money = (value) => toMoney(toFiniteNumber(value));
const delta = (left, right) => {
  const a = money(left);
  const b = money(right);
  return a === null || b === null ? null : money(a - b);
};

/**
 * Build one check row.
 *
 * `kind` decides whether a difference is a defect. An internal check with a difference
 * fails; a declared one records the difference and passes, because the difference is the
 * correction working.
 */
const check = ({ kind, group, metric, leftLabel, left, rightLabel, right, comparison = "equal", note = null }) => {
  const difference = delta(left, right);
  let status;

  if (kind === "declared") {
    status = "info";
  } else if (left === null || right === null) {
    // Not computable is not the same as wrong. A check that cannot run says so.
    status = "unavailable";
  } else if (comparison === "lte") {
    status = money(left) <= money(right) + EXACT_TOLERANCE ? "pass" : "fail";
  } else {
    status = Math.abs(difference ?? 0) <= EXACT_TOLERANCE ? "pass" : "fail";
  }

  return {
    kind,
    group,
    metric,
    comparison,
    leftLabel,
    rightLabel,
    left: money(left),
    right: money(right),
    delta: difference,
    deltaPercent: kind === "declared" || status === "fail" ? safeRatio(difference, money(right)) : null,
    status,
    note,
  };
};

/**
 * Run the whole reconciliation for one window.
 *
 * Returns the standard v2 envelope, so the page consumes it exactly like every other
 * reporting endpoint.
 */
export const runReconciliation = async ({ filters, permissions = {}, client = db }) => {
  const collector = new WarningCollector();
  const timings = {};
  const includeCost = Boolean(permissions.cost);
  const includeProfit = Boolean(permissions.profit);

  // The P&L runs FIRST and ALONE. getProfitLossReport calls ensureAccountingSchema(),
  // which executes DDL at request time and wants an AccessExclusiveLock; issuing it
  // alongside the analytics reads (which hold AccessShareLock) deadlocks outright with
  // 40P01. Proven, not theorised.
  let pnl = null;
  let pnlError = null;
  const pnlStarted = Date.now();
  try {
    pnl = await getProfitLossReport(client, {
      tenantId: filters.tenantId,
      fromDate: filters.from,
      toDate: filters.to,
      branchId: filters.branchId || undefined,
    });
  } catch (error) {
    // Accounting being unavailable must not take the internal checks down with it: those
    // are the ones that detect a real defect.
    pnlError = error.message;
    collector.add(
      "ACCOUNTING_COMPARISON_UNAVAILABLE",
      "The accounting profit and loss could not be read, so the declared divergences could not be measured. The Reporting Center's internal checks are unaffected.",
      { error: error.message }
    );
  }
  timings.accounting = Date.now() - pnlStarted;

  const analyticsStarted = Date.now();
  const [overview, sales, inventory, purchasing, customers, employees] = await Promise.all([
    getExecutiveOverview({ filters, permissions, client }),
    getSalesSummary({ filters, permissions, client }),
    getInventorySummary({ filters, permissions, client }),
    getPurchasingSummary({ filters, permissions, client }),
    getCustomersSummary({ filters, permissions, client }),
    getEmployeesSummary({ filters, permissions, client }),
  ]);
  timings.analytics = Date.now() - analyticsStarted;

  const o = overview.data.kpis;
  const s = sales.data.kpis;
  const inv = inventory.data.kpis;
  const cust = customers.data.kpis;
  const emp = employees.data.kpis;

  const checks = [];

  /* ---- internal: the same question, answered by two screens ---- */

  checks.push(check({
    kind: "internal", group: "sales", metric: "netSales",
    leftLabel: "overview", left: o.netSales?.current,
    rightLabel: "sales", right: s.netSales?.current,
  }));
  checks.push(check({
    kind: "internal", group: "sales", metric: "orders",
    leftLabel: "overview", left: o.orders?.current,
    rightLabel: "sales", right: s.orders?.current,
  }));
  checks.push(check({
    kind: "internal", group: "sales", metric: "itemsSold",
    leftLabel: "overview", left: o.itemsSold?.current,
    rightLabel: "sales", right: s.itemsSold?.current,
  }));
  if (includeProfit) {
    checks.push(check({
      kind: "internal", group: "profit", metric: "grossProfit",
      leftLabel: "overview", left: o.grossProfit?.current,
      rightLabel: "sales", right: s.grossProfit?.current,
    }));
    checks.push(check({
      kind: "internal", group: "profit", metric: "grossMargin",
      leftLabel: "overview", left: o.grossMargin?.current,
      rightLabel: "sales", right: s.grossMargin?.current,
    }));
  }

  // Customer revenue plus walk-ins must add back up to company net sales. This is the
  // identity that caught customer revenue being gross of refunds while the Overview was
  // net of them — the two screens disagreed by exactly the returns total.
  const walkInRevenue = customers.data.excludedWalkIns?.revenue ?? 0;
  checks.push(check({
    kind: "internal", group: "customers", metric: "customerRevenuePlusWalkIns",
    leftLabel: "customers + walk-ins", left: (cust.customerRevenue?.current ?? 0) + walkInRevenue,
    rightLabel: "overview", right: o.netSales?.current,
    note: "walkIns",
  }));

  // Employee revenue covers every order, attributed or not, so it is the company total.
  checks.push(check({
    kind: "internal", group: "employees", metric: "sellerNetSales",
    leftLabel: "employees", left: emp.sellerNetSales?.current,
    rightLabel: "overview", right: o.netSales?.current,
  }));

  // Inventory demand is a SUBSET: its CTE keeps only variants with stock on hand.
  checks.push(check({
    kind: "internal", group: "inventory", metric: "demandWithinSales",
    comparison: "lte",
    leftLabel: "inventory demand", left: inv.netSalesPeriod?.current,
    rightLabel: "sales", right: s.netSales?.current,
    note: "stockedOnly",
  }));

  // Velocity classification must account for every stocked product. A residual means the
  // rules grew a hole, which the inventory service already reports — this makes it a
  // pass/fail line a manager can read.
  const health = inventory.data.health;
  const classified = health?.reconciliation?.classifiedProducts ?? null;
  const eligible = health?.reconciliation?.eligibleProducts ?? null;
  checks.push(check({
    kind: "internal", group: "inventory", metric: "velocityBuckets",
    leftLabel: "classified", left: classified,
    rightLabel: "stocked products", right: eligible,
  }));

  // Purchasing: the header total and the sum of its own lines. They need not match, and
  // the check exists to put a number on how far apart they are rather than to fail.
  if (includeCost) {
    const purchaseSpend = purchasing.data.kpis.purchaseSpend?.current ?? null;
    const lineDelta = (purchasing.warnings || []).find((warning) => warning.code === "PURCHASE_LINE_HEADER_DELTA");
    checks.push(check({
      kind: "declared", group: "purchasing", metric: "headerVersusLines",
      leftLabel: "purchase headers", left: lineDelta ? lineDelta.headerSpend : purchaseSpend,
      rightLabel: "purchase lines", right: lineDelta ? lineDelta.lineSpend : purchaseSpend,
      note: "headerLine",
    }));
  }

  /* ---- declared: v2 against accounting, where the difference IS the correction ---- */

  if (pnl) {
    checks.push(check({
      kind: "declared", group: "sales", metric: "netSales",
      leftLabel: "reporting center", left: o.netSales?.current,
      rightLabel: "accounting", right: pnl?.revenue?.net_sales,
    }));
    checks.push(check({
      kind: "declared", group: "sales", metric: "returns",
      leftLabel: "reporting center", left: o.returns?.current,
      rightLabel: "accounting", right: pnl?.revenue?.returns,
    }));
    checks.push(check({
      kind: "declared", group: "sales", metric: "discounts",
      leftLabel: "reporting center", left: null,
      rightLabel: "accounting", right: pnl?.revenue?.discounts,
      note: "discountNotPublished",
    }));
    if (includeProfit) {
      checks.push(check({
        kind: "declared", group: "profit", metric: "grossProfit",
        leftLabel: "reporting center", left: o.grossProfit?.current,
        rightLabel: "accounting", right: pnl?.gross_profit,
      }));
    }
    if (includeCost) {
      checks.push(check({
        kind: "declared", group: "profit", metric: "cogs",
        leftLabel: "reporting center", left: null,
        rightLabel: "accounting", right: pnl?.cogs?.total_cogs,
        note: "cogsNotPublishedSeparately",
      }));
    }
  }

  const internal = checks.filter((entry) => entry.kind === "internal");
  const failed = internal.filter((entry) => entry.status === "fail");
  const unavailable = internal.filter((entry) => entry.status === "unavailable");

  if (failed.length) {
    collector.add(
      "RECONCILIATION_FAILED",
      "The Reporting Center disagrees with itself. Every figure derived from the failing check is suspect until it is resolved.",
      { failed: failed.map((entry) => `${entry.group}.${entry.metric}`) }
    );
  }

  // Every warning any screen raised, deduplicated, so the reconciliation page is the one
  // place a manager can see the full data-quality picture.
  const seen = new Set();
  const sourceWarnings = [
    ...overview.warnings, ...sales.warnings, ...inventory.warnings,
    ...purchasing.warnings, ...customers.warnings, ...employees.warnings,
  ].filter((warning) => {
    if (seen.has(warning.code)) return false;
    seen.add(warning.code);
    return true;
  });

  return buildEnvelope({
    meta: {
      permissions: { cost: includeCost, profit: includeProfit },
      timings,
      tolerance: EXACT_TOLERANCE,
      accountingAvailable: Boolean(pnl),
      accountingError: pnlError,
      declaredDivergences: DECLARED_DIVERGENCES,
      // The moment the comparison was actually run, not when the page was opened.
      verifiedAt: new Date().toISOString(),
    },
    data: {
      status: failed.length ? "fail" : unavailable.length ? "partial" : "pass",
      counts: {
        total: internal.length,
        passed: internal.filter((entry) => entry.status === "pass").length,
        failed: failed.length,
        unavailable: unavailable.length,
        declared: checks.filter((entry) => entry.kind === "declared").length,
      },
      checks,
      figures: {
        netSales: money(o.netSales?.current),
        returns: money(o.returns?.current),
        grossProfit: includeProfit ? money(o.grossProfit?.current) : null,
        grossMargin: includeProfit ? (o.grossMargin?.current ?? null) : null,
        orders: o.orders?.current ?? null,
        itemsSold: o.itemsSold?.current ?? null,
        customerRevenue: money(cust.customerRevenue?.current),
        walkInRevenue: money(walkInRevenue),
        inventoryValue: includeCost ? money(inv.inventoryValue?.current) : null,
        unitsInStock: inv.unitsInStock?.current ?? null,
        stockedProducts: inv.stockedProducts?.current ?? null,
        purchaseSpend: includeCost ? money(purchasing.data.kpis.purchaseSpend?.current) : null,
        attributionCoverage: emp.attributionCoverage?.current ?? null,
        accountingNetSales: money(pnl?.revenue?.net_sales),
        accountingGrossProfit: includeProfit ? money(pnl?.gross_profit) : null,
        accountingCogs: includeCost ? money(pnl?.cogs?.total_cogs) : null,
        accountingDiscounts: money(pnl?.revenue?.discounts),
      },
      sourceWarnings,
    },
    filters,
    collector,
  });
};

export default runReconciliation;
