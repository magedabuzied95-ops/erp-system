const normalizeEuSeparator = (value = "") => String(value || "").replace(/-/g, "/");

// Canonical Crocs conversion table. The factory marking remains the variant
// identity; `eu` is presentation metadata only.
export const CROCS_CANONICAL_SIZE_MAP = [
  { c: "C4", eu: "19/20" },
  { c: "C5", eu: "20/21" },
  { c: "C6", eu: "22/23" },
  { c: "C7", eu: "23/24" },
  { c: "C8", eu: "24/25" },
  { c: "C9", eu: "25/26" },
  { c: "C10", eu: "27/28" },
  { j: "J1", eu: "32/33" },
  { j: "J2", eu: "33/34" },
  { j: "J3", eu: "34/35" },
  { j: "J4", eu: "36/37" },
  { j: "J5", eu: "37/38" },
  { men: "M2", women: "W4", mwLabel: "M2/W4", eu: "33/34" },
  { men: "M3", women: "W5", mwLabel: "M3/W5", eu: "34/35" },
  { men: "M4", women: "W6", mwLabel: "M4/W6", eu: "36/37" },
  { men: "M5", women: "W7", mwLabel: "M5/W7", eu: "37/38" },
  { men: "M6", women: "W8", mwLabel: "M6/W8", eu: "38/39" },
  { men: "M7", women: "W9", mwLabel: "M7/W9", eu: "39/40" },
  { men: "M8", women: "W10", mwLabel: "M8/W10", eu: "41/42" },
  { men: "M9", women: "W11", mwLabel: "M9/W11", eu: "42/43" },
  { men: "M10", women: "W12", mwLabel: "M10/W12", eu: "43/44" },
  { men: "M11", women: "W13", mwLabel: "M11/W13", eu: "45/46" },
  { men: "M12", mwLabel: "M12", eu: "46/47" },
  { men: "M13", mwLabel: "M13", eu: "48/49" },
  { men: "M14", mwLabel: "M14", eu: "49/50" },
  { men: "M15", mwLabel: "M15", eu: "50/51" },
  { men: "M16", mwLabel: "M16", eu: "51/52" },
  { men: "M17", mwLabel: "M17", eu: "52/53" },
  // A directly printed EU factory size can remain selectable even when no
  // C/J/MW alias maps to it in the canonical chart.
  { eu: "44/45" },
];

export const CROCS_C_SIZES = CROCS_CANONICAL_SIZE_MAP.map((entry) => entry.c).filter(Boolean);
export const CROCS_J_SIZES = CROCS_CANONICAL_SIZE_MAP.map((entry) => entry.j).filter(Boolean);
export const CROCS_MW_SIZES = CROCS_CANONICAL_SIZE_MAP.map((entry) => entry.mwLabel).filter(Boolean);
export const CROCS_EU_DOUBLE_SIZES = [...new Set(CROCS_CANONICAL_SIZE_MAP.map((entry) => entry.eu).filter(Boolean))]
  .sort((left, right) => Number(left.split("/")[0]) - Number(right.split("/")[0]));

export const CROCS_SIZE_GROUPS = [
  { id: "c", label: "C", sizes: CROCS_C_SIZES },
  { id: "j", label: "J", sizes: CROCS_J_SIZES },
  { id: "mw", label: "M/W", sizes: CROCS_MW_SIZES },
  { id: "eu-double", label: "EU مزدوج", sizes: CROCS_EU_DOUBLE_SIZES },
];

export const CROCS_KNOWN_SIZES = CROCS_SIZE_GROUPS.flatMap((group) => group.sizes);

export const normalizeCrocsSizeValue = (value = "") => {
  const compact = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!compact) return "";

  const cOrJ = compact.match(/^([cj])\s*(\d+)$/i);
  if (cOrJ) return `${cOrJ[1].toUpperCase()}${Number(cOrJ[2])}`;

  const mw = compact.match(/^m\s*(\d+)\s*\/\s*w\s*(\d+)$/i);
  if (mw) return `M${Number(mw[1])}/W${Number(mw[2])}`;

  const menOnly = compact.match(/^m\s*(\d+)$/i);
  if (menOnly) return `M${Number(menOnly[1])}`;

  const euDouble = normalizeEuSeparator(compact).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (euDouble) return `${Number(euDouble[1])}/${Number(euDouble[2])}`;

  return compact;
};

export const crocsSizeKey = (value = "") => normalizeCrocsSizeValue(value).toLocaleLowerCase("en");

