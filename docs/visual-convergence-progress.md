# M1 ERP — Full Visual Convergence Progress

Operational tracking only. Nothing here affects runtime behaviour.

Started from `origin/main` @ `3ca9c07`.

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

## RESUME MARKER

**Next route to audit: `/accounting/journal-entries`**, continuing the accounting
module, then the queue below.

Do not re-audit routes already marked PASS/FIXED unless a later shared change
touches them.

### Remaining queue (PENDING)

accounting/* (journal-entries, general-ledger, trial-balance, profit-loss,
treasury, cash-registers, taxes, reports, analytics, audit-trail, accounts,
ledgers, income, cashbox, cost-fix, financial-accounts, payment-method-mappings),
marketing/* (14 routes), settings/* (11 routes), reports/*, inventory/* (non-frozen
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
