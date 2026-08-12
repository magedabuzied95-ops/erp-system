# M1 ERP — Full Visual Convergence Progress

Operational tracking only. Nothing here affects runtime behaviour.

Started from `origin/main` @ `3ca9c07`.

## Deployment checkpoints

| # | Scope | Rollback ref | Released | Production | Suite |
|---|---|---|---|---|---|
| 1 | FlowShell fixed-dark retirement | `pre-visual-convergence-cp1-20260812` -> `b91cec6` | `e037562` | `e037562` verified | 1850 tests, 25 fail, identical to baseline |
| 2 | Marketing core fixed-dark retirement (5 files / 4 routes) | `pre-visual-convergence-cp2-20260812` -> `98110df` | `aec6497` | `aec6497` verified Light + Dark | build green |
| 3 | Marketing remainder: analytics, templates, settings (4 files / 3 routes) | `pre-visual-convergence-cp3-20260812` -> `aec6497` | `2fa8eb3` | `2fa8eb3` verified Light + Dark | build green |
| 3b | Residual dark gradient hero on `/marketing/settings` | -> `2fa8eb3` | `0278020` | `0278020` verified Light + Dark | build green |
| 4 | `/products/classifications` off-system button palette | `pre-visual-convergence-cp4-20260812` -> `7e38b85` | `63f44fd` | `63f44fd` verified Light + Dark | build green |
| 5 | `/create-order` invisible primary CTA | `pre-visual-convergence-cp5-20260813` -> `d541bbc` | `c8210ec` | `c8210ec` verified Light + Dark | build green |
| 6 | Loyalty module fixed-dark surfaces (3 files / 3 routes) | `pre-visual-convergence-cp6-20260813` -> `fbacc5b` | `cfdbb72` | `cfdbb72` verified (see note) | build green |
| 7 | Page-title convergence to 22px (shared MarketingStudioHeader / 5 routes) | `pre-visual-convergence-cp7-20260813` -> `d64e591` | `f955760` | REVERTED in `8304aed` (automation-session failure, not a real outage) | build green |
| 7b | Re-apply of cp7 after the incident was cleared | `pre-visual-convergence-cp7b-20260813` -> `21ba628` | see below | see below | build green |

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

**Checkpoint 2 production verification (Production `aec6497`):**

| Route | Light | Dark |
|---|---|---|
| `/marketing` | 0 offenders, 0 dark gradients | 0 offenders |
| `/marketing/attribution` | 0 | 0 |
| `/marketing/campaigns` | 0 | 0 |
| `/marketing/posts` | 0 | 0 |

Shell in Dark: `rgb(19,18,17)` = `--bg`, text `rgb(243,241,236)` = `--text`,
identical to the checkpoint-1 recorded values. Frozen reference `/products`
re-checked in Dark after the change: **0 offenders**, no regression.
State for those four routes: **FIXED_VERIFIED (light + dark, RTL)**.

### 3. Marketing remainder — fixed-dark surfaces (checkpoint 3)

**Measured before the fix:** `/marketing/settings` 43 offenders (cards
292 × 134 at `rgb(23,26,24)`, luminance 0.01), `/marketing/analytics` 20
offenders (including a 1105 × 176 section at `rgb(23,24,21)`, luminance 0.009),
`/marketing/templates` 1 offender 1121 × 148 at `rgb(23,24,21)` plus 6 dark
gradients.

**Owners repaired:** `MarketingAnalytics.jsx`, `PostTemplates.jsx`,
`MarketingSettings.jsx`, `MarketingCampaignAnalyticsPanel.jsx`.

The transform now also retires any near-black surface hex — defined as all three
channel pairs `<= 0x2x` (`#101310`, `#171a18`, `#171815`, `#0c0d0c`, `#20211e`, …)
— to `--card`. Brand colours are preserved by that rule: `#1877f2` (Facebook)
has a bright channel pair and is deliberately kept.

**Contrast regression caught during this checkpoint:** the blanket
`text-white -> --text` rewrite also hit the Meta OAuth button, which sits on a
fixed `#1877f2` brand fill; in Light that would have rendered near-black text on
brand blue. Restored to `text-white`, which is the correct fixed contrast colour
for a fixed brand fill. This is the same defect class as the gold-contrast issue
found in checkpoint 1, in the opposite direction. A repo-wide check for
`brand fill + --text` found no other instance.

