// Data honesty across the whole Reporting Center.
//
// The audit that started this work found fabricated figures presented as analysis (D-17)
// and SQL failures silently converted into zeros (D-11) on the legacy pages. Both are
// the same class of fault: a number on screen that the data never supported.
//
// These tests are the standing guard against it coming back. They cover every v2 service
// and every reporting page as a set, so a new one cannot be added without meeting the
// same bar.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const dir = (relative) => readdir(new URL(relative, import.meta.url));

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const serviceFiles = async () => {
  const names = await dir("../../server/services/analytics/");
  return names.filter((name) => name.endsWith(".js"));
};

const pageFiles = [
  "ExecutiveOverview",
  "SalesIntelligence",
  "InventoryIntelligence",
  "PurchasingIntelligence",
  "CustomerIntelligence",
];

/* --------------------------------------------------- no failure becomes a number */

test("no analytics service converts a failure into a value", async () => {
  for (const name of await serviceFiles()) {
    const code = stripComments(await read(`../../server/services/analytics/${name}`));

    // The whole point of the v2 error policy: a query that fails must reach the
    // controller and become a 500 naming the failing area. A catch here that returns a
    // number, an empty object or an empty array is how a zero starts meaning "broken".
    const catches = [...code.matchAll(/catch\s*(\([^)]*\))?\s*\{([\s\S]{0,220}?)\}/g)];
    for (const [, , body] of catches) {
      /*
       * A catch must either rethrow, or RECORD the failure somewhere that reaches the
       * response. The second case is not a loophole: importing twelve presets where one
       * carries an unusable date range should import eleven and report the twelfth, not
       * refuse the lot. What is forbidden is the third case — swallowing the error and
       * returning a value, which is how a zero starts meaning "broken".
       *
       * `error.message` must appear, so the reported failure says what went wrong rather
       * than that something did.
       */
      const rethrows = /throw/.test(body);
      const reports = /(skipped|warnings|errors|collector)\s*[.[]/.test(body) && /error\.message|error\.code/.test(body);
      assert.ok(
        rethrows || reports,
        `${name} has a catch block that neither rethrows nor reports the failure:\n${body.trim().slice(0, 160)}`
      );
    }
  }
});

