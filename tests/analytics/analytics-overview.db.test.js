// R2 — live behaviour of the overview endpoint against a real database.
// Covers tenant isolation, date filtering, contract exclusions and the query budget.
// Skips when no database is reachable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const reachable = async () => {
  try {
    const pg = await import("pg");
    const { Pool } = pg.default || pg;
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || undefined,
      user: process.env.PGUSER || "postgres",
      host: process.env.PGHOST || "localhost",
      database: process.env.PGDATABASE || "erp_db",
      password: process.env.PGPASSWORD || "065342",
      port: Number(process.env.PGPORT) || 5432,
      connectionTimeoutMillis: 3000,
    });
    await pool.query("SELECT 1");
    await pool.end();
    return true;
  } catch {
    return false;
  }
};

const load = async () => {
  const filters = await import("../../server/services/analytics/analyticsFilters.js");
  const service = await import("../../server/services/analytics/analyticsOverviewService.js");
  const scope = await import("../../server/services/analytics/analyticsScope.js");
  return { ...filters, ...service, ...scope };
};

const FULL = { view: true, cost: true, profit: true };
const WIDE = { from: "2026-01-01", to: "2026-12-31" };

test("live: overview runs in exactly four queries and returns a coherent payload", async (t) => {
  if (!(await reachable())) return t.skip("no database reachable");
  const { parseAnalyticsFilters, getExecutiveOverview } = await load();

  const filters = parseAnalyticsFilters({ query: WIDE, user: { tenant_id: 1 } });
  const payload = await getExecutiveOverview({ filters, permissions: FULL });

  assert.deepEqual(Object.keys(payload.meta.timings).sort(), ["categories", "context", "orders", "paymentMix"]);
  assert.equal(typeof payload.data.kpis.netSales.current, "number");
  assert.ok(Number.isFinite(payload.data.kpis.netSales.current), "net sales must be finite - NaN must never survive");
  assert.ok(Array.isArray(payload.data.trend));
  assert.ok(Array.isArray(payload.data.highlights));

  // Guards against a pathological plan, not against a performance target. The whole
  // test suite runs in parallel against one Postgres with PG_POOL_MAX=10, so this
  // number includes pool queueing and a tight budget here flakes. Real performance is
  // measured with EXPLAIN (ANALYZE) against production — see the R2.5 findings.
  const STATEMENT_TIMEOUT_MS = 15000;
  for (const [name, ms] of Object.entries(payload.meta.timings)) {
    assert.ok(
      ms < STATEMENT_TIMEOUT_MS * 0.8,
      `${name} query took ${ms}ms, approaching the ${STATEMENT_TIMEOUT_MS}ms statement timeout`
    );
  }
});

test("live: a caller without reports:cost receives no cost or profit number", async (t) => {
  if (!(await reachable())) return t.skip("no database reachable");
  const { parseAnalyticsFilters, getExecutiveOverview, assertNoRestrictedFields } = await load();

  const filters = parseAnalyticsFilters({ query: WIDE, user: { tenant_id: 1 } });
  const payload = await getExecutiveOverview({
    filters,
    permissions: { view: true, cost: false, profit: false },
  });

  const leaked = assertNoRestrictedFields(payload.data, { cost: false, profit: false });
  assert.deepEqual(leaked, [], `restricted values reached the payload: ${leaked.join(", ")}`);
  assert.equal(payload.meta.cogsCoverage, null);
  assert.equal(payload.data.kpis.netSales.current !== null, true, "non-financial KPIs stay visible");
});

test("live: results are tenant-scoped", async (t) => {
  if (!(await reachable())) return t.skip("no database reachable");
  const { parseAnalyticsFilters, getExecutiveOverview } = await load();

  const tenantOne = await getExecutiveOverview({
    filters: parseAnalyticsFilters({ query: WIDE, user: { tenant_id: 1 } }),
    permissions: FULL,
  });
  // A tenant with no data must report verified zeros, not another tenant's numbers.
  const tenantGhost = await getExecutiveOverview({
    filters: parseAnalyticsFilters({ query: WIDE, user: { tenant_id: 987654321 } }),
    permissions: FULL,
  });

  assert.ok(tenantOne.data.kpis.orders.current > 0, "fixture tenant should have orders");
  assert.equal(tenantGhost.data.kpis.orders.current, 0);
  assert.equal(tenantGhost.data.kpis.netSales.current, 0);
  assert.notEqual(tenantOne.data.kpis.netSales.current, tenantGhost.data.kpis.netSales.current);
});

test("live: the date filter actually narrows the result", async (t) => {
  if (!(await reachable())) return t.skip("no database reachable");
  const { parseAnalyticsFilters, getExecutiveOverview } = await load();

  const wide = await getExecutiveOverview({
    filters: parseAnalyticsFilters({ query: WIDE, user: { tenant_id: 1 } }),
    permissions: FULL,
  });
  const narrow = await getExecutiveOverview({
    filters: parseAnalyticsFilters({ query: { from: "2026-06-01", to: "2026-06-02" }, user: { tenant_id: 1 } }),
    permissions: FULL,
  });

  assert.ok(narrow.data.kpis.orders.current <= wide.data.kpis.orders.current);
  assert.equal(narrow.data.period.from, "2026-06-01");
  assert.equal(narrow.data.period.granularity, "hour", "a 2-day window buckets by hour");
});

