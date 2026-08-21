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
/*
 * Arabic letter folding, applied to BOTH the text and the patterns.
 *
 * The same word is written several ways and customers use all of them: أرجع and
 * ارجع, مشكلة and مشكله, ىعنى and يعني, with or without diacritics. The rules
 * below tried to cope by hand-listing variants — "أرخص|ارخص", "أصلي|اصلي",
 * "مشكلة|مشكله" — which works only for the variants somebody happened to think
 * of. "ارجاع|ارجع" has no أرجع, so a customer writing "عايز أرجع المنتج" matched
 * no exchange rule at all.
 *
 * Folding once removes the whole class: every pattern needs one spelling, and a
 * spelling nobody anticipated still matches. Both sides must be folded, or a
 * pattern containing أ or ة would stop matching folded text.
 *
 * Understanding only. Never fold text that will be rendered — this is the same
 * rule the backend normaliser carries.
 */
const ARABIC_FOLD: ReadonlyArray<[RegExp, string]> = [
  [/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, ""], // diacritics
  [/ـ/g, ""],                                          // tatweel
  [/[أإآٱ]/g, "ا"],                // أ إ آ ٱ -> ا
  [/ة/g, "ه"],                                    // ة -> ه
  [/ى/g, "ي"],                                    // ى -> ي
  [/ؤ/g, "و"],                                    // ؤ -> و
  [/ئ/g, "ي"],                                    // ئ -> ي
  [/ء/g, ""],                                          // bare hamza
];

export const foldArabic = (value: string): string =>
  ARABIC_FOLD.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ""));

/*
 * The Arabic definite article, allowed for but not required.
 *
 * "توصيل" and "التوصيل" are the same word, and \p{L} counts the ل of ال as a
 * letter, so the lookbehind rejected the definite form. The rules coped the
 * usual way — "سعر|السعر", "شحن|الشحن", "مقاس|المقاس" — and the entries nobody
 * doubled simply never matched: "التوصيل بكام؟" registered as a price question
 * with no delivery intent at all.
 *
 * Only ال is handled. Egyptian customers also attach و/ف/ب/ل/ك ("بالتوصيل"), but
 * stripping single letters starts matching fragments of unrelated words, and
 * guessing wrong here is worse than missing a match. A real stemmer is the
 * answer if that becomes the limiting factor.
 */
/*
 * Attached object pronouns, allowed for the same reason as the article.
 *
 * Arabic attaches the object to the verb: a customer asks to exchange something
 * by writing "عايز أستبدله", not "عايز أستبدل". The trailing ه is a letter, so
 * the boundary rejected it and an exchange request read as a size question —
 * a customer asking for a return, filed as a browser.
 *
 * The list is closed and short on purpose. Anything longer starts matching the
 * tails of unrelated words, and a false intent is worse than a missed one:
 * intents drive priority.
 */
const PRONOUN_SUFFIX = "(?:ه|ها|هم|هن|هما|ك|كم|كن|ي|نا)?";

const boundary = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:ال)?(?:${foldArabic(alternatives)})${PRONOUN_SUFFIX}(?![\\p{L}\\p{N}])`, "iu");

/** Anchored at the start, for rules that only count when they open the message. */
const leading = (alternatives: string) =>
  new RegExp(`^(?:ال)?(?:${foldArabic(alternatives)})(?![\\p{L}\\p{N}])`, "iu");

/** Shared with analyzeMood so both use one boundary definition. */
export const arabicAwareBoundary = boundary;

export const INTENT_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["Price Inquiry", boundary("price|cost|how much|كام|بكام|سعر|السعر|اسعار")],
  ["Size Inquiry", boundary("size|fit|مقاس|المقاس|مقاسات")],
  ["Availability", boundary("available|availability|stock|in stock|متاح|متوفر|موجود|عندكم")],
  ["Delivery", boundary("delivery|shipping|arrive|توصيل|شحن|الشحن")],
  // Verb forms as well as the noun: customers write "عايز استبدل", not "عايز استبدال".
  ["Exchange", boundary("exchange|replace|swap|استبدال|استبدل|ابدل|بدل|تبديل|ارجاع|ارجع|استرجاع")],
  /*
   * Complaints rarely contain the word "شكوى". They describe what went wrong:
   * the order is late, nobody answered, the item arrived broken. Detection
   * matters more here than anywhere else in this file — analyzePriority only
   * reaches Critical for a Complaint or Payment intent, so a complaint that is
   * not recognised is an angry customer sorted below a browser.
   */
  ["Complaint", boundary("complaint|problem|broken|damaged|bad service|no one replied|still waiting|شكوى|شكوي|اشتكي|مشكلة|مشكله|تالف|نصاب|نصابين|مش راضي|اتاخر|اتاخرت|متاخر|متاخره|التاخير|مردش|مردتش|محدش رد|مفيش رد|مستني من|زهقت|وحش|مش عاجبني|سيئ|سيء")],
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
  // Verb forms as well as the noun, for the same reason the Exchange intent
  // carries them: a customer writes "الأوردر اتأخر", not "الأوردر متأخر".
  ["Delivery", boundary("late|slow delivery|delivery time|تأخير|تاخير|متأخر|متاخر|اتأخر|اتاخر|اتأخرت|اتاخرت|متاخره|لسه مجاش|لسه ماجاش")],
  ["Availability", boundary("out of stock|unavailable|مش موجود|غير متاح|خلص")],
  ["Payment", boundary("payment failed|card declined|cannot pay|الدفع فشل|مش عارف ادفع")],
  ["Size", boundary("no size|wrong size|doesn't fit|المقاس مش موجود|مقاس غلط")],
  ["Color", boundary("no colou?rs?|wrong colou?rs?|اللون مش موجود|لون غلط")],
];

/*
 * The message array is not trustworthy.
 *
 * The inbox merges rows from WhatsApp, Messenger, Instagram, Telegram and an
 * Evolution chat-list import, then layers optimistic bubbles on top. A hole in
 * any of those — a row that failed to normalise, a placeholder that was spliced
 * out — leaves a null in the array, and reading `.text` off it threw. That took
 * the conversation engine down, and the decision engine with it, because it
 * depends on the result. So the whole analysis panel went blank for exactly the
 * conversations with the messiest history.
 */
export const normalizeConversation = (messages: Array<{ text?: string; message?: string; content?: string } | null | undefined>) =>
  foldArabic(
    (Array.isArray(messages) ? messages : [])
      .map((item) => (item && typeof item === "object" ? String(item.text || item.message || item.content || "").trim() : ""))
      .filter(Boolean)
      .join(" \n")
  );
