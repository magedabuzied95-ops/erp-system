/**
 * One lexicon of the things a customer can name.
 *
 * Before this module the same knowledge existed in three incompatible copies:
 *
 *   - `aiUnderstandingService`      — 23 brands, used to fill the understanding entities.
 *   - `aiHybridProductSearchService` — 27 brands, used to bridge Arabic spellings to
 *                                      Latin catalog names for retrieval.
 *   - `aiSupport.cleanVisualProductQuery` — THREE brands, hardcoded as an if-chain
 *                                      (Jordan / Nike / Adidas), which is why the store
 *                                      chat could not recognise a customer asking for
 *                                      Puma or Crocs at all.
 *
 * Three copies meant adding a brand fixed one channel and silently left the others
 * blind — the concrete form of the "three brains, not one" problem in the audit. This
 * is the single source; adding a brand here reaches every channel at once.
 *
 * Latin spelling is authoritative on the right-hand side: an entity the retriever
 * cannot search is not worth extracting.
 */
const text = (value = "") => String(value ?? "").trim();

/**
 * Arabic and Latin spellings a customer actually types, mapped to the catalog spelling.
 * Order matters: multi-word entries must precede the single words they contain, so
 * "نيو بالانس" wins over a bare "بالانس".
 */
export const BRAND_LEXICON = Object.freeze([
  ["نيو بالانس", "New Balance"], ["new balance", "New Balance"], ["نيوبالانس", "New Balance"],
  ["نايك", "Nike"], ["nike", "Nike"],
  ["اديداس", "Adidas"], ["أديداس", "Adidas"], ["adidas", "Adidas"],
  ["بوما", "Puma"], ["puma", "Puma"],
  ["فانز", "Vans"], ["vans", "Vans"],
  ["كروكس", "Crocs"], ["crocs", "Crocs"],
  ["كونفرس", "Converse"], ["converse", "Converse"],
  ["ريبوك", "Reebok"], ["reebok", "Reebok"],
  ["جوردن", "Jordan"], ["جوردان", "Jordan"], ["jordan", "Jordan"], ["aj4", "Jordan"], ["j4", "Jordan"],
  ["فيلا", "Fila"], ["fila", "Fila"],
  ["سكيتشرز", "Skechers"], ["skechers", "Skechers"],
  ["تيمبرلاند", "Timberland"], ["timberland", "Timberland"],
  ["لاكوست", "Lacoste"], ["lacoste", "Lacoste"],
  ["اسيكس", "Asics"], ["asics", "Asics"],
  ["اندر ارمر", "Under Armour"], ["under armour", "Under Armour"],
  ["نورث فيس", "The North Face"], ["north face", "The North Face"],
  ["بيركنستوك", "Birkenstock"], ["birkenstock", "Birkenstock"],
  ["دكتور مارتن", "Dr Martens"], ["dr martens", "Dr Martens"],
  ["هوكا", "Hoka"], ["hoka", "Hoka"],
  ["سالومون", "Salomon"], ["salomon", "Salomon"],
  ["كولومبيا", "Columbia"], ["columbia", "Columbia"],
]);

/** Latin catalog spellings only — the retrieval bridge searches against these. */
export const BRAND_CATALOG_NAMES = Object.freeze([...new Set(BRAND_LEXICON.map(([, canonical]) => canonical))]);

export const CATEGORY_LEXICON = Object.freeze([
  ["للجري", "running"], ["جري", "running"], ["running", "running"],
  ["رياضه", "sports"], ["رياضة", "sports"],
  ["كاجوال", "casual"], ["casual", "casual"],
  ["رسمي", "formal"], ["formal", "formal"],
  ["شبشب", "slippers"], ["صندل", "sandals"],
  ["بوت", "boots"], ["boots", "boots"],
  ["كوتشي", "sneakers"], ["سنيكرز", "sneakers"], ["sneakers", "sneakers"],
  ["حذاء", "shoes"], ["جزمه", "shoes"], ["جزمة", "shoes"], ["shoes", "shoes"],
]);

export const COLOR_LEXICON = Object.freeze([
  ["اسود", "أسود"], ["أسود", "أسود"], ["black", "أسود"],
  ["ابيض", "أبيض"], ["أبيض", "أبيض"], ["white", "أبيض"],
  ["احمر", "أحمر"], ["أحمر", "أحمر"], ["red", "أحمر"],
  ["ازرق", "أزرق"], ["أزرق", "أزرق"], ["blue", "أزرق"],
  ["اخضر", "أخضر"], ["أخضر", "أخضر"], ["green", "أخضر"],
  ["اصفر", "أصفر"], ["yellow", "أصفر"],
  ["بني", "بني"], ["brown", "بني"],
  ["رمادي", "رمادي"], ["grey", "رمادي"], ["gray", "رمادي"],
  ["بيج", "بيج"], ["beige", "بيج"],
  ["وردي", "وردي"], ["بمبي", "وردي"], ["pink", "وردي"],
  ["نبيتي", "نبيتي"],
]);

/**
 * Known product models, kept separate from brands because a model is a stronger
 * retrieval signal than the brand that makes it.
 */
