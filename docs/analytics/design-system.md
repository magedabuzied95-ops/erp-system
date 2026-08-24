# Reporting Center design system — FROZEN

Frozen 2026-08-11 after R3.6 and the micro-pass. R2 (`/reports/overview`) and R3
(`/reports/sales`) are the reference implementations.

**Amended 2026-08-24**, when R5 (purchasing) and R6 (customers) were built against it and
the export engine landed. Two amendments only, both marked below: the width rule changed
under the fluid-workspace ruling, and four shared components were added rather than being
forked per page. Everything else is unchanged.

**New reporting pages reuse these patterns. They do not invent new ones.** If a pattern
genuinely does not fit, extend the shared component rather than forking a local variant.

---

## 1. Page shell — `components/ReportsLayout.jsx`

```jsx
<ReportsPage dir={isArabic ? "rtl" : "ltr"}>
  <ReportsHeader title={...} subtitle={...}>{toolbar}</ReportsHeader>
  ...
  <PeriodFootnote period={data.period} comparison={data.comparison} />
</ReportsPage>
```

`ReportsPage` owns width and direction. **Never add horizontal padding to a reporting
page** — the app shell's `.m1-shell-content` already applies `--page-inline`, and doing
it again costs ~60px of chart width on a wide monitor.

Width: **no cap.** The page takes the full workspace the shell offers
(`<div className="mx-auto w-full">`).

> **Amended 2026-08-24.** This used to step 1480 → 1600 → 1680px. The fluid-workspace
> ruling removed the caps from every operational ERP surface, and the Reporting Center is
> operational rather than a reading view: charts, tables and the quadrant matrix all gain
> from the room. A cap here re-introduces the empty margin on a wide monitor and shrinks
> the trend chart, which is the one element that most needs the width.
>
> The guard in `tests/analytics/analytics-overview-ui.test.js` is inverted accordingly:
> it now fails if a cap is ever re-added.

## 2. Card hierarchy

Two surfaces only, so the page has few perceived layers:

| Component | Use |
|---|---|
| `Card` | An elevated panel with a header rule. For charts, tables, contribution panels. |
| `Subtle` | A grouped area with just a heading — no border, no elevation. For KPI clusters. |
| `SectionCard` | `Card` plus per-section loading / error / retry / collapse. R3-style sections. |
| `LegacyReportNotice` | The named-defect banner at the top of `/reports` and `/analytics`. Not dismissible. |

Grids use `items-start` so a card is as tall as its content and never stretches to match
a taller neighbour.

## 3. KPI hierarchy — `components/KpiTile.jsx`

| Level | Type scale | Use |
|---|---|---|
| 1 primary | 28 → 42px | The four figures read first. Stronger border + shadow. |
| 2 operating | 20 → 25px | How those figures were produced. |
| 3 health | 17 → 19px | Compact rows. What needs watching. |

Four non-value states are distinct and must stay so: `restricted`, `unavailable`
(coverage too thin), `null` (no denominator), `0` (a verified zero). None ever renders as
"EGP 0".

## 4. Warning strip — `OverviewStates.jsx` → `OverviewWarnings`

Collapsed to a ~37px strip carrying a count. Codes in `CRITICAL_WARNINGS` open it
automatically. Nothing is ever hidden — the count is always visible.

## 5. Filter toolbar

`PeriodSelector` (period + comparison + refresh) in the header. Secondary filters behind
"المزيد من الفلاتر" with a count badge. Active filters render as removable chips showing
a translated label while clearing by stored value.

## 6. Trend treatment — `OverviewTrendChart.jsx`

Height scales with measured width (250 → 400). Legend above the plot, RTL-ordered.
Horizontal gridlines only. Sales is a filled area, profit a **dashed** line — the two
series are told apart by shape as well as hue. Tooltip carries series swatches and full
precision.

recharts needs an explicit pixel width. The host is measured with a ResizeObserver **and**
a window-resize listener, because neither signal fires in every environment.

## 7. Section headers and navigation

`SectionCard` headers are 14 → 15px bold with an optional 11 → 12px subtitle.
`SectionNav` gives a long page a desktop-only jump bar (hidden below 1024px), with the
active section tracked by IntersectionObserver.

**It is not sticky.** The app shell sets `overflow-x: hidden` on `<main>`, its wrapper and
`.m1-shell-content`; each computes `overflow-y: auto` and becomes a scroll container, so a
sticky child anchors to something that never scrolls. Making it stick requires a shell
change affecting every ERP page.

## 8. Table treatment — `ProductTable.jsx`

Sticky header inside a bounded scroller, 13px body, `tabular-nums` and `text-end` on every
numeric column, 36px thumbnails, sort direction as a rotating arrow with the active column
tinted. Sorting, search and paging are **server-side** — a table never re-sorts the page it
was handed. Permission-gated columns are removed, not blanked.

The table is the only thing allowed to exceed the viewport, and only inside its own
scroller. `document.scrollWidth` must never exceed `clientWidth`.

