// Phase 13 — post-approval lifecycle. A SUCCESSFUL assisted approval consumes the draft: the frontend must
// clear the ONE authoritative draft (conversation state) so every derived surface (reply card, validation,
// confidence, grounding, product/colour choices, Product-to-Send preview, send-package, selected variant)
// collapses immediately — no refetch/cache race can re-show the completed suggestion. Shared across all channels.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "../../", rel), "utf8");
const inboxSrc = read("src/modules/aiSupport/pages/AiInbox.jsx");
const routeSrc = read("server/routes/aiAgentOrders.js");

test("1/2/3/4/5: a successful assisted approval optimistically clears the authoritative draft (all channels)", () => {
  // the single shared handler patches the conversation draft to {} on success → activeAiReplyDraft becomes empty
  assert.match(inboxSrc, /patchConversation\(selectedConversation\?\.conversation_key \|\| selectedConversation\?\.session_id, \(conv\) => \(\{ \.\.\.conv, ai_reply_draft: \{\}, last_ai_reply_draft: \{\} \}\)\);/);
});

test("6/7/8: selected product, colour/variant, and inline-edit state all reset on success", () => {
  const block = inboxSrc.slice(inboxSrc.indexOf("const handleApproveAiSuggestion"), inboxSrc.indexOf("const handleDismissAiSuggestion"));
  assert.match(block, /setSuggestionProductRemoved\(false\);/);
  assert.match(block, /setSuggestionChosenCard\(null\);/);
  assert.match(block, /setEditingAiDraft\(false\);/);
  assert.match(block, /setAiSuggestionEditText\(""\);/);
  assert.match(block, /setDismissedAiSuggestionKey\(activeAiSuggestionKey\);/);
});

test("9/10: validation, confidence and grounding all derive from the (now-empty) authoritative draft via aiSuggestionVisible", () => {
  // panels gate on aiSuggestionVisible; the card (which contains grounding + product/colour) gates on the same
  assert.match(inboxSrc, /aiSuggestionVisible \? \(activeAiReplyDraft\?\.validation \|\| activeAiReplyDraft\?\.metadata\?\.validation \|\| \{\}\) : \{\}/);
  assert.match(inboxSrc, /aiSuggestionVisible \? \(activeAiReplyDraft\?\.confidence_engine \|\| activeAiReplyDraft\?\.metadata\?\.confidence_engine \|\| \{\}\) : \{\}/);
  assert.match(inboxSrc, /aiSuggestionVisible && clean\(aiSuggestionText\) \? \(\s*<AiSuggestionCard/);
});

test("11: a STALE/failed TEXT send returns BEFORE clearing — the suggestion stays actionable", () => {
  const block = inboxSrc.slice(inboxSrc.indexOf("const handleApproveAiSuggestion"), inboxSrc.indexOf("const handleDismissAiSuggestion"));
  const guardIdx = block.indexOf("if (!result?.ok) return;");
  const clearIdx = block.indexOf("last_ai_reply_draft: {}");
  assert.ok(guardIdx > 0 && clearIdx > guardIdx, "the draft-clear must be AFTER the result.ok guard");
  // frontend classifies 409 STALE as superseded (not provider-failed) — unchanged
  assert.match(inboxSrc, /if \(stale\) \{[\s\S]*?superseded: true \};/);
});

test("13: a partial product-package failure is surfaced honestly (text consumed, card-failure toast)", () => {
  const block = inboxSrc.slice(inboxSrc.indexOf("const handleApproveAiSuggestion"), inboxSrc.indexOf("const handleDismissAiSuggestion"));
  assert.match(block, /الرد اتبعت، لكن كارت المنتج فشل/);
  // the success emerald toast is gated on cardOk
  assert.match(block, /if \(cardOk\) setToast\(\{ tone: "emerald"/);
});

test("14: a new inbound / new source_message_id produces a fresh clean suggestion (dismissal is keyed, not global)", () => {
  assert.match(inboxSrc, /const aiSuggestionVisible = Boolean\(activeAiSuggestionText\) && dismissedAiSuggestionKey !== activeAiSuggestionKey && !suggestionStale;/);
  assert.match(inboxSrc, /const suggestionSourceId = Number\(activeAiReplyDraft\?\.metadata\?\.source_message_id\) \|\| 0;/);
});

test("15: draft identity is per-conversation → switching conversations cannot retain a prior suggestion", () => {
  assert.match(inboxSrc, /const activeAiReplyDraft = useMemo\(\s*\(\) => selectedConversation\?\.ai_reply_draft \|\| selectedConversation\?\.last_ai_reply_draft \|\| null,/);
});

test("16: double approval stays idempotent — server clears the draft on send + validates a REAL current draft", () => {
  assert.match(routeSrc, /clearAiReplySuggestionDraft\(\{ tenantId, sessionId: conversationId \}\)/);
  assert.match(routeSrc, /const hasCurrentDraft = aiReplyDraft\?\.status === "not_sent" && Boolean\(envText\(aiReplyDraft\?\.text\)\)/);
  // once cleared, a second approve finds no not_sent draft → isAssistedApprove false → no duplicate assisted send
  assert.match(routeSrc, /const isAssistedApprove = req\.body\?\.assisted_approval === true && hasCurrentDraft/);
});
