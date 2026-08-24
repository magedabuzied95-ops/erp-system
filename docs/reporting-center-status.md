# Reporting Center — status

Living record of what the Reporting Center is, what it deliberately is not, and the
decisions that would otherwise have to be rediscovered from the code.

Last updated 2026-08-24, at `63e31097` — R9 (employees and channels), R10 (reconciliation
screen), the legacy migration, and the financial route guards. Deployed and verified live.

---

## 1. What ships

| Route | Arabic | Phase | Endpoints |
|---|---|---|---|
| `/reports/overview` | النظرة التنفيذية | R2 | `v2/overview` |
| `/reports/sales` | ذكاء المبيعات والأرباح | R3 | `v2/sales/{summary,breakdown,products,sizes}` |
| `/reports/inventory` | ذكاء المخزون | R4 | `v2/inventory/{summary,breakdown,products,sizes}` |
| `/reports/purchasing` | ذكاء المشتريات والموردين | R5 | `v2/purchasing/{summary,breakdown,products,suppliers}` |
| `/reports/customers` | ذكاء العملاء | R6 | `v2/customers/{summary,breakdown,list}` |
| `/reports/employees` | ذكاء الموظفين والقنوات | R9 | `v2/employees/{summary,breakdown,list}` |
| `/reports/reconciliation` | المطابقة | R10 | `v2/reconciliation` |
| `/reports/coupons` | أداء الكوبونات | — | `coupons/reports/performance` |
| `/reports` | التقارير والتحليلات | legacy, notice-bearing | `reports/*` |
| `/analytics` | — | **retired** → `/reports/overview` | — |

All are gated on `reports.view` at the route **and** at the endpoint. Every money figure is
additionally gated on `reports.cost` / `reports.profit`, resolved in `analyticsScope.js`
and applied by omitting the column from the SELECT — a value the caller may not see never
enters the JSON, so it cannot leak through an export either.

Verified live on 2026-08-24: all twenty `v2/*` paths plus the coupons report answer 401,
not 404, with a deliberately bogus path answering 404 as the control.

## 2. What is deliberately NOT built

Each of these was considered and rejected on evidence. Re-adding one means overturning a
decision, not filling a gap.

| Not built | Why |
|---|---|
| Inventory age / FIFO | `purchase_items` carries no remaining quantity and there is no batch or lot layer. Which units remain from which receipt is unknowable, so any age would be invented. First receipt is shown as history and named as such. |
| Supplier lead time | `purchases` records one timestamp. There is no ordered-at versus received-at pair, so elapsed time to delivery is not derivable. |
| Supplier ledger balance in R5 | `suppliers.debt_balance` is the suppliers module's all-time ledger. Folding it into a window-scoped report would create a second definition of what is owed. R5 publishes `unpaidPurchaseValue`, explicitly "total minus paid, on purchases recognised in this window". |
| Reorder recommendations in R5 | `/purchases/reorder-suggestions` already owns BUY_NOW / DO_NOT_BUY and its sell-through rules. Re-deriving them would be a fifth place computing what to buy. |
| Warehouse breakdowns | `warehouse_inventory` accumulates PURCHASE_IN and never decrements on sale, and carries no `tenant_id`. Any warehouse figure would be wrong at source. |
| Customer contact details | A segment report does not need a phone number, and a payload carrying one can be exported and forwarded. Someone who needs to call opens the customer record, where the access is attributable. |
| Forecasts of any kind | No documented model exists. A prediction without one is a fabricated number. |

## 3. The five things that would otherwise publish a wrong number

Each is handled in code and pinned by a test.

**NaN in NUMERIC columns.** `purchases.total` can hold IEEE NaN, and NaN propagates
through `SUM` until an entire aggregate is NaN — which renders as a dash and reads as "no
purchases". Every money expression goes through `nanSafe()`, and the poisoned rows are
**counted** and reported as `NAN_VALUES_IGNORED` rather than silently neutralised. A shop
with corrupt totals needs to know.

**Header versus line.** `purchases.total` carries tax and header discount; the sum of
`purchase_items.total` need not match it. Spend KPIs use the header (what was owed);
anything attributed to a product must use the lines (a header cannot be attributed to a
product). They are reconciled on every request and a material gap raises
`PURCHASE_LINE_HEADER_DELTA`.

**Supplier-return cohort.** This schema has no purchase-return table. The only record is
`supplier_return_items`, raised from a *customer* return, so its population is not the
units purchased in the same window. The rate is published because it is a real signal, but
never as a clean ratio and never without `SUPPLIER_RETURN_COHORT_MISMATCH`.

**Repeat means bought more than once.** Not "existed before the selected window". The
first cut of R6 used the second definition and reported a repeat rate of 0% for a shop
whose customers were all won that quarter and had each already bought six times.

