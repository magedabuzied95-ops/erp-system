const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const SALES_CONVERSATION_STATES = Object.freeze({
  greeting: "greeting",
  discovery: "discovery",
  recommendation: "recommendation",
  comparison: "comparison",
  objection: "objection",
  buying: "buying",
  checkout: "checkout",
  orderCreated: "order_created",
  handoff: "handoff",
});

const normalizeArabic = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (value = "", terms = []) => {
  const normalized = normalizeArabic(value);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
};

const unique = (items = [], limit = 10) =>
  [...new Set(asArray(items).map(text).filter(Boolean))].slice(0, limit);

const productCount = (response = {}) =>
  asArray(response.suggested_products).length + asArray(response.product_cards).length + asArray(response.channel_reply?.product_cards).length;

const selectedProducts = (response = {}) =>
  unique([
    ...asArray(response.suggested_products),
    ...asArray(response.product_cards),
    ...asArray(response.channel_reply?.product_cards),
  ].map((product) => product?.id || product?.product_id || product?.name || product?.title)).length;

const explicitSize = (message = "") => {
  const match = text(message).match(/(?:\u0645\u0642\u0627\u0633|size|sz)?\s*\b(3[5-9]|4[0-9]|5[0-2]|xs|s|m|l|xl|xxl)\b/i);
  return match?.[1]?.toUpperCase() || "";
};

const explicitBudget = (message = "") =>
  /(?:budget|\u0645\u064a\u0632\u0627\u0646\u064a\u0647|\u0645\u064a\u0632\u0627\u0646\u064a\u0629|\u0641\u064a \u062d\u062f\u0648\u062f|\u0644\u062d\u062f|\u062a\u062d\u062a|\u0627\u0642\u0644 \u0645\u0646|\u0623\u0642\u0644 \u0645\u0646)\s*\d{2,7}/i.test(message);

const explicitColor = (message = "") =>
  hasAny(message, [
    "black", "white", "red", "blue", "green", "beige", "grey", "gray", "brown",
    "\u0627\u0633\u0648\u062f", "\u0623\u0633\u0648\u062f", "\u0627\u0628\u064a\u0636", "\u0623\u0628\u064a\u0636", "\u0627\u062d\u0645\u0631", "\u0627\u0632\u0631\u0642", "\u0627\u062e\u0636\u0631", "\u0628\u064a\u062c", "\u0631\u0645\u0627\u062f\u064a", "\u0628\u0646\u064a",
  ]);

const explicitGender = (message = "") =>
  hasAny(message, ["men", "mens", "women", "womens", "ladies", "kids", "\u0631\u062c\u0627\u0644\u064a", "\u062d\u0631\u064a\u0645\u064a", "\u062d\u0631\u064a\u0645\u0649", "\u0628\u0646\u0627\u062a\u064a", "\u0627\u0637\u0641\u0627\u0644", "\u0648\u0644\u0627\u062f\u064a"]);

const explicitStyle = (message = "") =>
  hasAny(message, [
    "running", "runner", "casual", "daily", "sport", "training", "gym", "street", "outfit",
    "\u0631\u0627\u0646\u0646\u062c", "\u062c\u0631\u064a", "\u0643\u0627\u062c\u0648\u0627\u0644", "\u064a\u0648\u0645\u064a", "\u0631\u064a\u0627\u0636\u0647", "\u0631\u064a\u0627\u0636\u0629", "\u062e\u0631\u0648\u062c", "\u062e\u0631\u0648\u062c\u0627\u062a",
  ]);

const explicitModel = (message = "") =>
  hasAny(message, [
    "jordan 4", "air jordan 4", "jordan four", "aj4", "j4", "shox", "air force", "dunk", "samba", "gazelle", "yeezy",
    "\u062c\u0648\u0631\u062f\u0646 4", "\u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631", "\u0634\u0648\u0643\u0633", "\u0627\u064a\u0631 \u0641\u0648\u0631\u0633", "\u062f\u0627\u0646\u0643",
  ]);

