/*
 * Display-only translation of catalogue VALUES the ERP stores in one language: colour names
 * ("Black & White" / "أسود"), the "one size" marker ("مقاس واحد") and bag sizes ("18-inch"),
 * and the "Unbranded" brand. The stored value stays the identity everywhere — filters, URLs,
 * cart lines and comparisons keep using it; only what the shopper reads follows the language.
 * Anything not in the tables is returned unchanged, so a merchant-authored name is never mangled.
 */

const isArabic = (lang = "") => String(lang || "ar").toLowerCase().startsWith("ar");

// English key → [English label, Arabic label]. Keys are lower case, spaces collapsed.
const COLOR_WORDS = {
  black: ["Black", "أسود"],
  white: ["White", "أبيض"],
  grey: ["Grey", "رمادي"],
  gray: ["Gray", "رمادي"],
  navy: ["Navy", "كحلي"],
  "navy blue": ["Navy Blue", "كحلي"],
  blue: ["Blue", "أزرق"],
  "sky blue": ["Sky Blue", "سماوي"],
  "light blue": ["Light Blue", "أزرق فاتح"],
  "dark blue": ["Dark Blue", "أزرق غامق"],
  "baby blue": ["Baby Blue", "بيبي بلو"],
  red: ["Red", "أحمر"],
  burgundy: ["Burgundy", "نبيتي"],
  maroon: ["Maroon", "نبيتي"],
  pink: ["Pink", "بينك"],
  "light pink": ["Light Pink", "بينك فاتح"],
  rose: ["Rose", "روز"],
  green: ["Green", "أخضر"],
  "dark green": ["Dark Green", "أخضر غامق"],
  olive: ["Olive", "زيتي"],
  mint: ["Mint", "منت"],
  beige: ["Beige", "بيج"],
  cream: ["Cream", "كريمي"],
  "off white": ["Off White", "أوف وايت"],
  offwhite: ["Off White", "أوف وايت"],
  ivory: ["Ivory", "أوف وايت"],
  brown: ["Brown", "بني"],
  "dark brown": ["Dark Brown", "بني غامق"],
  "light brown": ["Light Brown", "بني فاتح"],
  camel: ["Camel", "جملي"],
  tan: ["Tan", "جملي"],
  khaki: ["Khaki", "كاكي"],
  havana: ["Havana", "هافان"],
  yellow: ["Yellow", "أصفر"],
  mustard: ["Mustard", "مستردة"],
  orange: ["Orange", "برتقالي"],
  purple: ["Purple", "بنفسجي"],
  lilac: ["Lilac", "ليلكي"],
  lavender: ["Lavender", "لافندر"],
  violet: ["Violet", "بنفسجي"],
  gold: ["Gold", "ذهبي"],
  silver: ["Silver", "فضي"],
  bronze: ["Bronze", "برونزي"],
  "rose gold": ["Rose Gold", "روز جولد"],
  turquoise: ["Turquoise", "تركواز"],
  teal: ["Teal", "تيل"],
  coral: ["Coral", "كورال"],
  nude: ["Nude", "نود"],
  "all black": ["All Black", "أسود بالكامل"],
  "all white": ["All White", "أبيض بالكامل"],
  multicolor: ["Multicolor", "متعدد الألوان"],
  multicolour: ["Multicolour", "متعدد الألوان"],
  "multi color": ["Multi Color", "متعدد الألوان"],
  transparent: ["Transparent", "شفاف"],
  default: ["Default", "افتراضي"],
};

const normalizeWord = (value = "") => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, "ا")
  .replace(/ة/g, "ه")
  .replace(/ى/g, "ي")
  .replace(/\s+/g, " ");

// Arabic spellings the ERP uses, pointing at the English key.
const ARABIC_COLOR_ALIASES = {
  "اسود": "black",
  "ابيض": "white",
  "رمادي": "grey",
  "رصاصي": "grey",
  "سكني": "grey",
  "كحلي": "navy",
  "ازرق": "blue",
  "سماوي": "sky blue",
  "لبني": "baby blue",
  "احمر": "red",
  "نبيتي": "burgundy",
  "بينك": "pink",
  "وردي": "pink",
  "روز": "rose",
  "اخضر": "green",
  "زيتي": "olive",
  "بيج": "beige",
  "كريمي": "cream",
  "اوف وايت": "off white",
  "بني": "brown",
  "جملي": "camel",
  "كاكي": "khaki",
  "هافان": "havana",
  "اصفر": "yellow",
  "مستردة": "mustard",
  "مستردي": "mustard",
  "برتقالي": "orange",
  "بنفسجي": "purple",
  "موف": "purple",
  "ليلكي": "lilac",
  "ذهبي": "gold",
  "دهبي": "gold",
  "فضي": "silver",
  "تركواز": "turquoise",
  "متعدد الالوان": "multicolor",
  "شفاف": "transparent",
  "افتراضي": "default",
};