**Returns are attributable to a customer, not to a product.** R3 is right to refuse a
per-product allocation — a refund cannot be split back across the lines it reversed. But
`return_items → returns → orders` and an order carries `customer_id`, so R6 deducts them
exactly. Without it, customer revenue was gross of refunds while the Overview's net sales
was net of them, and the two screens disagreed by the returns total with no explanation on
either.

## 4. Reconciliation

`/reports/reconciliation` (R10) and `node server/scripts/reconcileReportingCenter.js` are
the **same engine**: `analyticsReconciliationService.js` issues no SQL of its own and calls
the section services, so the screen and the script cannot drift. The screen renders the
service's verdict and never re-decides pass or fail. Both are read-only and safe against
production.

Last run in production, 2026-08-24 at `63e31097`, over 7/30/90/365-day windows:
**all 36 internal checks agree to within 0.01**, and every declared divergence against
accounting came back Δ 0. Net sales at 365 days: 684 250 on both sides.

It draws a line the audit docs implied but nothing enforced:

- **Internal** — screens that answer the same question from the same canon must agree to
  the cent. The script exits non-zero when they do not.
- **Declared** — the Reporting Center against `getProfitLossReport`. These are *meant* to
  differ, because v2 corrects defects accounting still carries (D-02 … D-07). The delta is
  quantified, not failed. A delta of zero on a dataset containing any of those cases would
  be the suspicious result.

One invariant is a subset rather than an equality: inventory demand ≤ total sales, because
the inventory CTE keeps only variants with stock on hand — a product that sold out has no
stock row to sit beside.

Note: `getProfitLossReport` calls `ensureAccountingSchema()`, which runs DDL at request
time and wants an `AccessExclusiveLock`. Issuing it alongside the analytics reads deadlocks
(40P01, proven). The script sequences it first.

## 5. Performance

The binding constraints are `statement_timeout` 15 s and `PG_POOL_MAX` 10. That is why
each page splits into three or four endpoints that load in parallel and degrade section by
section, rather than one large query that blocks.

The single largest win remains R2.5: the purchase-history `LATERAL` ran ~400 times per
query while resolving zero costs, because every sold line already resolved at the variant
or product rung. Wrapping it in a lazily-evaluated `CASE` took production from 1448 ms to
31 ms on the 30-day order scan and made accounting faster at the same time. A test now
pins `skipWhenResolved` in place; removing it would restore that regression across every
reporting page at once.

**No analytics index has ever been added.** Two candidates were examined in August 2026:

- `orders(tenant_id, customer_id, created_at)` — already exists as
  `idx_orders_tenant_customer_created`.
- `purchases(tenant_id, created_at)` — does **not** exist (`purchases` carries only
  `idx_purchases_tenant_id`) and every purchasing query filters on both. A real candidate,
  but at 31 rows on the development database the planner correctly sequential-scans, so no
  before/after measurement is possible. Deferred until it can be measured on production
  rather than added on the strength of an argument.

## 6. Legacy

Eighteen confirmed calculation defects live on `/reports` and `/analytics`
(`docs/analytics/legacy-defects.md`). They were corrected in the Reporting Center rather
than in place, because rewriting the legacy numbers would silently move figures a manager
reads daily.

That is only defensible because the legacy pages now **say so**, in `LegacyReportNotice`,
naming the specific defects rather than carrying a vague label — a reader has to know
which figure to distrust. The notice is not dismissible and links to the page that answers
the same question correctly.

**Two** defects were fixed at the source rather than annotated, both because leaving them
would mean publishing a number no reading of the word defends:

- **D-15** — `gross_profit` was revenue minus a cost expression that resolved to the
  literal `0`, because `order_items` carries none of the columns it looked for. It now
  returns NULL, so the page reports the figure as unavailable. Correcting it to a *real*
  profit would have moved a number nobody asked to have changed.
- **D-16** — the order scope never asked whether an order was a sale. Fixed 2026-08-24 by
  adopting `paidOrderClauses`, the same predicate the accounting P&L uses, at both sites
  (the shared scope and the employee sales subquery that bypassed it). Measured on
  production first: **690 830 → 681 330, −9 500 (1.38%)** across 9 orders — 8 unpaid
  `pending` and 1 `returned`/`refunded`. Every response now carries `scopeCorrection` for
  the reader's own period, and the notice states it in words, so the change is announced
  rather than applied quietly.

`/analytics` is **retired** to a redirect. Every capability it offered has a canonical
home, proven in `docs/reporting-center-legacy-parity.md`; its page file stays on disk,
unrouted, so restoring the route is a one-line revert.

