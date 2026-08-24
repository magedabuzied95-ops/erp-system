// R9 — Employee & Channel Intelligence.
//
// The load-bearing thing here is attribution. `orders` has six candidate seller columns,
// the frozen contract's declared first choice is empty on production, and the two ID
// columns point at a table with no rows. A page built on an assumed precedence would
// report every order as unattributed while the data plainly says otherwise.
//
// So these tests pin the rule that replaced the assumption: choose by MEASURED coverage,
// say which column was chosen, and never redistribute what could not be attributed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ATTRIBUTION_FLOOR,
  DEFAULT_EMPLOYEE_DIMENSION,
  DEFAULT_EMPLOYEE_SORT,
  EMPLOYEE_DIMENSIONS,
  EMPLOYEE_SORTS,
  SELLER_CANDIDATES,
  UNATTRIBUTED_KEY,
  buildEmployeeHighlights,
  buildSellerConcentration,
  resolveAttribution,
} from "../../server/services/analytics/analyticsEmployeesService.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const SERVICE = "../../server/services/analytics/analyticsEmployeesService.js";

/* ------------------------------------------------------------- attribution */

/** A client that answers the one coverage query with a canned row. */
const fakeClient = (row) => ({ query: async () => ({ rows: [row] }) });

const columnsWith = (orderCols, { users = 1, salesEmployees = 1 } = {}) => ({
  orderColumns: new Set(orderCols),
  itemColumns: new Set(["quantity", "returned_quantity", "order_id"]),
  userColumns: new Set(users ? ["id", "name"] : []),
  salesEmployeeColumns: new Set(salesEmployees ? ["id", "name"] : []),
  branchColumns: new Set(["id", "name"]),
  returnColumns: new Set(["id", "order_id", "status", "created_at"]),
  returnItemColumns: new Set(["id", "return_id", "refund_amount"]),
});

const filters = { tenantId: 1, from: "2026-01-01", to: "2026-03-31", branchId: null, channel: null };

test("the field is chosen by coverage, not by the declared order", async () => {
  // salesperson_name is declared FIRST but covers less. seller_name must win, because a
  // preference order is a tie-breaker here and never a substitute for measuring.
  const attribution = await resolveAttribution({
    client: fakeClient({ total: 100, salesperson_name: 12, seller_name: 89, seller_user_id: 0, sales_employee_id: 0, salesperson_id: 0 }),
    filters,
    columns: columnsWith(["tenant_id", "created_at", "salesperson_name", "seller_name", "seller_user_id", "sales_employee_id", "salesperson_id"]),
  });

  assert.equal(attribution.field, "seller_name");
  assert.equal(attribution.attributedOrders, 89);
  assert.ok(Math.abs(attribution.coverage - 0.89) < 1e-9);
});

test("a tie is broken by the declared order, so the choice is stable", async () => {
  const attribution = await resolveAttribution({
    client: fakeClient({ total: 100, salesperson_name: 50, seller_name: 50 }),
    filters,
    columns: columnsWith(["tenant_id", "created_at", "salesperson_name", "seller_name"]),
  });
  assert.equal(attribution.field, "salesperson_name", "the earlier declared candidate wins an exact tie");
});

test("a column that exists and is empty attributes nothing and cannot win", async () => {
  // This is the production case exactly: seller_user_id exists, and is empty.
  const attribution = await resolveAttribution({
    client: fakeClient({ total: 572, salesperson_name: 510, seller_name: 510, seller_user_id: 0, sales_employee_id: 0, salesperson_id: 0 }),
    filters,
    columns: columnsWith(["tenant_id", "created_at", "salesperson_name", "seller_name", "seller_user_id", "sales_employee_id", "salesperson_id"]),
  });
  assert.notEqual(attribution.field, "seller_user_id");
  assert.equal(attribution.field, "salesperson_name");

  const empty = attribution.candidates.find((candidate) => candidate.field === "seller_user_id");
  assert.equal(empty.covered, 0, "and the rejected column is still reported, with its zero");
});

