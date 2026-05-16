export const EDITION_PRESETS = {
  grey: [
    "Wolf Grey",
    "Shadow Grey",
    "Ash Grey",
    "Steel Grey",
    "Smoke Grey",
  ],
  gray: [
    "Wolf Grey",
    "Shadow Grey",
    "Ash Grey",
    "Steel Grey",
    "Smoke Grey",
  ],
  black: [
    "Black Phantom",
    "Midnight Black",
    "Stealth Black",
    "Shadow Black",
  ],
  white: [
    "Triple White",
    "Pure White",
    "Arctic White",
    "Cloud White",
  ],
  blue: [
    "Ocean Blue",
    "Royal Blue",
    "Deep Navy",
    "Sky Blue",
  ],
  green: [
    "Olive Shadow",
    "Forest Green",
    "Mint Shadow",
  ],
  beige: [
    "Cream Sand",
    "Desert Beige",
    "Sandstone",
  ],
};

const TYPO_NORMALIZATIONS = {
  gay: "grey",
  gray: "grey",
};

export const BASIC_COLOR_NAMES = [
  "black",
  "white",
  "grey",
  "gray",
  "blue",
  "green",
  "beige",
  "brown",
  "red",
  "yellow",
  "pink",
  "purple",
  "orange",
  "mocha",
];

export const normalizeColorName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .split(/\s+/)
    .map((part) => TYPO_NORMALIZATIONS[part] || part)
    .join(" ")
    .replace(/\s+/g, " ");

const normalizeText = normalizeColorName;

export function isBasicColorEdition(value = "") {
  const normalized = normalizeColorName(value);
  return BASIC_COLOR_NAMES.includes(normalized);
}

export function generateEditionName(colorName = "") {
  const key = normalizeColorName(colorName);
  const presets = EDITION_PRESETS[key];

  if (presets?.length) {
    return presets[Math.floor(Math.random() * presets.length)];
  }

  if (key.includes("black") && key.includes("grey")) return "Shadow Grey";
  if (key.includes("black") && key.includes("brown")) return "Dark Mocha";
  if (key.includes("black") && key.includes("white")) return "Panda";
  if (key.includes("white") && key.includes("brown")) return "Reverse Mocha";
  if (key.includes("green") || key.includes("olive")) return "Medium Olive";

  const source = normalizeColorName(colorName);
  const cleaned = source
    ? source.charAt(0).toUpperCase() + source.slice(1).toLowerCase()
    : "Signature";

  return `${cleaned} Edition`;
}

export function isInvalidEditionName(editionName = "", colorName = "") {
  const edition = normalizeText(editionName);
  const color = normalizeText(colorName);
  return !edition || edition.length < 3 || isBasicColorEdition(edition) || Boolean(color && edition === color);
}

export function ensureEditionName(editionName = "", colorName = "") {
  return isInvalidEditionName(editionName, colorName)
    ? generateEditionName(colorName)
    : String(editionName || "").trim();
}
