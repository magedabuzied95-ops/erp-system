// Phase 13 fix — the AI draft-validation + confidence-engine panels must share the ONE authoritative
// current-suggestion identity as the AI Suggested Reply card (aiSuggestionVisible). No current actionable draft
// (null / sent / cleared / stale / superseded / dismissed / different conversation) ⇒ no panels. They must never
// linger from stale frontend state (aiReply.*) or a prior conversation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const inboxSrc = readFileSync(path.join(here, "../../src/modules/aiSupport/pages/AiInbox.jsx"), "utf8");

test("validation panel is gated on aiSuggestionVisible and derives ONLY from the authoritative draft", () => {
  assert.match(inboxSrc, /const activeAiReplyValidation = useMemo\(\s*\(\) => normalizeValidationSummary\(\s*aiSuggestionVisible \? \(activeAiReplyDraft\?\.validation \|\| activeAiReplyDraft\?\.metadata\?\.validation \|\| \{\}\) : \{\}\s*\),/);
});

test("confidence panel is gated on aiSuggestionVisible and derives ONLY from the authoritative draft", () => {
  assert.match(inboxSrc, /const activeAiReplyConfidence = useMemo\(\s*\(\) => normalizeConfidenceEngineSummary\(\s*aiSuggestionVisible \? \(activeAiReplyDraft\?\.confidence_engine \|\| activeAiReplyDraft\?\.metadata\?\.confidence_engine \|\| \{\}\) : \{\}\s*\),/);
});

test("panels NO LONGER fall back to stale frontend state (aiReply.*) or last_ai_reply_validation columns", () => {
  const valBlock = inboxSrc.slice(inboxSrc.indexOf("const activeAiReplyValidation"), inboxSrc.indexOf("const activeAiReplyShadow"));
  assert.doesNotMatch(valBlock, /aiReply\.validation/);
  assert.doesNotMatch(valBlock, /aiReply\.confidence_engine/);
  assert.doesNotMatch(valBlock, /last_ai_reply_validation/);
  assert.doesNotMatch(valBlock, /last_ai_reply_confidence_engine/);
});

test("aiSuggestionVisible is the SAME identity the AI Suggested Reply card uses (source_message_id + stale + dismissed)", () => {
  assert.match(inboxSrc, /const aiSuggestionVisible = Boolean\(activeAiSuggestionText\) && !draftCompleted && dismissedAiSuggestionKey !== activeAiSuggestionKey && !suggestionStale;/);
  // the card renders only when the same gate is true — panels + card now share one lifecycle
  assert.match(inboxSrc, /aiSuggestionVisible && clean\(aiSuggestionText\) \? \(\s*<AiSuggestionCard/);
});

// Phase 13.3 — PRESENTATION ONLY. The large "AI draft validation" and "Confidence engine" panels are removed
// from the operator view. Their state is condensed into ONE compact "⚠ يحتاج مراجعة" badge, shown only when the
// EXISTING logic materially recommends review. The underlying validation/confidence memos are unchanged (they
// still gate on aiSuggestionVisible + derive from the authoritative draft — asserted above).
test("the large validation/confidence panels are gone from the operator view", () => {
  assert.doesNotMatch(inboxSrc, /const hasValidation = /);
  assert.doesNotMatch(inboxSrc, /const hasConfidence = /);
  assert.doesNotMatch(inboxSrc, /\{hasValidation \? \(/);
  assert.doesNotMatch(inboxSrc, /\{hasConfidence \? \(/);
});

test("review state is condensed into ONE compact badge, driven by the SAME existing validation/confidence logic", () => {
  // the compact review cue derives only from the existing normalized summaries — no new thresholds
  assert.match(inboxSrc, /const reviewNeeded = normalizedValidation\.violationsCount > 0 \|\| normalizedConfidence\.decision === "high_risk" \|\| normalizedConfidence\.tone === "rose";/);
  // it is threaded into the single shared suggestion card and rendered as one small badge
  assert.match(inboxSrc, /reviewNeeded=\{reviewNeeded\}/);
  assert.match(inboxSrc, /reviewNeeded \? <span[^>]*>⚠ يحتاج مراجعة<\/span> : null/);
});

test("technical grounding facts + context provenance are hidden from the operator suggestion card", () => {
  const cardBlock = inboxSrc.slice(inboxSrc.indexOf("function AiSuggestionCard"), inboxSrc.indexOf("function ManualReplyComposer"));
  assert.doesNotMatch(cardBlock, /حقائق الاستناد/);
  assert.doesNotMatch(cardBlock, /المنتج من سياق المحادثة/);
});

test("draft identity is per-conversation (activeAiReplyDraft ← selectedConversation) so switching cannot retain prior panels", () => {
  assert.match(inboxSrc, /const activeAiReplyDraft = useMemo\(\s*\(\) => selectedConversation\?\.ai_reply_draft \|\| selectedConversation\?\.last_ai_reply_draft \|\| null,/);
});