const explicitBrandOnly = (message = "") => {
  if (explicitModel(message)) return false;
  return hasAny(message, ["nike", "adidas", "puma", "reebok", "new balance", "jordan", "\u0646\u0627\u064a\u0643", "\u0627\u062f\u064a\u062f\u0627\u0633", "\u062c\u0648\u0631\u062f\u0646"]);
};

const broadProductRequest = (message = "") => {
  if (explicitModel(message)) return false;
  const normalized = normalizeArabic(message);
  if (explicitBrandOnly(message)) return true;
  return [
    "\u0639\u0627\u064a\u0632 \u0634\u0648\u0632",
    "\u0639\u0627\u0648\u0632 \u0634\u0648\u0632",
    "\u0639\u0646\u062f\u0643 \u0643\u0648\u062a\u0634\u064a\u0627\u062a",
    "\u0639\u0646\u062f\u0643\u0645 \u0643\u0648\u062a\u0634\u064a\u0627\u062a",
    "\u0639\u0627\u064a\u0632 \u062d\u0627\u062c\u0647 \u062d\u0644\u0648\u0647",
    "\u0639\u0627\u064a\u0632 \u062d\u0627\u062c\u0629 \u062d\u0644\u0648\u0629",
    "\u0639\u0627\u064a\u0632 \u062d\u0627\u062c\u0647 \u062e\u0631\u0648\u062c",
    "\u0639\u0627\u064a\u0632 \u062d\u0627\u062c\u0629 \u062e\u0631\u0648\u062c",
    "\u0639\u0646\u062f\u0643 \u0631\u062c\u0627\u0644\u064a",
    "\u0639\u0646\u062f\u0643\u0645 \u0631\u062c\u0627\u0644\u064a",
    "want shoes",
    "need shoes",
  ].some((term) => normalized.includes(normalizeArabic(term)));
};

const buyingIntent = (message = "") =>
  hasAny(message, [
    "\u0627\u062d\u062c\u0632", "\u0627\u062d\u062c\u0632\u0647", "\u0627\u062d\u062c\u0632\u0647\u0648\u0644\u064a", "\u0627\u0637\u0644\u0628", "\u0627\u0639\u0645\u0644 \u0627\u0648\u0631\u062f\u0631", "\u0647\u0627\u062e\u062f\u0647", "\u0647\u0627\u062e\u062f\u0647\u0627", "\u0627\u0628\u0639\u062a\u0647", "\u062a\u0645\u0627\u0645 \u0627\u062d\u062c\u0632",
    "order", "reserve", "checkout", "buy", "send it", "i'll take it",
  ]);

const yesOnly = (message = "") =>
  /^(?:\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|yes|yep|ok|okay|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a)$/i.test(normalizeArabic(message));

const objectionIntent = (message = "") =>
  hasAny(message, ["\u063a\u0627\u0644\u064a", "\u063a\u0627\u0644\u064a\u0647", "\u062e\u0635\u0645", "\u0627\u0631\u062e\u0635", "\u0627\u0635\u0644\u064a", "\u0643\u0648\u0628\u064a", "expensive", "discount", "cheaper", "original", "copy"]);

const comparisonIntent = (message = "") =>
  hasAny(message, ["\u0642\u0627\u0631\u0646", "\u0627\u062d\u0633\u0646", "\u0627\u0641\u0636\u0644", "\u0627\u064a\u0647 \u0627\u0644\u0641\u0631\u0642", "\u0648\u0644\u0627", "compare", "better", "difference"]);

const checkoutMissing = (memory = {}) => {
  const preferences = memory?.preferences || {};
  const missing = [];
  if (!text(memory?.customer_name)) missing.push("customer_name");
  if (!text(memory?.customer_phone)) missing.push("customer_phone");
  if (!text(preferences.city_area || preferences.city)) missing.push("area");
  if (!text(preferences.last_address)) missing.push("address");
  return missing;
};

const previousStateFromMemory = (memory = {}) =>
  text(memory?.preferences?.sales_engine_state || memory?.preferences?.conversation_stage || memory?.customer_state || SALES_CONVERSATION_STATES.greeting);

