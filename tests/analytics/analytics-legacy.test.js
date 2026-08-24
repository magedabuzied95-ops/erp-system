// Legacy reporting.
//
// The audit found eighteen calculation defects on /reports and /analytics and corrected
// them in the Reporting Center rather than in place, because rewriting the legacy numbers
// would silently move figures a manager reads daily. That is only defensible if the
// legacy pages SAY which figures are affected — a known-wrong number left unlabelled is
// worse than either fixing it or removing it.
//
// These tests pin both halves: nothing was deleted, and nothing is left unlabelled.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/* -------------------------------------------- retired only once parity is proven */

test("/analytics is retired to its replacement, now that parity is proven", async () => {
  const app = await read("../../src/App.jsx");
  // Every capability it offered has a canonical home — the matrix is in
  // docs/reporting-center-legacy-parity.md — and it was never linked from the navigation.
  // A redirect rather than a 404, because a bookmark should land somewhere useful.
  assert.match(app, /path="analytics" element=\{<Navigate to="\/reports\/overview" replace \/>\}/);

  // The page file stays on disk, unrouted, so restoring the route is a one-line revert.
  const dashboard = await read("../../src/modules/analytics/pages/AnalyticsDashboard.jsx");
  assert.ok(dashboard.length > 400, "the legacy page must be kept, not deleted");

  // But nothing may lazily import it, or the build ships a chunk no route can reach.
  assert.ok(
    !/lazy\(\(\) => import\("\.\/modules\/analytics\/pages\/AnalyticsDashboard"\)\)/.test(app),
    "the unrouted page must not remain in the lazy-import list"
  );
});