`/reports` stays routed. Parity **is** proven for all seven of its tabs now that R9 closed
the employee gap, but `docs/reporting-center-architecture.md` promises it is retired only
on your explicit sign-off, and keeping that promise outranks the tidiness of removing a
route. What retiring it would take is written down in the parity matrix.

Eight nine-line placeholder pages under `src/modules/reports/pages/` were deleted after
proving nothing imported them. A test fails if a file of that shape reappears.

## 7. Permissions

| Permission | Gates |
|---|---|
| `reports.view` | Entry to every reporting route and endpoint |
| `reports.cost` | Cost columns — omitted from the SELECT, not blanked afterwards |
| `reports.profit` | Profit columns; only granted alongside `reports.cost`, because profit without cost leaks margin |
| `customers.view` | Customer **names** in R6. Without it the rows keep every figure and lose only the identity, so the totals stay correct |

Cashier holds none of them. `accounting.view` was removed from both Cashier presets in
August 2026: it gates `/financial-reports/{summary,profit-loss,ledgers,trial-balance,
balance-sheet}`, so a cashier who could no longer open the Reports Center could still pull
the P&L. POS never needed it — its only accounting call is `createManualMoneyAdjustment`,
gated on `money_transactions.adjust`, which the preset does not grant.

**Removing a permission from a preset does not revoke it from a role that already holds
it.** Grants live in `role_permissions` and the Roles screen wrote them there.
`node server/scripts/auditReportsGrants.js` reports; `--apply` revokes.

### The grant a role audit cannot see

`auditReportsGrants.js` returned `users=0` for every role on production, which is not
plausible for a live shop — so it was distrusted rather than believed. The reason is that
`permissionMiddleware` resolves a user four ways, and only one of them is
`role_permissions` via `role_id`:

1. `is_super_admin`, or an admin-shaped role name — **everything, with no grant rows at all**
2. a wildcard permission row
3. `role_permissions` via `users.role_id`
4. `role_permissions` via `users.role` matched by name or slug

`auditCashierEffectiveAccess.js` starts from the USER and reproduces all four. On
production it found the till account, **#49 "Cashier", carrying `is_super_admin = true`**:
its Cashier role granted nothing sensitive, but the flag short-circuited every `permit()`
check *and* set the tenant scope to NULL — every tenant's data, not only its own.

Cleared on 2026-08-24 with `revokePosSuperAdmin.js --apply`, which classifies admin shapes
first and never touches them. Re-audited immediately after: **"No POS-shaped user reaches
the financial reports."** Admin accounts (#1, #4) unchanged. The role's own 22 grants are
untouched, which is everything the till needs — `pos.sell`, `orders.create/edit/view`,
`customers.create/view`, `products.view/edit`, `attendance`, `loyalty`, `dashboard.view`.
Reversal, if it is ever wrong: `UPDATE users SET is_super_admin = TRUE WHERE id = 49;`

What that account **loses** is stated plainly rather than glossed: anything it held only
through the flag. Within the POS surface that is `money_transactions.adjust` — the treasury
recharge panel in the cart sidebar — plus `customers.edit/delete` and
`products.create/delete`. None of them is on the path of ringing up a sale. If the shop
wants any of them for cashiers, grant it explicitly on the role, which is where such a
decision belongs.

### Frontend guards on the financial surface

The Reports Center hole was one unguarded route. Sweeping the whole financial surface the
same way found **sixteen more** — every accounting page, P&L and ledgers included, mounting
for any signed-in user. Each now carries a `ProtectedRoute` whose permission was read off
the API rather than guessed, and `ProtectedRoute` is `anyOf`, so naming `accounting.view`
beside a specialised permission cannot lock out someone holding only the specialised one.

The guard is not the authorization. A test asserts all 52 accounting endpoints still carry
`protect()` and `permit()`, and another asserts no guard names a permission the backend
never declares.

## 8. Known gaps

| Gap | Status |
|---|---|
| `purchases(tenant_id, created_at)` index | Deferred — cannot be measured on a reachable dataset |
| Legacy `/reports` retirement | Parity proven; held for your explicit sign-off |
| Exchange orders created through `POST /orders` | The endpoint accepts `exchange_mode` with no evidence of a return, so an API client can still mint the double-counting shape. It cannot create the return itself — the sale payload carries no returned-item detail. The reporting layer detects the shape instead. Zero such orders exist on production |
| `analyticsController` still carries D-16 | `/analytics` is retired and no routed page calls those endpoints, so correcting it would move numbers nobody reads |
| Thirteen admin-shaped QA accounts hold `is_super_admin` on production | Out of scope here and deliberately untouched, but they are real logins with full financial access. Worth a separate pass |