## 8b. Shared analytical components — added 2026-08-24

R5 and R6 needed four more tables and three more breakdowns between them. Four more forks
of the same sorting, paging and search machinery would have been four more places for a
pagination bug to live, so these are shared. R3's `ProductTable` and R4's
`InventoryTable` stay as they are — their cells are genuinely different (a thumbnail, a
velocity chip) and rewriting working screens buys nothing.

| Component | Use |
|---|---|
| `AnalyticsTable` | A table described by a column spec. Server-side sort/search/page, sticky header, bounded scroller. A column with `visible: false` is **not rendered at all**, never rendered empty. |
| `Blank` | The one place a missing analytical value is drawn: an em dash. Never a zero. |
| `BreakdownBars` | A one-dimension breakdown as proportional bars rather than a pie. Two adjacent pie slices are hard to compare and need a legend; a sorted bar list puts the label, the number and the proportion on one line and reads the same in both directions. Scales against the largest row, not the total, so a long tail does not collapse into slivers. Says how many rows it did not draw. |
| `SeriesChart` | A time series described by a series spec, for pages that are not the Overview's specific net-sales-and-profit shape. Same dual resize measurement as `OverviewTrendChart`, for the same reason. A null point stays null so recharts draws a gap. |
| `ReportExportMenu` | The export control. Takes a thunk over the rows the page already rendered. |

## 8c. Exports — `lib/reportExport.js`

One engine, four formats, every reporting page. It takes the rows the page has already
rendered rather than issuing its own request, so a file can never disagree with the screen
it came from — and a column hidden because the caller lacks `reports:cost` is absent from
the file rather than blank in it.

**Arabic PDF.** jsPDF's built-in faces carry no Arabic glyphs and no shaping, which is why
every legacy PDF rendered Arabic as empty boxes. The engine embeds
`server/assets/fonts/NotoSansArabic.ttf` into the document VFS and runs each string
through `doc.processArabic()`, which shapes **and** visually reorders.
**`setR2L` must stay false afterwards** — turning it on reverses an already-reordered
string into mirrored gibberish. Column order is reversed for Arabic and every cell
right-aligned, because autoTable has no RTL mode of its own.

**CSV** carries a UTF-8 BOM; without it Excel on Windows reads the file as the system
codepage and turns every Arabic column into mojibake. **Excel** keeps numbers numeric so a
column can be summed, sizes columns from the longest cell and freezes the header.
**Print** opens a purpose-built document rather than fighting the sidebar, the section
navigator and a self-measuring chart through a print stylesheet.

Every format carries the report title, the period, the comparison and the company name —
read from settings, and left EMPTY when unknown rather than stamping a hardcoded shop name
onto someone else's financial document.

## 9. Empty / error / loading states

Every state says what happened and why. A bare frame is a bug — see the three size-analysis
states for the reference treatment. Sections fetch independently, abort superseded
requests, clear their data on error, and offer retry. One failing endpoint degrades one
card.

## 10. Arabic presentation mappings — `lib/dimensionLabels.js`

Display-only. The stored value is never mutated, filters always send the original string,
and unmapped values fall through unchanged.

Mapped: `product_type`, `gender`, `size`, and a **deliberately narrow** `category`
dictionary. Categories are free-text varchar columns people type into, so only the
system's own classifications are mapped — "running shoes" displays as written. Brands and
product names are never translated.

## 11. Comparison context — `metricFormat.js` → `isBaselineThin`

Growth of 3x or more (+200%) marks the comparison "أساس محدود". The percentage itself is
never altered, clamped or hidden. Declines never trip it: bounded at −100%, a collapse is
real information rather than a thin-base artefact.

## 12. Numbers — `metricFormat.js`

`formatMoney` drops a zero fraction; piastres still print; tooltips keep full precision via
`formatMetricExact`. The shared `formatCurrency` is **never** modified — POS, invoices and
accounting depend on it. Percentages: one decimal. Axes use `formatCompactNumber`, which
compacts the number only, never the currency string.

## 13. Responsive breakpoints

| Width | Behaviour |
|---|---|
| ≥1536 (`2xl`) | Larger type step, wider grid gaps |
| ≥1280 (`xl`) | Two-column analytical grids |
| ≥1024 (`lg`) | Section navigator visible; analytical sections open |
| <1024 | Sections collapse; navigator hidden |
| 375 | Single column; only the table scrolls, inside itself |

## 14. Non-negotiables

- Arabic is the primary UI. `dir` comes from the language, and logical properties
  (`ms-`/`me-`/`ps-`/`pe-`/`text-start`) are used throughout — never `ml-`/`text-left`.
- Theme tokens only. No hardcoded hex.
- One i18n `translation` namespace: `t("salesAnalytics.x")` with a **dot**. A colon
  renders the raw key.
- One bundle file per namespace — see `docs/` history for the collision that proved it.
- Colour is semantic: gold primary, green positive, red negative, amber warning.
- The backend emits codes and raw values; all wording lives in the i18n bundle.
