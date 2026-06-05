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

const lastActivityAt = (conversation = {}) => conversation.last_message_at || conversation.updated_at || conversation.created_at || null;

const suggestedTimeFromHours = (hours = 24) => new Date(Date.now() + Math.max(1, Number(hours) || 24) * 36e5).toISOString();

export const buildFollowUpRecommendation = ({ conversation = {}, state = {}, journeyEvents = [], score = {}, memory = {}, message = "" } = {}) => {
  const latestMessage = text(message || conversation.latest_message_preview || conversation.last_message);
  const inactivityHours = Math.max(0, Math.round((Date.now() - new Date(lastActivityAt(conversation) || Date.now()).getTime()) / 36e5));
  const hasDraft = state.current_state === "DRAFT_ORDER" || conversation.draft_orders?.length > 0;
  const paymentPending = state.current_state === "PAYMENT_PENDING";
  const priceAsked = hasAny(latestMessage, ["بكام", "السعر", "price", "cost"]);
  const sizeAsked = hasAny(latestMessage, ["مقاس", "size", "sz"]);
  const imageRequested = hasAny(latestMessage, ["صور", "photo", "image"]);
  const followUpNeeded = Boolean(
    paymentPending ||
    hasDraft ||
    (priceAsked && inactivityHours >= 2) ||
    (sizeAsked && inactivityHours >= 2) ||
    (imageRequested && inactivityHours >= 2) ||
    score?.score >= 60 && inactivityHours >= 24
  );

  if (!followUpNeeded) {
    return {
      follow_up_needed: false,
      follow_up_reason: "",
      suggested_follow_up_message: "",
      suggested_follow_up_at: "",
      suggested_follow_up_type: "",
    };
  }

  let followUpReason = "normal_product_interest";
  let suggestedMessage = "لسه متاح يا فندم ❤️ تحب أساعدك في المقاس أو أبعثلك التفاصيل؟";
  let suggestedHours = 24;

  if (paymentPending) {
    followUpReason = "payment_pending";
    suggestedMessage = "لسه مستني تأكيدك يا فندم ❤️ تحب أبعتلك لينك الدفع تاني؟";
    suggestedHours = 2;
  } else if (hasDraft) {
    followUpReason = "draft_order_abandoned";
    suggestedMessage = "لسه محجوز ليك يا فندم ❤️ تحب أكمّللك الأوردر قبل ما المقاس يخلص؟";
    suggestedHours = 48;
  } else if (priceAsked) {
    followUpReason = "price_quote_no_reply";
    suggestedMessage = "لسه متاح يا فندم ❤️ تحب أبعثلك تفاصيل أكتر أو بديل أقرب في السعر؟";
    suggestedHours = 2;
  } else if (sizeAsked) {
    followUpReason = "size_missing_reply";
    suggestedMessage = "مقاسك كام يا فندم عشان أطلعلك المتاح المناسب؟";
    suggestedHours = 2;
  } else if (imageRequested) {
    followUpReason = "images_requested_no_reply";
    suggestedMessage = "ابعتلك صور إضافية يا فندم؟";
    suggestedHours = 2;
  } else if (inactivityHours >= 72) {
    followUpReason = "soft_reactivation";
    suggestedMessage = "قولّي تحب أرجعلك بنفس الاختيارات ولا أطلعلك حاجة جديدة قريبة؟";
    suggestedHours = 72;
  }

  return {
    follow_up_needed: true,
    follow_up_reason: followUpReason,
    suggested_follow_up_message: suggestedMessage,
    suggested_follow_up_at: suggestedTimeFromHours(suggestedHours),
    suggested_follow_up_type: paymentPending ? "payment_pending" : hasDraft ? "draft_order" : "interest_followup",
  };
};

export default {
  buildFollowUpRecommendation,
};
