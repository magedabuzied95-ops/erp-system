// Phase 12 — Instagram Assisted (Stage B). The whole assisted pipeline (intake, identity, grounding, stale,
// A/B semantics, style learning) is channel-agnostic and already proven on Messenger; Stage B adds NO new AI
// brain. These are source-contract assertions (same style as assistedApproveVsManual/assistedRollout) proving:
//   1. Instagram is a first-class assisted channel, gated independently by inbound_ai_channels.
//   2. Instagram outbound is capability-correct: TEXT + product link only — the Meta generic template and the
//      image attachment are gated to Messenger, so a Messenger rich card can NEVER be sent to Instagram.
//   3. No cross-channel identity merge.
//   4. The AI Inbox labels Instagram delivery as text + product link.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "../../", rel), "utf8");
const intakeSrc = read("server/services/aiInboundIntakeService.js");
const metaSrc = read("server/services/metaIntegrationService.js");
const adapterSrc = read("server/services/aiChannelAdapterService.js");
const inboxSrc = read("src/modules/aiSupport/pages/AiInbox.jsx");
const routeSrc = read("server/routes/aiAgentOrders.js");

test("intake: instagram is a first-class assisted channel (not a bolted-on brain)", () => {
  assert.match(intakeSrc, /export const ASSISTED_CHANNELS = Object\.freeze\(\["facebook_messenger", "instagram", "whatsapp"\]\)/);
  // channel-agnostic hook: the Meta webhook passes message.channel straight through — no instagram-specific path
  assert.match(metaSrc, /handleInboundMessageIntake\(\{[\s\S]*?channel: message\.channel/);
});

test("intake: Instagram assisted OFF → inbound persists but produces NO suggestion", () => {
  // the per-channel gate returns channel_not_assisted when instagram is not enabled (default off).
  // Persistence happens upstream in the webhook; this gate only stops the suggestion.
  assert.match(intakeSrc, /const channels = await getInboundAiChannels\(tenantId\);\s*\n\s*if \(!channels\[normalizeAssistedChannel\(channel\)\]\) return \{ skipped: true, reason: "channel_not_assisted" \};/);
});

test("intake: human takeover blocks Instagram suggestions (same gate as Messenger)", () => {
  assert.match(intakeSrc, /\["human_takeover", "closed"\]\.includes\(String\(state\.status \|\| ""\)\) \|\| state\.ai_enabled === false/);
  assert.match(intakeSrc, /reason: "human_controlled"/);
});

test("intake: fully_automatic is never double-processed (no autonomous assisted path for IG)", () => {
  assert.match(intakeSrc, /if \(autoSent \|\| String\(autoReplyMode \|\| ""\)\.toLowerCase\(\) === "fully_automatic"\) return \{ skipped: true, reason: "autonomous_channel" \}/);
});

test("identity: instagram_dm normalizes to instagram and channels are NEVER merged", () => {
  // instagram_dm → instagram, messenger aliases → facebook_messenger; instagram is never folded into messenger.
  assert.match(intakeSrc, /c === "instagram_dm" \? "instagram" : c/);
  assert.match(intakeSrc, /c === "facebook" \|\| c === "messenger" \|\| c === "meta_messenger" \? "facebook_messenger"/);
  // the two are distinct constants
  assert.match(adapterSrc, /INSTAGRAM: "instagram"/);
});

test("outbound capability: the Messenger generic template is gated to Messenger — NEVER sent to Instagram", () => {
  // the ONLY generic-template send is guarded by === FACEBOOK_MESSENGER
  assert.match(metaSrc, /if \(normalizedChannel === AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER && productImageUrl\) \{[\s\S]*?buildMessengerGenericTemplatePayload/);
  // and the image-attachment send is likewise Messenger-only
  assert.match(metaSrc, /if \(!cardDelivered && normalizedChannel === AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER && productImageUrl\)/);
});

test("outbound capability: Instagram falls through to TEXT + product link (cardReplyText incl. the link)", () => {
  // for any non-Messenger channel the text (which includes the canonical product link) is always sent
  assert.match(metaSrc, /if \(cardReplyText && \(normalizedChannel !== AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER \? true : !messengerTemplateSucceeded\)\)/);
  // productCardReplyText embeds the canonical product URL line
  const cardsSrc = read("server/services/aiProductCards.js");
  assert.match(cardsSrc, /productCardUrl\(product\) \? `\\u0627\\u0644\\u0644\\u064a\\u0646\\u0643: \$\{productCardUrl\(product\)\}`/);
});

test("send route: Instagram routes through the SAME Meta sender as Messenger (one path, not a new provider)", () => {
  assert.match(routeSrc, /normalizedChannel === AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER \|\| normalizedChannel === AI_AGENT_CHANNELS\.INSTAGRAM/);
  // instagram maps canonically; no separate instagram provider architecture
  assert.match(routeSrc, /if \(channel === "instagram" \|\| channel === "instagram_dm"\) return AI_AGENT_CHANNELS\.INSTAGRAM;/);
});

test("UI: the AI Inbox labels Instagram delivery as TEXT + product link (not a rich card)", () => {
  assert.match(inboxSrc, /if \(ch\.includes\("instagram"\)\) return \{ label: "نص \+ لينك المنتج", kind: "text_link" \};/);
  // and Messenger stays the rich card — the two are not conflated
  assert.match(inboxSrc, /if \(ch\.includes\("messenger"\) \|\| ch === "facebook"\) return \{ label: "كارت منتج \(Messenger\)", kind: "rich_card" \};/);
  // the suggestion card surfaces channel + delivery so the employee knows what the customer will receive
  assert.match(inboxSrc, /channelName=\{channelLabel\(conversation\?\.channel \|\| conversation\?\.source\)\}/);
});

// Phase 12 fix — the sync/backfill ingestion path (logIncomingToInbox) must have the SAME assisted-intake
// semantics as the realtime webhook, so an Instagram DM that arrives via sync still produces a suggestion.
test("sync ingestion: fires assisted intake ONLY on a genuinely fresh inbound insert", () => {
  // the hook is guarded by inserted.rows[0] — the duplicate path returns above, and ON CONFLICT DO NOTHING
  // yields a null row on resync/backfill, so historical re-syncs never regenerate.
  assert.match(metaSrc, /if \(inserted\.rows\[0\]\) \{[\s\S]*?const \{ handleInboundMessageIntake \} = await import\("\.\/aiInboundIntakeService\.js"\);[\s\S]*?handleInboundMessageIntake\(\{/);
});

test("sync ingestion: duplicate / backfill insert does NOT fire intake (ON CONFLICT DO NOTHING → null row)", () => {
  // the insert uses ON CONFLICT ... DO NOTHING and the duplicate branch returns before the hook
  assert.match(metaSrc, /ON CONFLICT \(tenant_id, session_id, dedupe_key\) WHERE dedupe_key <> '' DO NOTHING/);
  assert.match(metaSrc, /if \(!inserted\.rows\[0\]\) \{[\s\S]*?return \{ duplicate: true/);
});

test("sync ingestion: reuses handleInboundMessageIntake verbatim (no Instagram-specific intake)", () => {
  // exactly two references in the whole service: the realtime webhook hook + this sync hook — both import the
  // same function; there is no bespoke intake implementation.
  const count = (metaSrc.match(/handleInboundMessageIntake\(\{/g) || []).length;
  assert.equal(count, 2, "expected exactly the realtime hook + the sync hook");
});

test("sync ingestion: failure-isolated and never sends (customer DM persistence must not depend on intake)", () => {
  assert.match(metaSrc, /try \{[\s\S]*?handleInboundMessageIntake\(\{[\s\S]*?\}\)\.catch\(\(\) => \{\}\);[\s\S]*?\} catch \{ \/\* never break inbound persistence on assisted-intake failure \*\/ \}/);
  // fromMe:false (sync rows are customer inbound) and the resolved channel auto_reply_mode is passed, so a
  // fully_automatic channel is still skipped by the intake's autonomous gate — the hook itself never sends.
  assert.match(metaSrc, /fromMe: false,\s*\n\s*autoReplyMode: intakeAutoReplyMode,/);
});

test("convergence: realtime + sync same provider message ⇒ ONE intake / ONE draft", () => {
  // canonical dedupe (shared dedupe_key) means only one path does a fresh insert; the intake idempotency lock
  // is the backstop even if both call it.
  const cardslessLock = read("server/services/aiInboundIntakeService.js");
  assert.match(cardslessLock, /claimAiInboxReplyLock\(\{ tenantId, channel: `p10:\$\{channel\}`, conversationId, providerMessageId: lockKey/);
});

test("A/B + stale reuse is channel-agnostic (Instagram inherits the Messenger-proven semantics)", () => {
  // assisted approval stays ai_active; manual → human_takeover; stale guard by source_message_id — all in the
  // shared route/UI, none keyed on channel, so Instagram behaves identically.
  assert.match(routeSrc, /const isAssistedApprove = req\.body\?\.assisted_approval === true && hasCurrentDraft/);
  assert.match(inboxSrc, /const suggestionStale = latestCustomerMessageId > 0 && suggestionSourceId > 0 && latestCustomerMessageId > suggestionSourceId;/);
});