test("/reports survives, because retiring it needs the owner's sign-off", async () => {
  const app = await read("../../src/App.jsx");
  // Parity IS proven for every tab. The architecture document promises the legacy page is
  // retired only on explicit sign-off, and keeping that promise outranks the tidiness of
  // removing the route — so it stays routed, gated, and labelled.
  assert.match(app, /path="reports"\s*\n\s*element=\{\s*\n\s*<ProtectedRoute/, "the legacy /reports route must remain");

  const index = app.indexOf('path="reports"');
  assert.ok(index > 0, "reports must be routed");
  assert.match(
    app.slice(index, index + 320),
    /<ProtectedRoute requiredPermissions=\{\["reports\.view"\]\}>/,
    "/reports must not mount before the permission is checked"
  );
});

test("every legacy capability has a named, proven replacement", async () => {
  const parity = await read("../../docs/reporting-center-legacy-parity.md");
  // Retiring a page is only defensible if somebody can check the claim afterwards.
  for (const tab of ["Insights", "Sales", "Employees", "Inventory", "Customers", "Financial", "Export"]) {
    assert.ok(parity.includes(tab), `the parity matrix must account for the ${tab} tab`);
  }
  for (const capability of ["Dead stock", "Reorder suggestions", "AI insights", "Customer intelligence"]) {
    assert.ok(parity.includes(capability), `the parity matrix must account for ${capability}`);
  }
  assert.match(parity, /explicit sign-off/, "and must record why /reports is still routed");
});

test("the eight dead stub pages are gone and cannot come back", async () => {
  const files = await readdir(new URL("../../src/modules/reports/pages/", import.meta.url));
  for (const stub of [
    "AnalyticsReports.jsx", "CustomersReports.jsx", "InventoryReports.jsx", "OrdersReports.jsx",
    "ProductsReports.jsx", "ProfitReports.jsx", "SalesReports.jsx", "TaxReports.jsx",
  ]) {
    assert.ok(!files.includes(stub), `${stub} was proven unused and deleted; it must not reappear`);
  }

  // And no page in the folder may be a placeholder that renders its own name back at the
  // reader. A page that looks like a feature and is not is worse than no page at all.
  for (const file of files.filter((name) => name.endsWith(".jsx"))) {
    const source = await read(`../../src/modules/reports/pages/${file}`);
    assert.ok(source.length > 400, `${file} is too small to be a real page`);
    const spaced = file.replace(".jsx", "").replace(/([A-Z])/g, " $1").trim();
    assert.ok(!source.includes(`${spaced} Page`), `${file} renders its own name as its content`);
  }
});

/* ----------------------------------------------------- nothing is unlabelled */

test("both legacy pages carry the notice, above the numbers it is about", async () => {
  const reports = await read("../../src/modules/reports/pages/Reports.jsx");
  assert.match(reports, /import LegacyReportNotice/);
  // It is told which tab the reader is on, so its link answers the question in front of
  // them rather than offering a generic pair they have to choose between.
  assert.match(reports, /<LegacyReportNotice variant="reports" activeTab=\{activeTab\}/);
  // It must be the first child of the page body, not buried under the header.
  const bodyIndex = reports.indexOf('<div className="mx-auto w-full space-y-5">');
  const noticeIndex = reports.indexOf("<LegacyReportNotice");
  const headerIndex = reports.indexOf("<header");
  assert.ok(bodyIndex < noticeIndex && noticeIndex < headerIndex, "the notice must precede the report header");

  const analytics = await read("../../src/modules/analytics/pages/AnalyticsDashboard.jsx");
  assert.match(analytics, /<LegacyReportNotice variant="analytics" \/>/);
});

test("the notice names specific defects and cannot be dismissed", async () => {
  const notice = await read("../../src/modules/reports/components/LegacyReportNotice.jsx");
  // Strip the comments, which explain the rule and therefore contain its own keywords.
  const code = notice.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // A notice a reader can close is a notice that is absent on the visit that mattered.
  assert.ok(!/dismiss|onClose|localStorage/i.test(code), "the notice must not be dismissible");
  assert.ok(!/useState|return null/.test(code), "the notice must not be stateful or conditionally absent");

  // It must link to the page that answers the same question correctly, and the link has
  // to be a real route rather than prose telling the reader to go and find it.
  assert.match(code, /<Link/, "the notice must carry a real navigation link");
  for (const route of ["/reports/overview", "/reports/sales", "/reports/inventory"]) {
    assert.ok(code.includes(`to: "${route}"`), `the notice must offer ${route}`);
  }

  for (const locale of ["en", "ar"]) {
    const bundle = JSON.parse(await read(`../../src/locales/${locale}/overview.json`));
    assert.ok(bundle.legacy?.title, `${locale} has no legacy notice title`);
    // Vague is useless: the reader has to know WHICH figure to distrust.
    for (const defect of ["scope", "profit", "errors", "stock", "dates"]) {
      const copy = bundle.legacy.defect?.[defect];
      assert.ok(copy, `${locale} is missing the "${defect}" defect note`);
      assert.ok(copy.length > 60, `the "${defect}" note in ${locale} is too vague to act on`);
    }
    if (locale === "ar") {
      assert.match(bundle.legacy.title, /[؀-ۿ]/, "the Arabic notice must actually be Arabic");
    }
  }
});

test("each legacy tab is offered the one page that replaces it", async () => {
  const notice = await read("../../src/modules/reports/components/LegacyReportNotice.jsx");
  assert.match(notice, /export const CANONICAL_REPLACEMENT/);

  for (const [tab, route] of [
    ["insights", "/reports/overview"],
    ["sales", "/reports/sales"],
    ["employees", "/reports/employees"],
    ["inventory", "/reports/inventory"],
    ["customers", "/reports/customers"],
    ["financial", "/accounting/reports"],
  ]) {
    assert.ok(notice.includes(`${tab}: [`), `no replacement declared for the ${tab} tab`);
    assert.ok(notice.includes(`"${route}"`), `${route} must be offered`);
  }

  // Every route named there has to be a route that exists, or the notice sends the reader
  // to a blank screen — which is worse than the wrong number it was warning them about.
  const app = await read("../../src/App.jsx");
  for (const route of ["reports/overview", "reports/sales", "reports/employees",
    "reports/inventory", "reports/customers", "reports/reconciliation", "accounting/reports"]) {
    assert.ok(app.includes(`path="${route}"`), `/${route} is offered but not routed`);
  }
});

/* --------------------------------------------------- D-15 fixed at the source */

test("the legacy page no longer publishes revenue as if it were gross profit", async () => {
  const service = await read("../../server/services/reportsService.js");

  // D-15: order_items carries none of cost_total / purchase_cost / cost, so the cost
  // expression resolved to the literal "0" and gross_profit was revenue minus nothing.
  assert.match(service, /const costResolved = costExpr !== "0"/);
  assert.match(service, /costResolved,/, "the flag must travel with the scope");

  // The wrong number is replaced by NULL, not by a corrected one: computing real profit
  // here would silently move a figure on a screen nobody asked to have changed.
  assert.match(service, /\? `COALESCE\(SUM\(\$\{orders\.itemTotalExpr\}\) - SUM\(\$\{orders\.costExpr\}\), 0\)::numeric`/);
  assert.match(service, /: "NULL::numeric"\} AS gross_profit/);

  // And the unconditional form must be gone.
  assert.ok(
    !/COALESCE\(SUM\(\$\{orders\.itemTotalExpr\}\) - SUM\(\$\{orders\.costExpr\}\), 0\)::numeric AS gross_profit/.test(service),
    "the unguarded gross_profit expression must not remain"
  );
});

