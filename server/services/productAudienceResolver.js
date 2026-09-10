const text = (value = "") => String(value ?? "").trim();

const parseArray = (value) => {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
};

// One audience mapping for every ad feed we publish (Meta and Google read the same row).
export const resolveProductAudience = (row = {}) => {
  const raw = text(row.variant_audience || row.product_gender || parseArray(row.product_audiences)[0]).toLowerCase();
  if (["men", "man", "male", "mens", "رجال", "رجالي"].includes(raw)) return { gender: "male", age_group: "adult" };
  if (["women", "woman", "female", "ladies", "lady", "نساء", "نسائي", "حريمي"].includes(raw)) return { gender: "female", age_group: "adult" };
  if (["kids", "kid", "children", "child", "boys", "girls", "اطفال", "أطفال", "طفل"].includes(raw)) {
    return { gender: "unisex", age_group: "kids" };
  }
  return { gender: "", age_group: "" };
};

export default resolveProductAudience;
