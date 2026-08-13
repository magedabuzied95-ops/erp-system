// Phase 13.4 — Unified multi-product selection & batch send. Source-contract assertions (the repo has no DOM
// harness for these pages) that the wiring for the three selection semantics, the FE-sequential batch send,
// honest partial failure, and the preserved lifecycle/safety invariants is in place across BOTH the manual
// "إرسال منتج" picker and the AI recommendation batch.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "../../", rel), "utf8");
const inboxSrc = read("src/modules/aiSupport/pages/AiInbox.jsx");
const pickerSrc = read("src/modules/aiSupport/components/ProductCardPicker.jsx");
const gateSrc = read("server/services/aiInboxGroundingGate.js");
const salesSrc = read("server/services/aiSalesAgentService.js");

// ---------------- Backend: selection_semantics flag (additive, deterministic, safe default) ----------------
test("gate emits selection_semantics only when ambiguous; defaults to identity_disambiguation (single-select)", () => {
  // Phase 13.4.1 added a third value (multi_variant_options) for grounded colour options of ONE product; the
  // ambiguous-product branch, its identity_disambiguation default, and the null-when-unambiguous default are all
  // unchanged — the variant-options case is simply evaluated first.
  assert.match(gateSrc, /selection_semantics: variantOptionsMode\s*\n?\s*\?\s*"multi_variant_options"/);
  assert.match(gateSrc, /\(productAmbiguous\s*\n?\s*\?\s*\(\(decision\.action === "soft_match" \|\| detectsRecommendationIntent\(message\)\) \? "recommendation" : "identity_disambiguation"\)\s*\n?\s*: null\)/);
});
test("recommendation intent detector is deterministic and matches show-me-options phrasing", () => {
  assert.match(gateSrc, /const detectsRecommendationIntent = \(text = ""\) =>/);
  assert.match(gateSrc, /موديلات\|اختيارات/);
});
test("send_package carries selection_semantics through to the draft (dormant until FE reads it)", () => {
  assert.match(salesSrc, /selection_semantics: groundingResult\.selection_semantics \|\| null/);
});

