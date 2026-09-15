/*
 * Arabic brand and model names, as the catalogue spells them.
 *
 * The catalogue names products in Latin script ("Nike Air Jordan 1 Low", "SKECHERS - Navy") and
 * the search endpoint matches spelling. Live 2026-09-15, every one of these returned 0 results:
 * "جوردن", "نايك", "سكيتشرز", "كروكس", "اديداس سامبا". That hurt typed search, and it made voice
 * search useless: an Egyptian shopper says the brand in Arabic and the transcript comes back in
 * Arabic script. So the words are rewritten to the catalogue's spelling before the request; the
 * field keeps what the shopper typed or said.
 *
 * Multi-word names are listed before their parts so "نيو بالانس" is not read as two words.
 */

const ALIASES = [
  ["نيو بالانس", "New Balance"],
  ["نيوبالانس", "New Balance"],
  ["اير فورس", "Air Force"],
  ["ايرفورس", "Air Force"],
  ["اير ماكس", "Air Max"],
  ["اير جوردن", "Air Jordan"],
  ["الترا بوست", "Ultra Boost"],
  ["ستان سميث", "Stan Smith"],
  ["نورث فيس", "North Face"],
  ["تومي هيلفيجر", "Tommy Hilfiger"],
  ["لويس فيتون", "Louis Vuitton"],
  ["كالفن كلاين", "Calvin Klein"],
  ["مايكل كورس", "Michael Kors"],
  ["اون رانينج", "On Running"],
  ["جوردن", "Jordan"],
  ["جوردان", "Jordan"],
  ["نايكي", "Nike"],
  ["نايك", "Nike"],
  ["اديداس", "Adidas"],
  ["اديدس", "Adidas"],
  ["سكيتشرز", "Skechers"],
  ["سكتشرز", "Skechers"],
  ["سكيتشر", "Skechers"],
  ["سكتشر", "Skechers"],
  ["كروكس", "Crocs"],
  ["كروك", "Crocs"],
  ["بوما", "Puma"],
  ["فانس", "Vans"],
  ["كونفرس", "Converse"],
  ["كونفيرس", "Converse"],
  ["ريبوك", "Reebok"],
  ["اسيكس", "Asics"],
  ["هوكا", "Hoka"],
  ["سالومون", "Salomon"],
  ["تمبرلاند", "Timberland"],
  ["تيمبرلاند", "Timberland"],
  ["لاكوست", "Lacoste"],
  ["ماكوين", "McQueen"],
  ["مكوين", "McQueen"],
  ["الكسندر", "Alexander"],
  ["جوتشي", "Gucci"],
  ["جوتشى", "Gucci"],
  ["برادا", "Prada"],
  ["ديور", "Dior"],
  ["شانيل", "Chanel"],
  ["زارا", "Zara"],
  ["سامبا", "Samba"],
  ["جازيل", "Gazelle"],
  ["كامبس", "Campus"],
  ["سوبر ستار", "Superstar"],
  ["سوبرستار", "Superstar"],
  ["دانك", "Dunk"],
  ["ييزي", "Yeezy"],
  ["شوكس", "Shox"],
  ["ميرور", "Mirror"],
  ["اوريجينال", "Original"],
  ["اورجينال", "Original"],
];