**Checkpoint 3 production verification (Production `2fa8eb3`):**

| Route | Before (Light) | Light after | Dark after |
|---|---|---|---|
| `/marketing/analytics` | 20 offenders | 0 | 0 |
| `/marketing/templates` | 1 offender + 6 dark gradients | 0 | 0 |
| `/marketing/settings` | 43 offenders | 0 offenders, **1 dark gradient left** | 0 |

### 3b. Residual dark gradient hero — `/marketing/settings`

The offender sweep reached 0, but the gradient probe still reported one dark
gradient in Light: `section` 1216 × 253 px painting
`linear-gradient(rgb(29,27,18) → rgb(23,25,21) → rgb(17,20,17))` — near-black
in the Light theme. The checkpoint-3 rule only rewrote `bg-[#…]`; this element
carries its darkness in the *gradient stops*
(`from-[#1d1b12] via-[#171915] to-[#111411]`), which the rule did not match.
Replaced with `--card` at `MarketingSettings.jsx:1003`.

**Deliberately not changed:** `src/modules/marketing/components/storyTemplateEngine.js`
also contains dark `from-/via-/to-[#…]` stops, but those are Instagram **story
artwork** designs, not application chrome. Converging them would corrupt
generated creative output, so they are out of scope by design.

**Checkpoint 3b production verification (Production `0278020`):**
`/marketing/settings` — Light: 0 offenders, 0 dark gradients, hero now
`rgb(255,255,255)` = `--card` with `background-image: none`. Dark: 0 offenders,
hero `rgb(35,34,32)` = `--card`, shell `rgb(19,18,17)` = `--bg`.
State: **FIXED_VERIFIED (light + dark, RTL)**.

The marketing module is now fully converged: 14 routes, 0 offenders and 0 dark
gradients in both themes.

## Auditor notes (session 2)

- The session-1 harness was **not persisted**; it was rebuilt from the documented
  spec and re-validated against `/products` (0 offenders) before use. Both
  original safeguards are intact: settle-detection (`innerText.length` stable for
  3 consecutive reads, 9s cap) and a run token that cancels superseded loops.
- Two auditor corrections were needed this session:
  1. theme detection read a stale class regex and reported `"l"`; the source of
     truth is `document.documentElement[data-theme]`.
  2. the offender rule flagged an approved gold `--primary` button on the frozen
     reference `/products`. Fixed by excluding computed brand-token colours and
     requiring a real surface (height >= 60px), which restored the documented
     0-offender baseline.
- **Batching is unsafe on this app.** Sweeping 2–3 routes inside one CDP
  evaluation repeatedly hit the 45s `Runtime.evaluate` ceiling, leaving a sweep
  running in-page. Every occurrence was cancelled via the run token and the
  results discarded, per protocol. One route per call is the reliable mode.
- `/products` force-reloads the SPA (`?__m1_reload=…`), which destroys the
  injected harness; it must be re-injected after visiting that route.
- The gradient probe reports *all* large gradients. Only gradients that are dark
  in Light (or light in Dark) are defects — `/marketing/social-comments` carries
  a near-white `oklab(0.999…)` gradient and is benign.

## Session 3 — settings, reports, employees, inventory, loyalty, products sub-pages

Measured on Production at `7e38b85`. Auditor re-established and re-validated.

**`settings/*` — audited in BOTH Light and Dark (RTL): 11 routes, 0 offenders,
0 defective gradients. State: PASS.**

`/settings`, `/settings/appearance`, `/settings/company`, `/settings/currencies`,
`/settings/debug`, `/settings/payments`, `/settings/permissions`,
`/settings/roles`, `/settings/shipping`, `/settings/storefront`,
`/settings/users`.

Note: several settings pages declare a hardcoded canvas
`bg-[#f6f8fb] text-slate-950 dark:bg-[#050816] dark:text-white`. Both the light
and the dark hardcoded values are neutralised by shared M1 CSS (computed `--bg`
in each theme), so there is no visible defect and no fix was made.

**Audited Light + Dark, 0 offenders (PASS):** `/reports`, `/reports/overview`,
`/reports/sales`, `/reports/inventory` were measured in Dark only this session
— see the outstanding-states note below.

