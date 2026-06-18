const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);

const truthy = (value) => value === true || value === 1 || value === "1" || value === "true";

const countFacts = (toolContext = {}) => ({
  product: Boolean(toolContext?.product_facts?.product_id || toolContext?.product_facts?.product_name),
  inventory: Boolean(asArray(toolContext?.inventory_facts?.variant_stock).length || asArray(toolContext?.inventory_facts?.available_sizes).length || asArray(toolContext?.inventory_facts?.available_colors).length),
  shipping: Boolean(toolContext?.shipping_facts?.shipping_rules || toolContext?.shipping_facts?.estimated_delivery),
  policy: Boolean(toolContext?.policy_facts?.return_policy || toolContext?.policy_facts?.exchange_policy || toolContext?.policy_facts?.payment_rules),
  order: Boolean(toolContext?.order_facts?.order_id || toolContext?.order_facts?.order_number),
});

const resolveConfidenceIntent = (harness = {}, draft = {}) => {
  const message = lower(harness?.latest_customer_message || draft?.customer_question || draft?.text || "");
  const intent = lower(draft?.detected_intent || harness?.business_context?.sales_state?.intent || harness?.business_context?.sales_intelligence?.intent || "");
  const raw = `${intent} ${message}`;
  if (/greeting|hello|hi|السلام|اهلا|أهلا/.test(raw) || /^(hi|hello|السلام|اهلا|أهلا)$/i.test(message)) return "greeting";
  if (/shipping|delivery|شحن|توصيل/.test(raw)) return "shipping_basic";
  if (/return|exchange|policy|استبدال|استرجاع/.test(raw)) return "return_policy_basic";
  if (/cod|cash on delivery|cash/.test(raw)) return "cod_basic";
  if (/payment|الدفع عند الاستلام|عند الاستلام|طرق الدفع/.test(raw)) return "payment_basic";
  if (/color|colors|colour|colours|لون|الوان|ألوان/.test(raw)) return "colors_basic";
  if (/price|cost|كم|بكام|سعر|غالي|ارخص|objection/.test(raw)) return "price_question";
  if (/size|مقاس|measure|fit|size_check|size_followup/.test(raw)) return "size_followup";
  if (/availability|available|stock|متاح|متوفر|inventory/.test(raw)) return "availability";
  return intent || "";
};

const getIntentProfile = (intent = "") => {
  switch (intent) {
    case "greeting":
      return { bonus: 24, requiredFacts: [], clearBonus: 8, factBonus: {} };
    case "shipping_basic":
      return { bonus: 18, requiredFacts: [], clearBonus: 8, factBonus: {} };
    case "return_policy_basic":
      return { bonus: 18, requiredFacts: [], clearBonus: 8, factBonus: {} };
    case "cod_basic":
    case "payment_basic":
      return { bonus: 18, requiredFacts: [], clearBonus: 8, factBonus: {} };
    case "price_question":
      return { bonus: 16, requiredFacts: ["product"], clearBonus: 8, factBonus: { product: 14 } };
    case "size_followup":
      return { bonus: 16, requiredFacts: ["product", "inventory"], clearBonus: 8, factBonus: { product: 12, inventory: 12 } };
    case "availability":
      return { bonus: 16, requiredFacts: ["product", "inventory"], clearBonus: 8, factBonus: { product: 12, inventory: 12 } };
    case "size_color_request":
    case "colors_basic":
      return { bonus: 18, requiredFacts: [], clearBonus: 8, factBonus: {} };
    default:
      return { bonus: 0, requiredFacts: ["product", "inventory", "shipping", "policy", "order"], clearBonus: 0, factBonus: {} };
  }
};

const detectIntentClarity = ({ harness = {}, draft = {} } = {}, resolvedIntent = "") => {
  const message = lower(harness?.latest_customer_message || draft?.customer_question || draft?.text || "");
  const clearSignals = [
    "price", "ط³ط¹ط±", "ظ…ظ‚ط§ط³", "size", "available", "ظ…طھظˆظپط±", "stock", "ظ…ط®ط²ظˆظ†", "delivery", "ط´ط­ظ†", "return", "ط§ط³طھط±ط¬ط§ط¹",
    "exchange", "ط§ط³طھط¨ط¯ط§ظ„", "order", "ط·ظ„ط¨", "tracking", "طھطھط¨ط¹", "color", "ظ„ظˆظ†", "model", "ظ…ظˆط¯ظٹظ„", "cod", "payment",
  ];
  const genericSignals = [
    "help", "ظ…ط³ط§ط¹ط¯ط©", "please", "ط¹ط§ظٹط²", "ط¹ط§ظˆط²ظ‡", "ط¹ط§ظˆط²ط©", "ظ…ظ…ظƒظ†", "what", "which", "ظپظٹظ†", "ط§ط²ط§ظٹ", "ظƒظٹظپ", "?",
  ];
  const hasClearSignal = clearSignals.some((phrase) => message.includes(phrase));
  const genericCount = genericSignals.filter((phrase) => message.includes(phrase)).length;
  const safeIntent = Boolean(resolvedIntent);
  const ambiguous = safeIntent ? false : message.length < 12 || genericCount >= 3 || (!hasClearSignal && !resolvedIntent);
  return {
    clear: safeIntent || (Boolean(resolvedIntent || hasClearSignal) && !ambiguous),
    ambiguous,
  };
};

const normalizeValidation = (validation = {}) => ({
  violations: asArray(validation?.violations || []),
  warnings: asArray(validation?.warnings || []),
  is_valid: validation?.is_valid !== false,
});

