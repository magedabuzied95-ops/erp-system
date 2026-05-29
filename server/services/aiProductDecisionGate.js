const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp01 = (value) => Math.max(0, Math.min(1, number(value, 0)));

const normalize = (value = "") =>
  lower(value)
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064b-\u065f\u0640]/g, "")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (...items) =>
  normalize(items.flatMap((item) => Array.isArray(item) ? item : [item]).filter(Boolean).join(" "))
    .split(/\s+/)
    .filter(Boolean);

const productBlob = (product = {}) =>
  normalize([
    product.name,
    product.title,
    product.base_name,
    product.slug,
    product.brand,
    product.model,
    product.category,
    product.product_type,
    product.inventory_search_query,
    product.search_text,
    product.visual_search_tags,
    product.image_url,
    product.product_url,
  ].filter(Boolean).join(" "));

const contextBlob = ({ messageText = "", visualQuery = "", visualDetected = {}, metadata = {} } = {}) =>
  normalize([
    messageText,
    visualQuery,
    metadata?.visual_query,
    metadata?.image_search_query,
    visualDetected.product_type,
    visualDetected.category,
    visualDetected.brand_guess,
    visualDetected.brand_family,
    visualDetected.likely_model,
    visualDetected.model_guess,
    visualDetected.model_family,
    visualDetected.model_keywords,
    visualDetected.colors,
    visualDetected.main_colors,
    visualDetected.secondary_colors,
    visualDetected.silhouette,
    visualDetected.silhouette_style,
    visualDetected.high_top_low_top,
    visualDetected.sole_shape,
    visualDetected.features,
    visualDetected.distinctive_features,
    visualDetected.english_keywords,
    visualDetected.arabic_keywords,
  ].flatMap((item) => Array.isArray(item) ? item : [item]).filter(Boolean).join(" "));

const detectModelIntent = (blob = "") => {
  const normalized = normalize(blob);
  if (/\b(jordan\s*4|air\s*jordan\s*4|aj4|j4)\b|جوردن\s*(فور|4|٤)|جوردان\s*(فور|4|٤)/.test(normalized)) {
    return { key: "jordan4", label: "Jordan 4", patterns: [/\bjordan\b/, /\bair jordan\b/, /\baj4\b/, /\bj4\b/, /جوردن|جوردان/] };
  }
  if (/\bshox\b|شوكس|شوكس?/.test(normalized)) {
    return { key: "shox", label: "Shox", patterns: [/\bshox\b/, /شوكس/] };
  }
  if (/\bdunk\b|دانك/.test(normalized)) {
    return { key: "dunk", label: "Dunk", patterns: [/\bdunk\b/, /دانك/] };
  }
  return null;
};

const productMatchesModel = (product = {}, modelIntent = null) => {
  if (!modelIntent) return true;
  const blob = productBlob(product);
  if (modelIntent.key === "jordan4") return /\bjordan\b/.test(blob) && (/\b4\b|\biv\b|\baj4\b|\bj4\b/.test(blob) || /jordan 4|air jordan 4/.test(blob));
  return modelIntent.patterns.some((pattern) => pattern.test(blob));
};

const detectContextFlags = (blob = "") => ({
  lowCasualSkate: /\b(low|lowtop|low top|low profile|flat sole|slim sole|casual|skate|dunk|court|lifestyle)\b|كاجوال|دانك/.test(blob),
  trailRunning: /\b(trail|running|runner|terrex|goretex|gore tex|hiking|outdoor|chunky)\b/.test(blob),
  jordan4: /\b(jordan\s*4|air\s*jordan\s*4|aj4|j4)\b|جوردن\s*(فور|4|٤)|جوردان\s*(فور|4|٤)/.test(blob),
  graphic: /\b(graphic|printed|pattern|side panel|side graphic|comic|cartoon|illustration)\b/.test(blob),
  blackWhite: /\bblack\b/.test(blob) && /\bwhite\b/.test(blob),
});

