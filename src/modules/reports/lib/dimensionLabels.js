// Explicit .js so this module is loadable by Node's test runner as well as Vite.

/**
 * Presentation-only labels for enum-style dimension values.
 *
 * The database stores `sneakers`, `bags`, `men` and so on, and the analytics API
 * returns those values verbatim. Rendering them raw puts English words inside an
 * otherwise Arabic screen. This maps a stored value to a display string at render
 * time and nothing else:
 *
 *   - the stored value is never mutated
 *   - the value sent back as a filter is always the original, never the label
 *   - an unmapped value falls through unchanged, so a new product type shows its raw
 *     name rather than disappearing or throwing
 *   - English UI keeps the original values, which are already English
 *
 * Matching is case-insensitive and ignores spaces, underscores and hyphens, because
 * the same concept appears as "winter_collection", "Winter Collection" and
 * "winter-collection" across the catalogue.
 */

const normalise = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");

const PRODUCT_TYPE_AR = {
  sneakers: "أحذية رياضية",
  shoes: "أحذية",
  slippers: "سليبرات",
  crocs: "كروكس",
  sandals: "صنادل",
  boots: "بوت",
  bags: "شنط",
  bag: "شنطة",
  backpacks: "شنط ظهر",
  accessories: "إكسسوارات",
  wintercollection: "تشكيلة الشتاء",
  summercollection: "تشكيلة الصيف",
  clothes: "ملابس",
  socks: "شرابات",
  belts: "أحزمة",
  wallets: "محافظ",
};

/**
 * Categories are free text, not an enum.
 *
 * `products.main_category` and `products.category` are unconstrained varchar columns
 * that people type into, which is why production holds "sneakers", "Sneakers",
 * "Footwear", "footwear", "Shoes", "shoes" and "running shoes" side by side. Translating
 * that column wholesale would mean guessing at somebody's free text.
 *
 * So this dictionary is deliberately narrow: only the classifications the system itself
 * uses as product types, which happen to be typed into the category column too. A
 * genuine free-text value such as "running shoes" falls through and displays as written.
 */
const CATEGORY_AR = {
  sneakers: "أحذية رياضية",
  shoes: "أحذية",
  footwear: "أحذية",
  slippers: "سليبرات",
  crocs: "كروكس",
  sandals: "صنادل",
  boots: "بوت",
  bags: "شنط",
  accessories: "إكسسوارات",
};

const GENDER_AR = {
  men: "رجالي",
  man: "رجالي",
  male: "رجالي",
  mens: "رجالي",
  women: "حريمي",
  woman: "حريمي",
  female: "حريمي",
  ladies: "حريمي",
  kids: "أطفال",
  kid: "أطفال",
  children: "أطفال",
  boys: "أولادي",
  girls: "بناتي",
  unisex: "للجنسين",
};

const SIZE_AR = {
  onesize: "مقاس واحد",
  free: "مقاس حر",
  freesize: "مقاس حر",
};

const DICTIONARIES = {
  product_type: PRODUCT_TYPE_AR,
  productType: PRODUCT_TYPE_AR,
  category: CATEGORY_AR,
  gender: GENDER_AR,
  size: SIZE_AR,
};

/** True when the active language should use the Arabic dictionaries. */
export const isArabicLanguage = (language) => String(language || "").toLowerCase().startsWith("ar");

/**
 * Display label for one stored dimension value.
 *
 * `dimension` selects the dictionary; an unknown dimension simply passes the value
 * through, which keeps brands, categories and free-text values untouched.
 */
export const dimensionLabel = (dimension, value, language) => {
  const raw = value === null || value === undefined ? "" : String(value);
  if (!raw) return raw;
  if (!isArabicLanguage(language)) return raw;
  const dictionary = DICTIONARIES[dimension];
  if (!dictionary) return raw;
  return dictionary[normalise(raw)] ?? raw;
};

/** Whether a value has an Arabic label, for tests and for deciding on a tooltip. */
export const hasDimensionLabel = (dimension, value) => {
  const dictionary = DICTIONARIES[dimension];
  return Boolean(dictionary && dictionary[normalise(value)]);
};

export const DIMENSION_DICTIONARIES = Object.freeze({
  product_type: Object.freeze({ ...PRODUCT_TYPE_AR }),
  category: Object.freeze({ ...CATEGORY_AR }),
  gender: Object.freeze({ ...GENDER_AR }),
  size: Object.freeze({ ...SIZE_AR }),
});
