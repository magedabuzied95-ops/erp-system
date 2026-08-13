// Phase 13.4.1 — AI Suggestion multi-variant / multi-colour selection.
//
// TWO colour semantics must stay distinct:
//   A) VARIANT IDENTITY RESOLUTION ("عايز الأسود") → single exact variant, no options UI.
//   B) AVAILABLE OPTIONS ("فيه جوردن فور مقاس 43؟" → 4 in-stock colours) → the operator may tick SEVERAL grounded
//      variants of the SAME product and send them with ONE assisted approval.
//
// Behavioural assertions run against the real grounding gate + the real selection primitives; the operator-UI
// wiring is asserted against source (the repo has no DOM harness for AiInbox.jsx), matching Phase 13.4 practice.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as G from "../../server/services/aiInboxGroundingGate.js";
import {
  MAX_BATCH_PRODUCTS, SELECTION_MODES, selectionModeFromSemantics, isMultiSelectMode,
  productSelectionKey, toggleProductSelection, summarizeSendResults,
  selectedVariantCountText, assistedVariantSendButtonText, variantSendOutcomeText, maxVariantBatchReachedText,
} from "../../src/modules/aiSupport/lib/productSelection.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "../../", rel), "utf8");
const inboxSrc = read("src/modules/aiSupport/pages/AiInbox.jsx");
const gateSrc = read("server/services/aiInboxGroundingGate.js");
const salesSrc = read("server/services/aiSalesAgentService.js");

// ---- Real grounded fixture: ONE product (Air Jordan 4), size 43, four in-stock colours ----
const JORDAN = { id: 39, name: "Air Jordan 4", product_type: "sneakers" };
const FOUR_COLORS = [
  { variant_id: 901, size: "43", color: "white&green", stock: 2 },
  { variant_id: 902, size: "43", color: "black&red", stock: 3 },
  { variant_id: 903, size: "43", color: "black", stock: 1 },
  { variant_id: 904, size: "43", color: "Navy", stock: 4 },
];
// `variants` may be an array (same stock for every matched product) or a fn (productId) => variants.
const ground = (message, variants, products = [JORDAN]) =>
  G.applyInboxGroundingGate({
    tenantId: 1, sessionId: "instagram:owner-test", message,
    deps: {
      resolveByBrandModel: async () => products,
      inventoryFacts: async (productId) => ({ variant_stock: typeof variants === "function" ? variants(productId) : variants }),
    },
  });

// ================= 1 — SEMANTICS =================
test("1: no explicit colour + 4 in-stock colours on a grounded product → multi_variant_options", async () => {
  const r = await ground("فيه جوردن فور مقاس 43؟", FOUR_COLORS);
  assert.equal(r.action, "color_choice_required");
  assert.equal(r.selection_semantics, "multi_variant_options");
  assert.equal(r.color_choices.length, 4);
  assert.equal(selectionModeFromSemantics(r.selection_semantics), SELECTION_MODES.VARIANT_OPTIONS);
  assert.equal(isMultiSelectMode(SELECTION_MODES.VARIANT_OPTIONS), true);
});

test("15: explicit requested colour → SINGLE exact variant, no options semantics", async () => {
  const r = await ground("فيه جوردن فور أسود مقاس 43؟", FOUR_COLORS);
  assert.equal(r.action, "available");
  assert.equal(r.color_choice_required, false);
  assert.equal(r.selection_semantics, null);
  assert.equal(r.color_choices.length, 0);
  // ONE exact variant is resolved from the black family (existing colour-alias matching picks the best-stock
  // member); the point here is that no unrelated colour is offered and no multi-select appears.
  assert.match(r.grounding.resolved.color, /black/i);
  assert.ok(r.grounding.resolved.variantId);
});

test("16: exactly ONE in-stock colour at the requested size → auto-ground, no multi-select", async () => {
  const r = await ground("فيه جوردن فور مقاس 43؟", [
    { variant_id: 901, size: "43", color: "Navy", stock: 2 },
    { variant_id: 902, size: "43", color: "black", stock: 0 },
  ]);
  assert.equal(r.action, "available");
  assert.equal(r.selection_semantics, null);
  assert.ok(r.send_ready_card);
});

