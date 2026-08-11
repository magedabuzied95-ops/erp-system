// R0.6 - live cross-tenant probe for F-02.
//
// This does not rely on static inspection: it executes the vulnerable and the patched
// query shapes against a real database and asserts the patched one returns rows for the
// caller's tenant only.
//
// Skips itself when no database is reachable, so CI without Postgres stays green.
// Selects tenant ids and counts only - never names, phones or emails.
import test from "node:test";
import assert from "node:assert/strict";

const CONNECT_TIMEOUT_MS = 3000;

const connect = async () => {
  let Pool;
  try {
    ({ default: { Pool } } = await import("pg").then((mod) => ({ default: mod.default || mod })));
  } catch {
    return null;
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "erp_db",
    password: process.env.PGPASSWORD || "065342",
    port: Number(process.env.PGPORT) || 5432,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: 10000,
  });
  try {
    await pool.query("SELECT 1");
    return pool;
  } catch {
    await pool.end().catch(() => {});
    return null;
  }
};

// Mirrors analyticsController.buildCustomerIntelligence: tenantId set, no date filters.
const ORDER_JOIN_CLAUSE = " AND o.tenant_id = $1";

const cte = (customerTenantClause) => `
  WITH customer_sales AS (
    SELECT c.id AS customer_id, c.tenant_id AS customer_tenant,
           COUNT(o.id)::INT AS total_orders,
           COALESCE(SUM(o.total_amount), 0) AS total_spent,
           MAX(o.created_at) AS last_order_date
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id ${ORDER_JOIN_CLAUSE}
    ${customerTenantClause}
    GROUP BY c.id, c.tenant_id
  )
  SELECT cs.customer_tenant, COUNT(*)::int AS rows_returned
  FROM (
    SELECT * FROM customer_sales
    ORDER BY total_spent DESC, total_orders DESC, last_order_date DESC NULLS LAST
    LIMIT 50
  ) cs
  GROUP BY cs.customer_tenant
`;

const foreignRows = (rows, tenantId) =>
  rows
    .filter((row) => row.customer_tenant === null || Number(row.customer_tenant) !== Number(tenantId))
    .reduce((sum, row) => sum + Number(row.rows_returned || 0), 0);

test("F-02 live probe: patched customer-intelligence returns only the caller's tenant", async (t) => {
  const pool = await connect();
  if (!pool) {
    t.skip("no database reachable - skipping live tenant-isolation probe");
    return;
  }

  try {
    const tenants = await pool.query(
      `SELECT tenant_id, COUNT(*)::int AS n
         FROM customers
        WHERE tenant_id IS NOT NULL
        GROUP BY tenant_id
        ORDER BY n DESC
        LIMIT 1`
    );
    const tenantId = tenants.rows[0]?.tenant_id;
    if (!tenantId) {
      t.skip("no tenant-scoped customers in this database");
      return;
    }

    const distinctTenants = await pool.query(
      `SELECT COUNT(DISTINCT COALESCE(tenant_id, -1))::int AS n FROM customers`
    );
    if (Number(distinctTenants.rows[0]?.n || 0) < 2) {
      t.skip("single-tenant dataset - cross-tenant leak is not observable here");
      return;
    }

    const vulnerable = await pool.query(cte(""), [tenantId]);
    const patched = await pool.query(cte("WHERE c.tenant_id = $1"), [tenantId]);

    const leaked = foreignRows(vulnerable.rows, tenantId);
    const stillLeaking = foreignRows(patched.rows, tenantId);

    // Documents the finding: the unscoped shape must actually leak on this dataset,
    // otherwise this probe is not proving anything.
    assert.ok(
      leaked > 0,
      "expected the unscoped query shape to leak foreign-tenant rows on a multi-tenant dataset"
    );

    assert.equal(
      stillLeaking,
      0,
      `patched query still returned ${stillLeaking} foreign-tenant customer rows`
    );

    const own = patched.rows.filter((row) => Number(row.customer_tenant) === Number(tenantId));
    assert.equal(patched.rows.length, own.length, "patched query returned non-owned tenant buckets");
    assert.ok(own.length === 1 && Number(own[0].rows_returned) > 0, "patched query returned no own-tenant rows");
  } finally {
    await pool.end().catch(() => {});
  }
});