// ---------------- FE-sequential per-card send + honest partial failure ----------------
test("send is FE-sequential per card (own idempotency key), reusing the single-card route path", () => {
  assert.match(inboxSrc, /for \(const card of cards\) \{[\s\S]*?const cardRequestId = buildClientRequestId\(\);[\s\S]*?product_cards: \[card\],[\s\S]*?client_request_id: cardRequestId/);
});
test("per-card results are collected and never throw the whole batch (partial failure is honest)", () => {
  assert.match(inboxSrc, /results\.push\(\{ key, ok: true \}\)/);
  assert.match(inboxSrc, /results\.push\(\{ key, ok: false, error:/);
  assert.match(inboxSrc, /const summary = summarizeSendResults\(results\)/);
  assert.match(inboxSrc, /return \{ ok: allOk, results, summary \}/);
});
test("double-click guard still protects the batch", () => {
  assert.match(inboxSrc, /if \(sendingProductCardsRef\.current\) return \{ ok: false, results: \[\], summary: \{ total: 0, sent: 0, failed: 0 \}, busy: true \}/);
});

// ---------------- Manual picker: select-not-send, survive search, max 5, batch submit, reconcile ----------------
test("manual card click TOGGLES selection (never sends); sending is a separate explicit action", () => {
  assert.match(pickerSrc, /const toggleProductSelection = useCallback\(\(product\) => \{/);
  assert.match(pickerSrc, /onClick=\{\(\) => toggleProductSelection\(product\)\}/);
});
test("manual selection survives search/filter (retained card snapshots, no visible-only pruning)", () => {
  assert.match(pickerSrc, /const \[selectedCardsById, setSelectedCardsById\] = useState\(\{\}\)/);
  assert.doesNotMatch(pickerSrc, /setSelectedProductIds\(\(current\) => current\.filter\(\(id\) => visibleProducts\.some/);
});
test("manual max 5 enforced with a clear message, never a silent drop", () => {
  assert.match(pickerSrc, /if \(selectedProductIds\.length >= MAX_BATCH_PRODUCTS\) \{\s*\n\s*setError\(maxBatchReachedText\(\)\);\s*\n\s*return;/);
});
test("manual submit sends the ORDERED multi-selection and reconciles keep-only-failed on partial failure", () => {
  assert.match(pickerSrc, /const batch = allowMultiple && selectedProducts\.length \? selectedProducts : \(activeCard \? \[activeCard\] : \[\]\)/);
  assert.match(pickerSrc, /const failedIds = new Set\(\s*\n?\s*results\.filter\(\(r\) => r && r\.ok === false\)/);
  assert.match(pickerSrc, /setSelectedProductIds\(\(cur\) => cur\.filter\(\(id\) => failedIds\.has\(String\(id\)\)\)\)/);
});
test("manual batch stays MANUAL ownership (assisted_approval not forced true)", () => {
  // the picker submit path does not pass assistedApproval; the send defaults assisted_approval to false
  assert.match(inboxSrc, /return sendProductCards\(cards\);/);
  assert.match(inboxSrc, /assisted_approval: options\.assistedApproval === true/);
});
test("fresh open clears the manual selection (no leak across conversations/sessions)", () => {
  assert.match(pickerSrc, /setSelectedProductIds\(\[\]\);\s*\n\s*setSelectedCardsById\(\{\}\);\s*\n\s*if \(sizeMode\)/);
});

// ---------------- AI recommendation batch (multi) vs identity disambiguation (single) ----------------
test("recommendation mode is driven by send_package.selection_semantics, not card count", () => {
  assert.match(inboxSrc, /const suggestionSelectionMode = selectionModeFromSemantics\(suggestionSelectionSemantics\)/);
  assert.match(inboxSrc, /const isRecommendationSuggestion = suggestionSelectionMode === SELECTION_MODES\.RECOMMENDATION/);
});
test("recommendation toggle is multi-select, capped at MAX_BATCH_PRODUCTS with the limit message", () => {
  assert.match(inboxSrc, /const \{ list, blocked \} = toggleProductSelection\(current, choice, \{ max: MAX_BATCH_PRODUCTS \}\)/);
  assert.match(inboxSrc, /if \(blocked\) setToast\(\{ tone: "amber", text: isVariantOptionsSuggestion \? maxVariantBatchReachedText\(\) : maxBatchReachedText\(\) \}\)/);
});
test("identity disambiguation stays SINGLE-select and still blocks approve until one is picked", () => {
  // the ambiguity guard is skipped ONLY in a multi-select mode (recommendation / variant options); identity
  // disambiguation keeps requiring exactly one pick
  assert.match(inboxSrc, /if \(!isMultiSelectSuggestion && suggestionSendPackage\?\.product_ambiguous && !suggestionChosenCard && !suggestionProductRemoved\)/);
  assert.match(inboxSrc, /const isMultiSelectSuggestion = isRecommendationSuggestion \|\| isVariantOptionsSuggestion/);
  // the card component renders single-select choices only when NOT recommendation mode
  assert.match(inboxSrc, /const showChoices = !recommendationMode && ambiguous/);
  assert.match(inboxSrc, /const showRecommendation = recommendationMode && !removed/);
});
test("approve sends approved text THEN the selected products (recommendation batch or single) via one assisted flow", () => {
  assert.match(inboxSrc, /const cardsToSend = recommendationCards\.length \? recommendationCards : \(card \? \[card\] : \[\]\)/);
  assert.match(inboxSrc, /assistedApproval: true,[\s\S]*?product_count: cardsToSend\.length/);
  assert.match(inboxSrc, /const res = await sendProductCards\(cardsToSend, \{ assistedApproval: true, suppressToast: true \}\)/);
});
test("assisted batch keeps assisted_approval=true (ai_active), never human_takeover for attaching products", () => {
  // text send flags approve/assisted; product sends carry assisted_approval true → route re-asserts ai_active
  assert.match(inboxSrc, /flow: "approve",\s*\n\s*assistedApproval: true/);
});
test("editing the AI text preserves selections and vice versa (independent state, reset only on new draft)", () => {
  // recommendation selection lives in its own state, reset only by the activeAiSuggestionKey effect
  assert.match(inboxSrc, /const \[suggestionRecommendationCards, setSuggestionRecommendationCards\] = useState\(\[\]\)/);
  assert.match(inboxSrc, /setSuggestionRecommendationCards\(\[\]\);\s*\n\s*setEditingAiDraft\(false\);/);
});
test("new source_message_id / completed tombstone clears the recommendation selection (no resurrection)", () => {
  // reset effect keyed on activeAiSuggestionKey (which includes suggestionSourceId)
  assert.match(inboxSrc, /setSuggestionRecommendationCards\(\[\]\);[\s\S]*?\}, \[activeAiSuggestionKey\]\)/);
  // completed tombstone lifecycle preserved
  assert.match(inboxSrc, /const draftCompleted = \["sent", "cleared"\]\.includes/);
});

// ---------------- Providers: shared UX, channel-specific delivery unchanged ----------------
test("delivery stays channel-specific and unchanged (Messenger rich card / Instagram text+link / WhatsApp image+link)", () => {
  assert.match(inboxSrc, /if \(ch\.includes\("messenger"\) \|\| ch === "facebook"\) return \{ labelKey: "aiSupport\.inbox\.ui\.fmtRichCard"/);
  assert.match(inboxSrc, /if \(ch\.includes\("whatsapp"\)\) return \{ labelKey: "aiSupport\.inbox\.ui\.fmtImageLink"/);
  assert.match(inboxSrc, /if \(ch\.includes\("instagram"\)\) return \{ labelKey: "aiSupport\.inbox\.ui\.fmtTextLink"/);
});
