import db from "../database/db.js";
import { migrateCanonicalSocialPostRecords, resolveSocialPostCanonicalIdentity } from "./socialPostIdentityService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const toTenantId = (value) => Number(value) || 0;
const isSocialCommentsDebugEnabled = () => String(process.env.DEBUG_SOCIAL_COMMENTS || "").toLowerCase() === "true";
const debugSocialCommentsWarn = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.warn(...args);
};
const objectValue = (value = {}) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const normalizePostIdentityValue = (value = "") => {
  const normalized = text(value);
  if (!normalized) return "";
  return normalized
    .replace(/^(social_comment|facebook_comment|instagram_comment|facebook_post|instagram_post):/i, "")
    .replace(/^(facebook|instagram):/i, "")
    .trim();
};
const pushIdentityCandidate = (candidates = [], seen = new Set(), key = "", value = "") => {
  const raw = text(value);
  if (!raw) return;
  const normalized = normalizePostIdentityValue(raw);
  if (!normalized) return;
  if (!seen.has(normalized)) {
    seen.add(normalized);
    candidates.push({ key, value: normalized });
  }
  if (raw !== normalized && !seen.has(raw)) {
    seen.add(raw);
    candidates.push({ key: `${key}_raw`, value: raw });
  }
};
const resolvePostIdentityTrace = ({
  tenantId = null,
  platform = "",
  selectedPostId = "",
  canonicalPostId = "",
  platformPostId = "",
  row = {},
  post = {},
  matchedMappingKey = "",
  productIds = [],
  rowsAffected = null,
} = {}) => {
  const safeRow = objectValue(row);
  const safePost = objectValue(post);
  const rowMetadata = objectValue(safeRow.metadata);
  const postMetadata = objectValue(safePost.metadata);
  const rowRawPayload = objectValue(safeRow.raw_payload || rowMetadata.raw_payload);
  const postRawPayload = objectValue(safePost.raw_payload || postMetadata.raw_payload);
  const rawPayload = objectValue(rowRawPayload.value || postRawPayload.value);
  return {
    tenant_id: toTenantId(tenantId) || null,
    platform: normalizePlatform(platform || safeRow.platform || safePost.platform || ""),
    selected_post_id: text(selectedPostId || safeRow.selected_post_id || safePost.selected_post_id || ""),
    post_id: text(canonicalPostId || safeRow.post_id || safePost.post_id || ""),
    platform_post_id: text(platformPostId || safeRow.platform_post_id || safePost.platform_post_id || ""),
    canonical_post_id: text(canonicalPostId || safeRow.canonical_post_id || safePost.canonical_post_id || ""),
    conversation_id: text(safeRow.conversation_id || safeRow.external_conversation_id || safePost.conversation_id || safePost.external_conversation_id || rowMetadata.conversation_id || postMetadata.conversation_id || ""),
    parent_id: text(
      safeRow.parent_id ||
      safeRow.parent_comment_id ||
      safePost.parent_id ||
      safePost.parent_comment_id ||
      rowMetadata.parent_id ||
      postMetadata.parent_id ||
      rowRawPayload.parent_id ||
      postRawPayload.parent_id ||
      rawPayload.parent_id ||
      ""
    ),
    raw_webhook_post_id: text(
      rowRawPayload.post_id ||
      rowRawPayload.media_id ||
      rowRawPayload.id ||
      postRawPayload.post_id ||
      postRawPayload.media_id ||
      postRawPayload.id ||
      rawPayload.post_id ||
      rawPayload.media_id ||
      rawPayload.id ||
      rowMetadata.raw_webhook_post_id ||
      postMetadata.raw_webhook_post_id ||
      ""
    ),
    raw_graph_post_id: text(
      rowRawPayload.graph_post_id ||
      postRawPayload.graph_post_id ||
      rawPayload.graph_post_id ||
      rowRawPayload.post?.id ||
      postRawPayload.post?.id ||
      rawPayload.post?.id ||
      safeRow.raw_graph_post_id ||
      safePost.raw_graph_post_id ||
      ""
    ),
    permalink_url: text(
      safeRow.permalink_url ||
      safeRow.post_permalink_url ||
      safePost.permalink_url ||
      safePost.post_permalink_url ||
      rowRawPayload.permalink_url ||
      rowRawPayload.post_permalink_url ||
      postRawPayload.permalink_url ||
      postRawPayload.post_permalink_url ||
      rawPayload.permalink_url ||
      rawPayload.post_permalink_url ||
      ""
    ),
    source_post_id: text(
      safeRow.source_post_id ||
      safePost.source_post_id ||
      rowMetadata.source_post_id ||
      postMetadata.source_post_id ||
      rowRawPayload.source_post_id ||
      postRawPayload.source_post_id ||
      rawPayload.source_post_id ||
      ""
    ),
    wrapper_post_id: text(
      safeRow.wrapper_post_id ||
      safePost.wrapper_post_id ||
      rowMetadata.wrapper_post_id ||
      postMetadata.wrapper_post_id ||
      rowRawPayload.wrapper_post_id ||
      postRawPayload.wrapper_post_id ||
      rawPayload.wrapper_post_id ||
      ""
    ),
    internal_post_id: text(
      safeRow.internal_post_id ||
      safePost.internal_post_id ||
      rowMetadata.internal_post_id ||
      postMetadata.internal_post_id ||
      rowRawPayload.internal_post_id ||
      postRawPayload.internal_post_id ||
      rawPayload.internal_post_id ||
      ""
    ),
    matched_mapping_key: text(matchedMappingKey || ""),
    product_ids: Array.isArray(productIds) ? Array.from(new Set(productIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))) : [],
    rows_affected: rowsAffected === null ? null : Number(rowsAffected) || 0,
  };
};
const collectPostIdentityCandidates = ({ postId = "", selectedPostId = "", row = {}, post = {} } = {}) => {
  const candidates = [];
  const seen = new Set();
  const safeRow = objectValue(row);
  const safePost = objectValue(post);
  const rowMetadata = objectValue(safeRow.metadata);
  const postMetadata = objectValue(safePost.metadata);
  const rowRawPayload = objectValue(safeRow.raw_payload || rowMetadata.raw_payload);
  const postRawPayload = objectValue(safePost.raw_payload || postMetadata.raw_payload);
  const rowRawValue = objectValue(rowRawPayload.value || {});
  const postRawValue = objectValue(postRawPayload.value || {});
  const push = (key, value) => pushIdentityCandidate(candidates, seen, key, value);
  push("selected_post_id", selectedPostId);
  push("post_id", postId);
  push("canonical_post_id", safeRow.canonical_post_id || safePost.canonical_post_id || rowMetadata.canonical_post_id || postMetadata.canonical_post_id || "");
  push("platform_post_id", safeRow.platform_post_id || safePost.platform_post_id || rowMetadata.platform_post_id || postMetadata.platform_post_id || "");
  push("conversation_id", safeRow.conversation_id || safeRow.external_conversation_id || safePost.conversation_id || safePost.external_conversation_id || rowMetadata.conversation_id || postMetadata.conversation_id || "");
  push("conversation_id_stripped", normalizePostIdentityValue(safeRow.conversation_id || safeRow.external_conversation_id || safePost.conversation_id || safePost.external_conversation_id || ""));
  push("parent_id", safeRow.parent_id || safeRow.parent_comment_id || safePost.parent_id || safePost.parent_comment_id || rowMetadata.parent_id || postMetadata.parent_id || rowRawPayload.parent_id || postRawPayload.parent_id || rowRawValue.parent_id || postRawValue.parent_id || "");
  push("parent_post_id", safeRow.parent_post_id || safePost.parent_post_id || rowMetadata.parent_post_id || postMetadata.parent_post_id || rowRawPayload.parent_post_id || postRawPayload.parent_post_id || rowRawValue.parent_post_id || postRawValue.parent_post_id || "");
  push("source_post_id", safeRow.source_post_id || safePost.source_post_id || rowMetadata.source_post_id || postMetadata.source_post_id || rowRawPayload.source_post_id || postRawPayload.source_post_id || rowRawValue.source_post_id || postRawValue.source_post_id || "");
  push("wrapper_post_id", safeRow.wrapper_post_id || safePost.wrapper_post_id || rowMetadata.wrapper_post_id || postMetadata.wrapper_post_id || rowRawPayload.wrapper_post_id || postRawPayload.wrapper_post_id || rowRawValue.wrapper_post_id || postRawValue.wrapper_post_id || "");
  push("internal_post_id", safeRow.internal_post_id || safePost.internal_post_id || rowMetadata.internal_post_id || postMetadata.internal_post_id || rowRawPayload.internal_post_id || postRawPayload.internal_post_id || rowRawValue.internal_post_id || postRawValue.internal_post_id || "");
  push("raw_webhook_post_id", rowRawPayload.post_id || rowRawPayload.media_id || rowRawPayload.id || postRawPayload.post_id || postRawPayload.media_id || postRawPayload.id || rowRawValue.post_id || rowRawValue.media_id || rowRawValue.id || postRawValue.post_id || postRawValue.media_id || postRawValue.id || "");
  push("raw_graph_post_id", rowRawPayload.graph_post_id || postRawPayload.graph_post_id || rowRawValue.graph_post_id || postRawValue.graph_post_id || rowRawPayload.post?.id || postRawPayload.post?.id || rowRawValue.post?.id || postRawValue.post?.id || "");
  push("permalink_url", safeRow.permalink_url || safeRow.post_permalink_url || safePost.permalink_url || safePost.post_permalink_url || rowRawPayload.permalink_url || postRawPayload.permalink_url || rowRawValue.permalink_url || postRawValue.permalink_url || "");
  push("post_permalink_url", safeRow.post_permalink_url || safePost.post_permalink_url || rowRawPayload.post_permalink_url || postRawPayload.post_permalink_url || rowRawValue.post_permalink_url || postRawValue.post_permalink_url || "");
  push("post_url", safeRow.post_url || safePost.post_url || rowRawPayload.post_url || postRawPayload.post_url || rowRawValue.post_url || postRawValue.post_url || "");
  return candidates;
};
const resolveMatchedMappingKey = ({ row = {}, candidates = [] } = {}) => {
  const safeRow = objectValue(row);
  const rowValues = new Set(
    [
      safeRow.platform_post_id,
      safeRow.post_id,
      safeRow.media_id,
      safeRow.canonical_post_id,
      safeRow.source_post_id,
      safeRow.wrapper_post_id,
      safeRow.internal_post_id,
      safeRow.conversation_id,
      safeRow.external_conversation_id,
      safeRow.parent_id,
      safeRow.parent_post_id,
      safeRow.metadata?.post_id,
      safeRow.metadata?.platform_post_id,
      safeRow.metadata?.external_post_id,
      safeRow.metadata?.wrapper_post_id,
      safeRow.metadata?.internal_post_id,
      safeRow.metadata?.conversation_id,
      safeRow.metadata?.parent_id,
    ].map((value) => text(value)).filter(Boolean)
  );
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (candidate?.value && rowValues.has(candidate.value)) {
      return candidate.key || candidate.value;
    }
  }
  return "";
};

