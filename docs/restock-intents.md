# Restock Intents (AI Studio Phase 7)

_A canonical, **variant-level, explicit-consent** record: "notify/contact me when THIS
product/variant/size/color is available." This is NOT a wishlist. It powers exact-variant Restock
Recovery. **Phase 7 still never sends a customer message** — the employee follow-up remains the action._

---

## 1. Wishlist vs Restock Intent

| | Wishlist (`customer_wishlist`, Phase 6) | Restock Intent (`restock_intents`, Phase 7) |
|---|---|---|
| Meaning | "I saved/like this product." | "Contact me when this unavailable item is back." |
| Granularity | **product only** | **variant** (size/color) or product |
| Consent | implicit opt-in flag | **explicit action** ("بلغني لما يتوفر") |
| Lifecycle | none | waiting → recovery_created → customer_notified → fulfilled / cancelled / expired |

They are **not** the same and are never conflated. Wishlist rows remain a **legacy product-only
fallback**; they are never converted into intents (that would fabricate variant/size consent we don't
have).

## 2. Schema (`restock_intents`, additive)

`id, tenant_id, customer_id?, phone (normalized), product_id, variant_id?, size?, color?, status,
source, source_reference?, last_restock_event_id?, metadata, created_at, updated_at,
customer_notified_at?, fulfilled_at?, cancelled_at?`. A **partial unique index** enforces one
**active** intent per `(tenant, phone, product, variant)` (active = waiting/recovery_created/
customer_notified) — repeated "Notify me" reuses it. `variant_id` = `product_variants.id` (canonical
sellable id); size/color are human-readable snapshots (variant_id is authoritative).

## 3. Lifecycle & the customer-notified rule

`waiting → recovery_created` (an internal employee follow-up was created) `→ customer_notified`
(**only** a future confirmed customer-contact sets this — **never** an internal follow-up)
`→ fulfilled`; or `→ cancelled`. **"Employee follow-up created" ≠ "customer notified"** — Phase 7
never sets `customer_notified_at`. Cancelled/fulfilled/expired intents never match a restock.

## 4. Consent & sources

An intent requires an **explicit** customer/employee action — never created from a view, wishlist
add, cart add, search, or an open conversation, and **never autonomously by the LLM**. `source` ∈
`storefront | ai_inbox | admin | legacy_wishlist`.

## 5. Identity, validation, availability

Authenticated storefront customer via `req.storefrontCustomer.{customer_id, phone}` (phone is
server-forced, unspoofable); phone normalized with the canonical `normalizePhone`
(`utils/phoneSearch.js`) — no second normalizer. The server validates **variant ∈ product ∈ tenant**,
requires the item to be **out of stock** (re-checks via `getInventoryFacts`; returns `available_now`
instead of creating an intent if stock appeared), and reuses an existing active intent (dedup).
**Authenticated-only** — the storefront has no safe guest phone-opt-in primitive (all customer writes
are OTP/JWT-gated; only checkout collects a guest phone). Guest support is a documented limitation.

## 6. Storefront UX (delivered API; UI CTA wiring documented)

Endpoints (mirror `POST /wishlist`, behind `storefrontCustomerAuthRequired`):
`POST /storefront/restock-intents {product_id, variant_id?}`, `GET /storefront/restock-intents`,
`DELETE /storefront/restock-intents/:id`. The product-detail CTA ("بلغني لما يتوفر", success
"هنبلغك لما مقاس X يتوفر") belongs in `StorefrontProductDetailPage.jsx` in the action grid
(rendered when `!variantHasStock(safeActiveVariant)`), posting `product_id: product.id`,
`variant_id: selected.variantId` through the storefront's `storefrontApi` helper with the customer
JWT. The secure endpoint is live; the button is the one remaining thin storefront integration.

## 7. AI Inbox (explicit, non-autonomous)

An employee-created intent uses the **normal authenticated endpoint**
`POST /api/ai-studio/restock-intents {productId, variantId?, phone|customerId, source:"ai_inbox"}`
(`settings.edit`). AI Inbox exposes `{customer via customer360Identifier, product/variant via
product_cards.variant_id}` — **variant is often null from Inbox**, so it is best-effort there and
required from the storefront. The AI may only **suggest**; a human confirms. There is **no autonomous
Tool Registry intent-creation tool**.

## 8. Recovery integration (exact variant first)

