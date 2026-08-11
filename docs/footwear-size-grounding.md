# Unified Footwear Size Grounding (AI Studio Phase 10.7)

_Makes the AI Inbox understand customer-facing footwear sizes (EU numeric like "44", or Crocs factory
markings like "M10/W12"/"C10"/"J5") and resolve them to the SAME canonical variants the ERP and storefront
use — so a size question grounds to an exact variant + real stock instead of a blanket clarification.
Reuses the ONE canonical size table; adds no new sizing system, no autonomous replies. Companion to
`docs/ai-inbox-grounding-quality.md`._

## 1. Canonical source of truth (reused, not duplicated)

`src/shared/lib/crocsSizes.js` (already on origin/main and shipped inside the backend container) is the single
authoritative Crocs table: **the factory marking is the variant identity; `eu` is presentation metadata**.
The AI does **not** copy the table — the new `server/services/footwearSizeResolver.js` imports it and uses
`normalizeCrocsSizeValue`, `resolveCrocsEuSize`, `getCrocsCanonicalSize`, `isKnownCrocsSize`, `isCrocsProduct`,
and `CROCS_CANONICAL_SIZE_MAP`. No refactor/relocation was needed (the backend can import `src/` at runtime).

Reconciliation note: an older EU-keyed table (`src/modules/products/lib/variantBulkSizes.js`) still exists on
a stale branch, but **production data + code use `crocsSizes.js` (marking convention)** — so no business
mapping was changed (this phase only consumes it).

## 2. The canonical table (excerpt)

Markings → EU double: `M8/W10 → 41/42`, `M9/W11 → 42/43`, `M10/W12 → 43/44`, `M11/W13 → 45/46`; kids
`C4…C10` and juniors `J1…J5` map to their EU doubles; `44/45` is a bare EU with no M/W alias.

## 3. The resolver (`resolveFootwearSize`) + deterministic states

`resolveFootwearSize({ productType, requestedSize, availableVariantSizes })` → `{ matchType, canonicalMatches,
euSize, displaySize, ambiguous }`, using **available variants as authoritative**. States:
- **EXACT_CANONICAL** — ordinary footwear, requested size equals a variant size verbatim (Nike 44 = 44). No conversion applied to non-Crocs.
- **EXACT_ALIAS** — Crocs, requested is a known marking/EU-double present on the product (`M10/W12`, `C6`, `22/23`).
- **UNIQUE_CONVERSION** — Crocs, a bare EU number maps to exactly one available size (44 → `M10/W12` when only 43/44 is present).
- **AMBIGUOUS_CONVERSION** — the EU number spans two available canonical doubles (44 when both `M10/W12`(43/44) and `44/45` exist) → clarify, never guess.
- **NO_VARIANT_MATCH** — a valid size that does not exist on this product (44 when the product only has 41/42, 42/43).
- **NO_MAPPING** — no canonical mapping (e.g. "99", or a non-canonical `M8`/`W12/M10` form).

Ambiguity is a **state**, not a confidence percentage.

## 4. Product-type awareness

Conversion runs only when `isCrocsProduct` is true. Ordinary numeric footwear stays literal — `Nike black 44`
with a `44` variant is `EXACT_CANONICAL`, unaffected by Crocs logic.

## 5. Grounding gate integration

`aiInboxGroundingGate` now grounds size via a two-step flow: (1) resolve the requested size against **all**
compatible-product variant sizes; (2) enforce the requested **color** on the resolved size. Outcomes:
- exact variant (size+color) in stock → **available** (`stock>0`, with count when low);
- exact variant out of stock → **unavailable** + restock offer (never auto-creates a restock intent);
- `AMBIGUOUS_CONVERSION` → clarify (ask the M/W marking);
- size resolves but requested color absent → **clarify_color** (no availability claim for that color);
- `NO_VARIANT_MATCH`/`NO_MAPPING` → clarify, listing the actually-available sizes in customer EU. Phase 10.6's
  "availability only with exact-variant evidence" guard is preserved.

## 6. Display size + facts

Replies use the size the **customer** used ("مقاس 44"); the grounding metadata records `requested` vs
`resolved` (`erpSize` = marking, `displaySize` = EU, `matchType`, `variantId`, `color`, `stock`) for employee
explainability — no chain-of-thought.

## 7. Storefront round-trip invariant

`buildCrocsStorefrontSizeOptions` (canonical) displays a `M8/W10` variant as `41/42`; a customer asking `41/42`
(or a bare `41`) resolves back to the same `M8/W10` variant. Tested as a round-trip invariant.

## 8. Live message result (real catalog)

`عندكم كروكس اسود مقاس 44؟` → intent `PRODUCT_AVAILABILITY`, product Crocs, color black, requested 44. `44`
maps to EU `43/44` (`M10/W12`); grounded against the real black-Crocs variants and reported as exact
availability, out-of-stock+restock, or an honest clarification listing the available black EU sizes — never
Air Jordan, never a fabricated "available".

## 9. Known limitations

- The canonical map keys are full M/W labels; **M-only ("M8") / W-first ("W12/M10")** inputs are not canonical
  aliases → they clarify rather than guess (documented; changing this would alter business semantics).
- Arabic digits are normalized upstream (Phase 10.6); the resolver receives ASCII.
- `44/45` is alias-less in the table, so a `44` that could be `44/45` is treated as ambiguous when both doubles
  are present on the product.
