import { ARABIC_INTENT_SYNONYMS } from "../config/arabicIntentSynonyms.js";

const ARABIC_DIACRITICS_REGEX = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const TATWEEL_REGEX = /\u0640/g;
const BIDI_MARKS_REGEX = /[\u200f\u200e]/g;
const SPACE_REGEX = /\s+/g;
const PUNCTUATION_TO_SPACE_REGEX = /[^\p{L}\p{N}\s]+/gu;
const REPEATED_LETTERS_REGEX = /(\p{L})\1{2,}/gu;

const DIGIT_MAP = Object.freeze({
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
});

const CHAR_MAP = Object.freeze({
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
  "ة": "ه",
  "ى": "ي",
  "ؤ": "و",
  "ئ": "ي",
});

const toText = (value = "") => String(value ?? "");

const replaceMappedChars = (value = "") =>
  Array.from(value, (char) => DIGIT_MAP[char] || CHAR_MAP[char] || char).join("");

const collapseRepeatedLetters = (value = "") => value.replace(REPEATED_LETTERS_REGEX, "$1");

const normalizeArabicPunctuation = (value = "") =>
  value.replace(PUNCTUATION_TO_SPACE_REGEX, " ");

const normalizeBaseText = (input = "") => {
  const lowered = toText(input).toLowerCase();
  const stripped = lowered
    .replace(ARABIC_DIACRITICS_REGEX, "")
    .replace(TATWEEL_REGEX, "")
    .replace(BIDI_MARKS_REGEX, "");
  return replaceMappedChars(stripped)
    .replace(SPACE_REGEX, " ")
    .trim();
};

const normalizeTextForIntent = (value = "") => {
  const normalized = normalizeArabicPunctuation(value)
    .replace(/\b(size|sizes?|price|prices?|cost|photo|photos?|image|images?|want|need|looking for|more images|more photos|more pictures)\b/gi, (match) => {
      const token = match.toLowerCase();
      if (/(size|sizes?)/.test(token)) return "مقاس";
      if (/(price|prices?|cost)/.test(token)) return "سعر";
      if (/(photo|photos?|image|images?)/.test(token)) return "صور";
      if (/(want|need|looking for)/.test(token)) return "عايز";
      return match;
    });

  return collapseRepeatedLetters(normalized)
    .replace(SPACE_REGEX, " ")
    .trim();
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasCanonicalMatch = (text = "", alias = "") => {
  const normalizedAlias = normalizeTextForIntent(normalizeBaseText(alias));
  if (!normalizedAlias) return false;
  const normalizedText = ` ${normalizeTextForIntent(text)} `;
  const pattern = `(^|[^\\p{L}\\p{N}])${escapeRegex(normalizedAlias)}([^\\p{L}\\p{N}]|$)`;
  return new RegExp(pattern, "iu").test(normalizedText);
};

const extractSizeSignals = (originalText = "", normalizedForIntent = "") => {
  const signals = [];
  const sizeTerms = ["مقاس", "سايز", "size", "sizes"];
  if (sizeTerms.some((alias) => hasCanonicalMatch(normalizedForIntent, alias) || hasCanonicalMatch(originalText, alias))) {
    signals.push("size");
  }
  const sizeNumberMatches = Array.from(
    normalizedForIntent.matchAll(/\b(3[0-9]|4[0-9]|5[0-5])\b/g),
    (match) => match[1]
  );
  if (sizeNumberMatches.length) {
    signals.push("size");
  }
  return signals;
};

const buildCanonicalSignals = (payload = {}) => {
  const normalizedText = toText(payload.normalizedText || "");
  const normalizedForIntent = toText(payload.normalizedForIntent || normalizedText);
  const originalText = toText(payload.originalText || "");
  const signals = new Set();

  for (const [canonical, aliases] of Object.entries(ARABIC_INTENT_SYNONYMS)) {
    if (!Array.isArray(aliases) || !aliases.length) continue;
    if (aliases.some((alias) => hasCanonicalMatch(normalizedForIntent, alias) || hasCanonicalMatch(originalText, alias) || hasCanonicalMatch(normalizedText, alias))) {
      signals.add(canonical);
    }
  }

  for (const signal of extractSizeSignals(originalText, normalizedForIntent)) {
    signals.add(signal);
  }

  if (signals.has("no")) {
    signals.add("reject");
  }

  return [...signals];
};

const buildIntentTokens = (value = "") =>
  normalizeTextForIntent(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

export const normalizeArabicMessage = (input = "") => {
  const normalized = normalizeBaseText(input);
  return collapseRepeatedLetters(normalized).replace(SPACE_REGEX, " ").trim();
};

export const normalizeArabicIntentPayload = (input = "") => {
  const originalText = toText(input);
  const normalizedText = normalizeArabicMessage(originalText);
  const normalizedForIntent = normalizeTextForIntent(normalizedText);
  const intentTokens = buildIntentTokens(normalizedForIntent);
  const canonicalSignals = buildCanonicalSignals({
    originalText,
    normalizedText,
    normalizedForIntent,
    intentTokens,
  });

  return {
    originalText,
    normalizedText,
    normalizedForIntent,
    intentTokens,
    canonicalSignals,
  };
};

export const normalizeArabicForIntent = (input = "") => normalizeArabicIntentPayload(input).normalizedForIntent;

export const buildArabicCanonicalSignals = (input = "") => normalizeArabicIntentPayload(input).canonicalSignals;

export default {
  buildArabicCanonicalSignals,
  normalizeArabicForIntent,
  normalizeArabicIntentPayload,
  normalizeArabicMessage,
};
