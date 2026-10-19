import { expandSearchAliasTerms } from "../services/productAliasEngine.js";

/*
 * The catalog words a customer's message names, in the Latin spelling our product names use.
 *
 * "متاح ايرفورس ؟" names Air Force, but brain V2 searched only the raw Arabic words — nothing in
 * the catalog is called ايرفورس — and the words "متاح" / "بكام" / "مقاس" had already sent the
 * message down the size / price path, which never searches at all. So a customer asking for a
 * model we stock was told we had no information about it.
 *
 * The transliteration table is productAliasEngine's (the same one the order search uses). Only
 * fully Latin results count, so number spellings ("four", "4two") and question words drop out.
 */

const LATIN_STOPWORDS = new Set([
  "available", "availability", "price", "prices", "size", "sizes", "color", "colors", "colour",
  "colours", "how", "much", "have", "has", "you", "the", "and", "for", "any", "want", "need",
  "please", "hello", "hey", "is", "are", "do", "does", "there", "with", "this", "that", "what",
  "shoe", "shoes", "sneaker", "sneakers", "pair", "new", "now", "yes", "not",
]);
const NUMBER_SPELLING = /^(?:zero|one|two|three|four|five|six|seven|eight|nine|\d)+$/;
const ARABIC_DEFINITE = /^ال(?=\S{3,})/;

const text = (value = "") => String(value ?? "").trim();
const cleanMessage = (value = "") => text(value).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const latinOf = (word = "") => {
  for (const candidate of [word, word.replace(ARABIC_DEFINITE, "")]) {
    if (/^[a-z0-9]+$/i.test(candidate)) return candidate.toLowerCase();
    const latin = expandSearchAliasTerms(candidate, { limit: 20 })
      .map((term) => text(term).toLowerCase())
      .find((term) => /^[a-z][a-z0-9 ]*$/.test(term));
    if (latin) return latin;
  }
  return "";
};

const isNamingWord = (term = "") =>
  term.length >= 3 && /[a-z]{3,}/.test(term) && !LATIN_STOPWORDS.has(term) && !NUMBER_SPELLING.test(term.replace(/\s+/g, ""));

export const productNamingTerms = (message = "") => {
  const words = cleanMessage(message).split(" ").filter(Boolean);
  const terms = [];
  let run = [];
  const flushRun = () => {
    if (run.length > 1) terms.push(run.join(" "));
    run = [];
  };
  for (const word of words) {
    const latin = latinOf(word);
    const parts = latin.split(" ").filter(Boolean);
    if (parts.length && parts.every((part) => isNamingWord(part) || /^\d+$/.test(part))) {
      if (parts.some(isNamingWord)) {
        terms.push(...parts.filter(isNamingWord));
        if (parts.length > 1) terms.push(parts.join(" "));
        run.push(...parts);
        continue;
      }
    }
    flushRun();
  }
  flushRun();
  return [...new Set(terms)];
};

export default productNamingTerms;
