const text = (value = "") => String(value ?? "").trim();

export const slugifyProductValue = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 160);

export const buildProductBaseSlug = ({ brand = "", name = "", fallback = "" } = {}) => {
  const base = slugifyProductValue([brand, name].map(text).filter(Boolean).join(" "));
  return base || slugifyProductValue(name) || slugifyProductValue(fallback) || "product";
};

export const productSlugWithId = (baseSlug = "", productId = "") => {
  const base = slugifyProductValue(baseSlug) || "product";
  const id = text(productId);
  return id && !base.endsWith(`-${id}`) ? `${base}-${id}`.slice(0, 180) : base;
};

export const normalizeProductImageUrl = (value = "") => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const url = text(value);
    if (!url || url === "[object Object]") return "";
    if (/^(https?:)?\/\//i.test(url) || url.startsWith("/")) return url;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return "";
    return url;
  }
  if (typeof value === "object") {
    return normalizeProductImageUrl(value.url || value.image_url || value.secure_url || value.src || "");
  }
  return "";
};

export const uniqueImageUrls = (values = []) => {
  const seen = new Set();
  const urls = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const url = normalizeProductImageUrl(value);
    const key = url.toLowerCase();
    if (!url || seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
};

export const generateUniqueProductSlug = async (
  client,
  {
    tenantId = null,
    productId = null,
    name = "",
    brand = "",
    requestedSlug = "",
    fallback = "",
  } = {}
) => {
  const id = productId ? Number(productId) : null;
  const baseSlug = slugifyProductValue(requestedSlug) || buildProductBaseSlug({ brand, name, fallback });
  const result = await client.query(
    `
    SELECT id
    FROM products
    WHERE ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)
      AND ($2::bigint IS NULL OR id <> $2::bigint)
      AND (
        LOWER(TRIM(COALESCE(slug, ''))) = LOWER(TRIM($3::text))
        OR LOWER(TRIM(COALESCE(canonical_slug, ''))) = LOWER(TRIM($3::text))
      )
    LIMIT 1
    `,
    [tenantId, id, baseSlug]
  );
  if (!result.rows[0]) return baseSlug;
  if (!id) {
    const error = new Error("Product slug already exists and product id is not available for a stable suffix");
    error.status = 409;
    error.code = "PRODUCT_SLUG_DUPLICATE";
    throw error;
  }
  return productSlugWithId(baseSlug, id);
};