const lastActionFromMemory = (memory = {}) =>
  text(memory?.preferences?.sales_engine_next_action || memory?.preferences?.last_ai_action || memory?.preferences?.pending_action);

const discoveryMissing = ({ message = "", memory = {} } = {}) => {
  const preferences = memory?.preferences || {};
  const missing = [];
  if (!explicitGender(message) && !text(preferences.gender)) missing.push("gender");
  if (!explicitStyle(message) && !text(preferences.favorite_style) && !asArray(preferences.preferred_styles).length) missing.push("style");
  if (!explicitSize(message) && !text(preferences.size)) missing.push("size");
  if (!explicitBudget(message) && !preferences.budget) missing.push("budget");
  return missing;
};

const questionFor = (field) => ({
  gender: "\u0631\u062c\u0627\u0644\u064a \u0648\u0644\u0627 \u062d\u0631\u064a\u0645\u064a\u061f",
  style: "Running \u0648\u0644\u0627 Casual\u061f",
  size: "\u0627\u0644\u0645\u0642\u0627\u0633 \u0643\u0627\u0645\u061f",
  budget: "\u0641\u064a \u062d\u062f\u0648\u062f \u0643\u0627\u0645 \u062a\u0642\u0631\u064a\u0628\u0627\u061f",
}[field] || "");

const buildMemoryPatch = ({ state, action, lastBotMessage = "" } = {}) => ({
  sales_engine_state: state?.next_state || state?.current_state || "",
  sales_engine_previous_state: state?.previous_state || "",
  sales_engine_reason: state?.reason || "",
  sales_engine_next_action: action || state?.recommended_next_action || "",
  last_ai_action: action || state?.recommended_next_action || "",
  pending_action: action || state?.recommended_next_action || "",
  last_bot_message: lastBotMessage,
  sales_engine_missing_info: state?.missing_info || [],
});

