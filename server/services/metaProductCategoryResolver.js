const clean = (value = "") => String(value ?? "").trim();

const normalize = (value = "") =>
  clean(value)
    .toLocaleLowerCase("en-US")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[ـ_]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const GOOGLE_PRODUCT_CATEGORIES = Object.freeze({
  SNEAKERS: "Apparel & Accessories > Shoes > Athletic Shoes",
  CROCS: "Apparel & Accessories > Shoes",
  SLIPPERS: "Apparel & Accessories > Shoes > Slippers",
  BAGS: "Apparel & Accessories > Handbags, Wallets & Cases > Handbags",
  SHOES: "Apparel & Accessories > Shoes",
});

const PRODUCT_TYPE_MAPPINGS = Object.freeze([
  {
    key: "sneakers",
    aliases: ["sneakers", "sneaker", "كوتشي", "كوتشيات", "احذية رياضية", "أحذية رياضية"],
    googleProductCategory: GOOGLE_PRODUCT_CATEGORIES.SNEAKERS,
  },
  {
    key: "bags",
    aliases: ["bags", "bag", "handbag", "handbags", "شنط", "شنطة", "شنطه", "حقائب", "حقيبة"],
    googleProductCategory: GOOGLE_PRODUCT_CATEGORIES.BAGS,
  },
  {
    key: "crocs",
    aliases: ["crocs", "croc", "كروكس"],
    googleProductCategory: GOOGLE_PRODUCT_CATEGORIES.CROCS,
  },
  {
    key: "slippers",
    aliases: ["slippers", "slipper", "slides", "slide", "سليبرز", "شبشب", "شباشب"],
    googleProductCategory: GOOGLE_PRODUCT_CATEGORIES.SLIPPERS,
  },
].map((mapping) => ({
  ...mapping,
  normalizedAliases: new Set(mapping.aliases.map(normalize)),
})));

const FOOTWEAR_ALIASES = new Set([
  "shoes",
  "shoe",
  "footwear",
  "حذاء",
  "حذاء رجالي",
  "حذاء حريمي",
  "احذية",
  "أحذية",
].map(normalize));

const validOverride = (value) => {
  const normalized = clean(value);
  if (!normalized) return "";
  if (["undefined", "null", "غير موجود"].includes(normalize(normalized))) return "";
  return normalized;
};

const categoryCandidates = (product = {}) => [
  product.product_type,
  product.productType,
  product.category_name,
  product.categoryName,
  product.category?.name,
  product.category?.slug,
  product.category,
].map(normalize).filter(Boolean);

export function resolveMetaProductCategories(product = {}) {
  const googleOverride = validOverride(product.google_product_category || product.googleProductCategory);
  const facebookOverride = validOverride(
    product.facebook_product_category
    || product.fb_product_category
    || product.facebookProductCategory
    || product.fbProductCategory
  );

  if (googleOverride) {
    return {
      googleProductCategory: googleOverride,
      facebookProductCategory: facebookOverride,
      matchedBy: "product.google_product_category",
    };
  }

  const candidates = categoryCandidates(product);
  for (const candidate of candidates) {
    const mapping = PRODUCT_TYPE_MAPPINGS.find((entry) => entry.normalizedAliases.has(candidate));
    if (mapping) {
      return {
        googleProductCategory: mapping.googleProductCategory,
        facebookProductCategory: facebookOverride,
        matchedBy: mapping.key,
      };
    }
  }

  if (candidates.some((candidate) => FOOTWEAR_ALIASES.has(candidate))) {
    return {
      googleProductCategory: GOOGLE_PRODUCT_CATEGORIES.SHOES,
      facebookProductCategory: facebookOverride,
      matchedBy: "footwear-fallback",
    };
  }

  return {
    googleProductCategory: "",
    facebookProductCategory: facebookOverride,
    matchedBy: "",
  };
}
