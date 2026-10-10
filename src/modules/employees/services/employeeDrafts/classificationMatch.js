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

/**
 * Comparing a product's word with an option's word.
 *
 * The canonical normaliser keeps ASCII only, so an Arabic word normalises to the
 * empty string: a colour whose grade is stored as "اصلي" could never be recognised as
 * the option whose Arabic label is "اصلي", and fell out of every chip. Matching folds
 * instead — case, Arabic letter variants, tashkeel, spacing — while the value
 * that comes BACK is still the option's canonical one, so what the filter
 * carries around is unchanged.
 */
const ALIAS_DIACRITICS = /[ً-ٰٟـ]/g;
const foldAlias = (value = "") =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(ALIAS_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\s-]+/g, "_");

const optionAliases = (option = {}) =>
  [option?.value, option?.id, option?.name, option?.label, option?.label_ar, option?.label_en]
    .map((alias) => foldAlias(alias))
    .filter(Boolean);

/** The configured option a raw value belongs to, or the value itself. */
export const resolveConfiguredFilterValue = (value, options = []) => {
  const folded = foldAlias(value);
  if (!folded) return "";
  const match = (Array.isArray(options) ? options : []).find((option) => optionAliases(option).includes(folded));
  if (match) return normalizeFilterValue(match.value || match.id || match.name);
  // Nothing configured covers it: the value keeps its own canonical form.
  return normalizeFilterValue(value);
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
