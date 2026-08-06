export const CLASSIFICATION_FIELDS = {
  gender: "gender",
  productType: "product_type",
  bagType: "bag_type",
  grade: "grade",
};

export const CANONICAL_PRODUCT_TYPE_OPTIONS = Object.freeze([
  { value: "crocs", label: "Crocs", label_ar: "Crocs", label_en: "Crocs", sort_order: 1 },
  { value: "bags", label: "Bags", label_ar: "Bags", label_en: "Bags", sort_order: 2 },
  { value: "sneakers", label: "Sneakers", label_ar: "Sneakers", label_en: "Sneakers", sort_order: 3 },
  { value: "winter_collection", label: "كولكشن الشتوي", label_ar: "كولكشن الشتوي", label_en: "Winter Collection", sort_order: 4 },
  { value: "slippers", label: "Slippers", label_ar: "Slippers", label_en: "Slippers", sort_order: 5 },
]);

export const normalizeClassificationValue = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

export const normalizeCanonicalProductType = (value, fallback = "sneakers") => {
  const normalized = normalizeClassificationValue(value);
  if (!normalized) return fallback;
  if (["crocs", "croc"].includes(normalized)) return "crocs";
  if (["bags", "bag", "handbag", "backpack", "tote", "tote_bag", "shoulder_bag", "crossbody_bag"].includes(normalized)) return "bags";
  if (["slippers", "slipper", "slides", "slide", "sandals", "sandal"].includes(normalized)) return "slippers";
  if (["winter_collection", "wintercollection", "winter"].includes(normalized)) return "winter_collection";
  return "sneakers";
};

export const buildFieldOptions = (
  groups = [],
  fieldKey,
  currentValue = "",
  { includeInactive = false, includeCurrentValue = true } = {}
) => {
  const group = groups.find((item) => String(item.key || "") === String(fieldKey || ""));
  if (String(fieldKey || "") === CLASSIFICATION_FIELDS.productType) {
    const source = group?.options || [];
    return CANONICAL_PRODUCT_TYPE_OPTIONS.map((canonical) => {
      const saved = source.find((option) => normalizeClassificationValue(option.value) === canonical.value);
      return { ...canonical, ...(saved || {}), value: canonical.value, is_active: true };
    });
  }
  const options = (group?.options || [])
    .filter((option) => includeInactive || option.is_active !== false)
    .map((option) => ({
      ...option,
      value: normalizeClassificationValue(option.value),
      label: option.label_ar || option.label_en || option.value,
    }))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.label.localeCompare(b.label, "ar"));

  const legacyValue = String(currentValue || "").trim();
  if (
    includeCurrentValue &&
    legacyValue &&
    !options.some((option) => normalizeClassificationValue(option.value) === normalizeClassificationValue(legacyValue))
  ) {
    options.push({
      value: legacyValue,
      label: legacyValue,
      label_ar: legacyValue,
      label_en: legacyValue,
      sort_order: Number.MAX_SAFE_INTEGER,
      is_active: true,
      legacy: true,
    });
  }

  return options;
};

export const buildFieldOptionMap = (groups = [], fieldKey, { includeInactive = false } = {}) =>
  buildFieldOptions(groups, fieldKey, "", { includeInactive }).reduce((acc, option) => {
    acc.set(normalizeClassificationValue(option.value), option);
    return acc;
  }, new Map());

export const classificationGroupsToFieldOptions = (
  groups = [],
  currentValues = {},
  { includeInactive = false, includeCurrentValue = true } = {}
) => ({
  gender: buildFieldOptions(groups, CLASSIFICATION_FIELDS.gender, currentValues.gender || "", { includeInactive, includeCurrentValue }),
  productType: buildFieldOptions(groups, CLASSIFICATION_FIELDS.productType, currentValues.productType || "", { includeInactive, includeCurrentValue }),
  bagType: buildFieldOptions(groups, CLASSIFICATION_FIELDS.bagType, currentValues.bagType || "", { includeInactive, includeCurrentValue }),
  grade: buildFieldOptions(groups, CLASSIFICATION_FIELDS.grade, currentValues.grade || "", { includeInactive, includeCurrentValue }),
});

const aliasesForOption = (option = {}) =>
  [...new Set([option.value, option.label_ar, option.label_en].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];

export const getClassificationAliases = (groups = [], fieldKey, value = "") => {
  const map = buildFieldOptionMap(groups, fieldKey, { includeInactive: true });
  const normalized = normalizeClassificationValue(value);
  const option = map.get(normalized);
  if (!option) return normalized ? [normalized] : [];
  return aliasesForOption(option);
};

export const resolveClassificationValue = (groups = [], fieldKey, value = "") => {
  const normalized = normalizeClassificationValue(value);
  if (!normalized) return "";
  const map = buildFieldOptionMap(groups, fieldKey, { includeInactive: true });
  return map.get(normalized)?.value || normalized;
};

export const getClassificationLabel = (groups = [], fieldKey, value = "", locale = "ar") => {
  const map = buildFieldOptionMap(groups, fieldKey, { includeInactive: true });
  const normalized = normalizeClassificationValue(value);
  const option = map.get(normalized);
  if (!option) return String(value || "");
  return locale === "en" ? option.label_en || option.label || option.value : option.label_ar || option.label || option.value;
};
