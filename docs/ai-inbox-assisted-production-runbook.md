# AI Inbox — Messenger Assisted Production Runbook

**Scope:** Messenger Assisted Stage A (human-approved suggestions). Instagram and WhatsApp
assisted are **OFF**. There is **no autonomous customer messaging** anywhere in this system:
every AI reply and every product card requires a human to press **Approve & Send** in the AI
Inbox UI. `messaging.send_customer` is a SENSITIVE / APPROVAL_REQUIRED capability and is never
auto-invoked.

This document is the single operational reference for running, monitoring, pausing, and
recovering the assisted rollout. It describes the system **as deployed** — it does not propose
new behavior.

---

## 0. One-screen mental model

```
Customer message  ─▶  inbound intake (persist ALWAYS)  ─▶  generateAiInboxReply
                                                              │  (grounded, READ-only)
                                                              ▼
                                              last_ai_reply_draft = not_sent  (persisted, never sent)
                                                              │
                                                              ▼
                          AI Inbox UI  ─▶  operator reviews / edits  ─▶  Approve & Send
                                                              │                         │
                                                    (assisted_approval=true)   (manual composer)
                                                              ▼                         ▼
                                                    conversation stays        conversation goes
                                                        ai_active                human_takeover
```

Two facts that everything else depends on:

1. **Inbound persistence is independent of AI.** Pausing, disabling, or resetting anything on the
   AI side never stops messages from being stored or manual replies from being sent.
2. **Facts are authoritative from ERP, not from the model.** The deterministic grounding gate runs
   **last** and overrides the model wording for stock / price / size / availability. Style learning
   can only change *phrasing*, never a fact.

---

## 1. Settings persistence map

Where every operational setting lives, and what survives a process restart, a container
recreate, and a deploy.

| Setting | Store | Key / location | Restart | Recreate | Deploy |
|---|---|---|---|---|---|
| Assisted capability master switch | ENV | `AI_INBOUND_WORKFLOWS_ENABLED` (`/opt/erp/backend/.env`) | ✅ | ✅ (env_file) | ✅ |
| WhatsApp auto-reply hard block | ENV | `WHATSAPP_AI_AUTO_REPLY=false` | ✅ | ✅ | ✅ |
| Global AI assistant pause | DB | `ai_agent_settings.settings.ai_assistant_global_enabled` | ✅ | ✅ | ✅ |
| Inbound AI mode (per tenant) | DB | `ai_workflow_tenant_settings.inbound_ai_mode` (`approval_reply` / `off`) | ✅ | ✅ | ✅ |
| Per-channel assisted ON/OFF | DB | `ai_workflow_tenant_settings.inbound_ai_channels` (JSONB) | ✅ | ✅ | ✅ |
| Channel reply mode (`suggest_only` / `fully_automatic`) | DB | channel settings (`auto_reply_mode`) | ✅ | ✅ | ✅ |
| Style learning enabled (per tenant) | DB | `ai_agent_settings.settings.style_learning_enabled` | ✅ | ✅ | ✅ |
| Style reset timestamp | DB | `ai_agent_settings.settings.style_reset_at` | ✅ | ✅ | ✅ |
| Tenant automation kill switch | DB | tenant automation flag | ✅ | ✅ | ✅ |
| Restock messaging mode | DB | restock messaging mode | ✅ | ✅ | ✅ |

**Interpretation.** Every day-to-day operational control is in the **database** and therefore
survives restart, recreate, and deploy unchanged. Only the two capability guards live in the
environment; a normal deploy recreates the backend container from the same `env_file`, so they
also survive. There is no setting that silently resets on deploy.

**Production snapshot (read-only, tenant 1):**

```
capability (AI_INBOUND_WORKFLOWS_ENABLED) : true
global_paused                              : false
inbound_ai_mode                            : approval_reply
assisted_channels                          : messenger=true, instagram=false, whatsapp=false
messenger reply mode                       : suggest_only   (NON-autonomous)
style_learning_enabled (tenant 1)          : true
style_learning_enabled (tenant 2)          : false
style_reset_at                             : null
style evidence / profile                   : 0 examples, {} (no stable signal)
backend /health                            : 200
```

---

## 2. Kill switches — what each one stops, and what it must NOT stop

Every switch below leaves **inbound message persistence and manual replies fully working**. That
is the invariant: turning AI off never turns the inbox off.

