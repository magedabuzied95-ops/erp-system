// Arabic names are not written consistently. The same customer is stored as
// "عبد الرحمن" in one place and "عبدالرحمن" in another, with or without the
// hamza carriers (أ إ آ), with ة or ه at the end, with ى or ي, and sometimes
// with tashkeel or a tatweel stretch. A plain LOWER(...) LIKE '%term%' matches
// none of those against each other, so a search for one spelling silently hides
// every customer written the other way.
//
// Both sides of the comparison are folded to the same skeleton: the query and
// the column go through the identical expression, so the JS and SQL forms can
// never drift apart.

// Characters folded onto a canonical letter. Order matters: it pairs with
// ARABIC_FOLD_TO position by position.
const ARABIC_FOLD_FROM = "أإآٱؤئىة";
const ARABIC_FOLD_TO = "ااااوييه";

// Dropped outright. translate() deletes any `from` character with no `to`
// counterpart, so these are appended after the folded pairs: tatweel, the
// tashkeel marks, and the superscript alef.
const ARABIC_STRIP =
  "ـًٌٍَُِّْٰٕٓٔ";

const FOLD_FROM_SQL = `${ARABIC_FOLD_FROM}${ARABIC_STRIP}`;

// Separators are removed rather than collapsed, which is what makes
// "عبدالرحمن" and "عبد الرحمن" the same string. Titles such as "د / عبد الرحمن"
// fold to "دعبدالرحمن", where the name is still found as a substring.
const SEPARATOR_PATTERN = "[[:space:][:punct:]]";

/**
 * SQL expression that folds `expression` into its searchable skeleton.
 * Safe to wrap any text-ish column or a bind parameter.
 */
export const arabicSearchSql = (expression) =>
  `regexp_replace(translate(LOWER(COALESCE(${expression}, '')::text), '${FOLD_FROM_SQL}', '${ARABIC_FOLD_TO}'), '${SEPARATOR_PATTERN}', '', 'g')`;

/**
 * JS twin of arabicSearchSql, for matching that already happened in memory.
 */
export const arabicSearchText = (value = "") => {
  const lowered = String(value ?? "").toLowerCase();
  let folded = "";
  for (const character of lowered) {
    const foldIndex = ARABIC_FOLD_FROM.indexOf(character);
    if (foldIndex >= 0) {
      folded += ARABIC_FOLD_TO[foldIndex];
      continue;
    }
    if (ARABIC_STRIP.includes(character)) continue;
    folded += character;
  }
  return folded.replace(/[\s\p{P}\p{S}]+/gu, "");
};

/**
 * Builds a normalized "contains" condition against a bind parameter that holds
 * the raw search term. The parameter is folded by the same expression as the
 * column, so the caller passes the term through untouched.
 */
export const arabicSearchContainsSql = (expression, termPlaceholder) =>
  `${arabicSearchSql(expression)} LIKE '%' || ${arabicSearchSql(termPlaceholder)} || '%'`;
