const MIRROR_VALUE = "mirror";

const normalizeMirrorToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

const hasText = (value) => String(value ?? "").trim() !== "";

const includesMirrorName = (value) => {
  const text = String(value || "").trim().toLowerCase();
  return text.includes(MIRROR_VALUE) || text.includes("\u0645\u064a\u0631\u0648\u0631");
};

export const slugifyEdition = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const isMirrorProduct = (product = {}) => {
  const grade = product?.grade;
  const gradeSlug =
    typeof grade === "object" && grade !== null
      ? grade.slug ?? grade.value ?? grade.key
      : product.grade_slug ?? product.gradeSlug ?? grade;
  const gradeName =
    typeof grade === "object" && grade !== null
      ? grade.name ?? grade.label ?? grade.label_en ?? grade.label_ar
      : product.grade_name ?? product.gradeName ?? grade;

  return (
    normalizeMirrorToken(gradeSlug) === MIRROR_VALUE ||
    (hasText(gradeName) && includesMirrorName(gradeName))
  );
};

export const mirrorProductTitle = (product = {}, variant = null) => {
  if (!isMirrorProduct(product)) return product.name || "";
  const edition = String(variant?.edition_name || "").trim();
  return edition ? `${product.name || ""} ${edition}`.trim() : product.name || "";
};
