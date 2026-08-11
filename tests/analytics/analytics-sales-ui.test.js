// R3 — Sales & Profit Intelligence frontend.
//
// The repository still has no React test runner and R3 must not add one, so this covers
// the pure filter logic plus source-level guarantees about routing, states, RTL,
// permissions and request behaviour that would otherwise regress silently.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { SALES_SORT_KEYS, normaliseSalesFilters } from "../../src/modules/reports/hooks/useSalesFilters.js";
import {
  DIMENSION_DICTIONARIES,
  dimensionLabel,
  hasDimensionLabel,
} from "../../src/modules/reports/lib/dimensionLabels.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const COMPONENTS = [
  "../../src/modules/reports/pages/SalesIntelligence.jsx",
  "../../src/modules/reports/components/SalesBreakdown.jsx",
  "../../src/modules/reports/components/ProductMatrix.jsx",
  "../../src/modules/reports/components/ProductRankings.jsx",
  "../../src/modules/reports/components/SizeIntelligence.jsx",
  "../../src/modules/reports/components/ProductTable.jsx",
  "../../src/modules/reports/components/SectionCard.jsx",
];

/* ------------------------------------------- Arabic presentation mappings */

test("stored dimension values are translated for display only", () => {
  assert.equal(dimensionLabel("product_type", "sneakers", "ar"), "أحذية رياضية");
  assert.equal(dimensionLabel("product_type", "bags", "ar"), "شنط");
  assert.equal(dimensionLabel("product_type", "slippers", "ar"), "سليبرات");
  assert.equal(dimensionLabel("gender", "men", "ar"), "رجالي");
  assert.equal(dimensionLabel("size", "One Size", "ar"), "مقاس واحد");
});

test("the mapping never rewrites the stored value it was given", () => {
  // The label is derived; the caller keeps the original for filtering. Proven by the
  // English path returning the stored value untouched.
  for (const stored of ["sneakers", "Bags", "winter_collection", "men"]) {
    assert.equal(dimensionLabel("product_type", stored, "en"), stored);
    assert.equal(dimensionLabel("gender", stored, "en"), stored);
  }
});

test("an unmapped value falls through rather than vanishing", () => {
  assert.equal(dimensionLabel("product_type", "Hoverboards", "ar"), "Hoverboards");
  assert.equal(dimensionLabel("brand", "Adidas", "ar"), "Adidas", "brands are real names, never translated");
  assert.equal(dimensionLabel("category", "Footwear", "ar"), "Footwear");
  assert.equal(dimensionLabel("product_type", "", "ar"), "");
  assert.equal(dimensionLabel("product_type", null, "ar"), "");
});

test("matching survives the casing and separators the catalogue actually uses", () => {
  for (const variant of ["sneakers", "Sneakers", "SNEAKERS", " sneakers "]) {
    assert.equal(dimensionLabel("product_type", variant, "ar"), "أحذية رياضية", `failed on "${variant}"`);
  }
  for (const variant of ["winter_collection", "Winter Collection", "winter-collection"]) {
    assert.equal(dimensionLabel("product_type", variant, "ar"), "تشكيلة الشتاء", `failed on "${variant}"`);
  }
  assert.equal(hasDimensionLabel("product_type", "Sneakers"), true);
  assert.equal(hasDimensionLabel("product_type", "Hoverboards"), false);
});

test("every mapped label is actually Arabic", () => {
  for (const [dimension, dictionary] of Object.entries(DIMENSION_DICTIONARIES)) {
    for (const [stored, label] of Object.entries(dictionary)) {
      assert.match(label, /[؀-ۿ]/, `${dimension}.${stored} maps to "${label}", which is not Arabic`);
    }
  }
});

