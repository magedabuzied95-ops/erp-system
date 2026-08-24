# `/reports` retirement readiness

Formal assessment of whether the legacy Reports Center page can be retired.

Assessed 2026-08-24 at `6050bc1c`. Read-only: nothing on `/reports` was changed to produce
this document, and the route remains live.

---

## Recommendation

# NOT_READY_FOR_RETIREMENT

Data parity is complete. **Capability parity is not.** Eleven filter controls, saved
presets, a column chooser and client-side table search exist only on the legacy page, and
two of its filters are not reachable through the v2 API at all. Retiring `/reports` today
would silently remove working controls from whoever uses them — and because presets live
in each browser's `localStorage`, there is no way to measure who that is before the fact.

The four blocking gaps are listed at the bottom with what each would take.

---

## 1. Tab-by-tab replacement

Every tab's question is answered correctly elsewhere. This half is settled.

| Legacy tab | Legacy endpoint | Canonical replacement | Verdict |
|---|---|---|---|
| Insights | `GET /api/reports/insights` | — | **Deliberately not replaced.** D-17: the figures were fabricated (`predictedSales = SUM(stock) × 1.08`, hardcoded `confidence = 84`, two fallback alerts). Deterministic, evidence-carrying highlights appear on every Reporting Center page instead. Nothing of value is lost. |
| Sales | `GET /api/reports/sales` | `/reports/sales` | **Superset.** Breakdown by five dimensions, product matrix, size intelligence, comparison windows. D-16 corrected at source on both. |
| Employees | `GET /api/reports/employees` | `/reports/employees` | **Superset.** R9 attributes by measured coverage and prints which column it used; the legacy tab joined `orders.employee_id` with no attribution statement at all. |
| Inventory | `GET /api/reports/inventory` | `/reports/inventory` | **Corrected.** D-06/D-08: the legacy tab reads `products.stock`, a column nothing writes. v2 reads `product_variants.stock`. |
| Customers | `GET /api/reports/customers` | `/reports/customers` | **Superset.** Behavioural and loyalty segmentation, returns netted per customer. |
| Financial | `GET /api/reports/financial` | `/accounting/reports` + `/reports/reconciliation` | **Already canonical elsewhere.** The accounting module owns the P&L, ledgers, trial balance and balance sheet; the reconciliation screen publishes where the two deliberately differ. |
| Export | `GET /api/reports/export` | The shared engine, on every page | **Superset.** See §2. |

## 2. Export behaviour — parity confirmed

Both surfaces call the same `exportReport` engine. There is one implementation, so a
difference between them is not possible by construction.

| Format | Legacy `/reports` | Reporting Center | Notes |
|---|---|---|---|
| CSV | ✅ | ✅ | UTF-8 BOM present, or Excel on Windows mangles every Arabic column. Quotes and separators escaped. Title and period written into the file. |
| Excel (`.xlsx`) | ✅ | ✅ | Numbers stay numeric, so a column can be summed. |
| PDF | ✅ | ✅ | Arabic face embedded from the repository asset, never falling back to a Latin-only one; strings shaped once with `setR2L` off; tables read right to left; header and dates repeat per page. |
| Print | ✅ | ✅ | Header repeats, direction-aware. The four hand-rolled legacy implementations were deleted, not merely bypassed. |

All nine reporting pages export — the eight Reporting Center pages and the legacy one.
Permission-restricted columns are omitted from the file rather than blanked in it, so a
caller who may not see cost cannot recover it from an export.

## 3. Permissions — parity confirmed

| | Legacy `/reports` | Reporting Center |
|---|---|---|
| Frontend route guard | `reports.view` | `reports.view` |
| Backend endpoint guard | `reports.view` on every `/api/reports/*` route | `reports.view` on all 21 endpoints |
| Cost / profit columns | Withheld at the SELECT | Withheld at the SELECT |
| Cashier reach | 0 of 17 financial endpoints (verified live) | 0 of 17 (verified live) |

Retiring the page would neither open nor close any permission.

## 4. The blocking gaps

Each is a working control on the legacy page with **no equivalent** in the Reporting
Center. None is a defect — they are capabilities that were never rebuilt.

### B-1 · Eleven filter controls versus one

The Reporting Center UI exposes a **period selector only** — date range, comparison mode,
refresh. The legacy page exposes eleven controls:

```
range · start · end · warehouseId · employeeId · productId · categoryId
paymentMethod · customerId · shiftId · salespersonId
```

The v2 **API** accepts most of these as query parameters (`branchId`, `warehouseId`,
`categoryId`, `brandId`, `supplierId`, `productId`, `customerId`, `employeeId`, `channel`,
`paymentMethod`, plus product attributes) — so the backend work is largely done. The
**controls** do not exist. A manager who filters by warehouse or payment method today has
nowhere to do it after retirement.

**What it would take:** a shared filter bar over the existing `parseAnalyticsFilters`
allowlist, wired into `ReportsLayout`. No backend change for nine of the eleven.

### B-2 · `shiftId` and `salespersonId` are not in the v2 allowlist

Unlike the rest of B-1, these two cannot be passed to the v2 API at all —
`parseAnalyticsFilters` does not accept them. Filtering a report to one shift or one
salesperson is legacy-only, end to end.

**What it would take:** adding both to the filter allowlist and to the scope builders,
then a control each. `orders` carries `shift_id`, and `salesperson_id` is one of the
columns R9's attribution already measures, so the data supports both.

### B-3 · Saved presets, and no way to measure who uses them

The legacy page saves named filter presets to `localStorage` under
`erp.reports.presets.v1`, up to twelve, pinnable, restoring both the active tab and the
whole filter set. The Reporting Center has no equivalent.

**This is the gap that cannot be closed by inspection.** The presets live in each user's
browser, not in the database, so there is no query that answers "does anybody rely on
this?" — and retirement would delete them with no warning and no export.

**What it would take:** either rebuild presets in the Reporting Center, or ship a
one-time migration/export on the legacy page and confirm with the people who use it. The
honest first step is asking the two or three people who open this page daily.

### B-4 · Column chooser, table search, sort and page size

The legacy table lets a reader hide columns, search across all values, sort any column and
change the page size. The Reporting Center's tables are fixed-column and server-paged.

**What it would take:** a column-visibility control on `AnalyticsTable`. Search and sort
are partly present per page; the column chooser is not present anywhere.

---

## 5. What is NOT blocking

Recorded so these are not re-litigated later:

- **Data parity** — settled, tab by tab, in §1.
- **Export parity** — settled; one shared engine, four formats, Arabic PDF included.
- **Permission parity** — settled; identical gates on both surfaces.
- **The legacy defects** — every one is either corrected at source (D-15, D-16) or named
  on the page by `LegacyReportNotice`, which is not dismissible and links to the specific
  replacement for the tab the reader is on.
- **Insights** — the one tab with no replacement, and deliberately so.

---

## 6. Re-assessment

Re-run this assessment when B-1 through B-4 are addressed. `tests/reports-retirement-readiness.test.js`
fails if this document's recommendation is edited to `READY_FOR_RETIREMENT` while any
blocking gap is still present in the code, so the verdict cannot drift from the evidence.

The route stays live until the owner signs off, per `docs/reporting-center-architecture.md`.