test("17: ZERO in-stock colours at the requested size → unavailable, no selection UI (Phase 12.2 preserved)", async () => {
  const r = await ground("فيه جوردن فور مقاس 43؟", FOUR_COLORS.map((v) => ({ ...v, stock: 0 })));
  assert.equal(r.action, "unavailable");
  assert.equal(r.color_choice_required, false);
  assert.equal(r.selection_semantics, null);
});

const JORDAN_208 = { id: 208, name: "Air Jordan 4 Retro", product_type: "sneakers" };

test("18: colour options SPANNING two products stay single_disambiguation (identity genuinely unresolved)", async () => {
  // BOTH catalog rows stock the requested size in different colours → the operator must resolve WHICH product
  const r = await ground(
    "عندكم جوردن فور مقاس 43؟",
    (pid) => (String(pid) === "39"
      ? [{ variant_id: 901, size: "43", color: "Navy", stock: 2 }]
      : [{ variant_id: 801, size: "43", color: "white&green", stock: 2 }]),
    [JORDAN, JORDAN_208],
  );
  assert.equal(r.product_ambiguous, true);
  assert.equal(new Set(r.color_choices.map((c) => String(c.product_id))).size, 2);
  assert.notEqual(r.selection_semantics, "multi_variant_options");
  assert.equal(selectionModeFromSemantics(r.selection_semantics), SELECTION_MODES.DISAMBIGUATION);
});

// PRODUCTION SHAPE (verified read-only against tenant 1, 2026-08-13): "جوردن فور" matches TWO catalog rows, but
// only product 39 stocks size 43 — every colour option is canonically ONE product, so the options UI is correct.
// Identity is grounded by the VARIANT evidence, which is stronger than the name query.
test("1b: name matches >1 row yet all in-stock size-43 colours are ONE product → multi_variant_options", async () => {
  const r = await ground(
    "فيه جوردن فور مقاس 43؟",
    (pid) => (String(pid) === "39" ? FOUR_COLORS : [{ variant_id: 801, size: "41", color: "Red", stock: 3 }]),
    [JORDAN, JORDAN_208],
  );
  assert.equal(r.action, "color_choice_required");
  assert.equal(r.product_ambiguous, true, "the NAME query is ambiguous…");
  assert.equal(new Set(r.color_choices.map((c) => String(c.product_id))).size, 1, "…but the variant evidence is not");
  assert.equal(r.selection_semantics, "multi_variant_options");
  assert.equal(r.color_choices.length, 4);
});

test("19: Phase 13.4 product recommendation multi-select is NOT regressed", async () => {
  const r = await ground("عندكم ايه موديلات سنيكرز؟", [], [JORDAN, JORDAN_208]);
  assert.equal(r.product_ambiguous, true);
  assert.equal(selectionModeFromSemantics(r.selection_semantics), SELECTION_MODES.RECOMMENDATION);
});

// ================= 5/9/11/12 — CANONICAL VARIANT IDENTITY =================
test("9/11/12: every option carries canonical product_id + variant_id + requested size + stock (no cost fields)", async () => {
  const r = await ground("فيه جوردن فور مقاس 43؟", FOUR_COLORS);
  const byColor = Object.fromEntries(r.color_choices.map((c) => [c.color, c]));
  assert.equal(byColor.Navy.variant_id, 904);
  assert.equal(byColor["black&red"].variant_id, 902);
  assert.notEqual(byColor.Navy.variant_id, byColor["black&red"].variant_id);
  for (const c of r.color_choices) {
    assert.equal(String(c.product_id), "39");
    assert.equal(c.size, "43");
    assert.equal(c.displaySize, "43");
    for (const k of Object.keys(c)) assert.doesNotMatch(k, /cost|wholesale|supplier|purchase/i);
  }
});

