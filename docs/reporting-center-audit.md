# Reporting & Analytics — System Audit

Status: **audit only, no code changed.** Produced before any implementation.
Repo baseline: branch `main`, HEAD `2b5b9fe`, identical to `origin/main` (0 ahead / 0 behind).
Working tree: no modified/staged tracked files (only untracked scratch files at repo root: `ai*.js`, `hits*.txt`, `pk.js`, `pwa.js`, etc.). Stashes `stash@{0}`, `stash@{1}` left untouched.

---

## A. Current System Findings

### A.1 Stack and conventions (verified, no new dependencies needed)

| Concern | What exists | Notes |
|---|---|---|
| Frontend | React 19 + Vite 8, React Router 7, Tailwind 4 | `src/modules/<domain>/{pages,components,services,hooks}` is the established layout |
| Charts | **recharts ^3.8.1** | Already used by `Reports.jsx`, `Dashboard.jsx`, `AnalyticsDashboard.jsx`. No new chart lib required. |
| Tables | Hand-rolled `<table>` per page | No data-grid dependency exists. Do not add one. |
| Dates | **No date library.** Native `Date` + `Intl` only | `date-fns`/`dayjs` are absent. Keep it that way; do date math server-side in SQL. |
| Excel | `xlsx ^0.18.5` + `file-saver ^2.0.5` | Already dynamically imported in `Reports.jsx` |
| PDF | `jspdf ^4.2.1` + `jspdf-autotable ^5.0.7` | Already used. **Arabic is broken** — `analyticsExport.js:424` uses `helvetica`, which has no Arabic glyphs. |
| Zip | `jszip` | available |
| Currency | `src/shared/lib/currency.js` — `formatCurrency`/`formatNumber`, EGP default, locale-aware, cached formatters | Canonical. Reports.jsx bypasses it with its own `Intl.NumberFormat` hardcoded to `en-US`. |
| i18n | `react-i18next`, namespaces per domain. `reports` and `analytics` namespaces **already exist** in `src/locales/{ar,en}/` | `Reports.jsx` ignores them and hardcodes Arabic string maps inline. |
| Theme | `src/theme/themes.js` — default theme `light`, single accent "M1 Gold" `#a47a12` | `Reports.jsx` and `AnalyticsDashboard.jsx` are hardcoded dark (`bg-[#080b10]`) with emerald accents — **off-system**. |
| Backend | Express 5, `pg` Pool, ESM. `server/routes/*.js` → `server/controllers/*.js` → `server/services/*.js` | 168 services, 40 controllers, 57 route files |
| DB | PostgreSQL 18, 183 tables, `public` schema, no ORM — raw SQL | `server/database/db.js` |
| Auth | JWT, `protect` middleware | `server/middleware/authMiddleware.js` |
| RBAC | `permit(module, action)` — `server/middleware/permissionMiddleware.js` | `reports:view` and `reports:export` permissions exist in `CORE_PERMISSIONS` |
| Tenancy | `getTenantId(req, req.user?.tenant_id)` + `isSuperAdminUser(req.user)` → `tenant_id = $1` or unscoped for super-admin | `server/utils/requestScope.js` |
| Migrations | Idempotent `ensure*Schema()` functions run from services + `server/database/migrations/` | No migration framework |

### A.2 Hard operational constraint

`server/database/db.js:12-13` sets **`statement_timeout` / `query_timeout` = 15 000 ms** and **`PG_POOL_MAX` = 10**.
Any analytics query must finish well inside 15 s, and a report page that fires 8 parallel requests can consume most of the pool. This is the single most important constraint on the design.

### A.3 Server-side services gitignore trap

`server/services` is gitignored with an explicit `!` allowlist. Any new service file must be added to the allowlist or it will never deploy.

---

## B. Existing Reports Inventory

### B.1 Backend reporting endpoints

