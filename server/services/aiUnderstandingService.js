/**
 * Understanding pass — one structured read of the customer's message BEFORE any
 * search, composition, or routing happens.
 *
 * What it replaces: `resolveIntent` (aiIntentResolver.js) is 23 lines of
 * `text.includes()` over five buckets. It cannot see that "عايز حاجة كاجوال لأخويا
 * هدية، ميزانيتي 1500" is a gift, for someone else, with a budget — it returns
 * "GENERAL". Every downstream decision (which products to search, what tone to use,
 * whether to escalate, whether it is safe to auto-send) inherits that blindness.
 *
 * Design rules this follows, because the rest of the AI stack depends on them:
 *
 * 1. It NEVER decides facts. It reads the customer, not the catalog. Product
 *    identity, price and stock stay with the grounding gate.
 * 2. It NEVER throws. Every failure path returns a valid, deterministic
 *    understanding so callers can use the shape unconditionally.
 * 3. It stays backward compatible: `legacy_intent` always carries one of the five
 *    values the existing enum uses, so current callers keep working untouched.
 * 4. It is off by default (AI_UNDERSTANDING_ENABLED). Dormant, the service returns
 *    the deterministic reading — i.e. exactly today's behaviour.
 */
import { normalizeArabicIntentPayload, normalizeArabicForIntent } from "../utils/arabicTextNormalizer.js";
import { extractShoeSize } from "./aiMessageExtractors.js";
import { detectEscalation } from "./aiEscalationDetector.js";
import { resolveIntent } from "./aiIntentResolver.js";
import {
  getSharedOpenAiClient,
  isTextGenerationAvailable,
  resolveFastModel,
} from "./openaiSupportService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const envFlagEnabled = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_MESSAGE_CHARS = 1_200;
const MAX_HISTORY_TURNS = 6;
const CACHE_MAX_ENTRIES = 500;

export const PRIMARY_INTENTS = Object.freeze([
  "greeting",
  "product_discovery",
  "product_availability",
  "price_question",
  "size_question",
  "color_question",
  "image_request",
  "comparison",
  "objection",
  "buying_intent",
  "order_status",
  "shipping_question",
  "return_or_exchange",
  "complaint",
  "restock_request",
  "human_handoff",
  "smalltalk",
  "other",
]);

export const FUNNEL_STAGES = Object.freeze([
  "browsing",
  "comparing",
  "objecting",
  "ready_to_buy",
  "post_purchase",
  "complaint",
]);

export const OBJECTION_TYPES = Object.freeze([
  "none",
  "price_high",
  "quality_doubt",
  "authenticity_doubt",
  "shipping_cost",
  "shipping_time",
  "size_risk",
  "trust",
]);

/**
 * Bridge to the five-value enum the existing pipeline reads. Anything that is not
 * clearly one of the legacy buckets falls to GENERAL, which is what the old resolver
 * would have produced anyway — so nothing downstream regresses.
 */
const LEGACY_INTENT_BY_PRIMARY = Object.freeze({
  greeting: "GREETING",
  product_availability: "AVAILABILITY_INQUIRY",
  restock_request: "AVAILABILITY_INQUIRY",
  size_question: "SIZE_INQUIRY",
  price_question: "PRICE_INQUIRY",
  objection: "PRICE_INQUIRY",
});

const understandingSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "primary_intent",
    "secondary_intents",
    "entities",
    "funnel_stage",
    "sentiment",
    "urgency",
    "formality",
    "objection",
    "refers_to_previous",
    "requires_human",
    "confidence",
  ],
  properties: {
    primary_intent: { type: "string", enum: [...PRIMARY_INTENTS] },
    secondary_intents: {
      type: "array",
      maxItems: 3,
      items: { type: "string", enum: [...PRIMARY_INTENTS] },
    },
    entities: {
      type: "object",
      additionalProperties: false,
      required: [
        "product_model",
        "category",
        "brand",
        "color",
        "size",
        "quantity",
        "budget_max",
        "occasion",
        "recipient",
        "city",
      ],
      properties: {
        product_model: { type: ["string", "null"], description: "Model/name exactly as the customer said it" },
        category: { type: ["string", "null"] },
        brand: { type: ["string", "null"] },
        color: { type: ["string", "null"] },
        size: { type: ["string", "null"] },
        quantity: { type: ["integer", "null"], minimum: 1, maximum: 99 },
        budget_max: { type: ["number", "null"], minimum: 0 },
        occasion: { type: ["string", "null"], description: "e.g. gift, wedding, gym, school" },
        recipient: { type: ["string", "null"], description: "Who it is for, when not the customer" },
        city: { type: ["string", "null"] },
      },
    },
    funnel_stage: { type: "string", enum: [...FUNNEL_STAGES] },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    urgency: { type: "string", enum: ["low", "normal", "high"] },
    formality: { type: "string", enum: ["casual", "neutral", "formal"] },
    objection: { type: "string", enum: [...OBJECTION_TYPES] },
    refers_to_previous: {
      type: "object",
      additionalProperties: false,
      required: ["is_followup", "target"],
      properties: {
        is_followup: { type: "boolean" },
        target: {
          type: ["string", "null"],
          description: "What a pronoun like 'ده' points at: product | size | color | order | null",
        },
      },
    },
    requires_human: { type: "boolean" },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["intent", "entities"],
      properties: {
        intent: { type: "number", minimum: 0, maximum: 1 },
        entities: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  },
};

const INSTRUCTIONS = [
  "You read one customer message from an Egyptian online store and describe what the customer means.",
  "You are a reader, not a salesperson. Never write a reply, never name a product from your own knowledge, never state a price or stock.",
  "The conversation is Egyptian Arabic dialect, sometimes mixed with English or franco-Arabic (Arabic typed in Latin letters).",
  "Read the recent turns to resolve references. If the customer says 'ده' or 'هو' or 'نفسه', decide what it points at and set refers_to_previous.",
  "A message can carry more than one intent. Put the one that must be answered first in primary_intent and the rest in secondary_intents.",
  "A greeting is only the primary intent when the message contains nothing else. 'السلام عليكم عندكم كروكس؟' is product_availability.",
  "product_model is what the CUSTOMER called it, copied verbatim — do not correct spelling, translate it, or map it to a catalog name.",
  "Set entities to null when the customer did not say them. Never guess a size, colour, budget or city.",
  "budget_max is a number in EGP. 'في حدود 1500' is 1500. 'رخيص' is not a number, leave it null.",
  "urgency is high only on an explicit time pressure such as 'محتاجها النهاردة' or 'ضروري'.",
  "formality describes how the CUSTOMER writes, so the reply can mirror it.",
  "requires_human is true only for an explicit request for a person, a refund or money dispute, or an angry complaint.",
  "sentiment negative means the customer is unhappy with us, not merely that they said a product is expensive — that is objection price_high.",
  "confidence is your own certainty, and low confidence is useful information. Do not inflate it.",
].join("\n");

const understandingEnabled = () => envFlagEnabled(process.env.AI_UNDERSTANDING_ENABLED);
const understandingTimeoutMs = () => positiveNumber(process.env.AI_UNDERSTANDING_TIMEOUT_MS, 8_000);
const cacheTtlMs = () => positiveNumber(process.env.AI_UNDERSTANDING_CACHE_TTL_MS, 15 * 60 * 1000);

/**
 * Bounded LRU-ish cache. The same question arrives constantly ("بكام؟", "متاح؟"), and
 * re-reading it costs a model call each time. Keyed on the normalized message plus the
 * conversation tail, because the same words mean different things after different turns.
 */
const cache = new Map();

const cacheKey = ({ normalizedMessage, historySignature, activeProductId }) =>
  `${normalizedMessage}|${historySignature}|${activeProductId || ""}`;

const readCache = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  // Refresh recency so hot keys survive eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