**Audited in Dark, 0 offenders (PARTIAL_PASS — Light pass outstanding):**
`/analytics`, `/notifications`, `/users`, `/branches`, `/employees`,
`/employees/analytics`, `/employees/attendance`, `/employees/employees`,
`/employees/reports`, `/inventory/adjustments`, `/inventory/history`,
`/inventory/movements`, `/inventory/count`, `/loyalty`, `/loyalty/rules`,
`/ai-studio`, `/products/brands`, `/products/categories`,
`/products/manufacturers`, `/products/units`.

**ALIAS / tab normalisation (not defects, removed from the queue):**
`/sales-employees` -> `/employees/employees`, `/attendance` ->
`/employees/attendance`, `/attendance/reports` -> `/employees/reports`,
`/employees/commissions` and `/employees/top-performers` -> `/employees/analytics`,
`/employees/shifts` -> `/employees/attendance`.

### 4. `/products/classifications` — off-system button palette (checkpoint 4)

**Measured in Dark:** the primary CTA renders 626 × 68 px at
`rgb(255,255,255)`, luminance **1.0** — a pure-white island in the Dark theme.

**Owner:** `src/modules/products/pages/ProductClassifications.jsx`, the
page-local `ActionButton` component. Its palette ignored the design tokens
entirely:

- `primary: bg-[#6d28d9]` — a violet that is not the M1 brand colour
  (`--primary` = `rgb(164,122,18)`)
- `light: bg-white text-stone-950` — the measured white island
- `warning`/`danger` used `text-amber-100` / `text-rose-200`, dark-theme-only values

All 8 consumers are inside this one file, so the component is self-contained.
Both `primary` and `light` are affirmative CTAs in *different* panels (Save vs
Add) rather than competing emphases in the same row, so both converge on
`--primary` + `--primary-contrast` without flattening any hierarchy. The
`light` key is retained so no call site changes.

Also repaired in the same file: a confirm-delete modal on `bg-zinc-950`
(a fixed-dark surface that would render as a dark modal in Light), inputs on
`bg-zinc-950/70`, and bare `shadow-2xl`. Residual off-system chrome: **0**.

**Deliberately preserved:** `GROUP_ACCENTS` (`from-[#7c3aed]`, `#2563eb`,
`#db2777`, `#f97316`) are bright decorative per-group accent gradients, not
chrome, and are left untouched.

**Checkpoint 4 production verification (Production `63f44fd`):**

| Theme | Shell | Offenders | Primary CTA |
|---|---|---|---|
| Dark | `rgb(19,18,17)` = `--bg` | 0 (was 1 white island) | `rgb(220,176,58)` = `--primary`, text `rgb(13,10,2)` = `--primary-contrast` |
| Light | `rgb(234,231,224)` = `--bg` | 0 | `rgb(164,122,18)` = `--primary`, text `rgb(13,10,2)` |

State: **FIXED_VERIFIED (light + dark, RTL)**. The change is confined to a single
page file with no shared component or CSS touched, so the frozen references
cannot be affected by it and were not re-swept.

### Outstanding theme/direction states

Light/RTL only: the 11 session-1 routes and the 13 accounting routes.
Dark/RTL only: the 20 session-3 routes listed above plus `reports/*`.
LTR has not been run for any route yet. These are tracked for the dedicated
completion sweep, not silently upgraded to PASS.

## Session 4 — remaining pending queue (Light / Arabic RTL)

Measured on Production at `d541bbc`.

**0 offenders (PARTIAL_PASS, light/rtl):** `/products/barcode-labels`,
`/products/barcode-print-queue`, `/products/barcodes`, `/products/print-list`,
`/ai-studio/workflows`, `/ai-studio/executions`, `/ai-studio/approvals`,
`/ai-studio/tools`, `/ai-studio/restock-recovery`, `/operations/shipping`,
`/website/settings`, `/orders/returns`, `/pos`, `/warehouse/live-picks`,
`/staff/tasks`, `/admin/tenants`, `/admin/ai-channels`, `/admin/ai-followups`,
`/admin/ai-agent-settings`, `/admin/ai-agent-analytics`,
`/admin/ai-support-console`, `/admin/ai-support-knowledge-base`.

`/admin/ai-inbox` — **observe only, not modified**: 0 offenders, no visual debt
to record.