| # | Endpoint | Handler | Service | Tables | Permission | Status |
|---|---|---|---|---|---|---|
| 1 | `GET /api/reports/dashboard` | `reportsController.getReportsDashboard` | `reportsService.getDashboardReport` | orders, order_items, purchases, products, customers, expenses, attendance_logs, customer_loyalty_history, branches | `reports:view` | Live, **numbers unreliable** (see D) |
| 2 | `GET /api/reports/sales` | `getSalesReports` | `reportsService.getSalesRows` | orders, order_items, products, branches, sales_employees, employees | `reports:view` | Live |
| 3 | `GET /api/reports/employees` | `getEmployeeReports` | `getEmployeeRows` | employees, attendance_logs, shift_opening_assignments, orders | `reports:view` | Live |
| 4 | `GET /api/reports/inventory` | `getInventoryReports` | `getInventoryRows` | products | `reports:view` | Live, **uses legacy `products.stock`** |
| 5 | `GET /api/reports/customers` | `getCustomerReports` | `getCustomerRows` | customers, orders | `reports:view` | Live |
| 6 | `GET /api/reports/financial` | `getFinancialReports` | `getFinancialRows` | derived from #1 | `reports:view` | Live, **circular arithmetic** |
| 7 | `GET /api/reports/insights` | `getAiInsights` | `getBusinessInsights` | all of the above ×2 (current + previous period) | `reports:view` | Live, expensive |
| 8 | `GET /api/reports/export` | `exportReport` | `getReportPayload` + `toCsv` | — | **`reports:view`** (should be `reports:export`) | Live |
| 9 | `GET /api/analytics/overview` | `analyticsController.getAnalyticsOverview` | inline SQL | orders, customers, purchases, expenses, cashbox, products | `reports:view` | Live |
| 10 | `GET /api/analytics/sales` | `getSalesAnalytics` | inline SQL | orders, order_items, products | `reports:view` | Live |
| 11 | `GET /api/analytics/profit` | `getProfitAnalytics` | inline SQL | orders, purchases, expenses, cashbox | `reports:view` | Live, **not gross profit** |
| 12 | `GET /api/analytics/inventory` | `getInventoryIntelligence` | inline SQL | products, product_variants, warehouse_inventory, inventory_movements | `reports:view` | Live, **broken paths** |
| 13 | `GET /api/analytics/customers` | `getCustomerAnalytics` | inline SQL | customers, orders | `reports:view` | Live |
| 14 | `GET /api/analytics/ai-insights` | `getAiInsights` | inline SQL | composite | `reports:view` | Live, **hardcoded strings** |
| 15 | `GET /api/analytics/reorder-suggestions` | `getReorderSuggestions` | inline SQL + JS | products, product_variants, warehouse_inventory, order_items | `reports:view` | Live, **fails open with `success:true, items:[]`** |
| 16 | `GET /api/analytics/dead-stock` | `getDeadStockAnalysis` | inline SQL | products, product_variants, warehouse_inventory, orders, order_items | `reports:view` | Live, same fail-open |
| 17 | `GET /api/analytics/customer-intelligence` | `getCustomerIntelligence` | inline SQL | customers, orders, order_items, products, categories | `reports:view` | Live, **not tenant-scoped on `customers`** |
| 18 | `GET /api/dashboard/overview` | `dashboardController.overview` | `dashboardAnalyticsService.getOverview` | orders, order_items, products, product_variants, purchases, customers, cashbox, expenses | **`protect` only — no RBAC** | Live |
| 19 | `GET /api/dashboard/sales-trend` | `salesTrend` | `getSalesTrend` | orders | **no RBAC** | Live |
| 20 | `GET /api/dashboard/top-products` | `topProducts` | `dashboardAnalyticsService` | order_items, products | **no RBAC** | Live |
| 21 | `GET /api/dashboard/low-stock` | `lowStock` | " | products, product_variants | **no RBAC** | Live |
| 22 | `GET /api/dashboard/live-activity` | `liveActivity` | " | orders, activity_logs | **no RBAC** | Live |
| 23 | `GET /api/dashboard/branch-performance` | `branchPerformance` | " | orders, branches | **no RBAC** | Live |
| 24 | `GET /api/dashboard/payment-analytics` | `paymentAnalytics` | " | orders | **no RBAC** | Live |
| 25 | `GET /api/dashboard/hourly-sales` | `hourlySales` | " | orders | **no RBAC** | Live |
| 26 | `GET /api/dashboard/marketing` | `marketing` | " | marketing_* | **no RBAC** | Live |
| 27 | `GET /api/dashboard/pos-live` | `posLive` | " | orders, cashbox, shifts | **no RBAC** | Live |
| 28 | `GET /api/dashboard/inventory` | `inventory` | " | products, product_variants | **no RBAC** | Live |
| 29 | `GET /api/dashboard/ai-insights` | `aiInsights` | " | composite | **no RBAC** | Live |
| 30 | `GET /api/accounting/financial-reports/profit-loss` | `getProfitLossReportController` | **`accountingService.getProfitLossReport`** | orders, order_items, product_variants, products, purchases, purchase_items, `accounting_order_item_cost_overrides`, returns, return_items, expenses, journal_entries, journal_entry_lines, accounts | `accounting:view` | **CANONICAL P&L** |
| 31 | `GET /api/accounting/financial-reports/ledgers` | `getLedgersReportController` | `accountingService` | ledger_entries, journal_* | `accounting:view` | Canonical |
| 32 | `GET /api/accounting/financial-reports/trial-balance` | `getTrialBalanceReportController` | `accountingService` | accounts, journal_entry_lines | `accounting:view` | Canonical |
| 33 | `GET /api/accounting/financial-reports/balance-sheet` | `getBalanceSheetReportController` | `accountingService` | accounts, journal_* | `accounting:view` | Canonical |
| 34 | `GET /api/accounting/reports-v2/dashboard` | `getAccountingReportsV2DashboardController` | `accountingReportsV2Service` | composite | `accounting:view` | Canonical |
| 35 | `GET /api/accounting/reports-v2/income-statement` | " | `accountingReportsV2Service:243` | orders, order_items, expenses, returns | `accounting:view` | Canonical |
| 36 | `GET /api/accounting/reports-v2/cash-accounts` | " | `:545` | financial_accounts, money_transactions, cashbox_movements | `accounting:view` | Canonical |
| 37 | `GET /api/accounting/reports-v2/receivables` | " | `:287` | orders, customers | `accounting:view` | Canonical |
| 38 | `GET /api/accounting/reports-v2/payables` | " | `:410` | purchases, suppliers | `accounting:view` | Canonical |
| 39 | `GET /api/accounting/reports-v2/inventory` | " | `:773` | products, product_variants, purchase_items | `accounting:view` | Canonical (inventory value + COGS) |
| 40 | `GET /api/accounting/reports-v2/special-transactions` | " | `:909` | orders, returns, employee_advances | `accounting:view` | Canonical |
| 41 | `GET /api/accounting/summary` / `/dashboard` / `/treasury` | `accountingController` | `accountingService` | composite | `accounting:view` / `treasury.dashboard:view` | Canonical |
| 42 | `GET /api/accounting/cost-fix/missing-cost-items` | `getMissingCostItemsController` | `accountingService` | order_items + cost overrides | `accounting:edit` | **Data-quality tool — reuse for reconciliation** |
| 43 | `GET /api/marketing/analytics/*` | `marketingAnalyticsController` | `marketingAnalyticsService`, `marketingAttributionAnalyticsService` | marketing_post_analytics, marketing_attribution_events, orders | `marketing:view` | Live |
| 44 | `GET /api/manager-portal/:token/dashboard` \| `/sales` | `managerPortalService:767,1061` | " | orders, order_items, employees | token + `managerProfitLock` | Live — **has a working profit-visibility gate worth copying** |
| 45 | `GET /api/attendance/reports` | `attendanceController` | " | attendance_logs, employees | `attendance:view` | Live |
| 46 | `GET /api/smart-warehouse/*` | `smartWarehouseController` | `smartReorderService.getSmartReorderSuggestions` | product_variants, purchase_items, inventory_movements | `warehouses:view` | Live — **reorder logic already exists here** |

