const range = (start, end, prefix = "") =>
  Array.from({ length: end - start + 1 }, (_, index) => `${prefix}${start + index}`);

export const CROCS_C_SIZES = range(4, 10, "C");
export const CROCS_J_SIZES = range(1, 5, "J");
export const CROCS_EU_DOUBLE_SIZES = Array.from(
  { length: 30 },
  (_, index) => `${20 + index}/${21 + index}`
);

export const CROCS_SIZE_GROUPS = [
  { id: "c", label: "C", sizes: CROCS_C_SIZES },
  { id: "j", label: "J", sizes: CROCS_J_SIZES },
  { id: "eu-double", label: "EU مزدوج", sizes: CROCS_EU_DOUBLE_SIZES },
];

export const CROCS_KNOWN_SIZES = CROCS_SIZE_GROUPS.flatMap((group) => group.sizes);

const knownRank = new Map(CROCS_KNOWN_SIZES.map((size, index) => [size.toLowerCase(), index]));

export const normalizeCrocsSizeValue = (value = "") => {
  const compact = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!compact) return "";

  const cOrJ = compact.match(/^([cj])\s*(\d+)$/i);
  if (cOrJ) return `${cOrJ[1].toUpperCase()}${Number(cOrJ[2])}`;

  const euDouble = compact.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (euDouble) return `${Number(euDouble[1])}/${Number(euDouble[2])}`;

  return compact;
};

export const crocsSizeKey = (value = "") => normalizeCrocsSizeValue(value).toLocaleLowerCase("en");

export const isKnownCrocsSize = (value = "") => knownRank.has(crocsSizeKey(value));

export const compareCrocsSizes = (left, right) => {
  const leftValue = normalizeCrocsSizeValue(
    typeof left === "object" && left !== null ? left.size ?? left.label ?? left.value ?? "" : left
  );
  const rightValue = normalizeCrocsSizeValue(
    typeof right === "object" && right !== null ? right.size ?? right.label ?? right.value ?? "" : right
  );
  const leftRank = knownRank.get(crocsSizeKey(leftValue));
  const rightRank = knownRank.get(crocsSizeKey(rightValue));
  const leftKnown = Number.isInteger(leftRank);
  const rightKnown = Number.isInteger(rightRank);

  if (leftKnown && rightKnown) return leftRank - rightRank;
  if (leftKnown) return -1;
  if (rightKnown) return 1;

  // Modern JavaScript sorting is stable. Returning zero keeps unknown and
  // legacy labels in their stored order instead of silently reinterpreting them.
  return 0;
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
