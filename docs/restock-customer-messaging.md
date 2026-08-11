# Restock Customer Messaging (AI Studio Phase 8)

_The FIRST customer-facing workflow action: when an **exact** restock intent matches a real restock,
generate a grounded message **draft**, a human **reviews / edits / approves**, and only **Approve &
Send** contacts the customer through the **existing** channel sender. **There is no autonomous
customer messaging.** Companion to `docs/restock-intents.md`._

```
Variant restocked → exact restock_intent → recovery → grounded DRAFT → human review → Approve & Send
→ existing channel sender → confirmed send → customer_notified_at → audit
```

---

## 1. Channel audit (what exists; what we reuse)

- **WhatsApp — reused.** Canonical sender `sendTextMessage({phone,message})` (`whatsappGatewayService.js`), production-proven (order/shipping notifications use it), dual-transport (Evolution live). Returns a provider message id. Persistence via `appendChannelOutboundSupportReply` (`aiSupportLogService.js`).
- **Messenger / Instagram — reused only via an existing conversation.** Live sender `sendMetaInboxOutboundMessage` (`metaIntegrationService.js`) requires the stored **PSID/IGSID** from an existing `ai_channel_conversations` row. **We never guess IG/Messenger identity from a phone.**
- Dead `aiChannelAdapters/*` wrappers are unused — not built on.

## 2. Eligibility + priority (`resolveRestockNotificationChannel`)

A restock intent carries only `customer_id` + normalized `phone`. Deterministic policy: **existing
conversation channel** (WhatsApp/IG/Messenger, using its stored recipient + conversation id) →
**WhatsApp by phone** (the only channel derivable directly) → `NO_SENDABLE_CHANNEL`. One approved
notification = one channel. IG/Messenger only when an existing conversation exists (documented; phone
alone ⇒ WhatsApp).

## 3. Policy/window constraints

No 24h-window/template gate exists in the codebase (WhatsApp free-form; Meta payloads carry
`messaging_type:"RESPONSE"`). We reuse the existing senders unchanged and add no template
infrastructure. A send that a channel refuses returns a failure → notification `failed`,
`customer_notified_at` stays NULL.

## 4. Notification entity + lifecycle (`restock_notifications`)

Fields: intent/recovery/customer/product/variant, channel, conversation_id, recipient_reference,
`status`, `facts` (JSONB), `draft_text`, `approved_text`, `provider_message_id`, `idempotency_key`,
+ drafted/approved/rejected/sent/failed timestamps & actors. **Unique `(tenant, intent, restock_event)`**
(one notification per intent+event) and **unique `idempotency_key`**. Lifecycle:
`draft → pending_approval → (approved) → sending → sent` | `rejected` | `failed`.

## 5. Draft generation (grounded) + deterministic fallback

`buildDeterministicDraft(facts)` uses only verified facts (customer name if known, product, variant,
size, color, availability, request date) — no discount/price/reservation/urgency/expiry invented.
Unknown name → neutral greeting. LLM is **not required**; an optional rewrite may change wording but
never facts, falling back to the deterministic Arabic draft. **Draft/create/edit/reject perform ZERO
external side effects** — no sender is invoked.

## 6. Approval, edit, reject

`messaging.send_customer` stays **SENSITIVE / APPROVAL_REQUIRED / NOT delegatable** in the Tool
Registry — a delegated grant can never make it autonomous, and the workflow executor can never
auto-run it. The human acts on the notification via the AI Studio → Restock Recovery → **Notifications**
approval surface: **Edit** (persists `approved_text`; original `draft_text` never overwritten),
**Reject** (records `rejected_at/by`; sends nothing; `customer_notified_at` stays NULL), **Approve &
Send**. Facts are shown **separately from the draft** so the approver can catch wording mistakes.

## 7. Approved-send adapter + idempotency (`sendApprovedRestockNotification`)

