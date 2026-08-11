# Reporting & Analytics Center — Proposed Architecture

Companion to [`reporting-center-audit.md`](./reporting-center-audit.md). **Proposal only — nothing implemented.**

Guiding constraints, all verified in the audit:
- `accountingService.js` is the source of truth for revenue/COGS/profit. Analytics sits **on top of it**, never beside it.
- No new dependencies. recharts, xlsx, jspdf, file-saver, jszip are already present.
- `statement_timeout = 15 s`, `PG_POOL_MAX = 10`. Every design decision below respects this.
- Additive only. `/reports`, `/analytics`, `/accounting/reports`, `/dashboard` all keep working.

---

## F. Proposed Reporting Center Architecture

### F.1 Layer model

```
                    ┌──────────────────────────────────────────┐
                    │  UI  /reports/*  (new center)            │
                    │  premium, RTL-first, light + dark         │
                    └────────────────┬─────────────────────────┘
                                     │  one filter model, one API client
                    ┌────────────────▼─────────────────────────┐
                    │  API  /api/analytics/v2/*                 │
                    │  thin controllers, RBAC + tenant enforced │
                    └────────────────┬─────────────────────────┘
                                     │
        ┌────────────────────────────▼──────────────────────────────┐
        │  analyticsQueryService   — filter → SQL fragments          │
        │  analyticsMetricsService — ONE definition per metric       │
        │  analyticsInsightsService— deterministic rule engine       │
        │  analyticsReconcileService — parity vs accountingService   │
        └────────────────────────────┬──────────────────────────────┘
                                     │ imports, never re-implements
        ┌────────────────────────────▼──────────────────────────────┐
        │  accountingService  (canonical: order predicate, cost      │
        │  precedence, net qty, gross/net sales, COGS, P&L)          │
        └───────────────────────────────────────────────────────────┘
```

The critical rule: `analyticsMetricsService` does **not** write its own order predicate or cost expression. Those are extracted from `accountingService` into a small shared module (`accountingCanon.js`) that both import, so there is physically one copy.

### F.2 Extracting the canon (R1, non-behavioural)

New file `server/services/analytics/accountingCanon.js`, populated by **moving** — not copying — these from `accountingService.js`:

| Export | Currently at |
|---|---|
| `paidOrderClauses(orderColumns)` | `accountingService.js:331` |
| `netQuantityExpr(itemColumns)` | `:5001` |
| `itemUnitCostExpr({...})` | `:5016-5021` |
| `purchaseCostLookup({...})` | `:345-407` |
| `grossSalesExpr` / `discountExpr` | `:4946-4954` |
| `expenseInclusionClauses` | `:5094-5096` |
| `firstColumn / columnExpr / coalesceColumnExpr / positiveCoalesceColumnExpr` | `:283-298` |

`accountingService.js` then imports them. Behaviour must be byte-identical — proven by a parity test that runs the old and new `getProfitLossReport` over the same fixtures.

> Note: `server/services` is gitignored with an `!` allowlist. Every new file below must be added to that allowlist or it will not deploy.

### F.3 Information architecture

`/reports` becomes a shell with a persistent filter bar and left rail:

```
مركز التقارير والتحليلات   Reporting & Analytics Center
│
├── نظرة تنفيذية        Overview        /reports
├── المبيعات            Sales           /reports/sales
├── الربحية             Profitability   /reports/profitability
├── المخزون             Inventory       /reports/inventory
├── المنتجات            Products        /reports/products      ← includes size-run analysis
├── المشتريات والموردين Purchasing      /reports/purchasing
├── العملاء             Customers       /reports/customers
├── الموظفون            Employees       /reports/employees
├── القنوات             Channels        /reports/channels      ← rendered only if >1 channel in data
├── المالية             Finance         /reports/finance       ← embeds canonical accounting reports
├── الرؤى               Insights        /reports/insights
└── التقارير القديمة    Legacy Reports  /reports/legacy        ← today's page, verbatim, unchanged
```

`/analytics` → `<Navigate to="/reports" replace />`. The 8 dead stubs and `AccountingAnalytics.jsx` are deleted in the final phase, not before.

Sidebar: `Reports` moves from the **Employees** section to its own **Analytics** section, keeping `permission: "reports.view"`.

### F.4 Screen contracts — what question each screen answers

| Screen | Question | Primary content |
|---|---|---|
| Overview | *What happened, and what changed?* | 12 KPI tiles with Δ vs comparison period; net sales & gross profit dual-axis trend; top 3 insight cards; category contribution bar |
| Sales | *Where did revenue come from?* | Time series (hour/day/week/month, granularity auto-selected from range); breakdown table switchable across category / brand / product / variant / size / colour / employee / channel / payment method; top & bottom movers |
| Profitability | *Where are we actually making money?* | Revenue vs COGS vs gross profit trend; margin by dimension; **four-quadrant scatter** (sales volume × margin %) — the "sells a lot, earns little" view; discount-impact panel; **COGS coverage %** data-quality badge |
| Inventory | *What needs attention?* | Inventory value, units, turnover, days-of-inventory, sell-through; out-of-stock / low-stock / dead / slow / fast buckets; stock aging from `inventory_movements`; capital-tied-up ranking |
| Products | *How is each model performing?* | Per-product row: units, revenue, COGS, profit, margin, stock, stock value, velocity, days-of-cover, last sale, last purchase, return rate. Expand → variants → **size grid** (matrix of size × stock × units sold × days-of-cover, with gaps in the size run highlighted) |
| Purchasing | *What are we paying, and to whom?* | Purchases over time; supplier contribution & concentration; **unit-cost trend per product from `purchase_items`**; cost increase/decrease detection; profitability of supplier-sourced stock |
| Customers | *Who is valuable, who is leaving?* | New vs returning, repeat rate, AOV, order frequency; segmentation reconciled against `customers.loyalty_tier`; at-risk / inactive lists |
| Employees | *Who performs, measured fairly?* | Per seller: orders, net sales, items/order, AOV, discount given, returns, gross profit contribution, commission. Every column has a tooltip stating its exact definition and attribution field. |
| Channels | *Which channel earns?* | Only channels present in data. Revenue, orders, AOV, margin, return rate, new-customer share |
| Finance | *Does this tie out?* | Embeds canonical `reports-v2` income statement / cash / receivables / payables + **a reconciliation strip** showing analytics vs accounting deltas |
| Insights | *What should I do next?* | Deterministic insight feed, Arabic-first, each linked to the rows that produced it |

