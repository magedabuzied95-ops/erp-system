export const AI_REPLY_RULE_DEFAULTS = Object.freeze({
  ai_rules_grade_question: true,
  ai_rules_booking_question: false,
  ai_rules_product_link: false,
  ai_rules_cards_intro: "أيوه متاح إن شاء الله 👇",
});

export const normalizeAiReplyRules = (value = {}) => Object.fromEntries(
  Object.entries(AI_REPLY_RULE_DEFAULTS).map(([key, fallback]) => [key,
    typeof fallback === "boolean"
      ? (typeof value[key] === "boolean" ? value[key] : fallback)
      : (typeof value[key] === "string" && value[key].trim() ? value[key].trim().slice(0, 300) : fallback),
  ])
);

export const aiCardsIntro = (rules = {}) => {
  const effective = normalizeAiReplyRules(rules);
  return effective.ai_rules_cards_intro + (effective.ai_rules_booking_question ? "\nتحب أحجزهولك؟" : "");
};

export const appendAiBookingQuestion = (answer, rules = {}) => {
  const line = "تحب أحجزهولك؟";
  if (!normalizeAiReplyRules(rules).ai_rules_booking_question) return answer;
  const withoutQuestion = String(answer).replace(/(?:تحب\s+)?[أا]حجزهولك[؟?]/gu, "").trim();
  return withoutQuestion + "\n" + line;
};

// Only explicit, bounded setting changes reach deterministic templates; other lessons
// remain owner knowledge for the agent. No generated prose replaces template logic.
export const classifyAiRuleLesson = (input = "") => {
  const original = String(input).trim();
  const value = original.normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/[ً-ْ]/g, "").trim();
  const intro = original.match(/(?:غير|غيّر|خلي|اجعل).*(?:السطر|مقدمة|النص).*?(?:الى|إلى|:|يبقى)\s*[«"]([^»"]{1,300})[»"]/);
  if (intro) return { action: "rule", rule_change: { ai_rules_cards_intro: intro[1] }, answer: "السطر فوق الكروت: " + intro[1], explanation: "تغيير نص مقدمة الكروت لهذا المتجر بعد موافقتك فقط." };
  const negative = /متسال|متسالش|ما تسال|لا تسال|متسال|متضيف|متعرض|متحط|ما تضيف|لا تضيف|لا تضف|بدون|بلاش|شيل|احذف|الغ|don't|do not|disable/i.test(value);
  const positive = /اسال|اضف|ضيف|حط|اظهر|اعرض|شغل|فعل|enable|show|add/i.test(value);
  if (!negative && !positive) return null;
  const key = /احجز|حجزهولك|booking/i.test(value) ? "ai_rules_booking_question"
    : /لينك|رابط|product link/i.test(value) ? "ai_rules_product_link"
      : /درج|جريد|مصري.*ميرور|grade/i.test(value) ? "ai_rules_grade_question" : null;
  if (!key) return null;
  const enabled = !negative;
  const label = { ai_rules_booking_question: "سؤال الحجز تحت الكروت", ai_rules_product_link: "رابط المنتج تحت الكروت", ai_rules_grade_question: "السؤال عن درجة المنتج" }[key];
  return { action: "rule", rule_change: { [key]: enabled }, answer: label + ": " + (enabled ? "تشغيل" : "إيقاف"), explanation: "تغيير قاعدة الردود لهذا المتجر بعد موافقتك فقط." };
};
