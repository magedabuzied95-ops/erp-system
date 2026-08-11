# R0.6 — Security Findings, Validation and Fixes

Both findings were **validated by execution**, not by static inspection alone, and both are **fixed on this branch**.

Evidence database: local development `erp_db` (PostgreSQL 18.3), which happens to hold **8 distinct customer tenant
buckets** (tenant 1 with 25 customers, six `987654xxx` tenants, and 7 rows with `tenant_id IS NULL`) — enough to
demonstrate a genuine cross-tenant leak.

---

## F-01 · `/api/dashboard/*` had no authorization

**Severity:** S3 — unauthorized exposure of tenant financial data.

### Proof

`server/routes/dashboard.js` registered all 12 routes with `protect` only:

```js
router.get("/overview", protect, overview);
router.get("/sales-trend", protect, salesTrend);
…
```

`protect` establishes *authentication*. No `permit(...)` call existed anywhere in the file, so **any authenticated user
of any role** — cashier, sales agent, warehouse staff — could read:

| Endpoint | Exposed |
|---|---|
| `/overview` | today's sales, **profit**, AOV, discounts, units, customers |
| `/sales-trend` | revenue time series |
| `/top-products` | product revenue ranking |
| `/branch-performance` | per-branch revenue |
| `/payment-analytics` | payment-method money split |
| `/hourly-sales` | hourly revenue |
| `/pos-live` | live till/shift money |
| `/inventory`, `/low-stock` | stock valuation |
| `/ai-insights`, `/marketing` | derived financial commentary |

`/overview` in particular returns `today.profit`, computed by `dashboardAnalyticsService.calculateTodayProfit`, which
reads `product_variants.cost_price` and `products.cost_price` — i.e. **purchase costs**. This directly contradicts commit
`7e57272` *"fix(permissions): hide purchase costs from cashiers"*: the cost data that commit removed from the products
screen was still readable through the dashboard API.

### Smallest safe patch

1. `server/routes/dashboard.js` — import `permit` and gate all 12 routes on `permit("dashboard", "view")`.
2. `server/middleware/permissionMiddleware.js` — add `["dashboard", "view"]` to `CORE_PERMISSIONS` so the permission row
   is seeded and granted to admin/super-admin by the existing backfill.
3. A **one-shot** `role_permissions` backfill granting `dashboard:view` to every role that already exists, guarded by a
   `system_settings` sentinel key `permissions.dashboard_view_backfilled`.

`dashboard.view` was already present in the frontend matrix (`rbacStore.js` `MODULE_ACTIONS.dashboard = ["view"]`), so
`tests/permission-matrix-backend-parity.test.js` continues to pass without touching the matrix.

### Why the backfill, and why one-shot

Gating without a backfill would revoke the dashboard from **every non-admin role** the moment this deploys — `permit`
short-circuits only for admin, super-admin and wildcard holders. The backfill preserves today's effective access exactly.

The sentinel makes it run **once**. Without it the grant would be re-inserted on every process start, and an administrator
who revoked `dashboard:view` from a role would silently get it back — the permission would be permanently un-revokable.
Every other backfill in this file has that flaw; the new one deliberately does not.

### Compatibility impact

| Actor | Before | After |
|---|---|---|
| admin / super-admin / wildcard | allowed | allowed (short-circuit, unchanged) |
| any existing role | allowed (no check) | allowed (backfilled grant) |
| **role created after this deploy** | allowed | **denied until granted** — the intended behaviour |
| role whose `dashboard:view` an admin revokes | n/a | **denied**, and stays denied |
| unauthenticated | denied | denied |

Net effect on the running system: **no user loses access on deploy.** The endpoints become revocable and auditable, and
new roles are deny-by-default.

### Follow-up not done here