| # | Action | Effect | Where | Reversible by |
|---|---|---|---|---|
| A | **Pause ALL assisted AI** | No new AI suggestions generated for any channel | Global pause (`ai_assistant_global_enabled=false`) or `inbound_ai_mode=off` | Re-enable the same flag |
| B | **Pause Messenger only** | Messenger stops getting suggestions; IG/WA unaffected (already off) | `inbound_ai_channels.facebook_messenger=false` | Set it back to `true` |
| C | **Take Over (one conversation)** | This conversation → `human_takeover`; AI stops suggesting here | "Take Over" control in the conversation | **Return to AI** |
| D | **Return to AI (one conversation)** | Conversation → `ai_active`; next customer message gets a fresh suggestion | "Return to AI" control | Take Over again |
| E | **Disable Style Learning** | Suggestions keep working; wording reverts to neutral grounded phrasing | Style Learning toggle OFF | Toggle ON |
| F | **Reset Style Profile** | Learned style dropped (`style_reset_at=now`); correction/audit history kept | Reset button | Learning re-accumulates over time |

**Invariant to verify after ANY switch:** send a test inbound message (owner test number only)
and confirm it still **persists** and can still be **replied to manually**. AI suggesting is the
only thing a kill switch is allowed to stop.

Precedence (most global wins): `AI_INBOUND_WORKFLOWS_ENABLED` → global pause → `inbound_ai_mode`
→ per-channel → per-conversation takeover → style learning. A conversation gets an AI suggestion
only when **every** upstream gate is open.

---

## 3. Operator runbook — assisted vs. manual

**Assisted (Approve & Send on the AI Suggestion card):**
- Review the final text in "النص اللي هيتبعت للعميل". Edit inline if needed.
- Press **Approve & Send**. The edited text (and any attached product card) is sent.
- The conversation **stays `ai_active`**; the next customer message produces a new suggestion
  automatically — no "Return to AI" needed.
- Editing before approving is captured as an `approved_edited` style example (phrasing only).

**Manual (composer at the bottom):**
- Typing your own reply and sending it puts the conversation into **`human_takeover`**.
- AI stops suggesting for this conversation until you press **Return to AI**.
- Use this when the AI is off-topic or the customer needs bespoke handling.

**Current-suggestion invariant (Step 7).** At most **one** actionable AI suggestion exists per
conversation at any time, and it always equals the authoritative server draft
(`ai_support_sessions.last_ai_reply_draft`). If a newer customer message arrives, the old
suggestion is marked stale and hidden — the card you see is always tied to the latest customer
turn (`source_message_id`). You never approve an outdated draft.

---

## 4. Operator runbook — product cards

- A suggestion may carry **one send-ready product card** (single, unambiguous match) or a set of
  **choices** (ambiguous match). Choices are never auto-sent — the operator picks one.
- The card is enriched from ERP only: public product URL, **customer** display price (cost /
  wholesale are blocked), product image, available sizes, live stock.
- Per channel: Messenger sends a Meta rich card; WhatsApp would send image+caption; Instagram is
  text+link only. Only Messenger is live.
- Operator controls on the card: **Remove**, **Change** (pick a different product/choice), and
  (for choices) select. Approve & Send sends exactly the shown card.
- If the card price/stock ever looks wrong, that is a **grounding** issue, not a wording issue —
  do not "fix" it by editing the text. Escalate (see §6, case B).

---

## 5. Operator runbook — style learning

- Style learning teaches **phrasing only** (brevity, whether to state the exact stock count,
  emoji), per intent, and **only** from repeated approved edits.
- Arabic explainer shown in AI Studio: **"يتعلم أسلوب الصياغة فقط — السعر والمخزون والمقاسات تظل
  من بيانات النظام."**
- Status per signal:
  - **Learning N/5** — collecting; not yet applied.
  - **Stable** — ≥5 consistent approved edits for that intent; wording adapts.
  - **Conflicting** — edits disagree; the signal is disabled and wording stays neutral.
- **Reset** clears learned style (`style_reset_at=now`) but keeps correction/audit history.
- It can **never** learn a stock/price/size/product/policy/order/customer fact. The grounding gate
  overrides any wording that would contradict ERP, and a deterministic guard blocks any phrasing
  that would claim availability that isn't real.

---

## 6. Incident / emergency runbook

All responses are read-only-safe first (observe before changing). No provider sends while
diagnosing.

**Case A — AI is suggesting something wrong / off-brand (one conversation).**
Press **Take Over** on that conversation, reply manually. Investigate later. Return to AI when
resolved. Nothing global needed.

**Case B — A product card shows a wrong price or wrong stock.**
Do **not** send it. **Remove** the card, reply manually with correct info. This is a grounding
problem: capture the conversation id + product id and check the product record in ERP. The wording
layer cannot cause this; the fact came from the product record.

**Case C — AI is misbehaving across many Messenger conversations.**
Pause **Messenger only** (switch B): `inbound_ai_channels.facebook_messenger=false`. Inbox and
manual replies keep working. Re-enable after the fix.