/* -------------------------------------------- D-16 fixed at the source, out loud */

test("the legacy order scope now asks whether the order was a sale", async () => {
  const service = await read("../../server/services/reportsService.js");

  // D-16: the scope filtered tenant, date, branch, warehouse, employee, customer, shift
  // and payment method, and never asked whether the order was a sale at all.
  assert.match(service, /import \{ paidOrderClauses \} from "\.\/analytics\/accountingCanon\.js"/);
  assert.match(service, /const recognisedSale = paidOrderClauses\(orderColumns\)/);
  assert.match(service, /const where = buildWhere\(\{ \.\.\.scopeArgs, extra: \[\.\.\.scopeArgs\.extra, \.\.\.recognisedSale\] \}\)/);

  // It is the ACCOUNTING predicate, not the stricter v2 one. Two definitions in the
  // business, reconciled against each other — not three.
  assert.ok(!/canonicalOrderClauses/.test(service), "the legacy page must not adopt the v2-only exclusions");

  // The employee sales subquery names the table rather than aliasing it, so it never went
  // through buildOrderScope and had to be corrected separately.
  assert.match(service, /const salesRecognised = paidOrderClauses\(orderColumns, \{ alias: "orders" \}\)/);
  assert.match(service, /const salesWhere = salesRecognised\.length/);
});

test("the correction announces itself instead of moving the numbers quietly", async () => {
  const service = await read("../../server/services/reportsService.js");

  // The old scope is kept alongside the new one for exactly one purpose: measuring the
  // difference. Without it the page could only assert that something changed.
  assert.match(service, /const unscopedWhere = buildWhere\(scopeArgs\)/);
  assert.match(service, /NOT \(\$\{clause\}\)/, "the delta must be measured, not estimated");
  assert.match(service, /excludedOrders: Number/);
  assert.match(service, /excludedValue: Number/);

  // Every tab, not just the sales tab — every tab counts orders.
  assert.match(service, /const scopeCorrection = await getScopeCorrection\(tenantId, filters\)\.catch\(\(\) => null\)/);
  assert.match(service, /const withScope = \(payload\) => \(\{ \.\.\.payload, scopeCorrection \}\)/);
  for (const type of ["dashboard", "insights", "employees", "inventory", "customers", "financial"]) {
    assert.match(
      service,
      new RegExp(`if \\(type === "${type}"\\) return withScope\\(`),
      `the ${type} tab must carry the correction too`
    );
  }

  // And a failure to describe the change must not take the report down with it.
  assert.match(service, /\.catch\(\(\) => null\)/);
});

