const cleanArticleCode = (value) => String(value ?? "").trim();

export const normalizeArticleCodes = (...values) => {
  const flattened = values.flat(Infinity);
  return [...new Set(flattened.map(cleanArticleCode).filter(Boolean))];
};

export const resolveEffectiveArticleCode = (variant = {}, color = {}) =>
  cleanArticleCode(variant.article_code ?? variant.articleCode ?? variant.variant_article_code) ||
  normalizeArticleCodes(
    variant.article_codes,
    variant.articleCodes,
    color.color_article_codes,
    color.colorArticleCodes,
    variant.color_article_codes,
    variant.colorArticleCodes
  )[0] ||
  cleanArticleCode(
    color.color_article_code ??
      color.colorArticleCode ??
      variant.color_article_code ??
      variant.colorArticleCode
  ) ||
  null;

export const articleCodeSearchValues = (variant = {}, color = {}) =>
  normalizeArticleCodes(
    variant.article_codes,
    variant.articleCodes,
    color.color_article_codes,
    color.colorArticleCodes,
    variant.color_article_codes,
    variant.colorArticleCodes,
    cleanArticleCode(variant.article_code ?? variant.articleCode ?? variant.variant_article_code),
    cleanArticleCode(
      color.color_article_code ??
        color.colorArticleCode ??
        variant.color_article_code ??
        variant.colorArticleCode
    )
  );


// A size row carries its own Article Code only when someone typed one there.
// Until then it follows the colour, so adding a code at the colour level shows
// up on every size instead of leaving the rows blank.
export const rowInheritsColorArticleCodes = (row = {}) => {
  if (typeof row?.article_code_inherited === "boolean") return row.article_code_inherited;
  return normalizeArticleCodes(row?.article_codes, row?.article_code).length === 0;
};

export const applyColorArticleCodesToRows = (rows = [], colorCodes = []) => {
  const codes = normalizeArticleCodes(colorCodes);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!rowInheritsColorArticleCodes(row)) return row;
    return { ...row, article_codes: codes, article_code: codes[0] || "", article_code_inherited: true };
  });
};
