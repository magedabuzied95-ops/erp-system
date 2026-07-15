const text = (value) => String(value ?? "").trim();

const isRealCategory = (value) => {
  const normalized = text(value).toLowerCase();
  return Boolean(normalized) && !["uncategorized", "unclassified", "غير مصنف", "بدون فئة"].includes(normalized);
};

export const getMissingRequiredProductFields = ({ brand, category, productType } = {}) => {
  const missing = [];
  if (!text(brand)) missing.push({ key: "brand", label: "العلامة التجارية" });
  if (!isRealCategory(category)) missing.push({ key: "category", label: "الفئة" });
  if (!text(productType)) missing.push({ key: "product_type", label: "نوع المنتج" });
  return missing;
};

export const buildMissingRequiredProductFieldsMessage = (missing = []) =>
  missing.length > 0
    ? `لا يمكن حفظ المنتج. لم يتم إدخال: ${missing.map((field) => field.label).join("، ")}`
    : "";
