// Phase 13.3 — PRESENTATION-ONLY AI Inbox simplification. The AI Suggested Reply card is the ONE shared
// operator surface across all three channels (Messenger / Instagram / WhatsApp). This pass removes the two large
// panels ("AI draft validation" + "Confidence engine") and hides the technical grounding facts / context
// provenance, condensing everything into ONE compact "⚠ يحتاج مراجعة" badge. It must NOT touch generation,
// grounding, validation/confidence logic, product resolution, colour disambiguation, or the send/lifecycle path —
// only the display. These are source-contract assertions (the repo has no DOM harness for this page).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// The card is ONE shared component now, rendered by /admin/ai-inbox and by the
// /inbox PWA, so these contracts cover both surfaces at once.
const cardSrc = readFileSync(path.join(here, "../../src/modules/aiSupport/components/AiSuggestionCard.jsx"), "utf8");
const pwaSrc = readFileSync(path.join(here, "../../src/modules/aiSupport/pages/AiInboxPwa.jsx"), "utf8");
const inboxSrc = readFileSync(path.join(here, "../../src/modules/aiSupport/pages/AiInbox.jsx"), "utf8") + pwaSrc + cardSrc;
const cardBlock = cardSrc.slice(cardSrc.indexOf("function AiSuggestionCard"));

test("the card no longer renders the technical grounding-facts block or context-provenance chip", () => {
  assert.doesNotMatch(cardBlock, /حقائق الاستناد/);
  assert.doesNotMatch(cardBlock, /المنتج من سياق المحادثة/);
  // and the dead grounding/factChips projection is gone from the card body
  assert.doesNotMatch(cardBlock, /const factChips = \[/);
  assert.doesNotMatch(cardBlock, /const fromContext = /);
});

test("the compact review badge renders ONLY when reviewNeeded is true (one small cue, not a panel)", () => {
  assert.match(cardBlock, /reviewNeeded \? <span[^>]*>⚠ يحتاج مراجعة<\/span> : null/);
  // reviewNeeded is a prop, computed once from the EXISTING normalized validation/confidence summaries
  assert.match(cardBlock, /reviewNeeded = false,/);
  assert.match(inboxSrc, /const reviewNeeded = normalizedValidation\.violationsCount > 0 \|\| normalizedConfidence\.decision === "high_risk" \|\| normalizedConfidence\.tone === "rose";/);
});

test("operator-actionable content is fully retained: final send text, product/colour choices, Product-to-Send preview", () => {
  // the exact text that will be sent
  assert.match(cardBlock, /aiSupport\.inbox\.panel\.textToSend/);
  // the Product-to-Send preview + product/colour disambiguation still mount (unchanged component)
  assert.match(cardBlock, /<SuggestionProductToSend/);
  assert.match(cardBlock, /colorChoices=\{colorChoices\}/);
  assert.match(cardBlock, /colorRequired=\{colorRequired\}/);
  assert.match(cardBlock, /choices=\{productChoices\}/);
});

test("the three operator actions remain: edit, approve & send, dismiss", () => {
  assert.match(cardBlock, /تعديل الرد/);
  assert.match(cardBlock, /اعتماد وإرسال/);
  assert.match(cardBlock, /تجاهل/);
  assert.match(cardBlock, /onClick=\{onApprove\}/);
  assert.match(cardBlock, /onClick=\{onDismiss\}/);
});

test("cross-channel: ONE shared card renders for all channels; channel is a prop, not a fork", () => {
  // ONE component, and exactly ONE call site per surface — never a per-channel
  // fork. The desktop mounts it inside the manual composer; the PWA mounts it
  // above its own composer. Both pass the channel in as a prop.
  const desktopSrc = readFileSync(path.join(here, "../../src/modules/aiSupport/pages/AiInbox.jsx"), "utf8");
  assert.equal((desktopSrc.match(/<AiSuggestionCard/g) || []).length, 1, "the desktop must have exactly one AiSuggestionCard call site");
  assert.equal((pwaSrc.match(/<AiSuggestionCard/g) || []).length, 1, "the PWA must have exactly one AiSuggestionCard call site");
  assert.match(desktopSrc, /channelName=\{channelLabel\(conversation\?\.channel \|\| conversation\?\.source\)\}/);
  assert.match(pwaSrc, /channelName=\{selectedMetaLabel\}/);
});

test("lifecycle preserved: a completed suggestion still disappears (card gates on aiSuggestionVisible)", () => {
  // presentation change must not weaken the monotonic completed-draft gate
  assert.match(inboxSrc, /aiSuggestionVisible && clean\(aiSuggestionText\) \? \(\s*<AiSuggestionCard/);
  assert.match(inboxSrc, /const aiSuggestionVisible = Boolean\(activeAiSuggestionText\) && !draftCompleted &&/);
});
