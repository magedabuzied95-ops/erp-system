const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();

const BLOCKED_NAME_PATTERN = /\b(?:purchase\s+save\s+perf|test|demo|perf|temporary|benchmark)\b/i;
const INACTIVE_STATUSES = new Set(["inactive", "disabled", "archived", "deleted", "draft"]);
const HIDDEN_VISIBILITY_VALUES = new Set(["false", "0", "no", "hidden", "inactive", "disabled", "private", "draft"]);
const VISIBILITY_FIELDS = [
  "storefront_visible",
  "is_storefront_visible",
  "visible_on_storefront",
  "show_in_storefront",
  "visible_in_storefront",
  "is_visible",
  "is_published",
  "published",
  "storefront_visibility",
];

const productId = (product = {}) => product?.id || product?.product_id || product?.productId || null;

const slugValue = (product = {}) =>
  text(product.slug || product.canonical_slug || product.product_slug || product.storefront_slug);

const productUrlValue = (product = {}) =>
  text(product.product_url || product.productUrl || product.url || product.finalUrl || product.final_url);

export const resolveAiProductUrl = (product = {}) => {
  const id = productId(product);
  const slug = slugValue(product);
  const existing = productUrlValue(product);
  let url = "";
  let used_fallback_id = false;
  if (existing) {
    url = existing;
  } else if (slug) {
    url = `/shop/product/${encodeURIComponent(slug)}`;
  } else if (id) {
    url = `/shop/product/${encodeURIComponent(String(id))}`;
    used_fallback_id = true;
  }
  console.log("[ai-product-url-resolved]", {
    product_id: id,
    slug,
    url,
    used_fallback_id,
  });
  return url;
};

const searchableBlob = (product = {}) =>
  [
    product.name,
    product.title,
    product.product_name,
    product.base_name,
    product.slug,
    product.canonical_slug,
    product.product_slug,
    product.sku,
    product.model,
    product.product_code,
    product.search_text,
  ].map(text).filter(Boolean).join(" ");

const explicitVisibilityState = (product = {}) => {
  const fields = VISIBILITY_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(product, field));
  if (!fields.length) return { known: false, visible: true };
  const hiddenField = fields.find((field) => {
    const value = product[field];
    if (value === false) return true;
    return HIDDEN_VISIBILITY_VALUES.has(lower(value));
  });
  return { known: true, visible: !hiddenField, field: hiddenField || "" };
};

export const aiProductExclusionReason = (product = {}, {
  requireProductUrl = false,
  requireStorefrontVisibility = false,
} = {}) => {
  if (!product || typeof product !== "object") return "invalid_product";
  if (product.deleted === true || product.is_deleted === true || product.deleted_at || product.deletedAt) return "deleted";
  if (product.is_active === false || product.active === false) return "inactive";
  if (INACTIVE_STATUSES.has(lower(product.status || product.product_status || "active"))) return "inactive";
  if (BLOCKED_NAME_PATTERN.test(searchableBlob(product))) return "test_demo_performance_product";
  if (!productId(product)) return "missing_product_id";

  const visibility = explicitVisibilityState(product);
  if (!visibility.visible) return "missing_storefront_visibility";
  if (requireStorefrontVisibility && !visibility.known) return "missing_storefront_visibility";

  if (requireProductUrl && !resolveAiProductUrl(product)) return "missing_product_url";
  return "";
};

export const isAiEligibleStorefrontProduct = (product = {}, options = {}) =>
  !aiProductExclusionReason(product, options);

export const logAiProductExclusion = (product = {}, reason = "") => {
  if (!reason) return;
  console.log("[ai-product-filter]", {
    excluded_product_id: productId(product),
    reason,
  });
};

export const filterAiEligibleProducts = (products = [], options = {}) =>
  (Array.isArray(products) ? products : []).filter((product) => {
    const reason = aiProductExclusionReason(product, options);
    if (reason) {
      logAiProductExclusion(product, reason);
      return false;
    }
    return true;
  });

export const aiProductSqlExclusionClause = (alias = "p", columns = new Set()) => {
  const clauses = [];
  const field = (column) => `${alias}.${column}`;
  const coalesceText = (column) => `COALESCE(${field(column)}::text, '')`;
  const searchable = [
    "name",
    "title",
    "name_en",
    "name_ar",
    "slug",
    "canonical_slug",
    "product_slug",
    "sku",
    "model",
    "product_code",
  ].filter((column) => columns.has(column)).map(coalesceText);

  if (columns.has("deleted_at")) clauses.push(`${field("deleted_at")} IS NULL`);
  if (columns.has("is_deleted")) clauses.push(`COALESCE(${field("is_deleted")}, FALSE) = FALSE`);
  if (columns.has("deleted")) clauses.push(`COALESCE(${field("deleted")}, FALSE) = FALSE`);
  if (columns.has("is_active")) clauses.push(`COALESCE(${field("is_active")}, TRUE) = TRUE`);
  if (columns.has("active")) clauses.push(`COALESCE(${field("active")}, TRUE) = TRUE`);
  if (columns.has("status")) {
    clauses.push(`COALESCE(NULLIF(LOWER(TRIM(${field("status")}::text)), ''), 'active') NOT IN ('inactive','disabled','archived','deleted','draft')`);
  }
  for (const column of VISIBILITY_FIELDS.filter((name) => columns.has(name))) {
    clauses.push(`LOWER(TRIM(COALESCE(${field(column)}::text, 'true'))) NOT IN ('false','0','no','hidden','inactive','disabled','private','draft')`);
  }

  if (searchable.length) {
    const blob = `LOWER(${searchable.join(" || ' ' || ")})`;
    clauses.push(`${blob} NOT LIKE '%purchase save perf%'`);
    clauses.push(`${blob} !~* '(^|[^a-z0-9])(test|demo|perf|temporary|benchmark)([^a-z0-9]|$)'`);
  }

  return clauses.length ? clauses.join("\n      AND ") : "TRUE";
};
