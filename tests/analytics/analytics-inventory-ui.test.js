// R4 — Inventory Intelligence frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_DIMENSION,
  DEFAULT_SORT,
  INVENTORY_DIMENSIONS,
  INVENTORY_SORTS,
  normaliseInventoryFilters,
} from "../../src/modules/reports/hooks/useInventoryFilters.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const page = () => read("../../src/modules/reports/pages/InventoryIntelligence.jsx");

const COMPONENTS = [
  "../../src/modules/reports/pages/InventoryIntelligence.jsx",
  "../../src/modules/reports/components/StockHealth.jsx",
  "../../src/modules/reports/components/StockSalesMatrix.jsx",
  "../../src/modules/reports/components/InventoryBreakdown.jsx",
  "../../src/modules/reports/components/InventorySizes.jsx",
  "../../src/modules/reports/components/InventoryTable.jsx",
];

/* --------------------------------------------------------------- routing */

test("the inventory route is additive and permission gated", async () => {
  const app = await read("../../src/App.jsx");
  assert.match(app, /path="reports\/inventory"/);
  assert.match(app, /lazy\(\(\) => import\([^)]*InventoryIntelligence[^)]*\)\)/, "must be lazy loaded");
  // Every earlier reporting route survives.
  for (const route of ['path="reports/overview"', 'path="reports/sales"']) {
    assert.ok(app.includes(route), `${route} must remain`);
  }
  assert.match(app, /path="reports"\s*\n\s*element=\{<Reports \/>\}/, "the legacy route must remain");

  const block = app.slice(app.indexOf('path="reports/inventory"') - 300, app.indexOf('path="reports/inventory"') + 300);
  assert.match(block, /reports\.view/, "the route must require reports.view");
});

test("the navigation entry is translated, not a raw English label", async () => {
  const store = await read("../../src/modules/permissions/lib/rbacStore.js");
  const navigation = await read("../../src/i18n/navigation.js");
  const arabic = JSON.parse(await read("../../src/locales/ar/common.json"));

  const entry = store.match(/\{[^}]*to:\s*"\/reports\/inventory"[^}]*\}/)?.[0];
  assert.ok(entry, "a navigation entry must exist");
  const label = entry.match(/label:\s*"([^"]+)"/)?.[1];
  const key = navigation.match(new RegExp(`"${label}":\\s*"([\\w.]+)"`))?.[1];
  assert.ok(key, `nav label "${label}" has no translation key`);
  const value = key.split(".").reduce((node, part) => node?.[part], arabic);
  assert.match(value, /[؀-ۿ]/, `${key} must be Arabic, got "${value}"`);
  assert.equal(value, "ذكاء المخزون");

  // The icon must be imported or the page throws at render.
  assert.match(entry, /icon: Boxes/);
  assert.match(store, /^\s*Boxes,$/m, "Boxes must be imported");
});

/* ---------------------------------------------------------- filter state */

test("dimensions and sorts fall back to the allowlist", () => {
  const filters = normaliseInventoryFilters(new URLSearchParams("dimension=evil&sort=DROP+TABLE&sortDir=sideways&page=-2"));
  assert.equal(filters.dimension, DEFAULT_DIMENSION);
  assert.equal(filters.sort, DEFAULT_SORT);
  assert.ok(["asc", "desc"].includes(filters.sortDir));
  assert.ok(filters.page >= 1);
  assert.ok(INVENTORY_DIMENSIONS.includes(filters.dimension));
  assert.ok(INVENTORY_SORTS.includes(filters.sort));
});

test("known filters survive a URL round trip", () => {
  const filters = normaliseInventoryFilters(
    new URLSearchParams({ dimension: "brand", sort: "units", sortDir: "asc", productType: "sneakers", velocity: "slow", q: "air", page: "3" })
  );
  assert.equal(filters.dimension, "brand");
  assert.equal(filters.sort, "units");
  assert.equal(filters.sortDir, "asc");
  assert.equal(filters.productType, "sneakers");
  assert.equal(filters.velocity, "slow");
  assert.equal(filters.search, "air");
  assert.equal(filters.page, 3);
});

