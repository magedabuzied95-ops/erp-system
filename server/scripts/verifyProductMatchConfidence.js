import assert from "node:assert/strict";
import { normalizeArabicIntentPayload } from "../utils/arabicTextNormalizer.js";
import { resolveProductAlias } from "../utils/productAliasResolver.js";
import { buildAliasAwareSearchHints } from "../utils/aliasAwareProductSearch.js";
import { rankProductCandidates, scoreProductCandidate } from "../utils/productMatchConfidence.js";

const rankCase = ({ input, candidates, expectedBestId, expectedFallback = false }) => {
  const normalizedPayload = normalizeArabicIntentPayload(input);
  const aliasResult = resolveProductAlias(input);
  const searchHints = buildAliasAwareSearchHints({ text: input, aliasResult });
  const result = rankProductCandidates({
    candidates,
    text: input,
    normalizedPayload,
    aliasResult,
    searchHints,
    intentPayload: normalizedPayload,
  });
  assert.equal(result.fallbackRecommended, expectedFallback, `Unexpected fallback state for "${input}"`);
  assert.equal(result.bestMatch?.id || result.bestMatch?.product_id || null, expectedBestId, `Unexpected best match for "${input}"`);
  console.log(JSON.stringify({
    input,
    bestMatchId: result.bestMatch?.id || result.bestMatch?.product_id || null,
    bestMatchName: result.bestMatch?.name || result.bestMatch?.title || result.bestMatch?.product_name || "",
    confidence: result.confidence,
    reasons: result.bestMatch?.product_match_reasons || [],
    fallbackRecommended: result.fallbackRecommended,
  }));
  return result;
};

const nikeShoxCandidates = [
  { id: 1, name: "Nike Running Lite", brand: "Nike", stock: 12 },
  { id: 2, name: "Nike Shox TL", brand: "Nike", stock: 9, color: "white", sizes: ["42"] },
];
rankCase({ input: "عايز شوكس", candidates: nikeShoxCandidates, expectedBestId: 2, expectedFallback: false });

const sizeColorCandidates = [
  { id: 10, name: "Nike Shox TL White", brand: "Nike", color_name: "White", sizes: ["41", "42"], stock: 8 },
  { id: 11, name: "Nike Shox TL Black", brand: "Nike", color_name: "Black", sizes: ["42"], stock: 8 },
];
const sizeColorResult = rankCase({ input: "شوكس ابيض مقاس ٤٢", candidates: sizeColorCandidates, expectedBestId: 10, expectedFallback: false });
assert.ok(
  (sizeColorResult.rankedCandidates[0]?.product_match_signals || []).includes("color_match") ||
    (sizeColorResult.rankedCandidates[0]?.product_match_signals || []).includes("size_match")
);

const jordanCandidates = [
  { id: 20, name: "Air Jordan 1 Low", brand: "Jordan", stock: 11 },
  { id: 21, name: "Air Jordan 4", brand: "Jordan", stock: 11 },
];
rankCase({ input: "جوردن فور", candidates: jordanCandidates, expectedBestId: 21, expectedFallback: false });

const skechersCandidates = [
  { id: 30, name: "Running Shoe Pro", brand: "Sport", stock: 7 },
  { id: 31, name: "Skechers Go Walk", brand: "Skechers", stock: 7 },
];
rankCase({ input: "اسكتشر", candidates: skechersCandidates, expectedBestId: 31, expectedFallback: false });

const unknownResult = rankCase({
  input: "منتج غريب جدا",
  candidates: [
    { id: 40, name: "Random Shoe", brand: "Unknown", stock: 0 },
    { id: 41, name: "Another Random Shoe", brand: "Unknown", stock: 0 },
  ],
  expectedBestId: null,
  expectedFallback: true,
});
assert.equal(unknownResult.bestMatch, null);

const outOfStockCandidate = scoreProductCandidate({
  product: { id: 50, name: "Nike Shox TL", brand: "Nike", stock: 0, color_name: "White", sizes: ["42"] },
  text: "عايز شوكس ابيض مقاس ٤٢",
  normalizedPayload: normalizeArabicIntentPayload("عايز شوكس ابيض مقاس ٤٢"),
  aliasResult: resolveProductAlias("عايز شوكس ابيض مقاس ٤٢"),
  searchHints: buildAliasAwareSearchHints({ text: "عايز شوكس ابيض مقاس ٤٢", aliasResult: resolveProductAlias("عايز شوكس ابيض مقاس ٤٢") }),
});
const inStockCandidate = scoreProductCandidate({
  product: { id: 51, name: "Nike Shox TL", brand: "Nike", stock: 7, color_name: "White", sizes: ["42"] },
  text: "عايز شوكس ابيض مقاس ٤٢",
  normalizedPayload: normalizeArabicIntentPayload("عايز شوكس ابيض مقاس ٤٢"),
  aliasResult: resolveProductAlias("عايز شوكس ابيض مقاس ٤٢"),
  searchHints: buildAliasAwareSearchHints({ text: "عايز شوكس ابيض مقاس ٤٢", aliasResult: resolveProductAlias("عايز شوكس ابيض مقاس ٤٢") }),
});
assert.ok(outOfStockCandidate.confidence < inStockCandidate.confidence, "Expected out-of-stock candidate to be penalized");

console.log("Verified product match confidence ranking cases.");