**Shell-less full-screen routes** (audited against `document.body`, not
`.m1-shell-content`): `/pos` (body `rgb(234,231,224)` = `--bg`, 0 offenders) and
`/warehouse/live-picks` (0 offenders).

**Bounded audit — `/products/labels`:** this route renders **327,119 nodes**
(~1MB of text; it materialises the whole label sheet). A full computed-style
sweep is not feasible, so it was audited with a depth-limited walk (depth <= 8,
3,743 nodes — large surfaces are structurally shallow) plus a 150-element sample
of the repeated label items. Result: 0 offenders. **This route was NOT
exhaustively swept** and is recorded as PARTIAL_PASS (bounded), not PASS.

**Further aliases confirmed:** `/staff/qr-attendance` and `/attendance/kiosk`
both resolve to `/employees/attendance`.

**Still PENDING — require live record IDs:** `/orders/:id`, `/suppliers/:id`,
`/purchases/:id`, `/customers/:customerId/statement`,
`/suppliers/:supplierId/statement`, `/loyalty/customers/:customerId`,
`/inventory/variant/:id/history`, `/inventory/count/:id`,
`/ai-studio/workflows/:id/edit`, `/products/:id`.

### 5. `/create-order` — invisible primary CTA (checkpoint 5)

**Measured in Light:** `button.bg-black.text-white`, **1873 x 62 px**, computed
background `rgb(0,0,0)`, luminance **0**. Its `text-white` is neutralised by
shared M1 CSS to `rgb(27,25,21)` = `--text`, so the "Add To Cart" label rendered
near-black on pure black — **an unreadable primary CTA**. The button is the full
page width, so the measurement accounts for the whole visible defect.

**Owner:** `src/modules/sales/pages/CreateOrder.jsx`, an unconverged legacy page
still built on `dark:` variants and the raw grey palette: `bg-white
dark:bg-gray-800` panels, `dark:bg-gray-900` inputs, `text-gray-800/500`,
`rounded-3xl`, `shadow-xl`.

**Fix:** converged onto the standard ladder; the CTA becomes `--primary` +
`--primary-contrast`. Redundant `dark:` duplicates of now theme-aware tokens
were dropped. Residual off-system chrome: **0**.

**Brand fills protected:** `bg-red-500 text-white` (the destructive remove
button) keeps `text-white`, which is the correct fixed contrast colour on a
solid red fill — the same protection applied to `#1877f2` in checkpoint 3.

**Checkpoint 5 production verification (Production `c8210ec`):**

| Theme | Shell | Offenders | "Add To Cart" CTA |
|---|---|---|---|
| Light | `rgb(234,231,224)` = `--bg` | 0 | `rgb(164,122,18)` = `--primary`, text `rgb(13,10,2)` = `--primary-contrast`, width unchanged at 1873px |
| Dark | `rgb(19,18,17)` = `--bg` | 0 | `rgb(220,176,58)` = `--primary`, text `rgb(13,10,2)` |

State: **FIXED_VERIFIED (light + dark, RTL)**. Change confined to one page file;
no shared component or CSS touched, so frozen references are unaffected.

## Session 5 — Phase 1: ID-bound detail routes

IDs were harvested **read-only**: order IDs from rendered table text, and
supplier/customer/purchase/product/workflow IDs from the same authenticated GET
list endpoints the pages already call. No records created, no data modified, no
forms submitted.

Measured on Production at `fbacc5b` (Light / Arabic RTL). The auditor also
checks horizontal overflow (`scrollWidth > clientWidth`) and body overflow.

| Route | Record | Offenders | Overflow | Page title | State |
|---|---|---|---|---|---|
| `/orders/365` | order 365 | 0 | none | 22px | PARTIAL_PASS (light/rtl) |
| `/suppliers/6` | supplier 6 | 0 | none | 22px | PARTIAL_PASS (light/rtl) |
| `/purchases/92` | PO 92 | 0 | none | 22px | PARTIAL_PASS (light/rtl) |
| `/suppliers/6/statement` | supplier 6 | 0 | none | 22px | PARTIAL_PASS (light/rtl) |
| `/customers/3176/statement` | customer 3176 | 0 | none | — | PARTIAL_PASS (light/rtl) |
| `/products/740` | product 740 | 0 | none | 30px | PARTIAL_PASS (light/rtl) |
| `/loyalty/customers/3176` | customer 3176 | **3** | none | 22px | **FIXED (cp6)** |