export const resolveAiSalesConversationState = ({ message = "", intent = {}, memory = {}, response = {}, order = null } = {}) => {
  const previousState = previousStateFromMemory(memory);
  const lastAction = lastActionFromMemory(memory);
  const hasProducts = productCount(response) > 0 || selectedProducts(response) > 0;
  let currentState = previousState;
  let nextState = currentState;
  let reason = "continue_previous_state";
  let missingInfo = [];
  let recommendedNextAction = "continue";

  if (intent?.type === "greeting_only") {
    currentState = SALES_CONVERSATION_STATES.greeting;
    nextState = SALES_CONVERSATION_STATES.greeting;
    reason = "greeting_only";
    recommendedNextAction = "greet";
  } else if (response?.needs_human_support || intent?.type === "human_support") {
    currentState = previousState;
    nextState = SALES_CONVERSATION_STATES.handoff;
    reason = "human_support_or_handoff";
    recommendedNextAction = "handoff";
  } else if (order?.status === "confirmed" || response?.ai_order?.status === "confirmed") {
    nextState = SALES_CONVERSATION_STATES.orderCreated;
    reason = "order_confirmed";
    recommendedNextAction = "close_order_created";
  } else if (response?.ai_order?.status === "ai_draft" || response?.detected_intent === "order_draft_created") {
    nextState = SALES_CONVERSATION_STATES.orderCreated;
    reason = "order_draft_created";
    recommendedNextAction = "confirm_order";
  } else if (buyingIntent(message) || (yesOnly(message) && ["ask_reserve", "start_checkout"].includes(lastAction))) {
    currentState = SALES_CONVERSATION_STATES.buying;
    nextState = SALES_CONVERSATION_STATES.checkout;
    missingInfo = checkoutMissing(memory);
    reason = yesOnly(message) ? "yes_after_reservation_prompt" : "buying_intent_detected";
    recommendedNextAction = missingInfo.length ? "collect_checkout_fields" : "create_order_draft";
  } else if (yesOnly(message) && lastAction === "ask_size") {
    currentState = SALES_CONVERSATION_STATES.recommendation;
    nextState = SALES_CONVERSATION_STATES.discovery;
    missingInfo = ["size"];
    reason = "yes_after_size_prompt_unclear";
    recommendedNextAction = "ask_size";
  } else if (objectionIntent(message)) {
    currentState = SALES_CONVERSATION_STATES.objection;
    nextState = SALES_CONVERSATION_STATES.objection;
    reason = "objection_detected";
    recommendedNextAction = "handle_objection";
  } else if (comparisonIntent(message)) {
    currentState = SALES_CONVERSATION_STATES.comparison;
    nextState = SALES_CONVERSATION_STATES.comparison;
    reason = "comparison_detected";
    recommendedNextAction = "compare_products";
  } else if (broadProductRequest(message)) {
    missingInfo = discoveryMissing({ message, memory });
    currentState = SALES_CONVERSATION_STATES.discovery;
    nextState = missingInfo.length ? SALES_CONVERSATION_STATES.discovery : SALES_CONVERSATION_STATES.recommendation;
    reason = missingInfo.length ? "broad_product_request_needs_discovery" : "broad_product_request_has_enough_memory";
    recommendedNextAction = missingInfo.length ? "ask_discovery" : "recommend_products";
  } else if (hasProducts) {
    currentState = SALES_CONVERSATION_STATES.recommendation;
    nextState = SALES_CONVERSATION_STATES.recommendation;
    reason = "valid_product_recommendation";
    recommendedNextAction = explicitSize(message) || text(memory?.preferences?.size) ? "ask_reserve" : "ask_size";
    missingInfo = recommendedNextAction === "ask_size" ? ["size"] : [];
  } else if (intent?.type === "product" || intent?.type === "product_discovery") {
    currentState = SALES_CONVERSATION_STATES.recommendation;
    nextState = SALES_CONVERSATION_STATES.recommendation;
    reason = explicitModel(message) ? "explicit_product_search" : "product_intent";
    recommendedNextAction = "recommend_products";
  } else {
    currentState = SALES_CONVERSATION_STATES.discovery;
    nextState = SALES_CONVERSATION_STATES.discovery;
    reason = "general_sales_message";
    recommendedNextAction = "ask_clarification";
  }

  const state = {
    current_state: currentState,
    previous_state: previousState,
    next_state: nextState,
    reason,
    missing_info: missingInfo,
    recommended_next_action: recommendedNextAction,
  };
  console.log("[ai-sales-engine:state]", { message: text(message), ...state });
  return state;
};

export const buildAiSalesDiscoveryResponse = ({ message = "", state = {}, memory = {} } = {}) => {
  if (state.recommended_next_action !== "ask_discovery" && state.recommended_next_action !== "ask_clarification") return null;
  const questions = (state.missing_info || discoveryMissing({ message, memory })).slice(0, 2).map(questionFor).filter(Boolean);
  if (!questions.length) return null;
  const answer = `تمام يا فندم، عشان أطلعلك حاجة مناسبة بجد: ${questions.join(" ")}`;
  console.log("[ai-sales-engine:discovery]", {
    message: text(message),
    missing_info: state.missing_info || [],
    questions,
  });
  return {
    answer,
    confidence: 0.92,
    needs_human_support: false,
    sources_used: [],
    suggested_products: [],
    suggested_actions: ["answer_discovery"],
    detected_intent: "sales_discovery",
    sales_engine: state,
    ai_memory_patch: {
      preferences: buildMemoryPatch({ state, action: "ask_discovery", lastBotMessage: answer }),
    },
    product_cards_blocked: true,
    decision_gate_reason: "broad_request_requires_discovery",
  };
};