test("a join candidate whose target table has no rows is never even considered", async () => {
  // sales_employees is EMPTY on production. An id pointing at nothing is a dangling
  // reference, not attribution, so the candidate is dropped before the query runs.
  const attribution = await resolveAttribution({
    client: fakeClient({ total: 100, salesperson_name: 40 }),
    filters,
    columns: columnsWith(["tenant_id", "created_at", "salesperson_name", "sales_employee_id", "salesperson_id"], { salesEmployees: 0 }),
  });
  const fields = attribution.candidates.map((candidate) => candidate.field);
  assert.ok(!fields.includes("sales_employee_id"));
  assert.ok(!fields.includes("salesperson_id"));
  assert.equal(attribution.field, "salesperson_name");
});

test("nothing populated means no attribution at all, stated as such", async () => {
  const attribution = await resolveAttribution({
    client: fakeClient({ total: 40, salesperson_name: 0, seller_name: 0 }),
    filters,
    columns: columnsWith(["tenant_id", "created_at", "salesperson_name", "seller_name"]),
  });
  assert.equal(attribution.field, null);
  assert.equal(attribution.reason, "NO_POPULATED_CANDIDATE");
});

test("no candidate column at all is reported rather than crashing", async () => {
  const attribution = await resolveAttribution({
    client: fakeClient({ total: 0 }),
    filters,
    columns: columnsWith(["tenant_id", "created_at"]),
  });
  assert.equal(attribution.field, null);
  assert.equal(attribution.reason, "NO_CANDIDATE_COLUMN");
  assert.deepEqual(attribution.candidates, []);
});

test("the coverage probe binds only the parameters it uses", async () => {
  // Reusing the shared scope's parameter list here supplies the comparison window too,
  // which the probe never reads — and Postgres rejects that with 08P01.
  let bound = null;
  await resolveAttribution({
    client: { query: async (_sql, params) => { bound = params; return { rows: [{ total: 10, salesperson_name: 5 }] }; } },
    filters,
    columns: columnsWith(["tenant_id", "created_at", "salesperson_name"]),
  });
  assert.deepEqual(bound, [1, "2026-01-01", "2026-03-31"], "tenant, from, to — and nothing else");
});

test("the probe applies the branch and channel filters the page is showing", async () => {
  let sql = null;
  let bound = null;
  await resolveAttribution({
    client: { query: async (text, params) => { sql = text; bound = params; return { rows: [{ total: 5, salesperson_name: 5 }] }; } },
    filters: { ...filters, branchId: 7, channel: "pos" },
    columns: columnsWith(["tenant_id", "created_at", "branch_id", "channel", "salesperson_name"]),
  });
  assert.match(sql, /o\.branch_id = \$2/);
  assert.match(sql, /LOWER\(COALESCE\(o\.channel,''\)\) = LOWER\(\$3\)/);
  assert.deepEqual(bound, [1, 7, "pos", "2026-01-01", "2026-03-31"]);
});

/* ------------------------------------------------------ withholding and honesty */

test("below the floor the seller breakdown withdraws instead of drawing mostly-unknown", async () => {
  const source = await read(SERVICE);
  assert.ok(ATTRIBUTION_FLOOR > 0 && ATTRIBUTION_FLOOR < 0.5, "the floor must be a real threshold");
  assert.match(source, /const sellerUnusable =\s*\n\s*requested === "seller" && \(!attribution\.field \|\| \(attribution\.coverage \?\? 0\) < ATTRIBUTION_FLOOR\)/);
  assert.match(source, /withheld: true/);
  // Only the seller dimension withdraws. Channel, cashier and branch do not depend on it.
  assert.match(source, /requested === "seller" &&/);
  assert.match(source, /SELLER_ATTRIBUTION_TOO_THIN/);
});