test("10: canonical image + display price come from the SAME per-variant enrichment (no colour→image invention)", () => {
  // one enrich call per colour, keyed by that colour's variant_id → the variant's own image/price
  assert.match(salesSrc, /for \(const cc of colorChoices\.slice\(0, 8\)\) \{[\s\S]*?variant_id: cc\.variant_id/);
  assert.match(salesSrc, /size: cc\.displaySize \|\| cc\.size \|\| null/);
  // the shared enricher prefers the VARIANT record's image over the product's before falling back
  assert.match(salesSrc, /resolveProductImageFromRecord\(\{ \.\.\.prod, \.\.\.\(variant \|\| \{\}\) \}\) \|\| variant\?\.image_url/);
  // the UI renders the option's own image, never a sibling's
  assert.match(inboxSrc, /const img = c\.image_url \|\| c\.image \|\| c\.thumbnail_url \|\| "";[\s\S]*?alt=\{clean\(c\.color\)\}/);
});

// ================= 2-8 — SELECTION PRIMITIVE =================
const opt = (variantId, color) => ({ product_id: 39, id: 39, variant_id: variantId, color, size: "43" });

test("2/3/4: multiple options selectable, count updates, deselect works", () => {
  let list = [];
  ({ list } = toggleProductSelection(list, opt(901, "white&green")));
  ({ list } = toggleProductSelection(list, opt(902, "black&red")));
  ({ list } = toggleProductSelection(list, opt(904, "Navy")));
  assert.equal(list.length, 3);
  assert.equal(selectedVariantCountText(3), "تم تحديد 3 اختيارات");
  assert.equal(assistedVariantSendButtonText(3), "اعتماد وإرسال (3 اختيارات)");
  ({ list } = toggleProductSelection(list, opt(902, "black&red")));
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((c) => c.variant_id), [901, 904]);
  assert.equal(selectedVariantCountText(2), "تم تحديد اختيارين");
});

test("5: MAX_BATCH_PRODUCTS (5) enforced for variant options too — blocked, never silently dropped", () => {
  let list = [];
  for (const vid of [901, 902, 903, 904, 905]) ({ list } = toggleProductSelection(list, opt(vid, `c${vid}`)));
  assert.equal(list.length, MAX_BATCH_PRODUCTS);
  const res = toggleProductSelection(list, opt(906, "c906"));
  assert.equal(res.blocked, true);
  assert.equal(res.list.length, 5);
  assert.match(maxVariantBatchReachedText(), /الحد الأقصى 5 اختيارات/);
});

test("6: SAME product with DIFFERENT variant_ids are all legitimate selections (never deduped by product_id)", () => {
  let list = [];
  for (const [vid, c] of [[901, "White"], [904, "Navy"], [903, "Black"]]) ({ list } = toggleProductSelection(list, opt(vid, c)));
  assert.equal(list.length, 3);
  assert.equal(new Set(list.map((c) => c.product_id)).size, 1);
  assert.equal(new Set(list.map(productSelectionKey)).size, 3);
});

test("7: same product+variant can never duplicate; similar colour LABELS never collide", () => {
  let list = [];
  ({ list } = toggleProductSelection(list, opt(903, "black")));
  const again = toggleProductSelection(list, { ...opt(903, "black"), color: "Black " });
  assert.equal(again.list.length, 0, "re-toggling the same canonical identity removes it (no duplicate row)");
  // two DIFFERENT variants whose colour text is nearly identical stay distinct (keyed by identity, not text)
  let l2 = [];
  ({ list: l2 } = toggleProductSelection(l2, opt(903, "black")));
  ({ list: l2 } = toggleProductSelection(l2, opt(902, "black&red")));
  assert.equal(l2.length, 2);
  assert.notEqual(productSelectionKey(l2[0]), productSelectionKey(l2[1]));
});

test("8: selection ORDER is preserved (append-only)", () => {
  let list = [];
  for (const [vid, c] of [[904, "Navy"], [901, "white&green"], [902, "black&red"]]) ({ list } = toggleProductSelection(list, opt(vid, c)));
  assert.deepEqual(list.map((c) => c.color), ["Navy", "white&green", "black&red"]);
});

// ================= UI wiring =================
test("2/3: the options UI is multi-select with checkmark + selected state + count, driven by the grounded package", () => {
  assert.match(inboxSrc, /const isVariantOptionsSuggestion = variantOptionsEligible && !isRecommendationSuggestion/);
  assert.match(inboxSrc, /const showVariantOptions = showColorChoices && variantOptionsMode/);
  assert.match(inboxSrc, /اختار الألوان اللي هتتبعت/);
  assert.match(inboxSrc, /selectedVariantCountText\(selectedCount\)/);
  assert.match(inboxSrc, /aria-pressed=\{picked\}/);
  assert.match(inboxSrc, /const key = productSelectionKey\(c\);\s*\n\s*const picked = selKeys\.has\(key\)/);
});