### B.2 Frontend reporting surfaces

| Route | Component | LOC | In sidebar? | Frontend guard | Notes |
|---|---|---|---|---|---|
| `/reports` | `src/modules/reports/pages/Reports.jsx` | 826 | Yes (`reports.view`, under **Employees** section) | **none** | Main report page. 7 parallel API calls on every filter change. |
| `/analytics` | `src/modules/analytics/pages/AnalyticsDashboard.jsx` | 1238 | **No — orphan route** | **none** | Second, competing analytics page. Unreachable from nav. |
| `/dashboard` | `src/pages/Dashboard.jsx` | 1388 | Yes | none | Executive dashboard, 12 `/dashboard/*` endpoints |
| `/accounting/reports` | `src/modules/accounting/pages/FinancialReports.jsx` | 803 | via `/accounting` | — | 7 reports-v2 tabs, `Promise.allSettled` + per-tab error surfacing — **best-practice example in this repo** |
| `/accounting/profit-loss` | `ProfitAndLoss.jsx` | 171 | via `/accounting` | — | canonical P&L view |
| `/accounting/general-ledger` | `GeneralLedger.jsx` | 271 | " | — | |
| `/accounting/trial-balance` | `TrialBalance.jsx` | 214 | " | — | |
| `/accounting/cost-fix` | `CostFixCenter.jsx` | — | " | — | fixes missing COGS |
| `/orders` | `OrdersDashboard.jsx` | 2195 | Yes | — | has its own KPI strip |
| `/inventory` | `InventoryDashboard.jsx` | 1018 | Yes | — | has its own stock KPIs |
| `/purchases`, `/suppliers` | `PurchasesDashboard.jsx` 716, `SuppliersDashboard.jsx` 784 | Yes | — | purchase KPIs |
| `/marketing/analytics` | `MarketingAnalytics.jsx` | 235 | Yes | `marketing.view` | |
| `/employees` | `EmployeeAnalyticsWorkspace.jsx` | 723 | Yes | — | |
| `/employees/reports` | `AttendanceReports.jsx` | 394 | Yes | — | |
| `/admin/ai-agent-analytics` | `AiAgentAnalytics.jsx` | 443 | Yes (adminOnly) | — | |
| `/loyalty` | `LoyaltyDashboard.jsx` | 237 | — | — | |
| — | `AccountingAnalytics.jsx` | 125 | no route (redirected away) | — | **dead** |
| — | `src/modules/reports/pages/{Sales,Orders,Products,Profit,Inventory,Customers,Tax,Analytics}Reports.jsx` | 9 each | no | — | **8 dead stubs — `return <div>Sales Reports Page</div>`** |

### B.3 Duplicate / conflicting surfaces

