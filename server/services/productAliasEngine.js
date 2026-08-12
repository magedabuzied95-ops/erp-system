const text = (value = "") => String(value ?? "").trim();

const unique = (items = [], limit = 80) =>
  [...new Set(items.map(text).filter(Boolean))].slice(0, limit);

const ARABIC_DIGITS = new Map([
  ["٠", "0"], ["١", "1"], ["٢", "2"], ["٣", "3"], ["٤", "4"],
  ["٥", "5"], ["٦", "6"], ["٧", "7"], ["٨", "8"], ["٩", "9"],
  ["۰", "0"], ["۱", "1"], ["۲", "2"], ["۳", "3"], ["۴", "4"],
  ["۵", "5"], ["۶", "6"], ["۷", "7"], ["۸", "8"], ["۹", "9"],
]);

const NUMBER_WORDS = new Map([
  ["0", ["zero"]],
  ["1", ["one"]],
  ["2", ["two"]],
  ["3", ["three"]],
  ["4", ["four", "٤"]],
  ["5", ["five"]],
  ["6", ["six"]],
  ["7", ["seven"]],
  ["8", ["eight"]],
  ["9", ["nine"]],
]);

const WORD_NUMBER_TO_DIGIT = new Map(
  [...NUMBER_WORDS.entries()].flatMap(([digit, words]) => words.map((word) => [word, digit]))
);

const ARABIC_WORD_ALIASES = [
  ["جوردن", "jordan"],
  ["جوردان", "jordan"],
  ["چوردن", "jordan"],
  ["فور", "four"],
  ["فورس", "force"],
  ["اير", "air"],
  ["ايرفورس", "air force"],
  ["شوك", "shox"],
  ["شوكس", "shox"],
  ["دانك", "dunk"],
  ["كامبس", "campus"],
  ["سامبا", "samba"],
  ["ييزي", "yeezy"],
  ["اديداس", "adidas"],
  ["اديستار", "adistar"],
  ["سوبرستار", "superstar"],
  ["الترابوست", "ultraboost"],
  ["الترا", "ultra"],
  ["بوست", "boost"],
  ["نايك", "nike"],
  ["نورث", "north"],
  ["فيس", "face"],
  ["نورثفيس", "north face"],
  ["كروكس", "crocs"],
];

const ENGLISH_WORD_ALIASES = [
  ["jordan", "جوردن"],
  ["four", "4"],
  ["force", "فورس"],
  ["air", "اير"],
  ["north", "نورث"],
  ["face", "فيس"],
  ["northface", "north face"],
  ["shox", "شوكس"],
  ["dunk", "دانك"],
  ["campus", "كامبس"],
  ["samba", "سامبا"],
  ["yeezy", "ييزي"],
  ["crocs", "كروكس"],
];

const normalizeDigits = (value = "") =>
  text(value).replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS.get(digit) || digit);

export const normalizeAliasText = (value = "") =>
  normalizeDigits(value)
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/[ى]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const compactAliasText = (value = "") =>
  normalizeAliasText(value).replace(/\s+/g, "");

const splitWords = (value = "") => normalizeAliasText(value).split(/\s+/).filter(Boolean);

const addNumberVariants = (phrase = "") => {
  const normalized = normalizeAliasText(phrase);
  const variants = [normalized];
  for (const [digit, words] of NUMBER_WORDS.entries()) {
    for (const word of words) {
      if (normalized.includes(digit)) variants.push(normalized.replaceAll(digit, word));
      if (normalized.includes(word)) variants.push(normalized.replaceAll(word, digit));
    }
  }
  for (const [word, digit] of WORD_NUMBER_TO_DIGIT.entries()) {
    if (normalized.includes(word)) variants.push(normalized.replaceAll(word, digit));
  }
  return variants;
};

const addLanguageVariants = (phrase = "") => {
  const words = splitWords(phrase);
  const variants = [normalizeAliasText(phrase)];
  const arabicMapped = words.map((word) => ARABIC_WORD_ALIASES.find(([source]) => source === word)?.[1] || word).join(" ");
  const englishMapped = words.map((word) => ENGLISH_WORD_ALIASES.find(([source]) => source === word)?.[1] || word).join(" ");
  variants.push(arabicMapped, englishMapped);
  for (const [source, target] of [...ARABIC_WORD_ALIASES, ...ENGLISH_WORD_ALIASES]) {
    if (normalizeAliasText(phrase).includes(source)) variants.push(normalizeAliasText(phrase).replaceAll(source, target));
  }
  return variants;
};

const addSpacingVariants = (phrase = "") => {
  const normalized = normalizeAliasText(phrase);
  const compact = compactAliasText(normalized);
  const variants = [normalized, compact];
  if (/north\s+face/.test(normalized)) variants.push("northface");
  if (/northface/.test(compact)) variants.push("north face");
  if (/air\s+force/.test(normalized)) variants.push("airforce");
  if (/airforce/.test(compact)) variants.push("air force");
  if (/jordan\s+4/.test(normalized)) variants.push("jordan4", "jordan four");
  if (/jordan4/.test(compact)) variants.push("jordan 4", "jordan four");
  if (/\b(?:aj|j)\s*4\b/.test(normalized) || /\b(?:aj4|j4)\b/.test(compact)) variants.push("jordan 4", "air jordan 4", "retro 4");
  if (/retro\s+4/.test(normalized) || /retro4/.test(compact)) variants.push("jordan 4", "air jordan 4", "aj4", "j4");
  return variants;
};

export const expandSearchAliasTerms = (input = "", { limit = 80 } = {}) => {
  const base = normalizeAliasText(input);
  if (!base) return [];
  const chunks = [
    base,
    ...splitWords(base),
    ...addNumberVariants(base),
    ...addLanguageVariants(base),
    ...addSpacingVariants(base),
  ];
  return unique(chunks.flatMap((chunk) => [
    chunk,
    ...addNumberVariants(chunk),
    ...addLanguageVariants(chunk),
    ...addSpacingVariants(chunk),
  ]), limit);
};

const parseList = (value) => {
  if (Array.isArray(value)) return value.flatMap(parseList);
  if (value && typeof value === "object") return Object.values(value).flatMap(parseList);
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== raw) return parseList(parsed);
  } catch {
    // Not JSON; continue with delimiter parsing.
  }
  return raw.split(/[#,،|/]+/).map(text).filter(Boolean);
};

export const generateProductAliases = (product = {}, { limit = 120 } = {}) => {
  const seeds = [
    product.brand,
    product.model,
    product.name,
    product.name_ar,
    product.product_name,
    product.title,
    product.sku,
    product.barcode,
    product.category,
    product.category_name,
    product.classification,
    product.slug,
    product.canonical_slug,
    ...parseList(product.tags),
    ...parseList(product.ai_keywords),
    ...parseList(product.style_tags),
    ...parseList(product.seo_keywords),
  ];
  return unique(seeds.flatMap((seed) => expandSearchAliasTerms(seed, { limit: 30 })), limit);
};
