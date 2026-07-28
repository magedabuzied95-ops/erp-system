const audienceAliases = {
  men: new Set(["men", "man", "male", "رجالي", "رجال", "رجل"]),
  women: new Set(["women", "woman", "female", "ladies", "حريمي", "نسائي", "نساء", "سيدات"]),
  kids: new Set(["kids", "kid", "children", "child", "boys", "girls", "أطفال", "اطفال", "طفل"]),
};

export const normalizeProductAudienceValue = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  for (const [audience, aliases] of Object.entries(audienceAliases)) {
    if (aliases.has(normalized) || aliases.has(normalized.replace(/_/g, " "))) return audience;
  }
  return "";
};

export const getProductAudienceValues = (source = {}) => {
  const found = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      ["audiences", "product_audiences", "gender", "genders", "audience", "variant_audience", "variant_gender"].forEach((field) => visit(value[field]));
      visit(value.product);
      visit(value.variants);
      return;
    }
    if (value === null || value === undefined) return;
    String(value)
      .split(/[,\n|/+&]+/)
      .map(normalizeProductAudienceValue)
      .filter(Boolean)
      .forEach((audience) => found.add(audience));
  };
  visit(source);
  return ["men", "women", "kids"].filter((audience) => found.has(audience));
};

export const productMatchesAudience = (source, selectedAudience) => {
  const selected = normalizeProductAudienceValue(selectedAudience);
  return !selected || getProductAudienceValues(source).includes(selected);
};

