# M1 ERP — Full-System Layout & Card Geometry Convergence

Operational tracking only. Nothing here affects runtime behaviour.

Post-closure visual program. Continues the M1 Design System. **Not** a redesign.
Scope: layout, card geometry, spacing, rhythm, grid, overflow, scroll ownership.
Colour/typography/dropdown contracts are **frozen** (see
`docs/visual-convergence-progress.md`).

## Session 1 — status: IN PROGRESS (not closed)

| Item | Value |
|---|---|
| Starting `main` SHA | `c442474` |
| Starting Production SHA | `041a8a6` (asset fingerprint `041a8a61c9fe`) |
| Final `main` SHA (this session) | `c442474` — **unchanged** |
| Final Production SHA (this session) | `041a8a6` — **unchanged** |
| Checkpoints deployed | 0 |
| Rollback refs created | 0 (none needed — no code change) |
| Shared owners changed | 0 |
| Confirmed geometry defects | 0 so far |

`main` is exactly one docs-only commit ahead of Production
(`c442474` = `041a8a6` + `docs/release-manager-progress.md`). Production is
therefore current for all runtime code.

### Working isolation

The primary working directory was occupied by another concurrent session
(`feature/ai-workflow-triggers`, 40 commits ahead of main with heavy uncommitted
work). Per `concurrent-sessions-hijack-worktree`, that branch was **not**
touched. This program runs in its own worktree on branch
`visual/layout-geometry` cut from `origin/main`.

## Environment / hosts

- ERP (authenticated): `https://erp.m1store-egy.com` — the audit target.
- Storefront: `https://m1store-egy.com` — separate host, out of scope.
  `/dashboard`, `/orders`, `/settings`, `/products/*` on the storefront host are
  `PublicHostErpRedirect` shims, not ERP pages.

## Route queue (built from the CURRENT router, `src/App.jsx` @ `c442474`)

`src/App.jsx` declares ~150 `path=` entries. Excluding the storefront host
block, the `/shop/*` legacy redirects, token-bound portal routes
(`/employee-app/*`, `/employee-portal/*`, `/manager-portal/*`, `/invoice/:token`
…) and public pages, the authenticated ERP shell exposes **115** operational
routes. 109 are in the automated queue; 6 are deferred to bounded handling.

### Deferred — pathological DOM, bounded handling required

These froze the renderer (>45 s CDP timeout) or exceed the auditor's node guard:

| Route | Evidence |
|---|---|
| `/products/barcodes` | `innerText` **1,075,836** chars; froze the renderer twice |
| `/purchases/reorder-suggestions` | `innerText` **576,903** chars; never settles |
| `/create-order` | froze the renderer (bounded 55 MB catalog, see `purchases-create-perf`) |
| `/purchases/create` | same owner family as above |
| `/products/barcode-labels` | label surface |
| `/products/barcode-print-queue` | label surface |
| `/products/print-list` | label surface |

`/products/labels` remains `PASS_BOUNDED` from the previous program (327k nodes).
`/ai-studio/workflows/:id/edit` remains `BLOCKED_FUNCTIONAL`.
`/inventory/variant/:id/history` remains `PENDING_NO_READONLY_ID`.

## Geometry auditor

Rendered-DOM measurement in the live authenticated app. For every `grid`/`flex`
container inside `.m1-shell-content` with ≥2 visible children, children are
resolved to their visual card (through unstyled wrappers), bucketed into visual
rows by `getBoundingClientRect().top` (±6 px), and compared:

- **height outlier** — `max(h) − min(h) > 8 px` within a row
- **width outlier** — `max(w) − min(w) > 8 px` within a row, **only** when the
  grid's computed tracks are themselves equal (±2 px) and the cells carry a
  uniform span
- **overflow** — `scrollWidth > clientWidth` with `overflow-x: visible`
- **scroll ownership** — every element that actually owns a scrollport

Also captured per row: `display`, computed `grid-template-columns`, `gap`,
`row-gap`, `column-gap`, `align-items`, `padding`, and per card `padding`,
`align-self`, `grid-column`, `min-height`, `height`.

### Auditor trust — two defects found and fixed before any reading was trusted

1. **Card detector too strict.** Peer cards wrapped in an unstyled `div` were
   invisible to the detector — a `grid gap-4 xl:grid-cols-3` row of 2 × 326 px
   cells scored 0 measurable cards. Fixed by resolving each grid/flex child
   through up to 4 single-child unstyled wrappers to the styled card, while
   still measuring the **cell** rect (the rect that grid geometry actually
   governs).

2. **Stale-DOM reads (the serious one).** The first sweep reported a defect on
   `/dashboard`: a 2-up grid whose cards measured 865 px vs 1057 px and carried
   `rounded-3xl border-white/10 bg-zinc-950/90`. **That is not `/dashboard`.**
   It is `/workspace`'s markup, read after the URL had already changed but
   before React had swapped the tree. A URL-vs-`landed` assertion does **not**
   catch this, because the URL was already correct. Fixed by requiring the
   rendered text to actually *change* from the previous route before settling,
   and recording `domChanged` on every row. A row with `domChanged:false` is
   **not** a PASS. The guard immediately caught a second instance
   (`/notifications` read while `landed=/orders`).

   Re-measured under a real navigation, `/workspace` is **clean**: 11 cards,
   4 peer rows, 0 flags.

   **All 32 readings from the pre-fix sweep were discarded.** The sweep was
   restarted from zero against the corrected auditor.