const normalizePlatform = (value = "") => (lower(value) === "instagram" ? "instagram" : "facebook");

const isNotEmpty = (value = "") => Boolean(text(value));

const firstText = (...values) => values.map((value) => text(value)).find(Boolean) || "";

const buildProductLinkLogContext = ({
  tenantId = null,
  platform = "",
  selectedPostId = "",
  canonicalPostId = "",
  platformPostId = "",
  productIds = [],
  rowsAffected = null,
} = {}) => ({
  tenant_id: toTenantId(tenantId) || null,
  platform: normalizePlatform(platform || ""),
  selected_post_id: text(selectedPostId || ""),
  canonical_post_id: text(canonicalPostId || ""),
  platform_post_id: text(platformPostId || ""),
  product_ids: Array.isArray(productIds)
    ? Array.from(new Set(productIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)))
    : [],
  rows_affected: rowsAffected === null ? null : Number(rowsAffected) || 0,
});

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

const resolveImageUrl = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return text(value);
  if (typeof value === "object") {
    return text(value.secure_url || value.image_url || value.url || value.path || value.image || "");
  }
  return "";
};

const resolveProductUrl = (product = {}) =>
  firstText(
    product.product_url,
    product.storefront_url,
    product.storefrontUrl,
    product.url,
    product.permalink_url,
    product.permalinkUrl
  );

