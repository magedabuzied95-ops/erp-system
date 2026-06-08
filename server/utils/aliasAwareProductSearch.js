import { normalizeArabicIntentPayload } from "./arabicTextNormalizer.js";

const toText = (value = "") => String(value ?? "").trim();
const unique = (items = [], limit = 12) => [...new Set(items.map(toText).filter(Boolean))].slice(0, limit);

const splitCompact = (value = "") =>
  unique(
    toText(value)
      .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
      .split(/\s+/)
  );

export const buildAliasAwareSearchHints = ({ text = "", aliasResult = null } = {}) => {
  const originalText = toText(text);
  const intentPayload = normalizeArabicIntentPayload(originalText);
  const canonicalProduct = toText(aliasResult?.canonicalProduct || "");
  const matchedAlias = toText(aliasResult?.matchedAlias || "");
  const searchTerms = unique(aliasResult?.searchTerms || [], 8);
  const normalizedText = toText(intentPayload.normalizedText || "");
  const normalizedForIntent = toText(intentPayload.normalizedForIntent || "");
  const productQueryHints = unique([
    canonicalProduct,
    matchedAlias,
    ...searchTerms,
    normalizedForIntent,
    normalizedText,
    ...splitCompact(normalizedForIntent),
  ]);

  return {
    originalText,
    canonicalProduct: canonicalProduct || null,
    searchTerms: canonicalProduct ? searchTerms : [],
    productQueryHints,
    hasAliasHint: Boolean(canonicalProduct),
  };
};

export default {
  buildAliasAwareSearchHints,
};
