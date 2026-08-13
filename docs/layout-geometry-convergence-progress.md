# M1 ERP — Full-System Layout & Card Geometry Convergence

Operational tracking only. Nothing here affects runtime behaviour.

Post-closure visual program. Continues the M1 Design System. **Not** a redesign.
Scope: layout, card geometry, spacing, rhythm, grid, overflow, scroll ownership.
Colour/typography/dropdown/page-title contracts are **frozen** (see
`docs/visual-convergence-progress.md`).

## Status: IN PROGRESS — desktop Light/RTL pass complete, 0 defects found

| Item | Value |
|---|---|
| Session-1 baseline `main` | `c442474` |
| Session-1 baseline Production | `041a8a6` (fingerprint `041a8a61c9fe`) |
| **Current Production** | **`5c123e3`** (fingerprint `5c123e3cfec6`) |
| Current `origin/main` | `5c123e3` |
| Ledger branch HEAD | `visual/layout-geometry` @ rebased onto `5c123e3` |
| Checkpoints deployed by this program | **0** |
| Rollback refs created | 0 (none needed — no code change) |
| Shared owners changed | **0** |
| Confirmed geometry defects | **0** |
| Code changed | **none** |

### Production moved mid-programme

Production advanced **29 commits** from `041a8a6` to `5c123e3` while this audit
was running — a concurrent localization-closure + "POST-CLOSURE USER VISUAL
CORRECTIONS" workstream (its own cp1–cp5). Layout-relevant files in that delta:

`src/pages/Dashboard.jsx`, `src/shared/ui/M1UI.jsx`,
`src/shared/layouts/MainLayout.jsx`, `src/modules/products/pages/ProductsList.jsx`,
`src/modules/pos/pages/POSPro.m1.css`, `src/theme/ai-surface.css`,
`src/shared/chat/SharedPortalChat.jsx`, `src/shared/notifications/NotificationBell.jsx`.

**Consequence, stated plainly:** the Light/RTL sweep below was measured against
`041a8a6`. It is *provisional* against `5c123e3` and must be re-verified for the
touched surfaces before any row is promoted to a final PASS. It is not discarded —
no defect was found, so there is nothing to act on — but it is not final either.

**Coordination hazard:** two visual programmes are writing to the same files.
Any checkpoint from this programme must re-fetch and reconcile immediately before
push, and must not assume its worktree base is current.

## Environment / hosts

- ERP (authenticated): `https://erp.m1store-egy.com` — the audit target.
- Storefront: `https://m1store-egy.com` — separate host, out of scope.

## Route inventory (from the CURRENT router, `src/App.jsx`)

~150 `path=` entries. Excluding the storefront-host block, `/shop/*` legacy
redirects, token-bound portal routes and public pages, the authenticated ERP
shell exposes **115** operational routes: 109 swept, 6 deferred as pathological.

## Geometry auditor

Rendered-DOM measurement in the live authenticated app. For every `grid`/`flex`
container inside `.m1-shell-content` with ≥2 visible children, children are
resolved to their visual card through unstyled wrappers, bucketed into visual
rows by `getBoundingClientRect().top` (±6 px), then compared:

- **height outlier** — `max(h) − min(h) > 8 px` within a row
- **width outlier** — `> 8 px`, **only** when the grid's own computed tracks are
  equal (±2 px) and cells carry a uniform span
- **overflow** — `scrollWidth > clientWidth` with `overflow-x: visible`
- **scroll ownership** — every element that actually owns a scrollport

### Auditor defects found and fixed (five)

1. **Detector too strict.** Peer cards inside unstyled wrappers were invisible;
   a 2-up grid of 326 px cells scored 0 cards. Fixed by resolving through up to
   4 single-child wrappers while measuring the *cell* rect.

2. **Stale-DOM reads — the serious one.** The first sweep reported a defect on
   `/dashboard`: a 2-up grid of 865 vs 1057 px carrying
   `rounded-3xl border-white/10 bg-zinc-950/90`. That is `/workspace`'s markup,
   read after the URL changed but before React swapped the tree. A URL-vs-`landed`
   assertion cannot catch it, because the URL was already correct. Fixed by
   requiring the rendered identity (element count + scrollHeight + title +
   headings) to change before settling, recorded as `domChanged`. The guard
   immediately caught a second instance (`/notifications` read while
   `landed=/orders`). **All 32 pre-fix readings were discarded and the sweep
   restarted from zero.** Re-measured under real navigation, `/workspace` is
   clean: 11 cards, 4 rows, 0 flags.

