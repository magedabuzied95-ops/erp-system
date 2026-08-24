// R1: the frozen metric contract, enforced in code.
// docs/analytics/metric-contract.md v1.0.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AnalyticsFilterError,
  BREAKDOWN_DIMENSIONS,
  MAX_RANGE_DAYS,
  inclusiveDays,
  parseAnalyticsFilters,
  resolveComparisonWindow,
  resolveGranularity,
  toIsoDate,
} from "../../server/services/analytics/analyticsFilters.js";

import {
  COGS_COVERAGE_CRITICAL_THRESHOLD,
  WARNING_CODES,
  WarningCollector,
  applyCogsCoveragePolicy,
  buildDelta,
  safeRatio,
  toMoney,
} from "../../server/services/analytics/analyticsComparison.js";

import {
  DIMENSION_SQL,
  KNOWN_MOVEMENT_TYPES,
  canonicalOrderClauses,
  classifyMovementType,
  discountAmountExpr,
  discountBreakdownExprs,
  exchangeCreditRetainedExpr,
  exchangeOriginalReversedExpr,
  nanSafe,
  orderRevenueExpr,
  orphanExchangeExpr,
  recognisedExpenseClausesV2,
  recognisedPurchaseClauses,
  resolveSellerAttributionField,
  variantStockExpr,
} from "../../server/services/analytics/analyticsMetrics.js";

const req = (query = {}, user = { tenant_id: 1 }) => ({ query, user });

/* ------------------------------------------------------------------ §1.1 tenant */

test("tenant is derived from req.user only, never from headers or query", () => {
  const filters = parseAnalyticsFilters({
    query: { tenant_id: "999", tenantId: "999" },
    user: { tenant_id: 4 },
    headers: { "x-tenant-id": "999" },
  });
  assert.equal(filters.tenantId, 4);
});

test("super-admin resolves to an unscoped tenant", () => {
  const filters = parseAnalyticsFilters({ query: {}, user: { role: "super_admin" } });
  assert.equal(filters.tenantId, null);
});

test("a user with no tenant is rejected rather than silently unscoped", () => {
  assert.throws(
    () => parseAnalyticsFilters({ query: {}, user: {} }),
    (error) => error instanceof AnalyticsFilterError && error.code === "TENANT_CONTEXT_MISSING"
  );
});

/* -------------------------------------------------------------------- §1.2 dates */

test("dates are inclusive at both ends", () => {
  const filters = parseAnalyticsFilters(req({ from: "2026-01-01", to: "2026-01-31" }));
  assert.equal(filters.from, "2026-01-01");
  assert.equal(filters.to, "2026-01-31");
  assert.equal(filters.days, 31);
});

test("a single-day range counts as one day", () => {
  const filters = parseAnalyticsFilters(req({ from: "2026-03-10", to: "2026-03-10" }));
  assert.equal(filters.days, 1);
});

test("a missing range defaults to 30 days server-side", () => {
  const filters = parseAnalyticsFilters(req({}));
  assert.equal(filters.days, 30);
  assert.ok(filters.from < filters.to);
});

test("ranges over the maximum are rejected, not truncated", () => {
  assert.throws(
    () => parseAnalyticsFilters(req({ from: "2020-01-01", to: "2026-01-01" })),
    (error) => error.code === "RANGE_TOO_LARGE" && error.details.days > MAX_RANGE_DAYS
  );
});

test("an inverted range is rejected", () => {
  assert.throws(
    () => parseAnalyticsFilters(req({ from: "2026-05-01", to: "2026-04-01" })),
    (error) => error.code === "DATE_RANGE_INVALID"
  );
});

test("impossible calendar dates are rejected rather than rolled forward", () => {
  assert.throws(
    () => parseAnalyticsFilters(req({ from: "2026-02-31", to: "2026-03-01" })),
    (error) => error.code === "DATE_INVALID"
  );
});