// Spelling variants that should not decide a match: hamza forms of alef, final ya, ta marbuta,
// tatweel and diacritics.
export const foldArabic = (value = "") =>
  String(value || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

const FOLDED_ALIASES = ALIASES.map(([arabic, latin]) => [foldArabic(arabic), latin]);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALIAS_PATTERN = new RegExp(
  `(^|[\\s,،])(${FOLDED_ALIASES.map(([arabic]) => escapeRegExp(arabic)).join("|")})(?=$|[\\s,،])`,
  "g"
);
const ALIAS_LOOKUP = new Map(FOLDED_ALIASES);

/** The query as the catalogue would spell it. Text without Arabic comes back unchanged. */
export const catalogueSearchQuery = (query = "") => {
  const raw = String(query || "").trim();
  if (!/[؀-ۿ]/.test(raw)) return raw;
  const folded = foldArabic(raw);
  return folded
    .replace(ALIAS_PATTERN, (match, lead, word) => `${lead}${ALIAS_LOOKUP.get(word) || word}`)
    .replace(/\s+/g, " ")
    .trim();
};

/*
 * A spoken or typed request, split into what the search endpoint can use.
 *
 * The endpoint matches names only: "Jordan Black", "Skechers Grey" and "Crocs Men" all returned 0
 * live, while q=Jordan&color=black returned the black Jordans. And voice brings whole sentences —
 * "عايز كوتشي جوردن اسود مقاس 42 رجالي". So colour, audience and size words become filters (the
 * same ?color= / ?gender= / ?size= the listing page reads), filler words are dropped, and what is
 * left is the name query.
 */
const COLOUR_WORDS = new Map(
  [
    [["اسود", "سودا", "black"], "black"],
    [["ابيض", "بيضا", "white"], "white"],
    [["رمادي", "رصاصي", "جراي", "سكني", "grey", "gray"], "grey"],
    [["كحلي", "navy"], "navy"],
    [["بيج", "beige"], "beige"],
    [["بني", "brown"], "brown"],
    [["نبيتي", "عنابي", "بوردو", "burgundy"], "burgundy"],
    [["ازرق", "زرقا", "blue"], "blue"],
    [["لبني", "سماوي"], "sky blue"],
    [["بمبي", "وردي", "بينك", "pink"], "pink"],
    [["بنفسجي", "purple"], "purple"],
    [["موف", "mauve"], "mauve"],
    [["جملي", "كاميل", "camel"], "camel"],
    [["زيتي", "olive"], "olive"],
    [["احمر", "حمرا", "red"], "red"],
    [["اخضر", "خضرا", "green"], "green"],
    [["برتقالي", "اورنج", "orange"], "orange"],
    [["اصفر", "صفرا", "yellow"], "yellow"],
  ].flatMap(([words, key]) => words.map((word) => [foldArabic(word), key]))
);

const AUDIENCE_WORDS = new Map(
  [
    [["رجالي", "رجال", "رجاليه", "men", "mens", "man"], "men"],
    [["حريمي", "حريميه", "نسائي", "ستات", "women", "womens", "ladies"], "women"],
    [["اطفال", "ولادي", "بناتي", "عيالي", "kids", "kid", "children"], "kids"],
  ].flatMap(([words, key]) => words.map((word) => [foldArabic(word), key]))
);

// Words that carry no product: requests, politeness and the generic word for the category.
const FILLER_WORDS = new Set(
  [
    "عايز", "عاوز", "عايزه", "عاوزه", "محتاج", "محتاجه", "ابغي", "اريد", "نفسي", "بدور", "ادور",
    "عندكم", "عندك", "عندكو", "فيه", "في", "هل", "ممكن", "بتاع", "بتاعه", "نوع", "لون", "بلون",
    "كوتشي", "كوتشيات", "جزمه", "جزم", "حذاء", "احذيه", "شوز", "سنيكرز", "من", "ده", "دي", "و",
    "please", "want", "need", "color", "colour", "shoes", "shoe",
  ].map(foldArabic)
);

export const parseSearchQuery = (query = "") => {
  let text = foldArabic(String(query || "")).replace(/لو\s*سمحت/g, " ");
  let size = "";
  text = text.replace(/(?:^|\s)(?:مقاس|مقاسي|size)\s*(\d{2}(?:\.5)?)(?=\s|$)/i, (match, value) => {
    size = value;
    return " ";
  });
  const colours = [];
  let gender = "";
  const kept = [];
  const tokens = catalogueSearchQuery(text).split(/[\s,،]+/).filter(Boolean);
  tokens.forEach((token, index) => {
    // "وابيض" is "and white": the conjunction is glued to the word.
    const word = token.toLowerCase();
    const bare = /^و[؀-ۿ]{2,}/.test(word) && (COLOUR_WORDS.has(word.slice(1)) || AUDIENCE_WORDS.has(word.slice(1))) ? word.slice(1) : word;
    if (COLOUR_WORDS.has(bare)) {
      if (!colours.includes(COLOUR_WORDS.get(bare))) colours.push(COLOUR_WORDS.get(bare));
      return;
    }
    if (AUDIENCE_WORDS.has(bare)) {
      if (!gender) gender = AUDIENCE_WORDS.get(bare);
      return;
    }
    if (FILLER_WORDS.has(bare)) return;
    // "جوردن ١ لو" — Low, not "if", once it follows a model number.
    if (bare === "لو" && /^\d+$/.test(tokens[index - 1] || "")) {
      kept.push("Low");
      return;
    }
    kept.push(token);
  });
  // Two colours name one two-tone colourway, keyed the way the catalogue keys them: white goes
  // last ("black & white", "grey & white" — never "white & black").
  const [first = "", second = ""] = colours;
  const color = !second ? first : first === "white" ? `${second} & white` : `${first} & ${second}`;
  return { q: kept.join(" ").trim(), color, gender, size };
};
