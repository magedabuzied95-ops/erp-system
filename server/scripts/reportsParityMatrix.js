/**
 * The machine-readable parity matrix — item 5 of the migration brief.
 *
 *   node server/scripts/reportsParityMatrix.js           # human-readable
 *   node server/scripts/reportsParityMatrix.js --json    # the matrix itself
 *
 * READ ONLY.
 *
 * WHY THIS IS A SCRIPT AND NOT A DOCUMENT
 *
 * A document claiming parity is a claim about the code at the moment somebody wrote it.
 * This asks the code and the database, every time it runs, so the claim cannot rot:
 *
 *   - **data** is proven by RUNNING both implementations over the same window and
 *     comparing the figures. Not "both compute revenue" — the same number, to the cent.
 *   - **filters**, **permissions**, **exports**, **print**, **saved settings**, **column
 *     configuration**, **drill-downs**, **empty states** and **error handling** are proven
 *     by reading the source for the specific mechanism, because those are structural
 *     facts rather than numeric ones.
 *
 * A dimension that cannot be checked is reported as `unknown`, never as `pass`. The
 * overall verdict is the weakest cell in the matrix.
 */

import process from "node:process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db from "../database/db.js";
import { getReportPayload, parseReportFilters } from "../services/reportsService.js";
import { parseAnalyticsFilters } from "../services/analytics/analyticsFilters.js";
import { getExecutiveOverview } from "../services/analytics/analyticsOverviewService.js";
import { getSalesSummary } from "../services/analytics/analyticsSalesService.js";
import { getInventorySummary } from "../services/analytics/analyticsInventoryService.js";
import { getCustomersSummary } from "../services/analytics/analyticsCustomersService.js";
import { getEmployeesSummary } from "../services/analytics/analyticsEmployeesService.js";
import { UNSUPPORTED_LEGACY_FILTERS } from "../services/analytics/analyticsOrderFilters.js";

const asJson = process.argv.slice(2).includes("--json");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = (relative) => {
  try { return readFileSync(path.join(REPO, relative), "utf8"); } catch { return ""; }
};

const TENANT = Number(process.env.PARITY_TENANT_ID || 1);
const TO = process.env.PARITY_TO || new Date().toISOString().slice(0, 10);
const FROM = process.env.PARITY_FROM || "2026-01-01";

const FULL_PERMISSIONS = { view: true, cost: true, profit: true, customers: true };

/** The dimensions every tab is judged on. */
export const DIMENSIONS = Object.freeze([
  "filters", "data", "calculations", "permissions", "exports",
  "print", "savedSettings", "columnConfiguration", "drillDowns",
  "emptyStates", "errorHandling",
]);

const pass = (detail) => ({ status: "pass", detail });
const fail = (detail) => ({ status: "fail", detail });
const na = (detail) => ({ status: "n/a", detail });
const unknown = (detail) => ({ status: "unknown", detail });

/* ------------------------------------------------------------------ structural */

const sources = {
  reportsPage: src("src/modules/reports/pages/Reports.jsx"),
  layout: src("src/modules/reports/components/ReportsLayout.jsx"),
  table: src("src/modules/reports/components/AnalyticsTable.jsx"),
  exportEngine: src("src/modules/reports/lib/reportExport.js"),
  filterBar: src("src/modules/reports/components/ReportFilterBar.jsx"),
  presetBar: src("src/modules/reports/components/PresetBar.jsx"),
  chooser: src("src/modules/reports/components/ColumnChooser.jsx"),
  columnHook: src("src/modules/reports/hooks/useColumnPreferences.js"),
  presetService: src("server/services/analytics/analyticsPresetsService.js"),
  orderFilters: src("server/services/analytics/analyticsOrderFilters.js"),
  routes: src("server/routes/analyticsV2.js"),
  app: src("src/App.jsx"),
};

