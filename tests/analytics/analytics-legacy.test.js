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
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/* ------------------------------------------------------- nothing was deleted */

test("both legacy routes still exist and still resolve to their own pages", async () => {
  const app = await read("../../src/App.jsx");
  // Parity with the Reporting Center has not been proven for the employee tab or the
  // export, so neither route may be removed or redirected yet.
  assert.match(app, /path="reports"\s*\n\s*element=\{\s*\n\s*<ProtectedRoute/, "the legacy /reports route must remain");
  assert.match(app, /path="analytics"/, "the legacy /analytics route must remain");
  assert.ok(!/path="analytics"[\s\S]{0,200}Navigate to="\/reports/.test(app), "no redirect until parity is proven");
});

test("both legacy routes are permission gated on the frontend as well as the backend", async () => {
  const app = await read("../../src/App.jsx");

  for (const route of ["reports", "analytics"]) {
    const index = app.indexOf(`path="${route}"`);
    assert.ok(index > 0, `${route} must be routed`);
    const block = app.slice(index, index + 320);
    assert.match(
      block,
      /<ProtectedRoute requiredPermissions=\{\["reports\.view"\]\}>/,
      `/${route} must not mount before the permission is checked`
    );
  }
});

/* ----------------------------------------------------- nothing is unlabelled */

test("both legacy pages carry the notice, above the numbers it is about", async () => {
  const reports = await read("../../src/modules/reports/pages/Reports.jsx");
  assert.match(reports, /import LegacyReportNotice/);
  assert.match(reports, /<LegacyReportNotice variant="reports" \/>/);
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
