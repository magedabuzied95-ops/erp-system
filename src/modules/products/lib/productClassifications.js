export const CLASSIFICATION_FIELDS = {
  gender: "gender",
  productType: "product_type",
  style: "style",
  grade: "grade",
};

export const DEFAULT_CLASSIFICATION_GROUPS = [
  {
    key: "gender",
    name_ar: "الجنس",
    name_en: "Gender",
    sort_order: 1,
    is_active: true,
    options: [
      { value: "men", label_ar: "رجالي", label_en: "Men", sort_order: 1, icon: "M", color: "#7c3aed", is_active: true },
      { value: "women", label_ar: "حريمي", label_en: "Women", sort_order: 2, icon: "W", color: "#db2777", is_active: true },
      { value: "kids", label_ar: "أطفال", label_en: "Kids", sort_order: 3, icon: "K", color: "#2563eb", is_active: true },
    ],
  },
  {
    key: "product_type",
    name_ar: "نوع المنتج",
    name_en: "Product Type",
    sort_order: 2,
    is_active: true,
    options: [
      { value: "sneakers", label_ar: "سنيكرز", label_en: "Sneakers", sort_order: 1, icon: "S", color: "#111827", is_active: true },
      { value: "slides", label_ar: "شباشب", label_en: "Slides", sort_order: 2, icon: "L", color: "#0f766e", is_active: true },
      { value: "bags", label_ar: "شنط", label_en: "Bags", sort_order: 3, icon: "B", color: "#b45309", is_active: true },
    ],
  },
  {
    key: "style",
    name_ar: "الستايل",
    name_en: "Style",
    sort_order: 3,
    is_active: true,
    options: [
      { value: "running", label_ar: "رياضي", label_en: "Running", sort_order: 1, icon: "Run", color: "#2563eb", is_active: true },
      { value: "casual", label_ar: "كاجوال", label_en: "Casual", sort_order: 2, icon: "Cas", color: "#7c3aed", is_active: true },
      { value: "school", label_ar: "مدارس", label_en: "School", sort_order: 3, icon: "Sch", color: "#0891b2", is_active: true },
    ],
  },
  {
    key: "grade",
    name_ar: "الفئة",
    name_en: "Grade",
    sort_order: 4,
    is_active: true,
    options: [
      { value: "vietnam_import", label_ar: "فيتنام مستورد", label_en: "Vietnam Import", sort_order: 1, icon: "VN", color: "#16a34a", is_active: true },
      { value: "mirror", label_ar: "ميرور", label_en: "Mirror", sort_order: 2, icon: "M", color: "#6d28d9", is_active: true },
      { value: "local", label_ar: "محلي", label_en: "Local", sort_order: 3, icon: "L", color: "#f97316", is_active: true },
    ],
  },
];

export const normalizeClassificationValue = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

export const buildFieldOptions = (groups = DEFAULT_CLASSIFICATION_GROUPS, fieldKey, currentValue = "", { includeInactive = false } = {}) => {
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
  if (legacyValue && !options.some((option) => normalizeClassificationValue(option.value) === normalizeClassificationValue(legacyValue))) {
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

export const buildFieldOptionMap = (groups = DEFAULT_CLASSIFICATION_GROUPS, fieldKey, { includeInactive = false } = {}) =>
  buildFieldOptions(groups, fieldKey, "", { includeInactive }).reduce((acc, option) => {
    acc.set(normalizeClassificationValue(option.value), option);
    return acc;
  }, new Map());

export const classificationGroupsToFieldOptions = (groups = DEFAULT_CLASSIFICATION_GROUPS, currentValues = {}, { includeInactive = false } = {}) => ({
  gender: buildFieldOptions(groups, CLASSIFICATION_FIELDS.gender, currentValues.gender || "", { includeInactive }),
  productType: buildFieldOptions(groups, CLASSIFICATION_FIELDS.productType, currentValues.productType || "", { includeInactive }),
  style: buildFieldOptions(groups, CLASSIFICATION_FIELDS.style, currentValues.style || "", { includeInactive }),
  grade: buildFieldOptions(groups, CLASSIFICATION_FIELDS.grade, currentValues.grade || "", { includeInactive }),
});

const aliasesForOption = (option = {}) =>
  [...new Set([option.value, option.label_ar, option.label_en].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];

export const getClassificationAliases = (groups = DEFAULT_CLASSIFICATION_GROUPS, fieldKey, value = "") => {
  const map = buildFieldOptionMap(groups, fieldKey, { includeInactive: true });
  const normalized = normalizeClassificationValue(value);
  const option = map.get(normalized);
  if (!option) return normalized ? [normalized] : [];
  return aliasesForOption(option);
};

export const resolveClassificationValue = (groups = DEFAULT_CLASSIFICATION_GROUPS, fieldKey, value = "") => {
  const normalized = normalizeClassificationValue(value);
  if (!normalized) return "";
  const map = buildFieldOptionMap(groups, fieldKey, { includeInactive: true });
  return map.get(normalized)?.value || normalized;
};

export const getClassificationLabel = (groups = DEFAULT_CLASSIFICATION_GROUPS, fieldKey, value = "", locale = "ar") => {
  const map = buildFieldOptionMap(groups, fieldKey, { includeInactive: true });
  const normalized = normalizeClassificationValue(value);
  const option = map.get(normalized);
  if (!option) return String(value || "");
  return locale === "en" ? option.label_en || option.label || option.value : option.label_ar || option.label || option.value;
};
