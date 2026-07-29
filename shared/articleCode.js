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