3. **Width-delta false positive.** `xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]`
   is deliberately asymmetric. The rule now requires equal computed tracks.

4. **`innerText` settle froze the renderer.** `settle()` polled
   `document.body.innerText` every 200 ms; `innerText` forces a full layout, which
   is catastrophic on the 0.5–1 M character label surfaces and caused repeated
   45 s CDP timeouts. Replaced with a cheap signal (element count + scrollHeight).
   Route throughput went from ~1 route / 30 s to ~8 routes / 30 s.

5. **Identity-key collision in the re-check runner.** A simplified key
   (element count + scrollHeight only) collided between route skeletons, so 21
   re-checks reported `domChanged:false`. Fixed by restoring title + headings to
   the key. Those 21 rows were **not** trusted.

Baseline validation: `/dashboard` (frozen reference) measures **7 × (255 × 172)**
KPI cards and **3 × (622 × 340)** panels — exact equality, 0 flags — reproduced
after every auditor change.

## Measured — Light theme, Arabic RTL, 2288 px CSS, at Production `041a8a6`

Readings 118 · distinct routes 109 · **trusted PASS 75** ·
**peer cards measured 877** · **peer groups 295** · **geometry flags 3** ·
**page-level horizontal overflow: 0 routes**.

### The 3 flags — all investigated, all intentional, none a defect

| Route | Owner | Measurement | Verdict |
|---|---|---|---|
| `/reports/sales` | `div#sales-breakdown` `xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start` | equal tracks 789.99/790.01; heights 509 vs 423 (Δ86) | **Intentional.** `items-start` is used on *every* page-level grid across the Reporting Center (ExecutiveOverview, SalesIntelligence, InventoryIntelligence). `SectionCard` is independently collapsible (`collapsible`, `openOnDesktop`); stretching would pad a collapsed card out to match its expanded neighbour. Forcing equal height would break the collapse UX. |
| `/reports/inventory` | `div#inventory-breakdown`, same idiom | same | **Intentional**, same owner family. |
| `/marketing/ai-center/leads` | `xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)] items-start` | `section` 33640 px vs `aside` 488 px | **Intentional.** Main content column beside an `xl:sticky xl:top-4` aside. Not semantic peers. |

Per §7 these are *not* normalized. Forcing equal heights here would be a
regression, not a fix.

### Overflow observations — sub-pixel, not defects

15 routes reported `scrollWidth − clientWidth` of ~4 px (`/dashboard` 8 px,
`/reports/*`, the `/settings/*` family, `/website/settings`, 3 marketing routes).
Traced on `/reports/sales`: **0 elements extend beyond the content container's
box** (`beyondContent: 0`) — the delta is sub-pixel track rounding
(789.994 + 790.012 + 20 gap). No route produced page-level horizontal overflow
(`html.scrollWidth > clientWidth` never fired). Classified as measurement noise;
auditor threshold should be raised to >4 px.

### Aliases (13) — redirects, not defects

`/sales-employees`→`/employees/employees` · `/accounting/cash-registers`→`/accounting/cashbox` ·
`/accounting/ledgers`→`/accounting/accounts` · `/accounting/analytics`→`/accounting/reports` ·
`/accounting/taxes`→`/accounting/reports` · `/employees/commissions`→`/employees/analytics` ·
`/employees/top-performers`→`/employees/analytics` · `/employees/shifts`→`/employees/attendance` ·
`/attendance`→`/employees/attendance` · `/attendance/employees`→`/employees/employees` ·
`/attendance/reports`→`/employees/reports` · `/attendance/kiosk`→`/employees/attendance` ·
`/staff/qr-attendance`→`/employees/attendance`

### Deferred — pathological DOM, bounded handling required (not yet done)

| Route | Evidence |
|---|---|
| `/products/barcodes` | 1,075,836 chars; froze the renderer twice |
| `/purchases/reorder-suggestions` | 576,903 chars; never settles |
| `/create-order` | froze the renderer (bounded 55 MB catalog) |
| `/purchases/create` | same owner family |
| `/products/barcode-labels`, `/products/barcode-print-queue`, `/products/print-list` | label surfaces |

