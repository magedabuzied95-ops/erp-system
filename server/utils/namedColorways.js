/*
 * Sneaker colourways customers ask for by name ("بلاك كات", "ميليتري بلاك", "وايت سيمنت").
 *
 * "متاح بلاك كات ؟" (production, 2026-10-19) was read as the colour black of the Air Force on
 * screen, and the bot answered "أيوه يا فندم، Nike Air Force 1 … متاحة" — a different shoe
 * presented as the one asked. A colourway name is a model request: its colour words are part of
 * the name, never a colour pick. When the catalog has no product carrying the name, the reply
 * says so, and other colourways of the same model are offered as an alternative only.
 *
 * Patterns run on matchable() text. JS `\b` never fires next to Arabic letters, so word edges
 * are Unicode lookarounds.
 */

const EDGE_START = "(?<![\\p{L}\\p{N}])";
const EDGE_END = "(?![\\p{L}\\p{N}])";
const word = (body = "") => new RegExp(`${EDGE_START}(?:ال)?(?:${body})${EDGE_END}`, "iu");

const JORDAN_4_NAME = /(?:jordan\s*4|jordan4|(?<![\p{L}\p{N}])a?j4(?![\p{L}\p{N}])|جوردن\s*(?:4|فور))/iu;

// Order matters: "ريد ثاندر" is checked before "ثاندر".
export const NAMED_COLORWAYS = Object.freeze([
  { key: "black_cat", label: "بلاك كات", model: "jordan4", color: "black", pattern: word("بلاك\\s*كات|black\\s*cat") },
  { key: "military_black", label: "ميليتري بلاك", model: "jordan4", color: "black", pattern: word("(?:ميليتري|ميلتري|ملتري|ميليتاري|ميلتاري|ميليتارى)\\s*بلاك|military\\s*black") },
  { key: "white_cement", label: "وايت سيمنت", model: "jordan4", color: "white", pattern: word("وايت\\s*(?:سيمنت|سمنت)|white\\s*cement") },
  { key: "university_blue", label: "يونيفرسيتي بلو", model: "jordan4", color: "blue", pattern: word("(?:يونيفرسيتي|يونيفيرسيتي|يونيفرستي|يونفرستي|يونيفرسيتى)\\s*بلو|university\\s*blue") },
  { key: "red_thunder", label: "ريد ثاندر", model: "jordan4", color: "red", pattern: word("ريد\\s*ثاندر|red\\s*thunder") },
  { key: "thunder", label: "ثاندر", model: "jordan4", color: "black", pattern: word("ثاندر|thunder") },
].map((entry) => Object.freeze({ ...entry, baseName: JORDAN_4_NAME })));

const text = (value = "") => String(value ?? "").trim();

// Hamza forms, alef maqsura, ta marbuta and diacritics folded; punctuation to spaces.
export const matchable = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const detectNamedColorway = (message = "") => {
  const value = matchable(message);
  if (!value) return null;
  return NAMED_COLORWAYS.find((entry) => entry.pattern.test(value)) || null;
};

// Does this product / card carry the colourway's name (name, title, colour, description, sku)?
export const carriesColorway = (colorway = null, item = {}) => {
  if (!colorway) return false;
  const haystack = matchable([
    item.name, item.title, item.product_name, item.base_name, item.color, item.matched_variant_color,
    item.description, item.sku, item.article_code,
  ].filter(Boolean).join(" "));
  return Boolean(haystack) && colorway.pattern.test(haystack);
};

// The same model in another colourway: the only alternative worth offering.
export const isColorwayBaseModel = (colorway = null, item = {}) => {
  if (!colorway) return false;
  const name = matchable([item.name, item.title, item.product_name, item.base_name, item.sku].filter(Boolean).join(" "));
  return colorway.baseName.test(name);
};

export const missingColorwayText = ({ colorway = null, modelLabel = "", hasAlternatives = false } = {}) => {
  const label = text(colorway?.label) || "الموديل ده";
  const lead = `للأسف ${label} مش متاح عندنا دلوقتي 🙏`;
  return hasAlternatives && text(modelLabel)
    ? `${lead}\nبس متاح ${text(modelLabel)} بألوان تانية، ممكن تعجبك كبديل 👇`
    : `${lead}\nلو تحب أرشحلك حاجة قريبة منه، ابعتلي المقاس واللون اللي بتحبه.`;
};

export default detectNamedColorway;
