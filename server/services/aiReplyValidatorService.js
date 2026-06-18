const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();

const toNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const normalizeSize = (value = "") => lower(value).replace(/\s+/g, "").replace(/size|مقاس|مقاس:/g, "");
const normalizeColor = (value = "") => lower(value).replace(/\s+/g, "");

const extractPriceMentions = (reply = "") => {
  const value = text(reply);
  const matches = [];
  const patterns = [
    /(?:egp|le|l\.?e\.?|جنيه|جنية|ج\.?م\.?)/gi,
    /(?:\$|€|£)\s*\d+(?:[.,]\d+)?/g,
    /\d+(?:[.,]\d+)?\s*(?:egp|le|l\.?e\.?|جنيه|جنية|ج\.?م\.?|أسعار?|سعر)/gi,
  ];

  for (const pattern of patterns) {
    const found = value.match(pattern) || [];
    matches.push(...found.map((item) => item.trim()));
  }

  const numericMatches = [];
  const numericPattern = /(\d+(?:[.,]\d+)?)/g;
  let match;
  while ((match = numericPattern.exec(value))) {
    numericMatches.push(Number(String(match[1]).replace(",", ".")));
  }

  return {
    mentions: [...new Set(matches)].slice(0, 10),
    numeric_values: numericMatches.filter((item) => Number.isFinite(item)).slice(0, 10),
  };
};

const extractSizes = (reply = "") => {
  const value = lower(reply);
  const sizePatterns = [
    /\b(?:xxs|xs|s|m|l|xl|xxl|xxxl)\b/gi,
    /\b(?:\d{2,3})\b/g,
    /(?:مقاس|size)\s*[:\-]?\s*([a-z0-9./-]+)/gi,
  ];
  const sizes = [];
  for (const pattern of sizePatterns) {
    let match;
    while ((match = pattern.exec(value))) {
      sizes.push(text(match[1] || match[0]).replace(/^(?:مقاس|size)\s*[:\-]?\s*/i, ""));
    }
  }
  return [...new Set(sizes.map(normalizeSize).filter(Boolean))].slice(0, 10);
};

const extractColors = (reply = "") => {
  const value = lower(reply);
  const colorWords = [
    "black", "white", "red", "blue", "green", "yellow", "gray", "grey", "pink", "purple", "orange", "brown",
    "اسود", "أبيض", "ابيض", "احمر", "أحمر", "ازرق", "أزرق", "اخضر", "أخضر", "رمادي", "رصاصي", "بيج", "كحلي",
  ];
  return [...new Set(colorWords.filter((word) => value.includes(lower(word))).map(normalizeColor))].slice(0, 10);
};

const buildViolation = ({ type, severity = "warning", message, evidence = [] }) => ({
  type,
  severity,
  message,
  evidence: asArray(evidence).filter(Boolean).slice(0, 6),
});

const hasAny = (value = "", phrases = []) => phrases.some((phrase) => lower(value).includes(lower(phrase)));