test("every place a product type reaches the screen goes through the mapping", async () => {
  // The size-analysis type picker rendered its raw value and shipped "Sneakers" into
  // an Arabic screen. Anywhere a stored type is displayed must be labelled.
  const surfaces = {
    "SizeIntelligence.jsx": ["dimensionLabel(\"product_type\", type, language)", "productType: dimensionLabel"],
    "ProductTable.jsx": ["dimensionLabel(\"product_type\", row.productType, language)"],
    "ProductRankings.jsx": ["dimensionLabel(\"product_type\", row.productType, language)"],
    "SalesBreakdown.jsx": ["dimensionLabel(dimension, row.key, language)"],
  };
  for (const [file, expected] of Object.entries(surfaces)) {
    const source = await read(`../../src/modules/reports/components/${file}`);
    for (const snippet of expected) {
      assert.ok(source.includes(snippet), `${file} must render "${snippet}"`);
    }
    // A bare {type} or {row.productType} in JSX would be an untranslated value.
    assert.ok(!/>\s*\{type\}\s*</.test(source), `${file} renders a raw product type`);
    assert.ok(!/>\s*\{row\.productType\}\s*</.test(source), `${file} renders a raw product type`);
  }
});

test("the filter round trip sends the stored value, never the label", async () => {
  const page = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  // Chips display a label but clear and re-send filters.* — the stored string.
  assert.match(page, /value: dimensionLabel\("product_type", filters\.productType, language\)/);
  assert.match(page, /clear: \(\) => filters\.setProductType\(""\)/);
  const hook = await read("../../src/modules/reports/hooks/useSalesFilters.js");
  assert.ok(!/dimensionLabel/.test(hook), "the filter hook must never see a display label");
  const api = await read("../../src/modules/reports/services/salesApi.js");
  assert.ok(!/dimensionLabel/.test(api), "the API layer must never see a display label");
});

/* ------------------------------------------------------------------- routing */

test("the sales route is additive and does not shadow the legacy reports route", async () => {
  const app = await read("../../src/App.jsx");
  assert.match(app, /path="reports\/sales"/, "the R3 route must exist");
  assert.match(app, /path="reports"\s*\n\s*element=\{<Reports \/>\}/, "the legacy /reports route must remain");
  assert.match(app, /path="reports\/overview"/, "the R2 route must remain");

  // React Router matches by specificity, but ordering still documents intent: the
  // nested route is declared before the bare one so the file reads the way it resolves.
  assert.ok(
    app.search(/path="reports\/sales"/) < app.search(/path="reports"\s/),
    "the nested sales route should be declared before the bare reports route"
  );
});

test("the page is lazy-loaded, so /reports/sales costs nothing elsewhere", async () => {
  const app = await read("../../src/App.jsx");
  assert.match(app, /lazy\(\(\) => import\([^)]*SalesIntelligence[^)]*\)\)/);
});

test("the navigation entry exists with a resolved icon", async () => {
  const store = await read("../../src/modules/permissions/lib/rbacStore.js");
  assert.match(store, /reports\/sales/);
  assert.match(store, /\bTrendingUp\b/);
  // An icon used but not imported throws at render, which is how this broke once.
  const importBlock = store.slice(0, store.indexOf("\n\n"));
  assert.ok(/TrendingUp/.test(importBlock) || /^import[^;]*TrendingUp/m.test(store), "TrendingUp must be imported");
});

test("the navigation entries are translated, not left as raw English labels", async () => {
  // Sidebar labels are English keys mapped through i18n/navigation.js. A nav item with
  // no mapping silently falls back to its English label, which is how these two first
  // shipped reading "Executive Overview" and "Sales Intelligence" in an Arabic sidebar.
  const store = await read("../../src/modules/permissions/lib/rbacStore.js");
  const navigation = await read("../../src/i18n/navigation.js");
  const arabic = JSON.parse(await read("../../src/locales/ar/common.json"));

  for (const route of ["/reports/overview", "/reports/sales"]) {
    const entry = store.match(new RegExp(`\\{[^}]*to:\\s*"${route}"[^}]*\\}`));
    assert.ok(entry, `${route} must have a navigation entry`);
    const label = entry[0].match(/label:\s*"([^"]+)"/)?.[1];
    assert.ok(label, `${route} must have a label`);

    const key = navigation.match(new RegExp(`"${label}":\\s*"([\\w.]+)"`))?.[1];
    assert.ok(key, `nav label "${label}" has no translation key in i18n/navigation.js`);

    const value = key.split(".").reduce((node, part) => node?.[part], arabic);
    assert.ok(value, `${key} has no Arabic copy`);
    assert.match(value, /[؀-ۿ]/, `${key} must actually be Arabic, got "${value}"`);
  }

  assert.equal(arabic.sidebar.executiveOverview, "النظرة التنفيذية");
  assert.equal(arabic.sidebar.salesIntelligence, "تحليل المبيعات والأرباح");
});

