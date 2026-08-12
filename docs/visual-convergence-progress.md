# M1 ERP — Full Visual Convergence Progress

Operational tracking only. Nothing here affects runtime behaviour.

Started from `origin/main` @ `3ca9c07`.

## Deployment checkpoints

| # | Scope | Rollback ref | Released | Production | Suite |
|---|---|---|---|---|---|
| 1 | FlowShell fixed-dark retirement | `pre-visual-convergence-cp1-20260812` -> `b91cec6` | `e037562` | `e037562` verified | 1850 tests, 25 fail, identical to baseline |
| 2 | Marketing core fixed-dark retirement (5 files / 4 routes) | `pre-visual-convergence-cp2-20260812` -> `98110df` | see below | see below | build green |

## Method

Production is the visual truth. Findings are **measured in the live authenticated
app**, not grepped: an auditor injected into the real page walks every element
inside `.m1-shell-content`, reads `getComputedStyle().backgroundColor`, converts
to relative luminance and flags large opaque surfaces that are dark in Light
(lum < 0.42) or light in Dark (lum > 0.62). Elements under `img/svg/video/canvas`,
translucent scrims (alpha < 0.6) and anything smaller than 9000px² are excluded.

The shell sidebar and topbar are deliberately dark in Light and are **out of
scope** — that is the approved M1 look, confirmed against the frozen reference
pages.

### Auditor trust

Two tooling defects were found and fixed before any result was trusted:

1. A synthetic `popstate` sweep audited **stale content** — the lazy route chunk
   had not rendered yet, so a route could report the *previous* route's DOM.
   Fixed with settle-detection (poll until `innerText.length` is stable for 3
   consecutive reads, max 9s) plus a `route === landed` assertion on every row.
2. A CDP-timed-out sweep kept running inside the page and raced a second sweep,
   producing rows where `route` and `landed` disagreed. Fixed with a run token
   that cancels superseded loops.

Baseline validation: the auditor reports **0 offenders** on `/products`, a frozen
reference page, so it does not produce false positives on approved surfaces.

Any row with `ok:false` (never settled) or `route !== landed` is **not** a PASS.

## Legend

`PASS` verified clean · `FIXED` defect found, repaired, production-verified ·
`BLOCKED` reason recorded · `FROZEN_REFERENCE` design frozen, not touched ·
`PENDING` not yet audited

## Frozen references (not modified)

| Route | State |
|---|---|
| `/dashboard` | FROZEN_REFERENCE |
| `/orders` | FROZEN_REFERENCE |
| `/products` | FROZEN_REFERENCE |
| `/customers` | FROZEN_REFERENCE |
| `/inventory` | FROZEN_REFERENCE |
| `/products/add` | FROZEN_REFERENCE |
| `/products/:id/edit` | FROZEN_REFERENCE |

## Audited — Light theme, Arabic RTL

Measured on Production at `3ca9c07`.

| Route | Landed | Settled | Dark-island offenders | State |
|---|---|---|---|---|
| `/workspace` | ✓ | ✓ | 0 | PASS (light/rtl) |
| `/suppliers` | ✓ | ✓ | 0 | PASS (light/rtl) |
| `/warehouses` | ✓ | ✓ | 0 | PASS (light/rtl) |
| `/stock-transfers` | ✓ | ✓ | 0 | PASS (light/rtl) |
| `/smart-warehouse` | ✓ | ✓ | 0 | PASS (light/rtl) |
| `/expenses` | ✓ | ✓ | 0 | PASS (light/rtl) |
| `/billing` | ✓ | ✓ | 0 | PASS (light/rtl) |
| `/roles` | ✓ | ✓ | 0 | PASS (light/rtl) |
| `/purchases` | ✓ | ✓ | 0 | PASS (light/rtl) |
| `/purchases/reorder-suggestions` | ✓ | — | 0 | PASS (light/rtl) |
| `/accounting` | ✓ | — | 0 | PASS (light/rtl) |
| `/purchases/create` | ✓ | — | **1** | **FIXED** — see below |

Note: `/accounting/dashboard` redirects to `/accounting`; they are one page.

## Defects found and repaired

### 1. `/purchases/create` — full-page fixed-dark island in Light

