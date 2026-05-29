import db from "../database/db.js";

const text = (value = "") => String(value ?? "").trim();

const slugify = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);

export const storefrontBaseUrl = () =>
  text(
    process.env.STORE_FRONT_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.APP_PUBLIC_URL ||
      process.env.FRONTEND_URL ||
      process.env.VITE_PUBLIC_APP_URL ||
      ""
  ).replace(/\/+$/g, "");

const slugBelongsToProduct = (slug = "", product = {}) => {
  const safeSlug = slugify(slug);
  if (!safeSlug) return false;
  const nameSlug = slugify(product.name || product.title || product.product_name || product.base_name);
  if (!nameSlug) return true;
  const slugTokens = new Set(safeSlug.split("-").filter((token) => token.length >= 3));
  const nameTokens = nameSlug.split("-").filter((token) => token.length >= 3);
  const overlap = nameTokens.filter((token) => slugTokens.has(token)).length;
  const conflictingBrands = ["nike", "adidas", "puma", "reebok", "asics", "balance", "converse", "vans"];
  const nameLower = ` ${nameSlug} `;
  const slugLower = ` ${safeSlug} `;
  const hasConflictingBrand = conflictingBrands.some((brand) => slugLower.includes(` ${brand} `) && !nameLower.includes(` ${brand} `));
  if (hasConflictingBrand) return false;
  return overlap >= Math.min(2, Math.max(1, nameTokens.length));
};

const productIdentifier = (product = {}) => {
  const id = text(product.id || product.product_id);
  const slug = text(product.slug);
  const canonicalSlug = text(product.canonical_slug || product.product_slug);
  if (slug && slugBelongsToProduct(slug, product)) return slug;
  if (canonicalSlug && slugBelongsToProduct(canonicalSlug, product)) return canonicalSlug;
  return id || slugify(product.name || product.title || product.product_name);
};

export const buildStorefrontProductUrl = (product = {}, { baseUrl = storefrontBaseUrl() } = {}) => {
  const identifier = productIdentifier(product);
  if (!identifier) return "";
  const path = `/shop/product/${encodeURIComponent(identifier)}`;
  return baseUrl ? `${baseUrl}${path}` : path;
};

export const buildStorefrontSearchUrl = (product = {}, { baseUrl = storefrontBaseUrl() } = {}) => {
  const name = text(product.name || product.title || product.product_name || product.base_name);
  const query = name ? `?q=${encodeURIComponent(name)}` : "";
  const path = `/shop/products${query}`;
  return baseUrl ? `${baseUrl}${path}` : path;
};

const productVisibilityColumns = ["storefront_visible", "is_storefront_visible", "visible_on_storefront", "show_in_storefront", "is_visible"];
let productColumnsCache = null;

