// R3 — Sales & Profit Intelligence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_SALES_DIMENSION,
  MATRIX_LIMIT,
  NON_SIZED_VARIATION_MODES,
  NON_SIZE_VALUES,
  SALES_DIMENSIONS,
  SALES_SORTS,
  UNKNOWN_DIMENSION_KEYS,
  assessDimensionQuality,
  buildRankings,
  buildSalesHighlights,
  classifyQuadrants,
  densifyParams,
} from "../../server/services/analytics/analyticsSalesService.js";
import { BREAKDOWN_DIMENSIONS } from "../../server/services/analytics/analyticsFilters.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/* -------------------------------------------------------- shared vocabulary */

test("a metric shared with the overview keeps the overview's name", async () => {
  const sales = await read("../../server/services/analytics/analyticsSalesService.js");
  const overview = await read("../../server/services/analytics/analyticsOverviewService.js");

  // R3 first shipped `unitsSold` for the metric R2 already published as `itemsSold`.
  // Both returned the same number, so the two screens agreed on the figure and disagreed
  // on its name — exactly the drift the frozen contract exists to prevent.
  assert.ok(!/\bunitsSold\b/.test(sales), "R3 must not rename a metric the contract already names");

  const names = (source) => new Set([...source.matchAll(/^\s+([a-z][A-Za-z]*): kpi\(/gm)].map((match) => match[1]));
  const salesNames = names(sales);
  const overviewNames = names(overview);
  for (const metric of ["netSales", "grossProfit", "grossMargin", "orders", "itemsSold"]) {
    assert.ok(salesNames.has(metric), `${metric} must be published by the sales summary`);
    assert.ok(overviewNames.has(metric), `${metric} must be published by the overview`);
  }
});

/* ------------------------------------------------------------- allowlists */

test("product_type is the default breakdown, on production evidence", () => {
  assert.equal(DEFAULT_SALES_DIMENSION, "product_type");
  assert.ok(SALES_DIMENSIONS.product_type);
});

test("only allowlisted dimensions and sorts exist, and none is request-derived", async () => {
  assert.deepEqual(Object.keys(SALES_DIMENSIONS).sort(), ["brand", "category", "product_type"]);
  for (const key of Object.keys(SALES_DIMENSIONS)) assert.ok(BREAKDOWN_DIMENSIONS.includes(key));

  const source = await read("../../server/services/analytics/analyticsSalesService.js");
  // No request value may reach SQL as an identifier.
  assert.ok(!/ORDER BY \$\{(filters|req)/.test(source), "sort must never be interpolated from the request");
  assert.ok(!/GROUP BY \$\{(filters|req)/.test(source), "group by must never be interpolated from the request");
  assert.match(source, /SALES_SORTS\[filters\.sort\] \? filters\.sort : DEFAULT_SALES_SORT/, "sort must pass the allowlist");
  assert.match(source, /SALES_DIMENSIONS\[filters\.dimension\] \? filters\.dimension : DEFAULT_SALES_DIMENSION/);
});

test("every sort key maps to a known expression", () => {
  for (const key of Object.keys(SALES_SORTS)) assert.equal(typeof SALES_SORTS[key], "string");
});

/* -------------------------------------------------------- parameter safety */

test("densifyParams keeps only referenced parameters and renumbers them", () => {
  // The trend query references $1..$4 and $6 but never $5.
  const sql = "SELECT $1, $2, $3 WHERE a = $4 AND b = $6";
  const out = densifyParams(sql, ["t", "from", "to", "prevFrom", "prevTo", "sneakers"]);
  assert.equal(out.sql, "SELECT $1, $2, $3 WHERE a = $4 AND b = $5");
  assert.deepEqual(out.params, ["t", "from", "to", "prevFrom", "sneakers"]);
});

test("densifyParams handles multi-digit placeholders and no-parameter SQL", () => {
  const out = densifyParams("SELECT $2, $11, $2", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(out.sql, "SELECT $1, $2, $1");
  assert.deepEqual(out.params, [2, 11]);
  assert.deepEqual(densifyParams("SELECT 1", [1, 2]), { sql: "SELECT 1", params: [] });
});

/* ---------------------------------------------------- dimension quality */

test("a dimension where everything is unknown is reported unusable", () => {
  const rows = [{ key: "بدون علامة", netSales: 121220 }];
  const quality = assessDimensionQuality("brand", rows, 121220);
  assert.equal(quality.distinctMeaningfulValues, 0);
  assert.equal(quality.unknownContribution, 121220);
  assert.equal(quality.unknownContributionPercent, 1);
  assert.equal(quality.usable, false);
});

test("a dimension with real segmentation is usable even with an unknown bucket", () => {
  const rows = [
    { key: "Sneakers", netSales: 56400 },
    { key: "غير مصنف", netSales: 52170 },
    { key: "Shoes", netSales: 9050 },
    { key: "Footwear", netSales: 3600 },
  ];
  const quality = assessDimensionQuality("category", rows, 121220);
  assert.equal(quality.distinctMeaningfulValues, 3);
  assert.ok(quality.unknownContributionPercent > 0.4);
  assert.equal(quality.usable, true, "an unknown bucket does not make a dimension useless");
});

test("quality is computed per request, so it is never hardcoded to one dataset", () => {
  const poor = assessDimensionQuality("brand", [{ key: "بدون علامة", netSales: 100 }], 100);
  const rich = assessDimensionQuality("brand", [
    { key: "Adidas", netSales: 99325 }, { key: "Nike", netSales: 67375 }, { key: "SKECHERS", netSales: 56790 },
  ], 223490);
  assert.equal(poor.usable, false);
  assert.equal(rich.usable, true, "the same dimension must become usable when the data supports it");
  assert.equal(rich.distinctMeaningfulValues, 3);
});

test("the unknown-bucket keys cover every dimension's placeholder", () => {
  for (const key of ["بدون علامة", "غير مصنف", "غير محدد"]) assert.ok(UNKNOWN_DIMENSION_KEYS.includes(key));
});

/* ------------------------------------------------------------- quadrants */

const product = (id, netSales, grossMargin, units = 1) => ({
  productId: id, productName: `p${id}`, netSales, grossMargin,
  grossProfit: grossMargin === null ? null : netSales * grossMargin, units,
});

test("quadrants split on the period's own medians, not fixed thresholds", () => {
  const products = [product(1, 100, 0.1), product(2, 200, 0.2), product(3, 300, 0.3), product(4, 400, 0.4)];
  const { classified, medianNetSales, medianMargin } = classifyQuadrants(products);
  assert.equal(medianNetSales, 250);
  assert.ok(Math.abs(medianMargin - 0.25) < 1e-9);

  const byId = Object.fromEntries(classified.map((row) => [row.productId, row.quadrant]));
  assert.equal(byId[4], "star", "high sales + high margin");
  assert.equal(byId[1], "underperformer", "low sales + low margin");

  // Scaling every value by 1000 must not change the classification: the rule is relative.
  const scaled = classifyQuadrants(products.map((p) => ({ ...p, netSales: p.netSales * 1000 })));
  assert.deepEqual(scaled.classified.map((row) => row.quadrant), classified.map((row) => row.quadrant));
});

test("the two mixed quadrants are identified correctly", () => {
  const products = [
    product(1, 400, 0.05), // high sales, low margin
    product(2, 50, 0.9),   // low sales, high margin
    product(3, 300, 0.5),
    product(4, 100, 0.1),
  ];
  const byId = Object.fromEntries(classifyQuadrants(products).classified.map((r) => [r.productId, r.quadrant]));
  assert.equal(byId[1], "volume_low_margin");
  assert.equal(byId[2], "margin_opportunity");
});

test("too few products yields no quadrants rather than a meaningless split", () => {
  const { classified, medianNetSales } = classifyQuadrants([product(1, 100, 0.2), product(2, 200, 0.3)]);
  assert.equal(medianNetSales, null);
  assert.ok(classified.every((row) => row.quadrant === null));
});

test("products without a margin are never classified", () => {
  const products = [product(1, 100, 0.1), product(2, 200, 0.2), product(3, 300, 0.3), product(4, 400, 0.4), product(5, 500, null)];
  const classified = classifyQuadrants(products).classified;
  assert.equal(classified.find((row) => row.productId === 5).quadrant, null);
});

/* -------------------------------------------------------------- rankings */

test("rankings select from the aggregated set without re-aggregating", () => {
  const products = [
    { productId: 1, netSales: 300, units: 3, grossProfit: 90, growth: 0.5, netSalesPrevious: 200 },
    { productId: 2, netSales: 100, units: 9, grossProfit: 50, growth: -0.4, netSalesPrevious: 170 },
    { productId: 3, netSales: 200, units: 1, grossProfit: 10, growth: null, netSalesPrevious: null },
  ];
  const rankings = buildRankings(products, true);
  assert.equal(rankings.topBySales[0].productId, 1);
  assert.equal(rankings.topByUnits[0].productId, 2);
  assert.equal(rankings.topByProfit[0].productId, 1);
  assert.equal(rankings.fastestGrowth[0].productId, 1);
  assert.equal(rankings.largestDecline[0].productId, 2);
});

test("growth rankings are omitted without a comparison, and exclude products with no base", () => {
  const products = [{ productId: 1, netSales: 100, units: 1, grossProfit: 10, growth: 5, netSalesPrevious: 0 }];
  assert.equal(buildRankings(products, false).fastestGrowth, undefined);
  assert.deepEqual(buildRankings(products, true).fastestGrowth, [], "a zero base is not growth");
});

test("profit ranking is omitted when no product carries a profit figure", () => {
  const products = [{ productId: 1, netSales: 100, units: 1, grossProfit: null, growth: null }];
  assert.deepEqual(buildRankings(products, false).topByProfit, []);
});

/* ------------------------------------------------------------ highlights */

test("sales highlights are codes and raw values, never prose from the backend", () => {
  const highlights = buildSalesHighlights({
    kpis: {
      netSales: { current: 10000, previous: 5000, delta: 5000, deltaPercent: 1 },
      grossMargin: { current: 0.2, previous: 0.3, delta: -0.1 },
      discountRate: { current: 0.2, previous: 0.1 },
    },
    products: [
      { productId: 7, productName: "X", netSales: 900, netSalesPrevious: 300, growth: 2, grossProfit: 400 },
      { productId: 8, productName: "Y", netSales: 100, netSalesPrevious: 500, growth: -0.8, grossProfit: 20 },
    ],
    cogsCoverage: 0.99,
  });

  assert.ok(highlights.length <= 5);
  for (const item of highlights) {
    assert.ok(item.code && item.severity && item.metric && item.messageKey);
    assert.ok(!/[؀-ۿ]/.test(JSON.stringify(item)), "no Arabic prose may originate in the backend");
  }
  const codes = highlights.map((item) => item.code);
  assert.ok(codes.includes("SALES_GROWING"));
  assert.ok(codes.includes("MARGIN_DOWN_SALES_UP"));
  assert.ok(codes.includes("DISCOUNT_DEPENDENCY_HIGH"));
});

test("product highlights carry the entity id so the UI can link to it", () => {
  const highlights = buildSalesHighlights({
    kpis: { netSales: { current: 1, previous: 1, delta: 0, deltaPercent: 0 }, grossMargin: {}, discountRate: {} },
    products: [{ productId: 42, productName: "Air", netSales: 900, netSalesPrevious: 300, growth: 2, grossProfit: 100 }],
    cogsCoverage: 1,
  });
  const surging = highlights.find((item) => item.code === "PRODUCT_SURGING");
  assert.ok(surging);
  assert.equal(surging.entityId, 42);
  assert.equal(surging.entityName, "Air");
});

test("no highlight fires when nothing moved", () => {
  const highlights = buildSalesHighlights({
    kpis: {
      netSales: { current: 1000, previous: 1000, delta: 0, deltaPercent: 0 },
      grossMargin: { current: 0.3, previous: 0.3, delta: 0 },
      discountRate: { current: 0.01, previous: 0.01 },
    },
    products: [], cogsCoverage: 0.99,
  });
  assert.deepEqual(highlights, []);
});

/* ------------------------------------------------------------ size scope */

test("non-size sentinels and colour-only modes are excluded from size analysis", () => {
  for (const value of ["one size", "مقاس واحد"]) assert.ok(NON_SIZE_VALUES.includes(value));
  for (const mode of ["color_only", "simple"]) assert.ok(NON_SIZED_VARIATION_MODES.includes(mode));
});

test("size analysis is scoped to one product type and never forecasts stockout", async () => {
  const source = await read("../../server/services/analytics/analyticsSalesService.js");
  assert.match(source, /if \(!filters\.productType\)/, "sizes must require a single product type");
  assert.match(source, /SIZE_SCOPE_REQUIRED/);
  assert.match(source, /SIZE_SCOPE_APPLIED/);
  assert.ok(!/daysUntilStockout|stockoutForecast|daysOfCover/i.test(source), "R3 must not claim a stockout forecast");
  assert.match(source, /unitsPerDay/, "a period average is allowed, but only as a description");
});

/* ---------------------------------------------------- contract carry-over */

test("R3 does not reintroduce the discount double-count", async () => {
  const source = await read("../../server/services/analytics/analyticsSalesService.js");
  assert.ok(
    !/discount_amount[^)]*\+[^)]*(coupon|invoice)_discount_amount/.test(source),
    "discount_amount is all-inclusive; adding coupon or invoice discount double-counts"
  );
});

test("R3 introduces no movement-based inventory metric", async () => {
  const source = await read("../../server/services/analytics/analyticsSalesService.js");
  assert.ok(!/inventory_movements/i.test(source), "movement vocabulary is deferred, so R3 must not read it");
  for (const banned of ["turnover", "sellThrough", "sell_through", "stockAging"]) {
    assert.ok(!source.includes(banned), `R3 must not compute ${banned}`);
  }
});

test("the product list is capped and truncation is reported, never silent", async () => {
  const source = await read("../../server/services/analytics/analyticsSalesService.js");
  assert.equal(MATRIX_LIMIT, 300);
  assert.match(source, /PRODUCT_LIST_TRUNCATED/);
});

test("filtered totals switch basis and disclose it", async () => {
  const source = await read("../../server/services/analytics/analyticsSalesService.js");
  assert.match(source, /const productFiltered = Boolean\(/);
  assert.match(source, /FILTERED_EXCLUDES_RETURNS/);
  assert.match(source, /BREAKDOWN_EXCLUDES_RETURNS/);
});
