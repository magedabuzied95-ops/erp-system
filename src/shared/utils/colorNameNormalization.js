export const STANDARD_COLOR_NAMES = [
  "Black", "White", "Off White", "Cream", "Beige", "Grey", "Silver",
  "Red", "Burgundy", "Pink", "Rose", "Orange", "Yellow", "Gold",
  "Green", "Olive", "Mint", "Blue", "Navy", "Sky Blue", "Purple",
  "Brown", "Camel", "Tan",
];

const COLOR_ALIASES = new Map([
  ["biege", "Beige"],
  ["beije", "Beige"],
  ["beage", "Beige"],
  ["beig", "Beige"],
  ["gray", "Grey"],
  ["gry", "Grey"],
  ["grey", "Grey"],
  ["whit", "White"],
  ["wihte", "White"],
  ["offwhite", "Off White"],
  ["off-white", "Off White"],
  ["navyblue", "Navy"],
  ["navy blue", "Navy"],
  ["skyblue", "Sky Blue"],
  ["sky-blue", "Sky Blue"],
  ["bleu", "Blue"],
  ["bule", "Blue"],
  ["balck", "Black"],
  ["blak", "Black"],
  ["brwon", "Brown"],
  ["broun", "Brown"],
  ["purpel", "Purple"],
  ["pruple", "Purple"],
  ["yelow", "Yellow"],
  ["oragne", "Orange"],
  ["sliver", "Silver"],
  ["burgandy", "Burgundy"],
  ["burgandy", "Burgundy"],
]);

const titleCase = (value = "") =>
  String(value)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);

const normalizeSingleColor = (value = "") => {
  const clean = String(value).trim().replace(/\s+/g, " ");
  if (!clean) return "";
  const key = clean.toLowerCase();
  const compactKey = key.replace(/\s+/g, "");
  return COLOR_ALIASES.get(key) || COLOR_ALIASES.get(compactKey) ||
    STANDARD_COLOR_NAMES.find((name) => name.toLowerCase() === key) ||
    titleCase(clean);
};

export const normalizeColorName = (value = "") =>
  String(value)
    .split(/\s*(\+|&|\/)\s*/)
    .map((part) => ["+", "&", "/"].includes(part) ? part : normalizeSingleColor(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

export default normalizeColorName;
