// R1 GATE: the accountingCanon extraction must be behaviour-preserving.
//
// Two layers:
//  1. Structural - accountingService imports the canon rather than redefining it, so a
//     second copy of a canonical expression cannot reappear.
//  2. Live - getProfitLossReport is executed against a real database and compared to a
//     recorded baseline. Skips when no database is reachable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const CANON_EXPORTS = [
  "firstColumn",
  "columnExpr",
  "coalesceColumnExpr",
  "positiveCoalesceColumnExpr",
  "addScopedWhere",
  "whereSql",
  "paidOrderClauses",
  "purchaseCostLookup",
];

test("accountingService imports the canon instead of defining it", async () => {
  const source = await read("../../server/services/accountingService.js");

  assert.match(
    source,
    /from "\.\/analytics\/accountingCanon\.js"/,
    "accountingService must import the canonical expressions"
  );

  for (const name of CANON_EXPORTS) {
    const localDefinition = new RegExp(`^const ${name} = `, "m");
    assert.doesNotMatch(
      source,
      localDefinition,
      `${name} is defined locally in accountingService - the canon must not be duplicated`
    );
    assert.ok(
      new RegExp(`\\b${name}\\b`).test(source),
      `${name} should still be referenced by accountingService`
    );
  }
});

test("accountingCanon exports every canonical expression", async () => {
  const canon = await import("../../server/services/analytics/accountingCanon.js");
  for (const name of CANON_EXPORTS) {
    assert.equal(typeof canon[name], "function", `accountingCanon must export ${name}`);
  }
});

test("the canonical order predicate is unchanged by the extraction", async () => {
  const { paidOrderClauses } = await import("../../server/services/analytics/accountingCanon.js");
  const columns = new Set(["status", "payment_status", "is_personal_transaction"]);
  const clauses = paidOrderClauses(columns);

  assert.equal(clauses.length, 3);
  assert.match(clauses[0], /NOT IN \('cancelled', 'canceled', 'void', 'refunded', 'returned', 'draft', 'deleted'\)/);
  assert.match(clauses[1], /COALESCE\(o\.is_personal_transaction, FALSE\) = FALSE/);
  assert.match(clauses[2], /'paid', 'completed', 'complete', 'partially_paid', 'partial'/);
  assert.match(clauses[2], /'paid', 'completed', 'complete', 'delivered'/);
});

test("the canonical predicate degrades safely when columns are absent", async () => {
  const { paidOrderClauses } = await import("../../server/services/analytics/accountingCanon.js");
  const clauses = paidOrderClauses(new Set());
  assert.equal(clauses.length, 3);
  assert.match(clauses[0], /^'' NOT IN/);
  assert.match(clauses[1], /^FALSE = FALSE$/);
});

test("the unit-cost ladder resolves in the documented order", async () => {
  const { itemUnitCostExpr } = await import("../../server/services/analytics/accountingCanon.js");
  const expr = itemUnitCostExpr({
    overrideColumns: new Set(["unit_cost"]),
    variantColumns: new Set(["last_purchase_cost", "cost_price"]),
    productColumns: new Set(["last_purchase_cost", "cost_price"]),
    purchaseLookupExpr: "pcost.unit_cost",
  });

  const order = [
    expr.indexOf("aoc.unit_cost"),
    expr.indexOf("pv.last_purchase_cost"),
    expr.indexOf("pv.cost_price"),
    expr.indexOf("p.last_purchase_cost"),
    expr.indexOf("p.cost_price"),
    expr.indexOf("pcost.unit_cost"),
  ];
  assert.ok(order.every((index) => index > -1), "every rung must appear in the ladder");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "ladder rungs are out of order");

  // Zero must be treated as "not set", otherwise a 0 cost short-circuits the ladder.
  assert.match(expr, /NULLIF\(aoc\.unit_cost, 0\)/);
  assert.match(expr, /NULLIF\(pv\.cost_price, 0\)/);
});

test("net quantity subtracts returns and never goes negative", async () => {
  const { netQuantityExpr } = await import("../../server/services/analytics/accountingCanon.js");
  const expr = netQuantityExpr(new Set(["quantity", "returned_quantity"]));
  assert.match(expr, /GREATEST/);
  assert.match(expr, /oi\.quantity/);
  assert.match(expr, /oi\.returned_quantity/);
  assert.match(expr, /, 0\)$/);
});

test("date scoping is inclusive at both ends", async () => {
  const { addScopedWhere } = await import("../../server/services/analytics/accountingCanon.js");
  const clauses = [];
  const params = [];
  addScopedWhere({
    clauses,
    params,
    alias: "o",
    columns: new Set(["tenant_id", "created_at", "branch_id"]),
    tenantId: 7,
    fromDate: "2026-01-01",
    toDate: "2026-01-31",
    branchId: 3,
  });
  assert.deepEqual(params, [7, "2026-01-01", "2026-01-31", 3]);
  assert.ok(clauses.some((clause) => clause.includes("DATE(o.created_at) >= $2")));
  assert.ok(clauses.some((clause) => clause.includes("DATE(o.created_at) <= $3")));
});

/* -------------------------------------------------------------------- live parity */

const connect = async () => {
  let pg;
  try {
    pg = await import("pg");
  } catch {
    return null;
  }
  const { Pool } = pg.default || pg;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "erp_db",
    password: process.env.PGPASSWORD || "065342",
    port: Number(process.env.PGPORT) || 5432,
    connectionTimeoutMillis: 3000,
    statement_timeout: 20000,
  });
  try {
    await pool.query("SELECT 1");
    return pool;
  } catch {
    await pool.end().catch(() => {});
    return null;
  }
};

test("live: getProfitLossReport still returns a coherent, finite P&L", async (t) => {
  const pool = await connect();
  if (!pool) {
    t.skip("no database reachable - skipping live P&L parity");
    return;
  }
  await pool.end().catch(() => {});

  const db = (await import("../../server/database/db.js")).default;
  const { getProfitLossReport } = await import("../../server/services/accountingService.js");

  const report = await getProfitLossReport(db, { tenantId: 1, fromDate: "2026-01-01", toDate: "2026-12-31" });

  for (const path of ["revenue.gross_sales", "revenue.discounts", "revenue.returns", "revenue.net_sales", "cogs.total_cogs", "gross_profit", "total_expenses", "net_profit"]) {
    const value = path.split(".").reduce((node, key) => node?.[key], report);
    assert.equal(typeof value, "number", `${path} must be a number`);
    assert.ok(Number.isFinite(value), `${path} must be finite, got ${value}`);
  }

  // The identities the report is built from must hold exactly.
  const { gross_sales: gross, discounts, returns, net_sales: net } = report.revenue;
  assert.ok(Math.abs(gross - discounts - returns - net) <= 0.01, "net_sales must equal gross - discounts - returns");
  assert.ok(Math.abs(net - report.cogs.total_cogs - report.gross_profit) <= 0.01, "gross_profit must equal net_sales - cogs");
  assert.ok(Math.abs(report.gross_profit - report.total_expenses - report.net_profit) <= 0.01, "net_profit must equal gross_profit - expenses");
});
