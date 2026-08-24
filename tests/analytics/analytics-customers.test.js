// R6 — Customer Intelligence.
//
// Two things are load-bearing here and both are asserted at the source, not just in the
// pure functions: the segmentation is TOTAL (no customer can fall out of it), and no
// query in the file may ever select a phone number or an email address.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CUSTOMER_DIMENSIONS,
  CUSTOMER_SEGMENTS,
  CUSTOMER_SEGMENT_RULES,
  CUSTOMER_SORTS,
  DEFAULT_CUSTOMER_DIMENSION,
  DEFAULT_CUSTOMER_SORT,
  ENGAGED_SEGMENTS,
  LAPSED_SEGMENTS,
  REPEAT_SEGMENTS,
  TOTALS_DIVERGENCE_TOLERANCE,
  buildCustomerHighlights,
  classifyCustomerSegment,
} from "../../server/services/analytics/analyticsCustomersService.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const SERVICE = "../../server/services/analytics/analyticsCustomersService.js";

/* --------------------------------------------------------------- privacy */

test("no query in the customer report selects a phone number or an email address", async () => {
  const source = await read(SERVICE);
  // Strip the doc comments, which discuss the columns by name precisely because they are
  // never selected.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const column of ["c.phone", "c.email", "customers.phone", "customers.email"]) {
    assert.ok(!code.includes(column), `${column} must never be selected by a report`);
  }
  // And nothing may sneak them in via a wildcard select on customers.
  assert.ok(!/SELECT\s+c\.\*/i.test(code), "a wildcard select on customers would carry contact details");
  assert.ok(!/SELECT\s+\*\s+FROM\s+customers/i.test(code));
});