On Approve & Send the server re-checks: **mode is `approval_send`**, notification exists & not already
sent, intent still active + exact-variant + not legacy + not notified, then performs an **atomic status
claim** (`pending_approval/approved → sending` — the loser of a double-click gets no row, so **two
clicks = one send**). It invokes the canonical channel sender (**injectable** as `deps.sender` so tests
never call a provider), stores `provider_message_id`, persists the message into the canonical
conversation, sets `restock_intents.customer_notified_at` **only on confirmed success**, and audits
every step. Failure → `failed`, `customer_notified_at` stays NULL, no auto-retry.

## 8. `customer_notified_at` semantics

Set for the FIRST time in the product's history — **only** after a confirmed successful send. Never on
draft, approval, open, edit, approve-but-fail, or ambiguous result.

## 9. Explicit-intent-only + legacy exclusion

Outbound requires a canonical **explicit `restock_intent`**, **active** (`waiting`/`recovery_created`),
**exact variant**. **Legacy `customer_wishlist` waiters are NEVER messaged** (product-only, no exact
consent) — they continue to generate internal follow-ups only. Cancelled/fulfilled/expired intents are
excluded.

## 10. Kill switches / modes

Per-tenant `restock_messaging_mode` (on `ai_workflow_tenant_settings`): **`off`** (no drafts, no sends) /
**`preview_only`** (drafts + approval created; **sending disabled**) / **`approval_send`** (Approve &
Send dispatches). **Default `off`. No `fully_automatic` option exists.** Recovery only drafts
notifications when mode ≠ `off`, for exact-variant intents, bounded (25 default / 100 max — one
notification per customer, not a batch), and only additively to the internal follow-up.

## 11. Fan-out

One restock event → many exact intents → **one notification + one approval per customer** (bounded),
created by the Phase 6 bounded recovery service — no giant batch under one approval, no workflow loops.

## 12. UI

AI Studio → Restock Recovery → **Notifications**: a messaging-mode control (Off / Preview only /
Approval + Send), pending/sent/rejected/failed counts, and per-notification cards showing **Facts vs
Draft**, "not sent yet", and Edit / Reject / Approve & Send (Send disabled unless mode is
`approval_send`). Customer 360 / Restock Requests reflect the intent's `customer_notified` status after
a confirmed send.

## 13. Production verification (what was / was not sent)

Deployed with `restock_messaging_mode = off`, automation OFF. **No real customer message was sent
during verification.** The full pipeline (draft + approval created, nothing sent, `customer_notified_at`
NULL) was proven in **preview_only**; the send/idempotency/`customer_notified_at` path was proven with
an **injected fake sender** (no provider call). A genuine provider send is left to the operator against
their **own internal number** with mode `approval_send`.

## 14. Limitations / future (NOT enabled)

- WhatsApp-by-phone is the primary channel; IG/Messenger require an existing conversation.
- No provider sandbox → real end-to-end send verified only with an injected sender / operator's own
  number.
- **Autonomous customer messaging is intentionally not built** — every send is human-approved. A future
  phase could add per-tenant templated sends or delivery-status reconciliation, but must keep the
  SENSITIVE human-approval gate.

## 15. Phase 9 addendum — delivery reconciliation + canonical persistence

Phase 9 adds the **post-send** lifecycle on top of this (approval model unchanged): provider webhooks
(delivered / read / failed) are correlated by `provider_message_id` and applied **monotonically** to
`restock_notifications` delivery fields + the canonical `ai_support_messages` row. It also **fixes the Phase
8.5 finding**: a confirmed WhatsApp-by-phone send is now persisted into canonical AI Inbox history
(`appendChannelOutboundSupportReply` upserts `ai_support_sessions` + `upsertChannelConversationMapping`), only
after a confirmed send. `customer_notified_at` semantics are **unchanged** (provider-accepted); delivered/read
are separate timestamps. No delivery callback can ever create or approve a message, and there is **no
automatic retry**. See `docs/messaging-delivery-reconciliation.md`.