test("filter state lives in the URL, not in storage", async () => {
  const hook = await read("../../src/modules/reports/hooks/useInventoryFilters.js");
  assert.match(hook, /useSearchParams/);
  assert.ok(!/localStorage\s*\.\s*(get|set|remove)Item/.test(hook));
  assert.match(hook, /next\.delete\("page"\)/, "a filter change must reset pagination");
});

/* -------------------------------------------------------- time semantics */

test("the page states plainly that stock is now and sales are the period", async () => {
  const source = await page();
  assert.match(source, /timeSemantics\.stock/);
  assert.match(source, /timeSemantics\.sales/);

  const ar = JSON.parse(await read("../../src/locales/ar/inventoryAnalytics.json"));
  assert.equal(ar.timeSemantics.stock, "المخزون: الحالة الحالية");
  assert.match(ar.timeSemantics.sales, /خلال الفترة المحددة/);
  // The sentence must say the period does NOT rewind stock, which is the whole point.
  assert.match(ar.timeSemantics.sales, /لا يعيد حساب المخزون/);
});

test("current stock is never labelled as stock during the period", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/inventoryAnalytics.json"));
  assert.equal(ar.sizes.stock, "المخزون الحالي");
  assert.equal(ar.table.stock, "المخزون");
  assert.ok(!/خلال الفترة/.test(ar.table.stock), "stock must not claim to cover the period");
});

/* ------------------------------------------------------ velocity presentation */

test("the stagnation bucket says candidate, never dead", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/inventoryAnalytics.json"));
  assert.equal(ar.health.dead_candidate, "مرشح راكد");
  assert.ok(!/^مخزون راكد$/.test(ar.health.dead_candidate), "history is too short to call stock dead");
  assert.match(ar.deadCandidates.subtitle, /دون أي بيع/);
});

test("too-new and unknown-age are visually neutral, never a verdict", async () => {
  const source = await read("../../src/modules/reports/components/StockHealth.jsx");
  const tooNew = source.match(/\{ key: "too_new"[^}]*\}/)?.[0];
  const unknown = source.match(/\{ key: "unknown_age"[^}]*\}/)?.[0];
  for (const [name, entry] of [["too_new", tooNew], ["unknown_age", unknown]]) {
    assert.ok(entry, `${name} must be present`);
    assert.ok(!/danger|warning|success/.test(entry), `${name} must not use a judgement colour`);
    assert.match(entry, /text-\[var\(--text-tertiary\)\]/, `${name} must read as neutral`);
  }
});

test("the movement thresholds are explained rather than assumed", async () => {
  const source = await read("../../src/modules/reports/components/StockHealth.jsx");
  assert.match(source, /health\.method/, "a tooltip must carry the definitions");
  assert.match(source, /rules\.tooNewDays/, "and it must interpolate the real thresholds");
  const ar = JSON.parse(await read("../../src/locales/ar/inventoryAnalytics.json"));
  for (const token of ["{{tooNew}}", "{{recent}}", "{{window}}", "{{units}}", "{{established}}"]) {
    assert.ok(ar.health.method.includes(token), `the method text must interpolate ${token}`);
  }
});

test("unknown age is explained wherever it appears", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/inventoryAnalytics.json"));
  assert.match(ar.health.unknown_age, /[؀-ۿ]/);
  assert.match(ar.health.unknown_ageHint, /لا يوجد سجل استلام/);
  const table = await read("../../src/modules/reports/components/InventoryTable.jsx");
  assert.match(table, /unknown_ageHint/, "the table must explain it on hover");
});

/* ------------------------------------------------------------ size intelligence */