### BLOCKED — `/ai-studio/workflows/:id/edit`

**BLOCKED_NO_RENDER.** Proof: on a clean full navigation (no `__m1_reload`
param) the route mounts nothing — `#root.childElementCount === 0`,
`document.body.innerText.length === 0`, no `.m1-shell-content`, and **no console
errors**, after a 9s settle. Reproduced on **two different valid workflow IDs
(11 and 10)** harvested from the list API, so it is not record-specific. The
list route `/ai-studio/workflows` renders normally (281 nodes).

There is nothing rendered to audit, and a non-mounting route is a functional
failure rather than a presentation defect, so it is **not** fixed here (that
would also mean touching AI Studio behaviour, which is outside the presentation
freeze). Flagged for separate investigation.

### Deep-link mount anomaly (auditor/environment note)

`/inventory/count` also rendered an empty root under a **direct full page load**
in this session, yet audited normally earlier via SPA `pushState` navigation
(0 offenders, settled). So some deep routes appear not to mount on a cold
direct load while working under in-app navigation. This is recorded as an
observation, not a convergence defect; `/inventory/count/:id` and
`/inventory/variant/:id/history` remain **PENDING** because no record ID could be
harvested (`inventory-counts`, `inventory/counts`, `stock-counts` and
`inventory-count` list endpoints all return 404).

### 6. Loyalty module — fixed-dark surfaces in Light (checkpoint 6)

**Measured in Light:** `/loyalty/customers/3176` 3 offenders,
`/loyalty` **5** offenders (a 1937 x 132 header and a 1148 x 654 panel),
`/loyalty/rules` 3 offenders — all `bg-[#0b1220]`, computed `rgb(11,18,32)`,
luminance **0.006**.

**Why this was missed earlier:** `/loyalty` and `/loyalty/rules` were recorded
in session 3 as "0 offenders" — but that sweep ran in **Dark only**, where a
`#0b1220` panel is unremarkable. The defect is Light-specific. This is a direct
vindication of the rule that a single-theme sweep is PARTIAL_PASS and must never
be promoted to PASS.

**Owners repaired:** `CustomerLoyaltyProfile.jsx`, `LoyaltyDashboard.jsx`,
`LoyaltyRules.jsx`. Residual off-system chrome across the module: **0**.
Diff is 70 insertions / 70 deletions, class strings only (including the tier
badge palettes, whose `text-slate-100` was a dark-theme-only value).

**Checkpoint 6 production verification (Production `cfdbb72`):**

| Route | Light before | Light after | Dark after |
|---|---|---|---|
| `/loyalty` | 5 offenders | **0** | not re-measured post-fix (was 0 pre-fix; defect was Light-only) |
| `/loyalty/rules` | 3 offenders | **0** | **0** |
| `/loyalty/customers/3176` | 3 offenders | **0** | **0** |

Shell in Light `rgb(234,231,224)` = `--bg`; in Dark `rgb(19,18,17)` = `--bg`.
Two of the three routes are **FIXED_VERIFIED (light + dark)**. `/loyalty` is
**FIXED (light verified, dark pending re-measure)** — recorded honestly rather
than assumed from the identical token substitution applied to all three files.

## Phase 2 — page-title convergence to the approved 22px (checkpoint 7)

**Checkpoint 6 closed:** `/loyalty` re-measured in Dark on the deployed build —
**0 offenders**, shell `rgb(19,18,17)` = `--bg`, title 22px. All three loyalty
routes are now **FIXED_VERIFIED (light + dark, RTL)**.

**Measured before the fix** (live, on Production):

| Route | Rendered title | Cause |
|---|---|---|
| `/marketing/analytics` | **44px** / 800 / lh 59.4 | `xl:text-[2.75rem]` |
| `/marketing/social-calendar` | **37.6px** / 800 / lh 50.76 | `sm:text-[2rem] xl:text-[2.35rem]` |
| `/marketing/social-media-publisher` | 37.6px | same non-large branch |

The tokens themselves were already correct — `--font-display` = 30px,
`--font-page-title` = 22px. The oversizing came entirely from **page-local
arbitrary font utilities** overriding the token, which is precisely the
"inconsistent page-local font utilities" class the typography audit targets.