**Measured:** `div.min-h-screen.bg-[#050609].text-white`, 1185 × 979 px,
computed `rgb(5, 6, 9)`, luminance **0.024**, in the Light theme. The defect is
the entire page canvas, so the measurement fully explains the visible symptom.

**Owner:** `src/modules/purchases/components/FlowShell.jsx` — the `compact`
branch. `compact` was being used as a colour scheme rather than a density
variant, hardcoding a raw-hex page background, a `zinc-950/90` header card,
white-alpha borders and white/grey text.

**Consumers checked before editing (shared component, 7 consumers):** only
`PurchaseOrder.jsx` passes `compact` (routes `/purchases/create` and
`/purchases/:id/edit`). The other six consumers — PurchasesDashboard,
SuppliersDashboard, ReorderSuggestions, PurchaseDetails, SupplierDetails,
SupplierStatement — use the non-compact branch.

**Fix:** both branches now share one semantic surface ladder and differ only in
spacing, radius and type scale. Also corrected in the same owner:

- a generic gradient wash (`radial-gradient` + `linear-gradient`) on the
  non-compact page canvas → `--bg`
- the active tab was `bg-[var(--primary)] text-white` → `--primary-contrast`
  (white on a gold fill is the recurring gold-contrast defect)
- `rounded-xl` / `rounded-2xl` / `rounded-3xl` → the frozen radius contract
- `shadow-2xl` / `shadow-black/20` → `--shadow-card`

Result: 0 raw hex, 0 gradients, 0 fixed-dark chrome, 0 arbitrary radii in the file.

**Production verified after deploy (checkpoint 1, Production `e037562`):**

| Theme | Shell background | Shell text | Islands |
|---|---|---|---|
| Light | `rgb(234, 231, 224)` = --bg | `rgb(27, 25, 21)` = --text | 0 dark islands |
| Dark | `rgb(19, 18, 17)` = --bg | `rgb(243, 241, 236)` = --text | 0 light islands |

`#050609` no longer present anywhere in the rendered document. State: **FIXED + VERIFIED (light + dark, RTL)**.

## Session 2 — accounting module (Light / Arabic RTL)

Measured on Production at `98110df`. Auditor rebuilt this session (the session-1
harness was not persisted) and re-validated against the frozen reference
`/products` -> **0 offenders** before any result was trusted.

