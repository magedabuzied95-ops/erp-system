# AI Inbox — WhatsApp Assisted Rollout (Phase 13, Stage C)

WhatsApp joins the **same** human-approved assisted pipeline proven on Messenger (Stage A) and
Instagram (Stage B). No new AI brain, no new inbox, no per-channel grounding, no autonomous replies.

## 1. Provider / path audit

- **Provider:** Evolution API (`WHATSAPP_PROVIDER=evolution`, `WHATSAPP_ENABLED=true`).
- **Inbound:** Evolution webhook → `handleIncomingWebhook` ([whatsappGatewayService.js]) → canonical
  persist + dedupe (`inbox.saved` / `inbox.duplicate`) → the shared
  `handleInboundMessageIntake({ channel: "whatsapp", … })` ([whatsappGateway.js:~217]).
- **Assisted generation:** `generateAiInboxReply` (THE one brain) → grounded `not_sent` draft. Never sends.
- **Assisted send:** `/conversations/:id/send` (text) and `/product-card/send` (product) →
  `sendWhatsAppCloudReply` → **Evolution** transport.
- **History-sync** (`whatsapp:conversation-history-sync`) is a backfill and **does not** call intake —
  so historical messages never generate suggestions (same lesson as Instagram, opposite gap: here the
  *live* path is the webhook, which already has the hook).

## 2. Identity model

Canonical `whatsapp:<normalized phone>` (e.g. `whatsapp:201024960585`), normalized only through the
existing canonical phone normalizer. Never merged with Messenger PSID / Instagram IGSID by name or
display name. Cross-channel Customer 360 is a separate concern; no cross-customer leakage.

## 3. Autonomous kill switches (proven OFF)

- **`WHATSAPP_AI_AUTO_REPLY=false`** — the **first line** of `triggerWhatsappAiAutoReply` returns
  `{ sent:false, reason:"ai_auto_reply_disabled" }` immediately, regardless of `ai_replies_enabled`
  or `auto_reply_mode`. This is the hard kill and is **not** removed by Stage C.
- Channel `auto_reply_mode = suggest_only` (all three channels).
- The intake hook passes `autoSent: aiReply.sent === true`; the intake service skips
  `fully_automatic`/`autoSent` (`autonomous_channel`). So autonomous and assisted are mutually
  exclusive per message, and with the hard kill on there is **no window** where enabling WhatsApp
  Assisted can produce an autonomous reply.

## 4. Shared AI brain (no WhatsApp copy)

WhatsApp reuses verbatim: intent precedence, Arabic normalization, brand/model resolution, explicit
product override, **durable product context** (session-scoped `whatsapp:<phone>`), size grounding,
Crocs sizing, **multi-colour disambiguation**, exact-variant stock, price/policy grounding, stale
protection, current-suggestion invariant, and the tenant **Style Profile** (facts stay ERP-authoritative).
Nothing is duplicated per channel.

## 5. Product delivery capability

WhatsApp (Evolution) supports **text + image + caption + canonical link**. `sendWhatsAppCloudReply`
handles product cards (image + caption). The internal AI Inbox preview shows the full Product-to-Send
card; the customer receives image + caption + canonical link (the shared `productCardReplyText`, **not**
the Instagram concise formatter). Price/URL/stock/identity are grounded — never LLM-built.

## 6. Assisted vs manual, stale, multi-colour

Identical channel-agnostic semantics: manual composer → `human_takeover`; Approve & Send (incl.
inline-edited) → stays `ai_active`; explicit Take Over / Return to AI. Server stale guard by
`source_message_id`; a newer WhatsApp message makes the old suggestion stale and the provider is not
called (shown as superseded, not a provider failure). Multi-colour: 0→unavailable, 1→auto-ground,
>1→`color_choice_required` (employee picks a colour).

## 7. UI

`Channel: واتساب`, `Delivery: صورة + لينك` (image+link). Grounding facts, product-context provenance,
product choices, colour choices, inline edit, Approve & Send, Reject, Take Over, Return to AI — all the
shared components, no WhatsApp-specific UI.

## 8. Delivery / status

Provider message id persisted. Uses only the status semantics Evolution actually returns
(sent / stored_only / failed); no fabricated delivered/read.

## 9. Kill switch (operations)

Independent toggle `inbound_ai_channels.whatsapp` (AI Studio → Channels). Off = no WhatsApp
suggestions; Messenger/Instagram and inbound persistence/manual replies unaffected. Global pause and
`inbound_ai_mode=off` also cover WhatsApp. The `WHATSAPP_AI_AUTO_REPLY=false` env kill is separate and
always on.

## 10. Known limitations

- Multi-colour choices in production are bounded by `getInventoryFacts`' variant window (as on the
  other channels).
- Evolution delivery/read receipts are limited compared with Meta.

## 11. Live proof (filled after the owner-run Stage C proof)

- Test A (inbound/draft only): _pending_ · Test B (preview): _pending_ · Test C (edited assisted send):
  _pending_ · Test D (continuation): _pending_ · Autonomous send: **NO** · Messenger/IG non-regression:
  _pending_ · Stage C GO/NO-GO: _pending_.
