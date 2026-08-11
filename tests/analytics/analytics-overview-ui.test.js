// R2 — Executive Overview frontend.
//
// The repository has no React test runner (no testing-library, jsdom, vitest or jest),
// and R2 must not add one. So this covers the two things that are testable without a
// DOM: the pure period/format logic, and source-level guarantees about RTL, states and
// permission handling that would otherwise silently regress.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PERIOD_PRESETS,
  availableComparisons,
  resolvePreset,
  resolveWindow,
  toIso,
} from "../../src/modules/reports/hooks/useAnalyticsFilters.js";
import {
  METRIC_KIND,
  formatCompactNumber,
  formatDeltaPercent,
  formatPercentValue,
  resolveSentiment,
} from "../../src/modules/reports/lib/metricFormat.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/* ------------------------------------------------------------ period presets */

test("every preset resolves to a valid, ordered ISO range", () => {
  for (const preset of PERIOD_PRESETS) {
    const range = resolvePreset(preset);
    assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/, `${preset} from`);
    assert.match(range.to, /^\d{4}-\d{2}-\d{2}$/, `${preset} to`);
    assert.ok(range.from <= range.to, `${preset} range is inverted`);
  }
});

test("today and yesterday are single days, and yesterday precedes today", () => {
  const today = resolvePreset("today");
  const yesterday = resolvePreset("yesterday");
  assert.equal(today.from, today.to);
  assert.equal(yesterday.from, yesterday.to);
  assert.ok(yesterday.to < today.from);
});

test("last7 and last30 are inclusive windows of the stated length", () => {
  const days = (range) =>
    Math.floor((new Date(`${range.to}T00:00:00`) - new Date(`${range.from}T00:00:00`)) / 86400000) + 1;
  assert.equal(days(resolvePreset("last7")), 7);
  assert.equal(days(resolvePreset("last30")), 30);
});

test("lastMonth is a whole calendar month ending before this month", () => {
  const range = resolvePreset("lastMonth");
  const from = new Date(`${range.from}T00:00:00`);
  const to = new Date(`${range.to}T00:00:00`);
  assert.equal(from.getDate(), 1, "must start on the 1st");
  assert.equal(new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate(), to.getDate(), "must end on the last day");
  assert.equal(from.getMonth(), to.getMonth());
});

