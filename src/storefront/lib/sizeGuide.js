import { CROCS_CANONICAL_SIZE_MAP, compareCrocsEuSizes, crocsSizeKey, isCrocsProduct, resolveCrocsEuSize, uniqueCrocsSizes } from "../../shared/lib/crocsSizes.js";

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

const getSizeGuideConfig = (type = "") => {
  const normalizedType = normalizeSizeGuideType(type) || "men";
  return SIZE_GUIDE_TYPES[normalizedType] || SIZE_GUIDE_TYPES.men;
};

export {
  SIZE_GUIDE_TABS,
  SIZE_GUIDE_TYPES,
  getSizeGuideConfig,
  normalizeSizeGuideType,
  resolveSizeGuideTypeForProduct,
};

/* --------------------------------------------------------------------------
   The guide for ONE product: only the sizes the product was entered with.
   A Crocs model lists its factory markings with the EU pair each one wears as;
   any other shoe lists its EU sizes with the foot length each one fits. A
   product whose sizes are not numbers (a bag, "one size") falls back to the
   full chart for its audience.
   -------------------------------------------------------------------------- */

const ADULT_BASE = { eu: 40, cm: 25.4 };
const KIDS_BASE = { eu: 22, cm: 13.2 };
const CM_PER_SIZE = 0.6;

const roundCm = (value) => Math.round(value * 10) / 10;

// The charts above are one straight line each (0.6 cm a size), so a half size
// or a size past the end of a chart gets the same answer the chart would give.
const footLengthForEu = (eu, type = "") => {
  const kids = type === "kids" || (type !== "men" && type !== "women" && eu < 36);
  const base = kids ? KIDS_BASE : ADULT_BASE;
  return roundCm(base.cm + (eu - base.eu) * CM_PER_SIZE);
};

// Only a size that IS a number ("42", "42.5", "EU 42") — a bag's "18-inch" is not a shoe size.
const parseEuSize = (value = "") => {
  const match = String(value ?? "").replace(",", ".").match(/^\s*(?:eu\s*)?(\d{2}(?:\.\d)?)\s*(?:eu)?\s*$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 15 && number <= 55 ? number : null;
};

const variantStockKnown = (variant = {}) => variant && (variant.stock !== undefined && variant.stock !== null);
const variantInStock = (variant = {}) => Number(variant?.stock || 0) > 0;

const sizeRowsFromVariants = (variants = [], keyOf) => {
  const rows = new Map();
  variants.forEach((variant) => {
    const key = keyOf(variant);
    if (!key) return;
    const row = rows.get(key) || { key, variants: [] };
    row.variants.push(variant);
    rows.set(key, row);
  });
  return [...rows.values()];
};

const buildProductSizeGuide = ({ product = {}, variants = null, selectedSize = "" } = {}) => {
  const allVariants = (Array.isArray(product?.variants) ? product.variants : []).filter((variant) => String(variant?.size || "").trim());
  // With a colour on screen the guide is that colour's sizes (a size the colour was never made in
  // is not "sold out", it is not there); without one, every size the model was entered with.
  const colourVariants = (Array.isArray(variants) ? variants : []).filter((variant) => String(variant?.size || "").trim());
  const stockVariants = colourVariants.length ? colourVariants : allVariants;
  const showStock = stockVariants.some(variantStockKnown);
  const type = resolveSizeGuideTypeForProduct(product) || "";

  if (isCrocsProduct(product) || type.startsWith("crocs")) {
    const keyOf = (variant) => crocsSizeKey(resolveCrocsEuSize(variant?.size));
    const stockByKey = new Map(sizeRowsFromVariants(stockVariants, keyOf).map((row) => [row.key, row.variants]));
    const selectedKey = selectedSize ? keyOf({ size: selectedSize }) : "";
    const rows = sizeRowsFromVariants(stockVariants, keyOf)
      .map((row) => {
        const markings = uniqueCrocsSizes(row.variants.map((variant) => variant.size));
        const eu = resolveCrocsEuSize(markings[0]);
        const own = stockByKey.get(row.key) || [];
        return {
          key: row.key,
          eu,
          factory: markings.join(" · "),
          inStock: own.some(variantInStock),
          selected: Boolean(selectedKey) && selectedKey === row.key,
        };
      })
      .sort((left, right) => compareCrocsEuSizes(left.eu, right.eu));
    if (rows.length) return { kind: "crocs", type: type || "crocs-adult", rows, showStock, full: false };
    return { kind: "chart", type: type || "crocs-adult", rows: [], showStock: false, full: true };
  }

  const keyOf = (variant) => {
    const eu = parseEuSize(variant?.size);
    return eu === null ? "" : String(eu);
  };
  const stockByKey = new Map(sizeRowsFromVariants(stockVariants, keyOf).map((row) => [row.key, row.variants]));
  const selectedKey = selectedSize ? keyOf({ size: selectedSize }) : "";
  const rows = sizeRowsFromVariants(stockVariants, keyOf)
    .map((row) => {
      const eu = Number(row.key);
      const own = stockByKey.get(row.key) || [];
      return {
        key: row.key,
        eu: String(row.variants[0].display_size || row.variants[0].size).trim(),
        euNumber: eu,
        cm: footLengthForEu(eu, type),
        inStock: own.some(variantInStock),
        selected: Boolean(selectedKey) && selectedKey === row.key,
      };
    })
    .sort((left, right) => left.euNumber - right.euNumber);
  if (rows.length) return { kind: "shoes", type: type || "men", rows, showStock, full: false };
  return { kind: "chart", type: type || "men", rows: [], showStock: false, full: true };
};

/** The smallest size whose foot length fits the measured foot; the largest when none does. */
const recommendSizeForFoot = (rows = [], footCm = 0) => {
  const foot = Number(String(footCm ?? "").replace(",", "."));
  if (!Number.isFinite(foot) || foot <= 0 || !rows.length) return null;
  const fit = rows.find((row) => Number(row.cm) >= foot - 0.05);
  return fit ? { row: fit, tooBig: false } : { row: rows[rows.length - 1], tooBig: true };
};

export { buildProductSizeGuide, footLengthForEu, parseEuSize, recommendSizeForFoot };
