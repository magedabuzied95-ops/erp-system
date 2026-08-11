# Analytics Metric Contract — v1 (frozen)

**Status: FROZEN.** This document is the source of truth for Reporting Center v2. Changing a definition here is a
contract change: it requires a version bump, a migration note in [`reconciliation.md`](./reconciliation.md), and tests.

Implemented by `server/services/analytics/`. Legacy `/api/reports`, `/api/analytics` and `/api/accounting/*` are **not**
governed by this contract — they are described in [`legacy-defects.md`](./legacy-defects.md).

Contract version: **1.0.0** · Frozen against `main` @ `2b5b9fe`.

---

## 1. Foundational rules

### 1.1 Tenant scope

Tenant is derived **from `req.user` only**. `x-tenant-id` headers and `tenant_id` query parameters are ignored by v2
(legacy `getTenantId` honours them when `req.user.tenant_id` is null — see `server/utils/requestScope.js`).

`tenant_id IS NULL` rows are **excluded** from tenant-scoped queries. The dev database has 7 such customers, 4 order
items, 2 orders and 1 purchase. v2 never widens scope with `OR tenant_id IS NULL`.

Super-admin (`isSuperAdminUser`) may query unscoped; every other caller is hard-scoped.

### 1.2 Date semantics

- Date column: `orders.created_at`, `purchases.created_at`, `expenses.expense_date` (falling back to `created_at`),
  `returns.created_at`, `inventory_movements.created_at`.
- All columns are `timestamp without time zone`. Comparison is `DATE(col) >= :from AND DATE(col) <= :to` — **inclusive at
  both ends**, matching `accountingService.addScopedWhere:316-327`.
- A missing range defaults to the last 30 days, applied server-side.
- Ranges longer than **400 days** are rejected with `RANGE_TOO_LARGE` rather than silently truncated.

### 1.3 Canonical order predicate — `CANON_ORDER`

Extends `accountingService.paidOrderClauses` with the two exclusions you approved, applied **in v2 only**:

```sql
      LOWER(COALESCE(o.status,'')) NOT IN
        ('cancelled','canceled','void','refunded','returned','draft','deleted')
  AND LOWER(COALESCE(o.status,'')) NOT LIKE '%draft%'          -- v2 addition (D-05)
  AND o.deleted_at IS NULL                                      -- v2 addition (D-04)
  AND COALESCE(o.is_personal_transaction, FALSE) = FALSE
  AND (
        LOWER(COALESCE(o.payment_status,'')) IN
          ('paid','completed','complete','partially_paid','partial')
     OR LOWER(COALESCE(o.status,'')) IN ('paid','completed','complete','delivered')
      )
```

Every difference from the legacy predicate is reported as a warning, never applied silently. See §7.

**Deliberately NOT included:** `payment_status = 'shipping_paid'` (4 dev orders, 7 340) — verified to mean the shipping
fee was paid while `paid_amount = 0`. And `status='pending' AND paid_amount >= total_amount` (D-06) — reported via
`PAID_BUT_UNRECOGNISED`, not recognised.

### 1.4 Net quantity — `NET_QTY`

```sql
GREATEST(COALESCE(oi.quantity,0) - COALESCE(oi.returned_quantity,0), 0)
```
Identical to `accountingService.js:5001`.

### 1.5 Unit cost ladder — `UNIT_COST`

First **non-zero** wins. Identical to `accountingService.js:5016-5021`:

1. `accounting_order_item_cost_overrides.unit_cost`
2. `product_variants.last_purchase_cost` → `product_variants.cost_price`
3. `products.last_purchase_cost` → `products.cost_price`
4. `purchaseCostLookup` LATERAL — most recent non-cancelled `purchase_items` unit cost for the
   `(product_id, variant_id)` pair, else the average over those rows
5. `0`

> `product_variants.average_cost` and `.purchase_price` exist but are **not** in the ladder. This matches accounting.
> Changing it is a contract change.

Dev coverage: 132 canonical sold lines — 90 resolve at rungs 2-3, 42 fall through to the LATERAL, 0 overrides exist.