---

## G. KPI / Metric Definitions

All formulas below are expressed against the canonical predicate `P` = `paidOrderClauses` (audit §C.3) and `NQ` = net quantity. **Nothing here invents a formula that conflicts with `accountingService`.**

### G.1 Sales

| Metric | Formula | Date field | Returns | Tax | Discount | Notes |
|---|---|---|---|---|---|---|
| Gross Sales | `SUM(COALESCE(NULLIF(o.subtotal,0), o.total_amount + discounts))` where `P` | `orders.created_at` | not deducted | included in `total_amount` | added back | `accountingService:4954` |
| Discount Amount | `SUM(o.discount_amount + o.coupon_discount_amount)` where `P` | " | — | — | — | ⚠ `invoice_discount_amount` omitted — open question #2 |
| Returns | `SUM(ri.refund_amount)` joined `returns r` (status not cancelled/rejected/void/deleted) → `orders o` under `P`; fallback `SUM(total_amount)` of returned/refunded orders | `returns.created_at` | — | — | — | `accountingService:5063-5074` |
| **Net Sales** | `Gross Sales − Discount Amount − Returns` | " | deducted | inclusive | deducted | **the headline revenue number** |
| Orders | `COUNT(*) FROM orders WHERE P` | `orders.created_at` | returned orders excluded by `P` | — | — | |
| Average Order Value | `Net Sales / Orders` | " | | | | 0 when Orders = 0 |
| Items Sold | `SUM(NQ)` over `order_items` joined orders under `P` | `orders.created_at` | net of returns | — | — | |
| Items per Order | `Items Sold / Orders` | " | | | | |
| Discount % | `Discount Amount / Gross Sales` | " | | | | 0 when gross = 0 |
| Cancellation Rate | `COUNT(status IN ('cancelled','canceled','void')) / COUNT(all non-draft orders)` | " | — | — | — | denominator deliberately **not** `P` |
| Return Rate (value) | `Returns / Gross Sales` | " | | | | |
| Return Rate (units) | `SUM(oi.returned_quantity) / SUM(oi.quantity)` under `P` | " | | | | |

### G.2 Profitability

| Metric | Formula | Source |
|---|---|---|
| Unit Cost | override → `pv.last_purchase_cost` → `pv.cost_price` → `p.last_purchase_cost` → `p.cost_price` → latest `purchase_items` cost → avg `purchase_items` cost → `0` | `accountingService:5016-5021`, `:345-407` |
| **COGS** | `SUM(NQ × GREATEST(unit_cost, 0))` under `P` | `accountingService:5030` |
| **Gross Profit** | `Net Sales − COGS` | `accountingService:5160` |
| Gross Margin % | `Gross Profit / Net Sales` | 0 when net sales = 0 |
| Operating Expenses | `SUM(e.amount)` where status not cancelled/rejected/void/deleted, on `expense_date` **+** journal expense lines excluding account `5000` | `accountingService:5078-5156` |
| **Net Profit** | `Gross Profit − Operating Expenses` | `accountingService:5175` |
| **COGS Coverage %** *(new, data quality)* | `SUM(NQ) FILTER (unit_cost > 0) / SUM(NQ)` under `P` | Surfaced as a badge next to every margin figure. Below 95 % ⇒ the margin is understated and the UI says so and links to `/accounting/cost-fix`. |

> Per-dimension gross profit (by category/brand/product/variant/employee/channel/supplier) uses **line-level** net sales — `oi.total_amount × NQ/oi.quantity` — and allocates order-level discount pro-rata by line share, mirroring `dashboardAnalyticsService:381-386`. The sum of all dimension slices must equal the order-level Net Sales; this is asserted by a reconciliation test.

### G.3 Inventory — **stock source is `product_variants.stock`, never `products.stock`**

