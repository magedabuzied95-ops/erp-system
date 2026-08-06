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

export const INTENT_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["Price Inquiry", /\b(price|cost|how much|كام|سعر)\b/i], ["Size Inquiry", /\b(size|fit| مقاس|مقاس)\b/i],
  ["Availability", /\b(available|availability|stock|in stock|متاح|موجود)\b/i], ["Delivery", /\b(delivery|shipping|arrive|توصيل|شحن)\b/i],
  ["Exchange", /\b(exchange|replace|swap|استبدال|تبديل)\b/i], ["Complaint", /\b(complaint|problem|broken|damaged|bad service|شكوى|مشكلة|تالف)\b/i],
  ["Payment", /\b(payment|pay|card|cash|installment|دفع|فيزا|كاش|تقسيط)\b/i], ["Order Tracking", /\b(track|tracking|where.*order|order status|تتبع|طلبي فين)\b/i],
  ["Purchase Ready", /\b(buy|order now|take it|send invoice|confirm order|اشتري|اطلب|أكد الطلب)\b/i], ["Greeting", /^(hi|hello|hey|good (morning|evening)|السلام|مرحبا|اهلا)\b/i],
  ["Spam", /\b(free money|crypto giveaway|click here|work from home)\b/i], ["Support", /\b(help|support|issue|not working|مساعدة|دعم|مش شغال)\b/i],
];

export const BUYING_SIGNAL_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["Asked price", /\b(price|cost|how much|سعر|كام)\b/i], ["Asked size", /\b(size|fit|مقاس)\b/i], ["Asked colors", /\b(colou?r|shade|لون|ألوان)\b/i],
  ["Asked payment", /\b(payment|pay|card|cash|installment|دفع|فيزا|كاش|تقسيط)\b/i], ["Asked shipping", /\b(delivery|shipping|arrive|توصيل|شحن)\b/i],
  ["Asked availability", /\b(available|stock|in stock|متاح|موجود)\b/i], ["Asked invoice", /\b(invoice|payment link|فاتورة|لينك دفع)\b/i], ["Asked discount", /\b(discount|offer|best price|خصم|عرض)\b/i],
];

export const OBJECTION_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["Price", /\b(expensive|too much|cheaper|high price|غالي|أرخص)\b/i], ["Trust", /\b(trust|original|authentic|scam|ضمان|أصلي|موثوق)\b/i],
  ["Delivery", /\b(late|slow delivery|delivery time|تأخير|متأخر)\b/i], ["Availability", /\b(out of stock|unavailable|مش موجود|غير متاح)\b/i],
  ["Payment", /\b(payment failed|card declined|cannot pay|الدفع فشل|مش عارف ادفع)\b/i], ["Size", /\b(no size|wrong size|doesn't fit|المقاس مش موجود|مقاس غلط)\b/i],
  ["Color", /\b(no colou?r|wrong colou?r|اللون مش موجود|لون غلط)\b/i],
];

export const normalizeConversation = (messages: Array<{ text?: string; message?: string; content?: string }>) =>
  messages.map((item) => String(item.text || item.message || item.content || "").trim()).filter(Boolean).join(" \n");