test("a missing size is an existing variant at zero stock, never an invented run", async () => {
  const sizes = await read("../../src/modules/reports/components/InventorySizes.jsx");
  assert.match(sizes, /unitsInStock === 0/, "missing means zero stock on a size that exists");
  assert.match(sizes, /sizes\.missing/);
  const service = await read("../../server/services/analytics/analyticsInventoryService.js");
  assert.match(service, /zero_stock_variants/);
  // No interpolation of an ideal run anywhere.
  assert.ok(!/idealRun|expectedSizes|fullRun/i.test(sizes + service));
});

test("size analysis excludes what cannot be compared", async () => {
  const service = await read("../../server/services/analytics/analyticsInventoryService.js");
  assert.match(service, /'one size', 'onesize', 'مقاس واحد'/);
  assert.match(service, /NOT IN \('color_only', 'simple'\)/, "colour-only and simple products carry no size run");
  assert.match(service, /SIZE_SCOPE_REQUIRED/, "one product type at a time");
  const sizes = await read("../../src/modules/reports/components/InventorySizes.jsx");
  assert.ok(!/forecast|willRunOut|daysUntil/i.test(sizes.replace(/\/\*[\s\S]*?\*\//g, "")), "no stockout forecast");
});

/* --------------------------------------------------------------- permissions */

test("inventory value disappears without the cost permission", async () => {
  const source = await page();
  assert.match(source, /showValue = Boolean\(summary\.meta\?\.permissions\?\.cost\)/);
  for (const file of [
    "../../src/modules/reports/components/InventoryTable.jsx",
    "../../src/modules/reports/components/InventoryBreakdown.jsx",
    "../../src/modules/reports/components/StockSalesMatrix.jsx",
    "../../src/modules/reports/components/StockHealth.jsx",
  ]) {
    const component = await read(file);
    assert.match(component, /showValue/, `${file} must honour the cost permission`);
  }
  // The table removes the column rather than blanking it.
  const table = await read("../../src/modules/reports/components/InventoryTable.jsx");
  assert.match(table, /\.\.\.\(showValue \? \[\{ key: "inventory_value"/, "the column is removed, not blanked");
});

/* ------------------------------------------------------------ design system */

test("the page reuses the frozen design system rather than inventing one", async () => {
  const source = await page();
  for (const primitive of ["ReportsPage", "ReportsHeader", "SectionCard", "SectionNav", "KpiTile", "PeriodSelector", "OverviewWarnings", "ManagementHighlights", "PeriodFootnote"]) {
    assert.ok(source.includes(primitive), `the page must reuse ${primitive}`);
  }
  assert.ok(!/mx-auto w-full max-w-\[var\(--content-max\)\]/.test(source), "width comes from the shared shell");
  assert.match(source, /<ReportsPage dir=/);
});

test("every component is RTL-safe and uses theme tokens", async () => {
  for (const file of COMPONENTS) {
    const source = await read(file);
    assert.ok(!/#[0-9a-fA-F]{6}\b/.test(source), `${file} hardcodes a hex colour`);
    assert.ok(!/\b(ml|mr|pl|pr)-\d/.test(source), `${file} uses physical spacing`);
    assert.ok(!/\b(left|right)-\d/.test(source), `${file} uses physical positioning`);
    assert.ok(!/\btext-(left|right)\b/.test(source), `${file} uses physical text alignment`);
  }
});

test("all copy comes from the inventory bundle, addressed with a dot", async () => {
  for (const file of COMPONENTS) {
    const source = await read(file);
    assert.match(source, /useTranslation\(\)/, `${file} must use the shared namespace`);
    assert.ok(/t\(\s*[`"]inventory\./.test(source), `${file} must read copy from the inventory prefix`);
    assert.ok(!/["`]inventory:/.test(source), `${file} uses a colon namespace, which does not resolve here`);
    assert.ok(!/isArabic \? "[^"]*[؀-ۿ]/.test(source), `${file} hardcodes Arabic copy`);
  }
});

test("Arabic and English inventory bundles have identical key shapes", async () => {
  const flatten = (node, prefix = "") =>
    Object.entries(node).flatMap(([key, value]) =>
      value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
    );
  const ar = flatten(JSON.parse(await read("../../src/locales/ar/inventoryAnalytics.json"))).sort();
  const en = flatten(JSON.parse(await read("../../src/locales/en/inventoryAnalytics.json"))).sort();
  assert.deepEqual(ar, en, "the bundles have drifted");
});

test("the bundle is registered under its own file and namespace", async () => {
  const i18n = await read("../../src/i18n/i18n.js");
  assert.match(i18n, /inventory: inventoryAnalyticsAr/);
  assert.match(i18n, /inventoryAnalytics\.json/);
  // One bundle file per namespace — the collision that broke the commissions screen.
  const imports = [...i18n.matchAll(/^import\s+(\w+)\s+from\s+"\.\.\/locales\/(\w+)\/([\w.-]+)"/gm)];
  const byFile = new Map();
  for (const [, binding, language, file] of imports) {
    const key = `${language}/${file}`;
    byFile.set(key, [...(byFile.get(key) || []), binding]);
  }
  for (const [file, bindings] of byFile) {
    assert.equal(bindings.length, 1, `${file} is imported as ${bindings.join(" and ")}`);
  }
});

/* ------------------------------------------------------------- responsive */

test("nothing forces a horizontal page scroll", async () => {
  for (const file of COMPONENTS) {
    const source = await read(file);
    if (/\bgrid\b|\bflex\b/.test(source)) {
      assert.match(source, /min-w-0/, `${file} must let its columns shrink`);
    }
    for (const match of source.matchAll(/(?<!min-|max-)\bw-\[(\d+)px\]/g)) {
      assert.ok(Number(match[1]) <= 320, `${file} sets a ${match[1]}px fixed width`);
    }
  }
  const table = await read("../../src/modules/reports/components/InventoryTable.jsx");
  assert.match(table, /overflow-auto/, "the table scrolls inside itself");
  assert.match(table, /sticky top-0/, "the header survives a long scroll");
});

test("the analytical sections open on desktop and collapse on mobile", async () => {
  const source = await page();
  const opened = (source.match(/openOnDesktop/g) || []).length;
  assert.equal(opened, 3, `matrix, sizes and table must open on desktop, found ${opened}`);
});

/* ------------------------------------------------------ request behaviour */

test("each section fetches independently and fails independently", async () => {
  const source = await page();
  const cards = source.match(/<SectionCard/g) || [];
  assert.ok(cards.length >= 5, `expected each section in its own card, found ${cards.length}`);
  assert.match(source, /useAnalyticsResource\(fetchInventorySummary/);
  assert.match(source, /useAnalyticsResource\(fetchInventoryBreakdown/);
  assert.match(source, /useAnalyticsResource\(fetchInventoryProducts/);
  assert.match(source, /useAnalyticsResource\(fetchInventorySizes/);
  assert.ok(!/\|\|\s*0\b/.test(source), "a missing value must never fall back to zero");
});

test("every warning the inventory endpoints emit has Arabic copy", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/overview.json")).warnings;
  const service = await read("../../server/services/analytics/analyticsInventoryService.js");
  const emitted = new Set([...service.matchAll(/collector\.add\(\s*"([A-Z_]+)"/g)].map((match) => match[1]));
  assert.ok(emitted.size > 0);
  for (const code of emitted) {
    assert.ok(ar[code], `warning ${code} has no Arabic copy`);
  }
});

test("every highlight the inventory endpoints emit has Arabic copy", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/inventoryAnalytics.json")).highlights;
  const service = await read("../../server/services/analytics/analyticsInventoryService.js");
  for (const match of service.matchAll(/messageKey:\s*"highlights\.(\w+)"/g)) {
    assert.ok(ar[match[1]], `highlights.${match[1]} has no Arabic copy`);
  }
});
