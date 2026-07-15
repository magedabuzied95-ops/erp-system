export const slugifyEdition = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const isMirrorProduct = (product) => {
  if (!product) return false;

  if (product.is_mirror === true || String(product.is_mirror || "").toLowerCase() === "true") return true;

  const grade = String(product.grade || "").toLowerCase();
  const gradeSlug = String(product.grade_slug || product.gradeSlug || "").toLowerCase();
  const gradeName = String(product.grade_name || product.gradeName || "").toLowerCase();
  const categorySlug = String(product.category_slug || product.categorySlug || "").toLowerCase();
  const categoryName = String(product.category_name || product.categoryName || "").toLowerCase();

  return (
    grade.includes("mirror") ||
    grade.includes("ميرور") ||
    gradeSlug.includes("mirror") ||
    gradeName.includes("mirror") ||
    categorySlug.includes("mirror") ||
    categoryName.includes("mirror")
  );
};

export const mirrorProductTitle = (product = {}, variant = null) => {
  if (!isMirrorProduct(product)) return product.name || "";
  const edition = String(variant?.edition_name || "").trim();
  return edition ? `${product.name || ""} ${edition}`.trim() : product.name || "";
};