test("the controller turns a failure into a 500 that names the metric", async () => {
  const controller = await read("../../server/controllers/analyticsV2Controller.js");

  // One handler shape for every area, so no endpoint can grow its own quieter policy.
  assert.match(controller, /const analyticsHandler = \(area, name, code, run\)/);
  assert.match(controller, /return res\.status\(500\)\.json\(\{/);
  assert.match(controller, /metric: `\$\{area\}\.\$\{name\}`/);
  // Every catch block in the controller must answer 500. Matching "200 near catch" would
  // flag the ordinary success-then-catch sequence, which is exactly how it should read.
  const catches = [...controller.matchAll(/catch\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/g)];
  assert.ok(catches.length >= 2, "expected the controller catch blocks to be found");
  for (const [, body] of catches) {
    if (/AnalyticsFilterError/.test(body)) continue; // a filter error is a deliberate 400
    /*
     * The preset handlers are not query handlers. "This preset does not exist" is a 404
     * and "you already have twenty-four" is a 409 — answering 500 to either would be
     * lying about whose fault it is. They still fall back to 500 for anything
     * unrecognised, and they still log it, which is what this guard is protecting.
     */
    if (/error\.status \|\| 500/.test(body)) {
      assert.match(body, /status >= 500/, "an unrecognised preset failure must still be logged as a server error");
      assert.match(body, /console\.error/);
      continue;
    }
    assert.match(body, /res\.status\(500\)/, "a query failure must answer 500");
  }

  for (const area of ["OVERVIEW", "SALES", "INVENTORY", "PURCHASING", "CUSTOMERS"]) {
    assert.ok(controller.includes(`${area}_QUERY_FAILED`), `${area} has no failure code`);
  }
});

/* ------------------------------------------------- unknown is null, never zero */

test("the null semantics are defined once and used everywhere", async () => {
  const comparison = await read("../../server/services/analytics/analyticsComparison.js");

  // These three are the entire contract. toFiniteNumber refuses NaN; toMoney refuses to
  // invent a zero; safeRatio refuses to divide by nothing.
  assert.match(comparison, /export const toFiniteNumber = /);
  assert.match(comparison, /return Number\.isFinite\(parsed\) \? parsed : null/);
  assert.match(comparison, /export const toMoney = /);
  assert.match(comparison, /return parsed === null \? null : Math\.round/);
  assert.match(comparison, /export const safeRatio = /);
  assert.match(comparison, /if \(a === null \|\| b === null \|\| b === 0\) return null/);

  // A percentage change against a zero base is null, not 100. Legacy returns 100, which
  // reads as "doubled" when the truth is "there was nothing to compare against".
  assert.match(comparison, /if \(previousValue === 0\) \{/);
  assert.match(comparison, /deltaPercent: null/);
  assert.match(comparison, /COMPARISON_BASE_ZERO/);
});

test("every service builds its money through the shared helpers, not by hand", async () => {
  for (const name of await serviceFiles()) {
    if (["accountingCanon.js", "analyticsFilters.js", "analyticsMetrics.js", "inventoryMovementContract.js", "analyticsScope.js", "analyticsComparison.js"].includes(name)) continue;
    const source = await read(`../../server/services/analytics/${name}`);
    // Only services that RETURN money. The filter-options and order-filter modules return
    // labels, counts and SQL fragments; demanding a money helper of them would be
    // demanding an import they have nothing to use it on, which teaches the next person
    // that this guard is decorative.
    if (!/toMoney|SUM\(|revenue|amount/i.test(source)) continue;
    assert.match(source, /toMoney/, `${name} does not use the shared money helper`);
    assert.match(source, /safeRatio/, `${name} does not use the shared ratio helper`);
    // Number(x) || 0 is the classic way an unknown becomes a zero.
    assert.ok(
      !/Number\([^)]*\)\s*\|\|\s*0/.test(stripComments(source)),
      `${name} coerces a possibly-unknown value to 0`
    );
  }
});

/* -------------------------------------------------- nothing is fabricated on screen */

test("no reporting page invents a number, a score or a progress value", async () => {
  for (const page of pageFiles) {
    const code = stripComments(await read(`../../src/modules/reports/pages/${page}.jsx`));

    assert.ok(!/Math\.random/.test(code), `${page} generates a random value`);
    // A hardcoded percentage in a width or a value is a fabricated proportion.
    assert.ok(!/width:\s*["'`]?\d{1,3}%/.test(code), `${page} hardcodes a proportion`);
    // No forecast, prediction or confidence score ships without a documented model, and
    // none of these pages has one.
    assert.ok(!/forecast|predict|confidenceScore/i.test(code), `${page} presents a prediction`);
  }
});

test("a restricted or unavailable value renders as absent, never as zero", async () => {
  // The four non-value states must stay distinguishable: restricted (not permitted),
  // unavailable (coverage too thin), null (no denominator) and a verified 0.
  const tile = await read("../../src/modules/reports/components/KpiTile.jsx");
  assert.match(tile, /restricted/);

  const table = await read("../../src/modules/reports/components/AnalyticsTable.jsx");
  assert.match(table, /export function Blank\(\)/);
  assert.match(table, /—/, "a missing cell must render an em dash");

  const engine = await read("../../src/modules/reports/lib/reportExport.js");
  assert.match(engine, /if \(value === null \|\| value === undefined \|\| value === ""\) return "—"/);
});

test("a hidden metric is omitted from the payload, not blanked in it", async () => {
  const scope = await read("../../server/services/analytics/analyticsScope.js");
  // Hiding a value in React still ships it in the JSON. The service omits the column.
  assert.match(scope, /RESTRICTED_COST_FIELDS/);
  assert.match(scope, /RESTRICTED_PROFIT_FIELDS/);
  assert.match(scope, /export const assertNoRestrictedFields = /);
  // A masked KPI keeps its KEY so the UI can tell restricted from unavailable from zero.
  // Only a numeric value is a leak.
  assert.match(scope, /const isNumericLeak = \(value\) => typeof value === "number" && Number\.isFinite\(value\)/);
});

/* ------------------------------------------------- nothing is silently truncated */

test("a capped list says how much it did not draw", async () => {
  const bars = await read("../../src/modules/reports/components/BreakdownBars.jsx");
  // Silent truncation reads as "this is everything", which is a claim the component has
  // not earned.
  assert.match(bars, /rows\.length > maxRows/);
  assert.match(bars, /rows\.length - maxRows/);
});

test("a dimension with no meaningful split says so instead of drawing one bar", async () => {
  const purchasing = await read("../../server/services/analytics/analyticsPurchasingService.js");
  assert.match(purchasing, /DIMENSION_NOT_USABLE/);
  assert.match(purchasing, /distinctMeaningfulValues/);
});

/* ------------------------------------------------------------- warning registry */

test("every warning code a service raises has copy in both locales", async () => {
  const bundles = {
    en: JSON.parse(await read("../../src/locales/en/overview.json")),
    ar: JSON.parse(await read("../../src/locales/ar/overview.json")),
  };

  // Codes the services raise directly by string literal, plus the shared registry.
  const raised = new Set();
  for (const name of await serviceFiles()) {
    const source = await read(`../../server/services/analytics/${name}`);
    for (const match of source.matchAll(/collector\.add\(\s*"([A-Z_]{4,})"/g)) raised.add(match[1]);
  }

  assert.ok(raised.size >= 6, `expected the raised warning codes to be found, got ${raised.size}`);

  for (const code of raised) {
    for (const locale of ["en", "ar"]) {
      assert.ok(
        bundles[locale].warnings?.[code],
        `${code} has no ${locale} copy, so it would render as a raw code to a manager`
      );
    }
  }
});

test("a warning always carries the evidence behind it", async () => {
  const comparison = await read("../../server/services/analytics/analyticsComparison.js");
  // The payload spread is what lets the UI interpolate real numbers rather than print a
  // sentence that could be about anything.
  assert.match(comparison, /export const createWarning = \(code, message, payload = \{\}\) => \(\{ code, message, \.\.\.payload \}\)/);
  // The same code twice is noise; merging keeps one row per issue.
  assert.match(comparison, /const existing = this\.warnings\.find\(\(warning\) => warning\.code === code\)/);
});

/* ------------------------------------------------------- performance contract */

test("no analytics query aggregates once per row of another query", async () => {
  // EXPLAIN caught this in the first cut of the customer service: units were computed
  // with a scalar subquery inside the order scan, which reads as
  // "Seq Scan on order_items ... loops=74" — one aggregate per order. Cheap on a small
  // dataset, and exactly the shape that stops being cheap.
  const customers = await read("../../server/services/analytics/analyticsCustomersService.js");
  assert.match(customers, /order_units AS \(/, "line units must be one grouped pass");
  assert.match(customers, /LEFT JOIN order_units ou ON ou\.order_id = so\.id/);
  assert.ok(
    !/\(SELECT COALESCE\(SUM\([\s\S]{0,120}WHERE oi\.order_id = o\.id\)/.test(customers),
    "the correlated per-order aggregate must not return"
  );
});

test("every analytics query is bounded, and the services say how long they took", async () => {
  for (const name of await serviceFiles()) {
    const source = await read(`../../server/services/analytics/${name}`);
    // Only services that ISSUE queries. The reconciliation imports every one of them and
    // runs none of its own, which is the whole point of it, so matching on an imported
    // name would demand a timing helper it has no queries to time.
    if (!/const runTimed = async/.test(source)) continue;

    // The pool allows ten connections and statements are cut at fifteen seconds, so
    // every list endpoint pages rather than returning a whole table.
    if (/pagination:/.test(source)) {
      // 100 across the whole Reporting Center: one page cap, not one per service.
      assert.match(
        source,
        /Math\.min\(Math\.max\((?:Number\()?filters\.limit\)? \|\| 25, 1\), 100\)/,
        `${name} does not bound its page size to the shared cap`
      );
    }
    // And every query is timed, so a slow section names itself in the response meta
    // rather than being guessed at from a stopwatch. R2 times inline and the later
    // services use a runTimed helper; both record the same thing, so the assertion is on
    // the recording, not on the shape it is written in.
    assert.match(source, /timings\[name\] = Date\.now\(\) - startedAt/, `${name} does not time its queries`);
    assert.match(source, /timings,/, `${name} does not report timings in its envelope`);
  }
});

test("the guarded purchase-cost LATERAL is still guarded", async () => {
  // The R2.5 optimisation: the purchase-history lookup only runs when the variant and
  // product rungs both came back NULL. Removing skipWhenResolved would silently restore
  // a 1448ms -> 31ms regression across accounting and every reporting page at once.
  const canon = await read("../../server/services/analytics/accountingCanon.js");
  assert.match(canon, /skipWhenResolved/, "the LATERAL guard must remain in the canon");

  const metrics = await read("../../server/services/analytics/analyticsMetrics.js");
  assert.match(metrics, /skipWhenResolved: preLookupUnitCostExpr/);

  const inventory = await read("../../server/services/analytics/analyticsInventoryService.js");
  assert.match(inventory, /skipWhenResolved: preLookup/);

  const purchasing = await read("../../server/services/analytics/analyticsPurchasingService.js");
  assert.match(purchasing, /buildCostContext\(\{/, "purchasing must reuse the canonical cost context");
});
