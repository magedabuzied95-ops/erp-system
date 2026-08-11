# Legacy discount defect — fix proposal (NOT implemented)

Status: **awaiting approval**. Nothing in this document has been applied.
Raised during R3 (Sales & Profit Intelligence) validation, 2026-08-11.

Scope note: this is a defect in a **legacy accounting report**, outside the v2
analytics surface. R3 does not touch it, and the v2 endpoints are unaffected —
they compute discount from `orders.discount_amount` alone and never subtract it
from a total that is already net.

---

## 1. Affected service

`server/services/accountingReportsV2Service.js`

Two functions, three call sites:

| Site | Function | Lines |
|---|---|---|
| A | `getOrderRevenueSnapshot` — discount aggregate | 124–127 |
| B | `getOrderRevenueSnapshot` — `net_revenue` derivation | 188 |
| C | `getAccountingReportsV2SpecialTransactions` — discount rows | 923, 929, 936 |

## 2. Current formula

```js
// Site A — sum three discount columns
const discountColumns = ["discount_amount", "invoice_discount_amount", "coupon_discount_amount"]
  .filter((column) => orderColumns.has(column));
const discountExpr = discountColumns.map((column) => `COALESCE(o.${column}, 0)`).join(" + ");

// Site B — subtract that sum from a revenue that is SUM(total_amount)
net_revenue: roundMoney(revenue - discounts - returns)
```

## 3. Correct formula

```js
// Site A — discount_amount is all-inclusive; the other two are components of it
const discountExpr = orderColumns.has("discount_amount") ? "COALESCE(o.discount_amount, 0)" : "0";

// Site B — total_amount is already net of discount, so it must not be deducted again
net_revenue: roundMoney(revenue - returns)
```

Site C takes the same single-column expression, in the `WHERE`, the `SELECT`
and the returned `amount`.

## 4. Why the current formula is wrong

**Defect 1 — the discount total is double-counted.** `orders.discount_amount` is
written from the order's `totalDiscount`, which already contains any
invoice-level or coupon discount. `invoice_discount_amount` and
`coupon_discount_amount` are *breakdown* columns, not additional charges.
Summing all three counts the invoice and coupon portions twice.

**Defect 2 — the discount is subtracted from a figure it was already removed
from.** `orders.total_amount` satisfies
`subtotal − discount_amount + service_fee + tax_amount = total_amount`.
`revenue` is `SUM(total_amount)`, so it is *already* net of discount.
`revenue − discounts` therefore removes the discount a second time, and
`net_revenue` — the base for `gross_profit` and `net_profit` — is understated by
the full discount total.

The two defects compound: the second subtraction uses the first defect's
inflated total.

## 5. Production evidence

Read-only, `erp_production`, tenant 1, 2026-08-11.

**The identity fixes which reading is true.** Across every order that carries an
invoice discount, the identity holds with `discount_amount` alone and never with
the additive reading:

| Population | Orders | Identity holds with `discount_amount` only | Identity holds if the three were additive |
|---|---|---|---|
| Orders with `invoice_discount_amount > 0` | 24 | **24** | **0** |
| All active orders, all time | 302 | **302** | 278 |

The 278 is exactly the 302 minus the 24 — the additive reading only "works"
where the extra columns are zero.

**Column population, last 30 days:**

| Column | Total | Orders affected |
|---|---|---|
| `discount_amount` | 5,920.00 | — |
| `invoice_discount_amount` | 2,910.00 | 23 |
| `coupon_discount_amount` | 0.00 | 0 |

## 6. 30-day impact

| Window | Revenue | Discounts reported (legacy) | Discounts correct | Over-reported discount | `net_revenue` legacy | `net_revenue` correct | Understatement |
|---|---|---|---|---|---|---|---|
| Last 7 days | 110,960.00 | 3,430.00 | 1,820.00 | **1,610.00** | 107,470.00 | 110,900.00 | **3,430.00** |
| **Last 30 days** | 358,605.00 | 8,830.00 | 5,920.00 | **2,910.00** | 349,715.00 | 358,545.00 | **8,830.00** |
| Last 365 days | 368,505.00 | 9,530.00 | 6,520.00 | **3,010.00** | 358,915.00 | 368,445.00 | **9,530.00** |

Over 30 days the Discounts line is overstated by **2,910 EGP** and Net Revenue —
and therefore Gross Profit and Net Profit — is understated by **8,830 EGP**.