const resolveVariantStock = (variant = {}) => {
  const candidates = [
    variant.available_quantity,
    variant.available_stock,
    variant.quantity,
    variant.stock,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  const availability = text(variant.in_stock ?? variant.is_in_stock ?? variant.availability ?? variant.stock_status ?? variant.status).toLowerCase();
  if (["true", "available", "in_stock", "in stock", "active"].includes(availability)) return 1;
  return 0;
};

const resolveVariantPrice = (variant = {}) =>
  firstNumber(
    variant.final_price,
    variant.sale_price,
    variant.price,
    variant.selling_price,
    variant.regular_price
  );

const resolveProductPrice = (product = {}) =>
  firstNumber(
    product.final_price,
    product.sale_price,
    product.price,
    product.selling_price,
    product.regular_price
  );

const resolveVariantImageUrl = (variant = {}) =>
  firstText(
    resolveImageUrl(variant.image_url),
    resolveImageUrl(variant.product_image_url),
    resolveImageUrl(variant.cover_image_url),
    resolveImageUrl(variant.primary_media_url),
    resolveImageUrl(variant.thumbnail_url),
    resolveImageUrl(variant.image),
    resolveImageUrl(variant.main_image),
    resolveImageUrl(variant.variant_image_url)
  );

const pickHydratedVariant = (variants = []) => {
  const list = Array.isArray(variants) ? variants.filter((variant) => variant && typeof variant === "object") : [];
  const sorted = [...list].sort((left, right) => {
    const leftStock = resolveVariantStock(left);
    const rightStock = resolveVariantStock(right);
    if (leftStock !== rightStock) return rightStock - leftStock;
    const leftPrice = resolveVariantPrice(left);
    const rightPrice = resolveVariantPrice(right);
    if (leftPrice !== rightPrice) return leftPrice - rightPrice;
    return String(left.id || left.variant_id || "").localeCompare(String(right.id || right.variant_id || ""));
  });
  return sorted[0] || null;
};

const hydrateProduct = (product = {}, variants = []) => {
  const safeProduct = product && typeof product === "object" ? product : {};
  const safeVariants = Array.isArray(variants) ? variants.filter((variant) => variant && typeof variant === "object") : [];
  const primaryVariant = pickHydratedVariant(safeVariants);
  const totalStock = safeVariants.length
    ? safeVariants.reduce((sum, variant) => sum + resolveVariantStock(variant), 0)
    : firstNumber(safeProduct.total_stock, safeProduct.available_stock, safeProduct.stock);
  const productPrice = resolveProductPrice(safeProduct);
  const variantPrice = primaryVariant ? resolveVariantPrice(primaryVariant) : 0;
  const finalPrice = variantPrice || productPrice;
  const salePrice = firstNumber(primaryVariant?.sale_price, safeProduct.sale_price);
  const imageUrl = firstText(
    resolveVariantImageUrl(primaryVariant || {}),
    resolveImageUrl(safeProduct.image_url),
    resolveImageUrl(safeProduct.product_image_url),
    resolveImageUrl(safeProduct.cover_image_url),
    resolveImageUrl(safeProduct.primary_media_url),
    resolveImageUrl(safeProduct.thumbnail_url),
    resolveImageUrl(safeProduct.image),
    resolveImageUrl(safeProduct.main_image)
  );
  const productUrl = resolveProductUrl(safeProduct) || (text(safeProduct.slug || safeProduct.canonical_slug) ? `/shop/product/${encodeURIComponent(text(safeProduct.slug || safeProduct.canonical_slug))}` : "");
  const sku = firstText(primaryVariant?.sku, safeProduct.sku, safeProduct.article_code, safeProduct.sku_code);
  const stockStatus = totalStock > 0 ? "in_stock" : "out_of_stock";
  const brandName = text(safeProduct.brand_name || safeProduct.brand || safeProduct.manufacturer_name || safeProduct.manufacturer || "");
  const normalizedVariants = safeVariants.map((variant) => ({
    ...variant,
    id: variant.id ?? variant.variant_id ?? null,
    product_id: variant.product_id ?? safeProduct.id ?? safeProduct.product_id ?? null,
    image_url: resolveVariantImageUrl(variant),
    price: firstNumber(variant.price, variant.final_price, variant.sale_price, variant.selling_price, variant.regular_price) || null,
    final_price: firstNumber(variant.final_price, variant.sale_price, variant.price, variant.selling_price, variant.regular_price) || null,
    sale_price: firstNumber(variant.sale_price, variant.final_price, variant.price, variant.selling_price, variant.regular_price) || null,
    stock: resolveVariantStock(variant),
    available_stock: resolveVariantStock(variant),
    total_stock: resolveVariantStock(variant),
    stock_status: resolveVariantStock(variant) > 0 ? "in_stock" : "out_of_stock",
  }));
  return {
    ...safeProduct,
    id: safeProduct.id ?? safeProduct.product_id ?? null,
    product_id: safeProduct.product_id ?? safeProduct.id ?? null,
    title: text(safeProduct.title || safeProduct.name || safeProduct.product_name || ""),
    name: text(safeProduct.name || safeProduct.title || safeProduct.product_name || ""),
    image_url: imageUrl,
    price: productPrice || finalPrice || null,
    final_price: finalPrice || null,
    sale_price: salePrice || null,
    brand: brandName,
    brand_name: brandName,
    sku,
    slug: text(safeProduct.slug || safeProduct.canonical_slug || ""),
    total_stock: totalStock,
    available_stock: totalStock,
    stock: totalStock,
    stock_status: stockStatus,
    product_url: productUrl,
    storefront_url: productUrl,
    variants: normalizedVariants,
    product_variants: normalizedVariants,
    selected_variant: primaryVariant ? {
      ...primaryVariant,
      id: primaryVariant.id ?? primaryVariant.variant_id ?? null,
      product_id: primaryVariant.product_id ?? safeProduct.id ?? safeProduct.product_id ?? null,
      image_url: resolveVariantImageUrl(primaryVariant),
      price: firstNumber(primaryVariant.price, primaryVariant.final_price, primaryVariant.sale_price, primaryVariant.selling_price, primaryVariant.regular_price) || null,
      final_price: firstNumber(primaryVariant.final_price, primaryVariant.sale_price, primaryVariant.price, primaryVariant.selling_price, primaryVariant.regular_price) || null,
      sale_price: firstNumber(primaryVariant.sale_price, primaryVariant.final_price, primaryVariant.price, primaryVariant.selling_price, primaryVariant.regular_price) || null,
      stock: resolveVariantStock(primaryVariant),
      available_stock: resolveVariantStock(primaryVariant),
      total_stock: resolveVariantStock(primaryVariant),
      stock_status: resolveVariantStock(primaryVariant) > 0 ? "in_stock" : "out_of_stock",
    } : null,
    matched_variant: primaryVariant ? {
      ...primaryVariant,
      id: primaryVariant.id ?? primaryVariant.variant_id ?? null,
      product_id: primaryVariant.product_id ?? safeProduct.id ?? safeProduct.product_id ?? null,
      image_url: resolveVariantImageUrl(primaryVariant),
      price: firstNumber(primaryVariant.price, primaryVariant.final_price, primaryVariant.sale_price, primaryVariant.selling_price, primaryVariant.regular_price) || null,
      final_price: firstNumber(primaryVariant.final_price, primaryVariant.sale_price, primaryVariant.price, primaryVariant.selling_price, primaryVariant.regular_price) || null,
      sale_price: firstNumber(primaryVariant.sale_price, primaryVariant.final_price, primaryVariant.price, primaryVariant.selling_price, primaryVariant.regular_price) || null,
      stock: resolveVariantStock(primaryVariant),
      available_stock: resolveVariantStock(primaryVariant),
      total_stock: resolveVariantStock(primaryVariant),
      stock_status: resolveVariantStock(primaryVariant) > 0 ? "in_stock" : "out_of_stock",
    } : null,
  };
};

const getPostIdentityCandidates = ({ postId = "", selectedPostId = "", row = {}, post = {} } = {}) =>
  collectPostIdentityCandidates({ postId, selectedPostId, row, post }).map((candidate) => candidate.value);

const getPlatformPostId = ({ postId = "", row = {}, post = {}, platform = "" } = {}) =>
  firstText(
    postId,
    row?.canonical_post_id,
    row?.platform_post_id,
    row?.post_id,
    row?.metadata?.post_id,
    row?.metadata?.platform_post_id,
    post?.canonical_post_id,
    post?.platform_post_id,
    post?.post_id,
    post?.metadata?.post_id,
    post?.metadata?.platform_post_id
  ) || text(postId || row?.post_id || post?.post_id || "");

const normalizeProductRow = (row = {}) => {
  const stock = Number(row.stock ?? row.total_stock ?? row.available_stock ?? 0);
  const primarySlug = text(row.canonical_slug || row.slug || "");
  const productUrl = primarySlug ? `/shop/product/${encodeURIComponent(primarySlug)}` : (text(row.id) ? `/shop/product/${encodeURIComponent(text(row.id))}` : "");
  return {
    id: row.id ?? row.product_id ?? null,
    product_id: row.product_id ?? row.id ?? null,
    name: text(row.name || row.product_name || ""),
    brand_name: text(row.brand_name || row.brand || row.manufacturer_name || row.manufacturer || ""),
    brand: text(row.brand_name || row.brand || row.manufacturer_name || row.manufacturer || ""),
    image_url: text(row.image_url || row.product_image_url || row.primary_image_url || row.cover_image_url || row.thumbnail_url || ""),
    price: Number(row.price ?? row.selling_price ?? row.regular_price ?? 0) || 0,
    sale_price: Number(row.sale_price ?? 0) || 0,
    selling_price: Number(row.selling_price ?? row.price ?? 0) || 0,
    stock,
    stock_status: stock > 0 ? "in_stock" : "out_of_stock",
    sizes: Array.isArray(row.available_sizes)
      ? row.available_sizes.map(text).filter(Boolean)
      : text(row.product_sizes || row.sizes || "").split(",").map(text).filter(Boolean),
    available_sizes: Array.isArray(row.available_sizes)
      ? row.available_sizes.map(text).filter(Boolean)
      : text(row.product_sizes || row.sizes || "").split(",").map(text).filter(Boolean),
    colors: Array.isArray(row.available_colors)
      ? row.available_colors.map(text).filter(Boolean)
      : text(row.product_colors || row.colors || "").split(",").map(text).filter(Boolean),
    available_colors: Array.isArray(row.available_colors)
      ? row.available_colors.map(text).filter(Boolean)
      : text(row.product_colors || row.colors || "").split(",").map(text).filter(Boolean),
    product_url: text(row.product_url || productUrl),
    slug: text(row.slug || ""),
    canonical_slug: primarySlug,
    priority: Number(row.priority ?? 1) || 1,
    is_primary: Boolean(row.is_primary),
    platform: normalizePlatform(row.platform || ""),
    platform_post_id: text(row.platform_post_id || row.post_id || row.media_id || ""),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
};

const ensurePostProductMappingSchema = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS marketing_post_product_links (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      platform TEXT NOT NULL,
      platform_post_id TEXT NOT NULL,
      product_id BIGINT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      is_primary BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, platform, platform_post_id, product_id)
    )
  `);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS platform_post_id TEXT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 1`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS business_id BIGINT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS post_id TEXT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS media_id TEXT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS created_by BIGINT`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_post_product_links_unique_canonical
    ON marketing_post_product_links (tenant_id, platform, platform_post_id, product_id)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_marketing_post_product_links_lookup
    ON marketing_post_product_links (tenant_id, platform, platform_post_id, priority, is_primary, updated_at DESC, id DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_marketing_post_product_links_legacy_lookup
    ON marketing_post_product_links (business_id, platform, post_id, media_id, product_id)
  `);
};

