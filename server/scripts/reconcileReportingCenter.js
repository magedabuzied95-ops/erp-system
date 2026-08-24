/**
 * Reconcile the Reporting Center against canonical accounting, across several windows.
 *
 * READ ONLY. Every statement it runs is a SELECT. Safe to point at production.
 *
 *   node server/scripts/reconcileReportingCenter.js
 *   node server/scripts/reconcileReportingCenter.js --tenant=1
 *   node server/scripts/reconcileReportingCenter.js --windows=7,30,90,365
 *   node server/scripts/reconcileReportingCenter.js --json
 *
 * A THIN CLI, NOT AN ENGINE. Everything is computed by
 * services/analytics/analyticsReconciliationService.js, which the /v2/reconciliation
 * endpoint also calls. Two implementations of a reconciliation would be reconciling
 * themselves against themselves; this file only formats what the service returns and
 * turns a failure into an exit code.
 *
 * Exit 0 when every internal check passes, 1 when any fails.
 */

import process from "node:process";

import db from "../database/db.js";
import { runReconciliation } from "../services/analytics/analyticsReconciliationService.js";

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

const pad = (value) => String(value).padStart(2, "0");
const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const buildWindow = (days) => {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { days, from: isoDay(from), to: isoDay(to) };
};

/** The same filter shape the HTTP layer produces, so the service sees one input shape. */
const filtersFor = ({ from, to, days }) => ({
  tenantId, from, to, days,
  comparisonMode: "none", comparison: null,
  branchId: null, warehouseId: null, categoryId: null, brandId: null, supplierId: null,
  productId: null, customerId: null, employeeId: null, channel: null, paymentMethod: null,
  dimension: null, granularity: "auto", limit: 25, page: 1,
  productType: null, gender: null, category: null, search: null, sort: null,
  sortDir: "desc", fresh: false,
});

const PERMISSIONS = { view: true, cost: true, profit: true, customers: true };

const format = (value) =>
  value === null || value === undefined ? "—" : Number(value).toLocaleString("en-GB", { maximumFractionDigits: 2 });

const MARK = { pass: "  ok ", fail: "  X  ", unavailable: "  -- ", info: "     " };

const run = async () => {
  const results = [];

  for (const days of windows) {
    const window = buildWindow(days);
    const payload = await runReconciliation({ filters: filtersFor(window), permissions: PERMISSIONS, client: db });
    results.push({ window, payload });
  }

  if (asJson) {
    console.log(JSON.stringify({ tenantId, results }, null, 2));
    return results.some((entry) => entry.payload.data.status === "fail") ? 1 : 0;
  }

  console.log(`\nReporting Center reconciliation — tenant ${tenantId}\n`);

  for (const { window, payload } of results) {
    const { figures, counts, status } = payload.data;
    console.log(`── ${window.days}d  ${window.from} → ${window.to}  [${status.toUpperCase()}]  ${counts.passed}/${counts.total} internal checks pass`);
    console.log(`   net sales        ${format(figures.netSales)}      accounting ${format(figures.accountingNetSales)}`);
    console.log(`   gross profit     ${format(figures.grossProfit)}      accounting ${format(figures.accountingGrossProfit)}`);
    console.log(`   returns          ${format(figures.returns)}    orders ${format(figures.orders)}    units ${format(figures.itemsSold)}`);
    console.log(`   customers        ${format(figures.customerRevenue)}    walk-ins ${format(figures.walkInRevenue)}`);
    console.log(`   inventory value  ${format(figures.inventoryValue)}    units ${format(figures.unitsInStock)}    products ${format(figures.stockedProducts)}`);
    console.log(`   purchase spend   ${format(figures.purchaseSpend)}`);
    if (payload.data.sourceWarnings.length) {
      console.log(`   warnings         ${payload.data.sourceWarnings.map((w) => w.code).join(", ")}`);
    }
    console.log("");
  }

  console.log("Internal consistency (must be exact):");
  for (const { window, payload } of results) {
    for (const entry of payload.data.checks.filter((c) => c.kind === "internal")) {
      console.log(
        `${MARK[entry.status]}${String(window.days).padStart(4)}d  ${`${entry.group}.${entry.metric}`.padEnd(34)} ` +
          `${entry.leftLabel} ${format(entry.left)}  ${entry.comparison === "lte" ? "<=" : "vs"}  ${entry.rightLabel} ${format(entry.right)}` +
          (entry.delta ? `   Δ ${format(entry.delta)}` : "")
      );
    }
  }

  console.log("\nDeclared divergence from accounting (expected, quantified):");
  for (const { window, payload } of results) {
    for (const entry of payload.data.checks.filter((c) => c.kind === "declared")) {
      if (entry.left === null && entry.right === null) continue;
      console.log(
        `      ${String(window.days).padStart(4)}d  ${`${entry.group}.${entry.metric}`.padEnd(34)} ` +
          `${format(entry.left)}  vs  ${format(entry.right)}   Δ ${format(entry.delta)}`
      );
    }
  }

  const failures = results.flatMap(({ window, payload }) =>
    payload.data.checks.filter((c) => c.kind === "internal" && c.status === "fail").map((c) => ({ window, check: c }))
  );

  if (failures.length) {
    console.log(`\n${failures.length} internal check(s) FAILED. The Reporting Center disagrees with itself.`);
    return 1;
  }
  const total = results.reduce((sum, entry) => sum + entry.payload.data.counts.total, 0);
  console.log(`\nAll ${total} internal checks agree to within ${results[0]?.payload.meta.tolerance ?? 0.01}.`);
  return 0;
};

run()
  .then(async (code) => {
    await db.end?.();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error("reconcileReportingCenter failed:", error);
    await db.end?.();
    process.exit(1);
  });
