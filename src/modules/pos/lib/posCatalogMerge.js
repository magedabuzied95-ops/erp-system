export const getPosProductKey = (product = {}) => String(product?.product_id ?? product?.id ?? "").trim();

// A product can carry several DIFFERENT colour groups sharing one colour name (e.g.
// four separate "Black" articles on one Crocs product). Keying colours by name alone
// collapses them into a single option with one image and a summed stock, hiding real
// colours from the seller. `color_group_key` is the same identity the product page
// groups by; the name is only a fallback for variants created before the key existed.
export const getVariantColorKey = (variant = {}) => {
  const group = String(variant?.color_group_key ?? variant?.colorGroupKey ?? "").trim();
  if (group) return `g:${group}`;
  return `c:${String(variant?.color || "").trim().toLowerCase()}`;
};

// Counts colour GROUPS, not colour names.
export const countUniqueVariantColors = (product = {}) => {
  const colors = new Set(
    (Array.isArray(product?.variants) ? product.variants : [])
      .filter((variant) => String(variant?.color_group_key || variant?.colorGroupKey || variant?.color || "").trim())
      .map((variant) => getVariantColorKey(variant))
  );
  return colors.size;
};

const isArticleSearchProduct = (product = {}) =>
  String(product?.search_match_type || product?.searchMatchType || "").trim().toLowerCase() === "variant_article";

const pickFullerVariants = (currentProduct = {}, incomingProduct = {}) => {
  const currentVariants = Array.isArray(currentProduct?.variants) ? currentProduct.variants : [];
  const incomingVariants = Array.isArray(incomingProduct?.variants) ? incomingProduct.variants : [];
  if (!isArticleSearchProduct(incomingProduct)) return incomingVariants;
  if (currentVariants.length > incomingVariants.length) return currentVariants;
  if (countUniqueVariantColors(currentProduct) > countUniqueVariantColors(incomingProduct)) return currentVariants;
  return incomingVariants;
};

export const mergeCatalogProduct = (currentProduct = null, incomingProduct = {}) => {
  if (!currentProduct) return incomingProduct;
  return {
    ...currentProduct,
    ...incomingProduct,
    variants: pickFullerVariants(currentProduct, incomingProduct),
  };
};

export const mergeCatalogProducts = (current = [], incoming = []) => {
  const byId = new Map();
  (Array.isArray(current) ? current : []).forEach((product) => {
    const key = getPosProductKey(product);
    if (key) byId.set(key, product);
  });
  (Array.isArray(incoming) ? incoming : []).forEach((product) => {
    const key = getPosProductKey(product);
    if (key) byId.set(key, mergeCatalogProduct(byId.get(key), product));
  });
  return Array.from(byId.values());
};
