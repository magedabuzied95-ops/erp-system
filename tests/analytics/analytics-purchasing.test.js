// R5 — Purchasing & Supplier Intelligence.
//
// The repository has no SQL test harness, so this covers the pure logic plus
// source-level guarantees about the three things that would otherwise publish a wrong
// number: NaN in purchase totals, the header/line split, and the supplier-return cohort.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_PURCHASING_DIMENSION,
  DEFAULT_PURCHASING_PRODUCT_SORT,
  DEFAULT_SUPPLIER_SORT,
  LINE_HEADER_TOLERANCE,
  PRICE_MOVE_THRESHOLD,
  PURCHASING_DIMENSIONS,
  PURCHASING_PRODUCT_SORTS,
  SUPPLIER_SORTS,
  buildConcentration,
  buildPurchasingHighlights,
} from "../../server/services/analytics/analyticsPurchasingService.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const SERVICE = "../../server/services/analytics/analyticsPurchasingService.js";

/* ------------------------------------------------------------- concentration */

test("concentration needs at least two suppliers to mean anything", () => {
  const single = buildConcentration([{ supplierId: 1, spend: 1000 }], 1000, true);
  assert.equal(single.supplierCount, 1);
  // NOT 100%. One supplier is not a concentration finding, it is the whole population,
  // and rendering "100% of spend went to one supplier" as a warning would be noise.
  assert.equal(single.topShare, null);
  assert.equal(single.hhi, null);

  const none = buildConcentration([], 0, true);
  assert.equal(none.supplierCount, 0);
  assert.equal(none.topShare, null);
});

test("concentration reports exposure three ways, and HHI is the sum of squared shares", () => {
  const rows = [
    { supplierId: 1, spend: 600 },
    { supplierId: 2, spend: 200 },
    { supplierId: 3, spend: 150 },
    { supplierId: 4, spend: 50 },
  ];
  const result = buildConcentration(rows, 1000, true);

  assert.equal(result.supplierCount, 4);
  assert.equal(result.topShare, 0.6);
  assert.ok(Math.abs(result.topThreeShare - 0.95) < 1e-9);
  // 0.6^2 + 0.2^2 + 0.15^2 + 0.05^2 = 0.36 + 0.04 + 0.0225 + 0.0025
  assert.ok(Math.abs(result.hhi - 0.425) < 1e-9);
});

test("ten equal suppliers give an HHI of about 0.1, one supplier would give 1.0", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ supplierId: index + 1, spend: 100 }));
  const result = buildConcentration(rows, 1000, true);
  assert.ok(Math.abs(result.hhi - 0.1) < 1e-9, `expected ~0.1, got ${result.hhi}`);
});

test("a caller without the cost permission gets no concentration figures at all", () => {
  const result = buildConcentration([{ supplierId: 1, spend: 600 }, { supplierId: 2, spend: 400 }], 1000, false);
  assert.equal(result.restricted, true);
  assert.equal(result.topShare, null);
  assert.equal(result.topThreeShare, null);
  assert.equal(result.hhi, null);
  // The COUNT is not financial and stays visible: knowing there are two suppliers is not
  // knowing what was paid to them.
  assert.equal(result.supplierCount, 2);
});

test("suppliers with zero spend never enter the concentration population", () => {
  const rows = [
    { supplierId: 1, spend: 800 },
    { supplierId: 2, spend: 200 },
    { supplierId: 3, spend: 0 },
    { supplierId: 4, spend: null },
  ];
  const result = buildConcentration(rows, 1000, true);
  assert.equal(result.supplierCount, 2, "a supplier that was not paid is not a concentration risk");
});

/* ---------------------------------------------------------------- highlights */

const highlightCodes = (highlights) => highlights.map((entry) => entry.code);

test("a spend swing is highlighted only when it is material", () => {
  const base = {
    spendCurrent: 100, spendPrevious: 100, unitsCurrent: 10, unitsPrevious: 10,
    concentration: null, relationship: null, supplierReturns: null, includeCost: true, unpaid: 0,
  };
  assert.equal(highlightCodes(buildPurchasingHighlights(base)).length, 0, "a flat period says nothing");
  assert.ok(highlightCodes(buildPurchasingHighlights({ ...base, spendCurrent: 110 })).length === 0, "10% is noise");
  assert.ok(highlightCodes(buildPurchasingHighlights({ ...base, spendCurrent: 130 })).includes("PURCHASE_SPEND_UP"));
  assert.ok(highlightCodes(buildPurchasingHighlights({ ...base, spendCurrent: 70 })).includes("PURCHASE_SPEND_DOWN"));
});