### 1.6 `NaN` guard

All money columns are `NUMERIC` and can hold IEEE `NaN` (see D-01). Every v2 aggregate over a money column wraps it:

```sql
SUM(CASE WHEN col::text = 'NaN' THEN 0 ELSE COALESCE(col, 0) END)
```

When any contributing row was `NaN`, the metric still returns a number and emits `NAN_VALUES_IGNORED` with the row count.

---

## 2. Null and error semantics

| Outcome | Representation |
|---|---|
| Verified mathematical zero | `0` |
| Cannot be calculated reliably (no denominator, no data, unresolvable input) | `null` |
| Query or system failure | **HTTP 500**, naming the failing metric. Never a zero. |
| Calculated, but with known limitations | value + `warnings[]` entry |

Response envelope:

```json
{
  "value": null,
  "warnings": [
    { "code": "COGS_COVERAGE_LOW", "message": "…", "coverage": 0.73, "scope": "grossProfit" }
  ],
  "meta": { "filters": {}, "generatedAt": "…", "comparison": {}, "contractVersion": "1.0.0" }
}
```

Warning codes are machine-readable, stable, and `SCREAMING_SNAKE_CASE`. The full registry is in §7.

`safeQuery`-style error swallowing is **prohibited** in `server/services/analytics/`.

---

## 3. Revenue metrics

### Gross Sales
- **Meaning.** Value of goods sold before discounts and returns.
- **Formula.** `SUM( COALESCE(NULLIF(o.subtotal,0), COALESCE(o.total_amount,0) + COALESCE(o.discount_amount,0)) )`
- **Source.** `orders`. **Inclusion.** `CANON_ORDER`. **Date.** `orders.created_at`.
- **Returns.** Not deducted. **Tax.** Inclusive — `total_amount` does not add tax on top (`ordersController:3070`).
- **Discount.** Added back on the fallback branch only.
- **Null.** `0` when no orders match (verified zero).
- **Note.** 92 of 96 dev canonical orders take the `subtotal` branch; 4 take the fallback.

### Discount Amount
- **Meaning.** Total price reduction granted — item + invoice + loyalty + coupon.
- **Formula.** `SUM(COALESCE(o.discount_amount, 0))` — **nothing added.**
- **Why.** `orders.discount_amount` is bound from `totalDiscount` (`ordersController:3069`), which is all-inclusive.
  `invoice_discount_amount` and `coupon_discount_amount` are breakdown components. Adding them double-counts (D-02).
  Proven by the identity `subtotal − discount_amount + service_fee + tax_amount = total_amount`, holding 144/144 on dev.
- **Breakdown (display only, never summed into the total).**
  - Invoice discount: `SUM(o.invoice_discount_amount)`
  - Coupon discount: `SUM(o.coupon_discount_amount)`
  - Item discount: `SUM(o.discount_amount) − SUM(o.invoice_discount_amount) − SUM(o.coupon_discount_amount)`

### Returns
- **Formula.** `SUM(ri.refund_amount)` over `return_items ri JOIN returns r ON r.id = ri.return_id JOIN orders o ON o.id = r.order_id`,
  with `LOWER(COALESCE(r.status,'')) NOT IN ('cancelled','canceled','rejected','void','deleted')`, scoped by `r.created_at`.
- **Date.** `returns.created_at` — a return lands in the period it was *processed*, not the period of the original sale.
- **Note.** Deliberately does **not** join `order_items`, matching `accountingService.js:5064-5074`. 2 orphan
  `return_items` rows (1 950 on dev) are therefore included in the total but cannot be attributed to a product;
  requesting line-level attribution emits `ORPHAN_RETURN_ITEMS`.
- **Fallback.** If `returns`/`return_items` are unavailable, total of orders whose status/payment_status is
  `returned`/`refunded`, and emit `RETURNS_FALLBACK_USED`.

### Net Sales — headline revenue
- **Formula.** `Gross Sales − Discount Amount − Returns`
- **Exchange behaviour.** See §6.