- **`/reports` vs `/analytics`** — two independent reporting pages, two independent backend modules (`reportsService` vs `analyticsController`), computing overlapping metrics with different formulas. `/analytics` is not reachable from the sidebar.
- **`/reports` "Financial" tab vs `/accounting/reports`** — the former invents its own P&L, the latter is the canonical one.
- **Dead stock / reorder** exists in *three* places: `analyticsController.buildDeadStockAnalysis`, `analyticsController.buildReorderSuggestions`, and `smartReorderService.getSmartReorderSuggestions`.
- **Customer segmentation** exists in *two* places with different thresholds: `analyticsController.buildCustomerIntelligence` (SQL `CASE`) and the CRM/loyalty tier on `customers.loyalty_tier`.
- **"Profit"** is defined **four** different ways — see D.1.

---

## C. Existing Data Architecture

### C.1 Verified schema (from `schema_only.sql`, PostgreSQL 18 dump — 183 tables)

**`orders`** (~145 columns). Relevant:
`id, tenant_id, branch_id, warehouse_id, customer_id, created_at, updated_at, status, payment_status, payment_method, payment_breakdown(jsonb), channel(NOT NULL default 'pos'), source(NOT NULL default 'pos'), subtotal, discount_amount, coupon_discount_amount, invoice_discount_amount, invoice_discount_type/value/reason, tax_amount, service_fee, delivery_fee, shipping_fee, shipping_cost, total_amount, total, total_price(legacy), paid_amount, change_amount, cash_amount, card_amount, wallet_payment_amount, cashier_id, cashier_user_id, seller_user_id, sales_employee_id, salesperson_id, salesperson_name, salesperson_commission_type/value, employee/shift: shift_id, attendance_log_id, cancelled_at, cancelled_by, cancel_reason, returned_at, deleted_at, deleted_by, is_personal_transaction, exchange_mode, original_order_id, exchange_credit_amount, exchange_difference, marketing_source, marketing_platform, marketing_campaign, marketing_post_id, attribution_type, customer_type, stock_restored_at, inventory_rollback_done`

> **`orders` has no `employee_id` column.** `reportsService.getEmployeeRows` builds its sales sub-query conditionally on `orders.employee_id` and therefore always takes the `WHERE FALSE` branch — **employee revenue in `/reports` is always 0.**

**`order_items`**:
`id, order_id, tenant_id, product_id, variant_id, quantity, returned_quantity, price, sale_price, unit_price, discount_amount, tax_amount, total_amount, line_total, subtotal, product_name, variant_name, sku, barcode, size, color, sales_employee_id, price_source, ...images`

> **`order_items` stores NO cost.** There is no `cost`, `cost_price`, `unit_cost`, or `cost_total` column. COGS must be reconstructed at query time. This is the single biggest constraint on profitability analytics.

**`products`**: `id, tenant_id, name, category_id, brand_id, unit_id, manufacturer_id, supplier_id, warehouse_id, sku, barcode, price, sale_price, regular_price, selling_price, cost_price, purchase_price, last_purchase_cost, last_purchase_price, average_cost, wholesale_price, tax_rate, stock, low_stock_alert, product_low_stock_threshold, low_stock_tracking_mode, minimum_distinct_sizes_required, status, is_active, variation_mode, fixed_size_label, gender, product_type, style, grade, main/sub/child_category, category(text), brand(text), carton_size, suggested_purchase_cartons, updated_at`

> **`products` has NO `created_at` column** (confirmed in both `schema_only.sql` and `server/database/schema.sql`). Any query filtering `p.created_at` throws.
> `products.stock` is **legacy and unmaintained** — nothing in `server/` writes it.

**`product_variants`**: `id, product_id, tenant_id, color, size, sku, barcode, article_code, **stock**, low_stock_alert, cost_price, purchase_price, last_purchase_cost, last_purchase_price, average_cost, price, sale_price, regular_price, selling_price, wholesale_price, supplier_id, manufacturer_id, warehouse_id, branch_id, purchase_pack_type/qty, reorder_trigger_percent, default_purchase_qty, edition_name/slug, is_active, deleted_at, created_at, updated_at`

> **`product_variants.stock` is the canonical live stock.** Written by `inventoryMovementService:354`, `inventoryService`, `ordersController`, `productsController`, `storefrontController`, `stockReconciliationService`.

**`warehouse_inventory`**: `id, warehouse_id, variant_id, stock, branch_id, section_id`
> **No `tenant_id`. No `created_at`.** Only written by `smartWarehouseService` and `warehousesController` — a *partial*, secondary per-warehouse ledger, not the system-wide stock source.

**`purchases`**: `id, tenant_id, supplier_id, warehouse_id, purchase_number, status(default 'draft'), payment_status, supplier_payment_status, subtotal, tax_amount, discount_amount, total, paid_amount, supplier_paid_amount, remaining_amount, payment_account_id, payment_method, stock_applied, stock_applied_at, deleted_at, reversed_at, created_at, updated_at`