export const MODEL_LEXICON = Object.freeze([
  ["جوردن فور", "jordan4"], ["جوردن 4", "jordan4"], ["jordan 4", "jordan4"], ["jordan4", "jordan4"],
  ["aj4", "jordan4"], ["j4", "jordan4"],
  ["شوكس", "shox"], ["shox", "shox"],
  ["ميرور", "mirror"], ["mirror", "mirror"],
  ["اير فورس", "air force"], ["air force", "air force"], ["af1", "air force"],
  ["الترابوست", "ultraboost"], ["ultraboost", "ultraboost"],
]);

/**
 * First lexicon entry whose key appears in the text.
 *
 * Substring rather than token equality on purpose: Arabic attaches prefixes
 * ("لاسكندرية", "بالنايك") that would defeat exact token matching.
 */
export const matchLexicon = (value = "", lexicon = []) => {
  const haystack = text(value).toLowerCase();
  if (!haystack) return null;
  for (const [needle, canonical] of lexicon) {
    if (haystack.includes(needle)) return canonical;
  }
  return null;
};

/**
 * The maker a model implies. A customer who says "شوكس" has named a Nike shoe without
 * saying Nike, and the retriever needs the brand to narrow on.
 */
export const BRAND_BY_MODEL = Object.freeze({
  jordan4: "Jordan",
  shox: "Nike",
  "air force": "Nike",
  ultraboost: "Adidas",
});

/**
 * Arabic spellings rewritten to the Latin token the catalog actually stores, for the
 * SQL search paths that match product names with LIKE.
 *
 * Longest first: "نيو بالانس" must be consumed before a bare "بالانس", and "اير فورس"
 * before "فورس".
 */
const ARABIC_SEARCH_REWRITES = Object.freeze([
  ["نيو بالانس", "new balance"], ["نيوبالانس", "new balance"],
  ["اير فورس", "air force"], ["اير جوردن", "air jordan"],
  ["دكتور مارتن", "dr martens"], ["اندر ارمر", "under armour"], ["نورث فيس", "north face"],
  ["نايك", "nike"], ["اديداس", "adidas"], ["أديداس", "adidas"], ["جوردن", "jordan"], ["جوردان", "jordan"],
  ["بوما", "puma"], ["فانز", "vans"], ["كروكس", "crocs"], ["كونفرس", "converse"],
  ["ريبوك", "reebok"], ["فيلا", "fila"], ["سكيتشرز", "skechers"], ["تيمبرلاند", "timberland"],
  ["لاكوست", "lacoste"], ["اسيكس", "asics"], ["بيركنستوك", "birkenstock"], ["هوكا", "hoka"],
  ["سالومون", "salomon"], ["كولومبيا", "columbia"],
  ["شوكسات", "shox"], ["شوكس", "shox"], ["ميرور", "mirror"], ["ميرو", "mirror"],
  ["دانك", "dunk"], ["ييزي", "yeezy"], ["كامبس", "campus"], ["سامبا", "samba"],
  ["الترابوست", "ultraboost"],
  ["اربعه", "4"], ["رابعه", "4"], ["فور", "4"],
]);

/**
 * Rewrites Arabic product words to their Latin catalog spelling.
 *
 * Uses Unicode-aware lookarounds rather than `\b`. JavaScript's word boundary is
 * defined over ASCII `\w`, so `/\bنايك\b/` can never match — the boundary it needs
 * does not exist between two non-word characters. Every Arabic-to-Latin rewrite
 * written that way is dead code that silently does nothing, which is exactly how
 * "نايك" kept reaching a Latin-only catalog unchanged.
 */
export const latinizeArabicProductText = (value = "") => {
  let output = text(value);
  if (!output) return "";
  for (const [arabic, latin] of ARABIC_SEARCH_REWRITES) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${arabic}(?![\\p{L}\\p{N}])`, "gu");
    output = output.replace(pattern, latin);
  }
  return output;
};

/**
 * Does a reply claim the product is in stock?
 *
 * Used by the reply guards and the regression harness, which previously each tested
 * `/\bمتاح\b/`. That pattern can never match, so every one of those checks silently
 * returned false: the harness recorded "reply does not mention availability" for
 * replies that plainly did, and the guard assertions passed unconditionally.
 *
 * A trailing boundary is deliberately NOT required. Arabic inflects the word — متاح,
 * متاحة, متوفرة — and this is a "does the reply claim availability" test, so the stem
 * is the signal. The leading boundary stays, so the word must start a token.
 */
export const AVAILABILITY_CLAIM_PATTERN =
  /(?<![\p{L}\p{N}])(?:متاح|متوفر|موجود|in stock|available)/iu;

export const claimsAvailability = (value = "") => AVAILABILITY_CLAIM_PATTERN.test(text(value));

export const extractBrand = (value = "") => matchLexicon(value, BRAND_LEXICON);

/** Brand named outright, else inferred from a model the customer named. */
export const resolveBrand = (value = "") => {
  const named = matchLexicon(value, BRAND_LEXICON);
  if (named) return named;
  const model = matchLexicon(value, MODEL_LEXICON);
  return model ? BRAND_BY_MODEL[model] || "" : "";
};
export const extractCategory = (value = "") => matchLexicon(value, CATEGORY_LEXICON);
export const extractColor = (value = "") => matchLexicon(value, COLOR_LEXICON);
export const extractModel = (value = "") => matchLexicon(value, MODEL_LEXICON);
