export const getPosProductKey = (product = {}) => String(product?.product_id ?? product?.id ?? "").trim();

export const countUniqueVariantColors = (product = {}) => {
  const colors = new Set(
    (Array.isArray(product?.variants) ? product.variants : [])
      .map((variant) => String(variant?.color || "").trim())
      .filter(Boolean)
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