**`purchase_items`**: `id, purchase_id, product_id, variant_id, tenant_id, quantity, cost_price, unit_cost, total, tax_amount, discount_amount, selling_price, sale_price, regular_price, wholesale_price, article_code`
> This is the **historical cost source** — supports cost-change analysis over time.

**`returns`**: `id, tenant_id, order_id, return_number, status, reason, restock, refund_amount, refund_method, exchange_difference, shift_id, cashier_user_id, created_by, created_at`
**`return_items`**: `id, tenant_id, return_id, order_item_id, variant_id, quantity, refund_amount, restock`

**`inventory_movements`**: `id, tenant_id, product_id, variant_id, warehouse_id, branch_id, section_id, movement_type, quantity, quantity_before, quantity_change, quantity_after, quantity_delta, before_qty, after_qty, unit_cost, total_cost, reference_type, reference_id, reason, notes, customer_id, created_by, created_at, undone_at, undone_by`
> Best-indexed table in the system for time-series inventory analytics. **`unit_cost`/`total_cost` here enable true stock-aging and movement valuation.**

**`customers`**: `id, tenant_id, name, phone, email, branch_id, status, balance, wallet_balance, loyalty_points, loyalty_tier, total_spent, total_orders, completed_orders, is_trusted, cod_enabled, registration_source, customer_source, lead_source, marketing_source, marketing_platform, attribution_type, is_storefront_customer, first_visit_at, last_visit_at, ai_* scores, created_at, updated_at`

**`expenses`**: `id, tenant_id, branch_id, warehouse_id, employee_id, supplier_id, title, amount, category, category_id, expense_type, expense_date(date), status(default 'draft'), source, payment_method, financial_account_id, money_account_id, cashbox_id, shift_id, journal_entry_id, approved_at/by, rejected_at/by, paid_at/by, recurring_expense_id, created_at`

**`accounting_order_item_cost_overrides`**: `id, tenant_id, order_item_id, product_id, variant_id, unit_cost, reason, created_by, created_at` — **highest-precedence cost source.**

**Accounting core**: `accounts, journal_entries, journal_entry_lines, journal_lines, ledger_entries, financial_accounts, financial_account_entries, financial_account_transfers, money_accounts, money_transactions, cashbox, cashbox_movements, cash_drawer_shifts, payment_transactions, payment_method_account_mappings`. Account `5000` = COGS, and `getProfitLossReport` explicitly excludes it from operating expenses to avoid double-counting (`accountingService.js:5131-5133`).

**Dimensions available**: `categories`, `brands`, `manufacturers`, `units`, `branches`, `warehouses`, `warehouse_sections`, `suppliers`, `sales_employees`, `employees`, `users`.
**Footwear/size dimensions**: `product_variants.size`, `.color`, `.article_code`; `order_items.size`, `.color`; `products.gender/product_type/style/grade`; `products.minimum_distinct_sizes_required` (already a size-run concept).

### C.2 Channels — what actually exists

`orders.channel` (NOT NULL, default `'pos'`) and `orders.source` (NOT NULL, default `'pos'`) are the only order-level channel fields. Writers found in code:

| Value | Written by |
|---|---|
| `pos` | `ordersController.js:999, 2399` (default) |
| `website` | `ordersController.js:3051, 3615` (`source`) |
| `storefront` | `storefrontController.js:4720` (`channel`) |
| `web_chat`, `whatsapp`, `instagram`, `facebook` | `aiAgentOrderService.js:31` `ORDER_CHANNELS` — AI-agent-created orders |
| free-form | `ordersController.js:999` accepts `body.channel \|\| body.order_type \|\| body.source`, and `:5493` lets any string through on edit |

`managerPortalService.js:1191` already treats `('web_chat','website','storefront','online','instagram','facebook','whatsapp')` as "online".

> **Unverified against production data.** The channel *vocabulary* is not constrained by the schema and edit paths accept arbitrary strings. **The channel report must be driven by a `SELECT DISTINCT channel` discovery query, not a hardcoded list**, and must fold `website`/`storefront` and `facebook`/`facebook_messenger`/`messenger` into canonical groups. Marketing-level channel/attribution lives separately in `orders.marketing_source/marketing_platform/attribution_type` and `marketing_attribution_events`.

### C.3 Canonical business logic — the source of truth

`server/services/accountingService.js` is the **single source of truth** for revenue, COGS, and profit. Every new metric must be derived from these exact expressions.

**Order inclusion predicate** — `paidOrderClauses()`, `accountingService.js:331-343`:
```sql
LOWER(COALESCE(o.status,'')) NOT IN ('cancelled','canceled','void','refunded','returned','draft','deleted')
AND COALESCE(o.is_personal_transaction, FALSE) = FALSE
AND (
      LOWER(COALESCE(o.payment_status,'')) IN ('paid','completed','complete','partially_paid','partial')
   OR LOWER(COALESCE(o.status,''))         IN ('paid','completed','complete','delivered')
)
```