const fetchProductsByIds = async ({ tenantId = null, productIds = [] } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeProductIds = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
  if (!safeTenantId || !safeProductIds.length) return [];
  const query = `
    SELECT p.*, b.name AS brand_name, b.slug AS brand_slug
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.tenant_id = $1::bigint
      AND p.id = ANY($2::bigint[])
    ORDER BY p.id ASC
  `;
  debugSocialCommentsWarn("SOCIAL_COMMENTS_POSTS_SQL_3", {
    tenant_id: safeTenantId,
    sql: query,
    product_ids: safeProductIds,
  });
  const primaryRows = await db.query(query, [safeTenantId, safeProductIds]).catch(() => ({ rows: [] }));
  if (primaryRows.rows?.length) return primaryRows.rows;
  const fallbackRows = await db.query(query.replace("WHERE p.tenant_id = $1::bigint", "WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)"), [null, safeProductIds]).catch(() => ({ rows: [] }));
  return fallbackRows.rows || [];
};

const fetchVariantsByProductIds = async ({ tenantId = null, productIds = [] } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeProductIds = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
  if (!safeTenantId || !safeProductIds.length) return [];
  const query = `
    SELECT *
    FROM product_variants
    WHERE tenant_id = $1::bigint
      AND product_id = ANY($2::bigint[])
    ORDER BY product_id ASC, id ASC
  `;
  debugSocialCommentsWarn("SOCIAL_COMMENTS_POSTS_SQL_3", {
    tenant_id: safeTenantId,
    sql: query,
    product_ids: safeProductIds,
  });
  const primaryRows = await db.query(query, [safeTenantId, safeProductIds]).catch(() => ({ rows: [] }));
  if (primaryRows.rows?.length) return primaryRows.rows;
  const fallbackRows = await db.query(query.replace("WHERE tenant_id = $1::bigint", "WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)"), [null, safeProductIds]).catch(() => ({ rows: [] }));
  return fallbackRows.rows || [];
};