| Metric | Formula | Notes |
|---|---|---|
| Units in Stock | `SUM(pv.stock)` where `pv.deleted_at IS NULL AND pv.is_active` | |
| Inventory Value | `SUM(pv.stock × unit_cost)` using the **same cost precedence as COGS** | fixes audit D.6 |
| Out of Stock | `COUNT(variants WHERE stock <= 0)` | |
| Low Stock | `COUNT(variants WHERE stock > 0 AND stock <= GREATEST(pv.low_stock_alert, p.product_low_stock_threshold, 1))` | respects `products.low_stock_tracking_mode` |
| Sales Velocity | `SUM(NQ) / days_in_range` per variant | |
| Days of Inventory | `pv.stock / NULLIF(velocity, 0)` | `NULL` (not 999) when velocity = 0 — rendered as "لا توجد مبيعات" |
| Sell-through Rate | `SUM(NQ) / (opening_stock + received_in_period)` where received comes from `inventory_movements` with `movement_type` in the purchase-in set | requires movement-type vocabulary confirmation |
| Inventory Turnover | `COGS_in_period / average_inventory_value`, average = `(opening + closing)/2` reconstructed from `inventory_movements.quantity_after` | |
| Dead Stock | `stock > 0 AND` no sale in `N` days (default 90, configurable) | uses last `order_items` sale date, **not** product creation |
| Slow Moving | `stock > 0 AND 0 < velocity` and `days_of_inventory > 120` | |
| Fast Moving | top decile by velocity with `days_of_inventory < 21` | |
| Stock Aging | buckets 0-30/31-60/61-90/90+ days since the inbound movement that supplied current quantity, from `inventory_movements(created_at, quantity_change, unit_cost)` | first genuine use of the movement ledger for valuation |
| Capital Tied Up | `SUM(stock × unit_cost)` restricted to dead + slow buckets | |

### G.4 Size-run intelligence (footwear)

| Metric | Formula |
|---|---|
| Size Run Completeness | `COUNT(DISTINCT size WHERE stock > 0) / COUNT(DISTINCT size ever stocked)` per (product, colour) |
| Missing Sizes | sizes with historical sales or historical stock but `stock = 0` today |
| Fast Sizes | per (product, colour), sizes above the median velocity within the same product |
| Chronic Stockouts | sizes crossing to `stock = 0` more than `k` times in the range, counted from `inventory_movements.quantity_after` transitions |
| Minimum-size Breach | `COUNT(DISTINCT size WHERE stock > 0) < products.minimum_distinct_sizes_required` — the field already exists |

### G.5 Customers

| Metric | Formula |
|---|---|
| Total Customers | `COUNT(customers)` in tenant, `status <> 'inactive'` |
| New Customers | `COUNT(customers WHERE created_at IN range)` |
| Returning Customers | customers with ≥1 order in range **and** ≥1 order before range start (orders under `P`) |
| Repeat Purchase Rate | customers with ≥2 orders in range / customers with ≥1 |
| CLV | `SUM(net sales)` per customer over all time under `P` — **computed, not read from `customers.total_spent`**, and the two are compared in the reconciliation panel |
| Average Spend | CLV / orders |
| Segment | behavioural: `VIP / High Value / Frequent / New / At Risk / Inactive` on CLV + order count + recency, **shown side by side with `customers.loyalty_tier`**; thresholds tenant-configurable, defaults taken from the existing `buildCustomerIntelligence` values so nothing shifts silently |

### G.6 Employees

Attribution field precedence must be stated on screen: `orders.seller_user_id` → `sales_employee_id` → `salesperson_id`. (`orders.employee_id` does not exist — audit §C.1.)

| Metric | Formula |
|---|---|
| Employee Net Sales | Net Sales grouped by attribution field, under `P` |
| Employee Orders / AOV / Items per Order | as §G.1, grouped |
| Discount Given | `SUM(discount_amount + coupon_discount_amount)` grouped |
| Returns | return value on orders attributed to the seller |
| Profit Contribution | line-level Gross Profit grouped by attribution field |
| Commission | read from `employee_commissions` / `salesCommissionService` — **not recomputed** |

### G.7 Purchasing

| Metric | Formula |
|---|---|
| Purchase Value | `SUM(pu.total)` where `status NOT IN ('cancelled','canceled','void','deleted','draft') AND deleted_at IS NULL AND reversed_at IS NULL` |
| Supplier Contribution % | supplier purchase value / total |
| Supplier Concentration | share of top supplier; HHI across suppliers |
| Average Purchase Cost | `SUM(pi.total)/SUM(pi.quantity)` per product/variant |
| Cost Change | latest period unit cost vs prior period, per (product, variant), from `purchase_items` joined `purchases.created_at` |
| Last Purchase | `MAX(pu.created_at)` per product |
| Supplier-sourced Profitability | gross profit of items whose resolved unit cost traces to that supplier's purchase lines |

### G.8 Channels

`channel_group` derived at query time from a `SELECT DISTINCT channel, source` discovery, folded as: `pos` | `website` (`website`,`storefront`,`online`) | `whatsapp` | `facebook` (`facebook`,`facebook_messenger`,`messenger`) | `instagram` | `web_chat` | `other`. Channels with zero orders in range are **not rendered**.

### G.9 Comparison periods

| Mode | Definition |
|---|---|
| Previous period | same length, immediately preceding (`reportsService:185-199` already does this correctly) |
| Previous month | same day-of-month window one calendar month back |
| Previous year | same window one calendar year back |
| Custom | explicit `compareFrom` / `compareTo` |

Δ = `current − previous`; Δ% = `(current − previous) / ABS(previous)`, and **`null` when previous = 0** — rendered as "—", never as `100 %`. (Current code returns 100 %, which is misleading.)

---

## H. Proposed Backend / API Architecture

### H.1 New files