test("the page says what the correction removed, in both languages", async () => {
  const notice = await read("../../src/modules/reports/components/LegacyReportNotice.jsx");
  assert.match(notice, /scopeCorrection\?\.applied \? \(/);
  assert.match(notice, /overview\.legacy\.scopeFix\.removed/);
  assert.match(notice, /overview\.legacy\.scopeFix\.removedNothing/);
  // Zero excluded is a real answer, not a reason to hide the notice.
  assert.match(notice, /scopeCorrection\.excludedOrders > 0/);

  const page = await read("../../src/modules/reports/pages/Reports.jsx");
  assert.match(page, /scopeCorrection=\{dashboard\?\.scopeCorrection\}/);

  for (const locale of ["en", "ar"]) {
    const bundle = JSON.parse(await read(`../../src/locales/${locale}/overview.json`));
    const copy = bundle.legacy?.scopeFix;
    assert.ok(copy, `${locale} has no scope-correction copy`);
    for (const key of ["title", "body", "removed", "removedNothing"]) {
      assert.ok(copy[key]?.length > 20, `${locale} scopeFix.${key} is missing or too vague`);
    }
    // The numbers have to reach the sentence, or it says a change happened without
    // saying how big — which is the thing this whole mechanism exists to avoid.
    assert.match(copy.removed, /\{\{orders\}\}/);
    assert.match(copy.removed, /\{\{value\}\}/);
    if (locale === "ar") assert.match(copy.title, /[؀-ۿ]/, "the Arabic notice must actually be Arabic");
  }

  // The defect list on /reports must no longer claim a defect that was fixed.
  assert.match(notice, /\? \["scope", "stock", "dates"\]\s*\n\s*: \["profit", "errors"\]/);
});

test("the shared predicate can be aliased without a second copy of it", async () => {
  const { paidOrderClauses } = await import("../../server/services/analytics/accountingCanon.js");
  const columns = new Set(["status", "payment_status", "is_personal_transaction"]);

  const aliased = paidOrderClauses(columns, { alias: "orders" }).join(" AND ");
  assert.ok(aliased.includes("orders.status"), "the alias must reach every column reference");
  assert.ok(!/\bo\.status\b/.test(aliased), "no reference may stay pinned to the default alias");

  // Default unchanged, because eight accounting call sites depend on it.
  const original = paidOrderClauses(columns).join(" AND ");
  assert.ok(original.includes("o.status"));
  assert.equal(original, aliased.replaceAll("orders.", "o."));
});

/* --------------------------------------------- the legacy exports were repaired */

test("the legacy exports go through the shared engine, so Arabic finally prints", async () => {
  const reports = await read("../../src/modules/reports/pages/Reports.jsx");

  assert.match(reports, /import \{ exportReport \} from "\.\.\/lib\/reportExport"/);
  for (const format of ["csv", "xlsx", "pdf", "print"]) {
    assert.match(reports, new RegExp(`runExport\\("${format}"\\)`), `${format} must route through the engine`);
  }

  // The four hand-rolled implementations are gone, and with them the jsPDF default face
  // that cannot render a single Arabic glyph.
  assert.ok(!/jspdf-autotable/.test(reports), "no local PDF builder may remain");
  assert.ok(!/XLSX\.utils\.json_to_sheet/.test(reports), "no local workbook builder may remain");
  assert.ok(!/font-family:Arial/.test(reports), "no local print stylesheet may remain");
  assert.ok(!/rowsToCsv|csvEscape/.test(reports), "the local CSV builder must be gone, not merely unused");
});

/* ---------------------------------------------------------- known gaps stated */

test("the defect register still describes what was deliberately left in place", async () => {
  const register = await read("../../docs/analytics/legacy-defects.md");
  // The register is the reason any of this is auditable. If it stops listing a defect,
  // the notice on the page stops being traceable to evidence.
  for (const defect of ["D-15", "D-16", "D-11", "D-06", "D-08"]) {
    assert.ok(register.includes(defect), `${defect} must remain in the register`);
  }
});
