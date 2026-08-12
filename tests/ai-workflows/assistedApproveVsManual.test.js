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

test("frontend: assisted flag is sent to /send and derived from approve/editing (not arbitrary)", () => {
  assert.match(inboxSrc, /assisted_approval: assistedApproval/); // sent in the /send body
  assert.match(inboxSrc, /const assistedApproval = options\.assistedApproval === true \|\| sendFlow === "approve" \|\| editingAiDraft === true/);
});

test("frontend: assisted approval does NOT optimistically take over; manual reply does", () => {
  assert.match(inboxSrc, /conversation_status: assistedApproval \? \(conversation\.conversation_status \|\| "ai_active"\) : "human_takeover"/);
});

test("frontend: card Approve sends EDITED text when editing, and flags assisted", () => {
  assert.match(inboxSrc, /const textToSend = editingAiDraft && clean\(replyText\) \? clean\(replyText\) : activeAiSuggestionText/);
  assert.match(inboxSrc, /assistedApproval: true/);
});

test("frontend: human_takeover state is clearly labelled + Take Over / Return controls exist", () => {
  assert.match(inboxSrc, /اقتراحات AI متوقفة/);
  assert.match(inboxSrc, /onAction\("takeover"\)/);
  assert.match(inboxSrc, /onAction\("return"\)/);
});