export const buildAiConfidenceEngine = async ({
  harness = null,
  tool_context = null,
  validation = null,
  draft = null,
  correction_context = null,
} = {}) => {
  const safeHarness = harness || {};
  const safeToolContext = tool_context || safeHarness?.tool_context || {};
  const safeValidation = normalizeValidation(validation || draft?.validation || {});
  const safeDraft = draft || {};
  const safeCorrections = correction_context?.corrections || safeHarness?.correction_context?.corrections || [];
  const factFlags = countFacts(safeToolContext);
  const resolvedIntent = resolveConfidenceIntent(safeHarness, safeDraft);
  const intentProfile = getIntentProfile(resolvedIntent);
  const intentState = detectIntentClarity({ harness: safeHarness, draft: safeDraft }, resolvedIntent);
  const requiredFacts = new Set(intentProfile.requiredFacts || []);
  const requiresFact = (name) => requiredFacts.has(name);
  const riskFlags = {
    missing_product_facts: requiresFact("product") ? !factFlags.product : false,
    missing_inventory_facts: requiresFact("inventory") ? !factFlags.inventory : false,
    missing_shipping_facts: requiresFact("shipping") ? !factFlags.shipping : false,
    missing_policy_facts: requiresFact("policy") ? !factFlags.policy : false,
    missing_order_facts: requiresFact("order") ? !factFlags.order : false,
    validator_violations: safeValidation.violations.length,
    validator_warnings: safeValidation.warnings.length,
    hallucination_signals: safeValidation.violations.filter((item) => lower(item?.type || item?.message || "").includes("hallucination")).length,
    ambiguous_customer_request: intentState.ambiguous,
    corrections_found: asArray(safeCorrections).length,
  };

  let score = 50;
  const reasons = [];

  score += intentProfile.bonus;
  if (intentProfile.bonus) {
    reasons.push(`Intent bonus applied for ${resolvedIntent || "unknown"}`);
  }

  if (factFlags.product) {
    score += 14;
    reasons.push("Product facts available");
  } else if (requiredFacts.has("product")) {
    score -= 24;
    reasons.push("Missing product facts");
  }

  if (factFlags.inventory) {
    score += 12;
    reasons.push("Inventory facts available");
  } else if (requiredFacts.has("inventory")) {
    score -= 24;
    reasons.push("Missing inventory facts");
  }

  if (factFlags.shipping) {
    score += 12;
    reasons.push("Shipping facts available");
  } else if (requiredFacts.has("shipping")) {
    score -= 20;
    reasons.push("Missing shipping facts");
  }

  if (factFlags.policy) {
    score += 12;
    reasons.push("Policy facts available");
  } else if (requiredFacts.has("policy")) {
    score -= 20;
    reasons.push("Missing policy facts");
  }

  if (factFlags.order) {
    score += 8;
    reasons.push("Order facts available");
  } else if (requiredFacts.has("order")) {
    score -= 16;
    reasons.push("Missing order facts");
  }

  if (asArray(safeCorrections).length) {
    score += 6;
    reasons.push("Similar corrections found");
  }

  if (safeValidation.violations.length === 0) {
    score += 12;
    reasons.push("Validator has no violations");
  } else {
    const errorCount = safeValidation.violations.filter((item) => lower(item?.severity || "") === "error").length;
    score -= errorCount * 18;
    score -= Math.max(0, safeValidation.violations.length - errorCount) * 6;
    reasons.push("Validator violations present");
  }

  if (safeValidation.warnings.length) {
    score -= Math.min(12, safeValidation.warnings.length * 3);
    reasons.push("Validator warnings present");
  }

  if (intentState.clear) {
    score += intentProfile.clearBonus || 0;
    reasons.push("Customer intent is clear");
  } else {
    score -= 10;
    reasons.push("Customer request is ambiguous");
  }

  if (riskFlags.hallucination_signals > 0) {
    score -= 12;
    reasons.push("Hallucination signals detected");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const confidence_level = score >= 80 ? "high" : score >= 60 ? "medium" : score >= 35 ? "low" : "critical";
  const hasMissingRelevantFacts = requiredFacts.has("product") && !factFlags.product
    || requiredFacts.has("inventory") && !factFlags.inventory
    || requiredFacts.has("shipping") && !factFlags.shipping
    || requiredFacts.has("policy") && !factFlags.policy
    || requiredFacts.has("order") && !factFlags.order;

  let decision = "safe";
  if (score < 35 || (safeValidation.violations.length > 0 && score < 60) || (hasMissingRelevantFacts && requiredFacts.size > 0)) {
    decision = "high_risk";
  } else if (score < 70 || safeValidation.warnings.length > 0 || intentState.ambiguous) {
    decision = "review";
  }

  if (confidence_level === "critical") {
    decision = "high_risk";
  }

  const uniqueReasons = [...new Set(reasons)].slice(0, 8);

  return {
    confidence_score: score,
    confidence_level,
    decision,
    reasons: uniqueReasons,
    risk_flags: {
      ...riskFlags,
      product_facts_available: factFlags.product,
      inventory_facts_available: factFlags.inventory,
      shipping_facts_available: factFlags.shipping,
      policy_facts_available: factFlags.policy,
      order_facts_available: factFlags.order,
      validator_is_valid: safeValidation.is_valid,
      resolved_intent: resolvedIntent,
    },
  };
};

export default {
  buildAiConfidenceEngine,
};