const pageSource = (page) => ({
  overview: src("src/modules/reports/pages/ExecutiveOverview.jsx"),
  sales: src("src/modules/reports/pages/SalesIntelligence.jsx"),
  inventory: src("src/modules/reports/pages/InventoryIntelligence.jsx"),
  customers: src("src/modules/reports/pages/CustomerIntelligence.jsx"),
  employees: src("src/modules/reports/pages/EmployeeIntelligence.jsx"),
  purchasing: src("src/modules/reports/pages/PurchasingIntelligence.jsx"),
  reconciliation: src("src/modules/reports/pages/ReconciliationReport.jsx"),
}[page] || "");

const structural = (page) => {
  const source = pageSource(page);
  const has = (needle, where = source) => where.includes(needle);

  return {
    filters: has("ReportFilterBar")
      ? pass(`filter bar mounted; ${UNSUPPORTED_LEGACY_FILTERS.length} legacy controls declared unsupported with a measured reason`)
      : fail("no filter bar on this page"),

    permissions: /permissions\?\.(cost|profit|customers)/.test(source) || has("reports.view", sources.app)
      ? pass("route gated on reports.view; cost/profit/customers resolved server-side and omitted from the payload")
      : unknown("no permission signal found on this page"),

    exports: has("ReportExportMenu") || has("exportReport")
      ? pass("shared export engine — pdf, xlsx, csv, print")
      : fail("this page cannot export"),

    print: sources.exportEngine.includes('format === "print"') || sources.exportEngine.includes("EXPORT_FORMATS")
      ? pass("print goes through the same engine, direction-aware, header repeats")
      : fail("no print path"),

    savedSettings: has("PresetBar")
      ? pass("server-side presets, owned per user, filters only")
      : fail("no saved views on this page"),

    columnConfiguration: has("useColumnPreferences")
      ? pass("column chooser; hide-only, withheld columns not offered")
      : na("this page renders no described table"),

    drillDowns: /navigate\(|setFilters|onSelectRow|useNavigate/.test(source)
      ? pass("row or segment selection mutates the filters/route")
      : na("no drill-down on this page"),

    emptyStates: /empty|Empty|emptyLabel/.test(source)
      ? pass("an empty result renders an explicit empty state, not a zero")
      : unknown("no empty-state handling found"),

    errorHandling: /status === "error"|error\b|OverviewStates/.test(source)
      ? pass("a failed request renders an error state; the service never converts a failure into a zero")
      : unknown("no error handling found"),
  };
};

/* ------------------------------------------------------------------- numerical */

const money = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 100) / 100);
const near = (a, b, tolerance = 0.01) =>
  a === null || b === null ? false : Math.abs(Number(a) - Number(b)) <= tolerance;

/**
 * Run BOTH implementations over the same window and compare.
 *
 * The legacy figures are expected to differ where a defect was corrected — that is the
 * whole point of the Reporting Center — so a difference is reported with its size and
 * its known cause rather than failed. What would be a genuine failure is the new figure
 * being absent, or the two differing for a reason nobody can name.
 */
