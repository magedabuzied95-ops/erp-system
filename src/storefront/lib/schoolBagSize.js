const SCHOOL_BAG_TYPES = new Set(["school-bag", "school_bag"]);

export const isSchoolBagProduct = (product = {}) =>
  SCHOOL_BAG_TYPES.has(String(product?.bag_type ?? product?.bagType ?? "").trim().toLowerCase());

export const schoolBagSizeInches = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  const match = normalized.match(/^(?:inch(?:es)?[-_\s]*)?(\d{1,2})(?:[-_\s]*inch(?:es)?)?$/i);
  const inches = Number(match?.[1] || 0);
  return inches >= 12 && inches <= 22 ? inches : null;
};

export const formatSchoolBagCardSize = (value = "", language = "ar") => {
  const inches = schoolBagSizeInches(value);
  if (!inches) return String(value || "");
  return String(language || "ar").toLowerCase().startsWith("ar")
    ? `${inches} بوصة`
    : `${inches} inch`;
};
