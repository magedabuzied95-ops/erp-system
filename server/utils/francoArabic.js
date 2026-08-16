/**
 * Franco-Arabic ("Arabizi") to Arabic.
 *
 * Egyptian customers routinely type Arabic in Latin letters with digits standing in
 * for sounds Latin has no letter for: 3=ع, 7=ح, 2=ء, 5=خ, 4=ش, 8=غ, 9=ص. "3ayez crocs
 * mas 44" is an ordinary sentence on Instagram and Messenger, especially from younger
 * customers.
 *
 * Every intent rule in the understanding pass is written in Arabic script, so before
 * this module a franco message matched none of them. Brand and size still resolved —
 * "crocs" is already Latin and "44" is already digits — which made the failure look
 * partial rather than total: the reader knew WHICH product and WHAT size, and had no
 * idea whether the customer was asking the price, the availability, or complaining.
 *
 * Design decisions:
 *
 * 1. WORD mapping, not character transliteration. Mapping 3→ع mechanically turns
 *    "mas 3" into nonsense and mangles any genuinely English word ("Air Force 1",
 *    "size", brand names). The vocabulary that actually carries intent is small and
 *    closed, so it is listed.
 *
 * 2. Additive, never destructive. `francoToArabic` returns the rewritten text, but the
 *    caller is expected to SEARCH both forms — a message can mix scripts freely
 *    ("عايز crocs mas 44"), and dropping either half loses signal.
 *
 * 3. No brand names here. Brands live in aiEntityLexicon and already resolve from
 *    Latin; duplicating them would be the divergence trap that made three brand lists
 *    out of one.
 */
const text = (value = "") => String(value ?? "").trim();

/**
 * Franco spellings mapped to the Arabic word the intent rules are written against.
 *
 * Longest first: "3ayez" must be consumed before "ayez", and "3andokom" before "3and".
 * Multiple spellings per word on purpose — franco has no orthography, so the same word
 * appears half a dozen ways and every one of them is "correct".
 */
const FRANCO_WORDS = Object.freeze([
  // wanting / buying
  ["3ayez", "عايز"], ["3awez", "عايز"], ["3aiz", "عايز"], ["ayez", "عايز"], ["awez", "عايز"],
  ["3ayza", "عايزة"], ["3awza", "عايزة"], ["ayza", "عايزة"],
  ["me7tag", "محتاج"], ["mehtag", "محتاج"], ["m7tag", "محتاج"],
  ["ashtery", "اشتري"], ["a4tery", "اشتري"], ["ashtry", "اشتري"], ["hashtery", "هشتري"],
  ["hakhod", "هاخد"], ["haked", "هاخد"], ["hakhdo", "هاخده"],
  // price
  ["bekam", "بكام"], ["bkam", "بكام"], ["b kam", "بكام"],
  ["se3r", "سعر"], ["se3er", "سعر"], ["as3ar", "اسعار"], ["as3arkom", "اسعاركم"],
  ["kam", "كام"], ["taman", "تمن"],
  // availability
  ["3andokom", "عندكم"], ["3andkom", "عندكم"], ["3andak", "عندك"], ["3andk", "عندك"],
  ["andokom", "عندكم"], ["andak", "عندك"],
  ["mawgod", "موجود"], ["mawgoud", "موجود"], ["mwgod", "موجود"],
  ["mota7", "متاح"], ["motah", "متاح"], ["metwafr", "متوفر"], ["motawafer", "متوفر"],
  ["khalas", "خلص"], ["5alas", "خلص"],
  // size / colour
  ["mas", "مقاس"], ["ma2as", "مقاس"], ["makas", "مقاس"], ["m2as", "مقاس"],
  ["lon", "لون"], ["loan", "لون"], ["alwan", "الوان"], ["elwan", "الوان"],
  ["eswed", "اسود"], ["esswed", "اسود"], ["abyad", "ابيض"], ["a7mar", "احمر"], ["azra2", "ازرق"],
  // reference / follow-up
  ["da", "ده"], ["dah", "ده"], ["di", "دي"], ["dee", "دي"], ["dol", "دول"],
  ["nafso", "نفسه"], ["nafsaha", "نفسها"],
  // objection
  ["ghali", "غالي"], ["gali", "غالي"], ["ghalya", "غالية"],
  ["rekhes", "رخيص"], ["arkhas", "ارخص"], ["ar5as", "ارخص"],
  ["ta2lid", "تقليد"], ["taqlid", "تقليد"], ["ta2led", "تقليد"],
  ["asly", "اصلي"], ["asli", "اصلي"], ["original", "اصلي"],
  ["khama", "خامة"], ["5ama", "خامة"], ["gawda", "جودة"],
  // shipping / orders
  ["sha7n", "شحن"], ["shahn", "شحن"], ["shipping", "شحن"],
  ["tawsil", "توصيل"], ["tawseel", "توصيل"],
  ["order", "اوردر"], ["odr", "اوردر"], ["talab", "طلب"], ["talaby", "طلبي"],
  ["emta", "امتى"], ["emtaa", "امتى"], ["meta", "امتى"],
  ["fen", "فين"], ["feen", "فين"], ["wasal", "وصل"],
  // returns / complaints
  ["ersga3", "ارجع"], ["arga3", "ارجع"], ["estebdal", "استبدال"], ["abdel", "ابدل"],
  ["felosy", "فلوسي"], ["flosy", "فلوسي"], ["refund", "فلوسي"],
  ["moshkela", "مشكلة"], ["mushkela", "مشكلة"], ["shakwa", "شكوى"],
  ["nassab", "نصاب"], ["nasab", "نصاب"], ["nassabin", "نصابين"],
  // human handoff
  ["mowazaf", "موظف"], ["muwazaf", "موظف"], ["akalem", "اكلم"], ["akallem", "اكلم"],
  // negation / politeness / greetings
  ["msh", "مش"], ["mesh", "مش"], ["mish", "مش"],
  ["3ageb", "عاجب"], ["3agebny", "عاجبني"], ["7elw", "حلو"], ["helw", "حلو"],
  ["momken", "ممكن"], ["mumken", "ممكن"],
  ["salam", "السلام"], ["salamo", "السلام"], ["ezayak", "ازيك"], ["ezayk", "ازيك"],
  ["shokran", "شكرا"], ["shukran", "شكرا"], ["tamam", "تمام"],
  ["sowar", "صور"], ["sowr", "صور"], ["sora", "صورة"], ["sura", "صورة"],
  ["fe", "فيه"], ["fee", "فيه"], ["feh", "فيه"],
  ["el", "ال"], ["ana", "انا"],
]);

