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
| 5 | `/create-order` invisible primary CTA | `pre-visual-convergence-cp5-20260813` -> `d541bbc` | see below | see below | build green |

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

## RESUME MARKER

/products/variants was audited clean in Dark after checkpoint 4.

**The static pending route queue is EXHAUSTED.**

Next: the dedicated completion sweep, in this order — (1) approved 22px
page-title convergence, (2) remaining PARTIAL_PASS routes, (3) missing
Light/Dark verification, (4) RTL/LTR verification, (5) re-verification of any
route touched by a shared-owner change. The only routes still un-audited are the
ID-bound detail routes listed in the Session 4 section, which need live record
IDs harvested from their list pages.
The marketing fixes were verified in both themes, so those routes are
`FIXED_VERIFIED` rather than partial.

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