**Case D — Suspected systemic AI failure (all channels).**
Set the **global pause** (or `inbound_ai_mode=off`). All AI suggesting stops; inbound persistence
and manual replies continue. This is the biggest hammer short of touching the container.

**Case E — Style learning produced bad phrasing.**
Toggle **Style Learning OFF** (wording reverts to neutral immediately) and/or **Reset Style
Profile**. Suggestions keep working; only the learned tone is dropped.

**Escalation to backend (rare):** if inbound persistence itself stops (messages not appearing),
that is NOT a kill-switch case — check `backend /health`, container status, and DB connectivity.
See the deploy/ops notes in the deployment runbook.

---

## 7. Verification commands (read-only)

Production settings snapshot (SSH, tenant 1) — does not change any state:

```bash
ssh -i ~/.ssh/codex_erp_ed25519 root@13.140.141.50 \
  'docker exec erp-backend printenv AI_INBOUND_WORKFLOWS_ENABLED; \
   curl -s -o /dev/null -w "health:%{http_code}\n" http://127.0.0.1:8000/health'
```

The AI Studio **Operations** card surfaces the same state in the UI: per-channel assisted ON/OFF,
global capability, tenant mode, channel reply mode, Style Learning status, and the
PRODUCT_AVAILABILITY evidence count (N/5) with its status. All numbers shown there are real —
none are invented placeholders.

---

## 8. Instagram (Stage B)

Instagram uses the **same** assisted pipeline (see
[ai-inbox-instagram-assisted-rollout.md](ai-inbox-instagram-assisted-rollout.md)). Operational
differences from Messenger:

- **Product delivery is TEXT + product link only** — Instagram has no rich card. The operator sees
  the internal Product-to-Send preview but the customer receives text + canonical link. The AI
  Suggestion card shows a **التسليم: نص + لينك المنتج** chip so this is explicit.
- Independent kill switch: `inbound_ai_channels.instagram` (AI Studio → Channels). Turning it off
  stops Instagram suggestions only — Messenger, inbound persistence, and manual replies keep working.
- Identity is IGSID-scoped and never merged with Messenger/WhatsApp.
- All other behavior (A/B, stale, grounding, style, metrics) is identical and channel-agnostic.

Incident cases A–E apply per-conversation and per-channel exactly as for Messenger; case C
("misbehaving across many conversations") pauses the affected channel via its own toggle.

## 8c. WhatsApp (Stage C)

WhatsApp uses the **same** assisted pipeline via the **Evolution** provider (see
[ai-inbox-whatsapp-assisted-rollout.md](ai-inbox-whatsapp-assisted-rollout.md)). Delivery = **image +
caption + canonical link**. Independent kill switch `inbound_ai_channels.whatsapp`. Two autonomous
kill switches, both always on: **`WHATSAPP_AI_AUTO_REPLY=false`** (hard, first-line block in
`triggerWhatsappAiAutoReply`) and channel `suggest_only`. Identity is `whatsapp:<phone>`, never merged
with Messenger/Instagram. History-sync never generates suggestions (only the live Evolution webhook
does). All A/B, stale, grounding, multi-colour, durable-context, and style behavior is identical and
channel-agnostic.

## 9. Durable grounded product context (Phase 12.1)

A continuation that omits the product ("طب مقاس 44؟", "والاسود؟", "بكام؟") reuses the most recent
**grounded product subject** for that one conversation instead of re-asking — then re-reads
stock/price/variant **fresh** from ERP. Subject only, never facts. Source: last employee-approved
selection, else last sent product card; session-scoped; ≤30 min (`AI_INBOX_PRODUCT_CONTEXT_MAX_AGE_MS`).
Explicit new product always wins; ambiguous/expired → clarify. The operator sees a
**"المنتج من سياق المحادثة"** chip. Full detail:
[ai-inbox-durable-product-context.md](ai-inbox-durable-product-context.md).

## 9b. Multi-colour size + Arabic stock wording (Phase 12.2)

A grounded product + a size with **>1 in-stock colour** and no colour requested no longer silently
picks the highest-stock colour — it returns **`color_choice_required`** and the operator must pick a
colour (grounded choices, fresh ERP) before Approve & Send. One in-stock colour still auto-grounds;
explicit colour still wins; unavailable colour never substitutes. Customer-facing stock counts use one
helper (`1 → قطعة واحدة`, `2 → قطعتين`, `N → N قطع`) — presentation only, fact unchanged. Detail in
[ai-inbox-durable-product-context.md](ai-inbox-durable-product-context.md) §13.