test("a zero comparison base never produces a spend highlight", () => {
  // Dividing by a zero base is where a "+100%" that means "there was nothing before"
  // gets manufactured. The highlight simply does not fire.
  const highlights = buildPurchasingHighlights({
    spendCurrent: 5000, spendPrevious: 0, unitsCurrent: 20, unitsPrevious: 0,
    concentration: null, relationship: null, supplierReturns: null, includeCost: true, unpaid: 0,
  });
  assert.ok(!highlightCodes(highlights).includes("PURCHASE_SPEND_UP"));
  // But resuming after a dead period IS worth saying, and it is said as a count.
  assert.ok(highlightCodes(highlights).includes("PURCHASING_RESUMED"));
});

test("stock building up and drawing down are both reported, from the same ratio", () => {
  const base = {
    spendCurrent: 0, spendPrevious: null, unitsCurrent: 0, unitsPrevious: null,
    concentration: null, supplierReturns: null, includeCost: true, unpaid: 0,
  };
  const building = buildPurchasingHighlights({
    ...base,
    relationship: { stockBuildRatio: 2.4, purchaseSpend: 24000, cogs: 10000 },
  });
  assert.ok(highlightCodes(building).includes("STOCK_BUILDING_FASTER_THAN_SALES"));
  assert.equal(building.find((entry) => entry.code === "STOCK_BUILDING_FASTER_THAN_SALES").severity, "warning");

  const drawing = buildPurchasingHighlights({
    ...base,
    relationship: { stockBuildRatio: 0.3, purchaseSpend: 3000, cogs: 10000 },
  });
  assert.ok(highlightCodes(drawing).includes("STOCK_DRAWING_DOWN"));
  // Selling down stock is not a fault, so it stays informational.
  assert.equal(drawing.find((entry) => entry.code === "STOCK_DRAWING_DOWN").severity, "info");

  const balanced = buildPurchasingHighlights({
    ...base,
    relationship: { stockBuildRatio: 1.0, purchaseSpend: 10000, cogs: 10000 },
  });
  assert.equal(highlightCodes(balanced).length, 0);
});

test("an unmeasurable ratio produces no verdict", () => {
  // stockBuildRatio is null when nothing sold. "Bought without selling" is a real state
  // that a ratio cannot express, and inventing a verdict for it would be a guess.
  const highlights = buildPurchasingHighlights({
    spendCurrent: 5000, spendPrevious: null, unitsCurrent: 20, unitsPrevious: null,
    concentration: null, relationship: { stockBuildRatio: null, purchaseSpend: 5000, cogs: null },
    supplierReturns: null, includeCost: true, unpaid: 0,
  });
  assert.ok(!highlightCodes(highlights).some((code) => code.startsWith("STOCK_")));
});

test("no money highlight fires for a caller who may not see money", () => {
  const highlights = buildPurchasingHighlights({
    spendCurrent: 100000, spendPrevious: 10000, unitsCurrent: 100, unitsPrevious: 10,
    concentration: { topShare: 0.9, supplierCount: 3 },
    relationship: { stockBuildRatio: 4, purchaseSpend: 100000, cogs: 25000 },
    supplierReturns: { units: 5, suppliers: 1 },
    includeCost: false,
    unpaid: 90000,
  });
  const codes = highlightCodes(highlights);
  for (const financial of ["PURCHASE_SPEND_UP", "STOCK_BUILDING_FASTER_THAN_SALES", "SUPPLIER_CONCENTRATION_HIGH", "UNPAID_PURCHASES"]) {
    assert.ok(!codes.includes(financial), `${financial} leaked to a caller without the cost permission`);
  }
  // Unit counts are not financial and survive.
  assert.ok(codes.includes("SUPPLIER_RETURNS_RAISED"));
});

test("every highlight carries the numbers it was derived from", () => {
  const highlights = buildPurchasingHighlights({
    spendCurrent: 130, spendPrevious: 100, unitsCurrent: 10, unitsPrevious: 8,
    concentration: { topShare: 0.72, supplierCount: 4 },
    relationship: { stockBuildRatio: 1.9, purchaseSpend: 130, cogs: 68 },
    supplierReturns: { units: 3, suppliers: 2 },
    includeCost: true,
    unpaid: 40,
  });
  assert.ok(highlights.length >= 4);
  for (const highlight of highlights) {
    assert.ok(highlight.code, "a highlight must be machine-readable");
    assert.ok(highlight.messageKey, "wording is resolved in the bundle, never generated here");
    assert.ok(highlight.values && Object.keys(highlight.values).length, `${highlight.code} carries no evidence`);
    assert.ok(["info", "warning", "critical", "positive"].includes(highlight.severity));
  }
});