```
server/services/analytics/
  accountingCanon.js          ← moved from accountingService (F.2)
  analyticsFilters.js         ← parse + validate the shared filter contract
  analyticsScope.js           ← tenant + RBAC-derived column masking
  analyticsSalesService.js
  analyticsProfitService.js
  analyticsInventoryService.js
  analyticsProductService.js
  analyticsPurchasingService.js
  analyticsCustomerService.js
  analyticsEmployeeService.js
  analyticsChannelService.js
  analyticsInsightsService.js
  analyticsReconcileService.js
  analyticsCache.js           ← bounded LRU, replaces the unbounded Map
server/controllers/analyticsV2Controller.js
server/routes/analyticsV2.js
```
Mounted at `app.use("/api/analytics/v2", analyticsV2Routes)`. Existing `/api/analytics` and `/api/reports` are untouched.

### H.2 Endpoints

Every endpoint: `protect` + `permit("reports","view")` + tenant scope + the RBAC cost mask (H.4). Every response carries a common envelope.

| Method | Path | Purpose | Extra permission | Key params | Response |
|---|---|---|---|---|---|
| GET | `/v2/meta` | filter option lists + **discovered channels** + available dimensions | — | — | `{branches, warehouses, categories, brands, suppliers, employees, channels, paymentMethods}` |
| GET | `/v2/overview` | Executive KPIs + trend + top insights | — | filter | `{kpis[], trend[], contribution[], insights[]}` |
| GET | `/v2/sales/timeseries` | sales over time | — | filter + `granularity=auto\|hour\|day\|week\|month` | `{points[], totals, comparison}` |
| GET | `/v2/sales/breakdown` | one generic breakdown endpoint | — | filter + `dimension=category\|brand\|product\|variant\|size\|color\|employee\|channel\|payment_method\|branch` + `sort`, `page`, `limit` | `{rows[], totals, pagination}` |
| GET | `/v2/profit/summary` | revenue / COGS / gross profit / margin + comparison + **cogsCoverage** | `reports.profit` | filter | `{current, previous, delta, cogsCoverage}` |
| GET | `/v2/profit/breakdown` | margin by dimension | `reports.profit` | filter + `dimension` | `{rows[], totals}` |
| GET | `/v2/profit/quadrants` | four-quadrant scatter | `reports.profit` | filter + `dimension` | `{points[], medians}` |
| GET | `/v2/inventory/summary` | value, units, turnover, DOI, sell-through, bucket counts | `reports.cost` | filter | `{kpis, buckets}` |
| GET | `/v2/inventory/items` | paginated stock table | `reports.cost` | filter + `bucket`, `sort`, `page` | `{rows[], pagination}` |
| GET | `/v2/inventory/aging` | aging buckets from movements | `reports.cost` | filter | `{buckets[]}` |
| GET | `/v2/products/performance` | per-product performance table | — | filter + `sort`, `page` | `{rows[], pagination, totals}` |
| GET | `/v2/products/:id/variants` | variant + size grid for one product | — | filter | `{variants[], sizeGrid, gaps[]}` |
| GET | `/v2/purchasing/summary` | purchases over time + supplier mix | `reports.cost` | filter | `{trend[], suppliers[], concentration}` |
| GET | `/v2/purchasing/cost-trends` | unit-cost change per product/variant | `reports.cost` | filter + `page` | `{rows[]}` |
| GET | `/v2/customers/summary` | new/returning/repeat/AOV | — | filter | `{kpis, segments[]}` |
| GET | `/v2/customers/list` | segmented customer table | `customers.view` | filter + `segment`, `page` | `{rows[], pagination}` |
| GET | `/v2/employees/performance` | seller leaderboard | `employees.view` | filter | `{rows[], attributionField}` |
| GET | `/v2/channels/performance` | channel comparison | — | filter | `{rows[]}` — empty array if ≤1 channel |
| GET | `/v2/insights` | deterministic insight feed | — | filter + `category`, `severity` | `{insights[], generatedAt}` |
| GET | `/v2/reconcile` | analytics vs accounting parity | `accounting.view` | filter | `{checks[]}` |
| GET | `/v2/export` | server-side export honouring active filters | **`reports.export`** | filter + `report`, `dimension`, `format=csv\|xlsx` | file stream |

Design notes:
- **One `breakdown` endpoint with a `dimension` param**, not nine endpoints. `dimension` is validated against a hard allowlist mapped to SQL fragments — never interpolated.
- No endpoint returns more than `limit` (max 200) rows. Totals are computed **in SQL**, never by summing the returned page.
- Every response includes `{ meta: { filters, generatedAt, comparison, warnings[] } }`. `warnings[]` is how data-quality problems surface instead of being swallowed.

### H.3 Error policy — the opposite of today

`safeQuery`-style swallowing is banned in the new services. A failed query returns **HTTP 500 with the failing metric named**. A metric that cannot be computed because data is missing returns `null` with a `warnings[]` entry, and the UI renders "غير متاح" — never `0`.

### H.4 RBAC and cost masking

Two new permissions, registered in `CORE_PERMISSIONS` alongside the existing `reports:view` / `reports:export`:

| Permission | Gates |
|---|---|
| `reports:cost` | unit cost, COGS, inventory value, purchase cost, supplier cost |
| `reports:profit` | gross profit, margin %, profit contribution, quadrants |

Enforcement is **in the service layer**, not the controller: `analyticsScope.js` returns a `scope` object, and cost/profit columns are omitted from the SELECT list entirely when not permitted. Hiding them in the UI is not sufficient and not relied upon.

Backfill: grant both to `admin` / `super_admin` / `owner` on first run, matching the existing `ensureCorePermissions` pattern, so current admin behaviour is unchanged.

Separately, and as its own decision: `/api/dashboard/*` currently has **no** RBAC (audit D.8). Recommend adding `permit("dashboard","view")` plus `reports:cost`-masking for its profit fields. This changes who can see what and needs your sign-off.

