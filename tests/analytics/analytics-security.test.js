// R0.6 - security validation for the two confirmed findings.
//
// F-01  /api/dashboard/* ran on `protect` alone (no authorization).
// F-02  analyticsController.buildCustomerIntelligence did not tenant-scope `customers`,
//       leaking name/phone/email across tenants.
//
// The SQL-shape tests below reproduce the real query text so a regression in the CTE
// scoping fails here rather than in production. A live cross-tenant probe against a
// database is in tests/analytics/analytics-tenant-isolation.db.test.js, which skips
// itself when no database is reachable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/* ------------------------------------------------------------------ F-01 */

const DASHBOARD_ROUTES = [
  "/overview",
  "/sales-trend",
  "/top-products",
  "/low-stock",
  "/live-activity",
  "/branch-performance",
  "/payment-analytics",
  "/hourly-sales",
  "/marketing",
  "/pos-live",
  "/inventory",
  "/ai-insights",
];

test("F-01: every /api/dashboard route is authorization-gated, not just authenticated", async () => {
  const source = await read("../../server/routes/dashboard.js");

  assert.match(
    source,
    /import permit from "\.\.\/middleware\/permissionMiddleware\.js"/,
    "dashboard routes must import the permission middleware"
  );
  assert.match(
    source,
    /permit\(\s*"dashboard"\s*,\s*"view"\s*\)/,
    "dashboard routes must be gated on dashboard:view"
  );

  const unguarded = [];
  for (const route of DASHBOARD_ROUTES) {
    // Capture the full router.get(...) call for this route.
    const pattern = new RegExp(`router\\.get\\(\\s*"${route.replace(/[/-]/g, "\\$&")}"\\s*,([^;]*?)\\)\\s*;`, "s");
    const match = source.match(pattern);
    assert.ok(match, `route ${route} is missing from server/routes/dashboard.js`);
    const middleware = match[1];
    const guarded = /viewDashboard|permit\(\s*"dashboard"/.test(middleware);
    if (!guarded) unguarded.push(route);
  }

  assert.deepEqual(
    unguarded,
    [],
    `these dashboard routes expose tenant financial data with no authorization: ${unguarded.join(", ")}`
  );
});

test("F-01: dashboard:view is seeded and backfilled so the gate does not revoke existing access", async () => {
  const source = await read("../../server/middleware/permissionMiddleware.js");

  assert.match(
    source,
    /const CORE_PERMISSIONS = \[\s*\[\s*"dashboard"\s*,\s*"view"\s*\]/,
    "dashboard:view must be seeded through CORE_PERMISSIONS"
  );
  assert.match(
    source,
    /p\.module = 'dashboard'\s*\n\s*AND p\.action = 'view'/,
    "a role_permissions backfill for dashboard:view must exist"
  );
  // The backfill must be one-shot, otherwise revoking the permission is impossible:
  // it would be re-granted on the next process start.
  assert.match(
    source,
    /permissions\.dashboard_view_backfilled/,
    "the dashboard:view backfill must be guarded by a one-shot sentinel so admins can revoke it"
  );
});

test("F-01: dashboard.view exists in the frontend permission matrix (backend/matrix parity)", async () => {
  const source = await read("../../src/modules/permissions/lib/rbacStore.js");
  assert.match(source, /dashboard:\s*\["view"\]/, "MODULE_ACTIONS.dashboard must expose 'view'");
});

/* ------------------------------------------------------------------ F-02 */

test("F-02: customer-intelligence scopes customers and order_items to the caller's tenant", async () => {
  const source = await read("../../server/controllers/analyticsController.js");

  const start = source.indexOf("const buildCustomerIntelligence");
  assert.ok(start > -1, "buildCustomerIntelligence not found");
  const body = source.slice(start, source.indexOf("\nexport async function", start));

  // The customers CTE must be scoped in its own right. Scoping only the LEFT JOIN to
  // orders leaves foreign-tenant customer rows in the output with zero totals.
  assert.match(
    body,
    /customerTenantClause/,
    "the customer_sales CTE must apply a tenant clause to `customers`"
  );
  assert.match(
    body,
    /WHERE c\.tenant_id = \$1/,
    "the customers tenant clause must filter c.tenant_id"
  );
  assert.match(
    body,
    /itemTenantClause/,
    "the product_mix CTE must apply a tenant clause to `order_items`"
  );
  assert.match(
    body,
    /WHERE oi\.tenant_id = \$1/,
    "the order_items tenant clause must filter oi.tenant_id"
  );

  // Super-admin callers (tenantId === null) stay intentionally unscoped.
  assert.match(
    body,
    /tenantId === null \|\| tenantId === undefined \? "" :/,
    "the tenant clause must be omitted only for unscoped super-admin callers"
  );

  // Regression guard: the customers CTE must not rely on the join clause alone.
  const customerCte = body.slice(body.indexOf("WITH customer_sales AS"), body.indexOf("product_mix AS"));
  assert.ok(
    /\$\{customerTenantClause\}/.test(customerCte),
    "customer_sales CTE lost its tenant clause"
  );
});

test("F-02: no analytics query returns customer contact details without a tenant clause", async () => {
  const source = await read("../../server/controllers/analyticsController.js");

  // Any CTE/select that projects phone or email must sit in a function that also
  // builds a tenant clause for its base table.
  const selectsContact = /c\.phone,\s*\n\s*c\.email/.test(source);
  if (selectsContact) {
    assert.match(
      source,
      /customerTenantClause/,
      "a query projects customer phone/email but no customer tenant clause exists in this file"
    );
  }
});

/* ------------------------------------------------ F-03: the shape that keeps recurring */

/**
 * Every read of `orders` in the v2 layer must be tenant-scoped.
 *
 * This has now escaped twice in one day, both times in a subquery rather than a main
 * query, because a subquery does not inherit the outer scope and nothing was checking:
 *
 *   - R9's refunds CTE aggregated `return_items -> returns -> orders` with no tenant
 *     clause on the original order, so one shop's seller totals absorbed every shop's
 *     refunds.
 *   - The first cut of exchangeOriginalReversedExpr looked up `orders orig` by an id
 *     taken from the request body, with no tenant comparison.
 *
 * Neither would have been caught by a main-query test. So this sweeps every `FROM orders`
 * in the layer and demands one of three things: a literal tenant comparison, an
 * interpolated WHERE built elsewhere, or an interpolated clause list — and then checks
 * that every such builder in the file does in fact push a tenant clause.
 */
test("F-03: every read of orders in the analytics layer is tenant-scoped", async () => {
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../../server/services/analytics/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".js"));
  assert.ok(files.length >= 8, `expected the analytics service layer, found ${files.length} files`);

  let checked = 0;
  for (const file of files) {
    const raw = await read(`../../server/services/analytics/${file}`);
    // Strip comments first. A comment explaining the tenant rule sits within a few lines
    // of the query it explains, so it satisfies a naive keyword search — which is exactly
    // how a mutation that deleted the real clause survived the first cut of this test.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

    for (const match of source.matchAll(/FROM\s+orders\s+(\w+)/gi)) {
      const window = source.slice(match.index, match.index + 320);

      // 1. The column itself appears in the SQL — `o.tenant_id = $1`, or `${alias}.tenant_id`.
      //    Matching the COLUMN, not the word: a variable merely NAMED `tenant` satisfies a
      //    keyword search while holding an empty string, which is how the first cut of this
      //    test survived a mutation that deleted the clause.
      if (/\.tenant_id/.test(window)) { checked += 1; continue; }

      // 2. A WHERE built by the shared scope resolver, which is tested on its own.
      if (/\$\{[\w.]*[Ww]here[\w.]*\}/.test(window)) { checked += 1; continue; }

      // 3. Any other interpolated scope — a clause list, a fragment — is only a scope if
      //    its own declaration in this file pushes a tenant clause.
      const interpolations = [...window.matchAll(/\$\{(\w+)[\s\S]{0,24}?\}/g)].map((m) => m[1]);
      const resolved = interpolations.some((name) =>
        new RegExp(`const ${name} =[\\s\\S]{0,900}?tenant_id`).test(source)
      );
      assert.ok(
        resolved,
        `${file}: "${match[0]}" is scoped by nothing that resolves to a tenant clause ` +
          `(interpolations seen: ${interpolations.join(", ") || "none"})`
      );
      checked += 1;
    }
  }

  assert.ok(checked >= 10, `expected to sweep the order reads, only saw ${checked}`);
});