These figures use the legacy service's own order predicate (`activeOrderClauses`)
and its own returns basis (`returns.refund_amount`). They are deliberately not
comparable to the v2 analytics numbers, which use a stricter predicate.

## 7. Affected screens

| Screen | Route | What changes |
|---|---|---|
| Financial Reports → Income Statement | `/accounting` → `FinancialReports.jsx` | `Discounts` line falls; `Net Revenue`, `Gross Profit`, `Net Profit` rise |
| Financial Reports → Dashboard summary | same page, summary tiles | same three totals |
| Financial Reports → Special Transactions | same page | per-order discount amounts fall for the 24 affected orders; the row set is unchanged, because an order with a non-zero `discount_amount` still qualifies |

API surface: `/api/accounting/reports-v2/income-statement`,
`/api/accounting/reports-v2/dashboard`,
`/api/accounting/reports-v2/special-transactions`.

## 8. Compatibility risk

**Numbers on screen will change**, and management may have been reading the
understated Net Profit for some time. That is the point of the fix, but it needs
to be an announced change, not a silent one.

- No schema change, no migration, no write path touched.
- `getProfitLossReport` (the canonical P&L in `accountingService.js`) is **not**
  affected — it does not use this expression. So the fix moves this report
  *towards* the canonical numbers, not away.
- No stored or exported figure is recomputed retroactively; only the live report
  changes.
- Risk if the fix is **not** applied: the v2 Executive Overview and the legacy
  Income Statement disagree on profit, and neither is obviously wrong to a
  reader.

Recommended: ship with a short note on the report explaining that the discount
line was previously double-counted, and the period in which the correction lands.

## 9. Exact minimal code change

```diff
--- a/server/services/accountingReportsV2Service.js
+++ b/server/services/accountingReportsV2Service.js
@@ getOrderRevenueSnapshot
-  const discountColumns = ["discount_amount", "invoice_discount_amount", "coupon_discount_amount"]
-    .filter((column) => orderColumns.has(column));
-  const discountExpr = discountColumns.length
-    ? discountColumns.map((column) => `COALESCE(o.${column}, 0)`).join(" + ")
-    : "0";
+  // discount_amount is written from the order's totalDiscount and already contains
+  // any invoice-level or coupon discount. The other two columns are a breakdown of
+  // it, so adding them counts those portions twice.
+  const discountExpr = orderColumns.has("discount_amount") ? "COALESCE(o.discount_amount, 0)" : "0";
@@ getOrderRevenueSnapshot return
-    net_revenue: roundMoney(revenue - discounts - returns),
+    // total_amount already satisfies subtotal - discount + service + tax, so the
+    // discount must not be deducted a second time here.
+    net_revenue: roundMoney(revenue - returns),
@@ getAccountingReportsV2SpecialTransactions
-    const discountColumns = ["discount_amount", "invoice_discount_amount", "coupon_discount_amount"].filter((column) => orderColumns.has(column));
-    if (discountColumns.length) {
+    const discountColumns = ["discount_amount"].filter((column) => orderColumns.has(column));
+    if (discountColumns.length) {
```

Sites A and C are one-line each; site B removes one term. Nothing else moves.

## 10. Tests required

1. `discountExpr` references `discount_amount` and neither of the breakdown
   columns — a source guard, so the sum cannot be reintroduced.
2. `net_revenue` equals `revenue − returns` for a fixture with a non-zero
   discount, proving the discount is not deducted twice.
3. Round trip on a fixture order where
   `discount_amount = invoice_discount_amount`: the Discounts line equals
   `discount_amount`, not double it.
4. Special-transactions rows: an order with only an `invoice_discount_amount`
   nested inside `discount_amount` appears once, at the `discount_amount` value.
5. Regression: the Income Statement's `gross_profit` equals
   `net_revenue − cogs` after the change, unchanged in form.

## 11. Expected corrected totals

Last 30 days, production, tenant 1:

| Line | Before | After |
|---|---|---|
| Revenue | 358,605.00 | 358,605.00 (unchanged) |
| Returns / Refunds | 60.00 | 60.00 (unchanged) |
| Discounts | 8,830.00 | **5,920.00** |
| Net Revenue | 349,715.00 | **358,545.00** |
| Gross Profit | Net Revenue − COGS | rises by 8,830.00 |
| Net Profit | Gross Profit − Expenses | rises by 8,830.00 |

COGS and Expenses are untouched, so the gain flows straight through to both
profit lines.