test("names are a separate grant, and hiding them never drops the row", async () => {
  const source = await read(SERVICE);
  assert.match(source, /const showNames = Boolean\(permissions\.customers\)/);
  // The row survives without its name, so the totals on the page stay correct. Filtering
  // the rows out instead would silently understate every figure beside them.
  assert.match(source, /\$\{showNames \? "COALESCE\(NULLIF\(TRIM\(c\.name\), ''\), 'عميل بدون اسم'\)" : "NULL::text"\} AS customer_name/);
  assert.match(source, /anonymised: !showNames/);
  assert.match(source, /CUSTOMER_NAMES_RESTRICTED/);
  assert.match(source, /privacy: \{ contactDetails: "never_returned"/);
});

test("the permission is resolved from the same row set as the reporting permissions", async () => {
  const scope = await read("../../server/services/analytics/analyticsScope.js");
  assert.match(scope, /export const CUSTOMERS_MODULE = "customers"/);
  assert.match(scope, /customers: granted\.has\(`\$\{CUSTOMERS_MODULE\}:view`\)/);
  // Admin, super-admin and wildcard all short-circuit, exactly as they do for cost.
  for (const branch of ["super_admin", "admin", "wildcard"]) {
    assert.match(scope, new RegExp(`customers: true, source: "${branch}"`), `${branch} must resolve customers access`);
  }
  assert.match(scope, /customers: false, source: "anonymous"/);
});

/* --------------------------------------------------------- segmentation */

test("classifyCustomerSegment is total: every combination returns a known class", () => {
  const orderedInWindow = [true, false];
  const orderedBefore = [true, false];
  const daysSince = [null, undefined, 0, 1, 30, 59, 60, 61, 179, 180, 500];
  const lifetime = [0, 1, 2, 17];

  let combinations = 0;
  for (const a of orderedInWindow) {
    for (const b of orderedBefore) {
      for (const c of daysSince) {
        for (const d of lifetime) {
          const segment = classifyCustomerSegment({
            orderedInWindow: a, orderedBefore: b, daysSinceLastOrder: c, lifetimeOrders: d,
          });
          combinations += 1;
          assert.ok(
            CUSTOMER_SEGMENTS.includes(segment),
            `(${a}, ${b}, ${c}, ${d}) produced "${segment}", which is not a declared segment`
          );
        }
      }
    }
  }
  assert.equal(combinations, 2 * 2 * 11 * 4);
});

test("repeat means bought more than once, NOT existed before the window", () => {
  // The defect this pins: a shop whose customers were all won this quarter and had each
  // already bought six times reported a repeat-purchase rate of 0%, because "returning"
  // was defined as "had an order before the window".
  const wonThisWindowAndCameBack = classifyCustomerSegment({
    orderedInWindow: true, orderedBefore: false, daysSinceLastOrder: 2, lifetimeOrders: 6,
  });
  assert.equal(wonThisWindowAndCameBack, "new_repeat");
  assert.ok(REPEAT_SEGMENTS.includes(wonThisWindowAndCameBack), "a customer with six orders is a repeat customer");

  const wonThisWindowOnce = classifyCustomerSegment({
    orderedInWindow: true, orderedBefore: false, daysSinceLastOrder: 2, lifetimeOrders: 1,
  });
  assert.equal(wonThisWindowOnce, "new");
  assert.ok(!REPEAT_SEGMENTS.includes(wonThisWindowOnce));
});

test("buying inside the window always beats recency", () => {
  // A customer who bought yesterday is not at risk, no matter how long the gap before
  // that was.
  const segment = classifyCustomerSegment({
    orderedInWindow: true, orderedBefore: true, daysSinceLastOrder: 900, lifetimeOrders: 4,
  });
  assert.equal(segment, "active_repeat");
  assert.ok(ENGAGED_SEGMENTS.includes(segment));
});

test("the lapsed bands are exactly the published thresholds", () => {
  const { atRiskAfterDays, dormantAfterDays } = CUSTOMER_SEGMENT_RULES;
  assert.ok(atRiskAfterDays < dormantAfterDays);

  const at = (days) => classifyCustomerSegment({ orderedInWindow: false, orderedBefore: true, daysSinceLastOrder: days, lifetimeOrders: 3 });

  assert.equal(at(atRiskAfterDays - 1), "recent", "one day inside the band is still engaged");
  assert.equal(at(atRiskAfterDays), "at_risk", "the threshold itself is inclusive");
  assert.equal(at(dormantAfterDays - 1), "at_risk");
  assert.equal(at(dormantAfterDays), "dormant");
  assert.equal(at(10_000), "dormant");

  assert.deepEqual(LAPSED_SEGMENTS, ["at_risk", "dormant"]);
});

test("no order history at all is its own state, never a lapsed verdict", () => {
  for (const missing of [null, undefined]) {
    const segment = classifyCustomerSegment({
      orderedInWindow: false, orderedBefore: false, daysSinceLastOrder: missing, lifetimeOrders: 0,
    });
    assert.equal(segment, "never_ordered", "a customer with no order is not dormant, they never started");
  }
});

test("engaged, repeat and lapsed together cover every segment exactly once", () => {
  const covered = [...new Set([...ENGAGED_SEGMENTS, ...LAPSED_SEGMENTS, "never_ordered"])];
  assert.deepEqual(covered.slice().sort(), CUSTOMER_SEGMENTS.slice().sort());
  // Repeat is a subset of engaged, not a fourth bucket.
  for (const segment of REPEAT_SEGMENTS) {
    assert.ok(ENGAGED_SEGMENTS.includes(segment), `${segment} must also be engaged`);
  }
});

test("the SQL CASE and the JS classifier agree, arm for arm", async () => {
  const source = await read(SERVICE);
  // Two implementations of the same rules is the drift the metric contract exists to
  // prevent; they cannot be merged (one runs in Postgres) so they are pinned together.
  assert.match(source, /AND pc\.lifetime_orders > 1 THEN 'new_repeat'/);
  assert.match(source, /AND NOT COALESCE\(pc\.ordered_before, FALSE\) THEN 'new'/);
  assert.match(source, /WHEN pc\.orders_current > 0\s+THEN 'active_repeat'/);
  // The SQL interpolates the SAME exported constants the JS classifier reads, so the two
  // cannot drift apart by someone editing one threshold. A literal here would be the
  // third copy of a rule that already has two implementations.
  assert.match(source, /\$\{CUSTOMER_SEGMENT_RULES\.dormantAfterDays\} THEN 'dormant'/);
  assert.match(source, /\$\{CUSTOMER_SEGMENT_RULES\.atRiskAfterDays\}\s+THEN 'at_risk'/);
  assert.match(source, /ELSE 'recent'/);

  const caseArm = source.match(/CASE\s+WHEN pc\.orders_current[\s\S]*?END AS segment/)?.[0] || "";
  assert.ok(caseArm, "the segmentation CASE must be findable");
  assert.ok(
    !new RegExp(`>=\\s*(${CUSTOMER_SEGMENT_RULES.atRiskAfterDays}|${CUSTOMER_SEGMENT_RULES.dormantAfterDays})\\b`).test(caseArm),
    "the thresholds must be interpolated from the rules, never written as literals"
  );

  // And an unexpected class is reported as a defect rather than rendered as a mystery row.
  assert.match(source, /CUSTOMER_SEGMENT_UNCLASSIFIED/);
});

/* --------------------------------------------------------------- metrics */

test("money is the canonical order revenue, never the denormalised customer column", async () => {
  const source = await read(SERVICE);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.match(source, /basis: \{ revenue: "canonical_order_revenue"/);
  assert.match(source, /\$\{revenue\}\s+AS revenue/, "the canonical revenue expression drives every figure");

  // The denormalised column is READ exactly once, and only to be compared against the
  // canonical total so a drifting cache is reported rather than trusted.
  const uses = code.split("c.total_spent").length - 1;
  assert.equal(uses, 1, `customers.total_spent must be read only for the divergence check, found ${uses} uses`);
  assert.match(source, /denormalised_total_spent/, "and its one read is named for what it is");
  assert.match(source, /CUSTOMER_TOTALS_DIVERGENCE/);
  assert.ok(TOTALS_DIVERGENCE_TOLERANCE > 0 && TOTALS_DIVERGENCE_TOLERANCE < 0.1);

  assert.ok(!code.includes("c.total_orders"), "the denormalised order count must not be read either");
});

test("walk-in sales are excluded and their absence is declared", async () => {
  const source = await read(SERVICE);
  // A POS sale with no customer record is real revenue but is not a customer, so it
  // cannot appear in a per-customer figure. Dropping it silently would leave the page
  // disagreeing with the Executive Overview for no visible reason.
  assert.match(source, /orderClauses\.push\("o\.customer_id IS NOT NULL"\)/);
  assert.match(source, /WALK_IN_ORDERS_EXCLUDED/);
  assert.match(source, /excludedWalkIns: \{ orders: walkinOrders/);
});

test("dimensions and sorts are closed allowlists", async () => {
  assert.deepEqual(CUSTOMER_DIMENSIONS, ["segment", "tier", "channel", "branch"]);
  assert.ok(CUSTOMER_DIMENSIONS.includes(DEFAULT_CUSTOMER_DIMENSION));
  assert.ok(CUSTOMER_SORTS[DEFAULT_CUSTOMER_SORT]);

  const source = await read(SERVICE);
  assert.match(source, /CUSTOMER_SORTS\[filters\.sort\] \|\| CUSTOMER_SORTS\[DEFAULT_CUSTOMER_SORT\]/);
  assert.ok(!/ORDER BY \$\{filters\./.test(source), "no request value reaches ORDER BY directly");
  assert.match(source, /CUSTOMER_DIMENSIONS\.includes\(filters\.dimension\)/);
});

test("both segmentations are published, because they disagree", async () => {
  const source = await read(SERVICE);
  assert.match(source, /segmentation: "orders_not_loyalty_tier"/);
  assert.match(source, /tiers: \(row\.tiers \|\| \[\]\)\.map/);
  // The tier rows carry a lapsed count, which is the whole point: a Gold customer who
  // stopped buying is invisible to either segmentation alone.
  assert.match(source, /lapsed: toFiniteNumber\(entry\.lapsed\)/);
  assert.match(source, /FILTER \(WHERE sg\.segment = ANY\(ARRAY\['at_risk','dormant'\]\)\)\s+AS lapsed/);
});

/* ------------------------------------------------------------ highlights */

test("highlights state facts already in the payload and carry their evidence", () => {
  const segments = [
    { segment: "new", customers: 4, revenue: 1200, orders: 4 },
    { segment: "new_repeat", customers: 6, revenue: 9000, orders: 20 },
    { segment: "at_risk", customers: 9, revenue: 0, orders: 0 },
    { segment: "dormant", customers: 12, revenue: 0, orders: 0 },
  ];
  const highlights = buildCustomerHighlights({
    segments, activeCurrent: 10, activePrevious: 25, returningCurrent: 6, revenueCurrent: 10200,
  });
  const codes = highlights.map((entry) => entry.code);

  assert.ok(codes.includes("LAPSED_EXCEEDS_ENGAGED"), "21 lapsed against 10 engaged is the headline");
  assert.ok(codes.includes("AT_RISK_CUSTOMERS"));
  assert.ok(codes.includes("NEW_CUSTOMERS_WON"));
  assert.ok(codes.includes("ACTIVE_BASE_SHRINKING"));

  const won = highlights.find((entry) => entry.code === "NEW_CUSTOMERS_WON");
  assert.equal(won.values.customers, 10, "both new segments count as won");
  assert.equal(won.values.alreadyRepeated, 6);

  for (const highlight of highlights) {
    assert.ok(highlight.messageKey, "wording is resolved in the bundle");
    assert.ok(highlight.values && Object.keys(highlight.values).length);
  }
});

test("a shrinking base is a warning and a growing one is not", () => {
  const segments = [{ segment: "active_repeat", customers: 10, revenue: 500, orders: 10 }];
  const shrinking = buildCustomerHighlights({ segments, activeCurrent: 10, activePrevious: 20, returningCurrent: 10, revenueCurrent: 500 });
  assert.equal(shrinking.find((entry) => entry.code === "ACTIVE_BASE_SHRINKING")?.severity, "warning");

  const growing = buildCustomerHighlights({ segments, activeCurrent: 20, activePrevious: 10, returningCurrent: 20, revenueCurrent: 500 });
  assert.equal(growing.find((entry) => entry.code === "ACTIVE_BASE_GROWING")?.severity, "info");
});

test("a zero comparison base produces no growth verdict", () => {
  const segments = [{ segment: "new", customers: 5, revenue: 500, orders: 5 }];
  const highlights = buildCustomerHighlights({ segments, activeCurrent: 5, activePrevious: 0, returningCurrent: 0, revenueCurrent: 500 });
  const codes = highlights.map((entry) => entry.code);
  assert.ok(!codes.includes("ACTIVE_BASE_GROWING"), "growth against nothing is not growth");
});

test("no repeat purchases at all is flagged, but only when there was trade", () => {
  const traded = buildCustomerHighlights({
    segments: [{ segment: "new", customers: 8, revenue: 4000, orders: 8 }],
    activeCurrent: 8, activePrevious: null, returningCurrent: 0, revenueCurrent: 4000,
  });
  assert.ok(traded.map((entry) => entry.code).includes("NO_REPEAT_PURCHASES"));

  const quiet = buildCustomerHighlights({
    segments: [], activeCurrent: 0, activePrevious: null, returningCurrent: 0, revenueCurrent: 0,
  });
  assert.ok(!quiet.map((entry) => entry.code).includes("NO_REPEAT_PURCHASES"), "a dead period is not a retention failure");
});

/* --------------------------------------------------------------- wiring */

test("a failure is a 500 that names the area, and the route is permission gated", async () => {
  const controller = await read("../../server/controllers/analyticsV2Controller.js");
  assert.match(controller, /analyticsHandler\("customers", name, "CUSTOMERS_QUERY_FAILED", run\)/);

  const routes = await read("../../server/routes/analyticsV2.js");
  for (const path of ["/customers/summary", "/customers/breakdown", "/customers/list"]) {
    assert.match(routes, new RegExp(`router\\.get\\("${path}", protect, viewReports,`), `${path} must require reports:view`);
  }

  const app = await read("../../src/App.jsx");
  const index = app.indexOf('path="reports/customers"');
  assert.ok(index > 0, "the route must exist");
  assert.match(app.slice(index, index + 260), /ProtectedRoute requiredPermissions=\{\["reports\.view"\]\}/);
});

/* --------------------------------------------------------- returns are netted */

test("customer revenue is net of returns, on the same basis as the Executive Overview", async () => {
  const source = await read(SERVICE);

  // Found by the reconciliation harness: customer revenue was gross of refunds while the
  // Overview's net sales was net of them, so the two screens disagreed by exactly the
  // returns total — 17,850 at 90d and 19,800 at 365d on the development data — and
  // neither page said why.
  assert.match(source, /customer_returns AS \(/, "returns must be aggregated per customer");
  assert.match(source, /JOIN returns r ON r\.id = ri\.return_id/);
  assert.match(source, /JOIN orders o  ON o\.id = r\.order_id/);
  assert.match(source, /GROUP BY o\.customer_id/);

  // Netted exactly once, in one CTE, so every downstream figure inherits the same basis
  // rather than each section deciding for itself.
  assert.match(source, /netted AS \(/);
  assert.match(source, /pc\.revenue_current_gross\s+- COALESCE\(cr\.refunded_current, 0\)\s+AS revenue_current/);
  assert.match(source, /pc\.lifetime_revenue_gross - COALESCE\(cr\.refunded_lifetime, 0\)\s+AS lifetime_revenue/);
  assert.match(source, /FROM netted pc/, "the segmentation must read the netted rows");

  // Refunds carry a NaN guard like every other money expression.
  assert.match(source, /nanSafe\(refundExpr\)/);
  // And cancelled or rejected returns are not refunds.
  assert.match(source, /NOT IN \('cancelled','canceled','rejected','void','deleted'\)/);
});

test("the walk-in line is net too, or the identity does not close", async () => {
  const source = await read(SERVICE);
  // customerRevenue + walkInRevenue has to add back up to company net sales. If only one
  // side deducts returns, the two screens disagree by the walk-in refunds.
  assert.match(source, /const walkInRefunds = \(\{ scope, columns \}\) => \{/);
  assert.match(source, /if \(!columns\.returnColumns\.size \|\| !columns\.returnItemColumns\.size\) return "0"/);
  assert.match(source, /AND o\.customer_id IS NULL/);
  assert.match(source, /- \$\{walkInRefunds\(\{ scope, columns \}\)\} AS revenue/);
});

test("a customer may show negative revenue for a period, and is not floored at zero", async () => {
  const source = await read(SERVICE);
  // A refund raised this window against an older order is a real negative for this
  // window. GREATEST(x, 0) here would hide it and break the reconciliation identity.
  assert.ok(
    !/GREATEST\(pc\.revenue_current_gross[^)]*\)/.test(source),
    "the netted revenue must not be floored"
  );
  assert.match(source, /rather than something to floor at zero/, "and the reason must be recorded");
});
