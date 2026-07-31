export const normalizeMultiFilterValue = (value) => {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => String(item || "").trim()).filter((item) => item && item !== "all"))];
};

export const toggleMultiFilterValue = (current, value) => {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue || normalizedValue === "all") return [];
  const values = normalizeMultiFilterValue(current);
  return values.includes(normalizedValue)
    ? values.filter((item) => item !== normalizedValue)
    : [...values, normalizedValue];
};

export const multiFilterHasValue = (value) => normalizeMultiFilterValue(value).length > 0;

const isWinterCollectionOption = (option = {}) => {
  const text = [
    option.name,
    option.label,
    option.label_ar,
    option.label_en,
    option.value,
    option.id,
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();
  return text.includes("شتو") || text.includes("winter");
};

export const moveWinterCollectionToEnd = (options = []) => {
  const regular = [];
  const winter = [];
  (Array.isArray(options) ? options : []).forEach((option) => {
    (isWinterCollectionOption(option) ? winter : regular).push(option);
  });
  return [...regular, ...winter];
};

export const multiFilterMatches = (selected, candidate) => {
  const values = normalizeMultiFilterValue(selected);
  if (values.length === 0) return true;
  return values.includes(String(candidate || "").trim());
};

const defaultNormalizeText = (value = "") => String(value || "").trim().toLowerCase();

export const matchesQuickFilterGroups = (
  {
    audienceKeys = [],
    brandKey = "",
    manufacturerIds = new Set(),
    manufacturerNames = [],
  } = {},
  {
    genders = [],
    brands = [],
    manufacturers = [],
  } = {},
  normalizeText = defaultNormalizeText
) => {
  const selectedGenders = normalizeMultiFilterValue(genders);
  const selectedBrands = normalizeMultiFilterValue(brands);
  const selectedManufacturers = normalizeMultiFilterValue(manufacturers);

  const matchesGender =
    selectedGenders.length === 0 ||
    selectedGenders.some((gender) => audienceKeys.includes(String(gender || "").trim()));
  const matchesBrand =
    selectedBrands.length === 0 ||
    selectedBrands.includes(String(brandKey || "").trim());
  const matchesManufacturer =
    selectedManufacturers.length === 0 ||
    selectedManufacturers.some((manufacturerId) =>
      manufacturerIds.has(String(manufacturerId)) ||
      manufacturerNames.includes(normalizeText(String(manufacturerId).replace(/^name:/, "")))
    );

  return matchesGender && matchesBrand && matchesManufacturer;
};
