/**
 * "Pairs well with" — the automatic pick, when the owner pinned nothing.
 *
 * The first version took the first in-stock product of a different type, and
 * the listing's audience filter keeps products with NO audience recorded, so a
 * men's sneaker was offered a kids' school bag. Now the pick is a score over the
 * candidates, behind hard rules a suggestion must never break:
 *
 *   must   same audience, recorded — an unrecorded audience is not "everyone"
 *   must   nothing for kids (school bags included) unless the product is for kids
 *   must   in stock, priced, and not the same model
 *   prefer same grade (mirror with mirror), a close price, a type that goes
 *          with it (sneakers ↔ slippers/crocs), then what sells
 *
 * Pure: every catalogue reading is handed in, so this runs under node:test.
 */

const text = (value) => String(value ?? "").trim().toLowerCase();

const FOOTWEAR = new Set(["sneakers", "shoes", "running", "casualshoes"]);
const LOUNGE = new Set(["slippers", "crocs"]);

// What completes a purchase of each family, best first. A shoe store's natural
// second item is the other half of the wardrobe: something for the house or the
// beach with a sneaker, a sneaker with slippers.
const complementOf = (type) => {
  if (FOOTWEAR.has(type)) return ["slippers", "crocs"];
  if (LOUNGE.has(type)) return ["sneakers", "shoes", "running", "casualshoes"];
  if (type === "bags") return ["sneakers", "shoes", "casualshoes"];
  return [];
};

const KIDS_PATTERN = /\b(kid|kids|child|children|junior|boys|girls|school)\b|أطفال|اطفال|طفل|مدرس|ولادي|بناتي/i;

export const isKidsOnlyProduct = (product = {}, audiences = []) => {
  if (audiences.includes("kids") && !audiences.some((value) => value !== "kids")) return true;
  if (/school/.test(text(product.bag_type || product.bagType))) return true;
  return KIDS_PATTERN.test(String(product.name || product.title || ""));
};

/**
 * @param {object[]} products candidates from the catalogue
 * @param {object} current the product being viewed
 * @param {object} ctx
 * @param {(product: object) => string[]} ctx.audiencesOf normalised audiences ("men" | "women" | "kids")
 * @param {(product: object) => number} ctx.priceOf the price a customer pays
 * @param {(product: object) => boolean} ctx.isSellable in stock with a size to pick
 * @param {(product: object) => string} ctx.typeOf normalised product type key
 * @returns {object|null}
 */
export const pickAutomaticPair = (products = [], current = {}, ctx = {}) => {
  const { audiencesOf = () => [], priceOf = () => 0, isSellable = () => true, typeOf = (product) => text(product?.product_type) } = ctx;
  const currentId = String(current?.id ?? "");
  const currentAudiences = audiencesOf(current);
  const currentIsKids = currentAudiences.includes("kids") || isKidsOnlyProduct(current, currentAudiences);
  const currentType = typeOf(current);
  const currentGrade = text(current?.grade || current?.quality);
  const currentBrand = text(current?.brand?.name || current?.brand_name || current?.brand);
  const currentPrice = priceOf(current);
  const complements = complementOf(currentType);

  const scored = [];
  products.forEach((product, index) => {
    const parentId = String(product?.parent_product_id ?? product?.id ?? "");
    if (!parentId || parentId === currentId) return;
    if (!isSellable(product)) return;
    const price = priceOf(product);
    if (!(price > 0)) return;

    const audiences = audiencesOf(product);
    // An audience nobody recorded is unknown, not universal.
    if (!audiences.length) return;
    if (currentAudiences.length && !currentAudiences.some((value) => audiences.includes(value))) return;
    if (!currentIsKids && isKidsOnlyProduct(product, audiences)) return;

    const type = typeOf(product);
    let score = 0;
    const complementRank = complements.indexOf(type);
    if (complementRank >= 0) score += 40 - complementRank * 5;
    else if (type && type === currentType) score += text(product?.brand?.name || product?.brand_name || product?.brand) !== currentBrand ? 15 : 5;
    else if (type === "bags") score -= 10; // a bag beside a shoe only when nothing better exists

    const grade = text(product?.grade || product?.quality);
    if (currentGrade && grade === currentGrade) score += 30;

    if (currentPrice > 0) {
      const ratio = price / currentPrice;
      if (ratio >= 0.5 && ratio <= 1.5) score += 25 - Math.round(Math.abs(1 - ratio) * 30);
      else score -= 15;
    }

    const sold = Number(product?.sold_count ?? product?.sales_count ?? 0) || 0;
    score += Math.min(10, Math.log10(1 + sold) * 5);

    // Earlier in the catalogue order breaks a tie, so the pick is stable.
    scored.push({ product, score, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.product || null;
};