test("the new pages are grouped with the reporting entries, and the legacy one stays", async () => {
  const layout = await read("../../src/shared/layouts/MainLayout.jsx");
  const financeRule = layout.match(/if \(to === "\/accounting"[^\n]*return "Finance";/)?.[0];
  assert.ok(financeRule, "the Finance grouping rule must exist");
  for (const route of ["/reports/overview", "/reports/sales", "/reports"]) {
    assert.ok(financeRule.includes(`"${route}"`), `${route} must group with the reporting entries`);
  }

  const store = await read("../../src/modules/permissions/lib/rbacStore.js");
  assert.match(store, /to:\s*"\/reports"/, "the legacy Reports entry must remain in the navigation");
});

test("the route is gated by the reports permission, not left open", async () => {
  const app = await read("../../src/App.jsx");
  const routeIndex = app.indexOf('path="reports/sales"');
  const routeBlock = app.slice(routeIndex - 400, routeIndex + 400);
  assert.match(routeBlock, /reports:view|RequirePermission|ProtectedRoute/, "the sales route must be permission gated");
});

/* ------------------------------------------------------------- filter state */

test("filters normalise to the allowlist and drop unknown values", () => {
  const filters = normaliseSalesFilters(new URLSearchParams("dimension=evil&sort=DROP+TABLE&sortDir=sideways&page=-3"));
  assert.equal(filters.dimension, "product_type", "an unknown dimension falls back to the default");
  assert.ok(SALES_SORT_KEYS.includes(filters.sort), "an unknown sort falls back to an allowlisted one");
  assert.ok(["asc", "desc"].includes(filters.sortDir));
  assert.ok(filters.page >= 1, "page can never be negative");
});

test("known filters survive a round trip through the URL", () => {
  const params = new URLSearchParams({
    dimension: "brand", productType: "sneakers", brandId: "12",
    sort: "units", sortDir: "asc", q: "air", page: "3",
  });
  const filters = normaliseSalesFilters(params);
  assert.equal(filters.dimension, "brand");
  assert.equal(filters.productType, "sneakers");
  assert.equal(filters.brandId, "12");
  assert.equal(filters.sort, "units");
  assert.equal(filters.sortDir, "asc");
  assert.equal(filters.search, "air");
  assert.equal(filters.page, 3);
});

test("filter state lives in the URL, so a refresh or a shared link reproduces the view", async () => {
  const source = await read("../../src/modules/reports/hooks/useSalesFilters.js");
  assert.match(source, /useSearchParams/);
  assert.ok(
    !/localStorage\s*\.\s*(get|set|remove)Item/.test(source),
    "filter state must not be stashed in localStorage"
  );
});

test("changing a filter resets pagination instead of stranding the user on a dead page", async () => {
  const source = await read("../../src/modules/reports/hooks/useSalesFilters.js");
  assert.match(source, /page/, "the hook owns pagination");
  assert.ok(
    /page:\s*1|\bpage\b[^\n]*=\s*1|next\.delete\("page"\)/.test(source),
    "a filter change must return to the first page"
  );
});

/* -------------------------------------------------------- request behaviour */

test("each section fetches independently and aborts superseded requests", async () => {
  const source = await read("../../src/modules/reports/hooks/useAnalyticsResource.js");
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /signal: controller\.signal/);
  // An aborted request must not surface as an error state.
  assert.match(source, /AbortError|signal\.aborted|controller\.signal\.aborted/);
});

