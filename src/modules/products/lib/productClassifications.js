export const CLASSIFICATION_FIELDS = {
  gender: "gender",
  productType: "product_type",
  grade: "grade",
};

export const normalizeClassificationValue = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

export const buildFieldOptions = (
  groups = [],
  fieldKey,
  currentValue = "",
  { includeInactive = false, includeCurrentValue = true } = {}
) => {
  const group = groups.find((item) => String(item.key || "") === String(fieldKey || ""));
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
