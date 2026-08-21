/*
 * Display names for the analysis layer's verdicts.
 *
 * The engines emit canonical English labels — "Price Sensitive", "Ready To Buy",
 * "Asked discount" — and those labels are DATA, not copy. The learning engine
 * keys feedback on them, the decision rules branch on them, and the tests assert
 * them. Translating them at the source would quietly break all three.
 *
 * So they are translated here, at the render boundary, and only here. The panel
 * shows Arabic to an Arabic operator while the engines keep speaking one
 * language to each other.
 *
 * Unmapped labels fall back to the raw English rather than rendering a key: a
 * new rule should look untranslated, not broken. tests/ai-inbox-analysis-labels
 * fails when a label the engines can actually emit has no translation, so the
 * fallback stays a safety net rather than the normal case.
 */

const slug = (label = "") =>
  String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const analysisLabelKey = (group, label) => `aiSupport.inbox.analysis.labels.${group}.${slug(label)}`;

/**
 * Translate one engine label. `t` is the caller's translation function; the raw
 * label is the fallback so an untranslated verdict is still readable.
 */
export const translateAnalysisLabel = (t, group, label) => {
  const raw = String(label ?? "").trim();
  if (!raw) return "";
  return t(analysisLabelKey(group, raw), { defaultValue: raw });
};

export const translateAnalysisLabels = (t, group, labels = []) =>
  (Array.isArray(labels) ? labels : []).map((label) => translateAnalysisLabel(t, group, label));

/*
 * The closed sets the engines can emit, mirrored from conversationTypes.ts and
 * conversationRules.ts. The test asserts this mirror against the real sources,
 * so a new intent or mood cannot ship without a translation.
 */
export const ANALYSIS_LABEL_GROUPS = Object.freeze({
  intent: ["Price Inquiry", "Size Inquiry", "Availability", "Delivery", "Exchange", "Complaint", "Payment", "Order Tracking", "Purchase Ready", "Greeting", "Spam", "Support"],
  signal: ["Asked price", "Asked size", "Asked colors", "Asked payment", "Asked shipping", "Asked availability", "Asked invoice", "Asked discount"],
  objection: ["Price", "Trust", "Delivery", "Availability", "Payment", "Size", "Color"],
  mood: ["Happy", "Neutral", "Confused", "Urgent", "Angry", "Excited", "Price Sensitive"],
  priority: ["Low", "Medium", "High", "Critical"],
  stage: ["New Lead", "Interested", "Comparing", "Negotiating", "Ready To Buy", "Purchased", "Returning Customer", "Support", "Lost"],
});
