const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const NO_RANDOM_PRODUCT_FALLBACK =
  "ما لقيتش نفس الموديل بالضبء لكن أقدر أطلعلك أقرب اختيارات من نفس الستايل أو سعر قريب.";

const normalizeArabicDigits = (value = "") =>
  text(value)
    .replace(/[٠۰]/g, "0")
    .replace(/[١۱]/g, "1")
    .replace(/[٢۲]/g, "2")
    .replace(/[٣۳]/g, "3")
    .replace(/[٤۴]/g, "4")
    .replace(/[٥۵]/g, "5")
    .replace(/[٦۶]/g, "6")
    .replace(/[٧۷]/g, "7")
    .replace(/[٨۸]/g, "8")
    .replace(/[٩۹]/g, "9");

export const normalizeSalesText = (value = "") =>
  normalizeArabicDigits(value)
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (value = "", terms = []) => {
  const normalized = normalizeSalesText(value);
  return terms.some((term) => normalized.includes(normalizeSalesText(term)));
};

const unique = (items = [], limit = 20) =>
  [...new Set(items.map(text).filter(Boolean))].slice(0, limit);

const productBlob = (product = {}) =>
  normalizeSalesText([
    product.name,
    product.title,
    product.product_name,
    product.brand,
    product.brand_name,
    product.model,
    product.category,
    product.category_name,
    product.main_category,
    product.product_type,
    product.style,
    product.grade,
    product.gender,
    product.sku,
    product.slug,
    product.canonical_slug,
    product.search_text,
    product.seo_keywords,
    product.tags,
    ...(Array.isArray(product.variants) ? product.variants.flatMap((variant) => [variant.color, variant.size, variant.name, variant.sku]) : []),
  ].filter(Boolean).join(" "));

const colorsFromText = (value = "") => {
  const normalized = normalizeSalesText(value);
  const colors = [];
  const checks = [
    ["black", ["black", "اسود", "بلاك"]],
    ["white", ["white", "ابيض", "وايت"]],
    ["red", ["red", "احمر"]],
    ["blue", ["blue", "ازرق", "بلو"]],
    ["green", ["green", "اخضر", "جرين"]],
    ["grey", ["gray", "grey", "رمادي", "جراي"]],
    ["beige", ["beige", "بيج", "cream", "كريمي"]],
    ["brown", ["brown", "بني"]],
  ];
  for (const [color, aliases] of checks) {
    if (aliases.some((alias) => normalized.includes(normalizeSalesText(alias)))) colors.push(color);
  }
  return unique(colors, 6);
};

const styleFromText = (value = "") => {
  const normalized = normalizeSalesText(value);
  const styles = [];
  if (hasAny(normalized, ["basketball", "high top", "retro", "chunky", "streetwear", "جوردن", "هايتوب", "هاي توب"])) {
    styles.push("basketball", "high_top", "retro", "streetwear");
  }
  if (hasAny(normalized, ["running", "runner", "trail", "جري", "راننج"])) styles.push("running");
  if (hasAny(normalized, ["casual", "daily", "كاجوال", "يومي"])) styles.push("casual");
  if (hasAny(normalized, ["skate", "dunk", "دانك"])) styles.push("skate");
  return unique(styles, 8);
};

