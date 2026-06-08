import { PRODUCT_ALIASES } from "../config/productAliases.js";
import { normalizeArabicIntentPayload } from "./arabicTextNormalizer.js";

const toText = (value = "") => String(value ?? "").trim();
const unique = (items = []) => [...new Set(items.map(toText).filter(Boolean))];

const getAliasDefinition = (entry = []) => {
  if (Array.isArray(entry)) {
    const aliases = unique(entry);
    return { aliases, searchTerms: aliases };
  }
  if (entry && typeof entry === "object") {
    const aliases = unique(entry.aliases || []);
    const searchTerms = unique(entry.searchTerms || entry.aliases || []);
    return { aliases, searchTerms };
  }
  return { aliases: [], searchTerms: [] };
};

const normalizeAliasValue = (value = "") => {
  const payload = normalizeArabicIntentPayload(value);
  return unique([payload.normalizedForIntent, payload.normalizedText, payload.originalText]);
};

const buildAliasVariants = (alias = "") => {
  const variants = normalizeAliasValue(alias);
  return unique([
    ...variants,
    ...variants.map((value) => value.replace(/\s+/g, " ")),
  ]);
};

const boundaryRegex = (phrase = "") => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu");
};

const scoreMatch = ({ normalizedText = "", normalizedForIntent = "", alias = "", isExact = false, isPhrase = false } = {}) => {
  if (isExact) return 0.98;
  if (isPhrase) return 0.95;
  if (normalizedText === alias || normalizedForIntent === alias) return 0.98;
  return 0.9;
};

export const resolveProductAlias = (input = "") => {
  const intentPayload = normalizeArabicIntentPayload(input);
  const normalizedText = intentPayload.normalizedText || "";
  const normalizedForIntent = intentPayload.normalizedForIntent || "";
  const searchSpace = ` ${normalizedForIntent} ${normalizedText} `;

  let bestMatch = {
    canonicalProduct: null,
    matchedAlias: null,
    confidence: 0,
  };

  for (const [canonicalProduct, definition] of Object.entries(PRODUCT_ALIASES)) {
    const { aliases, searchTerms } = getAliasDefinition(definition);
    for (const alias of aliases || []) {
      const variants = buildAliasVariants(alias);
      for (const variant of variants) {
        const normalizedAlias = normalizeArabicIntentPayload(variant).normalizedForIntent || normalizeArabicIntentPayload(variant).normalizedText;
        if (!normalizedAlias) continue;
        const exactMatch = normalizedForIntent === normalizedAlias || normalizedText === normalizedAlias;
        const phraseMatch = !exactMatch && boundaryRegex(normalizedAlias).test(searchSpace);
        if (!exactMatch && !phraseMatch) continue;
        const confidence = scoreMatch({
          normalizedText,
          normalizedForIntent,
          alias: normalizedAlias,
          isExact: exactMatch,
          isPhrase: phraseMatch,
        });
        if (confidence > bestMatch.confidence) {
          bestMatch = {
            canonicalProduct,
            matchedAlias: alias,
            confidence,
            searchTerms,
          };
        }
      }
    }
  }

  return bestMatch.canonicalProduct
    ? bestMatch
    : {
        canonicalProduct: null,
        matchedAlias: null,
        confidence: 0,
        searchTerms: [],
      };
};

export default {
  resolveProductAlias,
};
