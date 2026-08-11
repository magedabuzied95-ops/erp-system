# AI Inbox Intent Accuracy & Exact Product/Variant Grounding (AI Studio Phase 10.6)

_A quality/grounding correction to the **existing** AI Inbox brain. It does not add autonomous replies,
does not change the human-approval model, and does not create a second brain. Companion to
`docs/inbound-omnichannel-intake.md`._

## The live failure this fixes

A real Messenger message — `"السلام عليكم ورحمة الله / عندكم كروكس اسود مقاس 44 ؟"` — produced
`detected_intent = GREETING` and recommended **Air Jordan** products (not Crocs), with no size-44 stock
check. The suggestion was never sent (Phase 10 requires human review), but it was wrong.

## Root cause (verified)

The AI Inbox draft is produced by `generateAiInboxReply` (`aiSalesAgentService.js`), **not** by
`classifyIntent`/`generateUnifiedConversationDecision`/`aiBrainV2Service` (those are dead relative to this
path). Two independent defects combined:
1. **Intent:** `resolveIntent` (`aiIntentResolver.js`) checked greeting **first** with an unanchored
   `.includes("السلام")` and early-returned `GREETING`, never evaluating the product/size signal in the
   same message.
2. **Products:** `loadAiInboxRecommendations` merges **ungated** `remembered`/`discussed` products (carried
   over from conversation memory/history), so a previously-shown Air Jordan was re-attached regardless of
   the current "Crocs" request. The token "كروكس" was only ever matched against variant color/size (never
   product_type/brand/name), so it constrained nothing, and confidence was hardcoded `0.82` whenever any
   card was present.

## The fix (deterministic, additive, one brain)

- **Intent precedence** (`aiIntentResolver.js`): substantive business signals (availability/size/price)
  beat a leading greeting; greeting only wins when there is no business signal. Enum unchanged.
- **Arabic-digit size** (`aiMessageExtractors.js`): `٤٤ → 44` before size extraction.
- **Grounding gate** (`aiInboxGroundingGate.js`, new): a failure-isolated, deterministic gate applied
  **after** the brain composes the draft and **before** it is persisted (`generateAiInboxReply`). It:
  - Extracts requested entities — product/category (`كروكس → product_type 'crocs'` via
    `productClassificationsService` / `productAliasEngine`), color (`اسود/أسود → black`), size (Arabic
    digits normalized) — reusing `normalizeSalesText`; no new taxonomies.
  - **Compatibility gate:** resolves real catalog products constrained to the requested `product_type`;
    rejects incompatible candidates (Crocs ≠ Air Jordan) and **replaces** the draft's cards with compatible
    ones (or none).
  - **Exact-variant grounding:** for a size/color request, checks the exact variant stock via
    `getInventoryFacts`. An availability claim is made **only** with exact-variant evidence
    (`stock > 0` → available; `= 0` → unavailable + restock offer).
  - **Clarification fallback:** when the exact variant can't be resolved (e.g. Crocs use **M/W** sizing, so
    numeric "44" has no match), it asks a clarifying question instead of guessing. Missing-product
    (`"عندكم مقاس 44؟"`) → asks which product. Never substitutes an unrelated product.
  - **Restock intent:** `"بلغني لما … ينزل"` → classified `RESTOCK_REQUEST` and **suggests** registering a
    notification — it never autonomously creates a restock intent (Phase 7.5 rule preserved).
  - Records a structured **grounding bundle** (`requested` vs `resolved` entities + `action`) in the draft
    metadata for employee explainability; demotes confidence when unresolved. No chain-of-thought.

## For the exact live message, after the fix

`intent = PRODUCT_AVAILABILITY`; requested `Crocs / black / 44`; because Crocs sizes are stored M/W (no
numeric 44), the grounded action is **`clarify_size`** — a polite clarification, Crocs-only cards, **no Air
Jordan, no fabricated availability**.

## Regression matrix

`tests/ai-workflows/inboxGrounding.test.js` covers the exact live message plus A–M: greeting-only,
greeting+product, Arabic digits, missing-product clarification, order-status/return-policy/restock
precedence, incompatible-candidate rejection, size/color mismatch (no availability claim), and exact
in-stock/out-of-stock outcomes.

## Safety / scope

- The gate is **failure-isolated** — any error leaves the original draft untouched; it never throws into
  the reply pipeline.
- It **only edits an already-composed draft** — no send, no order/stock/financial writes, no autonomous
  restock creation. `messaging.send_customer` stays SENSITIVE; the human-approval model is unchanged.
- Blast radius is bounded: the gate only intervenes when a product/category is named, or an
  availability/size question is asked, or a restock is requested — otherwise the existing behavior is
  preserved. The dead `aiBrainV2Service`/`aiUnifiedDecisionService` stack was intentionally **not** touched.

## Phase 10.7 addendum — footwear size grounding

The clarify-on-size case is now resolved: `aiInboxGroundingGate` calls `footwearSizeResolver` (which reuses
the canonical `src/shared/lib/crocsSizes.js` table) so a customer EU size ("44") maps to the exact Crocs
variant marking ("M10/W12") **against the product's real variants**, then checks stock. Deterministic states
(EXACT_CANONICAL / EXACT_ALIAS / UNIQUE_CONVERSION / AMBIGUOUS_CONVERSION / NO_MAPPING / NO_VARIANT_MATCH)
decide available / unavailable / clarify. See `docs/footwear-size-grounding.md`.

## Known limitations

- Crocs numeric→M/W size conversion is not performed; the correct-and-honest outcome is a size
  clarification (a future enhancement could reuse the storefront Crocs EU-size mapping).
- Product/color/size vocabulary is the common Arabic/Latin set; unusual spellings may fall through to a
  clarification (safe) rather than a wrong answer.
- The gate corrects the draft text/cards; the upstream `searchAiSalesProducts` ranking and the ungated
  memory carry-over are left in place (bounded by the gate) rather than rewritten, to keep blast radius low.
