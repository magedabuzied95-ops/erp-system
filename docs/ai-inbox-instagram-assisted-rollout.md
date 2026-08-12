# AI Inbox — Instagram Assisted Rollout (Phase 12, Stage B)

**Status:** code deployed dormant — Instagram assisted **OFF** until the owner-run live proof flips it on.
Messenger Assisted Stage A stays ON and unchanged. WhatsApp assisted stays OFF.

Stage B does **not** add a new AI brain, a new inbox, or autonomous replies. It enables the *same*
human-approved assisted pipeline for the Instagram channel, which was already a first-class
citizen of that pipeline. The audit below is the important part: almost nothing had to change.

---

## 1. Implementation audit (what already existed)

Instagram DMs already flow end-to-end through the canonical AI Inbox:

```
Instagram DM
  → Meta webhook (object: "instagram")            server/services/metaIntegrationService.js
  → resolveMetaChannel → AI_AGENT_CHANNELS.INSTAGRAM ("instagram")
  → canonical persistence (ai_support_messages / ai_support_sessions / ai_channel_conversations)
  → handleInboundMessageIntake({ channel: message.channel, … })   aiInboundIntakeService.js
       ├─ isInboundWorkflowsEnabled()  (env AI_INBOUND_WORKFLOWS_ENABLED)
       ├─ getInboundAiMode(tenant)     (approval_reply)
       ├─ getInboundAiChannels(tenant).instagram === true   ← the Stage-B gate (default OFF)
       └─ human-takeover / ai_enabled pre-check
  → generateAiInboxReply (THE one grounded brain) → last_ai_reply_draft = not_sent (never sent)
  → AI Inbox UI: review / edit / Approve & Send
  → sendMetaInboxOutboundMessage({ channel: "instagram", … })   metaIntegrationService.js
  → delivery reconciliation (Meta), provider message id persisted
```

The intake hook passes `message.channel` straight through — there is no Instagram-specific
branch and no second brain.

## 2. Identity model

Instagram identity stays provider-native. The canonical conversation is keyed by the scoped
Instagram identity (IGSID) carried on `message.channel = "instagram"` +
`external_conversation_id` / `external_customer_id` from the Meta webhook. `normalizeAssistedChannel`
maps `instagram_dm → instagram` and `facebook/messenger/meta_messenger → facebook_messenger`;
the two are **distinct constants and are never merged**. Identity is never derived from a phone
number or guessed from a customer name. No cross-channel leakage.

## 3. Outbound capability — the one channel difference

Per the Phase 11.2 capability audit:

| Channel | Product delivery |
|---|---|
| Messenger | Meta **generic template** rich card (image + title + button), image-attachment fallback, text fallback |
| WhatsApp | image + caption/link |
| **Instagram** | **TEXT + product link only** |

This is already enforced in `sendMetaInboxOutboundMessage`: the generic-template send and the
image-attachment send are both guarded by `normalizedChannel === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER`.
For Instagram those branches are skipped and the code falls through to `productCardReplyText`, a
deterministic text block that includes the **canonical product URL** (`اللينك: <url>`). A Messenger
rich card can therefore never be sent to Instagram.

The product link comes from `resolvePublicProductUrl` / `productCardUrl` (canonical storefront
builder) — never hand-built, never LLM-built.

## 4. Employee experience

The employee still sees the full internal **Product to Send** preview (image, name, colour, size,
customer price, availability, View Product). The AI Suggestion card now shows two chips:

- **Channel:** رسائل إنستجرام (Instagram)
- **التسليم (Delivery):** نص + لينك المنتج (Text + product link)

so the operator knows the customer receives text + link, not the rich card shown internally.
Remove / Change / choices controls are the same shared UI as Messenger; for Instagram they simply
decide whether the product link is included.

## 5. Reused, unchanged behaviors (channel-agnostic)

- **A/B semantics** — Approve & Send (or inline-edited approve) stays `ai_active`; manual composer
  reply → `human_takeover`; explicit Take Over / Return to AI.
- **Stale protection** — the authoritative `source_message_id` / latest-inbound guard; an old
  Instagram suggestion can never be approved after a newer DM.
- **Current-suggestion invariant** — at most one actionable suggestion == the server draft.
- **Grounding** — intent precedence, Arabic normalization, brand/model, footwear-size mapping,
  exact-variant stock, disambiguation, policy, restock, style profile. Not weakened for Instagram.
- **Style learning** — tenant-scoped (channel is metadata only), facts stay authoritative.
- **Feedback metrics** — generated / approved (unchanged, edited) / rejected / stale / failed feed
  the existing intake log; no separate Instagram table.
- **Burst/continuation** — the same Phase 11 turn aggregation.

## 6. Delivery / status semantics

Instagram send returns a provider message id, persisted like Messenger. Meta delivery/read
reconciliation uses whatever the existing Meta path actually reports — no fabricated Delivered/Read.
On send failure the employee sees the failure and the suggestion is **not** marked completed; there
is no autonomous provider retry beyond the existing canonical sender policy.

## 7. Kill switch

Instagram assisted is toggled independently in AI Studio → Inbound Assisted Replies → Channels
(`inbound_ai_channels.instagram`). Turning it off stops Instagram suggestions only; Messenger,
inbound persistence, and manual replies are unaffected. The global Pause and `inbound_ai_mode=off`
switches also cover Instagram.

## 8. Known limitations

- Instagram has **no rich product card** — text + link by design (Meta capability).
- Style profile for the tenant is still in the *Learning* state (evidence < 5), so Instagram
  wording is neutral/partially-informed until enough consistent approved edits accumulate. This is
  expected and not fabricated.
- Delivery/read visibility depends on what Meta returns for Instagram in the current integration.

## 9. Live proof (to be filled after the owner-run Stage B proof)

- Live Test A (inbound/draft only): _pending_
- Live Test B (product-link preview): _pending_
- Live Test C (edited assisted send): _pending_
- Live Test D (next message → new suggestion): _pending_
- Autonomous send during proof: **NO** (must remain NO)
- Messenger non-regression: _pending_
- Stage B GO / NO-GO: _pending_
