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

test("the panels only render when hasValidation/hasConfidence are truthy (empty summary ⇒ hidden)", () => {
  assert.match(inboxSrc, /const hasValidation = Boolean\(normalizedValidation\.violationsCount \|\| normalizedValidation\.warningsCount \|\| normalizedValidation\.details\.length\);/);
  assert.match(inboxSrc, /const hasConfidence = Boolean\(normalizedConfidence\.reasonsCount \|\| normalizedConfidence\.riskFlagsCount \|\| normalizedConfidence\.score\);/);
  assert.match(inboxSrc, /\{hasValidation \? \(/);
  assert.match(inboxSrc, /\{hasConfidence \? \(/);
});

test("draft identity is per-conversation (activeAiReplyDraft ← selectedConversation) so switching cannot retain prior panels", () => {
  assert.match(inboxSrc, /const activeAiReplyDraft = useMemo\(\s*\(\) => selectedConversation\?\.ai_reply_draft \|\| selectedConversation\?\.last_ai_reply_draft \|\| null,/);
});
