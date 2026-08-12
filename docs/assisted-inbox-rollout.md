# Live Assisted AI Inbox Rollout (AI Studio Phase 11)

_Moves the inbound AI from dormant/tested to LIVE assisted use for employees, staged per channel
(Messenger → Instagram → WhatsApp). **There is no autonomous reply**: AI drafts a grounded suggestion, a
human Edits / Rejects / Approves & Sends from the existing AI Inbox. Companion to
`docs/inbound-omnichannel-intake.md` and `docs/ai-inbox-grounding-quality.md`._

## Operating model (unchanged safety)

```
customer message → canonical AI Inbox → intake (per-channel, debounced) → grounded SUGGESTION (no send)
→ employee Edit / Reject / Approve & Send → existing canonical /conversations/:id/send → provider send
```
`messaging.send_customer` stays SENSITIVE / non-delegatable; no `fully_automatic` assisted mode exists.

## Controls (server-authoritative, no deploy to change)

- **Global capability**: env `AI_INBOUND_WORKFLOWS_ENABLED` (default false).
- **Tenant mode**: `inbound_ai_mode` = `off` / `suggest_only` / `approval_reply` (default off). Setting `off`
  is the **kill switch** — it stops new suggestion generation without breaking inbound persistence, the
  Inbox, or manual replies. No deploy.
- **Per-channel (staged rollout)**: `inbound_ai_channels` JSONB on `ai_workflow_tenant_settings`
  (`{facebook_messenger,instagram,whatsapp}` → bool, default all off). A channel produces suggestions only
  when it is explicitly assisted-enabled. Toggled from AI Studio → Overview → Inbound Assisted Replies, or
  `POST /ai-studio/inbound-ai/channels`.

## Mandatory: server-side stale protection

A suggestion generated for message N must not be sendable after a newer customer message N+1. Implemented:
- The draft records its **source inbound message id** (`metadata.source_message_id`, threaded from the
  intake `canonicalMessageId`) plus `last_ai_reply_draft_updated_at`.
- The canonical send (`POST /conversations/:id/send`) runs a **server-enforced freshness check** before the
  provider send: when the employee approves the **unedited** suggestion (`sent text === draft text`) and a
  newer customer message exists (`hasNewerCustomerMessage` by source-id, timestamp fallback), the send is
  **blocked** with `409 STALE_SUGGESTION` ("العميل بعت رسالة أحدث — حدّث الاقتراح قبل الإرسال").
- **Edited/manual replies always win** — they are intentional and never blocked; sending a manual reply
  supersedes the pending draft.
- Newer inbound also **regenerates** the draft (last-write-wins with the new source id), so the stale one is
  superseded.

## Burst coalescing

A rapid `greeting → product → size` burst must not create three suggestions. A process-local
per-conversation **debounce** (`AI_INBOUND_DEBOUNCE_MS`, default 2500ms) coalesces a burst into **one**
generation from the latest context. No Redis/Bull/queue was added; per §12 the **stale protection is the
correctness layer** and the debounce is an optimization. Inbound message persistence/visibility is never
delayed (the hook is fire-and-forget after persistence).

## Metrics (real data only)

`ai_inbound_intake_log` now records send-side outcomes (`approved` [reason `unchanged`/`edited`], `stale`)
alongside `suggested`/`skipped`/`error`. Edits are also captured as `ai_reply_corrections`. `GET
/ai-studio/inbound-ai/stats` returns 24h/7d windows + per-channel breakdown. No invented AI quality scores.

## Staged rollout & acceptance (STAGE A Messenger first)

Before enabling: **Messenger must be set to non-autonomous (`suggest_only`) BEFORE the global AI assistant is
un-paused** — Messenger is legacy `fully_automatic` and has no env kill switch, so un-pausing while it is
`fully_automatic` would auto-send. WhatsApp is additionally env-disabled (`WHATSAPP_AI_AUTO_REPLY=false`);
Instagram is `suggest_only`. Enable: global capability → tenant `approval_reply` → Messenger assisted only
(Instagram/WhatsApp off). Acceptance (owner's authorized Messenger account, one message at a time): greeting,
product-availability (Crocs black 44 → grounded), Crocs-only compatibility, policy, restock-suggest; a burst
test (one coalesced suggestion); a stale test (newer message blocks the old suggestion, server-enforced); a
manual-reply-supersedes test; then exactly one Approve & Send. GO only if no autonomous send, grounding
correct, stale/burst/manual behavior correct, one approved send works, no cross-customer leakage. Instagram
and WhatsApp stages follow only after Messenger GO.

## Security (unchanged)

Customer text is untrusted; automatic grounding is READ-only via the Tool Registry; no arbitrary tools, no
prompt override, no secret/cross-customer exposure, no order/stock/accounting mutation. Human takeover /
`ai_enabled=false` still block suggestion generation.

## Deployment posture

Deployed with capability OFF, `inbound_ai_mode` off, **all assisted channels off**, Messenger left as-is until
the explicit rollout configuration. Enabling is a runtime setting change (+ one env flag + restart for the
global capability), not a code deploy.
