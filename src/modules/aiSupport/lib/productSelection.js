// Phase 13.4 — Unified multi-product selection primitives, shared by the manual "إرسال منتج" picker and the AI
// recommendation batch. Pure functions only (no React) so the selection math is deterministic and unit-testable.
//
// FOUR selection modes carry different business meaning (the mode is explicit, never inferred from card count):
//   - "multi_manual"          : operator-initiated manual product batch (assisted_approval = false).
//   - "multi_recommendation"  : grounded AI recommendation batch of DIFFERENT products (assisted_approval = true).
//   - "multi_variant_options" : Phase 13.4.1 — grounded VARIANTS (colours) of ONE already-identified product, shown
//                               as available options because the customer asked for a size but no colour. The
//                               operator ticks which colours to show. Same product_id repeats legitimately.
//   - "single_disambiguation" : identity resolution — pick EXACTLY ONE grounded product. Never multi-select.
//
// Selection is keyed by CANONICAL identity (product_id + variant_id), never by name or colour text, so the same
// product/variant can never be selected twice, two similarly-named colours can never collide, and several variants
// of the SAME product are three distinct legitimate selections.

export const MAX_BATCH_PRODUCTS = 5;

export const SELECTION_MODES = Object.freeze({
  MANUAL: "multi_manual",
  RECOMMENDATION: "multi_recommendation",
  VARIANT_OPTIONS: "multi_variant_options",
  DISAMBIGUATION: "single_disambiguation",
});

// Wire values emitted by the grounding gate (send_package.selection_semantics) → canonical selection mode. The
// legacy 13.4 spellings stay accepted so a draft persisted before this phase keeps behaving exactly as it did.
export const selectionModeFromSemantics = (semantics = "") => {
  const s = String(semantics || "").trim();
  if (s === "multi_variant_options") return SELECTION_MODES.VARIANT_OPTIONS;
  if (s === "recommendation" || s === "multi_recommendation") return SELECTION_MODES.RECOMMENDATION;
  if (s === "identity_disambiguation" || s === "single_disambiguation") return SELECTION_MODES.DISAMBIGUATION;
  return "";
};

export const isMultiSelectMode = (mode) =>
  mode === SELECTION_MODES.MANUAL || mode === SELECTION_MODES.RECOMMENDATION || mode === SELECTION_MODES.VARIANT_OPTIONS;

// Canonical selection key. product_id is required; variant_id refines it when a specific variant (colour/size) is
// bound. Falls back across the common field aliases used by picker cards and enriched grounded cards.
export const productSelectionKey = (card = {}) => {
  if (!card || typeof card !== "object") return "";
  const pid = card.product_id ?? card.id ?? card.productId ?? "";
  const vid = card.variant_id ?? card.variantId ?? "";
  const key = `${String(pid).trim()}:${String(vid).trim()}`;
  return key === ":" ? "" : key;
};

export const isSelected = (list = [], card) => {
  const key = productSelectionKey(card);
  return Boolean(key) && list.some((c) => productSelectionKey(c) === key);
};

// Toggle a card in the ordered selection list. Adds to the END (preserving operator selection order), removes on
// re-click, and refuses to exceed `max` (returns blocked:true so the caller can surface the limit message —
// never a silent drop). Duplicate canonical identity can never be added twice.
export const toggleProductSelection = (list = [], card, { max = MAX_BATCH_PRODUCTS } = {}) => {
  const key = productSelectionKey(card);
  if (!key) return { list, blocked: false, removed: false, added: false };
  const exists = list.some((c) => productSelectionKey(c) === key);
  if (exists) {
    return { list: list.filter((c) => productSelectionKey(c) !== key), blocked: false, removed: true, added: false };
  }
  if (list.length >= max) {
    return { list, blocked: true, removed: false, added: false };
  }
  return { list: [...list, card], blocked: false, removed: false, added: true };
};

// After a batch send, keep ONLY the cards whose send failed (partial-failure semantics). `results` is an array of
// { key, ok }. Full success ⇒ [] (selection clears). Total failure ⇒ all failed cards remain. Partial ⇒ only the
// failed cards remain selected, preserving their original order.
export const keepFailedSelections = (selected = [], results = []) => {
  const failedKeys = new Set(results.filter((r) => r && r.ok === false).map((r) => r.key));
  return selected.filter((c) => failedKeys.has(productSelectionKey(c)));
};

export const summarizeSendResults = (results = []) => {
  const total = results.length;
  const sent = results.filter((r) => r && r.ok === true).length;
  const failed = total - sent;
  return { total, sent, failed };
};

// Arabic labels (centralised so UI + tests agree on exact wording).
export const selectedCountText = (n) => {
  if (n <= 0) return "";
  if (n === 1) return "تم تحديد منتج واحد";
  if (n === 2) return "تم تحديد منتجين";
  return `تم تحديد ${n} منتجات`;
};

export const manualSendButtonText = (n) => (n === 1 ? "إرسال المنتج المحدد" : `إرسال المنتجات المحددة (${n})`);

export const assistedSendButtonText = (n) => {
  if (n <= 0) return "اعتماد وإرسال";
  if (n === 1) return "اعتماد وإرسال (منتج واحد)";
  if (n === 2) return "اعتماد وإرسال (منتجين)";
  return `اعتماد وإرسال (${n} منتجات)`;
};

export const maxBatchReachedText = () => `الحد الأقصى ${MAX_BATCH_PRODUCTS} منتجات في الإرسال الواحد`;

// Phase 13.4.1 — variant/colour OPTIONS wording. Same primitives, different noun ("اختيارات" not "منتجات"),
// because the operator is picking colours of one product, not different products.
export const selectedVariantCountText = (n) => {
  if (n <= 0) return "";
  if (n === 1) return "تم تحديد اختيار واحد";
  if (n === 2) return "تم تحديد اختيارين";
  return `تم تحديد ${n} اختيارات`;
};

export const assistedVariantSendButtonText = (n) => {
  if (n <= 0) return "اعتماد وإرسال";
  if (n === 1) return "اعتماد وإرسال (اختيار واحد)";
  if (n === 2) return "اعتماد وإرسال (اختيارين)";
  return `اعتماد وإرسال (${n} اختيارات)`;
};

export const maxVariantBatchReachedText = () => `الحد الأقصى ${MAX_BATCH_PRODUCTS} اختيارات في الإرسال الواحد`;

// Partial/complete send outcome, operator-facing.
export const sendOutcomeText = ({ total, sent, failed }) => {
  if (failed === 0) return sent === 1 ? "تم إرسال المنتج" : `تم إرسال ${sent} منتجات`;
  if (sent === 0) return total === 1 ? "فشل إرسال المنتج" : `فشل إرسال ${total} منتجات`;
  return `تم إرسال ${sent} من ${total} منتجات — فشل إرسال ${failed === 1 ? "منتج واحد" : `${failed} منتجات`}`;
};

// Phase 13.4.1 — same honest per-card accounting, variant/colour wording. Never claims a failed option was sent.
export const variantSendOutcomeText = ({ total, sent, failed }) => {
  if (failed === 0) return sent === 1 ? "تم إرسال الاختيار" : `تم إرسال ${sent} اختيارات`;
  if (sent === 0) return total === 1 ? "فشل إرسال الاختيار" : `فشل إرسال ${total} اختيارات`;
  return `تم إرسال ${sent} من ${total} اختيارات — فشل إرسال ${failed === 1 ? "اختيار واحد" : `${failed} اختيارات`}`;
};