test("highlight interpolation keys never collide with the flat comparison fallbacks", async () => {
  // ManagementHighlights supplies percent/current/previous/points from the R2-era flat
  // fields. A values key with one of those names used to be overwritten with an empty
  // string, silently deleting the number from the sentence.
  const source = await read(SERVICE);
  const values = [...source.matchAll(/values:\s*\{([^}]*)\}/g)].map(([, body]) => body);
  assert.ok(values.length >= 5, "expected the highlight values objects to be found");
  for (const body of values) {
    for (const reserved of ["percent", "points", "current", "previous"]) {
      assert.ok(
        !new RegExp(`(^|[\\s{,])${reserved}\\s*:`).test(body),
        `a highlight uses the reserved interpolation key "${reserved}"`
      );
    }
  }
});

/* ------------------------------------------------------------------ contract */

test("dimensions and sorts are closed allowlists, never interpolated", async () => {
  assert.deepEqual(Object.keys(PURCHASING_DIMENSIONS), ["supplier", "product_type", "brand", "category"]);
  assert.ok(PURCHASING_DIMENSIONS[DEFAULT_PURCHASING_DIMENSION], "the default must be in the allowlist");
  assert.ok(PURCHASING_PRODUCT_SORTS[DEFAULT_PURCHASING_PRODUCT_SORT]);
  assert.ok(SUPPLIER_SORTS[DEFAULT_SUPPLIER_SORT]);

  const source = await read(SERVICE);
  // A sort key reaches SQL only through the map, and the map's VALUES are fixed column
  // names. Interpolating filters.sort directly would be an injection point.
  assert.match(source, /PURCHASING_PRODUCT_SORTS\[filters\.sort\] \|\| PURCHASING_PRODUCT_SORTS\[DEFAULT_PURCHASING_PRODUCT_SORT\]/);
  assert.match(source, /SUPPLIER_SORTS\[filters\.sort\] \|\| SUPPLIER_SORTS\[DEFAULT_SUPPLIER_SORT\]/);
  assert.ok(!/ORDER BY \$\{filters\./.test(source), "no request value is interpolated into ORDER BY");
});

test("supplier is the default dimension, because it is the only NOT NULL one", () => {
  assert.equal(DEFAULT_PURCHASING_DIMENSION, "supplier");
});

/* ----------------------------------------------------- the three real traps */

test("every purchase money expression is NaN-guarded, and the poisoned rows are counted", async () => {
  const source = await read(SERVICE);

  // D-01: purchases.total can hold a Postgres NUMERIC NaN, and NaN propagates through
  // SUM until an entire aggregate is NaN — which renders as a dash and reads as "no
  // purchases".
  assert.match(source, /const headerTotal = nanSafe\(/, "the header total must be NaN-guarded");
  assert.match(source, /const headerPaid = nanSafe\(/, "the paid amount must be NaN-guarded");
  assert.match(source, /const unitCost = nanSafe\(/, "the line unit cost must be NaN-guarded");

  // Guarding silently would hide a real data fault. The rows are counted and reported.
  assert.match(source, /total_is_nan/, "NaN rows must be counted, not only neutralised");
  assert.match(source, /NAN_VALUES_IGNORED/, "and reported as a warning");
  assert.match(source, /const reportNaN = /, "with a single place that decides to report");
});

test("spend uses the header and attribution uses the lines, and the gap is reported", async () => {
  const source = await read(SERVICE);

  // A purchase header carries tax and header discount; the sum of its lines does not have
  // to match. Spend is what was owed (header); a per-product figure cannot come from a
  // header at all (lines). Both are true, and a manager must be told when they diverge.
  assert.match(source, /basis: \{ spend: "purchase_header_total", attribution: "purchase_line_value" \}/);
  assert.match(source, /PURCHASE_LINE_HEADER_DELTA/);
  assert.ok(LINE_HEADER_TOLERANCE > 0 && LINE_HEADER_TOLERANCE < 0.1, "the tolerance must be tight");

  // The KPI reads header_totals; the breakdown reads scoped_lines. If those ever swap,
  // the page silently starts publishing a different number under the same label.
  assert.match(source, /SUM\(total\) FILTER \(WHERE in_current\)\s*,?\s*0?\)?\s*AS spend_current/);
  assert.match(source, /SUM\(sl\.line_value\) FILTER \(WHERE sl\.in_current\), 0\)\s*AS spend/);
});

test("the supplier return rate always carries its cohort caveat", async () => {
  const source = await read(SERVICE);

  // supplier_return_items is raised from a CUSTOMER return, so its population is not the
  // units purchased in the same window. Publishing a clean ratio would be dividing two
  // unrelated populations and calling the result a rate.
  assert.match(source, /SUPPLIER_RETURN_COHORT_MISMATCH/);
  const occurrences = source.split("SUPPLIER_RETURN_COHORT_MISMATCH").length - 1;
  assert.ok(occurrences >= 2, "both the summary and the supplier table must raise it");
  assert.match(source, /returnRate: safeRatio\(/, "the rate is still published, because it is useful");
});

test("no invented purchasing metric ships", async () => {
  const source = await read(SERVICE);

  // Lead time needs an ordered-at and a received-at; purchases records one timestamp.
  assert.ok(!/lead_?[Tt]ime/.test(source.replace(/^\s*\*.*$/gm, "")), "lead time is not derivable from this schema");
  // suppliers.debt_balance is the suppliers module's all-time ledger. Reading it here
  // would create a second definition of what is owed.
  assert.ok(!/debt_balance/.test(source.replace(/^\s*\*.*$/gm, "")), "the supplier ledger balance must not be mixed in");
  // Reorder rules already exist at /purchases/reorder-suggestions.
  assert.ok(
    !/BUY_NOW|DO_NOT_BUY/.test(source.replace(/^\s*\*.*$/gm, "")),
    "reorder rules must not be re-derived here"
  );
});

test("a price move needs units in both windows, or it is not reported", async () => {
  const source = await read(SERVICE);
  // Comparing a real price against nothing produces an infinite change, and rendering it
  // as +100% invents a price rise that never happened.
  assert.match(source, /WHEN pp\.units > 0 AND pp\.units_previous > 0 AND \(pp\.spend_previous \/ pp\.units_previous\) > 0/);
  assert.match(source, /priceMove: !includeCost \|\| deltaPercent === null/);
  assert.ok(PRICE_MOVE_THRESHOLD > 0 && PRICE_MOVE_THRESHOLD < 0.2);

  // Weighted, not an average of averages: one single-unit line at an odd price must not
  // outweigh a hundred-unit line at the real price.
  assert.match(source, /unitCost: "quantity_weighted"/);
});

/* -------------------------------------------------------- scope and security */

test("every query is tenant-scoped and the tenant comes from the request user", async () => {
  const source = await read(SERVICE);
  assert.match(source, /if \(tenantId !== null && purchaseColumns\.has\("tenant_id"\)\) purchaseWhere\.push\("pu\.tenant_id = \$1"\)/);
  // A super admin resolves to null, meaning "every tenant". Binding that null and
  // comparing it produces `tenant_id = NULL`, which matches nothing — the exact defect
  // that made R4 render blank for the users most likely to open it.
  assert.match(source, /tenantScoped: tenantId !== null/);
  assert.match(source, /scope\.tenantScoped &&/, "the tenant clause is conditional on a resolved tenant");
  // An empty clause list must still produce valid SQL rather than a dangling WHERE.
  assert.match(source, /purchaseWhere: purchaseWhere\.length \? purchaseWhere\.join\(" AND "\) : "TRUE"/);
  assert.match(source, /lineWhere: lineWhere\.length \? lineWhere\.join\(" AND "\) : "TRUE"/);
});

test("cost is withheld at the SELECT, not blanked afterwards", async () => {
  const source = await read(SERVICE);
  assert.match(source, /const includeCost = Boolean\(permissions\.cost\)/);
  assert.match(source, /const money = \(value, includeCost\) => \(includeCost \? toMoney/);
  // Every endpoint reports what the server actually granted, so the UI gates on fact
  // rather than on an undefined it reads as false.
  const envelopes = source.split("permissions: { cost: includeCost").length - 1;
  assert.ok(envelopes >= 4, `all four endpoints must report resolved permissions, found ${envelopes}`);
});

test("a failure is a 500 that names the area, never a zero", async () => {
  const controller = await read("../../server/controllers/analyticsV2Controller.js");
  assert.match(controller, /analyticsHandler\("purchasing", name, "PURCHASING_QUERY_FAILED", run\)/);
  const service = await read(SERVICE);
  assert.ok(!/catch \(\w*\) \{\s*return 0/.test(service), "no query failure may be converted into a zero");
});