const fetchLinkRows = async ({ tenantId = null, platform = "", post = {}, postId = "", selectedPostId = "", canonicalPostId = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform || post?.platform || "");
  const canonicalIdentityPostId = text(canonicalPostId || post?.canonical_post_id || postId || selectedPostId || post?.post_id || "");
  if (!safeTenantId || !canonicalIdentityPostId) return [];
  debugSocialCommentsWarn("SOCIAL_COMMENTS_POSTS_SQL_2", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: text(postId || post?.post_id || ""),
    canonical_post_id: canonicalIdentityPostId,
    sql: `
    SELECT *
    FROM marketing_post_product_links
    WHERE (
        tenant_id = $1::bigint
        OR business_id = $1::bigint
      )
      AND platform = $2::text
      AND (
        platform_post_id = $3::text
        OR post_id = $3::text
        OR media_id = $3::text
      )
    ORDER BY is_primary DESC, priority ASC, updated_at DESC, id DESC
    `,
  });
  const result = await db.query(
    `
    SELECT *
    FROM marketing_post_product_links
    WHERE (
        tenant_id = $1::bigint
        OR business_id = $1::bigint
      )
      AND platform = $2::text
      AND (
        platform_post_id = $3::text
        OR post_id = $3::text
        OR media_id = $3::text
      )
    ORDER BY is_primary DESC, priority ASC, updated_at DESC, id DESC
    `,
    [safeTenantId, normalizedPlatform, canonicalIdentityPostId]
  ).catch(() => ({ rows: [] }));
  return result.rows || [];
};