**Net quantity** — `accountingService.js:5001`:
```sql
GREATEST(COALESCE(oi.quantity,0) - COALESCE(oi.returned_quantity,0), 0)
```

**Unit cost precedence** — `accountingService.js:5016-5021`, first non-zero wins:
1. `accounting_order_item_cost_overrides.unit_cost`
2. `product_variants.last_purchase_cost` → `product_variants.cost_price`
3. `products.last_purchase_cost` → `products.cost_price`
4. `purchaseCostLookup` LATERAL (`:345-407`): most recent non-cancelled `purchase_items` unit cost for that (product, variant), else the average

**Revenue** — `accountingService.js:4946-4954`:
```sql
gross  = COALESCE(NULLIF(o.subtotal,0), o.total_amount + discounts)
disc   = COALESCE(o.discount_amount,0) + COALESCE(o.coupon_discount_amount,0)
returns= SUM(ri.refund_amount)   -- preferred; else total of returned/refunded orders
net_sales    = gross - disc - returns
gross_profit = net_sales - total_cogs
net_profit   = gross_profit - total_expenses
```

**Expense inclusion** — `accountingService.js:5094-5096`: `status NOT IN ('cancelled','canceled','rejected','void','deleted')`, date column `expense_date` preferred over `created_at`.

**Profit visibility gate** — `managerPortalService.canViewProfitForManager` + `managerProfitLock` (short-lived `profitToken`). Existing, working pattern.

---

## D. Problems / Technical Debt Found

### D.1 CRITICAL — four incompatible definitions of "profit"

| Source | Formula | Order filter | Cost basis |
|---|---|---|---|
| `accountingService.getProfitLossReport` (**canonical**) | `(gross − discounts − returns) − COGS − expenses` | full `paidOrderClauses` | override → variant → product → purchase lookup |
| `dashboardAnalyticsService.calculateTodayProfit:355-456` | `Σ(net line revenue − cost×net qty) − order-level discount − expenses` | status filter + personal, **no payment_status** | `pv.cost_price` → `p.cost_price` only |
| `reportsService.getDashboardReport:260` | `totalSales − purchases_in_period − expenses` | **none at all** | n/a (cash-basis purchases) |
| `analyticsController.getProfitSummary:239` | `revenue − purchases − expenses` | **none at all** | n/a |

The same business, same date range, will show four different profit numbers on four different screens. Rows 3 and 4 are not profit in any accounting sense — they subtract *purchases made this period* from *sales this period*.

### D.2 CRITICAL — `/reports` reports revenue that includes cancelled, draft, deleted and personal orders

`reportsService.buildOrderScope` (`:201-222`) builds its `WHERE` from `tenant_id`, dates, branch, warehouse, employee, customer, shift, payment method — and **nothing else**. It never touches `o.status`, `o.payment_status`, `o.deleted_at`, or `o.is_personal_transaction`. Every sales figure on `/reports` is inflated by cancelled orders, drafts, soft-deleted orders, and the owner's personal transactions.

The same is true of every query in `analyticsController.js`.

### D.3 CRITICAL — "Gross profit" on `/reports` equals revenue

`reportsService.js:206`: `costExpr = col("oi", itemColumns, ["cost_total","purchase_cost","cost"], "0")`.
`order_items` has none of those columns → the expression is the literal `0`.
`:390`: `gross_profit = SUM(item total) − SUM(0)` = revenue.
Top-products "gross profit" on `/reports` is revenue, mislabelled.

### D.4 CRITICAL — silent query failure everywhere

`reportsService.safeQuery:72-80`, `analyticsController.safeRows:14-22` and `dashboardAnalyticsService.safeQuery` all catch SQL errors, log to console, and return `[]` / `0`. A broken query renders as a **zero, not an error**. This directly violates "do not hide data inconsistencies."

`analyticsController.getReorderSuggestions:1281-1289` and `getDeadStockAnalysis:1303-1311` go further: on error they return **HTTP 200 `{success:true, items:[]}`**.

### D.5 CRITICAL — `/api/analytics/inventory` is broken whenever a date filter is applied

`buildWhereClause({alias:"p", dateColumn:"created_at"})` emits `DATE(p.created_at) >= $n`, but **`products` has no `created_at`**. With a date range set, every `productsScope` query in `buildInventoryIntelligence` (inventory value, low stock, dead stock, predicted sales) throws and returns `[]` — silently, per D.4. Inventory value renders as **0**.

The warehouse-filtered branch is worse: `buildWhereClause({alias:"wi", ...})` emits `wi.tenant_id = $1 AND DATE(wi.created_at) …`, and **`warehouse_inventory` has neither column**. That entire code path always fails.

### D.6 HIGH — inventory value is computed from a dead column