test("unattributed orders are their own bucket and are never redistributed", async () => {
  const source = await read(SERVICE);
  assert.equal(UNATTRIBUTED_KEY, "__unattributed__");
  // The bucket is produced by COALESCE onto a reserved key, so an order without a seller
  // keeps its revenue in a visible row rather than being dropped or shared out.
  assert.match(source, /COALESCE\(no\.seller, '\$\{UNATTRIBUTED_KEY\}'\)/);
  assert.match(source, /SELLER_UNATTRIBUTED_ORDERS/);
  assert.match(source, /unattributed: \{ orders: unattributedOrders/);
  // Nothing anywhere divides the unattributed total across the named sellers.
  assert.ok(!/unattributed[^\n]*\/\s*sellers/i.test(source), "unattributed revenue must never be spread across sellers");
});

test("no per-seller profit is published, because a line carries no seller", async () => {
  const source = await read(SERVICE);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const token of ["grossProfit", "grossMargin", "cogs", "unitCost"]) {
    assert.ok(!code.includes(token), `${token} must not appear: cost is attributable to a line, not a seller`);
  }
  assert.match(source, /profit: "not_attributable_to_a_seller"/);
});

test("no commission or target is re-derived here", async () => {
  const source = await read(SERVICE);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/commission/i.test(code), "commission belongs to the employees module");
  assert.ok(!/target|quota/i.test(code), "no target exists in the schema, so a percentage against one would be invented");
});

/* ------------------------------------------------------------- concentration */

test("seller concentration follows the same rule as supplier concentration", () => {
  assert.equal(buildSellerConcentration([1000], 1000).topShare, null, "one seller is the population, not a concentration");
  assert.equal(buildSellerConcentration([], 0).topShare, null);

  const result = buildSellerConcentration([600, 200, 150, 50], 1000);
  assert.equal(result.sellerCount, 4);
  assert.equal(result.topShare, 0.6);
  assert.ok(Math.abs(result.topThreeShare - 0.95) < 1e-9);
  assert.ok(Math.abs(result.hhi - 0.425) < 1e-9);
});

/* ---------------------------------------------------------------- highlights */

test("with no attribution the only highlight says so", () => {
  const highlights = buildEmployeeHighlights({ attribution: { field: null }, sellerShares: [], attributedRevenue: 0, unattributedRevenue: 0, revenueCurrent: 0, revenuePrevious: null, sellers: 0 });
  assert.deepEqual(highlights.map((entry) => entry.code), ["ATTRIBUTION_UNAVAILABLE"]);
});

test("partial attribution is reported with the money that is unaccounted for", () => {
  const highlights = buildEmployeeHighlights({
    attribution: { field: "salesperson_name", coverage: 0.62 },
    sellerShares: [500, 300], attributedRevenue: 800, unattributedRevenue: 450,
    revenueCurrent: 1250, revenuePrevious: null, sellers: 2,
  });
  const partial = highlights.find((entry) => entry.code === "ATTRIBUTION_PARTIAL");
  assert.ok(partial, "partial coverage must be surfaced");
  assert.equal(partial.values.unattributedValue, 450);
  assert.equal(partial.severity, "info", "above the floor it is information, not a fault");
});

test("coverage below the floor escalates the same highlight to a warning", () => {
  const highlights = buildEmployeeHighlights({
    attribution: { field: "salesperson_name", coverage: 0.05 },
    sellerShares: [10], attributedRevenue: 10, unattributedRevenue: 990,
    revenueCurrent: 1000, revenuePrevious: null, sellers: 1,
  });
  assert.equal(highlights.find((entry) => entry.code === "ATTRIBUTION_PARTIAL").severity, "warning");
});

test("a zero comparison base produces no growth verdict", () => {
  const highlights = buildEmployeeHighlights({
    attribution: { field: "salesperson_name", coverage: 1 },
    sellerShares: [100], attributedRevenue: 100, unattributedRevenue: 0,
    revenueCurrent: 100, revenuePrevious: 0, sellers: 1,
  });
  assert.ok(!highlights.some((entry) => entry.code.startsWith("TEAM_")), "growth against nothing is not growth");
});

