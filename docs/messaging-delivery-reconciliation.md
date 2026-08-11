# Messaging Lifecycle & Delivery Reconciliation (AI Studio Phase 9)

_After an approved customer message is **sent** (Phase 8), the provider reports back its real lifecycle —
delivered, read, or failed. Phase 9 consumes those provider events through the **existing** webhook paths,
correlates them to the exact outbound message + restock notification by **provider message id**, and applies
a **monotonic** status that never moves backwards. It also fixes the Phase 8.5 finding by persisting the
confirmed outbound into canonical AI Inbox history. **Phase 9 does NOT turn inbound customer messages into
workflow triggers — that is a future phase.** Companion to `docs/restock-customer-messaging.md`._

```
approved send (Phase 8) → provider webhook (delivery/read/failed) → reconcile by provider_message_id
→ monotonic canonical status (sent<delivered<read | failed) → notification delivery projection + AI Inbox row + audit
```

---

## 1. Provider delivery audit (what already exists)

- **WhatsApp / Evolution — reconciliation ALREADY existed.** `POST /api/whatsapp/webhook` →
  `handleIncomingWebhook` → `processEvolutionStatusUpdate` (`whatsappGatewayService.js`) parses `statuses[]`
  and writes `ai_support_messages.delivery_status` via `updateAiSupportMessageDeliveryStatus`
  (`aiSupportLogService.js`). Correlation key = Baileys `key.id`. **Three gaps existed:** numeric ack levels
  weren't decoded, updates weren't monotonic (a late `delivered` clobbered `read`), and there was no
  persistent event-id dedup. Phase 9 closes all three.
- **Meta (Messenger/Instagram) — inbound-only.** `POST /api/meta/webhook` → `processMetaWebhook`
  *subscribes* to `message_deliveries` / `message_reads` but previously **dropped** them. `delivery.mids` is a
  reliable per-message array; `read` is a **watermark only** (no per-message id).

## 2. Canonical lifecycle (one internal vocabulary)

`pending < sending < sent < delivered < read`, plus `failed`. Provider-specific strings/acks are mapped into
this once, in `mapProviderStatus(channel, raw)` — including **numeric Baileys acks** (0 pending, 1 sent,
2 delivered, 3 read, 4 played→read). Unknown/ambiguous → `null` (recorded, never applied). The UI shows only
these canonical states; provider codes stay under an Advanced detail.

## 3. State ordering (monotonic)

`statusRank`: pending 0, sending 1, sent 2, delivered 3, read 4; `failed` shares rank 2. `isAllowedTransition`
advances only: `read → delivered`, `delivered → sent`, `read → sent`, and duplicates are **refused**. A late
`failed` is applied **only before** a confirmed delivered/read (`isAllowedTransition(delivered,'failed')=false`).
The monotonic guard is enforced both in SQL (`updateAiSupportMessageDeliveryStatus` CASE) and in the
notification projection.

## 4. Provider event idempotency

Every provider event is recorded in `message_delivery_events` with a `dedup_key`
(`evt:<tenant>:<channel>:<providerEventId>` when the provider supplies an id, else
`msg:<tenant>:<channel>:<providerMessageId>:<canonicalStatus>`), backed by `UNIQUE (tenant_id, dedup_key)`.
The insert is `ON CONFLICT DO NOTHING`; a duplicate returns `{ duplicate:true }` → **exactly one** effective
transition, and the audit log is never spammed by repeats.

## 5. Out-of-order events

Duplicate/late callbacks are safe: `delivered`-before-`sent`, `read`-before-`delivered`, duplicate `read`,
late `sent`-after-`read`, and late `failed`-after-`delivered` all leave the correct terminal state, because
the transition is gated by rank, not by arrival order.

## 6. Correlation (by provider message id only)

`reconcileOutboundMessageStatus` resolves the canonical outbound `ai_support_messages` row and the
`restock_notifications` row **by `provider_message_id`** (the Phase 8 send stores it; Phase 9 also persists the
channel row with it — see §8). **No fuzzy text matching, no nearest-timestamp guessing.** An event that
matches nothing is stored as `unmatched` for observability (`GET /ai-studio/restock-notifications/unmatched-events`).

## 7. Schema (additive)

- New `message_delivery_events` (tenant-scoped ledger: channel, provider_message_id, provider_event_id,
  status, previous/new_status, occurred/received_at, matched, matched_message_id, notification_id, reason,
  `dedup_key`, sanitized metadata). No raw provider bodies are stored.
