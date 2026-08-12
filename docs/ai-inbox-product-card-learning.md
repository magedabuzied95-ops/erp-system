# Phase 11.2 — Send-Ready Product Cards + Bounded Employee-Edit Learning

Human-approved AI Inbox suggestions can now carry a **grounded, send-ready product card**, and the
approve action sends the reply text **and** the card as one operation through the **existing canonical
senders**. Employee edits continue to feed the **existing** correction store; style learning is bounded and
admin-controllable. No autonomous replies, no second brain, no duplicate sender.

## Product-share capability map (audited, not assumed)

| Channel | What the provider actually sends today | Code |
|---|---|---|
| facebook_messenger | **Rich card** — Meta generic template (title / subtitle color•size•price / image / "عرض المنتج" button); image→text fallback | `metaIntegrationService.js` `buildMessengerGenericTemplatePayload` |
| whatsapp | **image + caption** (caption carries name/sizes/price/link); text fallback | `aiChannelAdapterService.js` |
| instagram | **plain text + link only** — generic template not supported on IG DM | `metaIntegrationService.js` |

The AI Inbox always shows one consistent product card; the **delivery-format label** on the card tells the
employee what the customer will actually receive per channel (rich card / image+link / link).

## Canonical attachment model (reuse)

- The **grounding gate** (`aiInboxGroundingGate.js`) emits a `send_ready_card` **identity** (`product_id`,
  `variant_id`, `size`, `color`, `in_stock`) only when exactly one product resolved, and `card_choices` +
  `product_ambiguous` when the term matched more than one product.
- `generateAiInboxReply` **enriches** that identity into a send-ready card with `enrichGroundedSendReadyCard`,
  reusing the canonical services: `resolvePublicProductUrl` (URL), `resolveCustomerDisplayPrice` (price — blocks
  cost/wholesale/supplier), product image, `availableProductSizes`. The card is stored on the draft's existing
  `product_cards[]`; ambiguity + enriched choices + delivery channel live in `metadata.send_package`.
- Sending reuses the **existing** `POST /conversations/:id/product-card/send` (canonical Messenger/WhatsApp
  senders, `outboundSignature` dedupe, per-card partial failure). No new sender was created.

## Grounding is authoritative / disambiguation

A card is auto-attached **only** from the grounded result (resolved product + variant, verified size/color).
Remembered/popular products are never attached. When "Jordan 4" matches product 208 **and** 39, **no single
card is attached** — the employee sees **choices** and must pick before Approve & Send. This is the
deterministic product disambiguation identified in Stage A.

## UI (minimal enhancement, no redesign)

The existing `AiSuggestionCard` gains: **AI Suggested Reply → Grounding Facts → Product to Send → delivery
format → Edit / Remove Product / Change Product / Reject / Approve & Send**. "Change Product" opens the real
catalog picker in **select mode** (no arbitrary id, does not send); "Remove Product" sends **text only**.

## Package Approve & Send / idempotency / stale / partial failure

One click: the **text** is sent first (server stale guard + send idempotency preserved); on success the
approved **card** is sent via the canonical product-card path (its own `outboundSignature` dedupe). If the text
is **stale** (a newer customer message arrived) the whole package is blocked — neither text nor card is sent.
A double-click is blocked by the in-flight guard and the two servers' dedupe. If the card send fails after the
text, the employee is told (partial failure surfaced, no silent success, no auto-retry).

## Employee-edit learning (bounded, reuse)

- Edited approvals already persist to `ai_reply_corrections` (original AI draft vs final reply, product,
  channel) via the send route — unchanged.
- Approve carries `product_disposition` (kept / removed / changed) in the correction metadata.
- **Style vs facts:** relevant prior corrections are retrieved (`searchRelevantCorrections`, small K) as phrasing
  examples **before** generation; the **grounding gate runs last and re-asserts stock/price/product**, so
  employee style memory can influence wording but **can never** teach stock/price/policy facts.
- **Control:** `ai_agent_settings.settings.style_learning_enabled` — **OPT-IN, default FALSE**. A tenant that has
  never configured it gets **no** style-example injection (adaptive behavior is never silently enabled). Only a
  literal `true` turns it on. AI suggestions still work with it off; grounding is unaffected. No automatic
  fine-tuning, no self-modifying prompts, no hidden chain-of-thought.

## Analytics

AI Studio surfaces the already-computed `approved_unchanged` / `approved_after_edit` / stale / skipped / errors
from `ai_inbound_intake_log`. Product kept/removed/changed is persisted in correction metadata.

## Limitations

- **Instagram** has no provider rich card (text+link only) — IG Stage B is out of scope.
- The storefront URL builder is **product-level** (no variant/color deep-link params) — the card links to the
  product; exact-variant deep links would be a net-new storefront enhancement.
- Package send is text + card (two provider messages on Messenger: conversational text + the template card),
  each individually idempotent; there is no single-message atomic combine.