test("leap day is accepted", () => {
  const filters = parseAnalyticsFilters(req({ from: "2028-02-29", to: "2028-02-29" }));
  assert.equal(filters.from, "2028-02-29");
});

/* ---------------------------------------------------------------- §8 comparison */

test("previous_period is the same length immediately before the window", () => {
  const window = resolveComparisonWindow({
    from: new Date(Date.UTC(2026, 0, 11)),
    to: new Date(Date.UTC(2026, 0, 20)),
    mode: "previous_period",
  });
  assert.equal(toIsoDate(window.from), "2026-01-01");
  assert.equal(toIsoDate(window.to), "2026-01-10");
  assert.equal(inclusiveDays(window.from, window.to), 10);
});

test("previous_year keeps the window length", () => {
  const window = resolveComparisonWindow({
    from: new Date(Date.UTC(2026, 5, 1)),
    to: new Date(Date.UTC(2026, 5, 30)),
    mode: "previous_year",
  });
  assert.equal(toIsoDate(window.from), "2025-06-01");
  assert.equal(inclusiveDays(window.from, window.to), 30);
});

test("custom comparison requires both ends", () => {
  assert.throws(
    () => parseAnalyticsFilters(req({ from: "2026-01-01", to: "2026-01-31", compare: "custom", compareFrom: "2025-01-01" })),
    (error) => error.code === "COMPARISON_RANGE_INVALID"
  );
});

test("percentage change against a zero base is null, not 100", () => {
  const collector = new WarningCollector();
  const delta = buildDelta(500, 0, { collector, metric: "netSales" });
  assert.equal(delta.delta, 500);
  assert.equal(delta.deltaPercent, null);
  assert.ok(collector.has(WARNING_CODES.COMPARISON_BASE_ZERO));
});

test("percentage change is computed against the absolute base", () => {
  const delta = buildDelta(150, 100);
  assert.equal(delta.deltaPercent, 0.5);
  assert.equal(delta.direction, "up");
});

test("a null side makes the whole delta null", () => {
  const delta = buildDelta(null, 100);
  assert.equal(delta.delta, null);
  assert.equal(delta.deltaPercent, null);
});

/* ------------------------------------------------------------ §2 null semantics */

test("a zero denominator yields null, never zero", () => {
  assert.equal(safeRatio(0, 0), null);
  assert.equal(safeRatio(100, 0), null);
  assert.equal(safeRatio(0, 100), 0); // a real, verified zero
});

test("NaN and non-numeric money become null, not zero", () => {
  assert.equal(toMoney(Number.NaN), null);
  assert.equal(toMoney("NaN"), null);
  assert.equal(toMoney(undefined), null);
  assert.equal(toMoney("12.345"), 12.35);
  assert.equal(toMoney(0), 0);
});

test("low cost coverage warns; critical coverage blanks profit", () => {
  const warn = new WarningCollector();
  const warned = applyCogsCoveragePolicy({ coverage: 0.8, values: { grossProfit: 100, grossMargin: 0.4 }, collector: warn });
  assert.equal(warned.grossProfit, 100, "a warning must not blank the value");
  assert.ok(warn.has(WARNING_CODES.COGS_COVERAGE_LOW));

  const critical = new WarningCollector();
  const blanked = applyCogsCoveragePolicy({
    coverage: COGS_COVERAGE_CRITICAL_THRESHOLD - 0.01,
    values: { grossProfit: 100, grossMargin: 0.4, netProfit: 50 },
    collector: critical,
  });
  assert.equal(blanked.grossProfit, null);
  assert.equal(blanked.grossMargin, null);
  assert.equal(blanked.netProfit, null);
  assert.ok(critical.has(WARNING_CODES.COGS_COVERAGE_CRITICAL));
});

/* ------------------------------------------------- §1.3 v2 canonical predicate */

