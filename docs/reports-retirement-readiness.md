# `/reports` retirement readiness

Formal assessment of whether the legacy Reports Center page can be retired.

First assessed 2026-08-24 at `6050bc1c` — **NOT_READY**, on four capability gaps.
Re-assessed 2026-08-24 at `fe45f33` after the migration phase closed all four.

`/reports` is still routed. See §7 for the one condition that keeps it that way, which is
a migration window rather than a gap.

---

## Recommendation

# LEGACY_REPORTS_READY_FOR_RETIREMENT

Proven by `server/scripts/reportsParityMatrix.js`, which asks the code and the database
rather than restating a claim: **77 cells, 0 failed, 0 unknown**, across seven legacy tabs
and eleven dimensions, run against production.

The verdict is the weakest cell in the matrix, so it is only reachable when every cell is
`pass` or a reasoned `n/a`. Re-run it before acting on this document.

---

## 1. The four blockers, closed

### B-1 · Filter parity — CLOSED

The Reporting Center exposed a period selector; the legacy page exposed eleven controls.
There is now a filter bar on every page, and — more importantly — **one shared builder**
that every order-scoped service uses.

That second part was the real defect. The filters had drifted service by service:

| filter | honoured at, before | now |
|---|---|---|
| `branchId` | 11 sites | every order-scoped service |
| `channel` | 2 sites | every order-scoped service |
| `customerId` | 1 site | every order-scoped service |
| `paymentMethod` | **0 sites** | every order-scoped service |
| `categoryId` | **0 sites** | superseded by the pages' own category filter |

Every one of them was parsed, validated and returned in the response envelope as though it
had been applied. A control that silently does nothing on four pages out of six is worse
than a missing control, because the reader believes they filtered.

A test fails if a service builds order clauses without the shared builder.

### B-2 · `shiftId` and `salespersonId` — CLOSED, with defensible attribution

Both are now in the filter contract. Coverage was measured on production **before** a line
was written:

| filter | column | foreign key | populated | distinct |
|---|---|---|---|---|
| `shiftId` | `orders.shift_id` | → `cash_drawer_shifts.id` | 578 / 581 (99.5%) | 24 |
| `salespersonId` | `orders.salesperson_id` | → `employees.id` | 519 / 581 (89.3%) | 5 |

`salesperson_id` has **zero dangling references** and resolves to five named people. It
also agrees with `sales_employee_id` on all 519 rows and disagrees on none, so the two
columns are the same attribution stored twice.

**Nothing is inferred.** An order with no salesperson falls *out* of the filtered set
rather than being attributed to somebody, and the unattributed share is published by R9.

### B-3 · Saved presets — CLOSED

Presets now live in `report_presets`, owned by `(tenant_id, user_id)`, with the ownership
in the `WHERE` clause of every statement. Three properties were required and all three
hold:

- **Not another user's.** Two people sharing a terminal cannot see each other's saved
  views. `localStorage` could not promise this.
- **No financial data.** A preset stores the *question*, never the answer — no figure, no
  row, no total, no customer. So a preset can never become a way to read numbers a
  permission would otherwise withhold.
- **Validated against the server contract.** Keys outside the allowlist are dropped on the
  way *in*, and the values must survive `parseAnalyticsFilters`, so a preset that cannot be
  applied cannot be saved.

Migration is a one-time, explicit import, offered only when that browser actually holds
legacy presets. It translates before it stores (`startDate`/`endDate` → `from`/`to`, and
the legacy range names to their real meaning), is idempotent by `(page, name)`, and
reports which keys it dropped rather than pretending the import was lossless.

### B-4 · Column chooser — CLOSED

Hide-only, per user, storing column keys and nothing else. Exports already filter on the
same `visible` flag at all four format sites, so a hidden column is absent from the file
rather than blank in it.

**Permission outranks preference, and the code cannot express it any other way.** The
chooser is handed only what the server sent; a withheld column is excluded from the menu
entirely. One real defect was found here: `PurchasingIntelligence` keeps its cost column
in the spec as `visible: showCost` rather than omitting it, so the chooser would have
*listed* a column the reader may not see, shown it ticked, and done nothing when unticked
— and the listing alone tells them a cost column exists.