test("a failed section clears its data rather than showing stale numbers under an error", async () => {
  const source = await read("../../src/modules/reports/hooks/useAnalyticsResource.js");
  const failure = source.slice(source.indexOf("catch"));
  assert.match(failure, /data: null/, "an error must clear previously loaded data");
});

test("one failing section cannot blank the page", async () => {
  const page = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  // Every section is wrapped in its own card that renders its own error, so a failure is
  // contained to the section that failed.
  const cards = page.match(/<SectionCard/g) || [];
  assert.ok(cards.length >= 4, `expected each section in its own card, found ${cards.length}`);
  const card = await read("../../src/modules/reports/components/SectionCard.jsx");
  assert.match(card, /sectionError/);
  assert.match(card, /sectionRetry/, "a failed section must offer a retry");
});

test("the page never falls back to 0 for a value it does not have", async () => {
  const page = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  assert.ok(!/\|\|\s*0\b/.test(page), "a missing value must render as unavailable, not as zero");
});

/* ------------------------------------------------------------ section states */

test("the breakdown disables a dimension the data cannot support, without hardcoding which", async () => {
  const source = await read("../../src/modules/reports/components/SalesBreakdown.jsx");
  assert.match(source, /distinctMeaningfulValues/, "usability must come from the response");
  assert.match(source, /unusable/, "an unusable dimension needs its own copy");
  // The decision must never be baked in for a specific dimension.
  assert.ok(!/=== "brand"/.test(source), "no dimension may be hardcoded as unavailable");
  assert.ok(!/brand[A-Za-z]*Disabled\s*=\s*true/.test(source));
});

test("an incomplete category dimension warns instead of quietly under-reporting", async () => {
  const source = await read("../../src/modules/reports/components/SalesBreakdown.jsx");
  assert.match(source, /uncategorisedWarning/);
  assert.match(source, /unknownContributionPercent/);
});

test("the breakdown states plainly that it excludes returns", async () => {
  const page = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  assert.match(page, /breakdown\.beforeReturns/, "the returns basis difference must be visible, not buried in docs");
  const ar = JSON.parse(await read("../../src/locales/ar/salesAnalytics.json"));
  assert.match(ar.breakdown.beforeReturns, /[؀-ۿ]/, "the explanation must be in Arabic");
  assert.match(ar.breakdown.beforeReturns, /مرتجع/, "it must actually name returns");
  // The same distinction reaches the generic warnings list, so it needs copy there too.
  const warnings = JSON.parse(await read("../../src/locales/ar/overview.json")).warnings;
  assert.ok(warnings.BREAKDOWN_EXCLUDES_RETURNS);
  assert.ok(warnings.FILTERED_EXCLUDES_RETURNS);
});

test("the analytical sections open on a desktop and collapse on a phone", async () => {
  const page = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  const card = await read("../../src/modules/reports/components/SectionCard.jsx");

  // The matrix, size analysis and product table are the reason this page exists.
  // Shipping all three collapsed on a large monitor hid the best of it behind clicks.
  const sections = page.match(/<SectionCard[\s\S]*?>/g) || [];
  const opened = sections.filter((section) => section.includes("openOnDesktop"));
  assert.equal(opened.length, 3, `expected matrix, sizes and table to open on desktop, found ${opened.length}`);
  for (const key of ["matrix", "sizes", "table"]) {
    assert.ok(
      sections.some((section) => section.includes(`sections.${key}`) && section.includes("openOnDesktop")),
      `the ${key} section must open on desktop`
    );
  }

  assert.match(card, /min-width: 1024px/, "the breakpoint must be explicit");
  assert.match(card, /matchMedia/, "and driven by a media query, not a guess");
  // The reader's own choice must win once expressed.
  assert.match(card, /if \(openOnDesktop && !touched\) setOpen\(desktop\)/);
  assert.match(card, /setTouched\(true\)/);
});