const writeCache = (key, value) => {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + cacheTtlMs() });
};

export const clearUnderstandingCache = () => cache.clear();

const emptyEntities = () => ({
  product_model: null,
  category: null,
  brand: null,
  color: null,
  size: null,
  quantity: null,
  budget_max: null,
  occasion: null,
  recipient: null,
  city: null,
});

const legacyIntentFor = (primaryIntent, fallbackMessage) =>
  LEGACY_INTENT_BY_PRIMARY[primaryIntent] || resolveIntent(fallbackMessage);

/**
 * The deterministic reading. This is what the pipeline had before, expressed in the
 * new shape: keyword intent, regex size, keyword escalation. It is the fallback for
 * every failure path AND the value returned when the feature flag is off, so turning
 * the flag off is a true no-op rather than a degraded mode.
 */
/**
 * Egyptian-Arabic cues per intent, most specific first.
 *
 * Order is the whole design. "الأوردر بتاعي رقم 4412 وصل فين؟" contains both an order
 * reference and a shipping word; whichever rule is tested first wins, so order_status
 * has to precede shipping_question. The same applies to restock before size, and
 * return/exchange before size — each of those pairs shares vocabulary.
 */
const DETERMINISTIC_INTENT_RULES = Object.freeze([
  ["human_handoff", /(اكلم|أكلم|كلم)\s*(حد|حدا|موظف|شخص|واحد)|موظف|خدمه العملاء|خدمة العملاء|بشري|حد من|customer service|talk to (a )?(human|agent|person)/i],
  ["order_status", /(اوردر|أوردر|طلب|اردر|order)[^؟?]{0,24}(فين|وصل|اتشحن|حالته|حالة|رقم)|وصل فين|فين طلبي|تراك|تتبع|track/i],
  ["return_or_exchange", /استبدال|ابدل|أبدل|بدل|ارجع|أرجع|مرتجع|استرجاع|ترجيع|فلوسي|refund|return|exchange/i],
  ["restock_request", /بلغني|ابلغني|أبلغني|عرفني|ينزل تاني|هينزل|هيتوفر|لما ي(نزل|توفر)|notify|restock|back in stock/i],
  ["shipping_question", /شحن|الشحن|توصيل|التوصيل|يوصل|هيوصل|مندوب|delivery|shipping/i],
  ["image_request", /صور|صوره|صورة|بص|شكلها|شكله|فيديو|photo|picture|image/i],
  ["comparison", /الفرق بين|ايه احسن|أيه أحسن|مقارنه|مقارنة|ولا|أفضل من|احسن من|compare|difference between/i],
  ["objection", /غالي|غاليه|غالية|كتير اوي|كتير أوي|ارخص|أرخص|تقليد|مضروب|مش اصلي|مش أصلي|خصم|expensive|cheaper|discount/i],
  ["buying_intent", /هاخده|هاخدها|هاخد|تمام هاخد|ابعتهولي|ابعتهالي|اطلبه|أطلبه|اكد|أكد|اوردرلي|عايز اشتري|هشتري|i'?ll take it|order it/i],
  ["color_question", /لون|الوان|ألوان|اللون|colou?rs?/i],
  ["size_question", /مقاس|مقاسات|المقاس|size|sizes/i],
  ["price_question", /بكام|كام|السعر|سعر|بيتباع بكام|price|how much/i],
  ["product_availability", /عندكم|عندك|متوفر|متاح|موجود|موجوده|موجودة|فيه|in stock|available/i],
  ["product_discovery", /عايز|عاوز|عايزه|عايزة|محتاج|محتاجه|بدور|أدور|ادور|رشحلي|اقترح|هديه|هدية|looking for|suggest|recommend/i],
  ["complaint", /نصاب|نصابين|زباله|زبالة|وحش اوي|مستني من|بقالي\s*(اسبوع|يوم|شهر)|زعلان|متضايق|هرفع قضيه|هبلغ|scam|terrible|awful/i],
  // Anchored rules are matched against the raw and normalized forms separately —
  // see ANCHORED_INTENTS.
]);

/**
 * Rules that must see the message alone, not the raw+normalized haystack the unanchored
 * rules use. `^`/`$` are meaningless against a concatenation of two spellings of the
 * same sentence, which is why "السلام عليكم" was reading as `other`.
 *
 * No `\b` anywhere in here: JavaScript's word boundary is ASCII-based, so it never
 * fires between an Arabic letter and a space and silently defeats the whole pattern.
 */
const ANCHORED_INTENTS = Object.freeze([
  ["greeting", /^\s*(السلام عليكم|سلام عليكم|اهلا|أهلا|هاي|هلا|مساء الخير|صباح الخير|ازيك|إزيك|hi|hello|hey)/i],
  ["smalltalk", /^\s*(شكرا|شكرن|متشكر|ميرسي|تسلم|ربنا يكرمك|thanks|thank you|ok|تمام)(\s+(ليك|ليكي|جدا|اوي|جزيلا))?\s*[!.؟?]*\s*$/i],
]);

/** Cheap entity reads that do not need a model. Wrong-but-confident is worse than null. */
const EGYPT_CITIES = Object.freeze([
  ["القاهره", "القاهرة"], ["القاهرة", "القاهرة"], ["اسكندريه", "الإسكندرية"], ["اسكندرية", "الإسكندرية"],
  ["الاسكندريه", "الإسكندرية"], ["الاسكندرية", "الإسكندرية"], ["الجيزه", "الجيزة"], ["الجيزة", "الجيزة"],
  ["المنصوره", "المنصورة"], ["المنصورة", "المنصورة"], ["طنطا", "طنطا"], ["اسيوط", "أسيوط"],
  ["المنيا", "المنيا"], ["الفيوم", "الفيوم"], ["بورسعيد", "بورسعيد"], ["السويس", "السويس"],
  ["دمياط", "دمياط"], ["الاقصر", "الأقصر"], ["اسوان", "أسوان"], ["الغردقه", "الغردقة"], ["الغردقة", "الغردقة"],
]);

const COLOR_WORDS = Object.freeze([
  ["اسود", "أسود"], ["أسود", "أسود"], ["ابيض", "أبيض"], ["أبيض", "أبيض"], ["احمر", "أحمر"], ["أحمر", "أحمر"],
  ["ازرق", "أزرق"], ["أزرق", "أزرق"], ["اخضر", "أخضر"], ["أخضر", "أخضر"], ["اصفر", "أصفر"],
  ["بني", "بني"], ["رمادي", "رمادي"], ["بيج", "بيج"], ["وردي", "وردي"], ["بمبي", "وردي"], ["نبيتي", "نبيتي"],
]);

const OCCASION_WORDS = Object.freeze([
  ["هديه", "هدية"], ["هدية", "هدية"], ["فرح", "فرح"], ["جواز", "زفاف"], ["عيد", "عيد"],
  ["شغل", "شغل"], ["مدرسه", "مدرسة"], ["مدرسة", "مدرسة"], ["جامعه", "جامعة"], ["رياضه", "رياضة"], ["جري", "رياضة"],
]);

const RECIPIENT_WORDS = Object.freeze([
  ["لاخويا", "أخي"], ["لأخويا", "أخي"], ["اخويا", "أخي"], ["لابني", "ابني"], ["ابني", "ابني"],
  ["لبنتي", "ابنتي"], ["بنتي", "ابنتي"], ["لمراتي", "زوجتي"], ["مراتي", "زوجتي"], ["لجوزي", "زوجي"],
  ["لماما", "والدتي"], ["لبابا", "والدي"], ["لصاحبي", "صديقي"], ["لنفسي", "نفسي"],
]);

const AVAILABILITY_CUE = /عندكم|عندك|متوفر|متاح|موجود|in stock|available|do you have|got any/i;

/**
 * Words that are pure grammar or pure attribute — never the name of a thing. A message
 * left with nothing outside this set is not asking about a specific product.
 */
const NON_PRODUCT_WORDS = new Set([
  "عندكم", "عندك", "متوفر", "متوفره", "متوفرة", "متاح", "متاحه", "متاحة", "موجود", "موجوده", "موجودة",
  "ايه", "إيه", "ده", "دي", "دى", "دول", "في", "فيه", "من", "على", "علي", "مع", "لو", "سمحت",
  "عايز", "عاوز", "عايزه", "عايزة", "محتاج", "ممكن", "اعرف", "أعرف", "بكام", "كام", "سعر", "السعر",
  "مقاس", "مقاسات", "المقاس", "لون", "الوان", "ألوان", "اللون", "الالوان", "الألوان",
  "شكرا", "السلام", "عليكم", "اهلا", "أهلا", "بس", "كده", "تمام", "يا", "ال",
  "size", "sizes", "color", "colors", "colour", "colours", "available", "have", "you", "the", "do",
  "what", "which", "is", "are", "in", "stock", "and", "for", "a", "an", "i", "want", "need",
]);

const namesAProduct = (normalized = "") =>
  text(normalized)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
    .some((token) => {
      if (token.length < 2 || /^\d+$/.test(token)) return false;
      // Both spellings must be checked: the list holds "الوان" and "متاحة", and only
      // testing one form let the other slip through as a product name.
      const stripped = token.replace(/^ال(?=.{3,})/, "");
      return !NON_PRODUCT_WORDS.has(token) && !NON_PRODUCT_WORDS.has(stripped);
    });

/**
 * Brands worth recognising without a model. Deliberately the Latin catalog spelling on
 * the right: an entity the retriever cannot search is not worth extracting.
 */
const BRAND_LEXICON = Object.freeze([
  ["نايك", "Nike"], ["nike", "Nike"], ["اديداس", "Adidas"], ["أديداس", "Adidas"], ["adidas", "Adidas"],
  ["بوما", "Puma"], ["puma", "Puma"], ["فانز", "Vans"], ["vans", "Vans"],
  ["كروكس", "Crocs"], ["crocs", "Crocs"], ["نيو بالانس", "New Balance"], ["new balance", "New Balance"],
  ["كونفرس", "Converse"], ["converse", "Converse"], ["ريبوك", "Reebok"], ["reebok", "Reebok"],
  ["جوردن", "Jordan"], ["jordan", "Jordan"], ["فيلا", "Fila"], ["سكيتشرز", "Skechers"],
  ["تيمبرلاند", "Timberland"], ["لاكوست", "Lacoste"], ["اسيكس", "Asics"],
]);

const CATEGORY_LEXICON = Object.freeze([
  ["للجري", "running"], ["جري", "running"], ["رياضه", "sports"], ["رياضة", "sports"],
  ["كاجوال", "casual"], ["رسمي", "formal"], ["شبشب", "slippers"], ["صندل", "sandals"],
  ["بوت", "boots"], ["كوتشي", "sneakers"], ["سنيكرز", "sneakers"], ["حذاء", "shoes"], ["جزمه", "shoes"], ["جزمة", "shoes"],
]);

const firstLexiconHit = (haystack, lexicon) => {
  for (const [needle, canonical] of lexicon) {
    if (haystack.includes(needle)) return canonical;
  }
  return null;
};

/** Budget only when a currency or budget word anchors it — a bare number is a size. */
const extractBudget = (raw) => {
  const match = raw.match(/(?:ميزانيتي|ميزانية|ميزانيه|في حدود|حوالي|لحد|budget)\D{0,12}(\d{2,6})/i)
    || raw.match(/(\d{2,6})\s*(?:جنيه|ج\.م|جم|le|egp|pounds?)/i);
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const OBJECTION_CUES = Object.freeze([
  ["price_high", /غالي|غاليه|غالية|كتير اوي|كتير أوي|ارخص|أرخص|expensive|cheaper/i],
  ["authenticity_doubt", /تقليد|مضروب|مش اصلي|مش أصلي|اوريجينال|أصلي\s*\?|fake|original/i],
  ["quality_doubt", /خامه|خامة|جوده|جودة|بيقطع|هيقطع|وحش|quality/i],
  ["shipping_cost", /الشحن غالي|شحن غالي|شحن كام/i],
  ["shipping_time", /هيتأخر|بيتأخر|طويل اوي|امتى هيوصل|متأخر/i],
  ["size_risk", /لو المقاس مش|مش مظبوط|مش هيجيلي|لو ماجاش/i],
  ["trust", /مش واثق|نصب|محتال|scam/i],
]);

const FUNNEL_BY_INTENT = Object.freeze({
  buying_intent: "ready_to_buy",
  objection: "objecting",
  comparison: "comparing",
  order_status: "post_purchase",
  return_or_exchange: "post_purchase",
  complaint: "complaint",
});

/**
 * Reads the message with rules only. This is not a downgrade path that exists to be
 * ignored: it runs whenever the flag is off, the API key is missing, or the model call
 * fails, so its quality is the floor on the assistant's understanding.
 */
export const buildDeterministicUnderstanding = (message = "") => {
  const raw = text(message);
  const normalized = text(normalizeArabicForIntent(raw)) || raw;
  const haystack = `${raw} ${normalized}`.toLowerCase();
  const legacyFromResolver = resolveIntent(raw);
  const escalation = detectEscalation(raw);
  const size = extractShoeSize(raw);

  let primaryIntent = "other";
  const secondary = [];
  for (const [intent, pattern] of DETERMINISTIC_INTENT_RULES) {
    if (!pattern.test(haystack)) continue;
    if (primaryIntent === "other") primaryIntent = intent;
    else if (secondary.length < 3) secondary.push(intent);
  }
  for (const [intent, pattern] of ANCHORED_INTENTS) {
    if (!pattern.test(raw) && !pattern.test(normalized)) continue;
    if (primaryIntent === "other") primaryIntent = intent;
    else if (!secondary.includes(intent) && secondary.length < 3) secondary.push(intent);
  }

  // "عندكم كروكس مقاس 44" is an availability question that happens to name a size;
  // "الوان ايه المتاحة؟" is a colour question that happens to use an availability word.
  // What separates them is whether a product is named at all.
  if (
    ["size_question", "color_question"].includes(primaryIntent)
    && AVAILABILITY_CUE.test(haystack)
    && namesAProduct(normalized)
  ) {
    if (!secondary.includes(primaryIntent) && secondary.length < 3) secondary.unshift(primaryIntent);
    primaryIntent = "product_availability";
  }
  // Escalation outranks every read: a customer asking for a human, or angry enough to
  // trip the detector, must not be answered as a product question.
  if (escalation.shouldEscalate && primaryIntent !== "human_handoff") primaryIntent = "complaint";

  const objection =
    OBJECTION_CUES.find(([, pattern]) => pattern.test(haystack))?.[0]
    || (primaryIntent === "objection" ? "price_high" : "none");

  const entities = {
    ...emptyEntities(),
    size: size || null,
    color: firstLexiconHit(haystack, COLOR_WORDS),
    city: firstLexiconHit(haystack, EGYPT_CITIES),
    brand: firstLexiconHit(haystack, BRAND_LEXICON),
    category: firstLexiconHit(haystack, CATEGORY_LEXICON),
    occasion: firstLexiconHit(haystack, OCCASION_WORDS),
    recipient: firstLexiconHit(haystack, RECIPIENT_WORDS),
    budget_max: extractBudget(haystack),
  };

  // A complaint is a human's job even when the escalation keyword list misses the
  // particular insult the customer used.
  const requiresHuman = escalation.shouldEscalate || ["human_handoff", "complaint"].includes(primaryIntent);
  const knownIntent = primaryIntent !== "other";

  return {
    primary_intent: primaryIntent,
    secondary_intents: secondary,
    entities,
    funnel_stage: requiresHuman && primaryIntent !== "human_handoff"
      ? "complaint"
      : FUNNEL_BY_INTENT[primaryIntent] || "browsing",
    sentiment: escalation.shouldEscalate || objection !== "none" ? "negative" : "neutral",
    urgency: /ضروري|بسرعه|بسرعة|حالا|النهارده|النهاردة|urgent|asap/i.test(haystack) ? "high" : "normal",
    formality: /حضرتك|لو سمحت|من فضلك|تفضل/i.test(haystack) ? "formal" : "casual",
    objection,
    refers_to_previous: {
      is_followup: /\b(ده|دي|دى|دول|الموديل ده|نفسه|نفسها|هو ده|it|this one)\b/i.test(haystack),
      target: null,
    },
    requires_human: requiresHuman,
    confidence: {
      intent: requiresHuman ? 0.7 : knownIntent ? 0.55 : 0.3,
      entities: Object.values(entities).some(Boolean) ? 0.5 : 0.2,
    },
    legacy_intent: LEGACY_INTENT_BY_PRIMARY[primaryIntent] || legacyFromResolver,
    source: "deterministic",
    model: "",
  };
};

const clamp01 = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
};

const oneOf = (value, allowed, fallback) => {
  const candidate = text(value).toLowerCase();
  return allowed.includes(candidate) ? candidate : fallback;
};

const nullableText = (value, maxLength = 120) => {
  const candidate = text(value);
  if (!candidate || candidate.toLowerCase() === "null") return null;
  return candidate.slice(0, maxLength);
};

const nullableNumber = (value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
};

/**
 * Never trust the model's shape. A malformed field degrades to the deterministic
 * value for that field rather than poisoning the whole understanding.
 */
const normalizeUnderstanding = (payload, { message, model }) => {
  const baseline = buildDeterministicUnderstanding(message);
  if (!payload || typeof payload !== "object") return baseline;

  const entities = payload.entities && typeof payload.entities === "object" ? payload.entities : {};
  const referral = payload.refers_to_previous && typeof payload.refers_to_previous === "object" ? payload.refers_to_previous : {};
  const confidence = payload.confidence && typeof payload.confidence === "object" ? payload.confidence : {};

  const primaryIntent = oneOf(payload.primary_intent, PRIMARY_INTENTS, baseline.primary_intent);

  return {
    primary_intent: primaryIntent,
    secondary_intents: asArray(payload.secondary_intents)
      .map((item) => oneOf(item, PRIMARY_INTENTS, ""))
      .filter((item) => item && item !== primaryIntent)
      .slice(0, 3),
    entities: {
      product_model: nullableText(entities.product_model),
      category: nullableText(entities.category),
      brand: nullableText(entities.brand),
      color: nullableText(entities.color, 40),
      // A regex-confirmed size beats a hallucinated one; fall back to the model only
      // when the deterministic extractor found nothing.
      size: nullableText(entities.size, 20) || baseline.entities.size,
      quantity: nullableNumber(entities.quantity, { min: 1, max: 99 }),
      budget_max: nullableNumber(entities.budget_max, { min: 0, max: 10_000_000 }),
      occasion: nullableText(entities.occasion, 60),
      recipient: nullableText(entities.recipient, 60),
      city: nullableText(entities.city, 60),
    },
    funnel_stage: oneOf(payload.funnel_stage, FUNNEL_STAGES, baseline.funnel_stage),
    sentiment: oneOf(payload.sentiment, ["positive", "neutral", "negative"], baseline.sentiment),
    urgency: oneOf(payload.urgency, ["low", "normal", "high"], "normal"),
    formality: oneOf(payload.formality, ["casual", "neutral", "formal"], "casual"),
    objection: oneOf(payload.objection, OBJECTION_TYPES, "none"),
    refers_to_previous: {
      is_followup: referral.is_followup === true,
      target: nullableText(referral.target, 30),
    },
    // The deterministic escalation keywords are a floor, not a ceiling: if either the
    // model or the keyword list flags a human, we flag a human.
    requires_human: payload.requires_human === true || baseline.requires_human,
    confidence: {
      intent: clamp01(confidence.intent, 0.5),
      entities: clamp01(confidence.entities, 0.5),
    },
    legacy_intent: legacyIntentFor(primaryIntent, message),
    source: "model",
    model,
  };
};

const buildHistorySignature = (history = []) =>
  asArray(history)
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => `${text(turn?.role).slice(0, 1)}:${text(turn?.text).slice(0, 60)}`)
    .join("|");