- `restock_notifications` gains `delivery_status`, `delivered_at`, `read_at`, `provider_failed_at`,
  `provider_failure_code`, `provider_failure_reason`, `last_provider_event_at` — a **monotonic projection** for
  the operator UI. Migration `2026-08-11-phase9-message-delivery-reconciliation.sql`.

## 8. Canonical conversation persistence (the Phase 8.5 fix)

**Decision: a confirmed outbound WhatsApp-by-phone send now creates/upserts the canonical conversation.** The
Phase 8 `persistOutbound` was broken (gated on a null conversation id; wrong param names; passed a PK instead
of the `whatsapp:<phone>` session id) so the outbound never reached history. Phase 9 calls
`appendChannelOutboundSupportReply({ sessionId:"whatsapp:<phone>", message, providerMessageId,
deliveryStatus:"sent", resolvedPhone })` — which upserts `ai_support_sessions` + inserts `ai_support_messages`
even with no prior conversation — **plus** `upsertChannelConversationMapping` for omnichannel-directory parity.
This is done **only after a confirmed provider send** — never on draft/approval/preview/failed (**no ghost
messages, no ghost conversations**). Dedup by `provider_message_id` means the later provider `fromMe` echo does
not create a second row. A later inbound from the same normalized phone converges on the same
`whatsapp:<20…>` session.

## 9. Failure & retry semantics

Three distinct failures are preserved, not collapsed: (a) internal sender error before provider acceptance →
notification `failed`, `customer_notified_at` stays NULL (Phase 8); (b) provider rejected the send; (c) provider
accepted then reported delivery failure → `delivery_status='failed'` + `provider_failed_at`/reason, surfaced for
**human review**. **No automatic customer-message retry** exists in any case.

## 10. `customer_notified_at` & intent status (unchanged)

`customer_notified_at` still means **"provider accepted the approved send"** and is set only there (Phase 8).
Delivery/read add **separate** `delivered_at`/`read_at`; they never move `customer_notified_at`. A post-accept
delivery failure does **not** revert the intent from `customer_notified` to `waiting` — it is exposed for review.
The reconciler never writes `restock_intents` (enforced by test).

## 11. Webhook integration (no new public endpoints)

WhatsApp: `processEvolutionStatusUpdate` now also calls `reconcileOutboundMessageStatus` (failure-isolated).
Meta: `processMetaWebhook` gained an additive, failure-isolated branch that reconciles `delivery.mids →
delivered` per message. Inbound handling is untouched; Phase 9 only **consumes** delivery/status events.

## 12. Failure isolation & unmatched observability

`reconcileOutboundMessageStatus` is wrapped so a malformed/unmatched/duplicate event can **never** throw into
the webhook processor (it always resolves). Unknown statuses and unmatched provider ids are recorded (bounded,
sanitized — channel, provider id, status, reason, time) and surfaced in the UI; provider secrets and raw bodies
are never logged.

## 13. Messenger / Instagram limitations (honest)

Meta **delivery** is reconciled per-message (reliable via `delivery.mids`). Meta **read** is a
**watermark-only** timestamp with no per-message id, so it is **intentionally not applied** (the UI does not
show fake read state). Meta identity is never derived from a phone — outbound-first Meta conversations do not
exist.

## 14. UI

AI Studio → Restock Recovery → **Notifications**: Delivered / Read / Delivery-failed counts, and each sent card
shows a **Sent → Delivered → Read** timeline with timestamps (text + icon, not colour alone), a failure line
with the provider reason ("needs review — no automatic retry"), and an **Advanced** disclosure with the provider
message id, channel, and last-event time.

## 15. Production verification

Deployed with `restock_messaging_mode = off`, automation OFF. **No real customer/provider message was sent in
Phase 9.** The reconciliation lifecycle (delivered → read, idempotent replay, out-of-order safety, unknown/
unmatched handling, monotonic guard, `customer_notified_at` unchanged, no auto-retry) was proven against a
**fresh synthetic test notification with injected/synthetic provider events**, then cleaned up — the genuine
Phase 8.5 evidence (notification 3, provider id `3EB0401D903792C124B519`) was **not** mutated or given
fabricated delivery state.

## 16. Known limitations / future

- Meta read receipts (watermark-only) are not surfaced.
- Delivery reconciliation is proven with synthetic events; a real end-to-end provider delivery receipt depends
  on live provider callbacks in the operator's environment.
- **Inbound-message workflow routing / autonomous replies / automatic retry are intentionally NOT built.**