/**
 * The returns join, specifically.
 *
 * `returns -> orders` is where the R9 leak lived, and it is the join most likely to be
 * written without a tenant clause, because the tenant belongs to the ORDER rather than to
 * the return being aggregated. Every one of these must carry a tenant fragment, and the
 * fragment must resolve to something that names the column.
 */
test("F-03: every returns-to-orders join carries a tenant fragment that resolves", async () => {
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../../server/services/analytics/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".js"));

  let checked = 0;
  for (const file of files) {
    const raw = await read(`../../server/services/analytics/${file}`);
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

    for (const match of source.matchAll(/JOIN\s+orders\s+(\w+)\s+ON\s+\1\.id\s*=\s*r\.order_id/gi)) {
      const window = source.slice(match.index, match.index + 260);
      const fragments = [...window.matchAll(/\$\{(?:scope\.)?(\w+)\}/g)].map((m) => m[1]);
      const tenantish = fragments.filter((name) => /tenant/i.test(name));
      assert.ok(
        tenantish.length,
        `${file}: a returns-to-orders join with no tenant fragment at all — ` +
          `fragments seen: ${fragments.join(", ") || "none"}`
      );
      // And the fragment has to be built from the column, not merely named after it.
      // Resolved through one level of indirection, because the overview builds its
      // fragments with a shared `tenantClause(alias, columns)` helper rather than inline.
      const resolves = tenantish.some((name) => {
        const direct = new RegExp(`${name}\\s*[:=][\\s\\S]{0,200}?tenant_id`).test(source);
        if (direct) return true;
        const viaHelper = new RegExp(`${name}\\s*[:=]\\s*(\\w+)\\(`).exec(source);
        return Boolean(viaHelper) &&
          new RegExp(`(const|function)\\s+${viaHelper[1]}[\\s\\S]{0,300}?tenant_id`).test(source);
      });
      assert.ok(resolves, `${file}: ${tenantish.join("/")} is named for the tenant but never built from tenant_id`);
      checked += 1;
    }
  }

  assert.ok(checked >= 4, `expected the returns joins, only saw ${checked}`);
});

test("F-03: the two subqueries that escaped are pinned individually", async () => {
  const employees = await read("../../server/services/analytics/analyticsEmployeesService.js");
  // The refund inherits the ORIGINAL order's tenant, not the return's.
  assert.match(employees, /const refundTenant = scope\.tenantScoped && columns\.orderColumns\.has\("tenant_id"\)/);
  assert.match(employees, /WHERE \$\{refundTenant\}\$\{returnStatus\}/);

  const metrics = await read("../../server/services/analytics/analyticsMetrics.js");
  // original_order_id is an unconstrained bigint arriving from a request body.
  assert.match(metrics, /AND orig\.tenant_id = \$\{alias\}\.tenant_id/);
});