const productColumns = async () => {
  if (productColumnsCache) return productColumnsCache;
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'products'
    `
  );
  productColumnsCache = new Set(result.rows.map((row) => row.column_name));
  return productColumnsCache;
};

const visibleValue = (value) => !["false", "0", "no", "hidden", "inactive"].includes(text(value).toLowerCase());

const productIsVisible = (row = {}, columns = new Set()) =>
  productVisibilityColumns
    .filter((column) => columns.has(column))
    .every((column) => visibleValue(row[column]));

const productIsActive = (row = {}) =>
  row.is_active !== false &&
  !["inactive", "disabled", "archived", "deleted", "draft"].includes(text(row.status || "active").toLowerCase());

const namesLikelySameProduct = (left = "", right = "") => {
  const leftTokens = slugify(left).split("-").filter((token) => token.length >= 3);
  const rightTokens = new Set(slugify(right).split("-").filter((token) => token.length >= 3));
  if (!leftTokens.length || !rightTokens.size) return true;
  const overlap = leftTokens.filter((token) => rightTokens.has(token)).length;
  return overlap >= Math.min(2, Math.max(1, Math.min(leftTokens.length, rightTokens.size)));
};

const lookupProductForLink = async ({ tenantId = null, product = {}, identifier = "" } = {}) => {
  const id = text(product.product_id || product.id);
  const slug = text(identifier || product.slug || product.product_slug || product.canonical_slug);
  const candidates = [...new Set([id, slug, product.canonical_slug, product.product_slug].map(text).filter(Boolean))];
  if (!candidates.length) return null;
  const columns = await productColumns();
  const visibilitySelect = productVisibilityColumns
    .filter((column) => columns.has(column))
    .map((column) => `p.${column}`)
    .join(", ");
  const selectVisibility = visibilitySelect ? `, ${visibilitySelect}` : "";
  const query = `
    SELECT p.id, p.name, p.slug, p.canonical_slug, p.is_active, p.status${selectVisibility}
    FROM products p
    WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
      AND (
        EXISTS (SELECT 1 FROM unnest($2::text[]) AS lookup(value) WHERE TRIM(lookup.value) ~ '^[0-9]+$' AND TRIM(lookup.value)::bigint = p.id)
        OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS lookup(value) WHERE LOWER(TRIM(COALESCE(p.slug, ''))) = LOWER(TRIM(lookup.value)))
        OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS lookup(value) WHERE LOWER(TRIM(COALESCE(p.canonical_slug, ''))) = LOWER(TRIM(lookup.value)))
      )
    ORDER BY
      CASE
        WHEN $3::text <> '' AND p.id::text = $3::text THEN 0
        WHEN EXISTS (SELECT 1 FROM unnest($2::text[]) AS lookup(value) WHERE LOWER(TRIM(COALESCE(p.slug, ''))) = LOWER(TRIM(lookup.value))) THEN 1
        WHEN EXISTS (SELECT 1 FROM unnest($2::text[]) AS lookup(value) WHERE LOWER(TRIM(COALESCE(p.canonical_slug, ''))) = LOWER(TRIM(lookup.value))) THEN 2
        ELSE 3
      END,
      p.id ASC
    LIMIT 1
  `;
  let result = await db.query(query, [tenantId, candidates, id]);
  if (!result.rows[0] && tenantId !== null) {
    result = await db.query(query, [null, candidates, id]);
  }
  const row = result.rows[0] || null;
  if (!row) return null;
  return { row, columns };
};

export const resolveStorefrontProductLink = async ({ tenantId = null, product = {}, baseUrl = storefrontBaseUrl() } = {}) => {
  const rawSlug = text(product.slug || product.product_slug || product.canonical_slug);
  const productId = text(product.product_id || product.id);
  const fallbackUrl = buildStorefrontSearchUrl(product, { baseUrl });
  let resolveSuccess = false;
  let fallbackUsed;
  let generatedUrl;
  let selectedIdentifier = "";
  let reason;

  try {
    const match = await lookupProductForLink({ tenantId, product });
    const row = match?.row || null;
    if (!row) {
      reason = "product_not_found";
      fallbackUsed = true;
      generatedUrl = fallbackUrl;
    } else if (!productId && text(product.name || product.title || product.product_name) && !namesLikelySameProduct(product.name || product.title || product.product_name, row.name)) {
      reason = "card_name_mismatch";
      fallbackUsed = true;
      generatedUrl = fallbackUrl;
    } else if (!productIsActive(row)) {
      reason = "product_inactive";
      fallbackUsed = true;
      generatedUrl = fallbackUrl;
    } else if (!productIsVisible(row, match.columns)) {
      reason = "product_not_storefront_visible";
      fallbackUsed = true;
      generatedUrl = fallbackUrl;
    } else {
      const rowProduct = { ...product, id: row.id, product_id: row.id, name: row.name || product.name, slug: row.slug, canonical_slug: row.canonical_slug };
      selectedIdentifier = productIdentifier(rowProduct);
      generatedUrl = buildStorefrontProductUrl({ ...rowProduct, slug: selectedIdentifier }, { baseUrl });
      resolveSuccess = Boolean(selectedIdentifier);
      fallbackUsed = !resolveSuccess;
      if (!resolveSuccess) {
        reason = "missing_identifier";
        generatedUrl = fallbackUrl;
      } else if (rawSlug && rawSlug !== selectedIdentifier && productId) {
        reason = "stale_slug_repaired";
      } else {
        reason = "resolved";
      }
    }
  } catch (error) {
    reason = error?.message || "resolve_error";
    fallbackUsed = true;
    generatedUrl = fallbackUrl;
  }

  console.log("ai_product_link_resolve", {
    product_id: productId || null,
    slug: rawSlug,
    generated_url: generatedUrl,
    resolve_success: resolveSuccess,
    fallback_used: fallbackUsed,
    reason,
  });

  return {
    product_url: generatedUrl,
    url: generatedUrl,
    resolve_success: resolveSuccess,
    fallback_used: fallbackUsed,
    fallback_reason: reason,
    resolved_identifier: selectedIdentifier,
  };
};

export const resolveProductCardLinks = async (cards = [], { tenantId = null, baseUrl = storefrontBaseUrl() } = {}) => {
  const resolved = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const link = await resolveStorefrontProductLink({ tenantId, product: card, baseUrl });
    resolved.push({ ...card, ...link });
  }
  return resolved;
};