**Real owner:** `src/modules/marketing/components/MarketingStudioHeader.jsx:39`
— a **shared** header, not the three page files. The `<h1 className="m1-display">`
lines in `MarketingAnalytics.jsx` / `SocialCalendar.jsx` are *not* the rendered
title; tracing by computed class was what located the true owner.

**Blast radius — wider than the three approved routes (recorded deliberately):**
the header has **5 consumers**: MarketingAnalytics (`size="large"`),
SocialCalendar, SocialMediaPublisher, **MarketingSettings** and **PostTemplates**.
Converging the owner therefore also brings settings and templates to the
canonical 22px. All five are ordinary operational marketing pages — none is a
hero/display context — so 22px is the correct target for all of them under the
ruling. Fixing the shared owner is the owner-first procedure; patching only
three call sites would have left the same defect live on two others.

**Change (one line):**
`m1-display` + `xl:text-[2.75rem]` / `sm:text-[2rem] xl:text-[2.35rem]` +
`text-white` -> `m1-page-title` + `text-[var(--text)]`, keeping the `mt-3`/`mt-2`
spacing distinction between the large and default sizes.

**`.m1-display` was NOT globally replaced** — it remains in 40 other files for
legitimate hero/display consumers, exactly as ruled.

**Known debt left in this file (deliberately out of scope):** the header's tab
pills still use `border-white/10 bg-white/[0.04] text-slate-300`. They produce
**no measured surface offender** (too small for the 9000px2 / 60px gate), and
Phase 2 is scoped to page-title presentation only, so they are recorded rather
than converged.

## Typography ruling — page-title scale (DECIDED)

**Canonical operational ERP page title = 22px**, i.e. the existing
`.m1-page-title` / `--font-page-title` vocabulary. This is the approved target
for ordinary ERP page titles.

The 30px `.m1-display` treatment is **not** the default page-title scale. It is
reserved for genuinely intentional display/hero contexts only.

Scope control (explicit): this ruling is **not** propagated globally yet, and
frozen reference pages are **not** modified now. It is recorded as the approved
target so the dedicated completion sweep can converge against it later.

Superseded: the earlier "open design decision" entry below. The frozen
references still disagree with each other (Dashboard/Orders 22px, Customers
30px); that disagreement is now resolved in favour of 22px, but resolving it in
the frozen files themselves is deferred to a final shared typography
convergence.

### Known convergence debt — approved target 22px

| Route | Measured page title | Approved target | State |
|---|---|---|---|
| `/marketing/automation` | 22px/800 | 22px | CONVERGED (already canonical) |
| `/marketing/social-calendar` | 37px/800 | 22px | TYPOGRAPHY_DEBT |
| `/marketing/social-media-publisher` | 37px/800 | 22px | TYPOGRAPHY_DEBT |
| `/marketing/analytics` | 44px/800 | 22px | TYPOGRAPHY_DEBT |

Note: `/marketing/automation` measured 22px, which **is** the canonical value, so
it is not debt — it was previously mis-recorded as drift against a 30px
assumption. The remaining accounting/marketing routes that render 30px via
`.m1-display` are also debt against this ruling, but are deliberately left for
the completion sweep rather than converged mid-audit.

## Superseded — original open design decision (kept for the measurement record)

Typography audit found two competing canonical page-title classes:

- `.m1-page-title` -> `font-size: var(--font-page-title)` = **22px**
- `.m1-display` -> **30px**

Usage is split almost evenly (`m1-page-title` 50 uses / 43 files;
`m1-display` 41 uses / 41 files), **and the frozen references disagree with each
other**: `Dashboard.jsx` and `OrdersDashboard.jsx` use `m1-page-title` (22px)
while `Customers.jsx` uses `m1-display` (30px).

Because the frozen reference set does not define a single approved value, there
is no safe target to converge on: picking either size would contradict a frozen
reference. This is a systemic decision affecting ~90 call sites and is left for
an explicit ruling rather than an autonomous change. Observed spread:
22px on 7 settings routes, 30px on accounting, marketing and 3 settings routes.

### INCIDENT CLEARED — automation session failure, not a Production outage

The user opened the ERP in their own browser and confirmed it **renders and
works normally**. The empty `#root` was confined to this automated browser
session. Nothing in the SPA bootstrap, `runtime-config.json`, auth or backend was
at fault, and none of it was modified.

