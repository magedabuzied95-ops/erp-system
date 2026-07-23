export const slugifyEdition = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeMirrorGrade = (value = "") =>
  String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

const MIRROR_GRADES = new Set([
  "mirror",
  "mirror_original",
  "original_mirror",
  "ميرور",
  "ميرور_اوريجينال",
  "ميرور_أوريجينال",
  "ميرور_اوريجنال",
  "ميرور_أوريجنال",
]);

export const isMirrorProduct = (product) => {
  if (!product) return false;
  if (product.is_mirror === true || String(product.is_mirror || "").toLowerCase() === "true") return true;

  return [
    product.grade,
    product.grade_slug,
    product.gradeSlug,
    product.grade_name,
    product.gradeName,
  ].some((value) => MIRROR_GRADES.has(normalizeMirrorGrade(value)));
};

export const mirrorProductTitle = (product = {}, variant = null) => {
  if (!isMirrorProduct(product)) return product.name || "";
  const edition = String(variant?.edition_name || "").trim();
  return edition ? `${product.name || ""} ${edition}`.trim() : product.name || "";
};