// Mirrors the production `orders` schema for the columns this contract touches, verified
// against information_schema on 2026-08-24.
const ORDER_COLUMNS = new Set([
  "tenant_id", "status", "payment_status", "is_personal_transaction", "deleted_at",
  "subtotal", "total_amount", "discount_amount", "invoice_discount_amount",
  "coupon_discount_amount", "exchange_mode", "amount_due_now", "exchange_difference",
  "original_order_id", "returned_at",
  "seller_user_id", "sales_employee_id", "salesperson_id", "channel",
]);

test("v2 predicate adds soft-delete and draft-pattern exclusions on top of the canon", () => {
  const { base, clauses, divergenceClauses } = canonicalOrderClauses(ORDER_COLUMNS);
  assert.equal(base.length, 3, "the accounting canon contributes exactly three clauses");
  assert.equal(clauses.length, 5);

  const ids = divergenceClauses.map((entry) => entry.id);
  assert.deepEqual(ids, ["D-04", "D-05"]);
  assert.ok(clauses.some((clause) => /deleted_at IS NULL/.test(clause)), "D-04 soft-delete exclusion missing");
  assert.ok(clauses.some((clause) => /NOT LIKE '%draft%'/.test(clause)), "D-05 draft-pattern exclusion missing");
});

test("the draft pattern catches ai_draft, which the literal list misses", () => {
  const { base, divergenceClauses } = canonicalOrderClauses(ORDER_COLUMNS);
  const draftClause = divergenceClauses.find((entry) => entry.id === "D-05").sql;
  assert.match(draftClause, /LOWER\(COALESCE\(o\.status, ''\)\) NOT LIKE '%draft%'/);

  // Evaluate both predicates against the statuses actually observed in the data.
  const literalList = ["cancelled", "canceled", "void", "refunded", "returned", "draft", "deleted"];
  const survivesLiteralList = (status) => !literalList.includes(String(status).toLowerCase());
  const survivesDraftPattern = (status) => !String(status).toLowerCase().includes("draft");

  // Sanity-check that the literal list under test is the one the canon actually emits.
  for (const value of literalList) assert.ok(base[0].includes(`'${value}'`), `canon is missing '${value}'`);

  // ai_draft is the case the literal list misses: it survives, and only the pattern stops it.
  assert.ok(survivesLiteralList("ai_draft"), "ai_draft is not in the literal exclusion list");
  assert.ok(!survivesDraftPattern("ai_draft"), "the %draft% pattern must exclude ai_draft");

  // 'draft' itself is caught by both, so the pattern is a superset, not a replacement.
  assert.ok(!survivesLiteralList("draft"));
  assert.ok(!survivesDraftPattern("draft"));

  // Statuses that merely look pending must not be swept up.
  for (const status of ["pending", "pending_confirmation", "awaiting_verification", "paid", "delivered"]) {
    assert.ok(survivesDraftPattern(status), `${status} must not be treated as draft-like`);
  }
});

test("divergence clauses are separable so reconciliation can quantify them", () => {
  const { base, divergenceClauses } = canonicalOrderClauses(ORDER_COLUMNS);
  for (const clause of base) {
    assert.ok(!divergenceClauses.some((entry) => entry.sql === clause), "a base clause leaked into divergences");
  }
});

/* --------------------------------------------------------------- §3 discounts */

test("discount uses discount_amount alone - no coupon or invoice added", () => {
  const expr = discountAmountExpr(ORDER_COLUMNS);
  assert.equal(expr, "COALESCE(o.discount_amount, 0)");
  assert.ok(!expr.includes("coupon"), "coupon_discount_amount must not be added (D-02)");
  assert.ok(!expr.includes("invoice"), "invoice_discount_amount must not be added (D-02)");
});

test("discount breakdown components are exposed but kept out of the total", () => {
  const breakdown = discountBreakdownExprs(ORDER_COLUMNS);
  assert.equal(breakdown.total, "COALESCE(o.discount_amount, 0)");
  assert.match(breakdown.invoice, /invoice_discount_amount/);
  assert.match(breakdown.coupon, /coupon_discount_amount/);
  assert.ok(!breakdown.total.includes("+"), "the total must not be a sum of components");
});