| Route | Landed | Settled | Offenders | State |
|---|---|---|---|---|
| `/accounting/journal-entries` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/general-ledger` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/trial-balance` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/profit-loss` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/treasury` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/cashbox` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/reports` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/accounts` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/income` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/cost-fix` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/audit-trail` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/financial-accounts` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |
| `/accounting/payment-method-mappings` | ✓ | ✓ | 0 | PARTIAL_PASS (light/rtl) |

**ALIAS (no own surface — confirmed in `src/App.jsx` as `<Navigate replace>`):**
`accounting/cash-registers` -> `cashbox`, `accounting/ledgers` -> `accounts`,
`accounting/analytics` -> `reports`, `accounting/taxes` -> `reports`.
These are not defects and are removed from the queue. The auditor's
`route === landed` assertion is what surfaced them.

Accounting typography: page titles are a consistent 30px/800/36px, matching the
frozen reference. Recorded drift (not yet converged, cosmetic): `th` renders
10px where `/products` renders 11px, and numeric `td` uses weight 900 on
`trial-balance`/`accounts` vs 400 on the reference.

## Session 2 — marketing module (Light / Arabic RTL)

| Route | Offenders | Gradients | State |
|---|---|---|---|
| `/marketing/coupons` | 0 | 0 | PARTIAL_PASS (light/rtl) |
| `/marketing/ai-center` | 0 | 0 | PARTIAL_PASS (light/rtl) |
| `/marketing/ai-center/leads` | 0 | 0 | PARTIAL_PASS (light/rtl) |
| `/marketing/ai-center/videos` | 0 | 0 | PARTIAL_PASS (light/rtl) |
| `/marketing` | 6 | 1 | **FIXED (cp2)** |
| `/marketing/attribution` | 5 | 1 | **FIXED (cp2)** |
| `/marketing/campaigns` | 0 | 1 | **FIXED (cp2)** |
| `/marketing/posts` | 0 | 1 | **FIXED (cp2)** |
| `/marketing/analytics` | 20 | 0 | NEEDS_FIX (cp3) — partly repaired by cp2 |
| `/marketing/templates` | 1 | 6 | NEEDS_FIX (cp3) |
| `/marketing/settings` | 43 | 0 | NEEDS_FIX (cp4) |
| `/marketing/automation` | 0 | 0 | NEEDS_FIX (typography only — page title 22px) |
| `/marketing/social-calendar` | 0 | 0 | NEEDS_FIX (typography only — page title 37px) |
| `/marketing/social-media-publisher` | 0 | 0 | NEEDS_FIX (typography only — page title 37px) |
| `/marketing/social-comments` | 0 | 1 | PARTIAL_PASS — gradient is near-white (`oklab 0.999`), benign in Light |

Auditor note: the gradient probe flags *any* large gradient. A gradient is only
a defect when it is dark in Light (or light in Dark); `/marketing/social-comments`
is the benign case and is **not** counted as a defect.

### 2. Marketing core — fixed-dark page chrome in Light (checkpoint 2)

**Measured on `/marketing`:** hero `section.rounded-3xl.bg-gradient-to-br`
1121 × 202 px painting `linear-gradient(oklch(0.129 …) → oklch(0.208 …))`
(near-black) while its computed text colour is `rgb(27,25,21)` = `--text`
(near-black) — dark text on a near-black gradient. Plus 6 metric cards
173 × 95 px at `rgb(27,28,26)`, luminance **0.011**, also rendering `--text`
on top: the card content is effectively invisible. Hero + cards account for the
entire visible defect.

**Why the page canvas was NOT an offender:** the root `div` still declared
`bg-[#060816] text-white`, but shared M1 CSS already neutralises it —
computed `rgb(234,231,224)` = `--bg`. Only the *inner* hardcoded surfaces
survived. The source was still repaired at the owner.

**Owners repaired:**

- `src/modules/marketing/components/MarketingMetricCard.jsx` — `bg-[#1b1c1a]`
  → `--card`; label/value/hint → `--muted`/`--text`. Shared by 3 consumers
  (Dashboard, Analytics, Attribution), all checked before editing. Tone chips
  kept their semantic tint but moved from `text-*-200` (a dark-theme-only value)
  to `text-*-500`, which reads in both themes.
- `src/modules/marketing/pages/MarketingDashboard.jsx`
- `src/modules/marketing/pages/MarketingAttribution.jsx`
- `src/modules/marketing/pages/Campaigns.jsx`
- `src/modules/marketing/pages/SocialPosts.jsx`

All five converge on the same ladder used by the checkpoint-1 FlowShell fix:
`--bg`, `--card`, `--surface`, `--surface-hover`, `--border`, `--text`,
`--muted`, `--shadow-card`, `--radius-card`, `--radius-control`.
Residual `bg-[#0…]`, `from-slate-9xx`, `text-white`, `text-slate-[1-6]00`,
`white/α`, `black/α`, `shadow-2xl`, `rounded-3xl` in those files: **0**.

Diff is 140 insertions / 140 deletions, class strings only — no copy, no `t()`,
no props, no logic (business freeze respected).

## RESUME MARKER

**Next route to audit: `/marketing/analytics`** — re-measure after checkpoint 2
(the shared metric card is already repaired), then fix its remaining
`bg-[#171815]` section as checkpoint 3 together with `/marketing/templates`,
then `/marketing/settings` as checkpoint 4. After that continue to `settings/*`.

Do not re-audit routes already marked PASS/FIXED unless a later shared change
touches them.

### Remaining queue (PENDING)

settings/* (11 routes), reports/*, inventory/* (non-frozen
subroutes), employees/*, attendance/*, loyalty/*, ai-studio/*, admin/*,
operations/shipping, notifications, users, sales-employees, branches, create-order,
pos, orders/:id, orders/returns, suppliers/:id, purchases/:id, products/* sub-pages
(brands, categories, classifications, manufacturers, units, variants,
barcode-labels, barcode-print-queue, print-list), website/settings, manager and
employee portal token routes.

Dark-theme and LTR passes are **not yet run** for any route above; only Light/RTL
has been measured. Those remain outstanding for every row.

### Excluded by instruction

- AI Inbox and its PWA — observe only, do not modify (hard freeze)
- Add/Edit Product — frozen
- Dashboard, Orders, Products List, Customers, Inventory — frozen references