export const detectSalesProductUnderstanding = ({ message = "", memory = {}, source = "message" } = {}) => {
  const normalized = normalizeSalesText(message);
  const memoryText = [
    memory?.lastProductQuery,
    memory?.lastVisualQuery,
    memory?.lastVisualQueryText,
    memory?.activeTopic,
    memory?.selectedProductName,
    memory?.lastProductCard?.name,
    memory?.lastProductCard?.brand,
    memory?.lastProductCard?.category,
    memory?.lastProductCard?.product_type,
  ].filter(Boolean).join(" ");
  const contextNeeded = hasAny(normalized, ["ده", "دا", "this", "موجود", "مقاس", "بدائل", "بديل", "شبه", "زيه"]);
  const combined = contextNeeded && memoryText ? `${message} ${memoryText}` : message;
  const combinedNormalized = normalizeSalesText(combined);

  let requestedBrand = "";
  let requestedModelFamily = "";
  if (/\u062c\u0648\u0631\u062f\u0646\s*(4|\u0664|\u0641\u0648\u0631)|\u0627\u064a\u0631\s*\u062c\u0648\u0631\u062f\u0646\s*(4|\u0664|\u0641\u0648\u0631)/i.test(combinedNormalized)) {
    requestedBrand = "jordan";
    requestedModelFamily = "air_jordan_4";
  }
  if (/جوردن\s*(4|٤|فور)|اير\s*جوردن\s*(4|٤|فور)/i.test(combinedNormalized)) {
    requestedBrand = "jordan";
    requestedModelFamily = "air_jordan_4";
  }
  if (/(^|\s)(air\s*)?jordan\s*(4|four|iv)(\s|$)|(^|\s)(aj\s*4|aj4|j\s*4|j4|retro\s*4)(\s|$)|جوردن\s*(4|فور)/i.test(combinedNormalized)) {
    requestedBrand = "jordan";
    requestedModelFamily = "air_jordan_4";
  } else if (hasAny(combinedNormalized, ["jordan", "جوردن"])) {
    requestedBrand = "jordan";
    requestedModelFamily = "jordan";
  } else if (hasAny(combinedNormalized, ["nike", "نايك"])) {
    requestedBrand = "nike";
  } else if (hasAny(combinedNormalized, ["adidas", "اديداس"])) {
    requestedBrand = "adidas";
  }

  const requestedColors = colorsFromText(combined);
  const requestedStyle = styleFromText(combined);
  const imageContext = Boolean(memory?.lastImageUrl || memory?.lastVisualQuery || memory?.lastVisualQueryText);
  const specific =
    Boolean(requestedBrand || requestedModelFamily || requestedColors.length || requestedStyle.length || imageContext) &&
    (Boolean(requestedModelFamily) || contextNeeded || hasAny(normalized, ["model", "موديل", "ستايل", "style", "صوره", "صورة"]));

  const understanding = {
    intent: specific ? "specific_product_request" : "general_product_request",
    requested_brand: requestedBrand,
    requested_model_family: requestedModelFamily,
    requested_colors: requestedColors,
    requested_style: requestedStyle,
    source: contextNeeded && memoryText ? "conversation_memory" : source,
    requires_relevance_gate: specific,
    image_context: imageContext,
  };
  console.log("[ai-orchestrator:understanding]", {
    intent: understanding.intent,
    requested_brand: understanding.requested_brand,
    requested_model_family: understanding.requested_model_family,
    requested_colors: understanding.requested_colors,
    source: understanding.source,
  });
  return understanding;
};

const categoryOf = (product = {}) => {
  const blob = productBlob(product);
  if (/\b(running|runner|trail|terrex)\b|جري|راننج/.test(blob)) return "running";
  if (/\b(sneaker|shoe|shoes|basketball|jordan|dunk|air force|shox)\b|جوردن|كوتشي|شوز|جزمه/.test(blob)) return "sneaker";
  if (/\b(slipper|slides|sandal|crocs)\b|شبشب|صندل|كروكس/.test(blob)) return "slides";
  if (/\b(bag|backpack)\b|شنطه/.test(blob)) return "bag";
  return "";
};

const brandOf = (product = {}) => {
  const blob = productBlob(product);
  if (/\bjordan\b|جوردن/.test(blob)) return "jordan";
  if (/\bnike\b|نايك/.test(blob)) return "nike";
  if (/\badidas\b|اديداس/.test(blob)) return "adidas";
  return lower(product.brand || product.brand_name);
};

