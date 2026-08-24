# Legacy reporting — parity matrix

What each legacy reporting capability was, where it is answered correctly now, and what
was deliberately not carried over.

Recorded 2026-08-24, when `/analytics` was retired. `/reports` is still routed; see the
sign-off note at the bottom.

---

## `/analytics` — RETIRED, redirects to `/reports/overview`

Never linked from the navigation, and carrying three confirmed defects of its own. Every
capability has a canonical home, so the redirect loses nothing.

| Legacy capability | Endpoint | Canonical replacement | Parity |
|---|---|---|---|
| Overview KPIs | `analytics/overview` | `/reports/overview` | **Superset.** 12 KPIs with comparison, formula tooltips, coverage metadata. Legacy had no comparison and no canonical order predicate. |
| Sales | `analytics/sales` | `/reports/sales` | **Superset.** Breakdown by five dimensions, product matrix, size intelligence, server-side table. |
| Profit | `analytics/profit` | `/reports/sales` + `/reports/overview` | **Corrected.** Legacy profit used a non-canonical cost path; v2 uses the canonical ladder and publishes COGS coverage. |
| Inventory | `analytics/inventory` | `/reports/inventory` | **Corrected.** D-06: legacy read `products.stock`, a column nothing writes. v2 reads `product_variants.stock`. D-05: legacy broke whenever a date filter was applied. |
| Dead stock | `analytics/dead-stock` | `/reports/inventory` → dead candidates | **Corrected.** Legacy scavenged from a value-ranked top 300; v2 selects on the criteria themselves. |
| Customers | `analytics/customers` | `/reports/customers` | **Superset.** Behavioural and loyalty segmentation side by side, returns netted per customer. |
| Customer intelligence | `analytics/customer-intelligence` | `/reports/customers` | **Superset, and safer.** The legacy endpoint returned name, phone and email; the Reporting Center never returns contact details to anybody. |
| Reorder suggestions | `analytics/reorder-suggestions` | `/purchases/reorder-suggestions` | **Already canonical elsewhere.** Deliberately not duplicated into the Reporting Center — see `docs/reporting-center-status.md`. |
| AI insights | `analytics/ai-insights` | **Not carried over** | D-17: the figures were fabricated. There is nothing to preserve. Deterministic, evidence-carrying highlights appear on every Reporting Center page instead. |

`AnalyticsDashboard.jsx` is kept on disk, unrouted. Restoring the route is a one-line
revert if anything was missed.

---

## `/reports` — STILL ROUTED, pending the owner's sign-off

Parity is proven for every tab below. It is **not** retired, because
`docs/reporting-center-architecture.md` states the legacy page "is only retired on your
explicit sign-off", and that promise is worth more than the tidiness of removing it.

Until then it carries `LegacyReportNotice`, which names its specific defects and links to
the page that replaces the tab the reader is actually on.

| Legacy tab | Endpoint | Canonical replacement | Parity |
|---|---|---|---|
| Insights | `reports/insights` | `/reports/overview` | **Not carried over by design.** D-17 again: fabricated figures presented as analysis. |
| Sales | `reports/sales` | `/reports/sales` | **Superset.** D-16 — the legacy revenue scope — was fixed at the source on 2026-08-24, so the legacy page now uses the accounting definition of a sale. It still differs from the Reporting Center by D-04 and D-05, which the reconciliation screen quantifies. |
| Employees | `reports/employees` | `/reports/employees` | **Closed 2026-08-24.** This was the last real gap: R9 attributes sales by measured coverage and states which column it used. |
| Inventory | `reports/inventory` | `/reports/inventory` | **Corrected.** Same dead-column defect as `/analytics`. |
| Customers | `reports/customers` | `/reports/customers` | **Superset.** |
| Financial | `reports/financial` | `/accounting/reports` + `/reports/reconciliation` | **Already canonical.** The accounting module owns the P&L, ledgers, trial balance and balance sheet; the reconciliation screen shows where the Reporting Center and accounting deliberately differ. |
| Export | `reports/export` | The shared export engine, on every page | **Superset.** Four formats, Arabic PDF, permission-aware columns. The legacy exporters now route through the same engine. |

### What retiring `/reports` would take

One line in `src/App.jsx` — replace the route element with
`<Navigate to="/reports/overview" replace />` — plus removing its sidebar entry. The
notice, the tab-aware links and this matrix exist so that decision can be made on
evidence rather than nerve.

---

## Retired stub files

Eight nine-line placeholders under `src/modules/reports/pages/` were deleted on
2026-08-24: `AnalyticsReports`, `CustomersReports`, `InventoryReports`, `OrdersReports`,
`ProductsReports`, `ProfitReports`, `SalesReports`, `TaxReports`.

They were routed from nowhere and imported by nothing — verified by searching the whole
repository, where the only apparent matches were unrelated backend controller functions
of the same name (`getSalesReports`, `getInventoryReports`). A test now fails if a file
of that shape reappears, because a page that renders its own name is worse than no page:
it looks like a feature.
