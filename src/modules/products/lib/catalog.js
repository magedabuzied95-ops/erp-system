const STORAGE_KEYS = {
  products: "erp.products.meta",
  categories: "erp.products.categories",
  brands: "erp.products.brands",
  units: "erp.products.units",
};

const PRODUCT_META_LIMIT = 100;
const CACHE_KEY_PATTERNS = [
  /catalog/i,
  /product[-_.:]?meta/i,
  /product[-_.:]?cache/i,
  /duplicate[-_.:]?draft/i,
  /upload[-_.:]?temp/i,
  /^erp\.products\.meta$/,
];

const DEFAULT_CATEGORIES = [
  {
    id: "cat-footwear",
    name: "Footwear",
    parentId: null,
    image: "",
    status: "active",
  },
  {
    id: "cat-sneakers",
    name: "Sneakers",
    parentId: "cat-footwear",
    image: "",
    status: "active",
  },
  {
    id: "cat-apparel",
    name: "Apparel",
    parentId: null,
    image: "",
    status: "active",
  },
];

const DEFAULT_BRANDS = [
  { id: "brand-nike", name: "Nike", logo: "", status: "active" },
  { id: "brand-adidas", name: "Adidas", logo: "", status: "active" },
  { id: "brand-puma", name: "Puma", logo: "", status: "active" },
];

const DEFAULT_UNITS = [
  { id: "unit-piece", name: "Piece", symbol: "pcs", status: "active" },
  { id: "unit-box", name: "Box", symbol: "box", status: "active" },
  { id: "unit-pack", name: "Pack", symbol: "pkg", status: "active" },
];

const safeWindow = () =>
  typeof window !== "undefined" ? window : null;