test("highlight interpolation keys never collide with the flat comparison fallbacks", async () => {
  const source = await read(SERVICE);
  const values = [...source.matchAll(/values:\s*\{([^}]*)\}/g)].map(([, body]) => body);
  assert.ok(values.length >= 3);
  for (const body of values) {
    for (const reserved of ["percent", "points", "current", "previous"]) {
      assert.ok(!new RegExp(`(^|[\\s{,])${reserved}\\s*:`).test(body), `reserved interpolation key "${reserved}" reused`);
    }
  }
});

/* ------------------------------------------------------------------ contract */

test("dimensions and sorts are closed allowlists", async () => {
  assert.deepEqual(EMPLOYEE_DIMENSIONS, ["seller", "cashier", "channel", "branch"]);
  assert.ok(EMPLOYEE_DIMENSIONS.includes(DEFAULT_EMPLOYEE_DIMENSION));
  assert.ok(EMPLOYEE_SORTS[DEFAULT_EMPLOYEE_SORT]);
  assert.ok(SELLER_CANDIDATES.length >= 5);

  const source = await read(SERVICE);
  assert.match(source, /EMPLOYEE_SORTS\[filters\.sort\] \|\| EMPLOYEE_SORTS\[DEFAULT_EMPLOYEE_SORT\]/);
  assert.ok(!/ORDER BY \$\{filters\./.test(source), "no request value reaches ORDER BY directly");
  assert.match(source, /EMPLOYEE_DIMENSIONS\.includes\(filters\.dimension\)/);
});

test("revenue is net of returns, on the canonical basis", async () => {
  const source = await read(SERVICE);
  // Returns join to an order and an order carries the seller, so the deduction is exact
  // and the seller total reconciles with the Executive Overview.
  assert.match(source, /order_refunds AS \(/);
  assert.match(source, /so\.gross_revenue - COALESCE\(orf\.refunded, 0\)\s+AS revenue/);
  assert.match(source, /revenue: "canonical_order_revenue_net_of_returns"/);
  assert.match(source, /nanSafe\(refundExpr\)/);
});

test("units come from one grouped pass, never an aggregate per order", async () => {
  const source = await read(SERVICE);
  assert.match(source, /order_units AS \(/);
  assert.match(source, /LEFT JOIN order_units ou   ON ou\.order_id = so\.id/);
});

test("the route and endpoints are permission gated", async () => {
  const routes = await read("../../server/routes/analyticsV2.js");
  for (const path of ["/employees/summary", "/employees/breakdown", "/employees/list"]) {
    assert.match(routes, new RegExp(`router\\.get\\("${path}", protect, viewReports,`), `${path} must require reports:view`);
  }
  const controller = await read("../../server/controllers/analyticsV2Controller.js");
  assert.match(controller, /analyticsHandler\("employees", name, "EMPLOYEES_QUERY_FAILED", run\)/);

  const app = await read("../../src/App.jsx");
  const index = app.indexOf('path="reports/employees"');
  assert.ok(index > 0, "the route must exist");
  assert.match(app.slice(index, index + 260), /ProtectedRoute requiredPermissions=\{\["reports\.view"\]\}/);
});

test("the page states the attribution field on screen, not only in the API meta", async () => {
  const page = await read("../../src/modules/reports/pages/EmployeeIntelligence.jsx");
  assert.match(page, /function AttributionBanner/);
  assert.match(page, /employeeAnalytics\.attribution\.using/);
  assert.match(page, /employeeAnalytics\.attribution\.coverage/);
  assert.match(page, /employeeAnalytics\.attribution\.candidates/);
  // The rejected candidates are listed too, so a reader can see what was considered.
  assert.match(page, /attribution\.candidates\?\.length/);
  // And the export carries the statement, or a file read later is unreadable.
  assert.match(page, /t\("employeeAnalytics\.attribution\.using"\), value: attribution\.label/);
});
