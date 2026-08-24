/**
 * Reconcile the Reporting Center against canonical accounting, across several windows.
 *
 * READ ONLY. It runs SELECTs and prints a table. Nothing is written, and it is safe to
 * point at production.
 *
 *   node server/scripts/reconcileReportingCenter.js
 *   node server/scripts/reconcileReportingCenter.js --tenant=1
 *   node server/scripts/reconcileReportingCenter.js --windows=7,30,90,365
 *   node server/scripts/reconcileReportingCenter.js --json
 *
 * TWO KINDS OF COMPARISON, and confusing them is how a reconciliation report becomes
 * noise:
 *
 *   INTERNAL — the Reporting Center against itself. The Executive Overview and Sales
 *   Intelligence answer the same question from the same canon, so they must agree to the
 *   cent. Any drift here is a defect, and this script exits non-zero for it.
 *
 *   DECLARED — the Reporting Center against getProfitLossReport. These are EXPECTED to
 *   differ, because v2 deliberately corrects defects that accounting still carries:
 *   discount counted once (D-02), exchange orders recognising amount_due_now (D-03),
 *   soft-deleted orders excluded (D-04), draft-like statuses excluded (D-05), draft
 *   expenses excluded (D-07). A delta here is reported and quantified; it is not a
 *   failure. A delta of ZERO on a dataset that contains any of those cases would be the
 *   suspicious result, because it would mean a correction stopped being applied.
 *
 * The point of running this on production is to know the size of each declared delta in
 * money, so the owner can decide whether the legacy number needs correcting at source.
 */

import process from "node:process";