test("toIso formats without timezone drift", () => {
  assert.equal(toIso(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(toIso(new Date(2026, 11, 31)), "2026-12-31");
});

/* --------------------------------------------------------- window resolution */

test("a link that names a range shows that range, whatever the preset says", () => {
  // A URL carrying explicit dates used to be ignored unless preset=custom, so the page
  // silently rendered the default window while the link claimed another one.
  for (const preset of [undefined, "last30", "thisMonth", "custom"]) {
    const window = resolveWindow({ preset, from: "2026-05-23", to: "2026-06-21" });
    assert.equal(window.from, "2026-05-23", `preset=${preset} must not override explicit dates`);
    assert.equal(window.to, "2026-06-21");
    assert.equal(window.preset, "custom", "an explicit range reports itself as custom");
  }
});

test("without explicit dates the preset decides, and an unknown preset falls back", () => {
  assert.deepEqual(resolveWindow({ preset: "last7" }), { preset: "last7", ...resolvePreset("last7") });
  assert.equal(resolveWindow({ preset: "nonsense" }).preset, "last30");
  assert.equal(resolveWindow({ preset: "custom" }).preset, "last30", "custom without dates is not a window");
});

test("a malformed or inverted range is refused rather than queried", () => {
  for (const [from, to] of [["not-a-date", "2026-06-21"], ["2026-06-21", ""], ["2026-06-21", "2026-05-23"]]) {
    assert.equal(resolveWindow({ preset: "last30", from, to }).preset, "last30", `${from}..${to} must not be used`);
  }
});

/* ----------------------------------------------------- comparison validity */

test("only mathematically valid comparisons are offered for a window", () => {
  const short = availableComparisons("2026-06-01", "2026-06-07");
  assert.ok(short.includes("previous_period"));
  assert.ok(short.includes("previous_month"), "a 7-day window has a meaningful previous month");
  assert.ok(short.includes("previous_year"));

  const long = availableComparisons("2026-01-01", "2026-08-01");
  assert.ok(long.includes("previous_period"));
  assert.ok(!long.includes("previous_month"), "a 200-day window has no meaningful previous month");
  assert.ok(long.includes("previous_year"));

  const veryLong = availableComparisons("2025-01-01", "2026-06-01");
  assert.deepEqual(veryLong, ["none", "previous_period"], "beyond a year only the previous period makes sense");
});

test("no comparison is always available", () => {
  for (const [from, to] of [["2026-06-01", "2026-06-01"], ["2025-01-01", "2026-01-01"]]) {
    assert.ok(availableComparisons(from, to).includes("none"));
  }
});

/* -------------------------------------------------------------- formatting */

test("percentages are rounded to sensible precision, never 12.483726%", () => {
  assert.equal(formatPercentValue(0.12483726, "en"), "12.5%");
  assert.equal(formatPercentValue(0.5, "en"), "50%");
  assert.equal(formatPercentValue(0, "en"), "0%");
  assert.equal(formatPercentValue(null, "en"), null);
  assert.equal(formatPercentValue(Number.NaN, "en"), null);
});

test("delta percentages carry an explicit sign", () => {
  assert.ok(formatDeltaPercent(0.118, "en").startsWith("+"));
  assert.ok(formatDeltaPercent(-0.042, "en").startsWith("-"));
  assert.equal(formatDeltaPercent(null, "en"), null);
});

test("compact numbers are for axes only, and stay exact below 1000", () => {
  const small = formatCompactNumber(940, "en");
  assert.ok(!/[KM]/.test(small), `values under 1000 must stay exact, got ${small}`);
  assert.match(formatCompactNumber(125000, "en"), /K/);
  assert.match(formatCompactNumber(2500000, "en"), /M/);
  assert.equal(formatCompactNumber(null, "en"), null);
});

test("every KPI has a declared display kind", () => {
  const expected = [
    "netSales", "grossProfit", "grossMargin", "orders", "averageOrderValue", "itemsSold",
    "itemsPerOrder", "discountRate", "returns", "returnRate", "newCustomers", "inventoryValue",
  ];
  for (const metric of expected) {
    assert.ok(METRIC_KIND[metric], `${metric} has no display kind`);
  }
});

/* ------------------------------------------------------ sentiment semantics */

test("rising returns and discounts read as negative, not positive", () => {
  assert.equal(resolveSentiment("lower", 5), "negative", "returns going up is bad");
  assert.equal(resolveSentiment("lower", -5), "positive", "returns going down is good");
  assert.equal(resolveSentiment("higher", 5), "positive");
  assert.equal(resolveSentiment("higher", -5), "negative");
  assert.equal(resolveSentiment("neutral", 5), "neutral");
  assert.equal(resolveSentiment("higher", 0), "neutral");
  assert.equal(resolveSentiment("higher", null), "neutral");
});

/* --------------------------------------------------- source-level guarantees */

test("the page renders five distinct states and never a zero fallback", async () => {
  const source = await read("../../src/modules/reports/pages/ExecutiveOverview.jsx");
  for (const state of ["OverviewForbidden", "OverviewError", "OverviewSkeleton", "OverviewEmpty", "OverviewWarnings"]) {
    assert.ok(source.includes(state), `page must handle the ${state} state`);
  }
  assert.ok(!/\|\|\s*0\b/.test(source), "the page must not fall back to 0 for a missing value");
});

test("the query hook aborts superseded requests and never shows stale data on error", async () => {
  const source = await read("../../src/modules/reports/hooks/useOverviewQuery.js");
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /signal: controller\.signal/);
  // On failure the payload must be cleared, otherwise an error would look like data.
  const catchBlock = source.slice(source.indexOf(".catch("));
  assert.match(catchBlock, /data: null/, "an error must clear previously loaded data");
});

test("filters live in the URL so a refresh preserves the period", async () => {
  const source = await read("../../src/modules/reports/hooks/useAnalyticsFilters.js");
  assert.match(source, /useSearchParams/);
  assert.match(source, /setSearchParams/);
  // Match real storage calls, not the word in a comment.
  assert.ok(
    !/localStorage\s*\.\s*(get|set|remove)Item/.test(source),
    "period state must not be read from or written to localStorage"
  );
});

test("the page is RTL-aware and uses design tokens rather than hardcoded colours", async () => {
  const page = await read("../../src/modules/reports/pages/ExecutiveOverview.jsx");
  assert.match(page, /dir=\{isArabic \? "rtl" : "ltr"\}/);
  assert.match(page, /var\(--/, "must use theme tokens");

  const files = [
    "../../src/modules/reports/pages/ExecutiveOverview.jsx",
    "../../src/modules/reports/components/KpiTile.jsx",
    "../../src/modules/reports/components/CategoryContribution.jsx",
    "../../src/modules/reports/components/CoverageBadge.jsx",
    "../../src/modules/reports/components/PeriodSelector.jsx",
  ];
  for (const file of files) {
    const source = await read(file);
    assert.ok(
      !/#[0-9a-fA-F]{6}\b/.test(source),
      `${file} contains a hardcoded hex colour; use theme tokens`
    );
    // Physical direction properties break RTL; logical ones must be used instead.
    assert.ok(!/\b(ml|mr|pl|pr)-\d/.test(source), `${file} uses physical spacing; use ms-/me-/ps-/pe-`);
    assert.ok(!/\b(left|right)-\d/.test(source), `${file} uses physical positioning; use start-/end-`);
  }
});

test("no hardcoded progress bars or fake widths in KPI tiles", async () => {
  const source = await read("../../src/modules/reports/components/KpiTile.jsx");
  assert.ok(!/w-2\/3|w-1\/2|w-3\/4/.test(source), "KPI tiles must not render decorative fixed-width bars");
});

test("the UI distinguishes restricted from unavailable from missing", async () => {
  const source = await read("../../src/modules/reports/components/KpiTile.jsx");
  assert.match(source, /restricted/);
  assert.match(source, /unavailableReason/);
  assert.match(source, /states\.noComparison/);
  // A zero base must read as "new", never as +100%.
  assert.match(source, /isNewFromZero/);
  assert.match(source, /compare\.new/);
});

test("all UI copy comes from the i18n bundle, not inline ternaries", async () => {
  for (const file of [
    "../../src/modules/reports/pages/ExecutiveOverview.jsx",
    "../../src/modules/reports/components/KpiTile.jsx",
    "../../src/modules/reports/components/ManagementHighlights.jsx",
    "../../src/modules/reports/components/OverviewStates.jsx",
  ]) {
    const source = await read(file);
    assert.ok(!/isArabic \? "[^"]*[؀-ۿ]/.test(source), `${file} hardcodes Arabic copy; use the overview key prefix`);
    // This app keeps every domain under the single `translation` namespace, so copy is
    // addressed as "overview.x" — a colon namespace would silently fail to resolve.
    assert.match(source, /useTranslation\(\)/, `${file} must use the shared translation namespace`);
    assert.ok(/t\(\s*[`"]overview\./.test(source), `${file} must read copy from the overview key prefix`);
    assert.ok(!/["`]overview:/.test(source), `${file} uses a colon namespace, which does not resolve here`);
  }
});

test("Arabic and English overview bundles have identical key shapes", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/overview.json"));
  const en = JSON.parse(await read("../../src/locales/en/overview.json"));

  const flatten = (node, prefix = "") =>
    Object.entries(node).flatMap(([key, value]) =>
      value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
    );

  const arKeys = flatten(ar).sort();
  const enKeys = flatten(en).sort();
  assert.deepEqual(arKeys, enKeys, "Arabic and English bundles have drifted");
});

test("every backend warning code and highlight messageKey has Arabic copy", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/overview.json"));
  const comparison = await read("../../server/services/analytics/analyticsComparison.js");
  const overview = await read("../../server/services/analytics/analyticsOverviewService.js");

  const codes = [...comparison.matchAll(/^\s{2}([A-Z_]+):\s*"/gm)].map((match) => match[1]);
  const surfaced = codes.filter((code) => overview.includes(`WARNING_CODES.${code}`));
  assert.ok(surfaced.length > 0, "the overview should surface some warnings");
  for (const code of surfaced) {
    assert.ok(ar.warnings[code], `warning ${code} has no Arabic copy`);
  }

  for (const match of overview.matchAll(/messageKey:\s*"highlights\.([a-zA-Z]+)"/g)) {
    assert.ok(ar.highlights[match[1]], `highlight key highlights.${match[1]} has no Arabic copy`);
  }
});

test("legacy reporting routes are untouched by R2", async () => {
  const app = await read("../../src/App.jsx");
  assert.match(app, /path="reports"\s*\n\s*element=\{<Reports \/>\}/, "the legacy /reports route must remain");
  assert.match(app, /path="reports\/overview"/, "the v2 route must be additive");
  assert.match(app, /path="analytics"/, "the legacy /analytics route must remain");
});

test("the trend chart cannot paint outside its column when the viewport shrinks", async () => {
  const source = await read("../../src/modules/reports/components/OverviewTrendChart.jsx");
  // An SVG cannot size itself from CSS, so the host is measured and the width passed in.
  // Without min-w-0 a grid item never shrinks, and without overflow-hidden a stale-wide
  // SVG re-inflates its parent, so the next measurement reads the old width forever.
  assert.match(source, /className="w-full min-w-0 overflow-hidden"/, "chart wrapper must be min-w-0 and clipped");
  assert.match(source, /<ComposedChart width=\{observedWidth\}/, "the chart must be given a measured width");
});

test("the chart re-measures on both resize signals, not just one", async () => {
  const source = await read("../../src/modules/reports/components/OverviewTrendChart.jsx");
  // A ResizeObserver catches layout changes that leave the window size alone; a window
  // resize listener catches environments that reflow without notifying observers.
  assert.match(source, /new ResizeObserver\(measure\)/);
  assert.match(source, /window\.addEventListener\("resize", measure\)/);
  assert.match(source, /observer\?\.disconnect\(\)/, "the observer must be torn down");
  assert.match(source, /window\.removeEventListener\("resize", measure\)/, "the listener must be torn down");
  // Nothing may render before a real measurement, otherwise the first paint is 0-wide.
  assert.match(source, /observedWidth > 0 \?/);
});

test("panels are min-w-0 so grid columns can shrink", async () => {
  const source = await read("../../src/modules/reports/pages/ExecutiveOverview.jsx");
  assert.match(source, /className="min-w-0 rounded-2xl/, "Panel must be min-w-0");
});
