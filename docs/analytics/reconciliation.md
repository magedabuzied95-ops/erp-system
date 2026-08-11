# Reconciliation Specification

How Analytics v2 proves its numbers against the canonical accounting layer, and how every intentional divergence is
disclosed. **No number is ever adjusted to force agreement.**

Contract: [`metric-contract.md`](./metric-contract.md) v1.0.0 · Defects: [`legacy-defects.md`](./legacy-defects.md)

---

## 1. Principle

v2 is **not** bug-compatible with legacy. It applies the corrections you approved (soft-delete exclusion, draft-status
exclusion, single-count discount, draft-expense exclusion, variant stock source, exchange net recognition). Each of those
produces a *known, quantified* delta against the legacy figure.

Therefore reconciliation reports two things per check:

- **Residual** — `v2 − legacy − Σ(explained deltas)`. This must be `0.00`. Anything else is an unexplained discrepancy
  and a bug.
- **Explained deltas** — each attributed to a defect ID with its own amount.

A non-zero residual is surfaced in the UI, logged, and fails the reconciliation test suite. It is never rounded away.

---

## 2. Checks

| ID | Metric | v2 source | Canonical source | Tolerance |
|---|---|---|---|---|
| RC-01 | Net Sales | `analyticsMetrics.netSales` | `getProfitLossReport().revenue.net_sales` | 0.01 |
| RC-02 | Gross Sales | `.grossSales` | `.revenue.gross_sales` | 0.01 |
| RC-03 | Discounts | `.discountAmount` | `.revenue.discounts` | 0.01 |
| RC-04 | Returns | `.returns` | `.revenue.returns` | 0.01 |
| RC-05 | COGS | `.cogs` | `.cogs.total_cogs` | 0.01 |
| RC-06 | Gross Profit | `.grossProfit` | `.gross_profit` | 0.01 |
| RC-07 | Operating Expenses | `.operatingExpenses` | `.total_expenses` | 0.01 |
| RC-08 | Net Profit | `.netProfit` | `.net_profit` | 0.01 |
| RC-09 | Dimension sum | `Σ breakdown[].netSales` | `.netSales` (same call) | 0.01 |
| RC-10 | Inventory Value | `.inventoryValue` | `reports-v2/inventory` | 0.01 |
| RC-11 | Purchases | `.purchaseValue` | `reports-v2/payables` | 0.01 |
| RC-12 | Orders count | `.orders` | `COUNT(*)` under canonical predicate | 0 |

RC-09 is **internal**: the sum of every dimension slice must equal the order-level total. It catches pro-rata discount
allocation errors, which no external source can detect.

---

## 3. Expected deltas per check

| Check | Defect | Direction | Amount |
|---|---|---|---|
| RC-01, RC-03 | D-02 discount double-count | v2 net sales **higher** | `SUM(coupon_discount_amount)` over canonical orders |
| RC-01, RC-02, RC-12 | D-04 soft-delete | v2 **lower** | value of soft-deleted orders passing the legacy predicate |
| RC-01, RC-02, RC-12 | D-05 draft-like status | v2 **lower** | value of `%draft%` orders passing the legacy predicate |
| RC-01 | D-03 exchange recognition | v2 **lower** | `Σ(total_amount − amount_due_now)` over exchange orders |
| RC-07, RC-08 | D-07 draft expenses | v2 expenses **lower** | `SUM(amount)` where `status='draft'` |
| RC-10 | D-08 stock source | either | `products.stock` vs `Σ product_variants.stock` valuation gap |
| RC-05, RC-06 | D-03 exchange COGS | v2 **not** corrected | `0` — v2 matches legacy here by design; disclosed as `EXCHANGE_COGS_UNREVERSED` |

Every row above is computed by `analyticsReconcileService` and returned alongside the residual, so the Finance screen can
show: *legacy 100 000 → v2 104 250, of which +4 500 discount correction, −250 soft-deleted; residual 0.00*.

---

## 4. Dev-database baseline

Measured on the local development database (`erp_db`, 155 orders, 1 real tenant, orders 2026-05-06 → 2026-06-21).
**Not production.** Recorded so drift in the fixtures is detectable.

| Quantity | Value |
|---|---|
| Orders passing the canonical predicate | 96 |
| Canonical `SUM(total_amount)` | 138 024.00 |
| Gross sales as accounting computes it | 135 691.00 |
| Orders using the `subtotal` branch / fallback | 92 / 4 |
| `SUM(discount_amount)` over canonical orders | 100.00 |
| `SUM(invoice_discount_amount)` | **0.00** |
| `SUM(coupon_discount_amount)` | **0.00** |
| Expected D-02 delta on dev | **0.00** (latent) |
| Soft-deleted orders passing the canonical predicate | **0** (latent) |
| Draft-like orders passing the canonical predicate | **0** (latent — all blocked by the payment clause) |
| Exchange orders | 3, credit 2 800, `Σ(total − due_now)` = **1 400** |
| Draft expenses | 3, **1 850.00** of 6 000.00 total |
| Fully-paid but unrecognised (D-06) | 19 orders, **9 590.00** (~6.9 % of canonical revenue) |
| COGS coverage (rungs 2-3) | 90 / 132 canonical sold lines = **68.2 %** before the purchase LATERAL |
| Cost overrides | 0 |
| `products.stock` vs `Σ variants.stock` | 777 vs 236 |
| Orphan `return_items` | 2 rows, 2 units, 1 950.00 |
| `NaN` money rows | `purchases.total` 1, `purchase_items.total` 1 |