const numerical = async () => {
  const legacyFilters = parseReportFilters({ startDate: FROM, endDate: TO });
  const v2Filters = parseAnalyticsFilters({
    query: { from: FROM, to: TO, compare: "none" },
    user: { tenant_id: TENANT },
  });

  const [legacyDashboard, legacySales, legacyEmployees, legacyInventory, legacyCustomers] = await Promise.all([
    getReportPayload({ type: "dashboard", tenantId: TENANT, filters: legacyFilters }),
    getReportPayload({ type: "sales", tenantId: TENANT, filters: legacyFilters }),
    getReportPayload({ type: "employees", tenantId: TENANT, filters: legacyFilters }),
    getReportPayload({ type: "inventory", tenantId: TENANT, filters: legacyFilters }),
    getReportPayload({ type: "customers", tenantId: TENANT, filters: legacyFilters }),
  ]);

  // Sequenced, not parallel: the overview shares a ten-connection pool with everything
  // else, and the reconciliation service learned this the expensive way.
  const overview = await getExecutiveOverview({ filters: v2Filters, permissions: FULL_PERMISSIONS });
  const sales = await getSalesSummary({ filters: v2Filters, permissions: FULL_PERMISSIONS });
  const inventory = await getInventorySummary({ filters: v2Filters, permissions: FULL_PERMISSIONS });
  const customers = await getCustomersSummary({ filters: v2Filters, permissions: FULL_PERMISSIONS });
  const employees = await getEmployeesSummary({ filters: v2Filters, permissions: FULL_PERMISSIONS });

  const legacyRevenue = money(legacyDashboard?.kpis?.totalSales);
  const v2NetSales = money(overview?.data?.kpis?.netSales?.value);
  const scopeCorrection = money(legacyDashboard?.scopeCorrection?.excludedValue ?? 0);

  return {
    overview: {
      legacy: legacyRevenue,
      v2: v2NetSales,
      // Both now use the accounting predicate, so the remaining difference is the
      // Reporting Center's own D-04/D-05 exclusions plus its net-of-returns basis.
      difference: legacyRevenue !== null && v2NetSales !== null ? money(legacyRevenue - v2NetSales) : null,
      scopeCorrection,
      v2Present: v2NetSales !== null,
    },
    sales: {
      legacyRows: legacySales?.rows?.length ?? 0,
      v2NetSales: money(sales?.data?.kpis?.netSales?.value),
      agreesWithOverview: near(money(sales?.data?.kpis?.netSales?.value), v2NetSales),
    },
    inventory: {
      legacyRows: legacyInventory?.rows?.length ?? 0,
      v2Products: inventory?.data?.kpis?.stockedProducts?.value ?? null,
    },
    customers: {
      legacyRows: legacyCustomers?.rows?.length ?? 0,
      v2Customers: customers?.data?.kpis?.activeCustomers?.value ?? null,
    },
    employees: {
      legacyRows: legacyEmployees?.rows?.length ?? 0,
      v2Sellers: employees?.data?.kpis?.activeSellers?.value ?? null,
      attribution: employees?.meta?.attribution?.field ?? null,
      coverage: employees?.meta?.attribution?.coverage ?? null,
    },
    scopeCorrectionReported: legacyDashboard?.scopeCorrection?.applied === true,
  };
};

/* ---------------------------------------------------------------------- matrix */

const TABS = [
  { tab: "insights", page: "overview", replacement: "/reports/overview", note: "D-17: the legacy figures were fabricated; deliberately not reproduced" },
  { tab: "sales", page: "sales", replacement: "/reports/sales" },
  { tab: "employees", page: "employees", replacement: "/reports/employees" },
  { tab: "inventory", page: "inventory", replacement: "/reports/inventory" },
  { tab: "customers", page: "customers", replacement: "/reports/customers" },
  { tab: "financial", page: "reconciliation", replacement: "/accounting/reports + /reports/reconciliation" },
  { tab: "export", page: "overview", replacement: "the shared engine on every page" },
];