// The six-case matrix from docs/analytics/metric-contract.md §10, evaluated arithmetically.
const DISCOUNT_FIXTURES = [
  { name: "no discount", subtotal: 1000, item: 0, invoice: 0, coupon: 0, discount_amount: 0, total: 1000 },
  { name: "item only", subtotal: 1000, item: 100, invoice: 0, coupon: 0, discount_amount: 100, total: 900 },
  { name: "invoice only", subtotal: 1000, item: 0, invoice: 150, coupon: 0, discount_amount: 150, total: 850 },
  { name: "coupon only", subtotal: 1000, item: 0, invoice: 0, coupon: 200, discount_amount: 200, total: 800 },
  { name: "item + invoice", subtotal: 1000, item: 100, invoice: 150, coupon: 0, discount_amount: 250, total: 750 },
  { name: "all three", subtotal: 1000, item: 100, invoice: 150, coupon: 200, discount_amount: 450, total: 550 },
];

test("discount fixture matrix: the stored identity holds and v2 matches discount_amount", () => {
  for (const fixture of DISCOUNT_FIXTURES) {
    assert.equal(
      fixture.subtotal - fixture.discount_amount,
      fixture.total,
      `${fixture.name}: subtotal - discount_amount must equal total_amount`
    );
    assert.equal(
      fixture.item + fixture.invoice + fixture.coupon,
      fixture.discount_amount,
      `${fixture.name}: discount_amount must be the all-inclusive sum of its components`
    );
  }
});

test("discount fixture matrix: legacy over-counting is quantified", () => {
  for (const fixture of DISCOUNT_FIXTURES) {
    const v2 = fixture.discount_amount;
    const accountingService = fixture.discount_amount + fixture.coupon;
    const reportsV2 = fixture.discount_amount + fixture.invoice + fixture.coupon;

    assert.equal(accountingService - v2, fixture.coupon, `${fixture.name}: accounting over-counts by the coupon`);
    assert.equal(reportsV2 - v2, fixture.invoice + fixture.coupon, `${fixture.name}: reports-v2 over-counts by invoice + coupon`);

    // Over-counting discount understates net sales by the same amount.
    const netV2 = fixture.subtotal - v2;
    const netLegacy = fixture.subtotal - accountingService;
    assert.equal(netV2 - netLegacy, fixture.coupon, `${fixture.name}: net sales understated by the coupon`);
  }

  const allThree = DISCOUNT_FIXTURES.at(-1);
  assert.equal(allThree.discount_amount + allThree.coupon, 650);
  assert.equal(allThree.discount_amount + allThree.invoice + allThree.coupon, 800);
});

/* --------------------------------------------------------------- §6 exchanges */

// There are two exchange shapes, and they need opposite treatment.
//
// The POS reverses the original before opening the exchange sale — a returns row,
// returned_quantity, a RETURN_IN movement and status = 'returned' — so the original is
// already out of every figure. `POST /orders` accepts exchange_mode with no such
// evidence, which leaves both sides live. See docs/analytics/legacy-defects.md D-03.

test("amending the contract bumped its version, everywhere it is stamped", async () => {
  const { CONTRACT_VERSION } = await import("../../server/services/analytics/analyticsMetrics.js");
  assert.equal(CONTRACT_VERSION, "1.1.0", "§6 changed, so the version had to move");

  // buildEnvelope cannot import the constant without a cycle, so its default is a
  // literal. If the two drift, an endpoint that omits the field publishes a stale version.
  const comparison = readFileSync(new URL("../../server/services/analytics/analyticsComparison.js", import.meta.url), "utf8");
  const fallback = comparison.match(/contractVersion = "([^"]+)"/)?.[1];
  assert.equal(fallback, CONTRACT_VERSION, "the envelope default must track CONTRACT_VERSION");

  // And the document the constant refers to.
  const contract = readFileSync(new URL("../../docs/analytics/metric-contract.md", import.meta.url), "utf8");
  assert.ok(contract.includes(`Contract version: **${CONTRACT_VERSION}**`), "the contract must state the same version");
  assert.match(contract, /\| 1\.1\.0 \| 2026-08-24 \|/, "and record what changed");
});