test("live: v2 excludes what the contract says it excludes", async (t) => {
  if (!(await reachable())) return t.skip("no database reachable");
  const pg = await import("pg");
  const { Pool } = pg.default || pg;
  const pool = new Pool({
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "erp_db",
    password: process.env.PGPASSWORD || "065342",
    port: Number(process.env.PGPORT) || 5432,
    connectionTimeoutMillis: 3000,
  });

  try {
    const { parseAnalyticsFilters, getExecutiveOverview } = await load();
    const payload = await getExecutiveOverview({
      filters: parseAnalyticsFilters({ query: WIDE, user: { tenant_id: 1 } }),
      permissions: FULL,
    });

    // Count orders that the v2 predicate should have kept.
    const expected = await pool.query(`
      SELECT COUNT(*)::int AS n FROM orders o
      WHERE o.tenant_id = 1
        AND o.created_at >= '2026-01-01'::date AND o.created_at < ('2026-12-31'::date + INTERVAL '1 day')
        AND LOWER(COALESCE(o.status,'')) NOT IN ('cancelled','canceled','void','refunded','returned','draft','deleted')
        AND LOWER(COALESCE(o.status,'')) NOT LIKE '%draft%'
        AND o.deleted_at IS NULL
        AND COALESCE(o.is_personal_transaction, FALSE) = FALSE
        AND (LOWER(COALESCE(o.payment_status,'')) IN ('paid','completed','complete','partially_paid','partial')
             OR LOWER(COALESCE(o.status,'')) IN ('paid','completed','complete','delivered'))
    `);

    assert.equal(
      payload.data.kpis.orders.current,
      expected.rows[0].n,
      "order count must match the v2 canonical predicate exactly"
    );

    // And that it really is narrower than the naive count.
    const naive = await pool.query(`
      SELECT COUNT(*)::int AS n FROM orders o
      WHERE o.tenant_id = 1
        AND o.created_at >= '2026-01-01'::date AND o.created_at < ('2026-12-31'::date + INTERVAL '1 day')
    `);
    assert.ok(
      payload.data.kpis.orders.current < naive.rows[0].n,
      "v2 must exclude cancelled/draft/personal/soft-deleted orders"
    );
  } finally {
    await pool.end().catch(() => {});
  }
});

// An exchange only double-counts when the order it replaced was never returned. The POS
// creates the return first, so the original is already out of scope and the exchange
// contributes in full. See docs/analytics/legacy-defects.md D-03.
test("live: the unreversed-cost warning tracks orphan exchanges, not every exchange", async (t) => {
  if (!(await reachable())) return t.skip("no database reachable");
  const pg = await import("pg");
  const { Pool } = pg.default || pg;
  const pool = new Pool({
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "erp_db",
    password: process.env.PGPASSWORD || "065342",
    port: Number(process.env.PGPORT) || 5432,
    connectionTimeoutMillis: 3000,
  });

  try {
    const exchange = await pool.query(`
      SELECT
        COUNT(*)::int AS n,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM orders orig
          WHERE orig.id = e.original_order_id AND orig.tenant_id = e.tenant_id
            AND (orig.returned_at IS NOT NULL OR LOWER(COALESCE(orig.status, '')) IN ('returned', 'refunded'))
        ))::int AS orphans
      FROM orders e WHERE e.tenant_id = 1 AND COALESCE(e.exchange_mode, FALSE)
    `);
    if (!exchange.rows[0].n) return t.skip("no exchange orders in this dataset");

    const { parseAnalyticsFilters, getExecutiveOverview } = await load();
    const payload = await getExecutiveOverview({
      filters: parseAnalyticsFilters({ query: WIDE, user: { tenant_id: 1 } }),
      permissions: FULL,
    });

    const disclosed = payload.warnings.some((warning) => warning.code === "EXCHANGE_COGS_UNREVERSED");
    if (Number(exchange.rows[0].orphans) > 0) {
      assert.ok(disclosed, "an exchange whose original is still a live sale must be disclosed");
    } else {
      assert.ok(!disclosed, "warning on a correctly reversed exchange would be crying wolf");
    }
  } finally {
    await pool.end().catch(() => {});
  }
});

/*
 * R2 bound its four queries by slicing the shared parameter list to the highest index
 * each statement referenced. That is only correct while the referenced indexes form an
 * unbroken prefix. Any order filter binds AFTER the comparison window, so the category
 * and payment-mix queries — which never mention the comparison — were handed $4 and $5
 * and Postgres refused the request outright: "could not determine data type of
 * parameter $5". Every filtered overview with a comparison period, which is the UI's
 * default, was a 500. This is the regression test for that, and it needs a database:
 * the failure is in the bind, so no amount of pure-function testing can see it.
 */
test("live: a filtered overview with a comparison period still answers", async (t) => {
  if (!(await reachable())) return t.skip("no database reachable");
  const { parseAnalyticsFilters, getExecutiveOverview } = await load();

  for (const filter of [{ branchId: 5 }, { channel: "pos" }, { paymentMethod: "cash" }, { channel: "pos", paymentMethod: "cash" }]) {
    const filters = parseAnalyticsFilters({
      query: { ...WIDE, ...filter, compare: "previous_period" },
      user: { tenant_id: 1 },
    });
    const payload = await getExecutiveOverview({ filters, permissions: FULL });
    assert.equal(typeof payload.data.kpis.netSales.current, "number", `${JSON.stringify(filter)} must return a figure`);
    assert.ok(payload.data.paymentMix, `${JSON.stringify(filter)} must return a payment mix`);
  }
});

test("the parameter binder renumbers rather than slicing", async () => {
  const source = await readFile(new URL("../../server/services/analytics/analyticsOverviewService.js", import.meta.url), "utf8");
  assert.match(source, /densifyParams\(sql, params\)/, "the shared binder is the one used");
  assert.ok(!/params\.slice\(0, highest\)/.test(source), "slicing leaves the hole this bug was made of");
});