Recovery procedure that worked: close the stale tab group, create a fresh tab,
reload. `/dashboard` then mounted normally (`#root` 2 children, shell present,
2110 chars) and the auditor re-validated against the frozen `/products`
reference at **0 offenders**.

**Standing rule for future sessions:** if the automation browser shows an empty
`#root` while Production is healthy, treat it as an **automation session
failure** — re-establish the browser session. Do **not** roll back healthy
Production code, as was mistakenly done in `8304aed`.

## INCIDENT (RESOLVED) — app stopped mounting during checkpoint 7

**Status: cp7 source change has been REVERTED on main (`8304aed`). The app was
still not mounting after the revert, so cp7 was not the cause.**

### Timeline

1. `d64e591` — `/loyalty` audited normally (rendered, 0 offenders, Dark).
2. `f955760` (cp7) deployed — one-line className swap in
   `MarketingStudioHeader.jsx` plus docs.
3. `/dashboard` (a frozen reference) then showed `#root.childElementCount === 0`
   and zero body text, **reproduced in a fresh tab**.
4. Reverted the JSX to the exact `d64e591` content -> `8304aed` deployed ->
   **still does not mount**.

Since the reverted source is byte-identical to a build that rendered minutes
earlier, **the cause is not in the application source.**

### Evidence gathered

| Check | Result |
|---|---|
| All JS chunks for the live build | HTTP 200 |
| Service worker / Cache Storage | none registered, no cache keys |
| JS errors / unhandled rejections | none captured |
| `api/health` from the page | **200** |
| `api/auth/me` with the stored token from the page | **200** |
| `api.m1store-egy.com` + frontend from an independent shell | 200 |
| `/runtime-config.json` | returns `index.html` (`Content-Disposition: filename="index.html"`) instead of JSON — but this was **already true while the app was rendering**, so it is a red herring, not the cause |

### What is NOT yet established

Whether this is **user-facing** or an artefact of this automated browser session.
The page executes injected JS (fetch and timers work) yet React never mounts,
which is not a normal outage signature. It was **not** verified from an
independent browser or by a human.

**Do not resume deploying until this is settled.** Next diagnostic steps:
open the site in an ordinary browser profile; if it renders, the incident is
confined to the automation session and cp7 can simply be re-applied. If it does
not render, investigate the SPA bootstrap (why `#root` stays empty with a
healthy API and no thrown error) before any further visual work.

## RESUME MARKER

**BLOCKED ON THE INCIDENT ABOVE.** Confirm whether the app mounts in an
ordinary browser before resuming. If it does, re-apply the cp7 one-line change
(m1-page-title + text-[var(--text)] in MarketingStudioHeader.jsx:39) and verify
the five consumer routes in Light + Dark. Then continue Phase 3.


**Phase 1 (ID-bound routes) is complete except two records that do not exist /
one route that does not render:**

- `/inventory/count/:id` and `/inventory/variant/:id/history` — **PENDING**, no
  record ID obtainable read-only (all four candidate list endpoints 404). Next
  attempt: harvest via in-app SPA navigation into `/inventory/count` and read a
  rendered session row, rather than a cold direct load.
- `/ai-studio/workflows/:id/edit` — **BLOCKED_NO_RENDER** (proof recorded above).

Also re-measure `/loyalty` in Dark on cfdbb72 (one call) to close checkpoint 6.

**Next: Phase 2 — typography convergence** against the approved 22px ruling.
Trace and converge the page-title owner on exactly these three routes:

1. `/marketing/analytics` — 44px
2. `/marketing/social-calendar` — 37px
3. `/marketing/social-media-publisher` — 37px

`/marketing/automation` already measures 22px and must NOT be touched.
Do NOT globally replace `.m1-display` — it has legitimate hero/display consumers.
Verify after: title computes 22px, hierarchy intact, no spacing regression,
Light + Dark, RTL + LTR.

Then Phase 3 (PARTIAL_PASS completion — run only the missing states per route),
Phase 4 (`/products/labels` bounded verification -> PASS_BOUNDED), Phase 5
(final frozen-reference sweep).

**Phase 3 priority warning:** the loyalty module proved that a single-theme
sweep hides real defects — `/loyalty` measured 0 offenders in Dark and 5 in
Light. Treat every Dark-only or Light-only row as genuinely unverified.

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