// The production defect: a draft PERSISTED before this phase shipped carries the older selection_semantics label
// while its colour choices already describe an options set. Mode is therefore decided from the grounded package.
test("stale label: color_choice_required + >1 choices + ONE product ⇒ options mode regardless of the saved label", () => {
  assert.match(inboxSrc, /const variantOptionsEligible = useMemo\(\(\) => \{[\s\S]*?if \(!suggestionSendPackage\?\.color_choice_required \|\| choices\.length <= 1\) return false;[\s\S]*?new Set\(choices\.map\(\(c\) => String\(c\?\.product_id \?\? c\?\.id \?\? ""\)\)\)\.size === 1/);
  // an explicit RECOMMENDATION label still wins (§14 non-regression)
  assert.match(inboxSrc, /variantOptionsEligible && !isRecommendationSuggestion/);
});

test("discoverability: pointer cursor, hover, ring on the selected card, and a hint when none picked", () => {
  assert.match(inboxSrc, /cursor-pointer/);
  assert.match(inboxSrc, /ring-1 ring-cyan-300\/40/);
  assert.match(inboxSrc, /hover:border-cyan-300\/30/);
  assert.match(inboxSrc, /تقدر تختار أكتر من لون/);
  assert.match(inboxSrc, /title=\{picked \? "اضغط لإلغاء الاختيار" : "اضغط لاختيار اللون ده"\}/);
});

test("zero selected in options mode ⇒ Approve & Send is DISABLED (not a failing click)", () => {
  assert.match(inboxSrc, /const approveDisabled = variantOptionsMode && recommendationCount === 0/);
  assert.match(inboxSrc, /disabled=\{approveDisabled\}/);
  assert.match(inboxSrc, /disabled:cursor-not-allowed/);
});

test("clicking a colour NEVER sends — approval is the only send action", () => {
  // the option button only toggles selection
  assert.match(inboxSrc, /onClick=\{\(\) => onToggleRecommendation\?\.\(c\)\}/);
  // approve label reflects the count; a variant batch requires at least one ticked option
  assert.match(inboxSrc, /assistedVariantSendButtonText\(recommendationCount\)/);
  assert.match(inboxSrc, /if \(isVariantOptionsSuggestion && !suggestionRecommendationCards\.length && !suggestionProductRemoved\)/);
});

test("single-select colour disambiguation UI still exists for the non-options case (§11/§12/§15 preserved)", () => {
  assert.match(inboxSrc, /المقاس متاح بأكتر من لون — اختار اللون/);
  assert.match(inboxSrc, /if \(!isMultiSelectSuggestion && suggestionSendPackage\?\.color_choice_required && !suggestionChosenCard/);
});

// ================= 13/14 — TEXT ⟷ SELECTION INDEPENDENCE =================
test("13/14: edited text and variant selections live in independent state (neither resets the other)", () => {
  assert.match(inboxSrc, /const \[suggestionRecommendationCards, setSuggestionRecommendationCards\] = useState\(\[\]\)/);
  assert.match(inboxSrc, /const \[aiSuggestionEditText, setAiSuggestionEditText\] = useState\(""\)/);
  // both are cleared ONLY by the new-draft effect, never by each other's handlers
  assert.match(inboxSrc, /setSuggestionRecommendationCards\(\[\]\);\s*\n\s*setEditingAiDraft\(false\);\s*\n\s*setAiSuggestionEditText\(""\);\s*\n\s*\}, \[activeAiSuggestionKey\]\)/);
  assert.match(inboxSrc, /const handleCancelEditAiSuggestion = useCallback\(\(\) => \{\s*\n\s*setEditingAiDraft\(false\);\s*\n\s*setAiSuggestionEditText\(""\);\s*\n\s*\}, \[\]\)/);
});

// ================= 20-24 — APPROVAL + CHANNEL DELIVERY =================
test("20/21: ONE assisted approval — assisted_approval=true, conversation stays ai_active (no manual batch)", () => {
  assert.match(inboxSrc, /flow: "approve",\s*\n\s*assistedApproval: true/);
  assert.match(inboxSrc, /const res = await sendProductCards\(cardsToSend, \{ assistedApproval: true, suppressToast: true \}\)/);
  assert.match(inboxSrc, /product_disposition: disposition,\s*\n\s*selection_semantics: suggestionSelectionSemantics/);
  assert.match(inboxSrc, /isVariantOptionsSuggestion \? "variant_options_batch" : "recommendation_batch"/);
});

test("22/23/24: the existing FE-sequential per-card sender + channel-specific delivery are reused unchanged", () => {
  assert.match(inboxSrc, /const recommendationCards = isMultiSelectSuggestion \? suggestionRecommendationCards : \[\]/);
  assert.match(inboxSrc, /const cardsToSend = recommendationCards\.length \? recommendationCards : \(card \? \[card\] : \[\]\)/);
  // one request per card, own idempotency key, variant identity carried to the provider layer
  assert.match(inboxSrc, /for \(const card of cards\) \{[\s\S]*?product_cards: \[card\],[\s\S]*?client_request_id: cardRequestId/);
  assert.match(inboxSrc, /variant_id: card\.variant_id \?\? card\.variantId \?\? null/);
  // channel formats untouched
  assert.match(inboxSrc, /if \(ch\.includes\("messenger"\) \|\| ch === "facebook"\) return \{ labelKey: "aiSupport\.inbox\.ui\.fmtRichCard"/);
  assert.match(inboxSrc, /if \(ch\.includes\("whatsapp"\)\) return \{ labelKey: "aiSupport\.inbox\.ui\.fmtImageLink"/);
  assert.match(inboxSrc, /if \(ch\.includes\("instagram"\)\) return \{ labelKey: "aiSupport\.inbox\.ui\.fmtTextLink"/);
});

// ================= 25-30 — FAILURE, LIFECYCLE, SAFETY =================
test("25: partial failure is reported honestly per option (never claims a failed colour was sent)", () => {
  const summary = summarizeSendResults([{ key: "39:901", ok: true }, { key: "39:904", ok: true }, { key: "39:903", ok: false }]);
  assert.deepEqual(summary, { total: 3, sent: 2, failed: 1 });
  assert.equal(variantSendOutcomeText(summary), "تم إرسال 2 من 3 اختيارات — فشل إرسال اختيار واحد");
  assert.match(inboxSrc, /الرد اتبعت — \$\{variantSendOutcomeText\(cardSummary\)\}/);
});

test("26: no duplicate provider sends — one request per selected option, double-click guarded", () => {
  assert.match(inboxSrc, /if \(sendingProductCardsRef\.current\) return \{ ok: false, results: \[\], summary: \{ total: 0, sent: 0, failed: 0 \}, busy: true \}/);
  assert.match(inboxSrc, /if \(!result\?\.ok\) return;/); // failed/stale text never sends the options
});

test("27/28/29: completion clears the selection; tombstone + new source_message_id prevent resurrection", () => {
  assert.match(inboxSrc, /setSuggestionRecommendationCards\(\[\]\);\s*\n\s*\/\/ Phase 13 — a completed assisted approval CONSUMES the draft/);
  assert.match(inboxSrc, /const completedTombstone = \{ status: "sent", text: "", source_message_id: suggestionSourceId/);
  assert.match(inboxSrc, /const draftCompleted = \["sent", "cleared"\]\.includes/);
  assert.match(inboxSrc, /setSuggestionRecommendationCards\(\[\]\);[\s\S]*?\}, \[activeAiSuggestionKey\]\)/);
});

test("30: nothing autonomous — the gate only labels semantics; every send needs the operator's approval", () => {
  assert.match(gateSrc, /const variantOptionsMode = decision\.action === "color_choice_required"/);
  assert.match(gateSrc, /colorChoiceProductIds\.length === 1/);
  assert.doesNotMatch(gateSrc, /sendProductCards|autoSend|auto_send/);
});
