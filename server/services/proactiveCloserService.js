const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const productStock = (product = {}) => Number(product.total_stock ?? product.stock ?? product.inventory_profile?.total_stock ?? 0) || 0;
const hasSize = (conversation = {}) => text(conversation.customer_profile?.preferred_size || conversation.channel_metadata?.last_size || conversation.channel_metadata?.selected_size);

export const buildProactiveCloserPlan = ({ conversation = {}, state = {}, score = {}, journeyEvents = [], products = [], followUp = {} } = {}) => {
  const selectedProduct = conversation.current_product || conversation.product || asArray(products)[0] || null;
  const availableSize = hasSize(conversation);
  const inStock = selectedProduct ? productStock(selectedProduct) > 0 : false;
  const reasons = [];
  let recommended_action = "CONTINUE";
  let suggested_message = "";

  if (score?.score >= 80 && inStock && availableSize) {
    recommended_action = "DRAFT_ORDER";
    suggested_message = `تمام يا فندم ❤️ المقاس ${availableSize} متاح، تحب أحجزهولك وأفتح الأوردر؟`;
    reasons.push("high_score_with_size_and_stock");
  } else if (state.current_state === "PRICE_DISCUSSION" && availableSize && inStock) {
    recommended_action = "CLOSE_WITH_ORDER";
    suggested_message = `تمام يا فندم ❤️ السعر واضح والمقاس متاح، تحب أكمّللك الأوردر؟`;
    reasons.push("price_and_size_known");
  } else if (state.current_state === "OBJECTION_HANDLING") {
    recommended_action = "HANDLE_OBJECTION";
    suggested_message = "مفهوم يا فندم ❤️ عندي بدائل قريبة بنفس الشكل والسعر لو تحب.";
    reasons.push("objection_detected");
  } else if (state.current_state === "PAYMENT_PENDING") {
    recommended_action = "SEND_PAYMENT_LINK";
    suggested_message = "تمام يا فندم ❤️ هبعتلك خطوة الدفع دلوقتي أو أرجعها لك لو تحب.";
    reasons.push("payment_pending");
  } else if (state.current_state === "DRAFT_ORDER") {
    recommended_action = "FOLLOW_UP_DRAFT";
    suggested_message = "لسه الحجز مفتوح يا فندم ❤️ تحب أكمّل قبل ما ينتهي؟";
    reasons.push("draft_active");
  } else if (followUp?.follow_up_needed) {
    recommended_action = "FOLLOW_UP";
    suggested_message = followUp.suggested_follow_up_message || "لسه متاح يا فندم ❤️ تحب أكملك من آخر اختيار؟";
    reasons.push("follow_up_needed");
  }

  const last_closer_action = state?.metadata?.last_closer_action || state?.last_closer_action || "";
  const last_closer_at = state?.metadata?.last_closer_at || state?.last_closer_at || "";
  return {
    last_closer_action,
    last_closer_at,
    recommended_action,
    suggested_message,
    reasons,
    should_offer_closer: Boolean(recommended_action !== "CONTINUE"),
  };
};

export default {
  buildProactiveCloserPlan,
};