const mapRowsToLinkedProducts = async ({ tenantId = null, platform = "", post = {}, postId = "", selectedPostId = "", canonicalPostId = "", platformPostId = "", productIds = [], rowsAffected = null } = {}) => {
  const rows = await fetchLinkRows({ tenantId, platform, post, postId, selectedPostId, canonicalPostId });
  const identityCandidates = collectPostIdentityCandidates({ postId, selectedPostId, row: post, post });
  const matchedMappingKey = rows.length ? resolveMatchedMappingKey({ row: rows[0], candidates: identityCandidates }) : "";
  if (!rows.length) {
    console.info("POST_PRODUCT_LINKS_READBACK", {
      ...resolvePostIdentityTrace({
        tenantId,
        platform,
        selectedPostId: selectedPostId || postId,
        canonicalPostId: canonicalPostId || postId,
        platformPostId: platformPostId || getPlatformPostId({ tenantId, platform, post, postId }),
        row: post,
        post,
        productIds,
        rowsAffected,
        matchedMappingKey: "",
      }),
      post_id: getPlatformPostId({ tenantId, platform, post, postId }),
      count: 0,
      matched_mapping_key: "",
    });
    return {
      linked_products: [],
      primary_product: null,
      count: 0,
      post_id: getPlatformPostId({ tenantId, platform, post, postId }),
      platform: normalizePlatform(platform || post?.platform || ""),
      tenant_id: toTenantId(tenantId) || null,
      matched_mapping_key: "",
    };
  }

  const products = await fetchProductsByIds({
    tenantId,
    productIds: rows.map((row) => row.product_id),
  });
  const variants = await fetchVariantsByProductIds({
    tenantId,
    productIds: rows.map((row) => row.product_id),
  });
  const variantsByProductId = new Map();
  for (const variant of variants) {
    const key = String(variant.product_id || "");
    if (!key) continue;
    const current = variantsByProductId.get(key) || [];
    current.push(variant);
    variantsByProductId.set(key, current);
  }
  const productById = new Map(products.map((product) => [String(product.id), product]));
  const linkedProducts = rows.map((row) => {
    const product = productById.get(String(row.product_id)) || {};
    const hydrated = hydrateProduct(
      {
        ...product,
        id: row.product_id,
        product_id: row.product_id,
        platform: row.platform,
        platform_post_id: row.platform_post_id || row.post_id || row.media_id || "",
        priority: row.priority,
        is_primary: row.is_primary,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      variantsByProductId.get(String(row.product_id)) || []
    );
    console.info("POST_PRODUCT_LINKS_HYDRATED_PRODUCT", {
      tenant_id: toTenantId(tenantId) || null,
      platform: normalizePlatform(row.platform || platform || ""),
      post_id: getPlatformPostId({ tenantId, platform, post, postId }),
      product_id: hydrated.product_id || hydrated.id || null,
      total_stock: hydrated.total_stock,
      stock_status: hydrated.stock_status,
      price: hydrated.price,
      final_price: hydrated.final_price,
    });
    return {
      ...hydrated,
      priority: Number(row.priority ?? 1) || 1,
      is_primary: Boolean(row.is_primary),
      platform: normalizePlatform(row.platform || platform || ""),
      platform_post_id: text(row.platform_post_id || row.post_id || row.media_id || ""),
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    };
  });

  const primaryProduct = linkedProducts.find((item) => item.is_primary) || linkedProducts[0] || null;
  console.info("POST_PRODUCT_LINKS_READBACK", {
    ...resolvePostIdentityTrace({
      tenantId,
      platform,
      selectedPostId: selectedPostId || postId,
      canonicalPostId: canonicalPostId || postId,
      platformPostId: platformPostId || getPlatformPostId({ tenantId, platform, post, postId }),
      row: post,
      post,
      productIds: linkedProducts.map((item) => item.product_id || item.id || null).filter(Boolean),
      rowsAffected,
      matchedMappingKey,
    }),
    post_id: getPlatformPostId({ tenantId, platform, post, postId }),
    count: linkedProducts.length,
    primary_product_id: primaryProduct?.product_id || primaryProduct?.id || null,
    matched_mapping_key: matchedMappingKey,
  });
  return {
    linked_products: linkedProducts,
    primary_product: primaryProduct,
    count: linkedProducts.length,
    post_id: getPlatformPostId({ tenantId, platform, post, postId }),
    platform: normalizePlatform(platform || post?.platform || ""),
    tenant_id: toTenantId(tenantId) || null,
    matched_mapping_key: matchedMappingKey,
  };
};

export const getMappings = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {}, selectedPostId = "", canonicalPostId = "", platformPostId = "", productIds = [], rowsAffected = null } = {}) => {
  await ensurePostProductMappingSchema();
  const safeTenantId = toTenantId(tenantId || row?.tenant_id || post?.tenant_id || 0);
  const normalizedPlatform = normalizePlatform(platform || row?.platform || post?.platform || "");
  const canonicalIdentity = await resolveSocialPostCanonicalIdentity({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: postId || row?.post_id || post?.post_id || "",
    row,
    post,
    source: "getMappings",
  }).catch(() => null);
  const identityPostId = text(
    canonicalIdentity?.canonical_post_id ||
    canonicalPostId ||
    getPlatformPostId({ tenantId: safeTenantId, platform: normalizedPlatform, post: post || row || {}, postId: postId || row?.post_id || "" })
  );
  void migrateCanonicalSocialPostRecords({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    canonicalPostId: identityPostId,
    aliasRows: canonicalIdentity?.aliases?.map((alias) => alias.alias_value) || [],
  }).catch(() => {});
  return mapRowsToLinkedProducts({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    post: row || post || {},
    postId: identityPostId,
    selectedPostId: selectedPostId || postId,
    canonicalPostId: canonicalPostId || identityPostId,
    platformPostId: platformPostId || identityPostId,
    productIds,
    rowsAffected,
  });
};