const modelFamilyOf = (product = {}) => {
  const blob = productBlob(product);
  if (/(^|\s)(air\s*)?jordan\s*(4|four|iv)(\s|$)|(^|\s)(aj\s*4|aj4|j\s*4|j4|retro\s*4)(\s|$)|جوردن\s*(4|فور)/i.test(blob)) {
    return "air_jordan_4";
  }
  if (/\bjordan\b|جوردن/.test(blob)) return "jordan";
  if (/\bshox\b|شوكس/.test(blob)) return "nike_shox";
  if (/\bdunk\b|دانك/.test(blob)) return "nike_dunk";
  if (/\bair\s*force|af1\b|اير فورس/.test(blob)) return "nike_air_force";
  return lower(product.model || "");
};

export const scoreProductRelevance = ({ product = {}, understanding = {}, fallback = false } = {}) => {
  if (!understanding?.requires_relevance_gate) {
    return {
      score: 100,
      confidence: 1,
      reasons: ["general_request"],
      strong_reason_count: 1,
      rejected_reason: "",
    };
  }
  const blob = productBlob(product);
  const reasons = [];
  let score = 0;
  const requestedFamily = understanding.requested_model_family || "";
  const productFamily = modelFamilyOf(product);
  const requestedBrand = understanding.requested_brand || "";
  const productBrand = brandOf(product);
  const requestedColors = understanding.requested_colors || [];
  const requestedStyles = understanding.requested_style || [];
  const productCategory = categoryOf(product);
  const stock = number(product.total_stock ?? product.stock ?? product.available_stock, 0);

  if (requestedFamily && productFamily === requestedFamily) {
    score += 45;
    reasons.push("model_family_match");
  } else if (requestedFamily === "air_jordan_4" && productFamily === "jordan") {
    score += 28;
    reasons.push("same_jordan_family");
  } else if (requestedFamily) {
    score -= 20;
    reasons.push("model_family_mismatch");
  }

  if (requestedBrand && productBrand === requestedBrand) {
    score += 18;
    reasons.push("brand_match");
  } else if (requestedBrand === "jordan" && productBrand === "nike") {
    score += 8;
    reasons.push("parent_brand_match");
  } else if (requestedBrand) {
    score -= 12;
    reasons.push("brand_mismatch");
  }

  const matchedColors = requestedColors.filter((color) => blob.includes(color) || hasAny(blob, [color]));
  if (requestedColors.length && matchedColors.length) {
    score += Math.min(14, matchedColors.length * 7);
    reasons.push("color_match");
  } else if (requestedColors.length) {
    score -= 4;
    reasons.push("color_mismatch");
  }

  if (productCategory === "sneaker") {
    score += 10;
    reasons.push("category_match");
  } else if (productCategory) {
    score -= 24;
    reasons.push("different_category");
  }

  if (requestedFamily === "air_jordan_4") {
    const jordanLike = /basketball|high\s*top|retro|streetwear|chunky|jordan|air\s*jordan|اجوردن|جوردن|هاي/.test(blob);
    if (jordanLike) {
      score += 16;
      reasons.push("jordan_like_silhouette");
    } else {
      score -= 18;
      reasons.push("silhouette_mismatch");
    }
  } else if (requestedStyles.length) {
    const styleMatches = requestedStyles.filter((style) => blob.includes(style.replace("_", " ")));
    if (styleMatches.length) {
      score += 12;
      reasons.push("style_match");
    } else {
      score -= 8;
      reasons.push("style_mismatch");
    }
  }

  if (understanding.image_context || product.is_visual_search_match || product.image_match_breakdown || product.matched_visual_candidate) {
    const visualScore = number(product.visual_confidence_score || product.image_match_confidence || product.image_match_breakdown?.final_score, 0);
    score += Math.min(14, Math.round(visualScore * 14));
    reasons.push("visual_similarity_context");
  }

  if (stock > 0) {
    score += 10;
    reasons.push("in_stock");
  } else {
    score -= 20;
    reasons.push("out_of_stock");
  }

  const priceDistance = number(product.price_distance || product.price_delta_ratio, 0);
  if (priceDistance > 0 && priceDistance <= 0.25) {
    score += 4;
    reasons.push("close_price");
  } else if (priceDistance > 0.6) {
    score -= 6;
    reasons.push("far_price");
  }

  let rejectedReason = "";
  if (requestedFamily === "air_jordan_4" && productCategory === "running") {
    rejectedReason = "running_shoe_not_valid_jordan4_alternative";
  } else if (productCategory && productCategory !== "sneaker" && requestedFamily) {
    rejectedReason = "different_category";
  } else if (score < 65) {
    rejectedReason = "score_below_65";
  } else if (fallback && !reasons.some((reason) => ["model_family_match", "same_jordan_family", "brand_match", "jordan_like_silhouette", "visual_similarity_context", "style_match"].includes(reason))) {
    rejectedReason = "fallback_without_relevance_explanation";
  }

  const finalScore = Math.max(0, Math.min(100, score));
  const strongReasons = reasons.filter((reason) => [
    "model_family_match",
    "same_jordan_family",
    "brand_match",
    "parent_brand_match",
    "category_match",
    "jordan_like_silhouette",
    "visual_similarity_context",
    "style_match",
    "color_match",
    "in_stock",
  ].includes(reason));
  return {
    score: finalScore,
    confidence: finalScore / 100,
    reasons,
    strong_reason_count: strongReasons.length,
    rejected_reason: rejectedReason,
  };
};