On dev, the only **material** v2-vs-legacy deltas are the exchange correction (−1 400) and draft expenses (−1 850).
Discount, soft-delete and draft-status corrections are all latent at 0.00.

---

## 5. Production verification queries

Read-only. Run these against production and paste the output; they are the evidence base the dev database cannot provide.
No PII is selected by any of them.

### Q-D02 — discount double-count exposure
```sql
SELECT ROUND(SUM(COALESCE(o.discount_amount,0))::numeric,2)          AS v2_discount,
       ROUND(SUM(COALESCE(o.coupon_discount_amount,0))::numeric,2)   AS accounting_overcount,
       ROUND(SUM(COALESCE(o.invoice_discount_amount,0))::numeric,2)  AS reportsv2_extra_overcount,
       COUNT(*) FILTER (WHERE COALESCE(o.coupon_discount_amount,0) > 0)  AS orders_with_coupon,
       COUNT(*) FILTER (WHERE COALESCE(o.invoice_discount_amount,0) > 0) AS orders_with_invoice_discount
FROM orders o
WHERE LOWER(COALESCE(o.status,'')) NOT IN ('cancelled','canceled','void','refunded','returned','draft','deleted')
  AND COALESCE(o.is_personal_transaction,FALSE)=FALSE
  AND (LOWER(COALESCE(o.payment_status,'')) IN ('paid','completed','complete','partially_paid','partial')
       OR LOWER(COALESCE(o.status,'')) IN ('paid','completed','complete','delivered'));
```

### Q-D02b — confirm the discount identity holds in production
```sql
SELECT COUNT(*) AS orders_with_subtotal,
       COUNT(*) FILTER (WHERE ABS(COALESCE(subtotal,0) - COALESCE(discount_amount,0)
                              + COALESCE(service_fee,0) + COALESCE(tax_amount,0)
                              - COALESCE(total_amount,0)) <= 0.01) AS identity_holds
FROM orders WHERE COALESCE(subtotal,0) > 0;
```
If `identity_holds < orders_with_subtotal`, the all-inclusive-discount conclusion needs re-examination before v2 ships.

### Q-D01 — `NaN` money scan
```sql
SELECT 'purchases.total' AS col, COUNT(*) FROM purchases WHERE total::text='NaN'
UNION ALL SELECT 'purchase_items.total', COUNT(*) FROM purchase_items WHERE total::text='NaN'
UNION ALL SELECT 'orders.total_amount', COUNT(*) FROM orders WHERE total_amount::text='NaN'
UNION ALL SELECT 'orders.subtotal', COUNT(*) FROM orders WHERE subtotal::text='NaN'
UNION ALL SELECT 'order_items.total_amount', COUNT(*) FROM order_items WHERE total_amount::text='NaN'
UNION ALL SELECT 'expenses.amount', COUNT(*) FROM expenses WHERE amount::text='NaN';
```

### Q-D04/D-05 — orders v2 will drop that legacy counts
```sql
SELECT COUNT(*) FILTER (WHERE o.deleted_at IS NOT NULL)        AS soft_deleted,
       ROUND(SUM(COALESCE(o.total_amount,0)) FILTER (WHERE o.deleted_at IS NOT NULL)::numeric,2) AS soft_deleted_value,
       COUNT(*) FILTER (WHERE LOWER(COALESCE(o.status,'')) LIKE '%draft%') AS draftish,
       ROUND(SUM(COALESCE(o.total_amount,0)) FILTER (WHERE LOWER(COALESCE(o.status,'')) LIKE '%draft%')::numeric,2) AS draftish_value
FROM orders o
WHERE LOWER(COALESCE(o.status,'')) NOT IN ('cancelled','canceled','void','refunded','returned','draft','deleted')
  AND COALESCE(o.is_personal_transaction,FALSE)=FALSE
  AND (LOWER(COALESCE(o.payment_status,'')) IN ('paid','completed','complete','partially_paid','partial')
       OR LOWER(COALESCE(o.status,'')) IN ('paid','completed','complete','delivered'));
```

### Q-D03 — exchange exposure
```sql
SELECT COUNT(*) AS exchange_orders,
       ROUND(SUM(COALESCE(total_amount,0))::numeric,2)                              AS legacy_revenue,
       ROUND(SUM(COALESCE(amount_due_now,0))::numeric,2)                            AS v2_revenue,
       ROUND(SUM(COALESCE(total_amount,0) - COALESCE(amount_due_now,0))::numeric,2) AS correction,
       ROUND(SUM(GREATEST(-COALESCE(exchange_difference,0),0))::numeric,2)          AS credit_retained
FROM orders WHERE COALESCE(exchange_mode,FALSE);
```