const scoreProduct = ({ product = {}, ctxBlob = "", flags = {}, modelIntent = null } = {}) => {
  const blob = productBlob(product);
  const breakdown = product.visual_score_breakdown || {};
  const productFlags = {
    lowCasualSkate: /\b(low|lowtop|low top|casual|skate|dunk|court|lifestyle)\b/.test(blob),
    trailRunning: /\b(trail|running|runner|terrex|goretex|gore tex|hiking|outdoor|chunky)\b/.test(blob),
    jordan: /\bjordan\b|جوردن|جوردان/.test(blob),
    jordan4: /\bjordan\b/.test(blob) && (/\b4\b|\biv\b|\baj4\b|\bj4\b|jordan 4|air jordan 4/.test(blob)),
    shox: /\bshox\b|شوكس/.test(blob),
    graphic: /\b(graphic|printed|pattern|side panel|side graphic|comic|cartoon|illustration)\b/.test(blob),
    blackWhite: /\bblack\b/.test(blob) && /\bwhite\b/.test(blob),
  };
  const ctxTokenSet = new Set(tokens(ctxBlob));
  const productTokens = tokens(blob);
  const overlap = productTokens.filter((token) => ctxTokenSet.has(token)).length / Math.max(1, ctxTokenSet.size);
  const modelMatch = productMatchesModel(product, modelIntent);
  const silhouetteScore = clamp01(number(breakdown.silhouette_score, 0) + (flags.lowCasualSkate && productFlags.lowCasualSkate ? 0.55 : 0) + (flags.trailRunning && productFlags.trailRunning ? 0.45 : 0));
  const categoryScore = clamp01(number(breakdown.category_score, 0) + (flags.lowCasualSkate && productFlags.lowCasualSkate ? 0.35 : 0));
  const colorScore = clamp01(number(breakdown.color_score, 0) + (flags.blackWhite && productFlags.blackWhite ? 0.35 : 0));
  const brandScore = clamp01(number(breakdown.brand_score, 0) + (modelIntent && modelMatch ? 0.55 : 0));
  const visualMatchScore = clamp01(number(product.visual_confidence_score ?? product.confidence, 0));
  const intentMatchScore = clamp01(overlap + (modelIntent && modelMatch ? 0.45 : 0));
  let confidence = clamp01((intentMatchScore * 0.24) + (visualMatchScore * 0.28) + (silhouetteScore * 0.16) + (colorScore * 0.12) + (categoryScore * 0.1) + (brandScore * 0.1));
  if (modelIntent && modelMatch) confidence = Math.max(confidence, 0.72);
  return {
    intent_match_score: intentMatchScore,
    visual_match_score: visualMatchScore,
    silhouette_score: silhouetteScore,
    color_score: colorScore,
    category_score: categoryScore,
    brand_score: brandScore,
    confidence,
    flags: productFlags,
    model_match: modelMatch,
  };
};

const productRejected = (product = {}, memory = {}) => {
  const id = String(product.product_id || product.id || "");
  const rejectedIds = new Set([
    ...(Array.isArray(memory.rejectedProductIds) ? memory.rejectedProductIds : []),
    ...(Array.isArray(memory.rejectedVisualMatches) ? memory.rejectedVisualMatches : []),
  ].map(String));
  if (id && rejectedIds.has(id)) return true;
  const rejectedModels = Array.isArray(memory.rejectedModelNames) ? memory.rejectedModelNames : [];
  const blob = productBlob(product);
  return rejectedModels.some((model) => normalize(model) && blob.includes(normalize(model)));
};

