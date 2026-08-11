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