### H.5 Caching

`analyticsCache.js` — bounded LRU (default 300 entries), key = `tenantId | endpoint | normalised filters | permission-scope hash`. TTL by endpoint: `meta` 300 s, `overview`/`summary` 120 s, breakdown/list 60 s, `insights` 300 s, `reconcile` 0 (never cached). Explicit `?fresh=1` bypass. **Permission scope is part of the key** so a masked response can never be served to a permitted user or vice versa.

---

## I. Proposed Frontend Architecture

```
src/modules/reports/
  pages/
    ReportsCenter.jsx           ← shell: header, filter bar, left rail, <Outlet/>
    OverviewReport.jsx
    SalesReport.jsx
    ProfitabilityReport.jsx
    InventoryReport.jsx
    ProductsReport.jsx
    PurchasingReport.jsx
    CustomersReport.jsx
    EmployeesReport.jsx
    ChannelsReport.jsx
    FinanceReport.jsx
    InsightsReport.jsx
    Reports.jsx                 ← UNCHANGED, re-mounted at /reports/legacy
  components/
    FilterBar.jsx               DateRangePicker.jsx  ComparisonPicker.jsx
    KpiTile.jsx                 DeltaBadge.jsx       MetricTooltip.jsx
    AnalyticsChart.jsx          ← thin recharts wrapper: theme tokens, RTL, EGP tooltip
    AnalyticsTable.jsx          ← server-driven: sort, page, column visibility, sticky header, totals row
    DimensionSwitcher.jsx       DrilldownBreadcrumb.jsx
    InsightCard.jsx             EmptyState.jsx  ErrorState.jsx  DataQualityBadge.jsx
  hooks/
    useAnalyticsFilters.js      ← URL-synced filter state (single source of truth)
    useAnalyticsQuery.js        ← fetch + abort + cache + error surface
    useDrilldown.js
  services/
    analyticsV2Api.js
  lib/
    metricDefinitions.js        ← metric key → Arabic/English label + formula text for tooltips
    formatters.js               ← delegates to shared/lib/currency
```

Principles:

1. **Filters live in the URL query string.** `useAnalyticsFilters` reads/writes `?from=&to=&compare=&branch=&category=&…`. Navigating between report tabs preserves them; the page is shareable and back/forward works. This replaces the current `localStorage` preset hack.
2. **Fix the re-fetch loop.** `Reports.jsx:194-201` rebuilds `requestFilters` every render and drives a `useEffect` on it. The new `useAnalyticsQuery` keys on a stable serialised filter string and aborts in-flight requests on change.
3. **No client-side aggregation.** Totals come from the API. `AnalyticsTable` sorts and pages by re-querying.
4. **At most 3 concurrent requests per screen**, respecting `PG_POOL_MAX = 10`. Below-the-fold panels lazy-load on intersection.
5. **Theme.** Uses `src/theme` tokens and M1 Gold `#a47a12`. Works in the default light theme and in dark. No hardcoded `#080b10`, no emerald accents, no gradients beyond a single subtle header wash.
6. **RTL first.** `dir` from `i18n.language`; logical properties (`ps-`/`pe-`/`ms-`/`me-`) throughout; recharts axes and legends reversed in RTL; numbers rendered LTR inside RTL text.
7. **i18n.** All copy in the existing `reports` and `analytics` namespaces. No inline `isArabic ? "…" : "…"`.
8. **Currency.** `shared/lib/currency.formatCurrency` only.
9. **Every KPI tile has a `MetricTooltip`** rendering the formula from `metricDefinitions.js` — satisfying "every KPI must have a documented formula" in the product itself.
10. **Three explicit states per panel**: loading skeleton, empty (with the reason), error (with retry + the failing metric name).
11. **Responsive**: desktop 12-col grid; tablet 6-col; mobile single column with horizontally scrollable tables and a collapsible filter sheet.

### I.1 Chart strategy

Every chart, with its justification. All recharts, all already-available primitives.

| Screen | Business question | Chart | X | Y / Series | Drill-down | Tooltip |
|---|---|---|---|---|---|---|
| Overview | Is revenue and profit trending up? | Composed: area (net sales) + line (gross profit) | time bucket | EGP | click bucket → Sales filtered to that bucket | date, net sales, gross profit, margin %, Δ vs comparison |
| Overview | Where does revenue concentrate? | Horizontal bar, top 8 + "أخرى" | EGP | category | click → Sales breakdown, category applied | category, net sales, share %, Δ |
| Sales | How does the period trend? | Line, current vs comparison as a dashed series | time bucket | EGP | click → order list | both periods, Δ, Δ% |
| Sales | Which hours matter? | Heatmap grid (CSS grid, not a chart lib) | hour 0-23 | day of week | click cell → filtered orders | orders, net sales |
| Sales | Who/what leads? | Ranking table (not a chart) | — | — | row click → next dimension | — |
| Profitability | Sales vs margin trade-off | **Scatter**, quadrants split at median volume and median margin | units sold | margin % | point click → product detail | product, units, revenue, COGS, profit, margin |
| Profitability | Where is margin eroding? | Grouped bar: revenue vs COGS by dimension | dimension | EGP | click → dimension drill | revenue, COGS, gross profit, margin % |
| Inventory | How is capital distributed? | Stacked bar by bucket (healthy/slow/dead/OOS) | category | EGP value | click segment → item list pre-filtered | bucket, value, unit count, share |
| Inventory | How old is the stock? | Bar, 4 aging buckets | bucket | EGP | click → item list | bucket, value, units |
| Products | Size-run health | **Size grid matrix** (CSS grid: size × colour, cell = stock, colour-coded by days-of-cover) | size | colour | cell click → variant history | size, colour, stock, sold, velocity, days of cover |
| Purchasing | Are costs rising? | Line, one series per selected product | purchase date | unit cost EGP | point click → purchase invoice | date, supplier, unit cost, Δ vs previous |
| Purchasing | Are we over-dependent? | Donut, **top 5 + أخرى only** | — | supplier share | click → supplier detail | supplier, value, share % |
| Customers | New vs returning | Stacked bar | time bucket | customer count | click → customer list | new, returning, total |
| Channels | Which channel earns? | Grouped bar: net sales + margin % on a second axis | channel | EGP / % | click → Sales filtered to channel | orders, net sales, AOV, margin, return rate |

