/*
 * What a customer who wants to BROWSE is asking for — "عايز اشوف الموديلات المستورد الفيتنامي مقاس
 * 42", "عندك شنط؟", "وريني نايكي ميرور مقاس 44". Five slots: product type, size, grade, audience,
 * brand. Pure (no DB): the service decides what to ask and builds the storefront link.
 *
 * The grade keys are products.grade (server/config/productGrades.js); the type keys are
 * products.product_type. Arabic words are matched as whole words — JS \b never fires next to an
 * Arabic letter — with an optional ال / لل / بال / و / ف / ب in front.
 */

const text = (value = "") => String(value ?? "").trim();

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const normalizeBrowseText = (value = "") =>
  text(value)
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const PREFIX = "(?:ال|لل|بال|وال|فال|و|ف|ب|ل)?";
const wordsPattern = (words = []) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${PREFIX}(?:${words.map(normalizeBrowseText).join("|")})(?![\\p{L}\\p{N}])`, "u");

export const PRODUCT_TYPES = Object.freeze([
  { key: "sneakers", label: "الكوتشيات", sized: true, pattern: wordsPattern(["كوتشي", "كوتشيات", "كوتش", "اسنيكرز", "سنيكرز", "سنيكر", "sneaker", "sneakers", "shoes"]) },
  { key: "slippers", label: "السليبر", sized: true, pattern: wordsPattern(["سليبر", "سليبرات", "شبشب", "شباشب", "slipper", "slippers"]) },
  { key: "crocs", label: "الكروكس", sized: true, pattern: wordsPattern(["كروكس", "crocs"]) },
  { key: "winter_collection", label: "الكولكشن الشتوي", sized: true, pattern: wordsPattern(["بوت", "بوط", "بوتس", "بوتات", "شتوي", "شتويه", "boots", "boot", "winter"]) },
  { key: "bags", label: "الشنط", sized: false, pattern: wordsPattern(["شنطه", "شنط", "شنطات", "bag", "bags"]) },
]);

export const productTypeByKey = (key = "") => PRODUCT_TYPES.find((type) => type.key === key) || null;

const GRADE_WORDS = [
  { key: "local", pattern: wordsPattern(["مصري", "محلي", "local", "egyptian"]) },
  { key: "imported_from_vietnam", pattern: wordsPattern(["فيتنامي", "فيتنام", "مستورد", "مستورده", "مستوردين", "vietnam", "vietnamese", "imported"]) },
  { key: "mirror_original", pattern: wordsPattern(["ميرور", "مرور", "mirror"]) },
  { key: "original", pattern: wordsPattern(["اوريجينال", "اورجينال", "اوريجنال", "original"]) },
];
// "الكل" / "مش فارق" answers the grade question with every grade.
const ALL_GRADES = wordsPattern(["الكل", "كله", "كلهم", "اي حاجه", "اي درجه", "مش فارق", "مش فارقه", "مش مهم", "all"]);
const ANY_SIZE = /(اي|أي) مقاس|مش فارق المقاس|كل المقاسات|any size/u;

const AUDIENCES = [
  { key: "men", pattern: wordsPattern(["رجالي", "رجاله", "رجال", "شباب", "men", "man", "male"]) },
  { key: "women", pattern: wordsPattern(["حريمي", "نسائي", "نساء", "بنات", "بناتي", "women", "woman", "ladies", "female"]) },
  { key: "kids", pattern: wordsPattern(["اطفال", "طفل", "ولادي", "kids", "kid", "children"]) },
];

// Arabic spellings of the brands the catalog carries; the value is matched against brands.name.
export const BRAND_ALIASES = Object.freeze([
  ["nike", ["نايكي", "نايك", "نيكي", "nike"]],
  ["adidas", ["اديداس", "أديداس", "اديدس", "adidas"]],
  ["skechers", ["اسكتشرز", "سكتشرز", "اسكتشر", "سكتشر", "سكيتشرز", "اسكيتشرز", "skechers", "sketchers"]],
  ["new balance", ["نيو بالانس", "نيوبالانس", "نيو بلانس", "new balance", "newbalance", "nb"]],
  ["puma", ["بوما", "puma"]],
  ["asics", ["اسيكس", "اسكس", "asics"]],
  ["lacoste", ["لاكوست", "lacoste"]],
  ["tommy hilfiger", ["تومي", "تومي هيلفيجر", "tommy"]],
  ["converse", ["كونفرس", "كونفيرس", "converse"]],
  ["hoka", ["هوكا", "hoka"]],
  ["reebok", ["ريبوك", "reebok"]],
  ["david jones", ["ديفيد جونز", "david jones"]],
  ["momolly", ["مومولي", "momolly"]],
  ["saucony", ["سوكوني", "saucony"]],
].map(([brand, aliases]) => [brand, wordsPattern(aliases)]));

const STRONG_BROWSE = /(المتاح|المتوفر|كل اللي|كل الموديلات|الموديلات|موديلات|وريني|ورينى|فرجني|اشوف|عندك ايه|عندكم ايه|فيه ايه|في ايه|ايه اللي عندك|show me|what do you have)/u;
const WEAK_BROWSE = /(متاح|متوفر|موجود|عندك|عندكم|فيه|عايز|عاوز|محتاج|available)/u;
const GRADE_DIFFERENCE = /(الفرق|فرق|يفرق|بيفرق|الاختلاف|ايه احسن|مين احسن|الاحسن|احسن|افضل|الافضل|difference|better)/u;

const firstMatch = (list = [], value = "") => list.find((item) => item.pattern.test(value)) || null;

export const detectRequestedSize = (normalized = "") => {
  const match = normalized.match(/(?<!\d)(2[5-9]|3\d|4\d|5[0-2])(?!\d)/);
  return match?.[1] || "";
};

/**
 * `brandNames`: the catalog's brands.name values. A brand is reported in the catalog's own
 * spelling ("SKECHERS"), so the storefront link filters on the exact stored name.
 */
export const detectCatalogBrowseSlots = (message = "", { brandNames = [] } = {}) => {
  const normalized = normalizeBrowseText(message);
  const type = firstMatch(PRODUCT_TYPES, normalized)?.key || "";
  const size = detectRequestedSize(normalized);
  // "ميرور اوريجينال" is the mirror grade, never the original one.
  const gradeMatches = GRADE_WORDS.filter((grade) => grade.pattern.test(normalized)).map((grade) => grade.key);
  const grade = gradeMatches.includes("mirror_original")
    ? "mirror_original"
    : gradeMatches[0] || (ALL_GRADES.test(normalized) ? "all" : "");
  const gender = firstMatch(AUDIENCES, normalized)?.key || "";
  const catalogBrands = brandNames.map((name) => text(name)).filter(Boolean);
  const aliasBrand = BRAND_ALIASES.find(([, pattern]) => pattern.test(normalized))?.[0] || "";
  const directBrand = catalogBrands
    .filter((name) => !/^(unbranded|classic|bags)$/i.test(name))
    .sort((left, right) => right.length - left.length)
    .find((name) => wordsPattern([name]).test(normalized)) || "";
  const brandKey = aliasBrand || directBrand.toLowerCase();
  const brand = brandKey ? catalogBrands.find((name) => name.toLowerCase() === brandKey) || "" : "";
  return {
    normalized,
    type,
    size,
    grade,
    gradesMentioned: gradeMatches,
    gender,
    brand,
    anySize: ANY_SIZE.test(normalized),
    strongBrowse: STRONG_BROWSE.test(normalized),
    weakBrowse: WEAK_BROWSE.test(normalized),
    asksGradeDifference: GRADE_DIFFERENCE.test(normalized),
  };
};

export default { detectCatalogBrowseSlots, normalizeBrowseText, PRODUCT_TYPES, productTypeByKey };