// Looked up by normalizeWord, so the keys are normalized the same way ("مستردة" is stored as "مسترده").
const ARABIC_COLOR_ALIAS_INDEX = Object.fromEntries(
  Object.entries(ARABIC_COLOR_ALIASES).map(([spelling, key]) => [normalizeWord(spelling), key])
);

const colorEntry = (word = "") => {
  const key = normalizeWord(word);
  if (!key) return null;
  return COLOR_WORDS[key] || COLOR_WORDS[ARABIC_COLOR_ALIAS_INDEX[key]] || null;
};

// "أوف وايت" holds a space and a و like the Arabic "and" does, so a piece is split on " و" only where
// every resulting part is a colour; the longest colour phrase is tried first. null = not all colours.
const colorEntriesOf = (segment = "") => {
  const pieces = String(segment).split(/(\s+و\s*)/);
  const words = pieces.filter((_, index) => index % 2 === 0);
  const joins = pieces.filter((_, index) => index % 2 === 1);
  const walk = (start) => {
    if (start >= words.length) return [];
    if (!words[start].trim()) return walk(start + 1);
    for (let end = words.length - 1; end >= start; end -= 1) {
      let phrase = words[start];
      for (let index = start; index < end; index += 1) phrase += joins[index] + words[index + 1];
      const entry = colorEntry(phrase);
      const rest = entry ? walk(end + 1) : null;
      if (rest) return [entry, ...rest];
    }
    return null;
  };
  return walk(0);
};

/** "Black & White" → "أسود وأبيض" in Arabic; "أسود" → "Black" in English. Unknown parts stay. */
export const localizeColorName = (value = "", lang = "ar") => {
  const text = String(value ?? "").trim();
  if (!text) return text;
  const arabic = isArabic(lang);
  const parts = text.split(/\s*(?:&|\/|,|\+|\s-\s|\sand\s)\s*/i).filter(Boolean);
  if (!parts.length) return text;
  const entries = parts.flatMap((part) => colorEntriesOf(part) || [null]);
  // Only a name made entirely of colour words is translated; "Air Max - Black" is a product name.
  if (entries.some((entry) => !entry)) return text;
  const labels = entries.map((entry) => (arabic ? entry[1] : entry[0]));
  if (labels.length === 1) return labels[0];
  return arabic ? labels.join(" و") : labels.join(" & ");
};

const ONE_SIZE_KEYS = new Set(["مقاس واحد", "one size", "onesize", "one-size", "free size", "freesize", "مقاس موحد"].map(normalizeWord));

/** The one-size marker and bag inch sizes, in the reader's language; any other size unchanged. */
export const localizeSizeLabel = (value = "", lang = "ar") => {
  const text = String(value ?? "").trim();
  if (!text) return text;
  const arabic = isArabic(lang);
  if (ONE_SIZE_KEYS.has(normalizeWord(text))) return arabic ? "مقاس واحد" : "One size";
  const inches = text.match(/^(\d{1,2}(?:\.\d)?)\s*(?:-|_)?\s*(?:inch(?:es)?|in|"|بوصة|بوصه|انش|إنش)$/i);
  if (inches) return arabic ? `${inches[1]} بوصة` : `${inches[1]}-inch`;
  return text;
};

const UNBRANDED_KEYS = new Set(["unbranded", "no brand", "بدون ماركة", "بدون براند"].map(normalizeWord));

export const localizeBrandLabel = (value = "", lang = "ar") => {
  const text = String(value ?? "").trim();
  if (!text) return text;
  if (UNBRANDED_KEYS.has(normalizeWord(text))) return isArabic(lang) ? "بدون ماركة" : "Unbranded";
  return text;
};

const DAY_NAMES = [
  ["السبت", "Saturday"],
  ["الأحد", "Sunday"],
  ["الاحد", "Sunday"],
  ["الإثنين", "Monday"],
  ["الاثنين", "Monday"],
  ["الثلاثاء", "Tuesday"],
  ["الأربعاء", "Wednesday"],
  ["الاربعاء", "Wednesday"],
  ["الخميس", "Thursday"],
  ["الجمعة", "Friday"],
  ["يوميًا", "Daily"],
  ["يوميا", "Daily"],
];

/**
 * A working-hours line the owner typed in Arabic ("السبت - الخميس", "12:00 م - 1:00 ص") read in
 * English: day names and the ص/م markers. Arabic readers get the line as typed.
 */
export const localizeHoursLine = (value = "", lang = "ar") => {
  const text = String(value ?? "");
  if (isArabic(lang) || !text) return text;
  let out = text;
  DAY_NAMES.forEach(([ar, en]) => {
    out = out.split(ar).join(en);
  });
  return out
    .replace(/(\d{1,2}(?::\d{2})?)\s*م(?![\u0600-\u06ff])/g, "$1 PM")
    .replace(/(\d{1,2}(?::\d{2})?)\s*ص(?![\u0600-\u06ff])/g, "$1 AM")
    .replace(/\s*[–-]\s*/g, " – ");
};
