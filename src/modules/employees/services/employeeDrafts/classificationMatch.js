/**
 * Matching a product's own words against the shop's CONFIGURED classification.
 *
 * The data says "mirror_original", "Uncategorized", "local"; the filter the
 * owner set up says "أصلي", "مرايا", "محلي". A filter built from the raw words
 * offers five spellings of the same thing and matches none of them, which is
 * what the stock count's filter was doing. These map a raw value onto the
 * configured option it belongs to, so the count filters on exactly what the POS
 * filters on.
 *
 * Pure and framework-free: the search index, which runs on the phone with no
 * network, imports it directly.
 */
import { normalizeClassificationValue } from "../../../products/lib/productClassifications.js";

export const normalizeFilterValue = (value = "") => normalizeClassificationValue(value);

/** The configured option a raw value belongs to, or the value itself. */
export const resolveConfiguredFilterValue = (value, options = []) => {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return "";
  const match = (Array.isArray(options) ? options : []).find((option) =>
    [option?.value, option?.id, option?.name, option?.label, option?.label_ar, option?.label_en]
      .map(normalizeFilterValue)
      .filter(Boolean)
      .includes(normalized)
  );
  return normalizeFilterValue(match?.value || match?.id || normalized);
};

/**
 * What the user picked, as a list. The filter sheet hands back a string for a
 * single-choice facet and an array for a multi-choice one, and "all" or ""
 * means they picked nothing.
 */
export const selectedFilterValues = (selected) => {
  const list = Array.isArray(selected) ? selected : [selected];
  return [...new Set(
    list
      .map((value) => normalizeFilterValue(value))
      .filter((value) => value && value !== "all")
  )];
};

/** Nothing picked matches everything; otherwise any one of the picks will do. */
export const facetMatches = (selected, candidates = []) => {
  const wanted = selectedFilterValues(selected);
  if (!wanted.length) return true;
  const have = (Array.isArray(candidates) ? candidates : [candidates])
    .map((value) => normalizeFilterValue(value))
    .filter(Boolean);
  return wanted.some((value) => have.includes(value));
};
