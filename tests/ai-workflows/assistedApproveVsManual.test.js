// Phase 11.2 A/B — assisted approval vs manual reply conversation-state semantics.
// These assert the wiring of the deterministic distinction in the real send route + AI Inbox, so a regression
// that (a) forces human_takeover on assisted approval, (b) forgets to validate the assisted flag against a real
// draft, (c) drops the stale guard on assisted approval, or (d) mislabels a manual reply as an AI correction
// is caught. (There is no route-integration harness; these are source-contract assertions like the gate's
// SAFETY test.)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(path.join(here, "../../server/routes/aiAgentOrders.js"), "utf8");
const inboxSrc = readFileSync(path.join(here, "../../src/modules/aiSupport/pages/AiInbox.jsx"), "utf8");

test("server: assisted approval is validated against a REAL current draft (not a bare browser boolean)", () => {
  assert.match(routeSrc, /const hasCurrentDraft = aiReplyDraft\?\.status === "not_sent" && Boolean\(envText\(aiReplyDraft\?\.text\)\)/);
  assert.match(routeSrc, /const isAssistedApprove = req\.body\?\.assisted_approval === true && hasCurrentDraft/);
});

test("server: /send loads the AUTHORITATIVE draft from the DB (non-summary conversation lacks it)", () => {
  // must read last_ai_reply_draft straight from ai_support_sessions BEFORE computing aiReplyDraft,
  // otherwise hasCurrentDraft / stale guard / assisted approval / correction all see an empty draft
  assert.match(routeSrc, /SELECT last_ai_reply_draft, last_ai_reply_draft_updated_at FROM ai_support_sessions WHERE tenant_id = \$1 AND session_id = \$2/);
  const dbLoadIdx = routeSrc.indexOf("SELECT last_ai_reply_draft, last_ai_reply_draft_updated_at FROM ai_support_sessions");
  const aiReplyDraftIdx = routeSrc.indexOf("const aiReplyDraft = normalizeAiReplyDraft(conversation.last_ai_reply_draft");
  assert.ok(dbLoadIdx > 0 && aiReplyDraftIdx > dbLoadIdx, "draft must be loaded before aiReplyDraft is computed");
});