Standing: `/products/labels` `PASS_BOUNDED` · `/ai-studio/workflows/:id/edit`
`BLOCKED_FUNCTIONAL` · `/inventory/variant/:id/history` `PENDING_NO_READONLY_ID`.

### 21 routes still requiring a trusted reading

`/notifications` `/customers` `/purchases/reorder-suggestions` `/inventory`
`/warehouses` `/expenses` `/accounting/accounts` `/reports/overview`
`/settings/company` `/settings/appearance` `/settings/currencies`
`/settings/storefront` `/settings/shipping` `/settings/payments` `/users`
`/marketing/ai-center/leads` `/marketing/analytics` `/marketing/automation`
`/marketing/social-comments` `/marketing/settings` `/ai-studio`

## Automation-session failure (resolved by switching browsers)

The Chrome automation profile stopped booting the app entirely — `#root` empty
with 47 static elements, on `/dashboard` **and** on the public `/login`, across a
fresh tab and hard reloads. Ruled out: Production health (all routes HTTP 200),
service workers (none), caches (none), chunk delivery (16/16 JS resources 200
with valid decoded bodies), module execution (a synthetic `type="module"` script
ran), localStorage quota (12.7 KB total — hypothesis raised and **disproved**).

Decisive test: the **identical build** `app-CcxBkJV1-5c123e3cfec6.js` renders
correctly in a different browser (`rootKids: 2`). Per the permanent rule, an empty
`#root` while Production is healthy is an **automation-session failure** — Production
code was **not** touched.

Also note: `sessionStorage` is per-tab, so the raw sweep rows were lost when the
tab died. Summary results had already been harvested. **Persist future sweep
results to `localStorage`, not `sessionStorage`.**

## Viewport ladder — now available

Chrome could not be resized (maximized, `outerWidth` pinned to screen width) and
page-zoom shortcuts are blocked, giving a single fixed 2288 px viewport. The
Claude Browser pane provides exact emulation — verified **1430 × 900 CSS at
dpr 1.25**. The responsive ladder will run there:

| Rung | Target CSS width |
|---|---|
| A wide desktop | 1920 |
| B normal desktop | 1440 |
| C narrow desktop / tablet | 1024 |
| D smallest supported (high-risk pages only) | 768 |

## Matrices

| Dimension | State |
|---|---|
| Light / RTL @ 2288 (at `041a8a6`) | 75 PASS, 3 explained, 13 ALIAS, 21 unverified, 6 deferred |
| Light / RTL @ `5c123e3` | **re-verification pending** |
| Dark | **not run** |
| LTR | **not run** |
| Responsive A–D | **not run** (now unblocked) |
| Internal states | **not run** |
| Frozen-reference re-sweep | n/a — no shared owner changed |

## Behaviour freeze

Honoured absolutely. **Zero** code changes across both sessions. No API, DB,
payload, calculation, permission, order-state, inventory, payment, POS, workflow,
localization or AI behaviour touched. Navigation was read-only; no record created,
no business action triggered. The only writes were auditor keys in the browser's
own storage, since removed.

## RESUME MARKER

**Nothing deployed. `main` and Production untouched by this programme.**

1. Sign in to the Claude Browser pane (user-driven; credentials never handled by
   the agent). Re-install the auditor there — it is **not** in that browser's
   storage yet; the source is reproduced in this session's transcript and must be
   re-injected, then re-validated against `/dashboard` (expect 7 × 255×172 and
   3 × 622×340, 0 flags).
2. Re-run the Light/RTL sweep against `5c123e3` at rung B (1440), persisting to
   `localStorage`.
3. Clear the 21 unverified routes and the 7 deferred surfaces (bounded).
4. Then Dark, then LTR, then rungs A/C/D, then internal states.
5. Re-fetch `origin/main` immediately before any push — a second visual
   programme is shipping to the same files.

**Rules carried forward:** a URL match is not proof the DOM belongs to that route
— require `domChanged`. Never poll `innerText` on large surfaces. An empty
`#root` with healthy Production is an automation fault, never a Production
rollback trigger.
