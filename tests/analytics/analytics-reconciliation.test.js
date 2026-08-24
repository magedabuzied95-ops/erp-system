// R10 — Reconciliation.
//
// The point of this screen is that it is not a second opinion: it is the SAME engine the
// CLI script runs, reporting on the same services the screens render. A reconciliation
// built on its own SQL would be reconciling itself against itself, and would agree with
// nothing that mattered.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DECLARED_DIVERGENCES,
  EXACT_TOLERANCE,
} from "../../server/services/analytics/analyticsReconciliationService.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const SERVICE = "../../server/services/analytics/analyticsReconciliationService.js";

test("the reconciliation computes nothing of its own", async () => {
  const source = await read(SERVICE);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // Every figure must come from the service the corresponding screen calls, so a check
  // can only ever compare what a manager actually sees.
  for (const dependency of [
    "getExecutiveOverview", "getSalesSummary", "getInventorySummary",
    "getPurchasingSummary", "getCustomersSummary", "getEmployeesSummary", "getProfitLossReport",
  ]) {
    assert.ok(code.includes(dependency), `${dependency} must be the source of its own figures`);
  }

  // And it must never reach for SQL directly. A SELECT here would be the second engine.
  assert.ok(!/\bSELECT\b/i.test(code), "the reconciliation must not issue its own SQL");
  assert.ok(!/client\.query\(/.test(code), "the reconciliation must not query directly");
});

test("the CLI script is a thin wrapper over the same service", async () => {
  const script = await read("../../server/scripts/reconcileReportingCenter.js");
  assert.match(script, /import \{ runReconciliation \} from "\.\.\/services\/analytics\/analyticsReconciliationService\.js"/);
  const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\bSELECT\b/i.test(code), "the script must not compute anything itself");
  assert.ok(!/getProfitLossReport|getExecutiveOverview/.test(code), "the script must not call the services directly");
  // A failing reconciliation must fail the process, or CI cannot gate on it.
  assert.match(script, /process\.exit\(code\)/);
  assert.match(script, /return 1;/);
});