import db from "../database/db.js";
import { getProfitLossReport } from "../services/accountingService.js";
import { getExecutiveOverview } from "../services/analytics/analyticsOverviewService.js";
import { getSalesSummary } from "../services/analytics/analyticsSalesService.js";
import { getInventorySummary } from "../services/analytics/analyticsInventoryService.js";
import { getPurchasingSummary } from "../services/analytics/analyticsPurchasingService.js";
import { getCustomersSummary } from "../services/analytics/analyticsCustomersService.js";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const arg = (name, fallback) => {
  const found = argv.find((value) => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const tenantId = arg("tenant") ? Number(arg("tenant")) : 1;
const windows = String(arg("windows", "7,30,90,365"))
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

/** Internal drift beyond this is a defect, not rounding. */
const EXACT_TOLERANCE = 0.01;

const pad = (value) => String(value).padStart(2, "0");
const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const buildWindow = (days) => {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { days, from: isoDay(from), to: isoDay(to) };
};

const filtersFor = ({ from, to, days }) => ({
  tenantId,
  from,
  to,
  days,
  comparisonMode: "none",
  comparison: null,
  branchId: null, warehouseId: null, categoryId: null, brandId: null, supplierId: null,
  productId: null, customerId: null, employeeId: null, channel: null, paymentMethod: null,
  dimension: null, granularity: "auto", limit: 25, page: 1,
  productType: null, gender: null, category: null, search: null, sort: null,
  sortDir: "desc", fresh: false,
});

const PERMISSIONS = { view: true, cost: true, profit: true, customers: true };

const money = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const delta = (a, b) => (money(a) === null || money(b) === null ? null : money(money(a) - money(b)));
const format = (value) =>
  value === null || value === undefined ? "—" : Number(value).toLocaleString("en-GB", { maximumFractionDigits: 2 });

const checks = [];
const record = (entry) => {
  checks.push(entry);
  return entry;
};

const compareExact = ({ window, metric, left, leftLabel, right, rightLabel }) => {
  const difference = delta(left, right);
  const ok = difference === null ? left === right : Math.abs(difference) <= EXACT_TOLERANCE;
  return record({ kind: "internal", window: window.days, metric, leftLabel, rightLabel, left: money(left), right: money(right), delta: difference, ok });
};

const compareDeclared = ({ window, metric, left, leftLabel, right, rightLabel }) =>
  record({
    kind: "declared",
    window: window.days,
    metric,
    leftLabel,
    rightLabel,
    left: money(left),
    right: money(right),
    delta: delta(left, right),
    ok: true,
  });

const runWindow = async (window) => {
  const filters = filtersFor(window);

  // The P&L runs FIRST and alone. getProfitLossReport calls ensureAccountingSchema(),
  // which executes DDL at request time and therefore wants an AccessExclusiveLock;
  // issuing it alongside the analytics reads (which hold AccessShareLock) deadlocks
  // outright — proven here, 40P01, before this line was sequenced.
  const pnl = await getProfitLossReport(db, { tenantId, fromDate: window.from, toDate: window.to });

  const [overview, sales, inventory, purchasing, customers] = await Promise.all([
    getExecutiveOverview({ filters, permissions: PERMISSIONS }),
    getSalesSummary({ filters, permissions: PERMISSIONS }),
    getInventorySummary({ filters, permissions: PERMISSIONS }),
    getPurchasingSummary({ filters, permissions: PERMISSIONS }),
    getCustomersSummary({ filters, permissions: PERMISSIONS }),
  ]);

  const o = overview.data.kpis;
  const s = sales.data.kpis;

  /* ---- internal: the two screens that answer the same question must agree exactly ---- */

  compareExact({ window, metric: "netSales", left: o.netSales?.current, leftLabel: "R2 overview", right: s.netSales?.current, rightLabel: "R3 sales" });
  compareExact({ window, metric: "grossProfit", left: o.grossProfit?.current, leftLabel: "R2 overview", right: s.grossProfit?.current, rightLabel: "R3 sales" });
  compareExact({ window, metric: "orders", left: o.orders?.current, leftLabel: "R2 overview", right: s.orders?.current, rightLabel: "R3 sales" });
  compareExact({ window, metric: "itemsSold", left: o.itemsSold?.current, leftLabel: "R2 overview", right: s.itemsSold?.current, rightLabel: "R3 sales" });

  // Inventory demand is a SUBSET, not an equal. Its CTE keeps only variants with stock
  // on hand right now, because the section it feeds is stock against demand — a product
  // that sold out has no stock row to sit beside. So it can only ever be less than or
  // equal to total sales, and asserting equality here reports a defect that is not one.
  const inventoryDemand = inventory.data.kpis.netSalesPeriod?.current ?? 0;
  const totalSales = s.netSales?.current ?? 0;
  record({
    kind: "internal",
    window: window.days,
    metric: "netSalesPeriod ≤ netSales",
    leftLabel: "R4 inventory (stocked only)",
    rightLabel: "R3 sales (all)",
    left: money(inventoryDemand),
    right: money(totalSales),
    delta: delta(inventoryDemand, totalSales),
    ok: money(inventoryDemand) <= money(totalSales) + EXACT_TOLERANCE,
  });

  // And customers measures the same revenue minus the walk-in sales it cannot attribute.
  const walkIns = customers.data.excludedWalkIns?.revenue ?? 0;
  compareExact({
    window, metric: "customerRevenue + walkIns",
    left: (customers.data.kpis.customerRevenue?.current ?? 0) + walkIns, leftLabel: "R6 customers",
    right: s.netSales?.current, rightLabel: "R3 sales",
  });

  /* ---- declared: v2 against accounting, where the difference is the correction ---- */

  compareDeclared({ window, metric: "netSales", left: o.netSales?.current, leftLabel: "Reporting Center", right: pnl?.revenue?.net_sales, rightLabel: "accounting P&L" });
  compareDeclared({ window, metric: "grossProfit", left: o.grossProfit?.current, leftLabel: "Reporting Center", right: pnl?.gross_profit, rightLabel: "accounting P&L" });
  compareDeclared({ window, metric: "returns", left: o.returns?.current, leftLabel: "Reporting Center", right: pnl?.revenue?.returns, rightLabel: "accounting P&L" });
  compareDeclared({ window, metric: "discounts", left: null, leftLabel: "Reporting Center", right: pnl?.revenue?.discounts, rightLabel: "accounting P&L" });
  compareDeclared({ window, metric: "cogs", left: null, leftLabel: "Reporting Center", right: pnl?.cogs?.total_cogs, rightLabel: "accounting P&L" });

  return {
    window,
    warnings: [
      ...overview.warnings, ...sales.warnings, ...inventory.warnings,
      ...purchasing.warnings, ...customers.warnings,
    ].map((warning) => warning.code),
    figures: {
      netSales: money(o.netSales?.current),
      grossProfit: money(o.grossProfit?.current),
      grossMargin: o.grossMargin?.current ?? null,
      orders: o.orders?.current ?? null,
      itemsSold: o.itemsSold?.current ?? null,
      inventoryValue: money(inventory.data.kpis.inventoryValue?.current),
      unitsInStock: inventory.data.kpis.unitsInStock?.current ?? null,
      stockedProducts: inventory.data.kpis.stockedProducts?.current ?? null,
      purchaseSpend: money(purchasing.data.kpis.purchaseSpend?.current),
      purchaseUnits: purchasing.data.kpis.purchaseUnits?.current ?? null,
      activeCustomers: customers.data.kpis.activeCustomers?.current ?? null,
      repeatPurchaseRate: customers.data.kpis.repeatPurchaseRate?.current ?? null,
      accountingNetSales: money(pnl?.revenue?.net_sales),
      accountingGrossProfit: money(pnl?.gross_profit),
    },
  };
};

const run = async () => {
  const results = [];
  for (const days of windows) {
    const window = buildWindow(days);
    results.push(await runWindow(window));
  }

  if (asJson) {
    console.log(JSON.stringify({ tenantId, results, checks }, null, 2));
  } else {
    console.log(`\nReporting Center reconciliation — tenant ${tenantId}\n`);

    for (const result of results) {
      const { window, figures } = result;
      console.log(`── ${window.days}d  ${window.from} → ${window.to} ─────────────────────────────`);
      console.log(`   net sales        ${format(figures.netSales)}      accounting ${format(figures.accountingNetSales)}`);
      console.log(`   gross profit     ${format(figures.grossProfit)}      accounting ${format(figures.accountingGrossProfit)}`);
      console.log(`   orders           ${format(figures.orders)}    units ${format(figures.itemsSold)}`);
      console.log(`   inventory value  ${format(figures.inventoryValue)}    units ${format(figures.unitsInStock)}    products ${format(figures.stockedProducts)}`);
      console.log(`   purchase spend   ${format(figures.purchaseSpend)}    units ${format(figures.purchaseUnits)}`);
      console.log(`   active customers ${format(figures.activeCustomers)}    repeat ${figures.repeatPurchaseRate === null ? "—" : `${(figures.repeatPurchaseRate * 100).toFixed(1)}%`}`);
      if (result.warnings.length) {
        console.log(`   warnings         ${[...new Set(result.warnings)].join(", ")}`);
      }
      console.log("");
    }

    const internal = checks.filter((check) => check.kind === "internal");
    const failed = internal.filter((check) => !check.ok);

    console.log("Internal consistency (must be exact):");
    for (const check of internal) {
      const mark = check.ok ? "  ok " : "  ✗  ";
      console.log(
        `${mark}${String(check.window).padStart(4)}d  ${check.metric.padEnd(26)} ` +
          `${check.leftLabel} ${format(check.left)}  vs  ${check.rightLabel} ${format(check.right)}` +
          (check.delta ? `   Δ ${format(check.delta)}` : "")
      );
    }

    console.log("\nDeclared divergence from accounting (expected, quantified):");
    for (const check of checks.filter((entry) => entry.kind === "declared")) {
      if (check.left === null && check.right === null) continue;
      console.log(
        `      ${String(check.window).padStart(4)}d  ${check.metric.padEnd(26)} ` +
          `${format(check.left)}  vs  ${format(check.right)}   Δ ${format(check.delta)}`
      );
    }

    if (failed.length) {
      console.log(`\n${failed.length} internal check(s) FAILED. The Reporting Center disagrees with itself.`);
    } else {
      console.log(`\nAll ${internal.length} internal checks agree to within ${EXACT_TOLERANCE}.`);
    }
  }

  return checks.filter((check) => check.kind === "internal" && !check.ok).length;
};

run()
  .then(async (failures) => {
    await db.end?.();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (error) => {
    console.error("reconcileReportingCenter failed:", error);
    await db.end?.();
    process.exit(1);
  });