Deliberately excluded: pie/donut anywhere with >6 slices, radial gauges, 3-D anything, sparkline walls, and any chart whose only purpose is decoration.

### I.2 Tables

`AnalyticsTable` supports server-side sort / page / search, column visibility (persisted per report in `localStorage`), sticky header, a pinned totals row from the API, a comparison column (Δ / Δ%), row click → drill-down, and per-column formatters (currency, number, percent, date, text). Product tables include the product image via the existing `shared/lib/imageUrls`. Default page size 25, max 200.

### I.3 Exports

Reuse only what exists.

| Format | Path | Notes |
|---|---|---|
| CSV | `GET /v2/export?format=csv` | **Server-side**, streamed, honours the exact active filters and the caller's cost/profit permission mask. UTF-8 BOM so Excel opens Arabic correctly. |
| Excel | `GET /v2/export?format=xlsx` | Server-side via `xlsx` (already a dependency, usable in Node). One sheet per requested section. |
| PDF | client, existing `jspdf` + `jspdf-autotable` | ⚠ **Arabic requires an embedded font.** Options: (a) register a subsetted Cairo/Amiri TTF as a base64 VFS asset — no new npm package, but adds ~120 KB to a lazy chunk; (b) keep PDF English-only and route Arabic through Print. **Needs your decision.** |
| Print | `window.print()` on a print-stylesheet route | Best Arabic fidelity today. Recommended as the primary Arabic paper output. |

Export is gated on `reports:export` — closing audit D.14.

---

## J. Drill-down Strategy

### J.1 Model

Drill-down is a **filter mutation plus a route change**, never a new bespoke screen. `useDrilldown` pushes a `{dimension, value, label}` frame onto a stack held in the URL, so back/forward and sharing work.

```
Overview  →  Sales (dimension=category)
          →  Sales (dimension=brand,    category=X)
          →  Sales (dimension=product,  category=X, brand=Y)
          →  Products/:id  (variant + size grid)
          →  Variant history
          →  /orders?…  or  /orders/:id     ← EXISTING screens, reused
```

Terminal nodes always hand off to screens that already exist:

| From | To | Existing route |
|---|---|---|
| invoice / order row | order detail | `/orders/:id` |
| product row | product detail | `/products/:id` |
| customer row | customer profile | existing customers module |
| supplier row | supplier detail | `/suppliers/:id` |
| purchase row | purchase detail | `/purchases/:id` |
| P&L line | canonical accounting report | `/accounting/reports` |
| missing-cost warning | cost fix centre | `/accounting/cost-fix` |

No invoice, product, customer, or supplier UI is duplicated.

### J.2 Breadcrumb

`DrilldownBreadcrumb` renders the stack (`الشركة › رجالي مستورد › نايك › Model X › 42 / أسود`); clicking a crumb pops back to it. Filters applied via the filter bar and filters applied via drill-down are the same state — visible and removable in one place.

---

## K. Performance Strategy

### K.1 Rules

1. **All aggregation in SQL.** The browser formats; it never sums.
2. **Every query is bounded** by tenant + date range. A missing date range defaults to the last 30 days server-side. Ranges longer than 400 days are rejected with a clear message rather than silently truncated.
3. **Hard row caps** (`limit` ≤ 200) with SQL-computed totals, so caps never distort numbers.
4. **≤ 3 concurrent requests per screen**; the rest lazy-load. Rationale: `PG_POOL_MAX = 10`.
5. **Every query must complete in < 5 s**, against a 15 s `statement_timeout`. Any endpoint exceeding 5 s on the production dataset is a bug, not a tuning opportunity.
6. **Bounded LRU cache** with permission scope in the key (H.5).
7. **No N+1.** The variant/size grid is one query returning all variants for the product, not one per variant.

### K.2 Known hot spots and mitigations

| Hot spot | Why | Mitigation |
|---|---|---|
| `purchaseCostLookup` LATERAL | runs per order-item line when no override/variant/product cost exists; `purchase_items` has **no index on `(product_id, variant_id)`** | index below; plus surface **COGS Coverage %** so heavy fallback is visible rather than merely slow |
| Multi-dimension breakdown | joins `order_items → orders → products → categories/brands` | driven by `idx_order_items_tenant_order_id` + `idx_orders_tenant_created`; dimension allowlist keeps the join set minimal |
| Comparison periods | doubles every query | run the current and comparison aggregate in **one** query with `FILTER (WHERE …)` clauses over a union of both windows, not two round trips |
| `/v2/insights` | needs many inputs | computed from the already-cached summary endpoints; never re-queries raw tables |
| Stock aging | window functions over `inventory_movements` | `idx_inventory_movements_tenant_variant_created` already exists and is ideal |