## 9c. Operator card simplification (Phase 13.3 — presentation only)

The AI Suggested Reply card was condensed for the operator. **Removed from view:** the large "AI draft
validation" panel, the "Confidence engine" panel, the technical **"حقائق الاستناد"** grounding-facts block
(match type, stock counts, resolved product id) and the **"المنتج من سياق المحادثة"** context-provenance
chip. **Kept:** the reply text, the exact text-to-send line, product/colour choices (اختار المنتج / اختار
اللون), the Product-to-Send preview, and the three actions (تعديل الرد / اعتماد وإرسال / تجاهل). When the
existing validation/confidence logic materially recommends review (a real validation violation or a
high-risk confidence decision), the card shows **one compact `⚠ يحتاج مراجعة` badge** in the header
instead of the panels.

This is **display only** — generation, grounding, the validation + confidence engines, product resolution,
durable context, colour disambiguation, stale protection, the monotonic completed-draft lifecycle, learning
and all backend data are unchanged (the full detail still lives in the draft/schema for AI Studio). One
shared card serves all three channels (Messenger / Instagram / WhatsApp); the channel is a prop.

## 9d. Unified multi-product selection & batch send (Phase 13.4)

The operator can now select **up to 5 products** (`MAX_BATCH_PRODUCTS`) and send them together, in BOTH surfaces,
via ONE shared selection primitive (`src/modules/aiSupport/lib/productSelection.js`, keyed by canonical
`product_id[:variant_id]`). Three explicit selection semantics — the mode carries the business meaning, never
inferred from the number of cards:

- **`multi_manual`** — the manual "إرسال منتج" picker. Clicking a card TOGGLES selection (never sends); a compact
  bar shows "تم تحديد N منتجات" + "إلغاء التحديد" + "إرسال المنتجات المحددة (N)". Selection survives search/filter
  (retained card snapshots), clears on a fresh open, order preserved. Stays MANUAL ownership (`assisted_approval`
  **false**).
- **`multi_recommendation`** — a grounded AI recommendation batch (send_package `selection_semantics ===
  "recommendation"`). The operator ticks products ("اختار المنتجات اللي هتتبعت"); Approve becomes
  "اعتماد وإرسال (N منتجات)" and sends the approved reply + selected products as ONE assisted flow
  (`assisted_approval` **true**, stays `ai_active`). Selection is scoped to the draft `source_message_id` and
  cleared by the monotonic completed/stale lifecycle — never resurrected.
- **`single_disambiguation`** — identity resolution (one named model → >1 catalog rows). **Single-select only**,
  unchanged: pick exactly one product to establish identity. This safety behaviour is preserved.

**Send** is **FE-sequential per card**: each selected product is its own `/product-card/send` request (its own
idempotency key), reusing the already-live single-card route — **honest per-card partial failure**
("تم إرسال 4 من 5 منتجات — فشل إرسال منتج واحد") with **zero change to the live provider send loop**. Manual
partial failure keeps ONLY the failed cards selected; the AI batch keeps the text + sent products completed and
surfaces the failed ones (never falsely restores the suggestion). Channel delivery is unchanged (Messenger rich
cards / Instagram concise text+link / WhatsApp image+link), one per selected product.

Backend change is a **single additive field** — `send_package.selection_semantics` (derived deterministically:
`soft_match` or explicit show-me-options phrasing ⇒ recommendation; otherwise identity disambiguation; the safe
default when uncertain is single-select). No grounding, durable-context, multi-colour, stale-protection,
tombstone-lifecycle, learning, or channel-identity change. No new autonomous path; every product still requires
human Approve & Send.

## 10. Change log

- Stage A (Messenger, human-approved) declared GO. WA remains OFF.
- Stage B (Instagram, human-approved, text+link) — code deployed dormant; enabled at the owner-run
  live proof. No new AI brain, no autonomous replies.
- Style learning enabled for **tenant 1 only**, opt-in, ≥5-example threshold, facts never learned.
- Runbook created for Phase 11.3; Instagram section added for Phase 12.
- Phase 13.3 (presentation only): removed the validation + confidence panels and the technical grounding
  facts / context chip from the operator card; condensed to one compact `⚠ يحتاج مراجعة` badge. No logic,
  lifecycle, or backend change. Production state unchanged (all live channels suggest-only,
  `WHATSAPP_AI_AUTO_REPLY=false`).
- Phase 13.4: unified multi-product selection (up to 5) + batch send across the manual picker and AI
  recommendation batch; one shared selection primitive; FE-sequential per-card send with honest partial
  failure; additive `send_package.selection_semantics` flag. Identity disambiguation stays single-select. No
  new autonomous path; production state unchanged.
