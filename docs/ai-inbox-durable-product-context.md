# AI Inbox — Durable Grounded Product Context (Phase 12.1)

A bounded, deterministic enhancement so a **continuation** that omits the product resolves to the
product the conversation was already talking about — instead of asking "which product?" again.

```
Customer: عندكم جوردن فور مقاس 45؟      → grounded: Air Jordan 4 / #39 / size 45 (employee approves & sends)
Customer: طب مقاس 44؟                    → reuse #39 as CONTEXT, re-read size-44 stock FRESH → grounded answer
```

This is **product SUBJECT memory only** — never fact memory, never chat/preference/LLM memory.

---

## 1. Subject vs. facts (the core rule)

Durable context may retain a product **identity**: `product_id`, the source reference, a timestamp.
It is **never** authoritative for stock, price, size/variant availability, promotion, policy,
shipping, or order status. Every new customer question re-runs the canonical grounding pipeline and
re-reads current ERP facts. The recalled product is fed in exactly like an explicitly-named product
would be — through the same `queryProducts`/variant-grounding/`decideGrounding` path.

## 2. Source precedence (audited)

Resolved by `resolveConversationProductSubject` ([aiInboxGroundingGate.js](../server/services/aiInboxGroundingGate.js)),
strictly session-scoped, `LIMIT 1`, indexed by `created_at`:

1. **Most recent employee-approved product selection** — `ai_reply_corrections.product_id`
   (written only on an assisted **approve**; never on a rejected/stale/ambiguous suggestion).
2. **Most recent SENT canonical product-card message** — `ai_support_messages.product_cards[0].product_id`
   where `message_type='product_card'` and `delivery_status ∈ (sent, mock_sent, delivered, read)`.

Rejected suggestions, stale/superseded drafts, and merely-recommended cards **cannot** become a
subject — they never produce a correction row or a sent product-card. `requested_product_terms` /
`requested_sizes` columns are **not** used (unreliable / empty in practice).

## 3. Data model decision

**No new table.** Both sources are existing, cheap, deterministic, and session-scoped. Adding a
session field was considered and rejected — the existing evidence is sufficient and already indexed.

## 4. Recency bound

`DURABLE_PRODUCT_CONTEXT_MAX_AGE_MS` — default **30 minutes**, overridable via
`AI_INBOX_PRODUCT_CONTEXT_MAX_AGE_MS`. Enforced in SQL (`created_at > NOW() - interval`). Explicit
constant; never silently widened. Beyond the window → no subject → normal clarify.

## 5. Scoping (no cross-customer leakage)

Every query is keyed by the exact canonical `session_id` / `conversation_id`
(`instagram:<IGSID>`, `facebook_messenger:<PSID>`, `whatsapp:<phone>`). A subject can never be
inherited from another Instagram IGSID, another Messenger PSID, a different channel, or another
conversation for the same customer name. Provider identity remains authoritative. When no session is
supplied, the resolver is never even called.

## 6. When context is used

Only when the new message is **continuation-shaped** (explicit size, colour, availability ask, or a
price question) **and** names no substantive product. A "bare continuation" is detected by
`hasExplicitProductMention` — filler words (طب، طيب، مقاس، بكام…) and colour words are stripped; if a
real product/brand token remains, context is **not** used.

## 7. Explicit new product always wins

If the new message names a resolvable product/brand ("طب الكروكس مقاس 44؟", "طب Nike Air Max؟"),
that resolves first (category term or the brand/model alias engine) and the context block is skipped
entirely. The old subject is never backfilled over a new resolvable subject.

## 8. Ambiguity

A prior turn that showed multiple products the employee never chose leaves **no** durable subject
(no correction, no single sent card) → the continuation clarifies. Only a definitively selected /
sent product (e.g. #39) becomes valid context.

## 9. Fresh ERP grounding & fact safety

After the product identity is recalled, grounding is fully re-run:
- **Stock** — size-44 is queried fresh; size-45 having been available never implies 44 is. Stock 0 →
  "unavailable" even for the recalled product.
- **Price** — read from the current customer-facing ERP price by the downstream card enrichment;
  never the price sent minutes ago.
- **Colour** — "والاسود؟" reuses the product identity only; black is resolved against current
  variants (not assumed to exist).
- Ambiguous variant mapping → clarify.

## 10. Observability

`grounding.product_resolution` records provenance:
`{ source: "conversation_context", product_id, context_age_seconds, source_message_id, evidence }`
for a recalled subject, or `{ source: "explicit_message" }` otherwise. The AI Inbox shows a small
grounding chip **"المنتج من سياق المحادثة"** so the operator knows the product came from context.

## 11. Performance

Two session-scoped `LIMIT 1` reads on indexed `created_at`, and only when a bare continuation is
detected — never a full-conversation scan and never a fuzzy catalog search to recover the subject.

## 12. Preserved invariants

Current-suggestion invariant, server stale protection, package idempotency, provider ids, product
disposition, and style-learning evidence are all unchanged. Style profile shapes wording only and has
**no** role in selecting the subject. Human takeover still blocks suggestion generation; on Return to
AI, context is reused only if still inside the recency window.

## 13. Multi-colour size disambiguation (Phase 12.2)

For a recalled (or explicit) product + a requested size with **no colour**:
- **0** in-stock colours → unavailable.
- **1** in-stock colour → auto-ground that exact variant (the proven Adistar-Navy behaviour).
- **>1** in-stock colours → **`color_choice_required`**: confirm the size is available and surface grounded
  colour choices `[{ color, variant_id, stock, product_id, size }]` (deduped by normalised colour,
  best-stock representative per colour) — **never** silently pick the highest-stock colour. No card is
  definitive until a colour is picked; the employee must choose (or Remove) before Approve & Send.

**Explicit colour always wins**: "مقاس 43 الأسود؟" resolves the black variant directly (no choices); if black
is unavailable it reports that per existing policy — never substitutes another colour. All colour facts come
from **current** ERP variant stock (never previous-turn stock/colours). After a colour is picked, the send-ready
card/link represents that grounded variant via the existing channel capability (Messenger rich card / Instagram
concise text+link — the Instagram formatter is unchanged).

### Arabic stock wording
One deterministic helper `formatArabicPieces(n)` — `1 → قطعة واحدة`, `2 → قطعتين`, else `N قطع` — used wherever a
customer-facing count is shown. Presentation only; never changes the stock number, availability, or variant.
The style profile can still omit the exact count as before.

## 14. Known limitations

- 30-minute window is deliberately conservative; long gaps clarify (safe).
- A bare price "بكام؟" recalls the subject but the concrete variant may still need a size to be exact.
- Channel-agnostic (one resolver for Messenger + Instagram); WhatsApp inherits it when Stage C is
  explicitly approved.