### Orders
`COUNT(*)` over `CANON_ORDER`. Exchange orders count as orders.

### Average Order Value
`Net Sales / Orders`. **`null`** when `Orders = 0` — never `0`.

### Items Sold
`SUM(NET_QTY)` over `order_items oi JOIN orders o` under `CANON_ORDER`.

### Items per Order
`Items Sold / Orders`. `null` when `Orders = 0`.

### Discount %
`Discount Amount / Gross Sales`. `null` when `Gross Sales = 0`.

### Cancellation Rate
`COUNT(status IN ('cancelled','canceled','void')) / COUNT(orders excluding draft-like and deleted)`.
Denominator is deliberately **not** `CANON_ORDER` — a cancelled order can never satisfy it. `null` when denominator is 0.

### Return Rate (value)
`Returns / Gross Sales`. `null` when `Gross Sales = 0`.

### Return Rate (units)
`SUM(oi.returned_quantity) / SUM(oi.quantity)` under `CANON_ORDER`. `null` when denominator is 0.

---

## 4. Profitability metrics

### COGS
- **Formula.** `SUM( NET_QTY × GREATEST(UNIT_COST, 0) )` under `CANON_ORDER`.
- **Source.** `order_items` + the §1.5 ladder. `order_items` stores no cost, so this is always reconstructed.
- **Security.** Requires `reports:cost`. Omitted from the SELECT list otherwise — not blanked client-side.

### COGS Coverage %
- **Meaning.** Share of sold units whose cost resolved to a real, non-zero value.
- **Formula.** `SUM(NET_QTY) FILTER (WHERE UNIT_COST > 0) / SUM(NET_QTY)` under `CANON_ORDER`.
- **Why it exists.** Unresolved cost silently becomes `0`, which inflates gross profit. Approved as a first-class metric.
- **Behaviour.** Whenever coverage < **0.95**, every profit and margin figure in the same response carries
  `COGS_COVERAGE_LOW` with the exact coverage. Below **0.50**, Gross Profit and Gross Margin are returned as **`null`**
  with `COGS_COVERAGE_CRITICAL` — an apparently precise profit is not shown on a cost base that thin.
- **Null.** `null` when `SUM(NET_QTY) = 0`.

### Gross Profit
`Net Sales − COGS`. Requires `reports:profit`. `null` when COGS coverage < 0.50.

### Gross Margin %
`Gross Profit / Net Sales`. `null` when `Net Sales = 0` or Gross Profit is `null`.

### Operating Expenses
- **Formula.** `SUM(e.amount)` where
  `LOWER(COALESCE(e.status,'')) NOT IN ('cancelled','canceled','rejected','void','deleted','draft')`.
- **v2 difference.** `'draft'` added (D-07). Legacy counts drafts — 1 850 of 6 000 on dev. Reported as
  `DRAFT_EXPENSES_EXCLUDED`.
- **Date.** `expenses.expense_date`, falling back to `created_at`.
- **Journal expenses.** Expense-type journal lines excluding account `5000` are added, matching
  `accountingService.js:5118-5156`. Account 5000 is COGS and is presented separately; including it would deduct cost twice.

### Net Profit
`Gross Profit − Operating Expenses`. Requires `reports:profit`.

### Dimension allocation
Per-dimension gross profit uses line-level net sales:

```
line_net_sales = COALESCE(oi.total_amount,0) × NET_QTY / NULLIF(oi.quantity,0)
```

Order-level discount is allocated **pro-rata by line share of order subtotal**, mirroring
`dashboardAnalyticsService.js:381-386`. Σ over all dimension slices **must** equal order-level Net Sales; asserted by
reconciliation check `RC-09`.

---

## 5. Inventory metrics

**Source of truth: `product_variants.stock`**, filtered `deleted_at IS NULL AND is_active`.
`products.stock` is never read (D-08). `warehouse_inventory` is a partial per-warehouse ledger, reached only through
`product_variants` for tenant scope, and never date-filtered (D-13).