test("server: stale protection covers assisted approval (unedited OR edited)", () => {
  assert.match(routeSrc, /if \(isUneditedSuggestionSend \|\| isAssistedApprove\) \{/);
  // and still returns 409 STALE_SUGGESTION
  assert.match(routeSrc, /code: "STALE_SUGGESTION"/);
});

test("server: assisted approval KEEPS ai_active; manual reply → human_takeover (deterministic, canonical)", () => {
  // assisted branch keeps ai_active
  assert.match(routeSrc, /if \(isAssistedApprove\) \{[\s\S]*?status: "ai_active"[\s\S]*?\} else \{[\s\S]*?status: "human_takeover"[\s\S]*?\}/);
  // both branches go through the canonical state updater, not a bespoke write
  assert.match(routeSrc, /updateAiSupportConversationState\(\{ tenantId, sessionId: conversationId, channel, status: "ai_active"/);
  assert.match(routeSrc, /updateAiSupportConversationState\(\{ tenantId, sessionId: conversationId, channel, status: "human_takeover"/);
});

test("server: correction + approved metric are recorded ONLY for validated assisted approval", () => {
  assert.match(routeSrc, /if \(isAssistedApprove && envText\(aiReplyDraft\.text\) !== messageText\) \{/); // edited correction
  assert.match(routeSrc, /if \(isAssistedApprove\) \{\s*\n\s*try \{\s*\n\s*const \{ recordAssistedOutcome \}/); // approved metric gated
});

test("server: Take Over + Return to AI canonical endpoints exist", () => {
  assert.match(routeSrc, /router\.post\("\/conversations\/:conversationId\/takeover"/);
  assert.match(routeSrc, /router\.post\("\/conversations\/:conversationId\/return-to-ai"/);
});

test("frontend: assisted flag is sent to /send and comes ONLY from the AI card approve (composer stays manual)", () => {
  assert.match(inboxSrc, /assisted_approval: assistedApproval/); // sent in the /send body
  assert.match(inboxSrc, /const assistedApproval = options\.assistedApproval === true \|\| sendFlow === "approve";/);
});

test("frontend: AI suggestion has INLINE editing inside the card, separate from the manual composer", () => {
  // inline textarea bound to the edit buffer, not the composer
  assert.match(inboxSrc, /onChange=\{\(e\) => onEditTextChange\?\.\(e\.target\.value\)\}/);
  // Edit initializes the inline buffer and does NOT copy into the composer (setReplyText)
  assert.match(inboxSrc, /const handleEditAiSuggestion = useCallback\(\(\) => \{[\s\S]*?setAiSuggestionEditText\(activeAiSuggestionText\)[\s\S]*?\}, \[activeAiSuggestionText\]\)/);
  assert.doesNotMatch(inboxSrc, /handleEditAiSuggestion = useCallback\(\(\) => \{[\s\S]*?setReplyText\(activeAiSuggestionText\)[\s\S]*?\}, \[activeAiSuggestionText\]\)/);
  // Approve sends the inline-edited text; Cancel restores
  assert.match(inboxSrc, /const textToSend = editingAiDraft && clean\(aiSuggestionEditText\) \? clean\(aiSuggestionEditText\) : activeAiSuggestionText/);
  assert.match(inboxSrc, /const handleCancelEditAiSuggestion = useCallback\(\(\) => \{\s*setEditingAiDraft\(false\);\s*setAiSuggestionEditText\(""\);/);
  // card shows the FINAL text that will be sent
  assert.match(inboxSrc, /النص اللي هيتبعت للعميل/);
});

test("frontend: assisted approval does NOT optimistically take over; manual reply does", () => {
  assert.match(inboxSrc, /conversation_status: assistedApproval \? \(conversation\.conversation_status \|\| "ai_active"\) : "human_takeover"/);
});

test("frontend: card Approve sends the INLINE-edited text and flags assisted", () => {
  assert.match(inboxSrc, /const textToSend = editingAiDraft && clean\(aiSuggestionEditText\) \? clean\(aiSuggestionEditText\) : activeAiSuggestionText/);
  assert.match(inboxSrc, /assistedApproval: true/);
});

test("frontend: human_takeover state is clearly labelled + Take Over / Return controls exist", () => {
  assert.match(inboxSrc, /اقتراحات AI متوقفة/);
  assert.match(inboxSrc, /onAction\("takeover"\)/);
  assert.match(inboxSrc, /onAction\("return"\)/);
});

test("frontend lifecycle: a successful approval CONSUMES the suggestion (card removed + state reset, no refresh)", () => {
  // dismiss the active suggestion key immediately after a successful send
  assert.match(inboxSrc, /setDismissedAiSuggestionKey\(activeAiSuggestionKey\);\s*\n\s*setEditingAiDraft\(false\);\s*\n\s*setAiSuggestionEditText\(""\);\s*\n\s*setSuggestionProductRemoved\(false\);\s*\n\s*setSuggestionChosenCard\(null\);/);
  // completed status indication
  assert.match(inboxSrc, /تم اعتماد وإرسال اقتراح AI/);
});

test("frontend lifecycle: text failure keeps the suggestion pending (no dismiss); card failure is surfaced", () => {
  assert.match(inboxSrc, /\/\/ Text failed or was stale \(409\) → keep the suggestion pending\/actionable[\s\S]*?if \(!result\?\.ok\) return;/);
  // Phase 13.4 — card failure is derived from the FE-sequential batch summary and surfaced honestly.
  assert.match(inboxSrc, /cardOk = cardSummary\.failed === 0;[\s\S]*?فشل إرسال/);
});

test("backend lifecycle: the draft is cleared on send (not returned as an active suggestion afterwards)", () => {
  assert.match(routeSrc, /clearAiReplySuggestionDraft\(\{ tenantId, sessionId: conversationId/);
});

test("frontend reconciliation: suggestion visibility is derived from authoritative source_message_id identity", () => {
  // stale = there is a newer inbound than the draft's source → never actionable
  assert.match(inboxSrc, /const suggestionStale = latestCustomerMessageId > 0 && suggestionSourceId > 0 && latestCustomerMessageId > suggestionSourceId;/);
  assert.match(inboxSrc, /const aiSuggestionVisible = Boolean\(activeAiSuggestionText\) && !draftCompleted && dismissedAiSuggestionKey !== activeAiSuggestionKey && !suggestionStale;/);
  // identity keyed by source_message_id so a new draft replaces the old + resets edit/product state
  assert.match(inboxSrc, /return `\$\{selectedConversation\.session_id\}:\$\{suggestionSourceId \|\| 0\}:\$\{stamp \|\| activeAiSuggestionText\.length\}`;/);
  assert.match(inboxSrc, /const suggestionSourceId = Number\(activeAiReplyDraft\?\.metadata\?\.source_message_id\) \|\| 0;/);
});

// Phase 12 — a STALE/SUPERSEDED approve (409 STALE_SUGGESTION) must be presented distinctly, NOT as a red
// provider "failed" bubble. The server never called the provider, so nothing reached the customer.
test("frontend: STALE_SUGGESTION is classified as superseded, not a provider failure", () => {
  // server returns 409 STALE_SUGGESTION and returns BEFORE the provider send block
  assert.match(routeSrc, /return res\.status\(409\)\.json\(\{\s*\n\s*success: false, sent: false, code: "STALE_SUGGESTION", reason: "newer_customer_message",/);
  // the frontend branches on stale FIRST and removes the optimistic bubble (never marks it delivery_status:"failed")
  assert.match(inboxSrc, /if \(stale\) \{[\s\S]*?tone: "amber", text: "لم يتم الإرسال — وصلت رسالة أحدث من العميل\. تم إلغاء الاقتراح القديم\."[\s\S]*?messages: asArray\(conversation\.messages\)\.filter\(\(item\) => item\.id !== optimistic\.id\)[\s\S]*?return \{ ok: false, stale: true, superseded: true \};/);
});

// Phase 11.3 Step 7 — the current-suggestion invariant: at most ONE actionable AI suggestion per
// conversation, and it is always the authoritative server draft (last_ai_reply_draft). A regression that
// renders a second/older suggestion, or derives the card from anything other than the persisted draft, breaks it.
test("invariant: the actionable suggestion is the single authoritative server draft (not a stale/duplicate)", () => {
  // (a) the card text comes from the one persisted draft, not a client-accumulated list
  assert.match(inboxSrc, /const activeAiReplyDraft = /);
  // (b) exactly one visibility gate — a newer inbound turn hides the old draft, so two can never be actionable at once
  assert.match(inboxSrc, /const suggestionStale = latestCustomerMessageId > 0 && suggestionSourceId > 0 && latestCustomerMessageId > suggestionSourceId;/);
  assert.match(inboxSrc, /const aiSuggestionVisible = Boolean\(activeAiSuggestionText\) && !draftCompleted && dismissedAiSuggestionKey !== activeAiSuggestionKey && !suggestionStale;/);
  // (c) server side: the draft is the single source and is cleared on send so it cannot re-appear as actionable
  assert.match(routeSrc, /clearAiReplySuggestionDraft\(\{ tenantId, sessionId: conversationId/);
});
