const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const lower = (value = "") => text(value).toLowerCase();

const normalizeArabic = (value = "") =>
  lower(value)
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const productName = (product = {}) => text(product.name || product.title || product.product_name || "");
const productCategory = (product = {}) => text(product.category || product.category_name || product.product_type || product.style || "");
const productBrand = (product = {}) => text(product.brand || product.brand_name || "");
const productPrice = (product = {}) => Number(product.final_price || product.sale_price || product.price || product.regular_price || 0) || 0;
const productStock = (product = {}) => Number(product.total_stock ?? product.stock ?? product.inventory_profile?.total_stock ?? 0) || 0;

const isSneakerLike = (product = {}) =>
  /sneaker|shoe|shoes|koutshi|كوتشي|sneakers|jordan|dunk|air force|shox|samba|campus|runner|running/i.test(
    `${productName(product)} ${productCategory(product)} ${productBrand(product)}`
  );

const isAccessory = (product = {}) =>
  /sock|socks|cleaner|brush|spray|lace|laces|insole|insoles|accessory|accessories|شراب|منظف|فرشاه|رباط/i.test(
    `${productName(product)} ${productCategory(product)}`
  );

const similarByCatalog = (products = [], selected = {}) => {
  const selectedCategory = normalizeArabic(productCategory(selected));
  const selectedBrand = normalizeArabic(productBrand(selected));
  const selectedPrice = productPrice(selected);
  return asArray(products)
    .filter((product) => product && (product.id || product.product_id))
    .filter((product) => {
      const sameCategory = selectedCategory ? normalizeArabic(productCategory(product)).includes(selectedCategory) || selectedCategory.includes(normalizeArabic(productCategory(product))) : true;
      const sameBrand = selectedBrand ? normalizeArabic(productBrand(product)).includes(selectedBrand) || selectedBrand.includes(normalizeArabic(productBrand(product))) : true;
      const price = productPrice(product);
      const withinRange = !selectedPrice || !price ? true : Math.abs(price - selectedPrice) / Math.max(selectedPrice, 1) <= 0.35;
      return sameCategory || sameBrand || withinRange;
    })
    .slice(0, 8);
};

export const buildCrossSellUpsellSuggestions = ({ conversation = {}, products = [], state = {}, selectedProduct = null, score = {} } = {}) => {
  const catalog = asArray(products);
  const primary = selectedProduct || conversation.current_product || conversation.product || catalog[0] || null;
  if (!primary) return [];

  const suggestions = [];
  const productId = primary.id || primary.product_id || null;
  const productLabel = productName(primary) || "المنتج";

  if (isSneakerLike(primary)) {
    const accessory = catalog.find((item) => item && item !== primary && isAccessory(item) && productStock(item) > 0) || null;
    if (accessory) {
      suggestions.push({
        type: "cross_sell",
        product_id: accessory.id || accessory.product_id,
        reason: "sneaker_accessory_match",
        confidence: 0.86,
        suggested_message: `وفيه ${productName(accessory)} مناسب جدًا مع ${productLabel} لو تحب أبعتهولك.`,
      });
    }
  }

  const betterAlternative = catalog
    .filter((item) => item && (item.id || item.product_id) && item !== primary)
    .sort((left, right) => Math.abs(productPrice(right) - productPrice(primary)) - Math.abs(productPrice(left) - productPrice(primary)))[0] || null;

  if (score?.score < 65 && betterAlternative) {
    suggestions.push({
      type: "upsell",
      product_id: betterAlternative.id || betterAlternative.product_id,
      reason: "higher_quality_or_close_match",
      confidence: 0.74,
      suggested_message: `فيه موديل أقوى وقريب منه في الشكل، تحب أشوفهولك بدل ${productLabel}؟`,
    });
  }

  const alternatives = similarByCatalog(catalog, primary).filter((item) => (item.id || item.product_id) !== productId).slice(0, 3);
  alternatives.forEach((item, index) => {
    suggestions.push({
      type: "alternative",
      product_id: item.id || item.product_id,
      reason: index === 0 ? "closest_catalog_match" : "catalog_similar_item",
      confidence: index === 0 ? 0.82 : 0.7,
      suggested_message: `ده بديل قريب من ${productLabel} في الشكل والسعر، تحب أبعتلك صورته؟`,
    });
  });

  return suggestions.slice(0, 5);
};

export default {
  buildCrossSellUpsellSuggestions,
};