| Metric | Formula | Null behaviour |
|---|---|---|
| Units in Stock | `SUM(pv.stock)` | `0` |
| Inventory Value | `SUM(pv.stock × UNIT_COST)` — same ladder as COGS | `0`; `INVENTORY_COST_COVERAGE_LOW` if <95 % of units priced |
| Out of Stock | `COUNT(pv.stock <= 0)` | `0` |
| Low Stock | `COUNT(pv.stock > 0 AND pv.stock <= GREATEST(pv.low_stock_alert, p.product_low_stock_threshold, 1))` | `0` |
| Sales Velocity | `SUM(NET_QTY) / days_in_range` per variant | `0` |
| Days of Inventory | `pv.stock / NULLIF(velocity, 0)` | **`null`** when velocity = 0 — never 999 |
| Sell-through | `SUM(NET_QTY) / (opening_stock + received_in_period)` | `null` when denominator = 0 |
| Inventory Turnover | `COGS_in_period / average_inventory_value` | `null` when average = 0 |
| Dead Stock | `pv.stock > 0` and no sale in N days (default 90) | — |
| Slow Moving | `pv.stock > 0`, velocity > 0, days of inventory > 120 | — |
| Fast Moving | top decile by velocity with days of inventory < 21 | — |
| Capital Tied Up | `SUM(pv.stock × UNIT_COST)` over dead + slow | `0` |

### Movement-type vocabulary (discovered, not assumed)

`inventory_movements.movement_type` values observed on dev, classified:

| Direction | Types |
|---|---|
| **Purchase in** | `purchase` (298), `purchase_in` (18), `purchase_edit_stock_in` (2) |
| **Sale out** | `sale` (121), `website_order` (26), `sale_out` (8) |
| **Return in** | `return` (19), `order_cancel` (6), `order_edit_restore` (20), `order_hard_delete_restore` (1) |
| **Adjustment** | `product_stock_edit` (36), `edit_variant_stock` (4) |
| **Reversal out** | `purchase_reverse_stock_out` (10), `order_edit_deduct` (19) |
| **Owner use** | `owner_use_out` (1) |

`received_in_period` for sell-through = sum of `quantity_change` over the **Purchase in** set only. This is an explicit
allowlist; an unrecognised `movement_type` is counted in no bucket and emits `UNKNOWN_MOVEMENT_TYPE`.