test("an internal difference fails and a declared difference does not", async () => {
  const source = await read(SERVICE);
  // These mean opposite things: internal drift is a defect, and a gap against accounting
  // is the correction working. A zero there would be the suspicious result.
  assert.match(source, /if \(kind === "declared"\) \{\s*\n\s*status = "info";/);
  assert.match(source, /status = Math\.abs\(difference \?\? 0\) <= EXACT_TOLERANCE \? "pass" : "fail"/);
  assert.match(source, /status: failed\.length \? "fail" : unavailable\.length \? "partial" : "pass"/);
  assert.ok(EXACT_TOLERANCE > 0 && EXACT_TOLERANCE <= 0.01);
});

test("a check that cannot run says so instead of passing", async () => {
  const source = await read(SERVICE);
  // Not computable is not the same as agreeing. A null on either side is "unavailable",
  // which downgrades the overall verdict to partial rather than reporting a clean pass.
  assert.match(source, /status = "unavailable";/);
  assert.match(source, /left === null \|\| right === null/);
  assert.match(source, /unavailable: unavailable\.length/);
});

test("the subset invariant is a subset, not an equality", async () => {
  const source = await read(SERVICE);
  // Inventory demand covers only variants with stock on hand, so asserting equality
  // reports a defect where there is none.
  assert.match(source, /comparison: "lte"/);
  assert.match(source, /status = money\(left\) <= money\(right\) \+ EXACT_TOLERANCE \? "pass" : "fail"/);
  assert.match(source, /metric: "demandWithinSales"/);
});

test("accounting being unavailable does not take the internal checks down with it", async () => {
  const source = await read(SERVICE);
  assert.match(source, /ACCOUNTING_COMPARISON_UNAVAILABLE/);
  assert.match(source, /accountingAvailable: Boolean\(pnl\)/);
  // The internal checks are the ones that detect a real defect, so they must still run.
  assert.match(source, /if \(pnl\) \{/, "declared checks are conditional on the P&L being readable");
});

test("the profit and loss runs first and alone, because of the DDL lock", async () => {
  const source = await read(SERVICE);
  // getProfitLossReport calls ensureAccountingSchema(), which runs DDL and wants an
  // AccessExclusiveLock. Issuing it alongside the analytics reads deadlocks with 40P01.
  const pnlIndex = source.indexOf("await getProfitLossReport(");
  const parallelIndex = source.indexOf("await Promise.all([");
  assert.ok(pnlIndex > 0 && parallelIndex > pnlIndex, "the P&L must be awaited before the parallel block");
  assert.match(source, /40P01/, "and the reason must be recorded where the next reader will look");
});

test("cost and profit comparisons are withheld from a caller who may not see them", async () => {
  const source = await read(SERVICE);
  assert.match(source, /const includeCost = Boolean\(permissions\.cost\)/);
  assert.match(source, /const includeProfit = Boolean\(permissions\.profit\)/);
  assert.match(source, /if \(includeProfit\) \{/);
  assert.match(source, /if \(includeCost\) \{/);
  // A restricted figure is null in the payload, not merely hidden by the page.
  assert.match(source, /grossProfit: includeProfit \? money\(o\.grossProfit\?\.current\) : null/);
  assert.match(source, /inventoryValue: includeCost \? money\(inv\.inventoryValue\?\.current\) : null/);
});

test("every required figure is published", async () => {
  const source = await read(SERVICE);
  for (const figure of [
    "netSales", "returns", "grossProfit", "grossMargin",
    "customerRevenue", "walkInRevenue", "inventoryValue", "stockedProducts",
    "purchaseSpend", "accountingNetSales", "accountingGrossProfit", "accountingCogs", "accountingDiscounts",
  ]) {
    assert.ok(new RegExp(`${figure}:`).test(source), `${figure} must appear in the reconciliation figures`);
  }
  // Pass/fail, differences, warnings and a verification timestamp.
  assert.match(source, /status:/);
  assert.match(source, /delta: difference/);
  assert.match(source, /sourceWarnings/);
  assert.match(source, /verifiedAt: new Date\(\)\.toISOString\(\)/);
});

test("the timestamp records when the comparison ran, not when the page opened", async () => {
  const source = await read(SERVICE);
  // Built inside the service at the end of the run, so a cached page cannot present a
  // stale verification as fresh.
  const verifiedIndex = source.indexOf("verifiedAt: new Date().toISOString()");
  const checksIndex = source.indexOf("const checks = [];");
  assert.ok(verifiedIndex > checksIndex, "the timestamp must be produced after the checks");
});

test("every declared divergence names the defect it corrects", async () => {
  assert.ok(DECLARED_DIVERGENCES.length >= 5);
  for (const entry of DECLARED_DIVERGENCES) {
    assert.match(entry.id, /^D-\d\d$/, "each correction cites its defect id");
    assert.ok(entry.key, "and carries a copy key");
  }
  for (const locale of ["en", "ar"]) {
    const bundle = JSON.parse(await read(`../../src/locales/${locale}/reconciliation.json`));
    for (const entry of DECLARED_DIVERGENCES) {
      assert.ok(bundle.correction?.[entry.key], `${locale} is missing copy for ${entry.id}`);
    }
  }
});

test("the endpoint and the page are permission gated", async () => {
  const routes = await read("../../server/routes/analyticsV2.js");
  assert.match(routes, /router\.get\("\/reconciliation", protect, viewReports,/);

  const controller = await read("../../server/controllers/analyticsV2Controller.js");
  assert.match(controller, /"reconciliation", "report", "RECONCILIATION_QUERY_FAILED", runReconciliation/);

  const app = await read("../../src/App.jsx");
  const index = app.indexOf('path="reports/reconciliation"');
  assert.ok(index > 0, "the route must exist");
  assert.match(app.slice(index, index + 260), /ProtectedRoute requiredPermissions=\{\["reports\.view"\]\}/);
});

test("the page renders the verdict rather than deriving its own", async () => {
  const page = await read("../../src/modules/reports/pages/ReconciliationReport.jsx");
  assert.match(page, /const status = data\?\.status \|\| "partial"/, "the verdict comes from the payload");
  assert.match(page, /meta\?\.verifiedAt/);
  assert.ok(!/Math\.abs\([^)]*tolerance/i.test(page), "the page must not re-decide pass or fail");
  // Both kinds of check are rendered, and kept apart.
  assert.match(page, /entry\.kind === "internal"/);
  assert.match(page, /entry\.kind === "declared"/);
});
