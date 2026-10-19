import { resolveGovernorateId } from "../../shared/codPolicy.js";

/*
 * Questions about the store itself — the shipping fee, opening the parcel before taking it, and
 * exchange / return — answered from the store's own settings rather than from the product brain.
 *
 * Production, 2026-10-19 (owner's test chat): "بكام الشحن للاسكندرية ؟" was read as a price
 * objection and answered "السعر غير متاح ... contact_support"; "متاح معاينه قبل الاستلام ؟" was read
 * as a size question and told that inspection is NOT available (the store ships Bosta
 * open-package); "متاح استبدال او استرجاع ؟" hit the complaint detector on "استرجاع" and got no
 * reply at all. Pure functions only, so the brain, the escalation detector and the tests share
 * one reading of the message.
 */

const text = (value = "") => String(value ?? "").trim();

export const normalizeStoreFactsText = (value = "") => text(value)
  .toLowerCase()
  .replace(/[ً-ٰٟـ]/g, "")
  .replace(/[أإآٱ]/g, "ا")
  .replace(/ة/g, "ه")
  .replace(/ى/g, "ي")
  .replace(/\s+/g, " ")
  .trim();

// Cities customers name instead of their governorate. Values are the governorates' English
// names, which resolveGovernorateId knows.
const CITY_GOVERNORATE = [
  ["اسكندريه", "Alexandria"],
  ["اسكندريا", "Alexandria"],
  ["اسكندرية", "Alexandria"],
  ["مصر الجديده", "Cairo"],
  ["مدينه نصر", "Cairo"],
  ["التجمع", "Cairo"],
  ["المعادي", "Cairo"],
  ["حلوان", "Cairo"],
  ["الشروق", "Cairo"],
  ["اكتوبر", "Giza"],
  ["الشيخ زايد", "Giza"],
  ["الهرم", "Giza"],
  ["فيصل", "Giza"],
  ["المنصوره", "Dakahlia"],
  ["الزقازيق", "Sharqia"],
  ["العاشر", "Sharqia"],
  ["طنطا", "Gharbia"],
  ["المحله", "Gharbia"],
  ["شبين الكوم", "Monufia"],
  ["بنها", "Qalyubia"],
  ["شبرا الخيمه", "Qalyubia"],
  ["دمنهور", "Beheira"],
  ["الغردقه", "Red Sea"],
  ["شرم الشيخ", "South Sinai"],
  ["العريش", "North Sinai"],
  ["مرسي مطروح", "Matrouh"],
  ["العلمين", "Matrouh"],
  ["بور سعيد", "Port Said"],
];

// "للاسكندريه" ⇒ "اسكندريه", "لدمياط" ⇒ "دمياط", "لكفر الشيخ" ⇒ "كفر الشيخ".
const PLACE_PREFIXES = ["", "لل", "بال", "فال", "وال", "ل", "ب", "ف", "و"];
const resolvePhrase = (words = []) => {
  for (const prefix of PLACE_PREFIXES) {
    if (!words[0].startsWith(prefix) || words[0].length - prefix.length < 3) continue;
    const id = resolveGovernorateId([words[0].slice(prefix.length), ...words.slice(1)].join(" "));
    if (id) return id;
  }
  return "";
};

/** The governorate a message names, as a catalog id ("alexandria"), or "". */
export const extractGovernorateFromMessage = (message = "") => {
  const normalized = normalizeStoreFactsText(message).replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  for (const [city, governorate] of CITY_GOVERNORATE) {
    const pattern = new RegExp(`(^|\\s)(?:لل|بال|فال|ل|ب|في|ف|و)?\\s?${normalizeStoreFactsText(city).replace(/^ال/, "(?:ال)?")}(\\s|$)`, "u");
    if (pattern.test(normalized)) return resolveGovernorateId(governorate);
  }
  const tokens = normalized.split(" ");
  // Two-word names first ("كفر الشيخ", "بني سويف", "البحر الاحمر"), then single words.
  for (const size of [3, 2, 1]) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const id = resolvePhrase(tokens.slice(index, index + size));
      if (id) return id;
    }
  }
  return "";
};

const COMPLAINT_WORDS = /(مشكله|نصب|غلط|زعلان|مضايق|شكوي|بايظ|باظ|مقطوع|عيب|تالف|اتاخر|فلوسي|حرامي|سيء|وحش)/;
const QUESTION_WORDS = /(\?|؟|متاح|ينفع|ممكن|فيه|في |هل|عندكم|عندك|بتعملو|بيتعمل|سياسه|ازاي|ايه|مده|كام يوم|بتقبلو|مسموح|policy|can i|is there|do you)/;

const SHIPPING_WORDS = /(شحن|توصيل|delivery|shipping)/;
const SHIPPING_FEE_WORDS = /(بكام|كام|سعر|مصاريف|مصروف|تكلف|رسوم|فلوس|مجان|ببلاش|cost|price|fee|how much|free)/;
// "الشحن بياخد كام يوم" / "الشحنه فين" are about time or tracking, not the fee.
const SHIPPING_NOT_FEE = /(يوم|ايام|امتي|وقت|مده|فين|وصل|اتشحن|اتأخر|اتاخر|tracking|track)/;

const OPEN_PACKAGE_WORDS = /(معاين|open ?package|inspect|(افتح|يفتح|نفتح|فتح|اشوف|اتفرج)[^\n]{0,30}(قبل|قدام|مع المندوب|وانا باستلم|وقت الاستلام))/;

const EXCHANGE_RETURN_WORDS = /(استبدال|استرجاع|استرداد|ترجيع|تبديل|ابدل|يتبدل|اتبدل|تتبدل|بتبدلو|بترجعو|ارجع(?!ل)|يترجع|مرتجع|ضمان|return|exchange|refund|warranty)/;

/**
 * Which store question the message asks: "shipping_fee", "open_package", "exchange_return" or "".
 * `awaitingGovernorate` is set when the last reply asked "which governorate?", so a bare
 * "اسكندريه" is the answer to it.
 */
export const detectStoreFactsQuestion = (message = "", { awaitingGovernorate = false } = {}) => {
  const normalized = normalizeStoreFactsText(message);
  if (!normalized) return "";
  if (OPEN_PACKAGE_WORDS.test(normalized)) return "open_package";
  if (EXCHANGE_RETURN_WORDS.test(normalized) && !COMPLAINT_WORDS.test(normalized) && QUESTION_WORDS.test(normalized)) return "exchange_return";
  if (SHIPPING_WORDS.test(normalized) && !SHIPPING_NOT_FEE.test(normalized)) {
    if (SHIPPING_FEE_WORDS.test(normalized) || extractGovernorateFromMessage(normalized)) return "shipping_fee";
  }
  if (awaitingGovernorate && normalized.split(" ").length <= 3 && extractGovernorateFromMessage(normalized)) return "shipping_fee";
  return "";
};

/** A question about the exchange / return policy, not a complaint — never escalated for its keyword. */
export const isExchangeReturnPolicyQuestion = (message = "") => detectStoreFactsQuestion(message) === "exchange_return";

export default { detectStoreFactsQuestion, extractGovernorateFromMessage, isExchangeReturnPolicyQuestion, normalizeStoreFactsText };
