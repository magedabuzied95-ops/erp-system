# Inbound Omnichannel Intake — Human-Approved AI Replies (AI Studio Phase 10)

_When a customer sends an inbound message, Phase 10 pre-generates a **grounded reply SUGGESTION** for a
human to approve, edit, or reject in the existing AI Inbox — then sends through the existing canonical
human-send path. **There is no autonomous reply.** It reuses the existing canonical inbox, the existing AI
brain, and the existing send path; it does not create a second inbox or a second brain. Companion to
`docs/messaging-delivery-reconciliation.md`._

```
customer message → existing provider webhook → canonical persistence (ai_support_messages) →
Phase 10 intake hook (post-persistence, failure-isolated) → grounded SUGGESTION (generateAiInboxReply, no send)
→ AI Inbox → human Edit / Reject / Approve & Send → existing canonical send → Phase 9 delivery reconciliation
```

## 1. Inbound audit (what already exists)

- **WhatsApp/Evolution:** `POST /api/whatsapp/webhook` persists the inbound canonically inside
  `saveWhatsappIncomingToAiInbox` (message row + session + conversation mapping), returns
  `inbox.{saved,duplicate,session_id,message}`. Existing `triggerWhatsappAiAutoReply` only **auto-sends** in
  `fully_automatic`; in the default `suggest_only` it does nothing — that gap is what Phase 10 fills.
  Single-tenant (`WHATSAPP_TENANT_ID`, default 1).
- **Meta (Messenger + Instagram):** `POST /api/meta/webhook` → `processMetaWebhook` persists via
  `logIncomingToInbox` (same tables). **Multi-tenant** (`config.tenant_id`). An existing autonomous brain
  (`generateUnifiedConversationDecision`) **auto-sends** when channel settings are on. Persistence is not
  wrapped in try/catch, so a hook throw would cause an HTTP 500 + Meta retry — the intake is therefore
  fire-and-forget and cannot throw.
- **One canonical inbox** = `ai_support_messages` / `ai_support_sessions` / `ai_channel_conversations`.
  **One AI brain** = `generateUnifiedConversationDecision` / `generateAiInboxReply`. Both reused, not rebuilt.

## 2. Post-persistence hook (never a second inbox)

Phase 10 runs **after** canonical persistence, gated on `saved && !duplicate && text && !fromMe`:
- WhatsApp: in the webhook route, after `triggerWhatsappAiAutoReply`, fire-and-forget.
- Meta: in `processMetaWebhook`, in the non-autonomous branch (`suggest_only`/`auto_reply_after_approval`),
  fire-and-forget, dynamic import.
Both are `.catch`-wrapped: **a Phase 10 failure never rejects the webhook or loses the customer message** —
it stays visible in the AI Inbox and the employee can reply manually.

## 3. Intake service (`aiInboundIntakeService.handleInboundMessageIntake`)

Deterministic gates, each a documented skip (most before any DB call): global capability off → tenant mode
off → outbound echo → autonomous channel (fully_automatic, avoid double-processing) → non-text →
human-controlled (`human_takeover`/`closed`/`ai_enabled=false`) → duplicate. If it passes, it calls the
**existing** `generateAiInboxReply({persist:true})` which grounds on the same READ facts as the Tool
Registry, validates, scores confidence, and **persists a draft (`ai_support_sessions.last_ai_reply_draft`,
status `not_sent`) — and never sends.**

## 4. Controls (default OFF, no autonomous mode)

- Global capability: env **`AI_INBOUND_WORKFLOWS_ENABLED`** (default false) — also gates the
  `channel.message_received` trigger's availability/authorability.
- Per-tenant **`inbound_ai_mode`** on `ai_workflow_tenant_settings`: **`off`** (nothing) / **`suggest_only`**
  (draft a suggestion) / **`approval_reply`** (draft + surface Approve & Send). **Default `off`. No
  `fully_automatic`.** Manual AI Inbox operation is unaffected when the capability/mode are off.

## 5. Idempotency

One suggestion per inbound provider message via the existing `ai_inbound_ai_reply_locks`
(`claimAiInboxReplyLock`) with a **namespaced channel `p10:<channel>`** so it can never collide with the
autonomous auto-reply lock. Duplicate webhook → `duplicate_intake` skip. Persistent, not in-memory.

## 6. Human approval + send (reuse, not a new path)

The suggestion appears in the existing AI Inbox. The human **Edit / Reject / Approve & Send** uses the
existing canonical send (`POST /conversations/:id/send`) — provider send + `appendManualAiSupportReply` +
edit-correction capture + `clearAiReplySuggestionDraft`, idempotent, no auto-retry. **`messaging.send_customer`
stays SENSITIVE / APPROVAL_REQUIRED / non-delegatable and `executable:false`** — the workflow executor
cannot send; every send is a human action. There is **no second, weaker send path**.

## 7. Stale-reply protection

The draft is one-per-conversation (last-write-wins): a newer inbound regenerates/overwrites it, and the send
path re-reads the current draft + captures a correction when the sent text differs. A suggestion generated
against an outdated state is superseded rather than sent.

## 8. Tools / grounding / security

Reasoning uses only READ facts (products, inventory/stock, orders, shipping, policy) via the existing
grounded harness — the same source of truth as the Tool Registry READ tools; no WRITE/SENSITIVE tool and no
customer send is reachable automatically. Customer text is untrusted input: it cannot change tools,
permissions, prompts, or approval; grounding invents no facts and the grounded rewrite bails on low
confidence. No secrets, tokens, raw payloads, or chain-of-thought are logged — the `ai_inbound_intake_log`
stores only channel/conversation/intent/outcome/confidence/reason/duration.

## 9. Observability

Per-intake `ai_inbound_intake_log` (bounded, sanitized) + the existing `ai_reply_traces` pipeline trace
(intent, tools, facts, timings). `GET /ai-studio/inbound-ai/stats` surfaces suggested/skipped/errored counts;
the AI Studio Overview shows the mode control + counts.

## 10. Channels

WhatsApp, Messenger, Instagram — all proven to share the canonical persistence hook point. Text-only in this
phase; media/audio/stickers persist normally in the Inbox but do not trigger AI reasoning.

## 11. Production verification

Deployed with **`AI_INBOUND_WORKFLOWS_ENABLED` unset (capability OFF)** and tenant `inbound_ai_mode = off`.
**No real customer message was processed or sent.** The gating, idempotency, failure-isolation, and grounded
suggestion generation were proven against a **synthetic inbound message** (no provider, no send), then cleaned
up.

## 12. Known limitations / explicitly NOT built

- Text-only; no multimodal AI reasoning.
- No autonomous replies; no automatic customer-message retry; no `fully_automatic` inbound mode.
- No burst debounce/queue was added (last-write-wins draft supersedes rapid messages); a bounded debounce is a
  possible future refinement.
- The visual workflow builder node for `channel.message_received` is a prepared contract; the actual
  suggestion generation reuses `generateAiInboxReply` (the canonical brain) rather than the generic executor,
  because the executor intentionally cannot send.
