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
  gender: Object.freeze({ ...GENDER_AR }),
  size: Object.freeze({ ...SIZE_AR }),
});