const canonicalByAlias = new Map();
CROCS_CANONICAL_SIZE_MAP.forEach((entry) => {
  [entry.c, entry.j, entry.mwLabel, entry.eu].filter(Boolean).forEach((alias) => {
    const key = crocsSizeKey(alias);
    if (!canonicalByAlias.has(key)) canonicalByAlias.set(key, entry);
  });
});

const knownRank = new Map(CROCS_KNOWN_SIZES.map((size, index) => [crocsSizeKey(size), index]));

export const getCrocsCanonicalSize = (value = "") => canonicalByAlias.get(crocsSizeKey(value)) || null;

export const resolveCrocsEuSize = (value = "") => {
  const normalized = normalizeCrocsSizeValue(value);
  return getCrocsCanonicalSize(normalized)?.eu || normalized;
};

export const isKnownCrocsSize = (value = "") => knownRank.has(crocsSizeKey(value));

export const isCrocsProduct = (product = {}) => {
  const values = [
    product?.product_type,
    product?.productType,
    product?.type,
    product?.category,
    product?.category_name,
  ];
  return values.some((value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "crocs" || normalized === "croc" || normalized === "كروكس" || normalized.includes("crocs");
  });
};

const comparableSizeValue = (value) => (
  typeof value === "object" && value !== null ? value.size ?? value.label ?? value.value ?? "" : value
);

export const compareCrocsSizes = (left, right) => {
  const leftValue = normalizeCrocsSizeValue(comparableSizeValue(left));
  const rightValue = normalizeCrocsSizeValue(comparableSizeValue(right));
  const leftRank = knownRank.get(crocsSizeKey(leftValue));
  const rightRank = knownRank.get(crocsSizeKey(rightValue));
  const leftKnown = Number.isInteger(leftRank);
  const rightKnown = Number.isInteger(rightRank);

  if (leftKnown && rightKnown) return leftRank - rightRank;
  if (leftKnown) return -1;
  if (rightKnown) return 1;
  return 0;
};

export const compareCrocsEuSizes = (left, right) => {
  const leftEu = resolveCrocsEuSize(comparableSizeValue(left));
  const rightEu = resolveCrocsEuSize(comparableSizeValue(right));
  const leftParts = leftEu.match(/^(\d+)\/(\d+)$/);
  const rightParts = rightEu.match(/^(\d+)\/(\d+)$/);
  if (leftParts && rightParts) {
    const first = Number(leftParts[1]) - Number(rightParts[1]);
    return first || Number(leftParts[2]) - Number(rightParts[2]);
  }
  if (leftParts) return -1;
  if (rightParts) return 1;
  return compareCrocsSizes(left, right);
};

export const buildCrocsStorefrontSizeOptions = (variants = []) => {
  const options = (Array.isArray(variants) ? variants : []).map((variant, index) => {
    const originalSize = normalizeCrocsSizeValue(variant?.size);
    return {
      variant,
      originalSize,
      displaySize: resolveCrocsEuSize(originalSize),
      sourceIndex: index,
    };
  }).filter((option) => option.originalSize);

  const displayCounts = options.reduce((counts, option) => {
    counts.set(option.displaySize, (counts.get(option.displaySize) || 0) + 1);
    return counts;
  }, new Map());

  return options.map((option) => ({
    ...option,
    collision: (displayCounts.get(option.displaySize) || 0) > 1,
  })).sort((left, right) => {
    const euOrder = compareCrocsEuSizes(left.displaySize, right.displaySize);
    if (euOrder) return euOrder;
    const originalOrder = compareCrocsSizes(left.originalSize, right.originalSize);
    return originalOrder || left.sourceIndex - right.sourceIndex;
  });
};

export const sortCrocsSizes = (sizes = []) => [...(Array.isArray(sizes) ? sizes : [])].sort(compareCrocsSizes);

export const uniqueCrocsSizes = (sizes = []) => {
  const seen = new Set();
  return (Array.isArray(sizes) ? sizes : []).reduce((result, size) => {
    const normalized = normalizeCrocsSizeValue(size);
    const key = crocsSizeKey(normalized);
    if (!key || seen.has(key)) return result;
    seen.add(key);
    result.push(normalized);
    return result;
  }, []);
};

export const findDuplicateCrocsSize = (sizes = []) => {
  const seen = new Set();
  for (const size of Array.isArray(sizes) ? sizes : []) {
    const normalized = normalizeCrocsSizeValue(size);
    const key = crocsSizeKey(normalized);
    if (!key) continue;
    if (seen.has(key)) return normalized;
    seen.add(key);
  }
  return "";
};
