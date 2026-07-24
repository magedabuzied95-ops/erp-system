const normalize = (value = "") => String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");

const values = (product = {}) => [
  product.product_type,
  product.productType,
  product.category_slug,
  product.categorySlug,
  product.category?.slug,
  product.category?.code,
  product.classification,
  product.fashion_category,
].map(normalize).filter(Boolean);

// These are the canonical values used by the product editor/classification service.
const CROCS = new Set(["crocs"]);
const BAGS = new Set(["bags", "bag", "women-bags", "womens-bags", "handbags"]);
const BOXED_SHOES = new Set(["sneakers", "shoes", "shoe", "footwear"]);

export const PRINT_PRODUCT_KINDS = Object.freeze({
  BOXED_SHOES: "boxed_shoes",
  CROCS: "crocs",
  BAGS: "bags",
  FALLBACK: "fallback",
});

export function classifyPrintProduct(product = {}) {
  const candidates = values(product);
  if (candidates.some((value) => CROCS.has(value))) return { kind: PRINT_PRODUCT_KINDS.CROCS, matchedBy: candidates.find((value) => CROCS.has(value)) };
  if (candidates.some((value) => BAGS.has(value))) return { kind: PRINT_PRODUCT_KINDS.BAGS, matchedBy: candidates.find((value) => BAGS.has(value)) };
  if (candidates.some((value) => BOXED_SHOES.has(value))) return { kind: PRINT_PRODUCT_KINDS.BOXED_SHOES, matchedBy: candidates.find((value) => BOXED_SHOES.has(value)) };
  return {
    kind: PRINT_PRODUCT_KINDS.FALLBACK,
    matchedBy: "",
    warning: `تعذر تصنيف المنتج "${product.name || product.id || "غير معروف"}"؛ تم استخدام ملصق 100×50 القديم.`,
  };
}