Field-level masking of cost/profit *within* the dashboard payload (so a role could see order counts but not margin) is
**not** part of this fix — it would be a behavioural change to the dashboard, not a security patch. Analytics v2 does this
properly via `reports:cost` / `reports:profit` (see [`metric-contract.md` §9](./metric-contract.md#9-security-scope-per-metric)).
Recorded as D-09 follow-up.

### Tests

`tests/analytics/analytics-security.test.js`
- asserts each of the 12 routes carries the dashboard guard, listing any that do not;
- asserts `dashboard:view` is seeded **and** backfilled **and** sentinel-guarded;
- asserts matrix parity.

---

## F-02 · `customer-intelligence` leaked customer PII across tenants

**Severity:** S3 — cross-tenant exposure of name, phone and email.

### Proof

`analyticsController.buildCustomerIntelligence` built its tenant clause for alias `o` and then moved it into the join:

```js
const scope = buildWhereClause({ alias: "o", tenantId, … });      // " WHERE o.tenant_id = $1"
const orderJoinClause = scope.where.replace(/^ WHERE\s+/i, " AND "); // " AND o.tenant_id = $1"
…
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id  AND o.tenant_id = $1
GROUP BY c.id, c.name, c.phone, c.email
```

There is **no `WHERE` on `customers`**. The tenant predicate constrains only the joined orders, so every customer row in
the table survives the `LEFT JOIN` — foreign tenants simply arrive with `total_orders = 0`. The endpoint then returns
`customer_name`, `phone`, `email`.

`LIMIT 50` does not save it: foreign rows are only pushed out when the caller's own tenant has 50+ higher-spending
customers.

The `product_mix` CTE had the same defect — `FROM order_items oi` with no tenant clause, scanning every tenant's line items.

**Executed against the dev database as a tenant-1 caller** (`tmp/prove-tenant-leak.mjs`, counts only, no PII printed):

```
### CURRENT (vulnerable) — what the endpoint actually returns (LIMIT 50)
  tenant 1            rows= 25  (own)
  tenant 987654321    rows=  1  <-- FOREIGN / LEAKED
  tenant 987654322    rows=  2  <-- FOREIGN / LEAKED
  tenant 987654323    rows=  3  <-- FOREIGN / LEAKED
  tenant 987654324    rows=  3  <-- FOREIGN / LEAKED
  tenant 987654325    rows=  1  <-- FOREIGN / LEAKED
  tenant 987654326    rows=  2  <-- FOREIGN / LEAKED
  tenant NULL         rows=  7  <-- FOREIGN / LEAKED

### PATCHED — customers scoped in the CTE
  tenant 1            rows= 25  (own)
```

**19 foreign customer records** — 6 other tenants plus 7 unassigned rows — were returned inside the real response shape,
each carrying name, phone and email.

### Smallest safe patch

`server/controllers/analyticsController.js`, `buildCustomerIntelligence` only:

```js
const customerTenantClause = tenantId === null || tenantId === undefined ? "" : "WHERE c.tenant_id = $1";
const itemTenantClause     = tenantId === null || tenantId === undefined ? "" : "WHERE oi.tenant_id = $1";
```
applied to the `customer_sales` and `product_mix` CTEs respectively. No other function touched, no refactor mixed in.

`$1` is always the tenant id when `tenantId` is non-null, because `buildWhereClause` pushes it first. Verified for both
the no-filter and date-filtered parameter layouts.

`tenantId === null` is the super-admin path (`isSuperAdminUser`), which is intentionally unscoped — unchanged.

### Verification

`tmp/verify-patched-sql.mjs` executed the patched template in three configurations:

```
OK   tenant=1, no dates                     -> 1:25
OK   tenant=1, with dates                   -> 1:25
OK   super-admin (tenant=null), no dates    -> 1:25  987654321:1  …  NULL:7
```

SQL parses, parameter alignment holds with date filters present, tenant scoping is enforced, and super-admin behaviour is
preserved.

### Compatibility impact

| Actor | Before | After |
|---|---|---|
| tenant user | own customers **+ every other tenant's** | own customers only |
| super-admin | all customers | all customers (unchanged) |

Row counts drop for tenant users. That is the fix, not a regression — the removed rows were never theirs.

### Tests

- `tests/analytics/analytics-security.test.js` — asserts both CTEs carry a tenant clause and that the super-admin
  exemption is the only unscoped path.
- `tests/analytics/analytics-tenant-isolation.db.test.js` — **live probe**: runs both query shapes against a real
  database, asserts the unscoped shape leaks (so the probe is proving something) and the patched shape does not. Skips
  cleanly when no database is reachable or the dataset is single-tenant.

---

## Not fixed here (deliberately)

| Finding | Why deferred |
|---|---|
| D-18 `/api/reports/export` gated on `reports:view` instead of `reports:export` | Tightening it would break any existing user with view-but-not-export. Analytics v2 uses `reports:export` for its own export route. |
| `getTenantId` honours `x-tenant-id` / `?tenant_id` when `req.user.tenant_id` is null | Not exploitable for a normal user (their own `tenant_id` takes precedence) and changing it touches every controller. Analytics v2 derives tenant from `req.user` only. |
| Field-level cost/profit masking on `/api/dashboard/*` | Behavioural change, not a security patch. Handled properly in v2. |