const buildModelInput = ({ message, history, activeProduct, channel }) => ({
  customer_message: text(message).slice(0, MAX_MESSAGE_CHARS),
  channel: text(channel) || "unknown",
  recent_turns: asArray(history)
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({
      role: text(turn?.role) === "customer" ? "customer" : "store",
      text: text(turn?.text).slice(0, 240),
    })),
  // Only the label is shared — never price or stock. The reader must not be able to
  // repeat a fact, and the grounding gate remains the only authority on those.
  active_product_label: text(activeProduct?.name || activeProduct?.product_name || "") || null,
});

/**
 * Reads one inbound message. Always resolves; never rejects.
 *
 * @returns {Promise<object>} understanding payload (see understandingSchema) plus
 *          `legacy_intent`, `source` ("model" | "deterministic"), and `model`.
 */
export const understandCustomerMessage = async ({
  message = "",
  history = [],
  activeProduct = null,
  channel = "",
  tenantId = null,
} = {}) => {
  const customerMessage = text(message);
  if (!customerMessage) return buildDeterministicUnderstanding("");

  if (!understandingEnabled() || !isTextGenerationAvailable()) {
    return buildDeterministicUnderstanding(customerMessage);
  }

  const normalizedMessage = normalizeArabicIntentPayload(customerMessage).normalizedForIntent;
  const key = cacheKey({
    normalizedMessage,
    historySignature: buildHistorySignature(history),
    activeProductId: activeProduct?.id || activeProduct?.product_id || "",
  });
  const cached = readCache(key);
  if (cached) return { ...cached, cached: true };

  const client = getSharedOpenAiClient();
  if (!client) return buildDeterministicUnderstanding(customerMessage);

  const model = resolveFastModel();
  try {
    const response = await client.responses.create(
      {
        model,
        instructions: INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(buildModelInput({ message: customerMessage, history, activeProduct, channel }), null, 2),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "customer_understanding",
            strict: true,
            schema: understandingSchema,
          },
        },
      },
      { timeout: understandingTimeoutMs(), maxRetries: 1 }
    );

    let parsed = null;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      parsed = null;
    }

    const understanding = normalizeUnderstanding(parsed, { message: customerMessage, model });
    writeCache(key, understanding);
    return { ...understanding, cached: false };
  } catch (error) {
    console.warn("[ai-understanding] read failed, using deterministic reading", {
      tenant_id: tenantId,
      channel: text(channel),
      model,
      message: error?.message,
      status: error?.status,
    });
    return buildDeterministicUnderstanding(customerMessage);
  }
};

/**
 * Compact single-line summary for logs and reply traces. Keeping this here means the
 * trace format lives next to the schema it describes.
 */
export const summarizeUnderstanding = (understanding = {}) => {
  const entities = understanding.entities || {};
  const named = Object.entries(entities)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([field, value]) => `${field}=${value}`)
    .join(" ");
  return [
    understanding.primary_intent || "?",
    understanding.funnel_stage || "?",
    understanding.sentiment || "?",
    understanding.objection && understanding.objection !== "none" ? `objection=${understanding.objection}` : "",
    named,
    `conf=${Number(understanding.confidence?.intent ?? 0).toFixed(2)}`,
    `src=${understanding.source || "?"}`,
  ]
    .filter(Boolean)
    .join(" · ");
};

export const isUnderstandingEnabled = () => understandingEnabled();