export const evaluateProductDecisionGate = ({
  productCards = [],
  messageText = "",
  metadata = {},
  memory = {},
  detectedIntent = "",
  allowAlternatives = false,
  limit = 3,
} = {}) => {
  const visualDetected = metadata?.visual_pipeline?.raw_vision_response?.detected || metadata?.visual_detected || {};
  const visualQuery = metadata?.visual_query || metadata?.visual_pipeline?.normalized_visual_query || metadata?.image_search_query || "";
  const ctxBlob = contextBlob({ messageText, visualQuery, visualDetected, metadata });
  const flags = detectContextFlags(ctxBlob);
  const modelIntent = detectModelIntent(ctxBlob);
  const exactMode = Boolean(metadata?.exact_inventory_match || detectedIntent.includes("exact"));
  const alternativesAllowed = Boolean(allowAlternatives || detectedIntent.includes("alternative") || detectedIntent.includes("visual_search") || metadata?.allow_alternatives);
  const hasExactJordan = flags.jordan4 && productCards.some((product) => productMatchesModel(product, { key: "jordan4", patterns: [] }));
  const evaluated = productCards.map((product) => {
    const scores = scoreProduct({ product, ctxBlob, flags, modelIntent });
    let rejectReason = "";
    if (productRejected(product, memory)) rejectReason = "customer_rejected_product_or_model";
    else if (modelIntent && !alternativesAllowed && !scores.model_match) rejectReason = "specific_model_mismatch";
    else if (flags.lowCasualSkate && scores.flags.trailRunning && scores.confidence < 0.92) rejectReason = "low_skate_visual_rejects_trail_running";
    else if (flags.jordan4 && hasExactJordan && !scores.flags.jordan) rejectReason = "jordan4_exact_exists_reject_non_jordan";
    else if (scores.color_score > 0 && scores.silhouette_score < 0.18 && scores.category_score < 0.18) rejectReason = "color_only_match";
    else if (scores.confidence < (exactMode ? 0.18 : alternativesAllowed ? 0.22 : 0.42)) rejectReason = "below_minimum_confidence";
    return {
      product,
      selected: !rejectReason,
      reject_reason: rejectReason,
      scores,
      score_breakdown: {
        ...scores,
        reject_reason: rejectReason,
      },
    };
  });
  let accepted = evaluated.filter((item) => item.selected);
  let decision;
  let introText = "";
  if (exactMode && accepted.length) {
    accepted = accepted.slice(0, 1);
    decision = "exact";
  } else if (modelIntent && accepted.some((item) => item.scores.model_match)) {
    accepted = accepted.filter((item) => item.scores.model_match);
    decision = "strong_model";
  } else if (accepted.length && alternativesAllowed) {
    decision = "medium";
    introText = "مش نفس الموديل بالظبط، بس دي أقرب حاجة شبهه ";
  } else if (!accepted.length) {
    decision = "low";
  } else {
    decision = accepted[0].scores.confidence >= 0.58 ? "medium" : "low";
  }
  if (decision === "low") accepted = [];
  accepted = accepted
    .sort((left, right) => number(right.scores.confidence) - number(left.scores.confidence))
    .slice(0, decision === "exact" ? 1 : Math.max(1, limit));
  const products = accepted.map((item) => ({
    ...item.product,
    intent_match_score: item.scores.intent_match_score,
    visual_match_score: item.scores.visual_match_score,
    silhouette_score: item.scores.silhouette_score,
    color_score: item.scores.color_score,
    category_score: item.scores.category_score,
    brand_score: item.scores.brand_score,
    confidence: item.scores.confidence,
    reject_reason: "",
    decision_gate: item.score_breakdown,
  }));
  return {
    decision,
    shouldSend: products.length > 0,
    introText,
    blockMessage: "محتاج صورة أو اسم أوضح شوية عشان ما أبعتلكش موديل غلط.",
    products,
    evaluated: evaluated.map((item) => ({
      product_id: item.product.product_id || item.product.id || null,
      name: item.product.name || item.product.title || "",
      selected: accepted.includes(item),
      reject_reason: item.reject_reason,
      score_breakdown: item.score_breakdown,
    })),
    modelIntent: modelIntent?.label || "",
    flags,
  };
};
