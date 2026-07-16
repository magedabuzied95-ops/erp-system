const text = (value) => String(value ?? "").trim();

export const getMissingRequiredProductFields = ({ brand, category, grade, productType } = {}) => {
  const missing = [];
  if (!text(brand)) missing.push({ key: "brand", label: "العلامة التجارية" });
  if (!text(grade)) missing.push({ key: "category", label: "الفئة" });
  if (!text(productType)) missing.push({ key: "product_type", label: "نوع المنتج" });
  return missing;
};

export const buildMissingRequiredProductFieldsMessage = (missing = []) =>
  missing.length > 0
    ? `لا يمكن حفظ المنتج. لم يتم إدخال: ${missing.map((field) => field.label).join("، ")}`
    : "";