`reportsService.getInventoryRows:531` and `analyticsController:449` value inventory as `products.stock × products.cost_price`. **Nothing writes `products.stock`** — the live figure is `product_variants.stock`. Reported inventory value is wrong (typically 0 or frozen at import time).

### D.7 HIGH — cross-tenant customer exposure in `/api/analytics/customer-intelligence`

`analyticsController.buildCustomerIntelligence:914-926`: the `customer_sales` CTE selects `FROM customers c LEFT JOIN orders o ON o.customer_id = c.id <tenant clause moved into the JOIN>`. **There is no `WHERE` on `customers`.** Customers of *all* tenants enter the result set (with zero totals), and the endpoint returns `customer_name, phone, email`. `LIMIT 50 ORDER BY total_spent DESC` means the leak surfaces whenever the current tenant has fewer than 50 spending customers. The `product_mix` CTE likewise scans **all** `order_items` unscoped.

### D.8 HIGH — `/api/dashboard/*` has no RBAC at all

All 12 routes in `server/routes/dashboard.js` are `protect` only. Revenue, profit, cost-derived margins, branch performance and payment breakdowns are readable by **any authenticated user**, including cashiers. This contradicts the existing effort in commit `7e57272` ("hide purchase costs from cashiers").

### D.9 HIGH — fabricated numbers presented as analysis

- `analyticsController:421-432` — `predictedSales`: `SUM(stock) * 1.08` with a hardcoded `confidence = 84`.
- `analyticsController:475-480` — `smartAlerts` falls back to two hardcoded fake alerts when the query returns nothing.
- `analyticsController:582-583` — `growthRate` = `revenue/orders/1000` clamped to `[3,30]`, labelled "estimated growth bias".
- `analyticsController:259` — `buildSeries` selects `SUM(o.paid_amount) AS profit`. Paid amount is not profit.
- `reportsService:355` — `profitTrend` = monthly revenue minus `expenses / number_of_months`, an even spread that corresponds to nothing.
- `Reports.jsx:698-700` — every KPI card renders a progress bar hardcoded to `w-2/3`.

### D.10 MEDIUM — schema guessing instead of schema knowledge

`reportsService.getColumns/pickColumn/col` introspects `information_schema` at runtime and picks whichever column name exists first. This is why D.3 silently degraded to `0`. `accountingService` uses the same helper style but with correct, verified name lists — the pattern is only safe when the fallback is a hard failure, not a `0`.

### D.11 MEDIUM — unbounded in-process caches

`reportsService.cache` (`:4`) is a module-level `Map` keyed on `JSON.stringify(filters)` with a 60 s TTL and **no eviction and no size cap**. `dashboardAnalyticsService.tableExistsCache` / `columnExistsCache` are permanent (acceptable). The reports cache grows with every distinct filter combination for the process lifetime.

### D.12 MEDIUM — client-side aggregation and over-fetching

`Reports.jsx:203-233` fires **7 concurrent requests** on every filter change (`useEffect` on `requestFilters`, which is a new object identity each render pass), then `:194-201` overrides `limit` to 100 and does all search, sort, and pagination **in the browser** (`:256-279`). The "Showing X of Y rows" footer therefore describes only the first 100 server rows. `AnalyticsDashboard.jsx:819-947` sums `total_spent` and `estimated_blocked_capital` client-side over server-truncated arrays (`LIMIT 50`), so the totals are wrong by construction.

Against `PG_POOL_MAX = 10`, a single `/reports` page load can occupy 7 of 10 connections; `/reports/insights` internally runs `getDashboardReport` **twice** (current + previous period) plus five more row queries.

### D.13 MEDIUM — index gaps for the queries analytics will run

`orders` is well covered: `(tenant_id, created_at DESC, id DESC)`, `(tenant_id, channel, created_at DESC)`, `(tenant_id, source, created_at DESC)`, `(tenant_id, customer_id, created_at DESC)`, `(tenant_id, salesperson_id, created_at DESC)`, `(tenant_id, sales_employee_id, created_at DESC)`, `(tenant_id, seller_user_id, created_at DESC)`, `(tenant_id, shift_id, created_at DESC)`, `(branch_id, created_at DESC)`.
`order_items`: `(tenant_id, order_id, id)`, `(product_id, order_id)`, `(variant_id, order_id)`.
`inventory_movements`: excellent — `(tenant_id, created_at)`, `(tenant_id, product_id, created_at)`, `(tenant_id, variant_id, created_at)`, `(tenant_id, movement_type, created_at)`.

**Missing, and directly on the critical path:**
- `purchase_items` has only `(purchase_id)`. The `purchaseCostLookup` LATERAL joins on `(product_id, variant_id)` — **no supporting index**. This is the most expensive part of every COGS query.
- `purchases` has only `(tenant_id)` and `(id)` — no `(tenant_id, created_at)`.
- `returns` / `return_items` — no indexes listed at all.
- `warehouse_inventory` — only `(branch_id)`, `(section_id)`; nothing on `variant_id`.

### D.14 LOW — assorted

