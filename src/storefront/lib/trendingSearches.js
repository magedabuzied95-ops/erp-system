/*
 * "Trending" in the search sheet, from what actually sells.
 *
 * It used to be six words hardcoded in the locale files ("Jordan 4", "Size 42", "Mirror Original"),
 * the same for men, women and kids and unchanged since they were typed. The storefront already
 * ranks the catalogue by units sold (sort=best_sellers, net of returns), so the row is built from
 * that: one entry per MODEL, not per colour card — the best-seller list is 22 colours of the same
 * Air Jordan 1 Low before anything else appears — each with the photo of its best-selling colour.
 * Framework-free so the grouping can be tested on its own.
 */

// Words that describe the category rather than name the model: "Nike Air Jordan 1 Low Sneakers"
// is searched, and remembered, as "Nike Air Jordan 1 Low".
const CATEGORY_WORDS = /\s+(sneakers?|shoes?|slippers?|sandals?|boots?|trainers?)$/i;
// "Tommy Hilfiger Sneakers for Men" — the audience is already the tab the shopper is on.
const AUDIENCE_SUFFIX = /\s+for\s+(men|women|kids|boys|girls)$/i;

export const trendingModelName = (name = "") => {
  const base = String(name || "")
    .split(/\s+-\s+/)[0]
    .replace(/\s+/g, " ")
    .trim();
  return base.replace(AUDIENCE_SUFFIX, "").replace(CATEGORY_WORDS, "").trim() || base;
};

export const buildTrendingSearches = (products = [], { max = 10 } = {}) => {
  const byModel = new Map();
  (Array.isArray(products) ? products : []).forEach((product, index) => {
    const term = trendingModelName(product?.name);
    if (term.length < 2) return;
    const key = term.toLocaleLowerCase();
    const sold = Number(product?.sold_count || 0);
    const current = byModel.get(key);
    if (!current) {
      byModel.set(key, { term, product, sold, order: index, colours: 1 });
      return;
    }
    current.colours += 1;
    // The photo follows the model's best-selling colour.
    if (sold > current.sold) {
      current.sold = sold;
      current.product = product;
    }
  });
  return [...byModel.values()]
    .sort((left, right) => right.sold - left.sold || left.order - right.order)
    .slice(0, max)
    .map(({ term, product, sold, colours }) => ({ term, product, sold, colours }));
};
