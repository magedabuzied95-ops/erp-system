/**
 * Presentation-layer split of a catalogue product name into a brand line and a
 * model line. Display only -- nothing here writes back to the catalogue.
 *
 * The storefront home payload carries no `brand` column, so the brand lives
 * inside the name ("ADIDAS SLEPPER - White & Black"). Rendering the brand chip
 * and the full name side by side repeats the word twice:
 *
 *   Adidas
 *   ADIDAS SLEPPER - White & Black
 *
 * splitProductDisplayName() returns { brand, title } instead:
 *
 *   Adidas
 *   Slepper - White & Black
 *
 * Matching is case-insensitive, and a leading separator left behind by the cut
 * is trimmed. An all-caps remainder is title-cased so cards stop shouting, but
 * short all-caps tokens ("RS-X", "SL", "M") are left alone -- those are model
 * codes, not sentences.
 */

const SEPARATOR_HEAD = /^[\s–—\-|/•·,:]+/;

const normalizeForMatch = (value = "") =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();

/**
 * Values the catalogue uses to mean "this product has no brand". They are real
 * data, but they answer a question the shopper did not ask, so the card falls
 * through to its category label instead of printing "Unbranded" in the slot
 * where Nike or Adidas would go.
 */
const PLACEHOLDER_BRANDS = new Set([
  "unbranded",
  "nobrand",
  "none",
  "na",
  "n/a",
  "generic",
  "other",
  "unknown",
  "بدونماركة",
  "غيرمحدد",
  "أخرى",
  "اخرى",
]);

/** "Sketcher" should still resolve to "Skechers", "Colombia" to "Columbia". */
const MATCH_ALIASES = new Map([
  ["sketcher", "skechers"],
  ["sketchers", "skechers"],
  ["colombia", "columbia"],
  ["addidas", "adidas"],
  ["adiddas", "adidas"],
]);

const canonicalMatchKey = (value = "") => {
  const key = normalizeForMatch(value);
  return MATCH_ALIASES.get(key) || key;
};

const LATIN_WORD = /[A-Za-z]+/g;

/**
 * Title-cases shouted words one at a time. A word is left alone when it is two
 * letters or shorter, or when it sits against a digit: those are model codes
 * ("RS-X", "SL018", "AM1", "M") where lower-casing destroys meaning.
 */
const softenAllCaps = (value = "") => {
  const text = String(value || "");
  if (!text) return text;
  return text.replace(LATIN_WORD, (word, offset) => {
    if (word.length <= 2) return word;
    if (word !== word.toUpperCase()) return word; // already mixed case -- author's choice
    const before = text.slice(Math.max(0, offset - 1), offset);
    const after = text.charAt(offset + word.length);
    if (/\d/.test(before) || /\d/.test(after)) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
  });
};

const upperFirst = (value = "") => {
  const text = String(value || "");
  const index = text.search(/\p{L}/u);
  if (index < 0) return text;
  return text.slice(0, index) + text.charAt(index).toLocaleUpperCase() + text.slice(index + 1);
};

/**
 * Brand names are stored however the merchant typed them ("SKECHERS", "crocs",
 * "deVENTE"). A brand line set entirely in one case reads as shouting or as a
 * typo, so single-case labels get title-cased; anything already mixed is the
 * merchant's own styling and is left untouched.
 */
export const formatBrandLabel = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  const letters = text.match(LATIN_WORD) || [];
  if (!letters.length) return text;
  const allUpper = text === text.toUpperCase();
  const allLower = text === text.toLowerCase();
  if (!allUpper && !allLower) return text;
  if (allUpper && !letters.some((word) => word.length >= 4)) return text; // UGG, ALO-style acronyms
  return text.replace(LATIN_WORD, (word) =>
    word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
};

const stripLeadingSeparator = (value = "") => String(value || "").replace(SEPARATOR_HEAD, "").trim();

/**
 * Removes `brand` from the head of `name` when the name opens with it.
 * Returns "" when nothing was removed so callers can tell the two cases apart.
 */
const cutBrandPrefix = (name = "", brand = "") => {
  const rawName = String(name || "").trim();
  const rawBrand = String(brand || "").trim();
  if (!rawName || !rawBrand) return "";

  const brandKey = canonicalMatchKey(rawBrand);
  if (!brandKey) return "";

  // Walk the name one character at a time and compare normalized prefixes, so
  // "ADIDAS SLEPPER", "Adidas-Slepper" and "adidas  slepper" all cut the same.
  for (let index = 1; index <= rawName.length; index += 1) {
    const consumedKey = canonicalMatchKey(rawName.slice(0, index));
    if (consumedKey.length > brandKey.length) return "";
    if (consumedKey !== brandKey) continue;
    // Do not cut mid-word: "Nikes" must not become "s" for the brand "Nike".
    const next = rawName.charAt(index);
    if (next && /[\p{L}\p{N}]/u.test(next)) continue;
    return rawName.slice(index);
  }
  return "";
};

/**
 * @param {object} product   catalogue product (name plus optional brand fields)
 * @param {object} options
 * @param {string[]} options.knownBrands  brand names from /storefront/brands
 * @returns {{ brand: string, title: string }}
 */
export const splitProductDisplayName = (product = {}, { knownBrands = [] } = {}) => {
  const name = String(
    product?.display_name || product?.name || product?.title || ""
  ).trim();
  if (!name) return { brand: "", title: "" };

  const rawDeclaredBrand = String(
    (typeof product?.brand === "string" ? product.brand : product?.brand?.name) ||
      product?.brand_name ||
      product?.brandName ||
      ""
  ).trim();
  const declaredBrand = PLACEHOLDER_BRANDS.has(normalizeForMatch(rawDeclaredBrand)) ? "" : rawDeclaredBrand;

  // A declared brand wins; otherwise look for a known brand at the head of the
  // name. Longest first so "new balance" beats a hypothetical "new".
  const candidates = declaredBrand
    ? [declaredBrand]
    : [...new Set((Array.isArray(knownBrands) ? knownBrands : []).map((value) => String(value || "").trim()).filter(Boolean))]
        .sort((a, b) => b.length - a.length);

  for (const candidate of candidates) {
    const remainder = stripLeadingSeparator(cutBrandPrefix(name, candidate));
    if (remainder) {
      return { brand: formatBrandLabel(candidate), title: upperFirst(softenAllCaps(remainder)) };
    }
  }

  // A declared brand that is not spelled inside the name still belongs on its
  // own line -- the name simply stays whole.
  if (declaredBrand) return { brand: formatBrandLabel(declaredBrand), title: upperFirst(softenAllCaps(name)) };

  return { brand: "", title: upperFirst(softenAllCaps(name)) };
};

export default splitProductDisplayName;