const readJson = (key, fallback) => {
  const win = safeWindow();
  if (!win) return fallback;

  try {
    const value = win.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const isQuotaExceeded = (error) =>
  error?.name === "QuotaExceededError" ||
  error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
  error?.code === 22 ||
  error?.code === 1014 ||
  /quota/i.test(String(error?.message || ""));

const compactText = (value = "", max = 160) => String(value || "").trim().slice(0, max);

const compactImageUrl = (value = "") => {
  const text = String(value || "").trim();
  if (!text || text.startsWith("data:") || text.startsWith("blob:") || text.length > 2048) return "";
  return text;
};

export const compactProductMeta = (meta = {}) => ({
  id: meta.id,
  name: compactText(meta.name, 180),
  slug: compactText(meta.slug || meta.canonical_slug, 220),
  sku: compactText(meta.sku || meta.barcode, 80),
  category_id: meta.category_id ?? meta.categoryId ?? "",
  brand_id: meta.brand_id ?? meta.brandId ?? "",
  main_image_url: compactImageUrl(meta.main_image_url || meta.image_url || meta.image || meta.photo_url || meta.thumbnail_url),
  image_url: compactImageUrl(meta.main_image_url || meta.image_url || meta.image || meta.photo_url || meta.thumbnail_url),
  updated_at: meta.updated_at || meta.updatedAt || new Date().toISOString(),
  active: meta.active,
  status: compactText(meta.status || "", 32),
  variation_mode: compactText(meta.variation_mode || "", 40),
  fixed_size_label: compactText(meta.fixed_size_label || "", 80),
  is_offer_story: Boolean(meta.is_offer_story),
  is_storefront_visible: meta.is_storefront_visible !== false && String(meta.is_storefront_visible ?? "").toLowerCase() !== "false",
});

export const cleanupProductCache = ({ preserveProductMeta = false } = {}) => {
  const win = safeWindow();
  if (!win) return;
  try {
    const keys = Array.from({ length: win.localStorage.length }, (_, index) => win.localStorage.key(index)).filter(Boolean);
    keys.forEach((key) => {
      if (preserveProductMeta && key === STORAGE_KEYS.products) return;
      if (CACHE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        win.localStorage.removeItem(key);
      }
    });
  } catch {
    // Storage cleanup is best-effort.
  }
};

const compactForStorage = (key, value) => {
  if (key !== STORAGE_KEYS.products) return value;
  const items = Array.isArray(value) ? value : [];
  return items.map(compactProductMeta).filter((item) => item.id).slice(-PRODUCT_META_LIMIT);
};

export const safeWriteJson = (key, value) => {
  const win = safeWindow();
  if (!win) return true;
  try {
    win.localStorage.setItem(key, JSON.stringify(compactForStorage(key, value)));
    return true;
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
    cleanupProductCache({ preserveProductMeta: key === STORAGE_KEYS.products });
    try {
      win.localStorage.setItem(key, JSON.stringify(compactForStorage(key, value).slice?.(-50) || compactForStorage(key, value)));
      return true;
    } catch {
      return false;
    }
  }
};

const writeJson = safeWriteJson;

export const slugify = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const generateBarcode = () => {
  const number = Math.floor(100000000000 + Math.random() * 900000000000);
  return String(number);
};

const MODEL_ABBREVIATIONS = [
  [/super\s*star|superstar/i, "SUP"],
  [/air\s*force|af\s*1|airforce/i, "AF"],
  [/jordan\s*4|j4\b/i, "J4"],
  [/jordan\s*1|j1\b/i, "J1"],
  [/\bjordan\b/i, "JDN"],
  [/\bsamba\b/i, "SAM"],
  [/\bcampus\b/i, "CAM"],
  [/\bgazelle\b/i, "GAZ"],
  [/\bdunk\b/i, "DNK"],
  [/\bye?ezy\b/i, "YZY"],
  [/new\s*balance\s*530|\bnb\s*530\b|\b530\b/i, "NB530"],
  [/new\s*balance\s*327|\bnb\s*327\b|\b327\b/i, "NB327"],
  [/new\s*balance\s*9060|\bnb\s*9060\b|\b9060\b/i, "NB9060"],
];

const BRAND_ABBREVIATIONS = [
  [/^adidas$/i, "ADS"],
  [/^nike$/i, "NK"],
  [/^new\s*balance$/i, "NB"],
  [/^puma$/i, "PMA"],
  [/^reebok$/i, "RBK"],
  [/^converse$/i, "CNV"],
  [/^vans$/i, "VNS"],
  [/^asics$/i, "ASC"],
  [/^under\s*armou?r$/i, "UA"],
];

const asciiSkuText = (value = "") =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();

const compactSkuToken = (value = "", max = 4) => asciiSkuText(value).replace(/\s+/g, "").slice(0, max);

const abbreviateWords = (value = "", max = 3) => {
  const words = asciiSkuText(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, max);
  return words.map((word) => word[0]).join("").slice(0, max);
};

const getBrandCode = (brand = "", fallback = "") => {
  const source = asciiSkuText(brand);
  const matched = BRAND_ABBREVIATIONS.find(([pattern]) => pattern.test(source));
  if (matched) return matched[1];
  return abbreviateWords(source, 3) || abbreviateWords(fallback, 3) || "PRD";
};

export const detectSkuModelCode = (...values) => {
  const source = values.map((value) => String(value || "")).filter(Boolean).join(" ");
  const matched = MODEL_ABBREVIATIONS.find(([pattern]) => pattern.test(source));
  return matched?.[1] || "";
};

const getGenderCode = (gender = "") => {
  const source = asciiSkuText(gender);
  if (/WOMEN|FEMALE|WOMAN|LAD/.test(source)) return "W";
  if (/MEN|MALE|MAN/.test(source)) return "M";
  if (/KID|CHILD|BOY|GIRL/.test(source)) return "K";
  if (/UNISEX/.test(source)) return "U";
  return "";
};

const getGradeCode = (grade = "") => {
  const source = asciiSkuText(grade);
  if (/MIRROR|MIR/.test(source)) return "MIR";
  if (/ORIGINAL|AUTHENTIC/.test(source)) return "ORG";
  if (/PREMIUM/.test(source)) return "PRM";
  if (/LOCAL/.test(source)) return "LOC";
  if (/IMPORT|IMPORTED/.test(source)) return "IMP";
  return compactSkuToken(source, 3);
};

const getTypeOrCategoryCode = ({ productType = "", category = "" } = {}) => {
  const source = asciiSkuText(`${productType} ${category}`);
  if (/SNEAKER|SHOE|TRAINER|FOOTWEAR/.test(source)) return "";
  if (/BOOT/.test(source)) return "BT";
  if (/SLIPPER|SLIDE|SANDAL/.test(source)) return "SLD";
  if (/BAG|BACKPACK|TOTE/.test(source)) return "BAG";
  if (/SHIRT|TEE|TOP/.test(source)) return "TOP";
  if (/PANTS|JEANS|TROUSER/.test(source)) return "PNT";
  return abbreviateWords(productType || category, 3);
};

export const buildSmartSkuPrefix = (context = {}) => {
  const brandCode = getBrandCode(context.brand || context.manufacturer, context.name);
  const modelCode =
    context.detectedModelCode ||
    detectSkuModelCode(
      context.detectedModel,
      context.model,
      context.name,
      context.metaTitle,
      context.aiText,
      context.brandStyle
    );
  const typeCode = modelCode ? "" : getTypeOrCategoryCode(context);
  const genderCode = getGenderCode(context.gender);
  const gradeCode = getGradeCode(context.grade);
  const parts =
    brandCode === "NB" && modelCode.startsWith("NB")
      ? [modelCode, genderCode, gradeCode].filter(Boolean)
      : [brandCode, modelCode || typeCode, genderCode, gradeCode].filter(Boolean);
  const joined = parts.join("-");
  return joined.replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "PRD";
};

export const colorCodeFromName = (color = "") => {
  const source = asciiSkuText(color);
  if (/BLACK|BLK/.test(source)) return "BLK";
  if (/WHITE|WHT/.test(source)) return "WHT";
  if (/RED/.test(source)) return "RED";
  if (/BLUE/.test(source)) return "BLU";
  if (/GREEN/.test(source)) return "GRN";
  if (/GRAY|GREY/.test(source)) return "GRY";
  if (/SILVER/.test(source)) return "SLV";
  if (/GOLD/.test(source)) return "GLD";
  if (/BROWN/.test(source)) return "BRN";
  if (/BEIGE/.test(source)) return "BEG";
  if (/PINK/.test(source)) return "PNK";
  if (/PURPLE/.test(source)) return "PRP";
  if (/ORANGE/.test(source)) return "ORG";
  return abbreviateWords(source, 3) || "CLR";
};

export const makeUniqueSku = (sku = "", used = new Set()) => {
  const base = String(sku || "PRD").replace(/[^A-Z0-9-]/gi, "").toUpperCase().replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "PRD";
  let candidate = base;
  let sequence = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${sequence}`.slice(0, 60);
    sequence += 1;
  }
  used.add(candidate);
  return candidate;
};

export const collectSkuValues = (rows = [], { excludeProductId = "" } = {}) => {
  const excludedId = String(excludeProductId || "").trim();
  const values = new Set();
  const addSku = (value) => {
    const sku = String(value || "").trim().toUpperCase();
    if (sku) values.add(sku);
  };

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const productId = String(row?.product_id ?? row?.productId ?? row?.id ?? "").trim();
    if (excludedId && productId === excludedId) return;
    addSku(row?.product_sku ?? row?.sku);
    (Array.isArray(row?.variants) ? row.variants : []).forEach((variant) => {
      addSku(variant?.sku ?? variant?.variant_sku);
    });
  });

  return values;
};

export const buildVariantSku = ({ prefix = "", color = "", size = "", sequence = "", usedSkus } = {}) => {
  const cleanPrefix = String(prefix || "PRD")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "PRD";
  const cleanSize = compactSkuToken(size, 8);
  const parts = [cleanPrefix, colorCodeFromName(color), cleanSize, compactSkuToken(sequence, 4)].filter(Boolean);
  const sku = parts.join("-");
  return usedSkus ? makeUniqueSku(sku, usedSkus) : sku;
};

export const generateSku = (name = "", id = "") => {
  const prefix = buildSmartSkuPrefix({ name });
  const suffix = String(id || Date.now()).slice(-4).toUpperCase();
  return `${prefix}-${suffix}`;
};

export const getProductMeta = (id) => {
  const items = readJson(STORAGE_KEYS.products, []);
  return items.find((item) => String(item.id) === String(id)) || null;
};

export const upsertProductMeta = (meta) => {
  const items = readJson(STORAGE_KEYS.products, []);
  const compact = compactProductMeta(meta);
  const next = [
    ...items.filter((item) => String(item.id) !== String(compact.id)),
    compact,
  ].slice(-PRODUCT_META_LIMIT);
  return writeJson(STORAGE_KEYS.products, next);
};

export const removeProductMeta = (id) => {
  const items = readJson(STORAGE_KEYS.products, []);
  writeJson(
    STORAGE_KEYS.products,
    items.filter((item) => String(item.id) !== String(id))
  );
};

export const getCategories = () =>
  readJson(STORAGE_KEYS.categories, DEFAULT_CATEGORIES);

export const saveCategories = (items) =>
  writeJson(STORAGE_KEYS.categories, items);

export const getBrands = () =>
  readJson(STORAGE_KEYS.brands, DEFAULT_BRANDS);

export const saveBrands = (items) =>
  writeJson(STORAGE_KEYS.brands, items);

export const getUnits = () =>
  readJson(STORAGE_KEYS.units, DEFAULT_UNITS);

export const saveUnits = (items) =>
  writeJson(STORAGE_KEYS.units, items);

export const mergeProductRecord = (product, variant = null) => {
  const meta = getProductMeta(product.id) || {};
  const mergedVariant = variant || {};
  const hasVariant = Boolean(variant);
  const status = String(product.status || meta.status || "active").toLowerCase();
  const active =
    product.is_active === false || product.active === false
      ? false
      : product.is_active === true || product.active === true
        ? true
        : meta.active ?? (status !== "inactive" && status !== "archived");

  return {
    ...product,
    ...meta,
    variation_mode: meta.variation_mode || product.variation_mode || "full_variations",
    fixed_size_label: meta.fixed_size_label || product.fixed_size_label || "",
    variant_id: mergedVariant.variant_id ?? meta.variant_id ?? null,
    color: mergedVariant.color ?? meta.color ?? "",
    size: mergedVariant.size ?? meta.size ?? "",
    manufacturer_id:
      mergedVariant.manufacturer_id ??
      mergedVariant.variant_manufacturer_id ??
      meta.manufacturer_id ??
      product.manufacturer_id ??
      "",
    barcode: mergedVariant.barcode ?? meta.barcode ?? meta.sku ?? "",
    sku: mergedVariant.sku ?? meta.sku ?? generateSku(product.name, product.id),
    stock: hasVariant ? mergedVariant.stock ?? meta.stock ?? product.stock ?? 0 : product.stock ?? meta.stock ?? 0,
    cost_price: hasVariant ? mergedVariant.cost_price ?? meta.cost_price ?? product.cost_price ?? 0 : product.cost_price ?? meta.cost_price ?? 0,
    selling_price: hasVariant ? mergedVariant.selling_price ?? mergedVariant.regular_price ?? mergedVariant.price ?? meta.selling_price ?? product.selling_price ?? product.regular_price ?? product.price ?? 0 : product.selling_price ?? product.regular_price ?? product.price ?? meta.selling_price ?? 0,
    regular_price: hasVariant ? mergedVariant.selling_price ?? mergedVariant.regular_price ?? mergedVariant.price ?? meta.regular_price ?? product.regular_price ?? product.price ?? 0 : product.selling_price ?? product.regular_price ?? product.price ?? meta.regular_price ?? 0,
    price: hasVariant ? mergedVariant.selling_price ?? mergedVariant.regular_price ?? mergedVariant.price ?? meta.price ?? product.price ?? product.regular_price ?? 0 : product.selling_price ?? product.regular_price ?? product.price ?? meta.price ?? 0,
    sale_price: hasVariant ? mergedVariant.sale_price ?? meta.sale_price ?? product.sale_price ?? 0 : product.sale_price ?? meta.sale_price ?? 0,
    wholesale_price: hasVariant ? mergedVariant.wholesale_price ?? meta.wholesale_price ?? product.wholesale_price ?? 0 : product.wholesale_price ?? meta.wholesale_price ?? 0,
    category: meta.category || product.category || "Uncategorized",
    brand: meta.brand || product.brand || "Unbranded",
    is_offer_story: meta.is_offer_story ?? product.is_offer_story ?? false,
    is_storefront_visible: meta.is_storefront_visible ?? product.is_storefront_visible ?? true,
    image_url: mergedVariant.image_url || meta.image_url || product.image_url || "",
    status,
    active,
    low_stock_threshold: meta.low_stock_threshold ?? 10,
    tax_rate: meta.tax_rate ?? 0,
    barcode_label: meta.barcode_label || mergedVariant.barcode || "",
  };
};

export const seedCategories = () => {
  const categories = getCategories();
  if (!categories || categories.length === 0) {
    saveCategories(DEFAULT_CATEGORIES);
    return DEFAULT_CATEGORIES;
  }
  return categories;
};

export const seedBrands = () => {
  const brands = getBrands();
  if (!brands || brands.length === 0) {
    saveBrands(DEFAULT_BRANDS);
    return DEFAULT_BRANDS;
  }
  return brands;
};

export const seedUnits = () => {
  const units = getUnits();
  if (!units || units.length === 0) {
    saveUnits(DEFAULT_UNITS);
    return DEFAULT_UNITS;
  }
  return units;
};

const findCategoryById = (categories = [], categoryId = "") =>
  categories.find((item) => String(item.id) === String(categoryId)) || null;

const findCategoryByName = (categories = [], name = "") =>
  categories.find((item) => String(item.name || "").trim() === String(name || "").trim()) || null;

const normalizePersistedId = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  const numeric = Number(text);
  return Number.isFinite(numeric) ? String(numeric) : "";
};

const resolveCategoryFromRecord = (categories = [], record = {}) => {
  const byId = findCategoryById(categories, record.category_id);
  if (byId) {
    const parent = byId.parentId ? findCategoryById(categories, byId.parentId) : null;
    const grandparent = parent?.parentId ? findCategoryById(categories, parent.parentId) : null;
    return {
      categoryId: String(byId.id),
      mainCategory: grandparent?.name || parent?.name || byId.name || "",
      subCategory: grandparent ? parent?.name || "" : parent ? byId.name || "" : "",
      childCategory: grandparent ? byId.name || "" : "",
    };
  }

  const byName = findCategoryByName(categories, record.category);
  if (byName) {
    const parent = byName.parentId ? findCategoryById(categories, byName.parentId) : null;
    const grandparent = parent?.parentId ? findCategoryById(categories, parent.parentId) : null;
    return {
      categoryId: String(byName.id),
      mainCategory: grandparent?.name || parent?.name || byName.name || "",
      subCategory: grandparent ? parent?.name || "" : parent ? byName.name || "" : "",
      childCategory: grandparent ? byName.name || "" : "",
    };
  }

  return {
    categoryId: record.category_id ? String(record.category_id) : "",
    mainCategory: String(record.main_category || "").trim(),
    subCategory: String(record.sub_category || "").trim(),
    childCategory: String(record.child_category || "").trim(),
  };
};

export const resolveCategorySelection = (categories = [], record = {}) =>
  resolveCategoryFromRecord(categories, record);

export const resolveCategoryPayload = (categories = [], record = {}) => {
  const mainCategory = String(record.mainCategory || "").trim();
  const subCategory = String(record.subCategory || "").trim();
  const childCategory = String(record.childCategory || "").trim();
  const selectedName = childCategory || subCategory || mainCategory || "";
  const selectedCategory = findCategoryByName(categories, selectedName);
  return {
    category: selectedName || String(record.fallbackCategory || "").trim(),
    category_id: normalizePersistedId(selectedCategory ? selectedCategory.id : record.fallbackCategoryId),
    main_category: mainCategory,
    sub_category: subCategory,
    child_category: childCategory,
  };
};

export const resolveBrandSelection = (brands = [], record = {}) => {
  const byId = brands.find((item) => String(item.id) === String(record.brand_id)) || null;
  if (byId) {
    return {
      brandId: String(byId.id),
      brand: byId.name || "",
    };
  }

  const byName = brands.find((item) => String(item.name || "").trim() === String(record.brand || "").trim()) || null;
  if (byName) {
    return {
      brandId: String(byName.id),
      brand: byName.name || "",
    };
  }

  return {
    brandId: record.brand_id ? String(record.brand_id) : "",
    brand: String(record.brand || "").trim(),
  };
};

export const resolveBrandPayload = (brands = [], record = {}) => {
  const selectedBrand = brands.find((item) => String(item.name || "").trim() === String(record.brand || "").trim()) || null;
  return {
    brand: String(record.brand || "").trim(),
    brand_id: normalizePersistedId(selectedBrand ? selectedBrand.id : record.fallbackBrandId),
  };
};

export const resolveUnitSelection = (units = [], record = {}) => {
  const byId = units.find((item) => String(item.id) === String(record.unit_id)) || null;
  if (byId) {
    return {
      unitId: String(byId.id),
      unit: byId.name || "",
    };
  }

  const byName = units.find((item) => String(item.name || "").trim() === String(record.unit || "").trim()) || null;
  if (byName) {
    return {
      unitId: String(byName.id),
      unit: byName.name || "",
    };
  }

  return {
    unitId: record.unit_id ? String(record.unit_id) : "",
    unit: String(record.unit || "").trim(),
  };
};

export const resolveUnitPayload = (units = [], record = {}) => {
  const selectedUnit = units.find((item) => String(item.name || "").trim() === String(record.unit || "").trim()) || null;
  return {
    unit: String(record.unit || "").trim(),
    unit_id: normalizePersistedId(selectedUnit ? selectedUnit.id : record.fallbackUnitId),
  };
};