export const buildAiSalesCheckoutResponse = ({ state = {} } = {}) => {
  if (state.next_state !== SALES_CONVERSATION_STATES.checkout || state.recommended_next_action !== "collect_checkout_fields") return null;
  const missing = asArray(state.missing_info);
  const answer = missing.includes("customer_name")
    ? "تمام يا فندم، تشرفنا باسم حضرتك؟"
    : missing.includes("customer_phone")
      ? "تمام، ممكن رقم الموبايل للتواصل؟"
      : missing.includes("area")
        ? "تمام، المحافظة والمنطقة إيه عشان أأكد التوصيل؟"
        : missing.includes("address")
          ? "ممكن العنوان بالتفصيل؟"
          : "تمام، هجهز الطلب. ابعتلي أي ملاحظات قبل التأكيد.";
  console.log("[ai-sales-engine:closer]", {
    action: "collect_checkout_fields",
    missing_info: missing,
  });
  return {
    answer,
    confidence: 0.9,
    needs_human_support: false,
    sources_used: [],
    suggested_products: [],
    suggested_actions: ["contact_support"],
    detected_intent: "sales_checkout",
    sales_engine: state,
    ai_memory_patch: {
      preferences: buildMemoryPatch({ state, action: "collect_checkout_fields", lastBotMessage: answer }),
    },
  };
};

export const applyAiSalesCloser = ({ message = "", response = {}, state = {}, memory = {} } = {}) => {
  if (!response || response.greeting_only_mode || response.personalization_blocked) return response;
  if (!productCount(response) && !selectedProducts(response)) return { ...response, sales_engine: state };
  const preferences = memory?.preferences || {};
  const size = explicitSize(message) || text(preferences.size || response.requested_size || response.detected_size);
  const products = [...asArray(response.suggested_products), ...asArray(response.product_cards), ...asArray(response.channel_reply?.product_cards)];
  const top = products[0] || {};
  const stock = Number(top.requested_size_stock ?? top.total_stock ?? top.stock ?? top.inventory_profile?.requested_size_stock ?? 0);
  let answer = text(response.answer);
  let action = state.recommended_next_action;

  if (state.recommended_next_action === "ask_size" && !size) {
    answer = `${answer}\nمقاسك كام يا فندم وأنا أقولك المتاح فورًا؟`.trim();
    action = "ask_size";
  } else if (size && (stock > 0 || top.requested_size_available === true || top.inventory_profile?.requested_size_available === true)) {
    answer = `${answer}\nأيوه مقاس ${size} موجود. تحب أحجزهولك؟`.trim();
    action = "ask_reserve";
  } else if (size && stock <= 0) {
    answer = `${answer}\nهبصلك على أقرب مقاس أو بديل شبهه لو المقاس ده مش متاح.`.trim();
    action = "show_similar_products";
  }

  console.log("[ai-sales-engine:closer]", {
    message: text(message),
    action,
    size: size || "",
    product_count: productCount(response),
  });

  return {
    ...response,
    answer,
    text: answer,
    composer_applied: true,
    sales_engine: state,
    ai_memory_patch: {
      ...(response.ai_memory_patch || {}),
      preferences: {
        ...(response.ai_memory_patch?.preferences || {}),
        ...buildMemoryPatch({ state, action, lastBotMessage: answer }),
      },
    },
  };
};

export const applyAiSalesUpsell = ({ response = {}, state = {} } = {}) => {
  if (!response || response.greeting_only_mode || response.personalization_blocked) return response;
  const addOns = asArray(response.relevant_addons || response.add_ons || response.upsell_products).filter(Boolean);
  if (!addOns.length || !["checkout", "order_created"].includes(state.next_state)) {
    console.log("[ai-sales-engine:upsell]", { skipped: true, reason: !addOns.length ? "no_addons_configured" : "not_buying_stage" });
    return response;
  }
  const addon = addOns[0];
  const addonName = text(addon.name || addon.title || addon.product_name);
  if (!addonName) return response;
  const answer = `${text(response.answer)}\nوممكن أضيفلك ${addonName} لو مناسب مع الطلب.`.trim();
  console.log("[ai-sales-engine:upsell]", { skipped: false, addon: addonName, state: state.next_state });
  return { ...response, answer, text: answer };
};

export const salesEngineMemoryPatch = ({ state = {}, action = "", lastBotMessage = "" } = {}) =>
  buildMemoryPatch({ state, action, lastBotMessage });

export default {
  resolveAiSalesConversationState,
  buildAiSalesDiscoveryResponse,
  buildAiSalesCheckoutResponse,
  applyAiSalesCloser,
  applyAiSalesUpsell,
  salesEngineMemoryPatch,
};