`findWaitingCustomersForRestock({tenantId, productId, variantId})` now returns unified candidates:
**(1)** exact-variant intents (`matchQuality: EXACT_VARIANT`), **(2)** product-level intents
(`PRODUCT_ONLY`), **(3)** legacy wishlist fallback (`source: legacy_wishlist, PRODUCT_ONLY`). Priority:
exact variant **+40** > explicit product intent **+10** > legacy **+0** (plus the existing
registered/recency factors). The recovery ledger (`ai_restock_recoveries`) gains `restock_intent_id`,
`source`, `match_quality`; dedup keys on `(tenant, event, source, request_id)` so an intent-id and a
wishlist-id never collide. Creating a follow-up marks the intent `recovery_created` (not
`customer_notified`).

## 9. Follow-up content

Exact-variant: _"… Size 44 is back in stock (6 available). … Match: exact requested variant."_
Legacy: _"… Match: product-level only — requested size unknown."_ (the size is **never** fabricated
for a legacy waiter).

## 10. Operator UI

AI Studio → Restock Recovery has a **Waiting Requests** view: customer, product, variant/size, match
badge (Exact variant / Product only — size unknown), source, requested, status, and Cancel/Fulfil
actions; real intent counts (waiting / exact-variant / recovery_created / customer_notified /
cancelled). A compact Customer 360 section is a documented follow-up (`Customer360Drawer` products/
summary tab).

## 11. Migration strategy

Additive only. `customer_wishlist` is never mutated; old rows stay a legacy product-only fallback and
are never bulk-converted. No variant is inferred for old rows; no customer is marked notified. The new
system starts clean for explicit requests.

## 12. Fulfilment

There is no reliable deterministic order↔intent link today (intents key on phone+variant; orders don't
carry an intent id), so **no speculative auto-fulfilment** was added. An employee can manually mark an
intent fulfilled/cancelled. A future clean link could drive auto-fulfilment.

## 12.5 Phase 7.5 — UX integration (three surfaces)

All three surfaces write to the **same** canonical `restock_intents` (only `source` differs) — no
parallel models. **Phase 7.5 still sends nothing to customers and never sets `customer_notified_at`.**

**Storefront** (`StorefrontProductDetailPage.jsx` + pure `lib/restockIntentUi.js`): a
"بلغني لما يتوفر" CTA appears **only when the currently selected variant is out of stock**
(`shouldShowRestockCta`), submitting the actual `selected.variantId`. State is keyed per variant, so
switching Size 44 → 45 shows the new variant's state (no leaked success). Success/reuse →
"✓ هنبلغك لما مقاس 44 يتوفر" (actual labels; **never** promises a channel). `available_now` →
"المقاس متوفر دلوقتي" (no intent created). Duplicate active intent is treated as success. Uses the
existing `storefrontCustomerRequest`/`readStorefrontCustomerAuth`; **authenticated-only** — logged-out
shows "سجّل دخولك…" (existing auth, no new flow). One cheap `GET` on mount marks already-requested
variants ✓. **Cart/checkout/wishlist untouched.**

**AI Inbox / customer context** (`Customer360Drawer.jsx`, Products tab → "Restock Requests"): lists
the customer's intents (exact-variant vs legacy badge, status, source, requested), with **Cancel**;
plus an **explicit, human-confirmed "إنشاء طلب إبلاغ عند التوفر"** that requires a **variant id**
(no fake exact intent) and posts to the authenticated employee endpoint (`source: ai_inbox`). The AI
never creates an intent autonomously. `available_now` → "المقاس متوفر بالفعل". (A richer product/
variant *picker* — vs entering the ids shown on the conversation product card — is a documented future
enhancement.)

**Customer 360**: the same "Restock Requests" section is the compact Customer 360 surface (human-
readable product/variant/size, status, source, exact-vs-legacy), reusing existing routes; no redesign.

APIs used: storefront `POST/GET/DELETE /storefront/restock-intents`; AI Studio
`GET /api/ai-studio/restock-intents?phone=…`, `POST …/restock-intents`, `POST …/:id/cancel`.

## 13. Limitations & future

- Storefront CTA button + AI Inbox UI button + Customer 360 section are thin remaining integrations
  (secure APIs delivered).
- Guests unsupported (auth-gated).
- **Customer messaging is a separate future phase** — Phase 7 stops at explicit intent capture +
  internal employee follow-ups. No WhatsApp/Instagram/Messenger/SMS/email send exists.