### K.3 Proposed indexes — evidence-based, minimal

Only three, each tied to a specific query. **Not created until the roadmap phase that introduces the query that needs it**, and each verified with `EXPLAIN (ANALYZE, BUFFERS)` before and after on production-like data.

| # | Index | Query it improves | Expected benefit | Trade-off |
|---|---|---|---|---|
| 1 | `CREATE INDEX CONCURRENTLY idx_purchase_items_tenant_product_variant ON purchase_items (tenant_id, product_id, variant_id, id DESC)` | `purchaseCostLookup` LATERAL — currently a seq scan of `purchase_items` **per order line lacking a cached cost**. Also serves cost-trend queries. | Largest single win in the whole plan; affects both the new analytics **and** the existing canonical P&L. | One extra index on a moderate-write table; ~4 cols. Writes are batch purchase saves, not hot-path. |
| 2 | `CREATE INDEX CONCURRENTLY idx_purchases_tenant_created ON purchases (tenant_id, created_at DESC, id DESC)` | purchases-over-time, supplier trend, payables ageing. `purchases` today has only `(tenant_id)`. | Turns purchase time-series from a scan+sort into an index range scan. | Low. Mirrors the existing `orders` pattern. |
| 3 | `CREATE INDEX CONCURRENTLY idx_return_items_return ON return_items (return_id, order_item_id)` and `idx_returns_tenant_created ON returns (tenant_id, created_at DESC)` | canonical Returns figure (`accountingService:5064-5074`) and all return-rate metrics. `returns`/`return_items` have no analytics indexes. | Returns become cheap enough to include in every net-sales query. | Low; both are small tables. |

Explicitly **not** proposing: any index on `products` (already 20+), `order_items` (well covered), or `inventory_movements` (excellently covered). No materialised views in the first release — revisit only if K.2 mitigations prove insufficient on real data.

### K.4 Reconciliation (Phase 12)

`analyticsReconcileService` compares, for the same filters:

| Check | Analytics | Canonical |
|---|---|---|
| Net Sales | `/v2/profit/summary.netSales` | `getProfitLossReport().revenue.net_sales` |
| COGS | `.cogs` | `.cogs.total_cogs` |
| Gross Profit | `.grossProfit` | `.gross_profit` |
| Expenses | `.expenses` | `.total_expenses` |
| Net Profit | `.netProfit` | `.net_profit` |
| Returns | `.returns` | `.revenue.returns` |
| Inventory Value | `/v2/inventory/summary.value` | `reports-v2/inventory` |
| Purchases | `/v2/purchasing/summary.total` | `reports-v2/payables` |
| Dimension sum | `Σ breakdown rows` | endpoint totals (internal consistency) |

Tolerance: 0.01 EGP. Any breach is **surfaced in the Finance screen with the delta and both sources named**. Numbers are never adjusted to force agreement.

---

## Phased roadmap

Each phase is independently shippable, additive, and reversible by removing its route.

| Phase | Goal | Backend | Frontend | DB | Tests | Risk | Rollback | Acceptance |
|---|---|---|---|---|---|---|---|---|
| **R0** | Approval + one read-only production query for channel/status/movement-type vocabulary | — | — | read-only `SELECT` | — | none | n/a | Open questions 1-5 answered |
| **R1** | Extract `accountingCanon.js`; `analyticsFilters`, `analyticsScope`, `analyticsCache`; `/v2/meta`; permissions `reports:cost`, `reports:profit` | canon extraction + 1 endpoint | none | permission rows via `ensureCorePermissions` | **P&L parity test: old vs new `getProfitLossReport` byte-identical** | Medium — touches accounting | revert commit; canon is a pure move | P&L output unchanged; `/v2/meta` returns real dimensions |
| **R2** | Reports Center shell + Overview | `/v2/overview` | `ReportsCenter`, `OverviewReport`, `FilterBar`, `KpiTile`, `AnalyticsChart` | — | metric unit tests; RBAC; tenant isolation | Low | remove `/reports/overview` route; `/reports` still serves legacy | 12 KPIs with Δ; every tile has a formula tooltip; < 5 s |
| **R3** | Sales Analytics | `/v2/sales/timeseries`, `/v2/sales/breakdown` | `SalesReport`, `AnalyticsTable`, `DimensionSwitcher` | — | date-boundary, granularity, dimension allowlist, empty-data | Low | route removal | Every dimension in G.1 works; totals = SQL totals |
| **R4** | Profitability | `/v2/profit/*` | `ProfitabilityReport`, quadrant scatter | index #1 | COGS parity vs accounting; cost-mask tests; cogsCoverage | **Medium — margins become visible** | route removal; index is additive | Gross profit matches `getProfitLossReport` to 0.01 EGP |
| **R5** | Inventory Intelligence | `/v2/inventory/*` | `InventoryReport` | — | stock-source test (must use `product_variants.stock`); aging; turnover | Medium — will contradict today's inventory value | route removal | Inventory value matches `reports-v2/inventory` |
| **R6** | Product + size-run | `/v2/products/*` | `ProductsReport`, size grid | — | size-gap detection; variant rollup; N+1 guard | Low | route removal | Size grid renders; gaps flagged; one query per product |
| **R7** | Purchasing & suppliers | `/v2/purchasing/*` | `PurchasingReport` | indexes #2 | cost-trend correctness; concentration math | Low | route removal | Cost trends match `purchase_items` |
| **R8** | Customers | `/v2/customers/*` | `CustomersReport` | — | segmentation vs `loyalty_tier`; CLV vs `total_spent` | Low | route removal | Both segmentations shown side by side |
| **R9** | Employees + Channels | `/v2/employees/*`, `/v2/channels/*` | `EmployeesReport`, `ChannelsReport` | — | attribution precedence; empty-channel suppression | Low | route removal | Attribution field named on screen; no fake channels |
| **R10** | Finance | `/v2/reconcile` | `FinanceReport` embedding `reports-v2` | index #3 | reconciliation suite | Low | route removal | All 9 checks green or the delta is shown |
| **R11** | Deterministic insights | `/v2/insights` | `InsightsReport`, `InsightCard` | — | one test per rule incl. non-firing cases | Low | route removal | Every insight is Arabic, explainable, and links to its rows |
| **R12** | Exports, polish, performance | `/v2/export` | print stylesheet, a11y pass | — | export honours filters + permission mask; `EXPLAIN` budget test | Low | export route removal | Every endpoint < 5 s; exports match on-screen numbers |
| **R13** | Production validation + cleanup | — | delete 8 dead stubs + `AccountingAnalytics.jsx`; `/analytics` → redirect | — | full suite | Low | restore files | Reconciliation green on production data |