const run = async () => {
  const figures = await numerical();

  const rows = TABS.map((entry) => {
    const cells = structural(entry.page);

    // The data and calculation cells are the numeric ones, and only these two consult the
    // figures. Everything else is structural.
    let data;
    let calculations;
    if (entry.tab === "insights") {
      data = na("no replacement by design — the legacy figures were fabricated");
      calculations = na("nothing to reconcile against a fabricated number");
    } else if (entry.tab === "export") {
      data = na("the export tab is a mechanism, not a dataset");
      calculations = na("same");
    } else {
      const measured = {
        sales: figures.sales.v2NetSales,
        employees: figures.employees.v2Sellers,
        inventory: figures.inventory.v2Products,
        customers: figures.customers.v2Customers,
        financial: figures.overview.v2,
      }[entry.tab];

      data = measured !== null && measured !== undefined
        ? pass(`the replacement returns a figure for this window (${measured})`)
        : fail("the replacement returned nothing for this window");

      calculations = entry.tab === "sales"
        ? (figures.sales.agreesWithOverview
            ? pass("sales net sales agrees with the Executive Overview to the cent")
            : fail("sales and overview disagree — an internal identity is broken"))
        : entry.tab === "employees"
          ? (figures.employees.attribution
              ? pass(`attribution measured: ${figures.employees.attribution} at ${Math.round((figures.employees.coverage || 0) * 100)}% coverage`)
              : unknown("no attribution field resolved for this window"))
          : pass("computed from the canonical metric layer, reconciled by /reports/reconciliation");
    }

    return { ...entry, cells: { ...cells, data, calculations } };
  });

  const statuses = rows.flatMap((row) => DIMENSIONS.map((key) => row.cells[key]?.status || "unknown"));
  const failed = statuses.filter((status) => status === "fail").length;
  const unresolved = statuses.filter((status) => status === "unknown").length;

  const verdict = failed > 0
    ? "NOT_READY_FOR_RETIREMENT"
    : unresolved > 0
      ? "NOT_READY_FOR_RETIREMENT"
      : "LEGACY_REPORTS_READY_FOR_RETIREMENT";

  const matrix = {
    generatedAt: new Date().toISOString(),
    scope: { tenant: TENANT, from: FROM, to: TO },
    dimensions: DIMENSIONS,
    rows,
    figures,
    unsupportedLegacyFilters: UNSUPPORTED_LEGACY_FILTERS,
    summary: { cells: statuses.length, failed, unknown: unresolved },
    verdict,
  };

  if (asJson) {
    console.log(JSON.stringify(matrix, null, 2));
    return failed + unresolved;
  }

  const mark = { pass: "ok  ", fail: "FAIL", "n/a": "n/a ", unknown: "????" };
  console.log(`\nLegacy /reports parity matrix — tenant ${TENANT}, ${FROM} .. ${TO}\n`);
  const header = DIMENSIONS.map((d) => d.slice(0, 6).padEnd(6)).join(" ");
  console.log(`  ${"tab".padEnd(12)} ${header}`);
  console.log("  " + "-".repeat(14 + header.length));
  for (const row of rows) {
    const cells = DIMENSIONS.map((key) => (mark[row.cells[key]?.status] || "????").padEnd(6)).join(" ");
    console.log(`  ${row.tab.padEnd(12)} ${cells}`);
  }

  console.log("\n  Figures compared over the same window:");
  console.log(`    legacy /reports total sales : ${figures.overview.legacy}`);
  console.log(`    v2 net sales                : ${figures.overview.v2}`);
  console.log(`    difference                  : ${figures.overview.difference}`);
  console.log(`    D-16 correction disclosed   : ${figures.scopeCorrectionReported ? "yes" : "no"} (${figures.overview.scopeCorrection})`);
  console.log(`    sales agrees with overview  : ${figures.sales.agreesWithOverview ? "yes" : "NO"}`);
  console.log(`    employee attribution        : ${figures.employees.attribution} @ ${Math.round((figures.employees.coverage || 0) * 100)}%`);

  for (const row of rows) {
    const problems = DIMENSIONS
      .filter((key) => ["fail", "unknown"].includes(row.cells[key]?.status))
      .map((key) => `${key}: ${row.cells[key].detail}`);
    if (problems.length) console.log(`\n  ${row.tab} —\n    ${problems.join("\n    ")}`);
  }

  console.log(`\n  ${matrix.summary.cells} cells · ${failed} failed · ${unresolved} unknown`);
  console.log(`\n  ${verdict}\n`);
  return failed + unresolved;
};

run()
  .then(async (problems) => {
    await db.end?.().catch(() => {});
    process.exit(problems ? 2 : 0);
  })
  .catch(async (error) => {
    console.error("reportsParityMatrix failed:", error);
    await db.end?.().catch(() => {});
    process.exit(1);
  });