test("the matrix explains its own methodology and exposes the period medians", async () => {
  const source = await read("../../src/modules/reports/components/ProductMatrix.jsx");
  assert.match(source, /medianNetSales/);
  assert.match(source, /medianMargin/);
  assert.match(source, /matrix\.method/, "the quadrant rule must be explained in the UI");
  for (const quadrant of ["star", "volume_low_margin", "margin_opportunity", "underperformer"]) {
    assert.ok(source.includes(quadrant), `the ${quadrant} quadrant must be rendered`);
  }
});

test("the matrix never exposes unit cost, only margin", async () => {
  const source = await read("../../src/modules/reports/components/ProductMatrix.jsx");
  assert.ok(!/unitCost|costPrice|\bcost\b\s*[},]/.test(source), "raw cost must not reach the matrix");
});

test("the matrix degrades to an explanation when profit is not permitted or not derivable", async () => {
  const source = await read("../../src/modules/reports/components/ProductMatrix.jsx");
  assert.match(source, /needsProfit/, "no profit permission must be explained, not silently empty");
  assert.match(source, /matrix\.empty/, "too few products must be explained");
});

test("rankings render one list at a time rather than five stacked tables", async () => {
  const source = await read("../../src/modules/reports/components/ProductRankings.jsx");
  // One selected key drives one list; the other four are never in the tree at once.
  assert.match(source, /const current = available\.includes\(active\) \? active : available\[0\]/);
  const body = source.slice(source.indexOf("return ("));
  const listRenders = body.match(/rankings\?\.\[/g) || body.match(/rankings\[/g) || [];
  assert.ok(listRenders.length <= 1, `expected a single indexed list render, found ${listRenders.length}`);
});

test("a ranking the data cannot support is not offered at all", async () => {
  const source = await read("../../src/modules/reports/components/ProductRankings.jsx");
  // Profit rankings need the permission; growth rankings need a comparison window.
  assert.match(source, /if \(key === "topByProfit"\) return showProfit/);
  assert.match(source, /if \(key === "fastestGrowth" \|\| key === "largestDecline"\) return hasComparison/);
  assert.match(source, /needsComparison/, "and the reason must be stated, not left blank");
});

test("ranking thumbnails come from the response, never from a per-row fetch", async () => {
  const source = await read("../../src/modules/reports/components/ProductRankings.jsx");
  assert.ok(!/fetch\(|axios|useEffect\([^)]*\)\s*=>\s*\{[\s\S]{0,200}api\./.test(source), "no N+1 image lookup");
  assert.match(source, /imageUrl|image_url|thumbnail/, "thumbnails should use the field already returned");
});

test("size analysis refuses to mix incomparable size vocabularies", async () => {
  const source = await read("../../src/modules/reports/components/SizeIntelligence.jsx");
  assert.match(source, /pickType/, "a product type must be chosen before sizes mean anything");
  assert.match(source, /scopeNote/, "the scope restriction must be stated");
  assert.match(source, /notApplicable/, "a type without comparable sizes must say so");
  // Ignore comments: the component explains that it is deliberately not a forecast.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/forecast|daysUntilStockout|willRunOut|daysOfCover/i.test(code), "R3 must not forecast stockout");
});

test("the size scope note names the type it is scoped to", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/salesAnalytics.json"));
  assert.match(ar.sizes.scopeNote, /\{\{productType\}\}/, "the note must interpolate the actual type");
  assert.match(ar.sizes.notApplicable, /[؀-ۿ]/);
});

/* -------------------------------------------------------------- product table */

test("the product table sorts, searches and pages on the server", async () => {
  const page = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  const hook = await read("../../src/modules/reports/hooks/useSalesFilters.js");
  assert.match(hook, /productParams/, "table state must travel to the backend");
  for (const key of ["sort", "sortDir", "search", "page"]) {
    assert.ok(hook.includes(key), `${key} must be part of the request`);
  }
  // Client-side sorting of a truncated page would silently lie about the ranking.
  const table = await read("../../src/modules/reports/components/ProductTable.jsx");
  assert.ok(!/\.sort\(\(/.test(table), "the table must not re-sort the page it was given");
  assert.ok(page.includes("ProductTable"));
});

test("a truncated product list says so, driven by the backend's own warning", async () => {
  const page = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  assert.match(page, /PRODUCT_LIST_TRUNCATED/, "truncation must come from the response, not a guess");
  assert.match(page, /table\.truncated/, "and it must be shown to the user");
});

/* --------------------------------------------------------------- permissions */

test("profit columns are removed, not blanked, when profit is not permitted", async () => {
  for (const file of [
    "../../src/modules/reports/components/ProductTable.jsx",
    "../../src/modules/reports/components/SalesBreakdown.jsx",
  ]) {
    const source = await read(file);
    assert.match(source, /showProfit/, `${file} must honour the profit permission`);
  }
  const page = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  assert.match(page, /permissions/, "the page must read the resolved permissions from the response");
});

/* ------------------------------------------------------------- RTL and theme */

test("every sales component is RTL-safe and uses theme tokens", async () => {
  for (const file of COMPONENTS) {
    const source = await read(file);
    assert.ok(!/#[0-9a-fA-F]{6}\b/.test(source), `${file} hardcodes a hex colour; use theme tokens`);
    assert.ok(!/\b(ml|mr|pl|pr)-\d/.test(source), `${file} uses physical spacing; use ms-/me-/ps-/pe-`);
    assert.ok(!/\b(left|right)-\d/.test(source), `${file} uses physical positioning; use start-/end-`);
    assert.ok(!/\btext-(left|right)\b/.test(source), `${file} uses physical text alignment; use text-start/text-end`);
  }
});

test("the page declares its direction from the active language", async () => {
  const page = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  assert.match(page, /dir=\{isArabic \? "rtl" : "ltr"\}/);
});

/* --------------------------------------------------------------- responsive */

test("nothing can force a horizontal scroll: grid children shrink and wide content scrolls itself", async () => {
  for (const file of COMPONENTS) {
    const source = await read(file);
    if (!/\bgrid\b|\bflex\b/.test(source)) continue;
    assert.match(source, /min-w-0/, `${file} must let its columns shrink below their content`);
  }
  // A table is the one thing allowed to be wider than the viewport, inside its own
  // scroller. It scrolls on both axes so the sticky header has something to stick to.
  const table = await read("../../src/modules/reports/components/ProductTable.jsx");
  assert.match(table, /overflow-(x-)?auto/, "the table must scroll inside itself, not push the page");
  assert.match(table, /sticky top-0/, "the column headings must survive a long scroll");
});

test("no fixed pixel width can outgrow a 375px viewport", async () => {
  for (const file of COMPONENTS) {
    const source = await read(file);
    // A hard width cannot shrink, so it dictates the page width on a phone. A minimum
    // width can, but only inside a scroller — enforced by the previous test.
    for (const match of source.matchAll(/(?<!min-|max-)\bw-\[(\d+)px\]/g)) {
      assert.ok(Number(match[1]) <= 320, `${file} sets a ${match[1]}px fixed width, which overflows a phone`);
    }
    assert.ok(!/\bmin-w-\[\d{4,}px\]/.test(source), `${file} sets a four-digit minimum width`);
  }
});

/* --------------------------------------------------------------------- i18n */

test("all sales copy comes from the shared translation namespace", async () => {
  for (const file of COMPONENTS) {
    const source = await read(file);
    assert.match(source, /useTranslation\(\)/, `${file} must use the shared namespace`);
    assert.ok(/t\(\s*[`"]salesAnalytics\./.test(source), `${file} must read copy from the salesAnalytics prefix`);
    // This app has one `translation` namespace; a colon prefix renders the raw key.
    assert.ok(!/["`]salesAnalytics:/.test(source), `${file} uses a colon namespace, which does not resolve here`);
    assert.ok(!/isArabic \? "[^"]*[؀-ۿ]/.test(source), `${file} hardcodes Arabic copy`);
  }
});

test("Arabic and English sales bundles have identical key shapes", async () => {
  const flatten = (node, prefix = "") =>
    Object.entries(node).flatMap(([key, value]) =>
      value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
    );
  const ar = flatten(JSON.parse(await read("../../src/locales/ar/salesAnalytics.json"))).sort();
  const en = flatten(JSON.parse(await read("../../src/locales/en/salesAnalytics.json"))).sort();
  assert.deepEqual(ar, en, "Arabic and English sales bundles have drifted");
});

test("the sales bundle is registered under the key the components address", async () => {
  const i18n = await read("../../src/i18n/i18n.js");
  assert.match(i18n, /salesAnalytics/, "the bundle must be registered as salesAnalytics");
});

test("no two i18n namespaces share a bundle file", async () => {
  const i18n = await read("../../src/i18n/i18n.js");

  // The analytics bundle was first written to locales/*/sales.json, a path already held
  // by the Employee Sales Commissions bundle. Both namespaces then imported the same
  // file, so the commissions screen would have shipped with entirely the wrong copy.
  const imports = [...i18n.matchAll(/^import\s+(\w+)\s+from\s+"\.\.\/locales\/(\w+)\/([\w.-]+)"/gm)];
  assert.ok(imports.length > 10, "expected the locale imports to be found");

  const byFile = new Map();
  for (const [, binding, language, file] of imports) {
    const key = `${language}/${file}`;
    byFile.set(key, [...(byFile.get(key) || []), binding]);
  }
  for (const [file, bindings] of byFile) {
    assert.equal(bindings.length, 1, `${file} is imported as ${bindings.join(" and ")}; one bundle, one namespace`);
  }
});

test("the analytics bundle did not displace the commissions bundle", async () => {
  // Two distinct files with distinct content. The regression this guards against was
  // one file being asked to serve two unrelated screens.
  const commissions = JSON.parse(await read("../../src/locales/ar/sales.json"));
  const analytics = JSON.parse(await read("../../src/locales/ar/salesAnalytics.json"));
  assert.ok(commissions.payroll, "the commissions bundle must still carry its payroll copy");
  assert.ok(commissions.penalties, "the commissions bundle must still carry its penalties copy");
  assert.ok(analytics.matrix, "the analytics bundle must carry the matrix copy");
  assert.ok(!analytics.payroll, "the analytics bundle must not absorb commissions copy");
});

test("Arabic plurals are interpolated, not left to a rule this bundle does not define", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/salesAnalytics.json"));
  // Arabic needs six plural forms; a bare `_one`/`_other` pair silently falls through.
  const flatten = (node, prefix = "") =>
    Object.entries(node).flatMap(([key, value]) =>
      value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
    );
  const plural = flatten(ar).filter(([key]) => /_(one|other)$/.test(key));
  for (const [key] of plural) {
    const base = key.replace(/_(one|other)$/, "");
    const forms = plural.filter(([other]) => other.startsWith(`${base}_`)).map(([other]) => other.split("_").pop());
    const complete = ["zero", "one", "two", "few", "many", "other"].every((form) => forms.includes(form));
    assert.ok(complete, `${base} declares partial Arabic plurals; interpolate the count instead`);
  }
});

test("every backend warning code the sales endpoints emit has Arabic copy", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/overview.json"));
  const service = await read("../../server/services/analytics/analyticsSalesService.js");
  const emitted = new Set([...service.matchAll(/collector\.add\(\s*"([A-Z_]+)"/g)].map((match) => match[1]));
  assert.ok(emitted.size > 0, "the sales endpoints should emit some warnings");
  for (const code of emitted) {
    assert.ok(ar.warnings[code], `warning ${code} has no Arabic copy`);
  }
});

test("every highlight code the sales endpoints emit has Arabic copy", async () => {
  const ar = JSON.parse(await read("../../src/locales/ar/overview.json"));
  const service = await read("../../server/services/analytics/analyticsSalesService.js");
  for (const match of service.matchAll(/messageKey:\s*"highlights\.([a-zA-Z]+)"/g)) {
    assert.ok(ar.highlights[match[1]], `highlight key highlights.${match[1]} has no Arabic copy`);
  }
});