---

## 2. What was deliberately NOT reproduced

Two legacy controls have no honest equivalent. Both are declared in
`UNSUPPORTED_LEGACY_FILTERS` with the measurement behind them, surfaced in the filter bar,
and dropped by the redirect rather than forwarded.

| control | measurement | what legacy actually did |
|---|---|---|
| `warehouseId` | `orders.warehouse_id` populated on **0 of 581** orders | rendered, and silently matched every order |
| `employeeId` | `orders` has **no `employee_id` column** | rendered, and silently matched every order |

Reproducing either would be reproducing a lie.

---

## 3. Data parity, measured

Both implementations run over the same window and compared, on production:

| | value |
|---|---|
| legacy `/reports` total sales | 691 110 |
| Reporting Center net sales | 690 930 |
| difference | **180** |
| D-16 correction, disclosed on the page | 11 200 |
| sales agrees with the Executive Overview | **yes**, to the cent |
| employee attribution | `salesperson_name`, 89% coverage |

The remaining 180 is the Reporting Center's own declared divergences — D-04 soft-deleted
and D-05 draft-pattern exclusions, plus its net-of-returns basis. It is quantified on `/reports/reconciliation` rather than left as a mystery.

> The gap was 3 430 before D-21 was fixed. A refund whose order had already been removed
> from the counted set was being deducted a second time; the reconciliation harness caught
> it the first time a real return landed on production while it was watching.

---

## 4. Export, print and permission parity

Both surfaces call the same `exportReport` engine, so a difference between them is not
possible by construction: CSV with a UTF-8 BOM, numeric Excel cells, an Arabic PDF with the
face embedded and text shaped once, and a direction-aware print with a repeating header.

Permissions are identical on both: `reports.view` at the route and the endpoint, with cost
and profit withheld at the SELECT rather than blanked afterwards.

---

## 5. Redirect parity

`resolveLegacyReportsTarget` is pure and exhaustively tested. Every legacy tab has a
destination that is a routed page; every parameter is translated or dropped with a reason;
a date that is not a date is refused rather than forwarded into an error; an unknown
parameter is dropped rather than turned into a 400 on a link that used to work.

`/reports?tab=sales&shiftId=25&startDate=2026-08-01` lands on
`/reports/sales?from=2026-08-01&shiftId=25`.

---

## 6. Usage evidence

From `server/scripts/legacyReportsUsage.js`. Each question answered from evidence, or
reported as unanswerable — because "we could not tell" and "nobody uses it" are different
findings and only one is safe to act on.

| question | answer |
|---|---|
| Views saved in the Reporting Center? | Not yet; the table is created on first use |
| Legacy presets in anybody's browser? | **UNANSWERABLE** — `localStorage`, per browser, no query reaches it |
| Legacy-only filters backed by real data? | Measured; `warehouse_id` is populated 0 times |
| Legacy `/api/reports/*` still routed? | Yes, deliberately |

Internal navigation still pointing at `/reports`: the sidebar entry
(`rbacStore.js`), the dashboard net-sales tile and top-sellers link, and the
route-title map. All four continue to work — the bare route still renders.

---

## 7. The one condition holding retirement

**The bare `/reports` is where the preset import button lives.**

Legacy presets sit in browsers where no query can find them. Redirecting the page away
would strand every one that has not yet been imported, and nobody could tell afterwards
how many that was. That is a migration window, not a capability gap — every blocker in §1
is closed.

Retirement is deleting one condition in `LegacyReportsRoute`, which already redirects deep
links today. The safe order is:

1. Leave `/reports` reachable for a period long enough that anyone who uses it has opened
   it at least once and seen the import prompt.
2. Check `report_presets` for imported rows — that is now a query, which is the whole point
   of moving them server-side.
3. Then remove the condition, so the bare route redirects too.

`tests/analytics/analytics-legacy-redirect.test.js` fails if the bare route is redirected
while this document still says the import path is needed.