- `/api/reports/export` is gated on `reports:view`, not the existing `reports:export`.
- `reportsService.buildLiteralWhere:147-156` interpolates values directly into SQL. Values pass through `Number()` first so it is not currently injectable, but it is a landmine.
- `analyticsController.getProfitSummary:224` reads cash balance as `SELECT c.balance FROM cashbox c WHERE DATE(c.created_at) BETWEEN … ORDER BY created_at DESC LIMIT 1` — a *balance* filtered by a *date range* is meaningless.
- `Reports.jsx:292` uses `window.prompt` for preset naming.
- `Reports.jsx` renders raw DB column names as table headers (`column.replaceAll("_"," ")`) — no Arabic, no formatting, no types.
- 8 dead stub pages in `src/modules/reports/pages/`; `AccountingAnalytics.jsx` is dead.
- PDF export cannot render Arabic (`helvetica`).
- `Reports.jsx` and `AnalyticsDashboard.jsx` are hardcoded dark with emerald accents against a light-default, M1-Gold design system.
- `getTenantId` falls back to the `x-tenant-id` header / `?tenant_id` query param when `req.user.tenant_id` is null. Not exploitable for normal users but worth hardening for analytics endpoints.

---

## E. Reporting Gaps

Capabilities the data supports but no report provides today:

**Sales**
- Period-over-period comparison on any KPI (only `/reports/insights` does it, internally, and never exposes both numbers)
- Sales by category / brand / supplier / manufacturer — `products.category_id`, `brand_id`, `supplier_id`, `manufacturer_id` all exist and are indexed, unused by reporting
- Sales by size / colour / article code — `order_items.size/color`, `product_variants.article_code` exist, unused
- Sales by `channel` and by `source` as distinct dimensions
- Sales by `seller_user_id` vs `cashier_user_id` vs `salesperson_id` (three different people per order, all recorded, none reported)
- Growth/decline ranking (fastest-growing, declining products)
- Items per order, discount %, cancellation rate, return rate

**Profitability**
- Gross margin by *any* dimension (category, brand, product, variant, employee, channel, supplier)
- The four-quadrant view (high/low sales × high/low margin)
- Discount impact on margin
- Missing-cost coverage % — how much of reported COGS is real vs. defaulted to 0 (`getMissingCostItems` exists but is not surfaced as a data-quality KPI)

**Inventory**
- Inventory value from the correct source (`product_variants.stock × unit cost`)
- Inventory turnover, sell-through rate, days of inventory
- Stock aging using `inventory_movements` (fully supported — `created_at`, `quantity_change`, `unit_cost` all present)
- Size-run completeness for footwear: missing sizes, sizes chronically out of stock, fast/slow sizes. `products.minimum_distinct_sizes_required` already encodes the intent.
- Capital tied up in slow movers, per category/brand

**Purchasing & suppliers**
- Cost trend per product/variant over time from `purchase_items` (fully supported, never queried for analytics)
- Supplier price increase/decrease detection
- Supplier concentration / dependence
- Profitability of supplier-sourced inventory
- Purchase frequency and lead-time proxy

**Customers**
- New vs returning, repeat purchase rate, cohort retention
- CLV grounded in the canonical order filter (`customers.total_spent` is a denormalised counter of unknown provenance)
- Reconciliation of `customers.loyalty_tier` with a behavioural segmentation

**Employees**
- Any working revenue attribution (D.2 note: currently always 0)
- Profit contribution, discount given, return rate per seller
- Commission reconciliation against `employee_commissions` / `salesCommissionService`

**Cross-cutting**
- Drill-down of any kind — every chart is a dead picture
- A shared, persistent filter model
- Server-side export honouring active filters (the current export re-runs the report with `limit` semantics that differ from the screen)
- Deterministic, explainable insights with links back to the underlying rows
- Any reconciliation check between the analytics numbers and `accountingService`

---

## Open questions requiring your decision

1. **`deleted_at`** — `paidOrderClauses` excludes `status='deleted'` but never checks `o.deleted_at IS NOT NULL`. Should soft-deleted orders be excluded from the canonical predicate? This would change existing accounting output, so I will not touch it without an explicit decision.
2. **`invoice_discount_amount`** — the canonical discount expression sums `discount_amount + coupon_discount_amount` but omits `invoice_discount_amount`. Is invoice discount already folded into `discount_amount`, or is it currently unreported?
3. **Exchange orders** — `exchange_mode`, `original_order_id`, `exchange_credit_amount`. Should an exchange count as a new sale, a net difference, or be excluded?
4. **Channel vocabulary** — I need one read-only `SELECT channel, source, COUNT(*) FROM orders GROUP BY 1,2` against production to build the canonical grouping. May I run it, or will you provide the output?
5. **Scope of fixes** — D.1 through D.8 are pre-existing production defects. Do you want them fixed as part of this work (changing numbers management currently sees), or reported as-is with the new centre built correctly alongside?