3. **Width-delta false positive.** `xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]`
   is *deliberately* asymmetric; the raw width delta flagged it. The rule now
   requires the grid's own computed tracks to be equal before a width delta can
   count as drift.

Baseline validation: `/dashboard`, a frozen reference, measures
**7 × (255 × 172)** KPI cards and **3 × (622 × 340)** panel cards — exact
equality, 0 flags. The auditor does not manufacture defects on approved
surfaces.

## Viewport

The authenticated session runs in the user's real Chrome, maximized at 67 % page
zoom, giving a **2288 px CSS viewport** (ultra-wide desktop). The extension
cannot resize a maximized Windows window and page-zoom shortcuts are blocked, so
the responsive ladder is not yet available. The user has agreed to un-maximize
Chrome; the responsive matrix is **outstanding** until then.

Wide viewports are the most likely to expose grid drift, orphan cards and blank
columns, so this is a useful primary width — but it is one width, not a matrix.

## Measured — Light theme, Arabic RTL, 2288 px

Readings: 15. Distinct routes: 12. Peer cards measured on trusted rows: **36**
(98 including rows later invalidated by the staleness guard).
**Geometry flags: 0.**

| Route | State | Cards | Rows | Note |
|---|---|---|---|---|
| `/dashboard` | PASS (light/rtl/2288) | 10 | 2 | frozen reference; 1 minor 8 px overflow, see below |
| `/workspace` | PASS (light/rtl/2288) | 11 | 4 | confirmed under real navigation |
| `/orders` | PASS (light/rtl/2288) | 0 | 0 | table-only surface, no peer-card grid |
| `/orders/returns` | PASS (light/rtl/2288) | 4 | 1 | |
| `/suppliers` | PASS (light/rtl/2288) | 4 | 1 | |
| `/purchases` | PASS (light/rtl/2288) | 5 | 1 | |
| `/products` | PASS (light/rtl/2288) | — | — | frozen reference |
| `/products/categories` | PASS (light/rtl/2288) | — | — | |
| `/notifications` | NEEDS_RECHECK | — | — | never settled (live-updating content) |
| `/customers` | NEEDS_RECHECK | — | — | `domChanged:false` — not trusted |
| `/purchases/reorder-suggestions` | NEEDS_RECHECK | — | — | 576k chars, never settles → bounded |
| `/sales-employees` | **ALIAS** | — | — | redirects to `/employees/employees` |

### Observations not yet classified as defects

- `/dashboard` — `div.mt-2.divide-y.divide-border` reports
  `scrollWidth 595 > clientWidth 587` (8 px) with `overflow-x: visible`.
  Sub-threshold and inside a frozen reference; owner not yet traced. Recorded,
  not acted on.
- `/workspace` carries `border-white/10 bg-white/5` and `rounded-3xl` on 15
  elements. In Light these resolve to `rgb(244,241,234)` — visually correct, so
  this is **not** a colour regression. `rounded-3xl` is a radius-contract
  deviation owned by the *previous* (closed) program, not by this one. Recorded,
  not acted on, per the colour/typography freeze.

## Remaining queue — PENDING (97 routes)

products/* (brands, manufacturers, units, variants, classifications),
inventory/* (history, movements, adjustments, count), smart-warehouse,
warehouses, branches, stock-transfers, loyalty/*, accounting/* (20 routes),
expenses, operations/shipping, reports/*, analytics, employees/*, staff/*,
attendance/*, settings/* (11 routes), users, roles, website/settings,
marketing/* (15 routes), ai-studio/* (6 routes), admin/* (9 routes), billing,
plus `/pos`, the 7 deferred heavy surfaces, and every ID-bound detail route.

## Matrices — outstanding

| Dimension | State |
|---|---|
| Light / RTL @ 2288 | 8 routes PASS, 97 PENDING |
| Dark | **not run** |
| LTR | **not run** |
| Responsive (narrow desktop / tablet) | **blocked** on viewport control |
| Internal states (tabs, drawers, modals, empty states) | **not run** |
| Frozen-reference re-sweep | n/a — no shared owner changed yet |

## Behaviour freeze

Honoured absolutely. This session made **zero** code changes. No API, DB,
payload, calculation, permission, order-state, inventory, payment, POS, workflow
or AI behaviour was touched. Navigation was read-only; no record was created and
no business action triggered.

## RESUME MARKER

**Nothing is deployed. `main` and Production are both untouched.**

Next actions, in order:

1. Confirm Chrome is un-maximized, then re-establish the viewport ladder
   (1440 / 1280 / 1024).
2. Resume the Light/RTL sweep — queue and results persist in the page's
   `sessionStorage` under `__q` / `__out`; the auditor and sweep driver are
   mirrored in `localStorage` under `__geo_src` / `__sw_src`. Budget each slice
   to ≤30 s: the CDP evaluator hard-times-out at 45 s.
3. Re-measure the four NEEDS_RECHECK routes under real navigation with a longer
   settle.
4. Handle the 7 deferred heavy surfaces with bounded structural sampling →
   `PASS_BOUNDED`, never a silent PASS.
5. Only then Dark, LTR, internal states.

**Rule carried forward from this session:** a URL match is *not* proof the DOM
belongs to that route. Require `domChanged` before trusting any reading.