/** Longest key first, so a short spelling cannot consume a longer one's prefix. */
const SORTED_FRANCO = Object.freeze([...FRANCO_WORDS].sort((a, b) => b[0].length - a[0].length));

/**
 * True when the text looks like franco rather than plain English.
 *
 * The digit-letters are the giveaway: no English word contains "3a" or "7e" mid-token.
 * Requiring this before rewriting keeps genuinely English messages ("do you have crocs
 * in size 44") away from a vocabulary that would mangle them.
 */
export const looksLikeFranco = (value = "") => {
  const haystack = text(value).toLowerCase();
  if (!haystack) return false;
  if (/[؀-ۿ]/.test(haystack) && !/[a-z]/.test(haystack)) return false;
  // A digit used as a letter: adjacent to Latin letters rather than standing alone.
  if (/[a-z][2345789]|[2345789][a-z]/.test(haystack)) return true;
  // Or a known franco word that is not also an English word.
  return /\b(?:msh|mesh|bkam|bekam|mas|ma2as|3andak|ezayak|shokran|momken|tamam|ghali)\b/.test(haystack);
};

/**
 * Rewrites franco words to Arabic. Words with no mapping are left as they are, so
 * brands and model names survive for the Latin-matching retrievers.
 */
export const francoToArabic = (value = "") => {
  const source = text(value);
  if (!source) return "";

  let output = source.toLowerCase();
  for (const [franco, arabic] of SORTED_FRANCO) {
    // Latin-side boundaries only: \b is correct here precisely because both the pattern
    // and what precedes it are ASCII. The REPLACEMENT is Arabic, which is why this runs
    // as a rewrite pass rather than being folded into the Arabic rule patterns.
    const pattern = new RegExp(`\\b${franco.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    output = output.replace(pattern, arabic);
  }
  return output;
};

/**
 * The text an intent matcher should search: the original plus its Arabic rewrite when
 * the message looks like franco.
 *
 * Both, never either. A mixed message ("عايز crocs mas 44") carries signal in each
 * script, and the Latin half still has to reach a Latin catalog.
 */
export const withFrancoExpansion = (value = "") => {
  const source = text(value);
  if (!source || !looksLikeFranco(source)) return source;
  const rewritten = francoToArabic(source);
  return rewritten && rewritten !== source.toLowerCase() ? `${source} ${rewritten}` : source;
};