export const gateRelevantProducts = ({ products = [], understanding = {}, limit = 3, fallback = false } = {}) => {
  const scored = (Array.isArray(products) ? products : []).map((product) => {
    const result = scoreProductRelevance({ product, understanding, fallback });
    console.log("[ai-orchestrator:score]", {
      product_id: product.id || product.product_id || null,
      name: product.name || product.title || "",
      score: result.score,
      reasons: result.reasons,
      rejected_reason: result.rejected_reason,
    });
    return {
      ...product,
      relevance_score: result.score,
      relevance_confidence: result.confidence,
      relevance_reasons: result.reasons,
      reasons: result.reasons,
      confidence: result.confidence,
      strong_reason_count: result.strong_reason_count,
      rejected_reason: result.rejected_reason,
      reject_reason: result.rejected_reason,
      score_breakdown: {
        ...(product.score_breakdown || {}),
        score: result.score,
        confidence: result.confidence,
        reasons: result.reasons,
        strong_reason_count: result.strong_reason_count,
        reject_reason: result.rejected_reason,
      },
    };
  });
  const selected = scored
    .filter((product) => !product.rejected_reason)
    .sort((left, right) => number(right.relevance_score, 0) - number(left.relevance_score, 0))
    .slice(0, Math.max(1, Number(limit) || 3));
  console.log("[ai-orchestrator:decision]", {
    decision_type: selected.length ? "send_relevant_products" : "no_random_fallback",
    selected_product_ids: selected.map((product) => product.id || product.product_id).filter(Boolean),
    no_random_fallback: !selected.length && Boolean(understanding?.requires_relevance_gate),
  });
  return selected;
};

export const relevanceExplanationAr = (product = {}, understanding = {}) => {
  const reasons = Array.isArray(product.relevance_reasons) ? product.relevance_reasons : [];
  if (understanding?.requested_model_family === "air_jordan_4") {
    if (reasons.includes("model_family_match")) return "ده نفس موديل الجوردن فور ومتاح عندنا.";
    if (reasons.includes("same_jordan_family") || reasons.includes("jordan_like_silhouette")) {
      return "ده أقرب بديل لأنه نفس ستايل الجوردن فور وألوانه قريبة.";
    }
  }
  if (reasons.includes("visual_similarity_context")) return "ده أقرب اختيار بصريًا من اللي عندنا للصورة أو المنتج اللي بنتكلم عليه.";
  if (reasons.includes("style_match")) return "ده قريب من نفس الستايل اللي طلبته.";
  return "ده أقرب اختيار متاح لأنه قريب من طلبك في الستايل والمقاس.";
};
