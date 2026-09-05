import { storefrontPath } from "./paths";
import { CROCS_CANONICAL_SIZE_MAP } from "../../shared/lib/crocsSizes";

const CROCS_ADULT_GUIDE_ROWS = CROCS_CANONICAL_SIZE_MAP
  .filter((entry) => entry.mwLabel)
  .map((entry) => [entry.eu, entry.mwLabel]);

const CROCS_KIDS_GUIDE_ROWS = CROCS_CANONICAL_SIZE_MAP
  .filter((entry) => entry.c || entry.j)
  .map((entry) => [entry.eu, entry.c || entry.j]);

const SIZE_GUIDE_TYPES = {
  men: {
    label: "رجالي",
    labelKey: "storefront.sizeGuide.types.men.label",
    title: "دليل مقاسات الأحذية الرجالية",
    titleKey: "storefront.sizeGuide.types.men.title",
    columns: ["EU", "طول القدم CM"],
    columnKeys: ["storefront.sizeGuide.columns.eu", "storefront.sizeGuide.columns.footLengthCm"],
    rows: [
      ["40", "25.4"], ["41", "26.0"], ["42", "26.6"], ["43", "27.2"],
      ["44", "27.8"], ["45", "28.4"], ["46", "29.0"], ["47", "29.6"],
      ["48", "30.2"], ["49", "30.8"], ["50", "31.4"],
    ],
  },
  women: {
    label: "حريمي",
    labelKey: "storefront.sizeGuide.types.women.label",
    title: "دليل مقاسات الأحذية الحريمي",
    titleKey: "storefront.sizeGuide.types.women.title",
    columns: ["EU", "طول القدم CM"],
    columnKeys: ["storefront.sizeGuide.columns.eu", "storefront.sizeGuide.columns.footLengthCm"],
    rows: [
      ["36", "23.0"], ["37", "23.6"], ["38", "24.2"],
      ["39", "24.8"], ["40", "25.4"], ["41", "26.0"],
    ],
  },
  kids: {
    label: "أطفال",
    labelKey: "storefront.sizeGuide.types.kids.label",
    title: "دليل مقاسات أحذية الأطفال",
    titleKey: "storefront.sizeGuide.types.kids.title",
    columns: ["EU", "طول القدم CM"],
    columnKeys: ["storefront.sizeGuide.columns.eu", "storefront.sizeGuide.columns.footLengthCm"],
    rows: [
      ["22", "13.2"], ["23", "13.8"], ["24", "14.4"], ["25", "15.0"],
      ["26", "15.6"], ["27", "16.2"], ["28", "16.8"], ["29", "17.4"],
      ["30", "18.0"], ["31", "18.6"], ["32", "19.2"], ["33", "19.8"],
      ["34", "20.4"], ["35", "21.0"], ["36", "21.6"],
    ],
  },
  "crocs-adult": {
    label: "كروكس كبار",
    labelKey: "storefront.sizeGuide.types.crocsAdult.label",
    title: "دليل مقاسات كروكس للكبار",
    titleKey: "storefront.sizeGuide.types.crocsAdult.title",
    columns: ["EU", "مقاس المصنع"],
    columnKeys: ["storefront.sizeGuide.columns.eu", "storefront.sizeGuide.columns.factorySize"],
    rows: CROCS_ADULT_GUIDE_ROWS,
  },
  "crocs-kids": {
    label: "كروكس أطفال",
    labelKey: "storefront.sizeGuide.types.crocsKids.label",
    title: "دليل مقاسات كروكس للأطفال",
    titleKey: "storefront.sizeGuide.types.crocsKids.title",
    columns: ["EU", "مقاس المصنع"],
    columnKeys: ["storefront.sizeGuide.columns.eu", "storefront.sizeGuide.columns.factorySize"],
    rows: CROCS_KIDS_GUIDE_ROWS,
  },
};

const SIZE_GUIDE_TABS = ["men", "women", "kids", "crocs-adult", "crocs-kids"];

const normalizeSizeGuideType = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

  if (!normalized) return "";
  if (["men", "mens", "male", "رجالي", "رجل", "رجال"].includes(normalized)) return "men";
  if (["women", "womens", "woman", "female", "ladies", "lady", "حريمي", "نساء", "بناتي"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls", "أطفال", "اطفال", "طفل"].includes(normalized)) return "kids";
  if (normalized.includes("crocskids") || normalized.includes("kidscrocs") || normalized.includes("كروكسأطفال") || normalized.includes("كروكساطفال")) return "crocs-kids";
  if (normalized.includes("crocsadult") || normalized.includes("adultcrocs") || normalized.includes("كروكسكبار")) return "crocs-adult";
  if (normalized.includes("crocs") || normalized.includes("croc") || normalized.includes("كروكس")) return "crocs-adult";
  return "";
};

const normalizeProductText = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

const resolveSizeGuideTypeForProduct = (product = {}) => {
  if (!product) return "men";

  const audienceText = [
    product.product_type, product.productType, product.category, product.category_name,
    product.gender, product.genders, product.audience, product.audiences,
    product.product_audience, product.product_audiences, product.target_audience,
    product.brand, product.brand_name, product.type,
  ]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(Boolean)
    .join(" ");

  const normalizedProductText = normalizeProductText(audienceText);
  const isCrocsProduct = normalizedProductText.includes("croc") || normalizedProductText.includes("كروكس");
  if (isCrocsProduct) {
    const audience = normalizeSizeGuideType(audienceText);
    return audience === "kids" ? "crocs-kids" : "crocs-adult";
  }

  return normalizeSizeGuideType(audienceText);
};

const buildSizeGuidePath = (type = "") => {
  const normalizedType = normalizeSizeGuideType(type) || "";
  return storefrontPath("/size-guide", normalizedType ? { type: normalizedType } : "");
};

const getSizeGuideConfig = (type = "") => {
  const normalizedType = normalizeSizeGuideType(type) || "men";
  return SIZE_GUIDE_TYPES[normalizedType] || SIZE_GUIDE_TYPES.men;
};

export {
  SIZE_GUIDE_TABS,
  SIZE_GUIDE_TYPES,
  buildSizeGuidePath,
  getSizeGuideConfig,
  normalizeSizeGuideType,
  resolveSizeGuideTypeForProduct,
};