### Q-D06 — fully paid but unrecognised
```sql
SELECT COUNT(*) AS orders, ROUND(SUM(COALESCE(total_amount,0))::numeric,2) AS value
FROM orders
WHERE COALESCE(paid_amount,0) >= COALESCE(total_amount,0) AND COALESCE(total_amount,0) > 0
  AND LOWER(COALESCE(payment_status,'')) NOT IN ('paid','completed','complete','partially_paid','partial')
  AND LOWER(COALESCE(status,'')) NOT IN ('paid','completed','complete','delivered','returned','refunded','cancelled','canceled','void');
```

### Q-D07 — draft expense exposure
```sql
SELECT LOWER(COALESCE(status,'')) AS status, COUNT(*) AS n,
       ROUND(SUM(COALESCE(amount,0))::numeric,2) AS amount
FROM expenses GROUP BY 1 ORDER BY amount DESC;
```

### Q-D08 — stock source divergence
```sql
SELECT (SELECT COALESCE(SUM(stock),0) FROM products)                                  AS products_stock,
       (SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE deleted_at IS NULL) AS variants_stock,
       (SELECT COALESCE(SUM(stock),0) FROM warehouse_inventory)                       AS warehouse_stock;
```

### Q-H — COGS coverage
```sql
SELECT COUNT(*) AS sold_lines,
       COUNT(*) FILTER (WHERE COALESCE(NULLIF(pv.last_purchase_cost,0), NULLIF(pv.cost_price,0),
                                       NULLIF(p.last_purchase_cost,0),  NULLIF(p.cost_price,0)) IS NOT NULL) AS direct_cost,
       COUNT(*) FILTER (WHERE aoc.id IS NOT NULL) AS with_override
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN product_variants pv ON pv.id = oi.variant_id
LEFT JOIN products p ON p.id = COALESCE(oi.product_id, pv.product_id)
LEFT JOIN accounting_order_item_cost_overrides aoc ON aoc.order_item_id = oi.id
WHERE LOWER(COALESCE(o.status,'')) NOT IN ('cancelled','canceled','void','refunded','returned','draft','deleted');
```

### Q-J — movement-type vocabulary
```sql
SELECT LOWER(COALESCE(movement_type,'(null)')) AS movement_type, COUNT(*) AS n,
       COUNT(*) FILTER (WHERE COALESCE(quantity_change,0) > 0) AS inbound,
       COUNT(*) FILTER (WHERE COALESCE(quantity_change,0) < 0) AS outbound
FROM inventory_movements GROUP BY 1 ORDER BY n DESC;
```
Any value not classified in [`metric-contract.md` §5](./metric-contract.md#movement-type-vocabulary-discovered-not-assumed)
must be classified before sell-through or turnover is trusted.

### Q-A — channel and source vocabulary
```sql
SELECT COALESCE(NULLIF(channel,''),'(empty)') AS channel,
       COALESCE(NULLIF(source,''),'(empty)')  AS source, COUNT(*) AS orders
FROM orders GROUP BY 1,2 ORDER BY orders DESC;
```

### Q-D — status matrix
```sql
SELECT LOWER(COALESCE(status,'(null)')) AS status,
       LOWER(COALESCE(payment_status,'(null)')) AS payment_status,
       COUNT(*) AS orders, ROUND(SUM(COALESCE(total_amount,0))::numeric,2) AS total
FROM orders GROUP BY 1,2 ORDER BY orders DESC;
```
Any status not covered by the canonical predicate's literal lists must be classified before v2 ships to production.

### Q-B — row counts, for index and performance planning
```sql
SELECT 'orders' AS t, COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'purchase_items', COUNT(*) FROM purchase_items
UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'product_variants', COUNT(*) FROM product_variants
UNION ALL SELECT 'customers', COUNT(*) FROM customers
ORDER BY 2 DESC;
```

---

## 6. Test enforcement

`tests/analytics/` implements:

- `analytics-canon.test.js` — the canonical predicate against every observed status/payment-status pair.
- `analytics-discount.test.js` — the six-case fixture matrix, asserting v2 and quantifying the legacy overcount.
- `analytics-exchange.test.js` — cases A/B/C, asserting v2 revenue and the retained-credit disclosure.
- `analytics-pl-parity.test.js` — **R1 gate**: `getProfitLossReport` output identical before and after the
  `accountingCanon` extraction.
- `analytics-comparison.test.js` — comparison windows, and `null` (not 100) when the base is 0.
- `analytics-nan.test.js` — a `NaN` money row does not poison an aggregate.

Reconciliation checks RC-01…RC-12 run in `analytics-reconciliation.test.js` once the metric services land in R1.