export const resolveMappedProducts = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {} } = {}) => {
  const mappings = await getMappings({ tenantId, platform, postId, row, post });
  return mappings.linked_products || [];
};

export const resolvePrimaryProduct = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {} } = {}) => {
  const mappings = await getMappings({ tenantId, platform, postId, row, post });
  return mappings.primary_product || null;
};

export const saveMappings = async ({ tenantId = null, platform = "", postId = "", selectedPostId = "", row = {}, post = {}, productIds = [], primaryProductId = null, userId = null } = {}) => {
  await ensurePostProductMappingSchema();
  const safeTenantId = toTenantId(tenantId || row?.tenant_id || post?.tenant_id || 0);
  const normalizedPlatform = normalizePlatform(platform || row?.platform || post?.platform || "");
  const canonicalIdentity = await resolveSocialPostCanonicalIdentity({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: postId || row?.post_id || post?.post_id || "",
    row,
    post,
    source: "saveMappings",
  }).catch(() => null);
  const platformPostId = text(
    canonicalIdentity?.canonical_post_id ||
    getPlatformPostId({ tenantId: safeTenantId, platform: normalizedPlatform, post: post || row || {}, postId: postId || row?.post_id || "" })
  );
  void migrateCanonicalSocialPostRecords({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    canonicalPostId: platformPostId,
    aliasRows: canonicalIdentity?.aliases?.map((alias) => alias.alias_value) || [],
  }).catch(() => {});
  const safeProductIds = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
  const primaryId = Number(primaryProductId ?? safeProductIds[0] ?? 0) || null;
  const selectedIdentity = text(selectedPostId || postId || row?.post_id || post?.post_id || "");
  const identityTrace = resolvePostIdentityTrace({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    selectedPostId: selectedIdentity,
    canonicalPostId: platformPostId,
    platformPostId,
    row,
    post,
    productIds: safeProductIds,
    matchedMappingKey: "",
  });
  console.info("POST_PRODUCT_LINK_IDENTITY_TRACE", {
    ...identityTrace,
    canonical_post_id: platformPostId,
    primary_product_id: primaryId,
  });
  console.info("POST_PRODUCT_LINKS_SAVE_REQUEST", {
    ...identityTrace,
    primary_product_id: primaryId,
    canonical_post_id: platformPostId,
  });
  if (!safeTenantId || !platformPostId) return mapRowsToLinkedProducts({ tenantId: safeTenantId, platform: normalizedPlatform, post, postId: platformPostId, selectedPostId: selectedIdentity, canonicalPostId: platformPostId });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (platformPostId) {
      await client.query(
        `
        DELETE FROM marketing_post_product_links
        WHERE (
            tenant_id = $1::bigint
          OR business_id = $1::bigint
        )
          AND platform = $2::text
          AND (
            platform_post_id = $3::text
            OR post_id = $3::text
            OR media_id = $3::text
          )
        `,
        [safeTenantId, normalizedPlatform, platformPostId]
      );
    }

    let rowsAffected = 0;
    for (let index = 0; index < safeProductIds.length; index += 1) {
      const productId = safeProductIds[index];
      const isPrimary = primaryId ? Number(primaryId) === Number(productId) : index === 0;
      console.info("POST_PRODUCT_LINKS_DB_INSERT", {
        ...identityTrace,
        canonical_post_id: platformPostId,
        primary_product_id: primaryId,
        is_primary: Boolean(isPrimary),
        product_ids: [productId],
        rows_affected: 0,
      });
      const insertResult = await client.query(
        `
        INSERT INTO marketing_post_product_links (
          tenant_id,
          business_id,
          platform,
          platform_post_id,
          post_id,
          media_id,
          product_id,
          priority,
          is_primary,
          created_by,
          updated_at,
          created_at
        )
        VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::text, $6::text, $7::bigint, $8::integer, $9::boolean, $10::bigint, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, platform, platform_post_id, product_id)
        DO UPDATE SET
          business_id = EXCLUDED.business_id,
          post_id = EXCLUDED.post_id,
          media_id = EXCLUDED.media_id,
          priority = EXCLUDED.priority,
          is_primary = EXCLUDED.is_primary,
          created_by = COALESCE(marketing_post_product_links.created_by, EXCLUDED.created_by),
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          safeTenantId,
          safeTenantId,
          normalizedPlatform,
          platformPostId,
          selectedIdentity || identityTrace.raw_webhook_post_id || platformPostId,
          identityTrace.raw_graph_post_id || identityTrace.raw_webhook_post_id || selectedIdentity || platformPostId,
          productId,
          index + 1,
          isPrimary,
          userId ? Number(userId) : null,
        ]
      );
      rowsAffected += Number(insertResult.rowCount || 0) || 0;
      console.info("POST_PRODUCT_LINKS_DB_UPSERT", {
        ...identityTrace,
        canonical_post_id: platformPostId,
        primary_product_id: primaryId,
        is_primary: Boolean(isPrimary),
        product_ids: [productId],
        rows_affected: insertResult.rowCount || 0,
        rows: insertResult.rows || [],
      });
    }

    const dbResult = await client.query(
      `
      SELECT *
      FROM marketing_post_product_links
      WHERE tenant_id = $1::bigint
        AND platform = $2::text
        AND platform_post_id = $3::text
      ORDER BY is_primary DESC, priority ASC, updated_at DESC, id DESC
      `,
      [safeTenantId, normalizedPlatform, platformPostId]
    ).catch(() => ({ rows: [] }));
    console.info("POST_PRODUCT_LINKS_DB_RESULT", {
      ...resolvePostIdentityTrace({
        tenantId: safeTenantId,
        platform: normalizedPlatform,
        selectedPostId: selectedIdentity,
        canonicalPostId: platformPostId,
        platformPostId,
        row,
        post,
        productIds: safeProductIds,
        rowsAffected,
        matchedMappingKey: resolveMatchedMappingKey({ row: dbResult.rows?.[0] || {}, candidates: [] }),
      }),
      count: Number(dbResult.rows?.length || 0) || 0,
      rows: dbResult.rows || [],
    });

    await client.query("COMMIT");
    console.info("POST_PRODUCT_LINKS_SAVED", {
      ...resolvePostIdentityTrace({
        tenantId: safeTenantId,
        platform: normalizedPlatform,
        selectedPostId: selectedIdentity,
        canonicalPostId: platformPostId,
        platformPostId,
        row,
        post,
        productIds: safeProductIds,
        rowsAffected,
        matchedMappingKey: resolveMatchedMappingKey({ row: dbResult.rows?.[0] || {}, candidates: [] }),
      }),
      post_id: platformPostId,
      product_ids: safeProductIds,
      primary_product_id: primaryId,
      count: safeProductIds.length,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return getMappings({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: platformPostId,
    row,
    post,
    selectedPostId: selectedIdentity,
    canonicalPostId: platformPostId,
    platformPostId,
    productIds: safeProductIds,
    rowsAffected,
  });
};

export const removeMapping = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {}, productId = null } = {}) => {
  await ensurePostProductMappingSchema();
  const safeTenantId = toTenantId(tenantId || row?.tenant_id || post?.tenant_id || 0);
  const normalizedPlatform = normalizePlatform(platform || row?.platform || post?.platform || "");
  const canonicalIdentity = await resolveSocialPostCanonicalIdentity({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: postId || row?.post_id || post?.post_id || "",
    row,
    post,
    source: "removeMapping",
  }).catch(() => null);
  const platformPostId = text(
    canonicalIdentity?.canonical_post_id ||
    getPlatformPostId({ tenantId: safeTenantId, platform: normalizedPlatform, post: post || row || {}, postId: postId || row?.post_id || "" })
  );
  void migrateCanonicalSocialPostRecords({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    canonicalPostId: platformPostId,
    aliasRows: canonicalIdentity?.aliases?.map((alias) => alias.alias_value) || [],
  }).catch(() => {});
  if (!safeTenantId || !platformPostId) {
    return mapRowsToLinkedProducts({ tenantId: safeTenantId, platform: normalizedPlatform, post, postId: platformPostId, canonicalPostId: platformPostId });
  }
  const productIdValue = Number(productId || 0);
  if (Number.isFinite(productIdValue) && productIdValue > 0) {
    await db.query(
      `
      DELETE FROM marketing_post_product_links
      WHERE (
          tenant_id = $1::bigint
          OR business_id = $1::bigint
        )
        AND platform = $2::text
        AND product_id = $3::bigint
        AND (
          platform_post_id = ANY($4::text[])
          OR post_id = ANY($4::text[])
          OR media_id = ANY($4::text[])
        )
      `,
      [safeTenantId, normalizedPlatform, productIdValue, platformPostId]
    );
  } else {
    await db.query(
      `
      DELETE FROM marketing_post_product_links
      WHERE (
          tenant_id = $1::bigint
          OR business_id = $1::bigint
        )
        AND platform = $2::text
        AND (
          platform_post_id = ANY($3::text[])
          OR post_id = ANY($3::text[])
          OR media_id = ANY($3::text[])
        )
      `,
      [safeTenantId, normalizedPlatform, platformPostId]
    );
  }
  return mapRowsToLinkedProducts({ tenantId: safeTenantId, platform: normalizedPlatform, post, postId: platformPostId, canonicalPostId: platformPostId });
};

export default {
  ensurePostProductMappingSchema,
  getMappings,
  saveMappings,
  removeMapping,
  resolveMappedProducts,
  resolvePrimaryProduct,
};

export const buildPostIdentityTrace = resolvePostIdentityTrace;
export const collectPostIdentityTraceCandidates = collectPostIdentityCandidates;