> Vocabulary discovered on the dev database. Production may contain additional values — query `Q-J` in
> [`reconciliation.md`](./reconciliation.md#production-verification-queries) before relying on sell-through.

---

## 6. Exchange behaviour

Established by code trace and data (D-03): the exchange flow **never reverses the original order**. No `returns` row,
`returned_quantity` stays 0, `returned_at` stays null, and no compensating stock movement is written.

### v1 recognition rule

For an order with `exchange_mode = TRUE`:

| Quantity | Treatment |
|---|---|
| Revenue contribution | **`amount_due_now`**, not `total_amount` — the incremental consideration |
| Negative `exchange_difference` | Recorded as `exchangeCreditIssued`, **not** negative revenue |
| Original order | Keeps its full revenue and COGS — untouched |
| Exchange order COGS | Counted in full from its own lines |
| Warning | `EXCHANGE_COGS_UNREVERSED`, with affected order count and estimated unreversed cost |

This eliminates the revenue double-count (the material error) and makes the cost/stock issue visible rather than silent.

**Why COGS is not auto-reversed.** The model cannot disambiguate partial exchanges, and dev order 176 has **two**
exchange children (178 and 179) — a blanket "reverse the original in full" rule would reverse it twice.

### Worked examples

Notation: `O` original, `E` exchange, `A` original item, `B` replacement.

#### Case A — like-for-like. `O` = 1 000, replacement 1 000, customer pays 0
*(shape of dev order 179 → 176)*

| | Legacy | **v2 v1** | True economic |
|---|---|---|---|
| Revenue | 2 000 | **1 000** | 1 000 |
| Returns | 0 | 0 | 1 000 |
| Net Sales | 2 000 | **1 000** | 1 000 |
| COGS | cost(A)+cost(B) | cost(A)+cost(B) ⚠ | cost(B) |
| Gross Profit | 2 000 − both | 1 000 − both ⚠ | 1 000 − cost(B) |
| Stock | A −1, B −1 | A −1, B −1 ⚠ | A ±0, B −1 |
| Cash | 0 | 0 | 0 |

v2 revenue is correct; COGS carries `EXCHANGE_COGS_UNREVERSED`.

#### Case B — upgrade. `O` = 1 000, replacement 1 200, customer pays 200
Here `exchange_credit_amount = 1 000`, `total_amount = 1 200`, `amount_due_now = 200`.
*(Dev order 178 → 176 is the same shape with different figures: original 800, replacement 1 800, credit 800, due 1 000.)*

| | Legacy | **v2 v1** | True economic |
|---|---|---|---|
| Revenue | 1 000 + 1 200 = 2 200 | 1 000 (`O`) + 200 (`E`) = **1 200** | 1 200 |
| Net Sales | 2 200 | **1 200** | 1 200 |
| COGS | cost(A)+cost(B) | cost(A)+cost(B) ⚠ | cost(B) |
| Stock | A −1, B −1 | A −1, B −1 ⚠ | A ±0, B −1 |
| Cash | +200 | +200 | +200 |

v2 net sales is **exact** here. Legacy overstates by 1 000.

> **Known limitation — retained credit.** v2 recognises the original order's revenue in full and adds only the
> incremental `amount_due_now`. When the customer does **not** consume the whole credit (Case C), the unconsumed
> remainder stays in revenue although the goods came back. v2 therefore overstates net sales by exactly
> `exchangeCreditIssued`. That figure is disclosed as its own line and via `EXCHANGE_CREDIT_RETAINED`, so the overstatement
> is always visible and subtractable. Cases A and B, where the credit is fully consumed, are exact.
> Eliminating the residual requires the product fix in D-03.

#### Case C — downgrade. `O` = 1 000, replacement 800, customer retains 200 credit
*(**exactly** dev order 180 → 177: credit 1 000, new total 800, difference −200, due 0)*

| | Legacy | **v2 v1** | True economic |
|---|---|---|---|
| Revenue | 1 800 | **1 000** | 800 |
| Net Sales | 1 800 | **1 000** | 800 |
| exchangeCreditIssued | — | **200** | 200 |
| COGS | cost(A)+cost(B) | cost(A)+cost(B) ⚠ | cost(B) |
| Stock | A −1, B −1 | A −1, B −1 ⚠ | A ±0, B −1 |
| Cash | 0 | 0 | 0 |

v2: `O` 1 000 + `E` `amount_due_now` 0 = 1 000, plus a 200 credit disclosed separately.
Legacy overstates by 800; v2 overstates by 200 and discloses exactly why.

---

## 7. Warning registry

| Code | Meaning | Payload |
|---|---|---|
| `COGS_COVERAGE_LOW` | Cost coverage < 0.95 | `coverage`, `uncostedUnits` |
| `COGS_COVERAGE_CRITICAL` | Cost coverage < 0.50; profit returned `null` | `coverage` |
| `INVENTORY_COST_COVERAGE_LOW` | < 95 % of on-hand units have a resolvable cost | `coverage` |
| `NAN_VALUES_IGNORED` | `NaN` money values excluded from an aggregate | `column`, `rows` |
| `DISCOUNT_DEFINITION_DELTA` | v2 discount differs from legacy accounting | `v2`, `legacy`, `delta` |
| `SOFT_DELETED_EXCLUDED` | Orders excluded by `deleted_at` that legacy would count | `orders`, `value` |
| `DRAFT_STATUS_EXCLUDED` | Orders excluded by the `%draft%` pattern | `orders`, `value`, `statuses[]` |
| `DRAFT_EXPENSES_EXCLUDED` | Draft expenses excluded that legacy counts | `amount` |
| `PAID_BUT_UNRECOGNISED` | Fully paid orders failing the canonical predicate (D-06) | `orders`, `value` |
| `EXCHANGE_COGS_UNREVERSED` | Exchange originals not cost-reversed | `orders`, `estimatedCost` |
| `EXCHANGE_CREDIT_RETAINED` | Customer retained unconsumed exchange credit; net sales overstated by this amount | `orders`, `creditRetained` |
| `ORPHAN_RETURN_ITEMS` | `return_items` without a matching `order_items` row | `rows`, `refund` |
| `STOCK_SOURCE_DIVERGENCE` | `products.stock` ≠ `Σ product_variants.stock` | `productsStock`, `variantsStock` |
| `UNKNOWN_MOVEMENT_TYPE` | Movement type outside the classified vocabulary | `types[]` |
| `RETURNS_FALLBACK_USED` | Order-status fallback used instead of `return_items` | — |
| `RANGE_TOO_LARGE` | Requested range exceeds 400 days | `days` |
| `COMPARISON_BASE_ZERO` | Comparison denominator is 0; Δ% is `null` | `metric` |

---

## 8. Comparison behaviour

| Mode | Definition |
|---|---|
| `previous_period` | Same length, immediately preceding |
| `previous_month` | Same day-of-month window, one calendar month back |
| `previous_year` | Same window, one calendar year back |
| `custom` | Explicit `compareFrom` / `compareTo` |

- `delta = current − previous`
- `deltaPercent = (current − previous) / ABS(previous)`, and **`null` when `previous = 0`**, with `COMPARISON_BASE_ZERO`.
  Legacy returns `100` in that case, which is misleading.
- If `current` or `previous` is `null`, both `delta` and `deltaPercent` are `null`.
- The comparison window uses the identical predicate and cost ladder as the current window.

---

## 9. Security scope per metric

| Metric group | Permission |
|---|---|
| Orders, Items Sold, AOV, Net Sales, Gross Sales, Discounts, Returns, Cancellation/Return rates | `reports:view` |
| COGS, COGS Coverage, Inventory Value, Capital Tied Up, Unit Cost, Purchase Cost | `reports:view` + **`reports:cost`** |
| Gross Profit, Gross Margin, Net Profit, Profit Contribution | `reports:view` + **`reports:profit`** |
| Customer lists with contact details | `reports:view` + `customers:view` |
| Employee performance rows | `reports:view` + `employees:view` |
| Export | **`reports:export`** |

Enforcement is in the **service layer**. Ungranted columns are omitted from the SQL SELECT list, so they never enter the
response. UI hiding is not a control. Permission scope is part of every cache key.

---

## 10. Discount regression fixture matrix

Required by your decision #2. Each case asserts Gross Sales, Discount Amount, Net Sales, and the
`subtotal − discount + service + tax = total` identity.

| # | Case | subtotal | item disc | invoice disc | coupon disc | `discount_amount` | `total_amount` | v2 Discount | Legacy (`accountingService`) | Legacy (reports-v2) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | No discount | 1 000 | 0 | 0 | 0 | 0 | 1 000 | 0 | 0 | 0 |
| 2 | Item only | 1 000 | 100 | 0 | 0 | 100 | 900 | 100 | 100 | 100 |
| 3 | Invoice only | 1 000 | 0 | 150 | 0 | 150 | 850 | 150 | 150 | **300** ✗ |
| 4 | Coupon only | 1 000 | 0 | 0 | 200 | 200 | 800 | 200 | **400** ✗ | **400** ✗ |
| 5 | Item + invoice | 1 000 | 100 | 150 | 0 | 250 | 750 | 250 | 250 | **400** ✗ |
| 6 | All three | 1 000 | 100 | 150 | 200 | 450 | 550 | 450 | **650** ✗ | **800** ✗ |

Cases 3-6 are the D-02 double-count, quantified. Case 6 overstates discount by 44 % (accounting) / 78 % (reports-v2),
understating net sales by the same absolute amount.
