const SIZE_GUIDE_TYPES = {
  men: {
    label: "ط±ط¬ط§ظ„ظٹ",
    title: "ط¯ظ„ظٹظ„ ظ…ظ‚ط§ط³ط§طھ ط§ظ„ط£ط­ط°ظٹط© ط§ظ„ط±ط¬ط§ظ„ظٹط©",
    columns: ["EU", "ط·ظˆظ„ ط§ظ„ظ‚ط¯ظ… CM"],
    rows: [
      ["40", "25.4"],
      ["41", "26.0"],
      ["42", "26.6"],
      ["43", "27.2"],
      ["44", "27.8"],
      ["45", "28.4"],
      ["46", "29.0"],
      ["47", "29.6"],
      ["48", "30.2"],
      ["49", "30.8"],
      ["50", "31.4"],
    ],
  },
  women: {
    label: "ط­ط±ظٹظ…ظٹ",
    title: "ط¯ظ„ظٹظ„ ظ…ظ‚ط§ط³ط§طھ ط§ظ„ط£ط­ط°ظٹط© ط§ظ„ط­ط±ظٹظ…ظٹ",
    columns: ["EU", "ط·ظˆظ„ ط§ظ„ظ‚ط¯ظ… CM"],
    rows: [
      ["36", "23.0"],
      ["37", "23.6"],
      ["38", "24.2"],
      ["39", "24.8"],
      ["40", "25.4"],
      ["41", "26.0"],
    ],
  },
  kids: {
    label: "ط£ط·ظپط§ظ„",
    title: "ط¯ظ„ظٹظ„ ظ…ظ‚ط§ط³ط§طھ ط£ط­ط°ظٹط© ط§ظ„ط£ط·ظپط§ظ„",
    columns: ["EU", "ط·ظˆظ„ ط§ظ„ظ‚ط¯ظ… CM"],
    rows: [
      ["22", "13.2"],
      ["23", "13.8"],
      ["24", "14.4"],
      ["25", "15.0"],
      ["26", "15.6"],
      ["27", "16.2"],
      ["28", "16.8"],
      ["29", "17.4"],
      ["30", "18.0"],
      ["31", "18.6"],
      ["32", "19.2"],
      ["33", "19.8"],
      ["34", "20.4"],
      ["35", "21.0"],
      ["36", "21.6"],
    ],
  },
  "crocs-adult": {
    label: "ظƒط±ظˆظƒط³ ظƒط¨ط§ط±",
    title: "ط¯ظ„ظٹظ„ ظ…ظ‚ط§ط³ط§طھ ظƒط±ظˆظƒط³ ظ„ظ„ظƒط¨ط§ط±",
    columns: ["EU", "US", "CM"],
    rows: [
      ["35/36", "M3/W5", "22"],
      ["36/37", "M4/W6", "23"],
      ["37/38", "M5/W7", "24"],
      ["38/39", "M6/W8", "25"],
      ["39/40", "M7/W9", "25.5"],
      ["41/42", "M8/W10", "26.5"],
      ["42/43", "M9/W11", "27.5"],
      ["43/44", "M10/W12", "28"],
      ["44/45", "M11/W13", "29"],
      ["45/46", "M12", "30"],
    ],
  },
  "crocs-kids": {
    label: "ظƒط±ظˆظƒط³ ط£ط·ظپط§ظ„",
    title: "ط¯ظ„ظٹظ„ ظ…ظ‚ط§ط³ط§طھ ظƒط±ظˆظƒط³ ظ„ظ„ط£ط·ظپط§ظ„",
    columns: ["EU", "Kids", "CM"],
    rows: [
      ["20/21", "C4-C5", "12"],
      ["22/23", "C6-C7", "13"],
      ["24/25", "C8-C9", "14"],
      ["27/28", "C10-C11", "16"],
      ["29/30", "C12-C13", "18"],
      ["32/33", "J1", "20"],
      ["33/34", "J2", "21"],
      ["34/35", "J3", "22"],
    ],
  },
};

const SIZE_GUIDE_TABS = ["men", "women", "kids", "crocs-adult", "crocs-kids"];

const normalizeSizeGuideType = (value = "") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (!normalized) return "";
  if (["men", "mens", "male", "ط±ط¬ط§ظ„ظٹ", "ط±ط¬ط§ظ„"].includes(normalized)) return "men";
  if (["women", "womens", "woman", "female", "ladies", "lady", "ط­ط±ظٹظ…ظٹ", "ظ†ط³ط§ط،", "ط¨ظ†ط§طھظٹ"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls", "ط£ط·ظپط§ظ„", "ط·ظپظ„"].includes(normalized)) return "kids";
  if (normalized.includes("crocskids") || normalized.includes("crocskids") || normalized.includes("kidscrocs")) return "crocs-kids";
  if (normalized.includes("crocsadult") || normalized.includes("adultcrocs")) return "crocs-adult";
  if (normalized.includes("crocs") || normalized.includes("croc")) return "crocs-adult";
  return "";
};

const normalizeProductText = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const resolveSizeGuideTypeForProduct = (product = {}) => {
  if (!product) return "men";

  const audienceText = [
    product.product_type,
    product.productType,
    product.category,
    product.category_name,
    product.gender,
    product.genders,
    product.audience,
    product.audiences,
    product.product_audience,
    product.product_audiences,
    product.target_audience,
    product.brand,
    product.brand_name,
    product.type,
  ]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(Boolean)
    .join(" ");

  const normalizedProductText = normalizeProductText(audienceText);
  const isCrocsProduct = normalizedProductText.includes("croc") || normalizedProductText.includes("ظƒط±ظˆظƒط³");
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
import { storefrontPath } from "./paths";
