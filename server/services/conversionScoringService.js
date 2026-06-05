const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const lower = (value = "") => text(value).toLowerCase();

const normalizeArabic = (value = "") =>
  lower(value)
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (value = "", terms = []) => {
  const normalized = normalizeArabic(value);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
};

const explicitSize = (message = "") => {
  const match = text(message).match(/\b(3[5-9]|4[0-9]|5[0-2]|xs|s|m|l|xl|xxl|xxxl)\b/i);
  return match?.[1]?.toUpperCase() || "";
};

const explicitPhoneMissing = (conversation = {}) =>
  !text(conversation.phone || conversation.customer_profile?.phone || conversation.external_customer_id);

const explicitAddressMissing = (conversation = {}) =>
  !text(conversation.customer_profile?.last_address || conversation.customer_profile?.address || conversation.channel_metadata?.address);

const lastActivityAt = (conversation = {}) => conversation.last_message_at || conversation.updated_at || conversation.created_at || null;

const scoreToLevel = (score = 0) => {
  const value = Number(score || 0);
  if (value >= 85) return "very_high";
  if (value >= 65) return "high";
  if (value >= 40) return "medium";
  return "low";
};

const productHasStock = (product = {}) => Number(product.total_stock ?? product.stock ?? product.inventory_profile?.total_stock ?? 0) > 0;

const selectedProduct = (conversation = {}, products = []) =>
  conversation.current_product ||
  conversation.product ||
  conversation.draft_order?.product ||
  asArray(products)[0] ||
  null;

export const scoreConversationConversion = ({ conversation = {}, state = {}, journeyEvents = [], followUp = {}, products = [], memory = {}, message = "" } = {}) => {
  const reasons = [];
  const risk_flags = [];
  let score = 18;

  const latestMessage = text(message || conversation.latest_message_preview || conversation.last_message);
  const selected = selectedProduct(conversation, products);
  const isPaidState = state.current_state === "PAYMENT_PENDING";
  const isDraft = state.current_state === "DRAFT_ORDER" || conversation.draft_orders?.length > 0;
  const isConfirmed = state.current_state === "CONFIRMED_ORDER" || conversation.confirmed_count > 0;
  const hasPriceAsk = hasAny(latestMessage, ["بكام", "السعر", "price", "cost"]);
  const hasSizeAsk = Boolean(explicitSize(latestMessage) || hasAny(latestMessage, ["مقاس", "size", "sz"]));
  const hasImageAsk = hasAny(latestMessage, ["صور", "photo", "image"]);
  const hasAlternativeAsk = hasAny(latestMessage, ["بديل", "بدائل", "ارخص", "similar", "alternative"]);
  const hasObjection = hasAny(latestMessage, ["غالي", "expensive", "discount", "خصم"]);
  const hasPaymentAsk = hasAny(latestMessage, ["الدفع", "payment", "cod", "انستا باي", "instapay", "لينك"]);
  const repeatedConversation = Number(conversation.message_count || asArray(conversation.messages).length) > 6;
  const inactivityHours = Math.max(0, Math.round((Date.now() - new Date(lastActivityAt(conversation) || Date.now()).getTime()) / 36e5));

  if (hasPriceAsk) {
    score += 16;
    reasons.push("Customer asked price");
  }
  if (hasSizeAsk) {
    score += 12;
    reasons.push("Customer asked size");
  }
  if (hasImageAsk) {
    score += 6;
    reasons.push("Customer requested images");
  }
  if (hasAlternativeAsk) {
    score += 5;
    reasons.push("Customer requested alternatives");
  }
  if (isDraft) {
    score += 22;
    reasons.push("Draft order exists");
  }
  if (isPaidState || hasPaymentAsk) {
    score += 18;
    reasons.push("Payment discussion active");
  }
  if (isConfirmed) {
    score += 30;
    reasons.push("Order already confirmed");
  }
  if (text(memory?.previous_orders?.[0]?.id || conversation.customer_profile?.previous_orders?.[0]?.id)) {
    score += 8;
    reasons.push("Previous successful order");
  }
  if (repeatedConversation) {
    score += 4;
    reasons.push("Repeated return to conversation");
  }
  if (explicitSize(latestMessage) || text(conversation.customer_profile?.preferred_size)) {
    score += 7;
    reasons.push("Size signal present");
  }
  if (selected && productHasStock(selected)) {
    score += 10;
    reasons.push("Selected product in stock");
  }

  if (hasObjection) {
    score -= 18;
    risk_flags.push("price_objection");
  }
  if (selected && !productHasStock(selected)) {
    score -= 20;
    risk_flags.push("stock_conflict");
  }
  if (explicitPhoneMissing(conversation)) {
    score -= 10;
    risk_flags.push("phone_missing");
  }
  if (explicitAddressMissing(conversation)) {
    score -= 8;
    risk_flags.push("address_missing");
  }
  if (inactivityHours >= 24) {
    score -= 12;
    risk_flags.push("long_inactivity");
  }
  if (state.current_state === "HUMAN_TAKEOVER" || conversation.needs_human_support === true) {
    score -= 14;
    risk_flags.push("human_takeover_unresolved");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = scoreToLevel(score);
  let recommended_action = "CONTINUE_CONVERSATION";
  if (state.current_state === "PAYMENT_PENDING") recommended_action = "SEND_PAYMENT_LINK";
  else if (explicitPhoneMissing(conversation)) recommended_action = "ASK_FOR_PHONE";
  else if (state.current_state === "DRAFT_ORDER" || isDraft) recommended_action = "FOLLOW_UP_DRAFT";
  else if (score >= 85 && selected && productHasStock(selected)) recommended_action = "DRAFT_ORDER";
  else if (hasObjection) recommended_action = "HANDLE_OBJECTION";
  else if (hasSizeAsk) recommended_action = "ASK_FOR_SIZE";
  else if (hasPriceAsk) recommended_action = "SHOW_PRICE_AND_VALUE";
  else if (inactivityHours >= 24 || followUp?.follow_up_needed) recommended_action = "FOLLOW_UP";

  return {
    score,
    level,
    reasons,
    risk_flags,
    recommended_action,
    inactivity_hours: inactivityHours,
    has_stock: Boolean(selected && productHasStock(selected)),
  };
};

export default {
  scoreConversationConversion,
};
