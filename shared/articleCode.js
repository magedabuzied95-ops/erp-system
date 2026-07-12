const cleanArticleCode = (value) => String(value ?? "").trim();

export const resolveEffectiveArticleCode = (variant = {}, color = {}) =>
  cleanArticleCode(variant.article_code ?? variant.articleCode ?? variant.variant_article_code) ||
  cleanArticleCode(
    color.color_article_code ??
      color.colorArticleCode ??
      variant.color_article_code ??
      variant.colorArticleCode
  ) ||
  null;

export const articleCodeSearchValues = (variant = {}, color = {}) =>
  [...new Set([
    cleanArticleCode(variant.article_code ?? variant.articleCode ?? variant.variant_article_code),
    cleanArticleCode(
      color.color_article_code ??
        color.colorArticleCode ??
        variant.color_article_code ??
        variant.colorArticleCode
    ),
  ].filter(Boolean))];

