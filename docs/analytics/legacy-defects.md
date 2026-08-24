# Legacy Defect & Reconciliation Register

Every entry is **confirmed by code trace and/or query evidence**. Nothing here is speculative.

**Evidence base.** Code evidence is from `main` @ `2b5b9fe`. Data evidence is from the **local development database**
(`erp_db`, PostgreSQL 18.3 on x86_64-windows, 155 orders, 1 real tenant). It is **not production**. Production runs on the
VPS and was not reachable from this workstation — no `DATABASE_URL`/`PG*` variables are set in `.env` or `server/.env`, so
`server/database/db.js` fell back to its `localhost/erp_db` defaults. Data-derived magnitudes below are therefore
**shape evidence, not production impact**. Queries to run against production are in [`reconciliation.md`](./reconciliation.md#production-verification-queries).

Severity: **S1** = wrong money reaching management · **S2** = wrong operational decision · **S3** = security/privacy · **S4** = correctness debt.

---

## D-01 · `SUM(purchases.total)` returns `NaN` — S1

**Current behaviour.** `purchases.total` is `NUMERIC`, which accepts the IEEE value `'NaN'`. Purchase `id=19` (`status='draft'`) holds `NaN`.
Because `NaN` propagates through `SUM`, any aggregate over `purchases` that does not exclude drafts returns `NaN`.

Proven:
```
sum_all_purchases                 = NaN
sum_excluding_draft_cancelled     = 244931.00
```
`purchase_items.total` also has 1 `NaN` row. All other money columns scanned are clean (`orders.total_amount`, `subtotal`,
`paid_amount`, `discount_amount`, `order_items.total_amount`, `purchase_items.unit_cost`, `products.cost_price`,
`product_variants.cost_price`, `expenses.amount` — all 0 `NaN` rows).

**Correct behaviour.** Exclude non-committed purchases, and defend against `NaN` at the aggregate:
`SUM(CASE WHEN total::text = 'NaN' THEN 0 ELSE COALESCE(total,0) END)`.

**Affected.**
- `analyticsController.getProfitSummary` (`server/controllers/analyticsController.js:221`) — no status filter → `profit = revenue − NaN − expenses = NaN`, surfaced on `GET /api/analytics/profit` and `/api/analytics/overview`.
- `analyticsController.getProfitAnalytics` monthly series (`:1144`) — same.
- `reportsService.getDashboardReport` (`server/services/reportsService.js:250`) — `purchaseCost` → `NaN` → `netProfit` → `NaN` on `GET /api/reports/dashboard`, and therefore every KPI card on `/reports`.

**Financial impact.** Not a wrong number — a *non*-number. `JSON.stringify(NaN)` is `null`, so the UI renders blank or `0`.
Management sees no profit figure at all, or a silent zero.

**Recommended fix.** Add the committed-purchase status filter plus a `NaN` guard to the three call sites. Separately, a data
cleanup for the affected rows (out of scope here).

**Migration risk.** Low. Purchase totals become correct where they were previously `NaN`.
**Tests required.** Fixture with a `NaN` draft purchase; assert `purchases` aggregate is finite and excludes drafts.
**v2 status.** Not reproducible in v2 — `analyticsMetrics` filters purchase status and guards `NaN`.

---

## D-02 · Discount is double-counted in canonical accounting — S1 (latent)

**Write path, traced end-to-end** (`server/controllers/ordersController.js`):

```
:3036  requestedDiscountAmount   = body.discount_amount            // client sends the AGGREGATE
:3037  itemDiscountAmount        = requestedDiscountAmount − normalizedInvoiceDiscountAmount
:3040  nonCouponDiscount         = itemDiscountAmount + normalizedInvoiceDiscountAmount + loyaltyDiscount
:3069  totalDiscount             = nonCouponDiscount + couponDiscountAmount
:3070  computedTotal             = computedSubtotal − totalDiscount + totalServiceFee
:3248  INSERT orders(subtotal, discount_amount, …, coupon_discount_amount, …, invoice_discount_amount, …)
:3369+ VALUES    (computedSubtotal, totalDiscount, …, couponDiscountAmount, …, normalizedInvoiceDiscountAmount, …)
```

**Therefore `orders.discount_amount` is the ALL-INCLUSIVE total discount.** It already contains the item discount, the
invoice discount, the loyalty discount **and** the coupon discount. `invoice_discount_amount` and `coupon_discount_amount`
are **breakdown components**, not additive extras.

The edit path (`:5677`, `:5680`) preserves the invariant: `totalValue = subtotalValue − discountValue + serviceValue + taxValue`,
with `invoice_discount_amount` written separately as a component.

**Empirically proven** on the dev database — the identity holds for **144 of 144** orders with `subtotal > 0`:
```
subtotal − discount_amount + service_fee + tax_amount = total_amount     (144/144, ±0.01)
```
Per channel: pos 112/112, website 23/23, storefront 8/8, web_chat 1/1, facebook 1/1 (excluding the 11 orders with `subtotal = 0`).

**Current behaviour.**
| Consumer | Discount expression | Error |
|---|---|---|
| `accountingService.getProfitLossReport:4947` | `discount_amount + coupon_discount_amount` | coupon counted **twice** |
| `accountingReportsV2Service:124` and `:923` | `discount_amount + invoice_discount_amount + coupon_discount_amount` | coupon **and** invoice counted twice |
| `dashboardAnalyticsService:389` | `GREATEST(discount_amount − Σ item discount, 0)` | order-level residual — internally consistent |

**Correct behaviour.** `discount = orders.discount_amount`. Nothing added.

**Financial impact.** Discounts overstated ⇒ **net sales understated** ⇒ **gross profit understated**.
Magnitude on production = `SUM(coupon_discount_amount)` for `getProfitLossReport`, plus `SUM(invoice_discount_amount)`
for reports-v2, over canonical orders.

> **Latent in dev, not proven in production.** The dev database has **0 orders** with a non-zero `invoice_discount_amount`
> and **0** with a non-zero `coupon_discount_amount`, so all three expressions currently agree at `100.00`. The defect is
> established from code, and will materialise the first time a coupon or invoice discount is used. Query `Q-D02` in
> [`reconciliation.md`](./reconciliation.md#production-verification-queries) measures it on production.

**Recommended fix.** Change both accounting services to use `discount_amount` alone. **Not applied** — it changes published
accounting output and requires your sign-off.

**Migration risk.** Medium. Net sales and gross profit *increase* for any period containing coupon or invoice discounts.
**Tests required.** The 6-case fixture matrix in [`metric-contract.md`](./metric-contract.md#discount-regression-fixture-matrix).
**v2 status.** v2 uses `discount_amount` alone and reports the delta as `DISCOUNT_DEFINITION_DELTA`.

---

## D-03 · Exchange orders double-count revenue, COGS and stock — S1

**Traced.** `ordersController.js:3437-3459`, the `if (exchangeMode)` block, **only stamps metadata on the new order**:
`exchange_mode`, `original_order_id`, `exchange_credit_amount`, `new_order_total`, `amount_due_now`,
`exchange_difference`, `exchange_invoice_number`. It records `exchange_credit` as a line in `payment_breakdown` (`:3472`).

**It never touches the original order.** No `returns` row is created, `order_items.returned_quantity` stays `0`,
`orders.returned_at` stays `NULL`, and no compensating inventory movement is written.

Confirmed on dev data (orders 176-180):

| id | role | status/payment | total | credit | due_now | difference | `returned_qty` | `returns` rows | movements | passes canon |
|---|---|---|---|---|---|---|---|---|---|---|
| 176 | original | delivered/paid | 800 | — | — | — | 0 | 0 | `sale` −1 | ✅ |
| 177 | original | delivered/paid | 1000 | — | — | — | 0 | 0 | `sale` −1 | ✅ |
| 178 | exchange of 176 | delivered/paid | 1800 | 800 | 1000 | 1000 | 0 | 0 | `sale` −1 | ✅ |
| 179 | exchange of 176 | delivered/paid | 800 | 800 | 0 | 0 | 0 | 0 | `sale` −1 | ✅ |
| 180 | exchange of 177 | delivered/paid | 800 | 1000 | 0 | −200 | 0 | 0 | `sale` −1 | ✅ |

Every one passes the canonical predicate, so **both sides of every exchange are counted in full**.

**Worked examples** — the three scenarios you specified, with `E` = exchange order, `O` = original.

### Case A — like-for-like (`O` 1 000, replacement 1 000, customer pays 0)
Shape of dev order 179 → 176.

| | Current (legacy) | Correct economic net |
|---|---|---|
| Revenue | 1 000 (O) + 1 000 (E) = **2 000** | 1 000 |
| Returns | 0 | 1 000 *(or 0 with revenue recognised once)* |
| Net Sales | **2 000** | **1 000** |
| COGS | cost(A) + cost(B) | cost(B) only |
| Gross Profit | 2 000 − cost(A) − cost(B) | 1 000 − cost(B) |
| Stock effect | A −1 **and** B −1 | A ±0 (returned), B −1 |
| Cash effect | 0 incremental | 0 incremental |

**Net sales overstated by 1 000. COGS overstated by cost(A). Stock understated by 1 unit of A.**

### Case B — upgrade (`O` 1 000, replacement 1 200, customer pays 200)
Shape of dev order 178 → 176 (credit 800, total 1 800, due 1 000).

| | Current | Correct |
|---|---|---|
| Revenue | 1 000 + 1 200 = **2 200** | 1 200 |
| Net Sales | **2 200** | **1 200** |
| COGS | cost(A) + cost(B) | cost(B) |
| Gross Profit | 2 200 − cost(A) − cost(B) | 1 200 − cost(B) |
| Stock | A −1, B −1 | A ±0, B −1 |
| Cash | +200 | +200 |

**Overstated by 1 000** (the credited portion).

### Case C — downgrade (`O` 1 000, replacement 800, customer retains 200 credit)
**This is dev order 180 → 177 exactly** (credit 1 000, new total 800, difference −200, due 0).

| | Current | Correct |
|---|---|---|
| Revenue | 1 000 + 800 = **1 800** | 800 |
| Net Sales | **1 800** | **800** |
| COGS | cost(A) + cost(B) | cost(B) |
| Gross Profit | 1 800 − cost(A) − cost(B) | 800 − cost(B) |
| Stock | A −1, B −1 | A ±0, B −1 |
| Cash | 0 incremental; 200 credit liability | same |

**Overstated by 1 000.**

**Financial impact.** Net sales overstated by the credited amount on every exchange; COGS overstated by the original
item's cost; on-hand stock understated by the returned unit. On dev: 3 exchange orders, 2 800 EGP of credit.

**Recommended fix (product change, out of scope).** The exchange flow should create a real `returns` row against the
original with `restock = true`, so the existing return machinery reverses revenue, COGS and stock. Until then the data
model cannot express a partial exchange, and order 176 having **two** exchange children shows a blanket
"reverse the original in full" rule would itself be wrong.

**Migration risk.** High — changes both operational stock and historical accounting.
**Tests required.** Fixtures for cases A/B/C asserting the v2 recognition rule.
**v2 status.** Handled per [`metric-contract.md` §Exchange behaviour](./metric-contract.md#exchange-behaviour) — v2 recognises
`amount_due_now` as the exchange order's revenue contribution and emits `EXCHANGE_COGS_UNREVERSED`.

---

## D-04 · Soft-deleted orders are not excluded by the canonical predicate — S1 (latent)

**Current.** `paidOrderClauses` (`accountingService.js:331-343`) excludes `status = 'deleted'` but never tests
`orders.deleted_at IS NULL`.

**Data.** 2 soft-deleted orders exist; both happen to carry `status = 'cancelled'`, so they are already excluded:
`canon_but_soft_deleted = 0`. A soft-deleted order with `status = 'paid'` **would** be counted. Latent, not yet material.

**Correct.** Add `o.deleted_at IS NULL`.
**Affected.** Every accounting and analytics figure.
**Recommended fix.** Add the clause to `paidOrderClauses`. **Not applied** — changes accounting output.
**v2 status.** v2 excludes `deleted_at IS NOT NULL` per your decision #1 and reports any difference as `SOFT_DELETED_EXCLUDED`.

---

## D-05 · Draft-like statuses survive the status filter — S1 (latent)

**Current.** The exclusion list is a literal set: `('cancelled','canceled','void','refunded','returned','draft','deleted')`.
Actual statuses in the data include **`ai_draft`**, `pending_confirmation`, `awaiting_verification`, `pending` — none match.

| status | orders | survives status clause |
|---|---|---|
| `pending` | 31 | ✅ |
| `pending_confirmation` | 5 | ✅ |
| `ai_draft` | 2 | ✅ |
| `awaiting_verification` | 1 | ✅ |

They are excluded today only because the *payment* clause rejects them. An `ai_draft` order that ever reaches
`payment_status = 'paid'` would be counted as revenue.

**Correct.** Match draft-like statuses by pattern (`LIKE '%draft%'`) or maintain an explicit allowlist of sellable statuses.
**v2 status.** v2 excludes `status LIKE '%draft%'` in addition to the literal list.

---

## D-06 · Fully-paid orders excluded from revenue — S1, understatement

**Current.** 19 orders have `status='pending'`, `payment_status='pending'`, and `paid_amount = total_amount = 9 590` — money
collected in full, but neither status advanced. The canonical predicate excludes them.

Against a canonical total of 138 024 in the dev dataset, that is **~6.9 % of revenue not reported**.

Distinct from `payment_status='shipping_paid'` (4 orders, 7 340) where `paid_amount = 0` — those are correctly excluded;
`shipping_paid` means the *shipping fee* was proven paid, not the order.

**Correct.** Either fix the status transition at source, or recognise on `paid_amount >= total_amount`. Both are business
decisions, not reporting decisions.
**Recommended fix.** Investigate the POS status transition. Do **not** widen the predicate silently.
**v2 status.** v2 keeps the canonical predicate and emits `PAID_BUT_UNRECOGNISED` with the count and value, so the gap is visible instead of invisible.

---

## D-07 · Draft expenses are counted as expenses — S1

**Current.** `accountingService.js:5094-5096` excludes `('cancelled','canceled','rejected','void','deleted')` — **not `'draft'`**.
Dev data: 3 draft expenses totalling 1 850 are counted, against 5 paid totalling 4 150. Draft is **30.8 %** of reported expenses.

**Correct.** Exclude `draft` (and probably `pending`/`rejected` approval states) from recognised expenses.
**Affected.** `getProfitLossReport`, reports-v2 income statement, `/reports` financial tab, `/analytics/profit`.
**Recommended fix.** Add `'draft'` to the exclusion list. **Not applied** — changes accounting output.
**v2 status.** v2 excludes draft and reports the delta as `DRAFT_EXPENSES_EXCLUDED`.

---

## D-08 · `products.stock` is dead but drives inventory value — S1/S2

**Current.** No code path in `server/` writes `products.stock`. `product_variants.stock` is written by
`inventoryMovementService:354`, `inventoryService`, `ordersController`, `productsController`, `storefrontController`,
`stockReconciliationService`.

Dev totals: `products.stock` **777** · `product_variants.stock` **236** · `warehouse_inventory.stock` **230**.
Per-product divergence is total, not marginal — products 37/38/39 show `products.stock = 100` against `variants = 0`;
products 64/2/27 show `products.stock = 0` against `variants = 36/29/28`.

**Affected.** `reportsService.getInventoryRows:531`, `reportsService.getDashboardReport:252` (`inventoryValue` KPI),
`analyticsController:449` and `:337`.

**Correct.** Value inventory from `product_variants.stock` with the canonical unit-cost ladder.
**v2 status.** v2 reads `product_variants.stock` only, and exposes the divergence as `STOCK_SOURCE_DIVERGENCE`.

---

## D-09 · `/api/dashboard/*` has no authorization — S3

See [`security-findings.md`](./security-findings.md#f-01). **Fixed in this branch.**

---

## D-10 · `customer-intelligence` is not tenant-scoped — S3

See [`security-findings.md`](./security-findings.md#f-02). **Fixed in this branch.**

---

## D-11 · SQL errors are converted into zeros — S4

`reportsService.safeQuery:72-80`, `analyticsController.safeRows:14-22`, `dashboardAnalyticsService.safeQuery` all catch,
log and return `[]`/`0`. `analyticsController.getReorderSuggestions:1281` and `getDeadStockAnalysis:1303` return
**HTTP 200 `{success:true, items:[]}`** on failure.

This is the mechanism that hid D-12 and D-13 below.
**v2 status.** Banned. See [`metric-contract.md` §Null and error semantics](./metric-contract.md#null-and-error-semantics).

---

## D-12 · `products` has no `created_at`; date-filtered product queries always fail — S2

`products` has no `created_at` column (confirmed in `schema_only.sql` and `server/database/schema.sql`).
`analyticsController.buildWhereClause({alias:"p", dateColumn:"created_at"})` emits `DATE(p.created_at) >= $n` whenever a
date filter is set. The query throws; D-11 converts it to `[]`.

Consequence: with any date range applied, `/api/analytics/inventory` reports inventory value **0**, and low-stock,
dead-stock and predicted-sales lists come back **empty**.
**v2 status.** v2 never date-filters `products`; product recency comes from `product_variants.created_at` or
`inventory_movements.created_at`.

---

## D-13 · `warehouse_inventory` has neither `tenant_id` nor `created_at` — S2

`warehouse_inventory(id, warehouse_id, variant_id, stock, branch_id, section_id)`.
`analyticsController` builds `wi.tenant_id = $1 AND DATE(wi.created_at) …` for every warehouse-filtered branch
(`:306-312`, `:329`, `:372`, `:441`). Those queries **always** throw, and D-11 hides it. The entire
warehouse-filtered inventory-intelligence path has never returned data.
**v2 status.** v2 reaches `warehouse_inventory` through `product_variants` for tenant scope, and does not date-filter it.

---

## D-14 · Four incompatible "profit" definitions — S1

| Source | Formula | Order filter | Cost basis |
|---|---|---|---|
| `accountingService.getProfitLossReport` | `(gross − discounts − returns) − COGS − expenses` | full canonical | override → variant → product → purchase lookup |
| `dashboardAnalyticsService.calculateTodayProfit:355` | `Σ(net line revenue − cost×net qty) − order discount − expenses` | status + personal, **no payment_status** | `pv.cost_price` → `p.cost_price` only |
| `reportsService.getDashboardReport:260` | `sales − purchases_in_period − expenses` | **none** | n/a |
| `analyticsController.getProfitSummary:239` | `revenue − purchases − expenses` | **none** | n/a |

Rows 3-4 are not profit; they subtract purchases made in the period from sales in the period, and inherit D-01's `NaN`.
**v2 status.** One definition, from `accountingCanon`.

---

## D-15 · `/reports` reports gross profit equal to revenue — S1

`reportsService.js:206` resolves `costExpr` from `order_items` columns `["cost_total","purchase_cost","cost"]`.
**`order_items` has none of them**, so the expression is the literal `0` and
`:390 gross_profit = SUM(item total) − SUM(0)` = revenue.
**v2 status.** v2 uses the canonical cost ladder.

---

## D-16 · `/reports` counts cancelled, draft and personal orders as revenue — S1 — **CORRECTED AT SOURCE 2026-08-24**

`reportsService.buildOrderScope` filtered tenant, date, branch, warehouse, employee, customer, shift and payment
method — and never `status`, `payment_status`, `deleted_at` or `is_personal_transaction`. A second site,
the employee sales subquery in `getEmployeeRows`, named the table instead of aliasing it and so bypassed
`buildOrderScope` entirely.

Dev magnitude: every `/reports` sales figure included 3 cancelled orders (1 149.99), 14 returned (18 010),
1 personal (1 850) and 2 soft-deleted (3 720). Same for all of `analyticsController`.

**v2 status.** Canonical predicate everywhere.

### The correction, and what it moved

Both sites now use `paidOrderClauses` — the SAME predicate the accounting profit and loss uses. Deliberately
that one and not the stricter v2 predicate: it leaves the business with two definitions instead of three, and
the two are reconciled on `/reports/reconciliation`. The Reporting Center adds D-04 and D-05 on top, which is
why its figures can still sit slightly below the legacy page's.

Measured read-only against production (tenant 1, all 572 orders on file, 2026-08-24):

| | orders | revenue |
|---|---|---|
| Before (legacy scope) | 572 | 690 830.00 |
| After (recognised sales) | 563 | 681 330.00 |
| Removed | 9 | **9 500.00** (1.38%) |

The nine are 8 `pending`/`unpaid` orders (7 950.00) and 1 `returned`/`refunded` order (1 550.00). Production
carries no cancelled, draft, personal or soft-deleted orders at all, so the dev magnitudes above do not
reproduce there — the register's dev figures are kept because they are what the audit measured, not because
they describe production.

**Not silent.** `getReportPayload` returns `scopeCorrection` on every tab — `{ definition, applied,
excludedOrders, excludedValue }`, computed for the period the reader has selected — and the legacy notice
states it in words above the numbers. A manager reconciling against a figure they wrote down last week can
see exactly how large the gap is and what it consists of.

`analyticsController` still carries the defect. `/analytics` is retired to a redirect and no routed page
calls those endpoints (`analyticsApi.js` is imported only by the unrouted `AnalyticsDashboard.jsx`), so
correcting it would move numbers nobody reads.

---

## D-17 · Fabricated figures presented as analysis — S2

| Location | What it is |
|---|---|
| `analyticsController:421-432` | `predictedSales = SUM(stock) * 1.08`, hardcoded `confidence = 84` |
| `analyticsController:475-480` | `smartAlerts` falls back to two hardcoded fake alerts |
| `analyticsController:582` | `growthRate = revenue/orders/1000`, clamped `[3,30]`, labelled "estimated growth bias" |
| `analyticsController:259` | `SUM(o.paid_amount) AS profit` |
| `reportsService:355` | `profitTrend` = monthly revenue − `expenses / month_count` |
| `Reports.jsx:698-700` | every KPI progress bar hardcoded to `w-2/3` |

**v2 status.** None carried forward. v2 forecasts nothing in v1.

---

## D-18 · `/api/reports/export` gated on the wrong permission — S3 (minor)

`server/routes/reports.js:26` uses `permit("reports","view")`. `reports:export` exists in
`permissionMiddleware.CORE_PERMISSIONS` and is unused.
**v2 status.** `/api/analytics/v2/export` will use `reports:export`. Legacy route left alone.

---

## D-19 · Orphan `return_items` — S4

2 `return_items` rows (2 units, 1 950 refund) reference `order_item_id` values with no matching `order_items` row.
All 16 `returns` rows do join to an order, and there are **no** per-line mismatches between
`return_items.quantity` and `order_items.returned_quantity`.

Because `accountingService` computes returns via `return_items → returns → orders` **without** joining `order_items`, the
1 950 **is** included in canonical returns. Any per-product or per-line return attribution will lose it.
**v2 status.** v2 matches the canonical join for totals and emits `ORPHAN_RETURN_ITEMS` when line attribution is requested.

---

## D-20 · Unbounded module-level cache — S4

`reportsService.js:4` — a `Map` keyed on `JSON.stringify(filters)` with a 60 s TTL, no eviction and no size cap. Grows for
the process lifetime with every distinct filter combination.
**v2 status.** v2 uses a bounded LRU.

---

## Summary

| ID | Title | Sev | Proven by | Fixed here |
|---|---|---|---|---|
| D-01 | `NaN` in purchase totals | S1 | data | v2 only |
| D-02 | Discount double-count | S1 | code + identity proof | v2 only |
| D-03 | Exchange double-count | S1 | code + data | v2 only |
| D-04 | Soft-delete not excluded | S1 | code (latent) | v2 only |
| D-05 | `ai_draft` survives filter | S1 | data (latent) | v2 only |
| D-06 | Paid-but-pending excluded | S1 | data | warned in v2 |
| D-07 | Draft expenses counted | S1 | data | v2 only |
| D-08 | `products.stock` dead | S1/S2 | code + data | v2 only |
| D-09 | Dashboard RBAC | **S3** | code + test | ✅ **fixed** |
| D-10 | Customer-intel tenant leak | **S3** | code + test | ✅ **fixed** |
| D-11 | Errors → zeros | S4 | code | v2 only |
| D-12 | `products.created_at` missing | S2 | schema | v2 only |
| D-13 | `warehouse_inventory` columns | S2 | schema | v2 only |
| D-14 | Four profit definitions | S1 | code | v2 only |
| D-15 | Gross profit = revenue | S1 | code | v2 only |
| D-16 | Unfiltered order scope | S1 | code | **fixed at source 2026-08-24**, −9 500.00 (1.38%) on production, announced on the page |
| D-17 | Fabricated figures | S2 | code | v2 only |
| D-18 | Wrong export permission | S3 | code | v2 only |
| D-19 | Orphan return items | S4 | data | warned in v2 |
| D-20 | Unbounded cache | S4 | code | v2 only |

Per your hybrid instruction, only the two **S3** security defects were fixed in place. Everything else is corrected in
Analytics v2 and reported as a reconciliation delta against the legacy number.

**Amended 2026-08-24.** D-15 and D-16 were subsequently fixed at the source as well. Both meet the condition the
hybrid rule was protecting against: the before/after was measured on production, the size of the move is published
on the page itself, and the canonical definition each now uses is named. D-15 replaces a wrong number with NULL
rather than a corrected one; D-16 removes orders that no reading of the word "revenue" admits. Nothing else on
these screens has been changed in place.
