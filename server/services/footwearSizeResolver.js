// AI Studio Phase 10.7 — Unified footwear size resolver for AI Inbox grounding.
// ---------------------------------------------------------------------------
// A PURE, in-memory resolver that maps a customer-facing footwear size (EU numeric like "44", or a Crocs
// factory marking like "M10/W12"/"C10"/"J5"/"22/23") to the ACTUAL variant sizes present on a product,
// using the ONE canonical Crocs table (src/shared/lib/crocsSizes.js) — no duplicated mapping data here.
// Available variant sizes are authoritative: a theoretically valid EU that does not exist on THIS product
// is NO_VARIANT_MATCH, never "available". Product-type aware: Crocs conversion is applied only to Crocs;
// ordinary numeric footwear stays literal. No DB, no I/O.

import {
  isCrocsProduct,
  normalizeCrocsSizeValue,
  resolveCrocsEuSize,
  isKnownCrocsSize,
  CROCS_CANONICAL_SIZE_MAP,
} from "../../src/shared/lib/crocsSizes.js";

export const SIZE_MATCH = Object.freeze({
  EXACT_CANONICAL: "EXACT_CANONICAL",   // ordinary footwear, requested size equals a variant size verbatim
  EXACT_ALIAS: "EXACT_ALIAS",           // Crocs, requested is a known marking/EU-double present on the product
  UNIQUE_CONVERSION: "UNIQUE_CONVERSION", // Crocs, requested EU number maps to exactly one available size
  AMBIGUOUS_CONVERSION: "AMBIGUOUS_CONVERSION", // requested EU number maps to >1 distinct available sizes
  NO_MAPPING: "NO_MAPPING",             // no canonical mapping exists for the requested value
  NO_VARIANT_MATCH: "NO_VARIANT_MATCH", // valid size but not present on this product
});

const uniq = (arr) => [...new Set((arr || []).filter((v) => v !== null && v !== undefined && v !== ""))];
const normNum = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

// Does an EU double like "43/44" (or a bare "44") contain the integer num?
const euContains = (euValue, num) => {
  const m = String(euValue || "").match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[1]) === num || Number(m[2]) === num;
  return String(euValue || "").trim() === String(num);
};
const fullMapEuContains = (num) => CROCS_CANONICAL_SIZE_MAP.some((e) => euContains(e.eu, num));
const sameCrocsSize = (a, b) => normalizeCrocsSizeValue(a) === normalizeCrocsSizeValue(b) || resolveCrocsEuSize(a) === resolveCrocsEuSize(b);

// resolveFootwearSize — pure. Returns the deterministic match state + which real variant size(s) matched.
// { requested, matchType, canonicalMatches:[<variant size string>], euSize, displaySize, ambiguous }
export const resolveFootwearSize = ({ productType = "", requestedSize = "", availableVariantSizes = [] } = {}) => {
  const req = String(requestedSize || "").trim();
  const sizes = uniq((availableVariantSizes || []).map((s) => String(s || "").trim()));
  const base = { requested: req, canonicalMatches: [], euSize: req, displaySize: req, ambiguous: false };
  if (!req) return { ...base, matchType: SIZE_MATCH.NO_MAPPING };

  // Ordinary footwear: literal exact match against variant sizes (no conversion). "44" → EXACT_CANONICAL.
  if (!isCrocsProduct({ product_type: productType })) {
    const matches = sizes.filter((s) => normNum(s) === normNum(req));
    return matches.length
      ? { ...base, matchType: SIZE_MATCH.EXACT_CANONICAL, canonicalMatches: uniq(matches) }
      : { ...base, matchType: SIZE_MATCH.NO_VARIANT_MATCH };
  }

  // Crocs.
  const reqNorm = normalizeCrocsSizeValue(req); // "M10/W12", "C10", "J5", "43/44", or a bare number unchanged
  const reqNum = /^\d+$/.test(req) ? Number(req) : null;

  // Case A: the request is itself a known Crocs marking / EU-double (M10/W12, M10, C10, J5, 22/23, 43/44).
  if (isKnownCrocsSize(reqNorm)) {
    const reqEu = resolveCrocsEuSize(reqNorm);
    const matches = sizes.filter((s) => sameCrocsSize(s, reqNorm));
    const distinctEu = uniq(matches.map((s) => resolveCrocsEuSize(s)));
    if (matches.length === 0) return { ...base, matchType: SIZE_MATCH.NO_VARIANT_MATCH, euSize: reqEu, displaySize: reqEu };
    if (distinctEu.length > 1) return { ...base, matchType: SIZE_MATCH.AMBIGUOUS_CONVERSION, canonicalMatches: uniq(matches), euSize: reqEu, displaySize: reqEu, ambiguous: true };
    return { ...base, matchType: SIZE_MATCH.EXACT_ALIAS, canonicalMatches: uniq(matches), euSize: reqEu, displaySize: reqEu };
  }

  // Case B: a bare EU number ("44"). Match variants whose EU-double contains it.
  if (reqNum) {
    const matches = sizes.filter((s) => euContains(resolveCrocsEuSize(s), reqNum));
    const distinctEu = uniq(matches.map((s) => resolveCrocsEuSize(s)));
    if (matches.length === 0) {
      return { ...base, matchType: fullMapEuContains(reqNum) ? SIZE_MATCH.NO_VARIANT_MATCH : SIZE_MATCH.NO_MAPPING };
    }
    if (distinctEu.length > 1) return { ...base, matchType: SIZE_MATCH.AMBIGUOUS_CONVERSION, canonicalMatches: uniq(matches), euSize: distinctEu.join(" / "), ambiguous: true };
    return { ...base, matchType: SIZE_MATCH.UNIQUE_CONVERSION, canonicalMatches: uniq(matches), euSize: distinctEu[0] };
  }

  return { ...base, matchType: SIZE_MATCH.NO_MAPPING };
};

// Convert a stored variant size (marking) to the customer-facing display (EU) for hints/round-trip.
export const toDisplaySize = (variantSize, productType = "crocs") =>
  isCrocsProduct({ product_type: productType }) ? resolveCrocsEuSize(variantSize) : String(variantSize || "");
