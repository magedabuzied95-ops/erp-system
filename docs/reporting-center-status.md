# Reporting Center — status

Living record of what the Reporting Center is, what it deliberately is not, and the
decisions that would otherwise have to be rediscovered from the code.

Last updated 2026-08-24, after R5 (purchasing), R6 (customers) and the export engine.

---

## 1. What ships

| Route | Arabic | Phase | Endpoints |
|---|---|---|---|
| `/reports/overview` | النظرة التنفيذية | R2 | `v2/overview` |
| `/reports/sales` | ذكاء المبيعات والأرباح | R3 | `v2/sales/{summary,breakdown,products,sizes}` |
| `/reports/inventory` | ذكاء المخزون | R4 | `v2/inventory/{summary,breakdown,products,sizes}` |
| `/reports/purchasing` | ذكاء المشتريات والموردين | R5 | `v2/purchasing/{summary,breakdown,products,suppliers}` |
| `/reports/customers` | ذكاء العملاء | R6 | `v2/customers/{summary,breakdown,list}` |
| `/reports/coupons` | أداء الكوبونات | — | `coupons/reports/performance` |
| `/reports` | التقارير والتحليلات | legacy | `reports/*` |
| `/analytics` | ذكاء المبيعات والتنبؤ | legacy | `analytics/*` |

All eight are gated on `reports.view` at the route **and** at the endpoint. Every money
figure is additionally gated on `reports.cost` / `reports.profit`, resolved in
`analyticsScope.js` and applied by omitting the column from the SELECT — a value the
caller may not see never enters the JSON, so it cannot leak through an export either.

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

`node server/scripts/reconcileReportingCenter.js` — read-only, safe against production.

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

One defect was fixed at the source rather than annotated: D-15, where `gross_profit` was
revenue minus a cost expression that resolved to the literal `0`, because `order_items`
carries none of the columns it looked for. It now returns NULL, so the page reports the
figure as unavailable. Correcting it to a *real* profit would have moved a number nobody
asked to have changed, and the Reporting Center already answers that question.

Neither legacy route is deleted or redirected. Parity has not been proven for the employee
tab or the export, and the rule is that nothing goes until it has.

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

## 8. Known gaps

| Gap | Status |
|---|---|
| `purchases(tenant_id, created_at)` index | Deferred — cannot be measured on a reachable dataset |
| Legacy `/reports` and `/analytics` retirement | Blocked on parity for the employee tab and the export |
| Legacy revenue scope (D-16) | Left in place, disclosed on the page |
| Employees and channels reporting | Not built. `orders` has no `employee_id`; attribution runs through three competing columns and must be named on screen before it ships |
| Reconciliation screen | Script exists; no page |
