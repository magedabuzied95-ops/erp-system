export const CONVERSATION_RULES = Object.freeze({
  RECENT_HOURS: 24,
  STALE_DAYS: 14,
  MAX_RECOMMENDED_PRODUCTS: 5,
  MAX_SUMMARY_BULLETS: 5,
  HOT_LEAD_SCORE: 75,
  HIGH_PRIORITY_SCORE: 65,
  MEDIUM_PRIORITY_SCORE: 35,
  MIN_CONFIDENCE: 25,
});

/**
 * Word boundaries that work in both scripts.
 *
 * Every pattern in this file was written as /\b(price|...|سعر)\b/i. JavaScript's \b is
 * defined over ASCII word characters, so it cannot match at the edge of an Arabic
 * word: the English alternatives fired and the Arabic ones never did. These rules
 * drive intent labels, buying signals and objection detection for a store whose
 * customers write Arabic, so the Arabic half of every list was decoration.
 *
 * The old "Size Inquiry" rule read `| مقاس|مقاس` — the same word twice, once with a
 * leading space. That is someone noticing the matches were failing and padding the
 * pattern until one stuck, rather than the boundary being the cause. With a real
 * boundary the duplicate is unnecessary.
 */
const boundary = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");

/** Anchored at the start, for rules that only count when they open the message. */
const leading = (alternatives: string) =>
  new RegExp(`^(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");

export const INTENT_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["Price Inquiry", boundary("price|cost|how much|كام|بكام|سعر|السعر|اسعار")],
  ["Size Inquiry", boundary("size|fit|مقاس|المقاس|مقاسات")],
  ["Availability", boundary("available|availability|stock|in stock|متاح|متوفر|موجود|عندكم")],
  ["Delivery", boundary("delivery|shipping|arrive|توصيل|شحن|الشحن")],
  // Verb forms as well as the noun: customers write "عايز استبدل", not "عايز استبدال".
  ["Exchange", boundary("exchange|replace|swap|استبدال|استبدل|ابدل|بدل|تبديل|ارجاع|ارجع|استرجاع")],
  ["Complaint", boundary("complaint|problem|broken|damaged|bad service|شكوى|شكوي|اشتكي|مشكلة|مشكله|تالف|نصاب|نصابين|مش راضي")],
  ["Payment", boundary("payment|pay|card|cash|installment|دفع|فيزا|كاش|تقسيط")],
  ["Order Tracking", boundary("track|tracking|where.*order|order status|تتبع|تراك|طلبي فين|الاوردر فين")],
  ["Purchase Ready", boundary("buy|order now|take it|send invoice|confirm order|اشتري|اطلب|أكد الطلب|اكد الطلب|هاخده")],
  ["Greeting", leading("hi|hello|hey|good (morning|evening)|السلام|مرحبا|اهلا|أهلا")],
  ["Spam", boundary("free money|crypto giveaway|click here|work from home")],
  ["Support", boundary("help|support|issue|not working|مساعدة|مساعده|دعم|مش شغال")],
];

export const BUYING_SIGNAL_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["Asked price", boundary("price|cost|how much|سعر|السعر|كام|بكام")],
  ["Asked size", boundary("size|fit|مقاس|المقاس")],
  ["Asked colors", boundary("colou?rs?|shade|لون|اللون|ألوان|الوان")],
  ["Asked payment", boundary("payment|pay|card|cash|installment|دفع|فيزا|كاش|تقسيط")],
  ["Asked shipping", boundary("delivery|shipping|arrive|توصيل|شحن|الشحن")],
  ["Asked availability", boundary("available|stock|in stock|متاح|متوفر|موجود")],
  ["Asked invoice", boundary("invoice|payment link|فاتورة|فاتوره|لينك دفع")],
  ["Asked discount", boundary("discount|offer|best price|خصم|عرض|تخفيض")],
];

export const OBJECTION_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["Price", boundary("expensive|too much|cheaper|high price|غالي|غالية|غاليه|أرخص|ارخص")],
  ["Trust", boundary("trust|original|authentic|scam|ضمان|أصلي|اصلي|موثوق|تقليد|مضروب")],
  ["Delivery", boundary("late|slow delivery|delivery time|تأخير|تاخير|متأخر|متاخر")],
  ["Availability", boundary("out of stock|unavailable|مش موجود|غير متاح|خلص")],
  ["Payment", boundary("payment failed|card declined|cannot pay|الدفع فشل|مش عارف ادفع")],
  ["Size", boundary("no size|wrong size|doesn't fit|المقاس مش موجود|مقاس غلط")],
  ["Color", boundary("no colou?rs?|wrong colou?rs?|اللون مش موجود|لون غلط")],
];

export const normalizeConversation = (messages: Array<{ text?: string; message?: string; content?: string }>) =>
  messages.map((item) => String(item.text || item.message || item.content || "").trim()).filter(Boolean).join(" \n");