test("an exchange whose original was reversed recognises its full revenue", () => {
  const expr = orderRevenueExpr(ORDER_COLUMNS);
  // amount_due_now applies only when the original is NOT reversed. Recognising it when
  // the original is gone understates the sale by the entire credited portion.
  assert.match(expr, /WHEN COALESCE\(o\.exchange_mode, FALSE\) AND NOT \(EXISTS \(/);
  assert.match(expr, /THEN COALESCE\(o\.amount_due_now, 0\)/);
});

test("the reversal is read from the data, and only from this tenant's data", () => {
  const expr = exchangeOriginalReversedExpr(ORDER_COLUMNS);
  assert.match(expr, /SELECT 1 FROM orders orig/);
  assert.match(expr, /orig\.id = o\.original_order_id/);
  assert.match(expr, /orig\.returned_at IS NOT NULL/);
  assert.match(expr, /LOWER\(COALESCE\(orig\.status, ''\)\) IN \('returned', 'refunded'\)/);
  // original_order_id is an unconstrained bigint from the request body.
  assert.match(expr, /AND orig\.tenant_id = o\.tenant_id/);

  const untenanted = exchangeOriginalReversedExpr(new Set(["original_order_id", "returned_at", "status"]));
  assert.ok(!untenanted.includes("tenant_id"), "a schema without tenant_id must degrade, not emit invalid SQL");
  assert.equal(exchangeOriginalReversedExpr(new Set(["status"])), "FALSE", "no link column means no claim either way");
});

test("non-exchange orders are unaffected by the exchange branch", () => {
  const withoutExchange = orderRevenueExpr(new Set(["subtotal", "total_amount", "discount_amount"]));
  assert.ok(!withoutExchange.includes("CASE"), "no exchange columns means no CASE branch");
});

// Worked examples A/B/C from docs/analytics/metric-contract.md §6, now stated for both
// shapes. `original` is what the replaced order contributes: nothing once it is returned.
const EXCHANGE_CASES = [
  { name: "A like-for-like", original: 1000, replacement: 1000, credit: 1000, dueNow: 0, difference: 0, legacy: 2000, orphan: 1000, truth: 1000 },
  { name: "B upgrade", original: 1000, replacement: 1200, credit: 1000, dueNow: 200, difference: 200, legacy: 2200, orphan: 1200, truth: 1200 },
  { name: "C downgrade", original: 1000, replacement: 800, credit: 1000, dueNow: 0, difference: -200, legacy: 1800, orphan: 1000, truth: 800 },
];

test("orphan exchanges: recognising amount_due_now removes the credited double-count", () => {
  for (const item of EXCHANGE_CASES) {
    const legacy = item.original + item.replacement;
    const v2 = item.original + item.dueNow;
    assert.equal(legacy, item.legacy, `${item.name}: legacy revenue`);
    assert.equal(v2, item.orphan, `${item.name}: orphan-shape revenue`);
    assert.ok(v2 <= legacy, `${item.name}: v2 must never exceed legacy`);
  }
});

test("reversed exchanges: the full replacement value is exactly right, in every case", () => {
  for (const item of EXCHANGE_CASES) {
    // The original was returned, so it contributes nothing and the exchange stands alone.
    const v2 = 0 + item.replacement;
    assert.equal(v2, item.truth, `${item.name}: reversed-shape revenue must be exact`);
    // Which is also why the old rule was wrong here: it would have recognised dueNow.
    if (item.dueNow !== item.replacement) {
      assert.ok(item.dueNow < v2, `${item.name}: amount_due_now would have understated this sale`);
    }
  }
});

test("orphan cases A/B are exact; case C overstates by exactly the retained credit", () => {
  const [caseA, caseB, caseC] = EXCHANGE_CASES;
  assert.equal(caseA.orphan, caseA.truth, "case A must be exact");
  assert.equal(caseB.orphan, caseB.truth, "case B must be exact");

  const retained = Math.max(-caseC.difference, 0);
  assert.equal(retained, 200);
  assert.equal(caseC.orphan - caseC.truth, retained, "case C overstatement must equal the retained credit");
});

test("retained credit and the unreversed-cost warning fire only on the orphan shape", () => {
  const retained = exchangeCreditRetainedExpr(ORDER_COLUMNS);
  assert.match(retained, /GREATEST\(-COALESCE\(o\.exchange_difference, 0\), 0\)/);
  // On the reversed shape the unconsumed credit is already a wallet liability, not
  // revenue sitting in this figure, so there is nothing residual to disclose.
  assert.match(retained, /CASE WHEN \(COALESCE\(o\.exchange_mode, FALSE\) AND NOT \(EXISTS/);

  const orphan = orphanExchangeExpr(ORDER_COLUMNS);
  assert.match(orphan, /COALESCE\(o\.exchange_mode, FALSE\) AND NOT \(EXISTS/);
  assert.equal(orphanExchangeExpr(new Set(["total_amount"])), "FALSE");

  const overview = readFileSync(new URL("../../server/services/analytics/analyticsOverviewService.js", import.meta.url), "utf8");
  // A warning that appears when nothing is wrong stops being read.
  assert.match(overview, /COUNT\(\*\) FILTER \(WHERE in_current AND orphan_exchange\)::int AS exchange_orders_current/);
});

/* ----------------------------------------------------------------- §1.6 NaN */

test("NaN-guarded aggregates neutralise poisoned rows instead of returning NaN", () => {
  const expr = nanSafe("pu.total");
  assert.match(expr, /CASE WHEN \(pu\.total\)::text = 'NaN' THEN 0 ELSE COALESCE\(pu\.total, 0\) END/);
});

test("purchase recognition excludes drafts, soft-deletes and reversals", () => {
  const clauses = recognisedPurchaseClauses(new Set(["status", "deleted_at", "reversed_at"]));
  assert.ok(clauses.some((clause) => /'draft'/.test(clause)), "draft purchases carried the NaN row (D-01)");
  assert.ok(clauses.some((clause) => /deleted_at IS NULL/.test(clause)));
  assert.ok(clauses.some((clause) => /reversed_at IS NULL/.test(clause)));
});

/* ------------------------------------------------------------------ expenses */

test("v2 excludes draft expenses and keeps the divergence separable", () => {
  const { clauses, divergenceClauses } = recognisedExpenseClausesV2(new Set(["status"]));
  assert.match(clauses[0], /'draft'/);
  assert.deepEqual(divergenceClauses.map((entry) => entry.id), ["D-07"]);
});

/* ----------------------------------------------------------------- inventory */

test("stock is read from product_variants, never from the dead products.stock", () => {
  const expr = variantStockExpr({ variantColumns: new Set(["stock"]) });
  assert.equal(expr, "COALESCE(pv.stock, 0)");
  assert.ok(!expr.includes("p.stock"), "products.stock is unmaintained (D-08)");
});

test("movement types are classified from an explicit allowlist", () => {
  assert.equal(classifyMovementType("purchase"), "purchaseIn");
  assert.equal(classifyMovementType("purchase_in"), "purchaseIn");
  assert.equal(classifyMovementType("sale"), "saleOut");
  assert.equal(classifyMovementType("website_order"), "saleOut");
  assert.equal(classifyMovementType("return"), "returnIn");
  assert.equal(classifyMovementType("owner_use_out"), "ownerUse");
  assert.equal(classifyMovementType("something_new"), null, "unknown types must not be silently bucketed");
  assert.ok(KNOWN_MOVEMENT_TYPES.includes("purchase_reverse_stock_out"));
});

/* ---------------------------------------------------------------- dimensions */

test("every allowed breakdown dimension has SQL and nothing extra does", () => {
  for (const dimension of BREAKDOWN_DIMENSIONS) {
    assert.ok(DIMENSION_SQL[dimension], `dimension ${dimension} has no SQL mapping`);
    assert.equal(typeof DIMENSION_SQL[dimension].expr, "string");
  }
  for (const key of Object.keys(DIMENSION_SQL)) {
    assert.ok(BREAKDOWN_DIMENSIONS.includes(key), `${key} has SQL but is not an allowed dimension`);
  }
});

test("an unknown dimension is rejected before it can reach SQL", () => {
  assert.throws(
    () => parseAnalyticsFilters(req({ dimension: "'; DROP TABLE orders; --" })),
    (error) => error.code === "DIMENSION_INVALID"
  );
});

test("seller attribution follows the documented precedence", () => {
  assert.equal(resolveSellerAttributionField(ORDER_COLUMNS), "seller_user_id");
  assert.equal(resolveSellerAttributionField(new Set(["sales_employee_id", "salesperson_id"])), "sales_employee_id");
  assert.equal(resolveSellerAttributionField(new Set(["salesperson_id"])), "salesperson_id");
  // orders has no employee_id; reportsService assumes one and always reports zero.
  assert.equal(resolveSellerAttributionField(new Set(["employee_id"])), null);
});

/* --------------------------------------------------------------- granularity */

test("auto granularity scales with the window", () => {
  assert.equal(resolveGranularity("auto", 1), "hour");
  assert.equal(resolveGranularity("auto", 30), "day");
  assert.equal(resolveGranularity("auto", 120), "week");
  assert.equal(resolveGranularity("auto", 365), "month");
  assert.equal(resolveGranularity("month", 1), "month", "an explicit granularity wins");
});

/* -------------------------------------------------- category resolution (R2.5) */

test("category resolves through the ERP ladder, not category_id alone", async () => {
  const { categoryNameExpr } = await import("../../server/services/analytics/analyticsMetrics.js");
  const expr = categoryNameExpr();

  // Production has an empty `categories` table and NULL category_id on every product,
  // so a join-only expression yields nothing. All three rungs must be present.
  assert.match(expr, /cat\.name/, "must still prefer the relational categories.name");
  assert.match(expr, /p\.main_category/, "must fall back to main_category");
  assert.match(expr, /p\.category\b/, "must fall back to the category text column");

  // Case folding: production holds both 'sneakers' and 'Sneakers'.
  assert.match(expr, /LOWER\(/);
  assert.match(expr, /INITCAP\(/);
});

test("the literal 'Uncategorized' sentinel is treated as absent, not as a category", async () => {
  const { categoryNameExpr, UNCATEGORISED_SENTINELS } = await import("../../server/services/analytics/analyticsMetrics.js");
  const expr = categoryNameExpr();
  assert.ok(UNCATEGORISED_SENTINELS.includes("uncategorized"));
  for (const sentinel of UNCATEGORISED_SENTINELS) {
    assert.ok(expr.includes(`'${sentinel}'`), `sentinel ${sentinel} must be excluded`);
  }
  assert.match(expr, /THEN NULL/, "a sentinel must resolve to NULL so it lands in the uncategorised bucket");
});

test("product_type is a separate dimension, never merged into category", async () => {
  const { DIMENSION_SQL, categoryNameExpr, productTypeExpr } = await import("../../server/services/analytics/analyticsMetrics.js");
  assert.ok(DIMENSION_SQL.product_type, "product_type must be an available dimension");
  assert.ok(BREAKDOWN_DIMENSIONS.includes("product_type"));
  assert.ok(
    !categoryNameExpr().includes("product_type"),
    "product_type is a different classification axis and must not be folded into category"
  );
  assert.match(productTypeExpr(), /REPLACE\(LOWER\(TRIM\(COALESCE\(p\.product_type/);
});
