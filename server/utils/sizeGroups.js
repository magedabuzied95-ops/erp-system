export const SIZE_GROUPS = Object.freeze({
  WOMEN: Object.freeze({ key: "WOMEN", display_key: "women-37-41", audience: "women", label: "حريمي 37–41", sizes: Object.freeze(["37", "38", "39", "40", "41"]) }),
  MEN: Object.freeze({ key: "MEN", display_key: "men-41-45", audience: "men", label: "رجالي 41–45", sizes: Object.freeze(["41", "42", "43", "44", "45"]) }),
  KIDS_CLOG: Object.freeze({ key: "KIDS_CLOG", display_key: "kids-22-26", audience: "kids", label: "أطفال كلوك 22–26", sizes: Object.freeze(["22", "23", "24", "25", "26"]) }),
  BABY: Object.freeze({ key: "BABY", display_key: "kids-27-31", audience: "kids", label: "أطفال بيبي 27–31", sizes: Object.freeze(["27", "28", "29", "30", "31"]) }),
  BOYS: Object.freeze({ key: "BOYS", display_key: "kids-32-36", audience: "kids", label: "أولادي 32–36", sizes: Object.freeze(["32", "33", "34", "35", "36"]) }),
});

export const SIZE_GROUP_KEYS = Object.freeze(Object.keys(SIZE_GROUPS));
const AUDIENCE_ORDER = ["men", "women", "kids"];

export const normalizeProductAudiences = (...values) => {
  const text = values.flat(Infinity).filter(Boolean).join(" ").toLowerCase();
  const matched = [];
  if (/(women|woman|female|ladies|حريمي|نسائي|نساء)/i.test(text)) matched.push("women");
  if (/(kids|kid|child|children|boy|girl|أطفال|اطفال|طفل|أولادي|اولادي|بيبي|كلوك)/i.test(text)) matched.push("kids");
  if (/(^|[^a-z])(men|man|male)([^a-z]|$)|رجالي|رجال/i.test(text)) matched.push("men");
  return AUDIENCE_ORDER.filter((key) => matched.includes(key));
};

export const normalizeSizeGroupKey = (value = "") => {
  const key = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return SIZE_GROUPS[key] ? key : null;
};

export const parseSizeGroupKeys = (value) => {
  if (Array.isArray(value)) return value.flat(Infinity).map((item) => String(item ?? "").trim()).filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseSizeGroupKeys(parsed);
    } catch {
      // Legacy values are stored as a single key, not JSON.
    }
    return [raw];
  }
  return [String(value).trim()].filter(Boolean);
};

export const normalizeSizeGroupKeys = (value) => {
  const selected = new Set(parseSizeGroupKeys(value).map(normalizeSizeGroupKey).filter(Boolean));
  return SIZE_GROUP_KEYS.filter((key) => selected.has(key));
};

export const resolveSizeGroups = (value) => {
  const rawKeys = parseSizeGroupKeys(value);
  const keys = normalizeSizeGroupKeys(rawKeys);
  const invalid_keys = rawKeys.filter((key) => !normalizeSizeGroupKey(key));
  const sizes = Array.from(new Set(keys.flatMap((key) => SIZE_GROUPS[key].sizes)))
    .sort((left, right) => (numericSize(left) ?? Number.MAX_SAFE_INTEGER) - (numericSize(right) ?? Number.MAX_SAFE_INTEGER));
  const min = sizes[0] || null;
  const max = sizes[sizes.length - 1] || null;
  return {
    keys,
    groups: keys.map((key) => SIZE_GROUPS[key]),
    sizes,
    min,
    max,
    range: min && max ? (min === max ? min : `${min}–${max}`) : "",
    count: sizes.length,
    invalid_keys,
  };
};

export const numericSize = (value) => {
  const match = String(value ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const groupContainsEverySize = (group, sizes = []) => {
  const normalized = sizes.map((size) => String(numericSize(size) ?? "")).filter(Boolean);
  return normalized.length > 0 && normalized.every((size) => group.sizes.includes(size));
};

export const resolveCanonicalSizeGroup = ({ sizeGroup, audience, audiences = [], gender, category, section, productType, sizes = [] } = {}) => {
  const explicit = normalizeSizeGroupKey(sizeGroup);
  if (explicit) return explicit;

  const resolvedAudiences = normalizeProductAudiences(audience, audiences, gender, category, section, productType);
  if (resolvedAudiences.length !== 1) return null;
  if (resolvedAudiences[0] === "women") return "WOMEN";
  if (resolvedAudiences[0] === "men") return "MEN";

  const classificationText = [audience, audiences, gender, category, section, productType].flat(Infinity).filter(Boolean).join(" ").toLowerCase();
  if (/(clog|crocs|كروكس|كلوك)/i.test(classificationText)) return "KIDS_CLOG";
  if (/(baby|babies|infant|رضيع|بيبي)/i.test(classificationText)) return "BABY";
  if (/(boys|boy|ولادي|أولادي|اولادي)/i.test(classificationText)) return "BOYS";

  const kidsMatches = ["KIDS_CLOG", "BABY", "BOYS"].filter((key) => groupContainsEverySize(SIZE_GROUPS[key], sizes));
  return kidsMatches.length === 1 ? kidsMatches[0] : null;
};

export const getSizeGroup = (value) => SIZE_GROUPS[normalizeSizeGroupKey(value)] || null;

export const getDisplaySizeRanges = (audience) =>
  SIZE_GROUP_KEYS.map((key) => SIZE_GROUPS[key])
    .filter((group) => group.audience === audience)
    .map((group) => ({
      key: group.display_key,
      label: group.label,
      min: Number(group.sizes[0]),
      max: Number(group.sizes[group.sizes.length - 1]),
      size_group: group.key,
    }));