const productFactsText = (facts = {}) =>
  [
    facts?.product_name,
    facts?.brand,
    facts?.category,
    facts?.price,
    asArray(facts?.available_sizes).join(" "),
    asArray(facts?.available_colors).join(" "),
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");

export const validateAiReply = async ({ replyText = "", harness = null } = {}) => {
  const reply = text(replyText);
  const toolContext = harness?.tool_context || {};
  const productFacts = toolContext?.product_facts || null;
  const inventoryFacts = toolContext?.inventory_facts || null;
  const shippingFacts = toolContext?.shipping_facts || null;
  const policyFacts = toolContext?.policy_facts || null;
  const warnings = [];
  const violations = [];

  if (!reply) {
    return {
      is_valid: false,
      confidence: 0,
      violations: [buildViolation({
        type: "empty_reply",
        severity: "error",
        message: "AI reply text is empty.",
      })],
      warnings,
      suggested_action: "regenerate",
    };
  }

  const priceMentions = extractPriceMentions(reply);
  const replySizes = extractSizes(reply);
  const replyColors = extractColors(reply);
  const replyLower = lower(reply);
  const productPrice = toNumber(productFacts?.price, null);
  const availableSizes = asArray(productFacts?.available_sizes).map(normalizeSize).filter(Boolean);
  const availableColors = asArray(productFacts?.available_colors).map(normalizeColor).filter(Boolean);
  const inventorySizes = asArray(inventoryFacts?.available_sizes).map(normalizeSize).filter(Boolean);
  const inventoryColors = asArray(inventoryFacts?.available_colors).map(normalizeColor).filter(Boolean);
  const stockVariants = asArray(inventoryFacts?.variant_stock);
  const codAllowed = Boolean(policyFacts?.payment_rules?.cash_on_delivery_enabled);
  const shippingRulesText = text(shippingFacts?.shipping_rules?.default_shipping_price || shippingFacts?.shipping_rules?.default_provider || "");
  const shippingEtaText = text(shippingFacts?.estimated_delivery?.estimated_delivery_text || "");
  const returnPolicyText = text(policyFacts?.return_policy || "");
  const exchangePolicyText = text(policyFacts?.exchange_policy || "");
  const paymentRulesText = text(policyFacts?.payment_rules?.payment_policy_text || policyFacts?.payment_rules?.payment_methods_text || "");

  if (productPrice != null && priceMentions.numeric_values.length) {
    const mentionedPrice = priceMentions.numeric_values[0];
    if (Number.isFinite(mentionedPrice) && Math.abs(mentionedPrice - productPrice) > Math.max(5, productPrice * 0.08)) {
      violations.push(buildViolation({
        type: "price_mismatch",
        severity: "error",
        message: `Reply mentions price ${mentionedPrice} while product facts say ${productPrice}.`,
        evidence: [priceMentions.mentions[0] || String(mentionedPrice), `product_price=${productPrice}`],
      }));
    }
  }

  if (replySizes.length && (availableSizes.length || inventorySizes.length)) {
    const allowed = new Set([...availableSizes, ...inventorySizes]);
    const invalidSizes = replySizes.filter((size) => size && !allowed.has(size));
    if (invalidSizes.length) {
      violations.push(buildViolation({
        type: "inventory_size_mismatch",
        severity: "error",
        message: `Reply mentions unavailable size(s): ${invalidSizes.join(", ")}.`,
        evidence: invalidSizes,
      }));
    }
  }

  if (replyColors.length && (availableColors.length || inventoryColors.length)) {
    const allowed = new Set([...availableColors, ...inventoryColors]);
    const invalidColors = replyColors.filter((color) => color && !allowed.has(color));
    if (invalidColors.length) {
      violations.push(buildViolation({
        type: "inventory_color_mismatch",
        severity: "error",
        message: `Reply mentions unavailable color(s): ${invalidColors.join(", ")}.`,
        evidence: invalidColors,
      }));
    }
  }

  if (hasAny(replyLower, ["متوفر دائمًا", "available always", "always available", "motoفر دايمًا", "متاح دائمًا"])) {
    violations.push(buildViolation({
      type: "hallucination_signal",
      severity: "warning",
      message: "Reply contains an availability certainty claim that is not guaranteed by facts.",
      evidence: ["always available claim"],
    }));
  }

  if (hasAny(replyLower, ["أكيد", "مضمون", "guaranteed", "surely", "definitely"])) {
    violations.push(buildViolation({
      type: "hallucination_signal",
      severity: "warning",
      message: "Reply contains certainty language that may exceed available facts.",
      evidence: ["certainty language"],
    }));
  }

  if (hasAny(replyLower, ["خصم", "discount", "off", "%"])) {
    const discountFactsAvailable = Boolean(toolContext?.discount_facts || harness?.business_context?.discount_facts);
    if (!discountFactsAvailable && !hasAny(replyLower, ["بدون خصم", "no discount"])) {
      violations.push(buildViolation({
        type: "discount_claim",
        severity: "warning",
        message: "Reply mentions a discount/offer without deterministic discount facts.",
        evidence: ["discount language"],
      }));
    }
  }

  const shippingClaimSignals = [
    "same day", "same-day", "today", "tonight", "24 ساعة", "24 ساعه", "24h", "express", "fast delivery", "شحن فوري",
    "next day", "tomorrow", "بكرة", "فوري",
  ];
  if (hasAny(replyLower, shippingClaimSignals)) {
    const hasSupport = hasAny(shippingEtaText, ["24", "same day", "next day", "express", "فوري", "يوم"]) || hasAny(shippingRulesText, ["same day", "express", "فوري", "يوم"]);
    if (!hasSupport) {
      violations.push(buildViolation({
        type: "shipping_claim",
        severity: "warning",
        message: "Reply promises a shipping speed that is not confirmed by shipping facts.",
        evidence: shippingClaimSignals.filter((signal) => replyLower.includes(lower(signal))).slice(0, 3),
      }));
    }
  }

  if (hasAny(replyLower, ["return", "refund", "exchange", "استرجاع", "استبدال", "مرتجع", "استرداد"])) {
    const replyMentionsGuaranteedReturns = hasAny(replyLower, ["anytime", "always", "بدون شروط", "without conditions", "مفتوح دائمًا", "free return"]);
    const policyText = `${returnPolicyText} ${exchangePolicyText} ${paymentRulesText}`;
    const hasPolicySupport = Boolean(policyText && policyText.length > 10);
    if (replyMentionsGuaranteedReturns && !hasPolicySupport) {
      violations.push(buildViolation({
        type: "policy_claim",
        severity: "warning",
        message: "Reply makes a strong policy claim without matching policy facts.",
        evidence: ["policy language"],
      }));
    }
  }

  if (hasAny(replyLower, ["cash on delivery", "cod", "الدفع عند الاستلام", "عند الاستلام"])) {
    if (!codAllowed) {
      violations.push(buildViolation({
        type: "policy_claim",
        severity: "error",
        message: "Reply claims COD is available while policy facts say otherwise.",
        evidence: ["COD claim"],
      }));
    }
  }

  if (stockVariants.length && hasAny(replyLower, ["in stock", "متوفر", "available"])) {
    const hasInStock = stockVariants.some((variant) => Number(variant?.in_stock ? 1 : variant?.stock ?? 0) > 0);
    if (!hasInStock) {
      violations.push(buildViolation({
        type: "inventory_stock_mismatch",
        severity: "error",
        message: "Reply says the item is available while inventory facts show no stock.",
        evidence: ["in stock claim"],
      }));
    }
  }

  const errorCount = violations.filter((item) => item.severity === "error").length;
  const warningCount = violations.filter((item) => item.severity !== "error").length;
  const confidence = Math.max(0, Math.min(1, 0.96 - (errorCount * 0.18) - (warningCount * 0.07)));

  let suggestedAction = "keep_draft";
  if (errorCount > 0) {
    suggestedAction = "review";
  } else if (warningCount > 0) {
    suggestedAction = "review";
  }

  return {
    is_valid: errorCount === 0,
    confidence: Number(confidence.toFixed(2)),
    violations,
    warnings,
    suggested_action: suggestedAction,
  };
};

export default {
  validateAiReply,
};