Legacy `/reports` (today's page) survives through R13 at `/reports/legacy` and is only retired on your explicit sign-off.

---

## Testing strategy (written before implementation)

Node's built-in test runner, matching the existing `tests/*.test.js` convention.

| Suite | Covers |
|---|---|
| `analytics-metrics.test.js` | every formula in §G against fixtures: gross/net sales, discounts, returns, COGS, gross profit, margin, AOV, items/order |
| `analytics-order-predicate.test.js` | cancelled / draft / deleted / refunded / returned / personal / partially-paid orders each included or excluded exactly as `paidOrderClauses` dictates |
| `analytics-cost-precedence.test.js` | all 7 rungs of the unit-cost ladder, including the purchase-lookup LATERAL and the 0-cost fallback |
| `analytics-returns.test.js` | `returned_quantity` net qty; `return_items.refund_amount` path; the returned-order fallback path; partial returns |
| `analytics-date-boundaries.test.js` | inclusive `from`/`to`; timezone; month/year granularity; DST-free `timestamp without time zone` semantics; 400-day cap |
| `analytics-comparison.test.js` | previous period / month / year; `previous = 0` → `null`, never 100 % |
| `analytics-rbac.test.js` | `reports:view` / `reports:cost` / `reports:profit` — masked columns absent from the **response body**, not just the UI |
| `analytics-tenant-isolation.test.js` | every v2 endpoint; explicitly includes the `customer-intelligence` leak class from audit D.7 |
| `analytics-inventory.test.js` | stock read from `product_variants.stock`; turnover; DOI; sell-through; dead/slow classification; aging buckets |
| `analytics-size-run.test.js` | size-run completeness, missing sizes, `minimum_distinct_sizes_required` breach |
| `analytics-empty-data.test.js` | every endpoint on a tenant with zero orders returns structured empty + `warnings`, never `NaN`, never a fabricated number |
| `analytics-reconciliation.test.js` | all 9 checks in §K.4 against seeded data |
| `analytics-pl-parity.test.js` | **R1 gate**: `getProfitLossReport` before/after canon extraction |
| `analytics-performance.test.js` | seeded large dataset; asserts every endpoint < 5 s and issues no unbounded query |
| `analytics-export.test.js` | CSV/XLSX rows equal on-screen rows; filters honoured; permission mask honoured; Arabic UTF-8 BOM |

---

## Risks and unknowns

| # | Risk | Impact | Handling |
|---|---|---|---|
| 1 | **Corrected numbers will differ from what management sees today** — often materially, since current figures include cancelled/draft/personal orders and treat purchases as COGS | High, political | Legacy reports stay live. The Finance screen shows both, with the delta and the reason. No silent replacement. |
| 2 | **COGS coverage may be poor** — if many order lines resolve to unit cost 0, margins are understated | High | `COGS Coverage %` is a first-class KPI from R4, linked to the existing `/accounting/cost-fix` tool. We report the gap; we do not paper over it. |
| 3 | `products.stock` vs `product_variants.stock` divergence | Medium | R5 ships a comparison panel showing the drift before anything depends on it |
| 4 | Channel vocabulary is unconstrained and edit paths accept arbitrary strings | Medium | Driven by a discovery query + explicit grouping; unrecognised values fall into "أخرى" and are listed |
| 5 | `purchase_items` has no supporting index; the COGS LATERAL may be slow on production volumes | Medium | Index #1 lands in R4 with before/after `EXPLAIN (ANALYZE, BUFFERS)` |
| 6 | Extracting the canon touches `accountingService.js` (5 774 lines) | High if wrong | Pure move, no logic edits, gated by the R1 parity test; separate commit, easy revert |
| 7 | Unknown production data volume | Medium | R0 read-only query includes row counts for `orders`, `order_items`, `purchase_items`, `inventory_movements` before any index or query design is finalised |
| 8 | `getTenantId` honours `x-tenant-id` when `req.user.tenant_id` is null | Medium | v2 endpoints derive tenant from `req.user` only, ignoring headers and query params |
| 9 | 15 s `statement_timeout` on long ranges | Medium | 400-day cap; 5 s budget; performance test in CI |
| 10 | Arabic PDF | Low | Decision required (§I.3); Print is the recommended Arabic path meanwhile |
