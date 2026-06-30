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
const normalizeComparableWhitespace = (value = "") => text(value).replace(/\s+/g, " ").trim();
const normalizeComparableText = (value = "") => normalizeComparableWhitespace(value).toLowerCase();
const normalizeComparableUrl = (value = "") => {
  const normalized = text(value);
  if (!normalized) return "";
  return normalized.replace(/[?#].*$/, "").trim().toLowerCase();
};
const PRODUCT_NAME_TEXT_MATCH_STOP_WORDS = new Set([
  "shoes",
  "shoe",
  "new",
  "arrival",
  "fashion",
  "colors",
  "color",
  "price",
  "sale",
  "size",
  "sizes",
  "collection",
  "style",
  "edition",
  "original",
  "authentic",
  "sneaker",
  "sneakers",
  "boots",
  "boot",
  "men",
  "mens",
  "women",
  "womens",
  "kids",
  "unisex",
  "مقاسات",
  "السعر",
  "سعر",
  "جديد",
  "جديدة",
  "ألوان",
  "الوان",
  "لون",
  "احذية",
  "حذاء",
  "حذية",
]);
const tokenizeComparableTerms = (value = "") =>
  Array.from(
    new Set(
      normalizeComparableText(value)
        .split(/[^a-z0-9\u0600-\u06ff]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !PRODUCT_NAME_TEXT_MATCH_STOP_WORDS.has(token))
    )
  );
const buildSiblingLookupTextCorpus = ({ row = {}, post = {}, message = "", caption = "" } = {}) => {
  const safeRow = objectValue(row);
  const safePost = objectValue(post);
  const rowMetadata = objectValue(safeRow.metadata);
  const postMetadata = objectValue(safePost.metadata);
  const rowRawPayload = objectValue(safeRow.raw_payload || rowMetadata.raw_payload);
  const postRawPayload = objectValue(safePost.raw_payload || postMetadata.raw_payload);
  const rowRawValue = objectValue(rowRawPayload.value || {});
  const postRawValue = objectValue(postRawPayload.value || {});
  return normalizeComparableText([
    message,
    caption,
    safeRow.post_text,
    safeRow.post_message,
    safeRow.post_caption,
    safeRow.message,
    safeRow.caption,
    safeRow.original_comment_text,
    safeRow.comment_text,
    safePost.post_text,
    safePost.post_message,
    safePost.post_caption,
    safePost.message,
    safePost.caption,
    rowMetadata.post_text,
    rowMetadata.post_message,
    rowMetadata.post_caption,
    rowMetadata.message,
    rowMetadata.caption,
    postMetadata.post_text,
    postMetadata.post_message,
    postMetadata.post_caption,
    postMetadata.message,
    postMetadata.caption,
    rowRawPayload.post_message,
    rowRawPayload.post_caption,
    rowRawValue.post_message,
    rowRawValue.post_caption,
    postRawPayload.post_message,
    postRawPayload.post_caption,
    postRawValue.post_message,
    postRawValue.post_caption,
  ].map(text).filter(Boolean).join(" "));
};
const pushUniqueText = (target = [], seen = new Set(), value = "", normalizer = text) => {
  const normalized = normalizer(value);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
};
const extractProductSlugHints = (...values) => {
  const slugs = [];
  const seen = new Set();
  for (const value of values) {
    const raw = text(value);
    if (!raw) continue;
    const productMatch = raw.match(/\/shop\/product\/([^/?#\s]+)/i);
    if (productMatch?.[1]) pushUniqueText(slugs, seen, decodeURIComponent(productMatch[1]), lower);
    const slugMatch = raw.match(/\bslug[:=\s]+([a-z0-9][a-z0-9_-]{1,})\b/i);
    if (slugMatch?.[1]) pushUniqueText(slugs, seen, slugMatch[1], lower);
  }
  return slugs;
};

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

const collectSiblingLookupSignals = ({ postId = "", row = {}, post = {}, permalinkUrl = "", message = "", caption = "", imageUrl = "", marketingPostId = "" } = {}) => {
  const safeRow = objectValue(row);
  const safePost = objectValue(post);
  const rowMetadata = objectValue(safeRow.metadata);
  const postMetadata = objectValue(safePost.metadata);
  const rowRawPayload = objectValue(safeRow.raw_payload || rowMetadata.raw_payload);
  const postRawPayload = objectValue(safePost.raw_payload || postMetadata.raw_payload);
  const rowRawValue = objectValue(rowRawPayload.value || {});
  const postRawValue = objectValue(postRawPayload.value || {});
  const textHashes = [];
  const textHashSeen = new Set();
  const imageUrls = [];
  const imageSeen = new Set();
  const sourceIds = [];
  const sourceSeen = new Set();
  const slugHints = [];
  const slugSeen = new Set();
  const pushTextHash = (value) => pushUniqueText(textHashes, textHashSeen, value, normalizeComparableText);
  const pushImage = (value) => pushUniqueText(imageUrls, imageSeen, value, normalizeComparableUrl);
  const pushSource = (value) => pushUniqueText(sourceIds, sourceSeen, value, text);
  const pushSlug = (value) => pushUniqueText(slugHints, slugSeen, value, lower);

  [
    message,
    caption,
    safeRow.post_text,
    safeRow.post_message,
    safeRow.post_caption,
    safeRow.message,
    safeRow.caption,
    safePost.post_text,
    safePost.post_message,
    safePost.post_caption,
    safePost.message,
    safePost.caption,
    rowMetadata.post_text,
    rowMetadata.post_message,
    rowMetadata.post_caption,
    rowMetadata.message,
    rowMetadata.caption,
    postMetadata.post_text,
    postMetadata.post_message,
    postMetadata.post_caption,
    postMetadata.message,
    postMetadata.caption,
    rowRawPayload.post_message,
    rowRawPayload.post_caption,
    rowRawValue.post_message,
    rowRawValue.post_caption,
    postRawPayload.post_message,
    postRawPayload.post_caption,
    postRawValue.post_message,
    postRawValue.post_caption,
  ].forEach(pushTextHash);

  [
    imageUrl,
    safeRow.post_image_url,
    safeRow.media_url,
    safeRow.image_url,
    safeRow.post_full_picture,
    safeRow.full_picture,
    safeRow.attachment_image,
    safeRow.thumbnail_url,
    safePost.post_image_url,
    safePost.media_url,
    safePost.image_url,
    safePost.post_full_picture,
    safePost.full_picture,
    safePost.attachment_image,
    safePost.thumbnail_url,
    rowMetadata.post_image_url,
    rowMetadata.media_url,
    rowMetadata.image_url,
    rowMetadata.post_full_picture,
    rowMetadata.full_picture,
    rowMetadata.attachment_image,
    rowMetadata.thumbnail_url,
    postMetadata.post_image_url,
    postMetadata.media_url,
    postMetadata.image_url,
    postMetadata.post_full_picture,
    postMetadata.full_picture,
    postMetadata.attachment_image,
    postMetadata.thumbnail_url,
    rowRawPayload.post_image_url,
    rowRawPayload.media_url,
    rowRawPayload.image_url,
    rowRawValue.post_image_url,
    rowRawValue.media_url,
    rowRawValue.image_url,
    postRawPayload.post_image_url,
    postRawPayload.media_url,
    postRawPayload.image_url,
    postRawValue.post_image_url,
    postRawValue.media_url,
    postRawValue.image_url,
  ].forEach(pushImage);

  [
    marketingPostId,
    postId,
    safeRow.post_id,
    safeRow.canonical_post_id,
    safeRow.platform_post_id,
    safeRow.source_post_id,
    safeRow.raw_graph_post_id,
    safePost.post_id,
    safePost.canonical_post_id,
    safePost.platform_post_id,
    safePost.source_post_id,
    safePost.raw_graph_post_id,
    rowMetadata.source_post_id,
    rowMetadata.marketing_post_id,
    postMetadata.source_post_id,
    postMetadata.marketing_post_id,
    rowRawPayload.source_post_id,
    rowRawPayload.feed_post_id,
    rowRawPayload.graph_post_id,
    rowRawPayload.resolved_parent_post_id,
    rowRawValue.source_post_id,
    rowRawValue.feed_post_id,
    rowRawValue.graph_post_id,
    rowRawValue.resolved_parent_post_id,
    postRawPayload.source_post_id,
    postRawPayload.feed_post_id,
    postRawPayload.graph_post_id,
    postRawPayload.resolved_parent_post_id,
    postRawValue.source_post_id,
    postRawValue.feed_post_id,
    postRawValue.graph_post_id,
    postRawValue.resolved_parent_post_id,
  ].forEach(pushSource);

  [
    permalinkUrl,
    safeRow.product_url,
    safeRow.storefront_url,
    safeRow.product_link,
    safePost.product_url,
    safePost.storefront_url,
    safePost.product_link,
    rowMetadata.product_url,
    rowMetadata.storefront_url,
    rowMetadata.product_link,
    postMetadata.product_url,
    postMetadata.storefront_url,
    postMetadata.product_link,
    rowRawPayload.product_url,
    rowRawPayload.storefront_url,
    rowRawValue.product_url,
    rowRawValue.storefront_url,
    postRawPayload.product_url,
    postRawPayload.storefront_url,
    postRawValue.product_url,
    postRawValue.storefront_url,
    message,
    caption,
    safeRow.post_message,
    safeRow.post_caption,
  ].flatMap((value) => extractProductSlugHints(value)).forEach(pushSlug);

  return {
    text_hashes: textHashes,
    image_urls: imageUrls,
    source_ids: sourceIds,
    slug_hints: slugHints,
  };
};

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
  const resolvedPostId = getPlatformPostId({ tenantId, platform, post, postId });
  const resolvedCanonicalPostId = text(canonicalPostId || postId || post?.canonical_post_id || resolvedPostId || "");
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
      post_id: resolvedPostId,
      count: 0,
      matched_mapping_key: "",
    });
    console.info("UI_LINKED_PRODUCT_READBACK_SOURCE", {
      post_id: resolvedPostId,
      canonical_post_id: resolvedCanonicalPostId,
      product_ids: Array.isArray(productIds)
        ? Array.from(new Set(productIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)))
        : [],
      source_table: "marketing_post_product_links",
      matched_key: "",
    });
    return {
      linked_products: [],
      primary_product: null,
      count: 0,
      product_ids: Array.isArray(productIds)
        ? Array.from(new Set(productIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)))
        : [],
      rows_affected: Number(rowsAffected || 0),
      post_id: resolvedPostId,
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
    post_id: resolvedPostId,
    count: linkedProducts.length,
    primary_product_id: primaryProduct?.product_id || primaryProduct?.id || null,
    matched_mapping_key: matchedMappingKey,
  });
  console.info("UI_LINKED_PRODUCT_READBACK_SOURCE", {
    post_id: resolvedPostId,
    canonical_post_id: resolvedCanonicalPostId,
    product_ids: linkedProducts.map((item) => item.product_id || item.id || null).filter(Boolean),
    source_table: "marketing_post_product_links",
    matched_key: matchedMappingKey,
  });
  return {
    linked_products: linkedProducts,
    primary_product: primaryProduct,
    count: linkedProducts.length,
    product_ids: linkedProducts.map((item) => item.product_id || item.id || null).filter(Boolean),
    rows_affected: Number(rowsAffected || 0),
    post_id: resolvedPostId,
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

export const resolveProductMappingForSiblingPost = async ({
  tenantId = null,
  platform = "",
  postId = "",
  permalinkUrl = "",
  message = "",
  caption = "",
  imageUrl = "",
  marketingPostId = "",
  row = {},
  post = {},
} = {}) => {
  await ensurePostProductMappingSchema();
  const safeTenantId = toTenantId(tenantId || row?.tenant_id || post?.tenant_id || 0);
  const normalizedPlatform = normalizePlatform(platform || row?.platform || post?.platform || "");
  const canonicalIdentity = await resolveSocialPostCanonicalIdentity({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: postId || row?.post_id || post?.post_id || "",
    row,
    post,
    source: "resolveProductMappingForSiblingPost",
  }).catch(() => null);
  const canonicalPostId = text(
    canonicalIdentity?.canonical_post_id ||
    postId ||
    row?.canonical_post_id ||
    row?.platform_post_id ||
    row?.post_id ||
    post?.canonical_post_id ||
    post?.platform_post_id ||
    post?.post_id ||
    ""
  );
  const uiAliasValues = Array.from(
    new Set(
      [
        canonicalPostId,
        ...(Array.isArray(canonicalIdentity?.aliases) ? canonicalIdentity.aliases.map((alias) => text(alias?.alias_value || "")) : []),
      ].map((value) => text(value)).filter(Boolean)
    )
  );
  const currentPostIds = collectPostIdentityCandidates({ postId, row, post }).map((candidate) => candidate.value).filter(Boolean);
  const signals = collectSiblingLookupSignals({
    postId,
    row,
    post,
    permalinkUrl,
    message,
    caption,
    imageUrl,
    marketingPostId,
  });
  console.info("POST_PRODUCT_LINKS_SIBLING_LOOKUP_START", {
    tenant_id: safeTenantId || null,
    platform: normalizedPlatform,
    post_id: text(postId || row?.post_id || post?.post_id || ""),
    current_post_ids: currentPostIds,
    text_hash_count: signals.text_hashes.length,
    image_url_count: signals.image_urls.length,
    source_id_count: signals.source_ids.length,
    slug_hint_count: signals.slug_hints.length,
  });
  console.info("POST_PRODUCT_LINKS_SIBLING_QUERY_INPUT", {
    tenant_id: safeTenantId || null,
    platform: normalizedPlatform,
    canonical_post_id: canonicalPostId,
    current_post_ids: currentPostIds,
    source_ids: signals.source_ids,
    image_urls: signals.image_urls,
    text_hashes: signals.text_hashes,
    slug_hints: signals.slug_hints,
  });
  if (!safeTenantId || !normalizedPlatform || (!signals.text_hashes.length && !signals.image_urls.length && !signals.source_ids.length && !signals.slug_hints.length)) {
    console.info("POST_PRODUCT_LINKS_SIBLING_NOT_FOUND", {
      tenant_id: safeTenantId || null,
      platform: normalizedPlatform,
      post_id: text(postId || row?.post_id || post?.post_id || ""),
      reason: !safeTenantId ? "invalid_tenant" : "no_lookup_signals",
    });
    return null;
  }

  const params = [safeTenantId, normalizedPlatform, currentPostIds];
  const sourceIndex = params.push(signals.source_ids);
  const imageIndex = params.push(signals.image_urls);
  const textIndex = params.push(signals.text_hashes);
  const slugIndex = params.push(signals.slug_hints);
  const uiAliasIndex = params.push(uiAliasValues);
  const uiMappingSourceRows = await db.query(
    `
    SELECT
      spa.canonical_post_id,
      spa.alias_value,
      ppl.product_id,
      COALESCE(NULLIF(p.name, ''), '') AS product_name,
      'ui_product_mapping_source'::text AS mapping_source
    FROM social_post_identity_aliases spa
    LEFT JOIN marketing_post_product_links ppl
      ON (
          ppl.tenant_id = $1::bigint
          OR ppl.business_id = $1::bigint
        )
     AND ppl.platform = $2::text
     AND ppl.platform_post_id = spa.canonical_post_id
    LEFT JOIN products p
      ON p.id = ppl.product_id
    WHERE spa.tenant_id = $1::bigint
      AND spa.platform = $2::text
      AND spa.alias_value = ANY($3::text[])
    ORDER BY spa.updated_at DESC, spa.created_at DESC, spa.id DESC
    LIMIT 10
    `,
    [safeTenantId, normalizedPlatform, uiAliasValues]
  ).catch(() => ({ rows: [] }));
  const uiMappingRowsPreview = (uiMappingSourceRows.rows || []).map((uiRow) => ({
    canonical_post_id: text(uiRow.canonical_post_id || ""),
    alias_value: text(uiRow.alias_value || ""),
    product_id: Number(uiRow.product_id || 0) || null,
    product_name: text(uiRow.product_name || ""),
    mapping_source: "ui_product_mapping_source",
  }));
  const uiMappingReason = !uiAliasValues.length
    ? "no_alias_rows"
    : !(uiMappingSourceRows.rows || []).length
      ? "no_product_links_for_alias"
      : !(uiMappingSourceRows.rows || []).some((entry) => Number(entry.product_id || 0) > 0)
        ? "no_product_join"
        : "";
  console.info("POST_PRODUCT_LINKS_UI_MAPPING_SOURCE_ROWS", {
    tenant_id: safeTenantId || null,
    platform: normalizedPlatform,
    post_id: text(postId || row?.post_id || post?.post_id || ""),
    canonical_post_id: canonicalPostId,
    row_count: Number(uiMappingSourceRows.rows?.length || 0) || 0,
    reason: uiMappingReason,
    rows: uiMappingRowsPreview,
  });
  const siblingStageParams = [safeTenantId, normalizedPlatform, currentPostIds, uiAliasValues];
  console.info("POST_PRODUCT_LINKS_SIBLING_SQL_PARAM_COUNT", {
    placeholder_count: 4,
    params_count: siblingStageParams.length,
  });
  const siblingQueryStageCounts = await db.query(
    `
    WITH base_rows AS (
      SELECT
        ppl.id,
        ppl.tenant_id,
        ppl.business_id,
        ppl.platform,
        ppl.platform_post_id,
        ppl.post_id,
        ppl.media_id,
        ppl.product_id,
        'marketing_post_product_links'::text AS mapping_source
      FROM marketing_post_product_links ppl
      WHERE (
          ppl.tenant_id = $1::bigint
          OR ppl.business_id = $1::bigint
        )
        AND ppl.platform = $2::text
        AND COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) <> ALL($3::text[])
      UNION
      SELECT
        ppl.id,
        ppl.tenant_id,
        ppl.business_id,
        ppl.platform,
        ppl.platform_post_id,
        ppl.post_id,
        ppl.media_id,
        ppl.product_id,
        'ui_product_mapping_source'::text AS mapping_source
      FROM marketing_post_product_links ppl
      INNER JOIN social_post_identity_aliases spa
        ON spa.tenant_id = $1::bigint
       AND spa.platform = $2::text
       AND spa.canonical_post_id = ppl.platform_post_id
      WHERE (
          ppl.tenant_id = $1::bigint
          OR ppl.business_id = $1::bigint
        )
        AND ppl.platform = $2::text
        AND spa.alias_value = ANY($8::text[])
        AND COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) <> ALL($3::text[])
    ),
    alias_join_rows AS (
      SELECT
        br.*,
        mp.id AS marketing_post_row_id
      FROM base_rows br
      LEFT JOIN marketing_posts mp
        ON mp.tenant_id = br.tenant_id
       AND (
         mp.platform_post_id = br.platform_post_id
         OR mp.external_post_id = br.platform_post_id
         OR mp.platform_post_id = br.post_id
         OR mp.external_post_id = br.post_id
         OR mp.platform_post_id = br.media_id
         OR mp.external_post_id = br.media_id
       )
    ),
    product_join_rows AS (
      SELECT
        ajr.*,
        p.id AS product_row_id
      FROM alias_join_rows ajr
      LEFT JOIN products p
        ON p.id = ajr.product_id
    )
    SELECT
      (SELECT COUNT(*)::bigint FROM base_rows) AS after_base_query_rows,
      (SELECT COUNT(*)::bigint FROM alias_join_rows WHERE marketing_post_row_id IS NOT NULL) AS after_alias_join_rows,
      (SELECT COUNT(*)::bigint FROM product_join_rows WHERE product_row_id IS NOT NULL) AS after_product_join_rows
    `,
    siblingStageParams
  ).catch(() => ({ rows: [] }));
  const siblingStageCounts = siblingQueryStageCounts.rows?.[0] || {};
  console.info("AFTER_BASE_QUERY_ROWS", {
    tenant_id: safeTenantId || null,
    platform: normalizedPlatform,
    post_id: text(postId || row?.post_id || post?.post_id || ""),
    count: Number(siblingStageCounts.after_base_query_rows || 0) || 0,
  });
  console.info("AFTER_ALIAS_JOIN_ROWS", {
    tenant_id: safeTenantId || null,
    platform: normalizedPlatform,
    post_id: text(postId || row?.post_id || post?.post_id || ""),
    count: Number(siblingStageCounts.after_alias_join_rows || 0) || 0,
  });
  console.info("AFTER_PRODUCT_JOIN_ROWS", {
    tenant_id: safeTenantId || null,
    platform: normalizedPlatform,
    post_id: text(postId || row?.post_id || post?.post_id || ""),
    count: Number(siblingStageCounts.after_product_join_rows || 0) || 0,
  });
  const siblingJoinRows = await db.query(
    `
    WITH base_rows AS (
      SELECT
        ppl.id,
        ppl.tenant_id,
        ppl.business_id,
        ppl.platform,
        ppl.platform_post_id,
        ppl.post_id,
        ppl.media_id,
        ppl.product_id,
        ppl.is_primary,
        ppl.updated_at,
        'marketing_post_product_links'::text AS mapping_source
      FROM marketing_post_product_links ppl
      WHERE (
          ppl.tenant_id = $1::bigint
          OR ppl.business_id = $1::bigint
        )
        AND ppl.platform = $2::text
        AND COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) <> ALL($3::text[])
      UNION
      SELECT
        ppl.id,
        ppl.tenant_id,
        ppl.business_id,
        ppl.platform,
        ppl.platform_post_id,
        ppl.post_id,
        ppl.media_id,
        ppl.product_id,
        ppl.is_primary,
        ppl.updated_at,
        'ui_product_mapping_source'::text AS mapping_source
      FROM marketing_post_product_links ppl
      INNER JOIN social_post_identity_aliases spa
        ON spa.tenant_id = $1::bigint
       AND spa.platform = $2::text
       AND spa.canonical_post_id = ppl.platform_post_id
      WHERE (
          ppl.tenant_id = $1::bigint
          OR ppl.business_id = $1::bigint
        )
        AND ppl.platform = $2::text
        AND spa.alias_value = ANY($8::text[])
        AND COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) <> ALL($3::text[])
    ),
    alias_join_rows AS (
      SELECT
        br.*,
        mp.id AS marketing_post_row_id,
        mp.platform_post_id AS mp_platform_post_id,
        mp.external_post_id AS mp_external_post_id,
        mp.image_url AS mp_image_url,
        mp.caption AS mp_caption
      FROM base_rows br
      LEFT JOIN marketing_posts mp
        ON mp.tenant_id = br.tenant_id
       AND (
         mp.platform_post_id = br.platform_post_id
         OR mp.external_post_id = br.platform_post_id
         OR mp.platform_post_id = br.post_id
         OR mp.external_post_id = br.post_id
         OR mp.platform_post_id = br.media_id
         OR mp.external_post_id = br.media_id
       )
    ),
    product_join_rows AS (
      SELECT
        ajr.*,
        p.id AS product_row_id,
        p.name AS product_name,
        COALESCE(NULLIF(p.canonical_slug, ''), NULLIF(p.slug, '')) AS product_slug,
        CASE
          WHEN ajr.marketing_post_row_id IS NULL THEN 'alias_join'
          WHEN ajr.product_id IS NULL THEN 'missing_product_id'
          WHEN p.id IS NULL THEN 'product_join'
          ELSE ''
        END AS join_failure_stage
      FROM alias_join_rows ajr
      LEFT JOIN products p
        ON p.id = ajr.product_id
    )
    SELECT
      id AS linked_row_id,
      id AS marketing_post_product_link_id,
      COALESCE(NULLIF(platform_post_id, ''), NULLIF(post_id, ''), NULLIF(media_id, '')) AS mapped_post_id,
      COALESCE(NULLIF(media_id, ''), NULLIF(mp_external_post_id, ''), NULLIF(mp_platform_post_id, ''), NULLIF(post_id, '')) AS mapped_media_id,
      product_id,
      COALESCE(NULLIF(product_name, ''), '') AS product_name,
      COALESCE(NULLIF(product_slug, ''), '') AS product_slug,
      mapping_source,
      join_failure_stage,
      (
        mp_platform_post_id = ANY($4::text[])
        OR mp_external_post_id = ANY($4::text[])
        OR post_id = ANY($4::text[])
        OR media_id = ANY($4::text[])
      ) AS source_id_match,
      lower(trim(COALESCE(NULLIF(mp_image_url, ''), ''))) = ANY($5::text[]) AS image_url_match,
      lower(regexp_replace(COALESCE(NULLIF(mp_caption, ''), ''), '\\s+', ' ', 'g')) = ANY($6::text[]) AS text_hash_match,
      lower(trim(COALESCE(NULLIF(product_slug, ''), ''))) = ANY($7::text[]) AS slug_match
    FROM product_join_rows
    ORDER BY updated_at DESC, id DESC
    LIMIT 10
    `,
    params
  ).catch(() => ({ rows: [] }));
  const currentTextCorpus = buildSiblingLookupTextCorpus({ row, post, message, caption });
  const siblingJoinRowPreview = (siblingJoinRows.rows || []).map((joinRow) => {
    const productTerms = tokenizeComparableTerms(`${text(joinRow.product_name || "")} ${text(joinRow.product_slug || "").replace(/[-_]+/g, " ")}`);
    const productNameTokenMatchCount = productTerms.filter((term) => currentTextCorpus.includes(term)).length;
    const sourceIdMatch = Boolean(joinRow.source_id_match);
    const imageUrlMatch = Boolean(joinRow.image_url_match);
    const textHashMatch = Boolean(joinRow.text_hash_match);
    const slugMatch = Boolean(joinRow.slug_match);
    let rejectedReason = "";
    if (!sourceIdMatch && !imageUrlMatch && !textHashMatch && !slugMatch) {
      rejectedReason = "no_signal_match";
    } else if (!text(joinRow.mapped_post_id || "")) {
      rejectedReason = "missing_mapped_post_id";
    } else {
      rejectedReason = "passes_signal_stage";
    }
    return {
      mapped_post_id: text(joinRow.mapped_post_id || ""),
      mapped_media_id: text(joinRow.mapped_media_id || ""),
      product_id: Number(joinRow.product_id || 0) || null,
      product_name: text(joinRow.product_name || ""),
      product_slug: text(joinRow.product_slug || ""),
      mapping_source: text(joinRow.mapping_source || "marketing_post_product_links"),
      text_hash_match: textHashMatch,
      image_url_match: imageUrlMatch,
      source_id_match: sourceIdMatch,
      slug_match: slugMatch,
      product_name_token_match_count: productNameTokenMatchCount,
      rejected_reason: rejectedReason,
      ...(Number(joinRow.product_id || 0) > 0
        ? {}
        : {
            linked_row_id: Number(joinRow.linked_row_id || 0) || null,
            marketing_post_product_link_id: Number(joinRow.marketing_post_product_link_id || 0) || null,
            join_failure_stage: text(joinRow.join_failure_stage || ""),
          }),
    };
  });
  console.info("POST_PRODUCT_LINKS_SIBLING_JOIN_ROWS", {
    tenant_id: safeTenantId || null,
    platform: normalizedPlatform,
    post_id: text(postId || row?.post_id || post?.post_id || ""),
    row_count: Number(siblingJoinRows.rows?.length || 0) || 0,
    rows: siblingJoinRowPreview,
  });
  const siblingResult = await db.query(
    `
    WITH sibling_candidates AS (
      SELECT
        COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) AS sibling_post_id,
        COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) AS mapped_post_id,
        COALESCE(NULLIF(ppl.media_id, ''), NULLIF(mp.external_post_id, ''), NULLIF(mp.platform_post_id, ''), NULLIF(ppl.post_id, '')) AS mapped_media_id,
        ppl.product_id,
        COALESCE(NULLIF(p.name, ''), '') AS product_name,
        NULL::text AS permalink_url,
        'marketing_post_product_links'::text AS mapping_source,
        ppl.is_primary,
        ppl.updated_at,
        (
          mp.platform_post_id = ANY($4::text[])
          OR mp.external_post_id = ANY($4::text[])
          OR ppl.post_id = ANY($4::text[])
          OR ppl.media_id = ANY($4::text[])
        ) AS source_id_match,
        lower(trim(COALESCE(NULLIF(mp.image_url, ''), ''))) = ANY($5::text[]) AS image_url_match,
        lower(regexp_replace(COALESCE(NULLIF(mp.caption, ''), ''), '\\s+', ' ', 'g')) = ANY($6::text[]) AS text_hash_match,
        lower(trim(COALESCE(NULLIF(p.canonical_slug, ''), NULLIF(p.slug, '')))) = ANY($7::text[]) AS slug_match,
        CASE
          WHEN (
            mp.platform_post_id = ANY($4::text[])
            OR mp.external_post_id = ANY($4::text[])
            OR ppl.post_id = ANY($4::text[])
            OR ppl.media_id = ANY($4::text[])
          ) THEN 'source_post_id'
          WHEN lower(trim(COALESCE(NULLIF(mp.image_url, ''), ''))) = ANY($5::text[]) THEN 'image_url'
          WHEN lower(regexp_replace(COALESCE(NULLIF(mp.caption, ''), ''), '\\s+', ' ', 'g')) = ANY($6::text[]) THEN 'text_hash'
          WHEN lower(trim(COALESCE(NULLIF(p.canonical_slug, ''), NULLIF(p.slug, '')))) = ANY($7::text[]) THEN 'product_slug'
          ELSE ''
        END AS match_reason,
        CASE
          WHEN (
            mp.platform_post_id = ANY($4::text[])
            OR mp.external_post_id = ANY($4::text[])
            OR ppl.post_id = ANY($4::text[])
            OR ppl.media_id = ANY($4::text[])
          ) THEN 400
          WHEN lower(trim(COALESCE(NULLIF(mp.image_url, ''), ''))) = ANY($5::text[]) THEN 300
          WHEN lower(regexp_replace(COALESCE(NULLIF(mp.caption, ''), ''), '\\s+', ' ', 'g')) = ANY($6::text[]) THEN 200
          WHEN lower(trim(COALESCE(NULLIF(p.canonical_slug, ''), NULLIF(p.slug, '')))) = ANY($7::text[]) THEN 100
          ELSE 0
        END AS match_score
      FROM marketing_post_product_links ppl
      LEFT JOIN marketing_posts mp
        ON mp.tenant_id = ppl.tenant_id
       AND (
         mp.platform_post_id = ppl.platform_post_id
         OR mp.external_post_id = ppl.platform_post_id
         OR mp.platform_post_id = ppl.post_id
         OR mp.external_post_id = ppl.post_id
         OR mp.platform_post_id = ppl.media_id
         OR mp.external_post_id = ppl.media_id
       )
      LEFT JOIN products p
        ON p.id = ppl.product_id
      WHERE (
          ppl.tenant_id = $1::bigint
          OR ppl.business_id = $1::bigint
        )
        AND ppl.platform = $2::text
        AND COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) <> ALL($3::text[])
        AND (
          mp.platform_post_id = ANY($4::text[])
          OR mp.external_post_id = ANY($4::text[])
          OR ppl.post_id = ANY($4::text[])
          OR ppl.media_id = ANY($4::text[])
          OR lower(trim(COALESCE(NULLIF(mp.image_url, ''), ''))) = ANY($5::text[])
          OR lower(regexp_replace(COALESCE(NULLIF(mp.caption, ''), ''), '\\s+', ' ', 'g')) = ANY($6::text[])
          OR lower(trim(COALESCE(NULLIF(p.canonical_slug, ''), NULLIF(p.slug, '')))) = ANY($7::text[])
        )
      UNION
      SELECT
        COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) AS sibling_post_id,
        COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) AS mapped_post_id,
        COALESCE(NULLIF(ppl.media_id, ''), NULLIF(mp.external_post_id, ''), NULLIF(mp.platform_post_id, ''), NULLIF(ppl.post_id, '')) AS mapped_media_id,
        ppl.product_id,
        COALESCE(NULLIF(p.name, ''), '') AS product_name,
        NULL::text AS permalink_url,
        'ui_product_mapping_source'::text AS mapping_source,
        ppl.is_primary,
        ppl.updated_at,
        (
          mp.platform_post_id = ANY($4::text[])
          OR mp.external_post_id = ANY($4::text[])
          OR ppl.post_id = ANY($4::text[])
          OR ppl.media_id = ANY($4::text[])
        ) AS source_id_match,
        lower(trim(COALESCE(NULLIF(mp.image_url, ''), ''))) = ANY($5::text[]) AS image_url_match,
        lower(regexp_replace(COALESCE(NULLIF(mp.caption, ''), ''), '\\s+', ' ', 'g')) = ANY($6::text[]) AS text_hash_match,
        lower(trim(COALESCE(NULLIF(p.canonical_slug, ''), NULLIF(p.slug, '')))) = ANY($7::text[]) AS slug_match,
        CASE
          WHEN (
            mp.platform_post_id = ANY($4::text[])
            OR mp.external_post_id = ANY($4::text[])
            OR ppl.post_id = ANY($4::text[])
            OR ppl.media_id = ANY($4::text[])
          ) THEN 'source_post_id'
          WHEN lower(trim(COALESCE(NULLIF(mp.image_url, ''), ''))) = ANY($5::text[]) THEN 'image_url'
          WHEN lower(regexp_replace(COALESCE(NULLIF(mp.caption, ''), ''), '\\s+', ' ', 'g')) = ANY($6::text[]) THEN 'text_hash'
          WHEN lower(trim(COALESCE(NULLIF(p.canonical_slug, ''), NULLIF(p.slug, '')))) = ANY($7::text[]) THEN 'product_slug'
          ELSE ''
        END AS match_reason,
        CASE
          WHEN (
            mp.platform_post_id = ANY($4::text[])
            OR mp.external_post_id = ANY($4::text[])
            OR ppl.post_id = ANY($4::text[])
            OR ppl.media_id = ANY($4::text[])
          ) THEN 400
          WHEN lower(trim(COALESCE(NULLIF(mp.image_url, ''), ''))) = ANY($5::text[]) THEN 300
          WHEN lower(regexp_replace(COALESCE(NULLIF(mp.caption, ''), ''), '\\s+', ' ', 'g')) = ANY($6::text[]) THEN 200
          WHEN lower(trim(COALESCE(NULLIF(p.canonical_slug, ''), NULLIF(p.slug, '')))) = ANY($7::text[]) THEN 100
          ELSE 0
        END AS match_score
      FROM marketing_post_product_links ppl
      INNER JOIN social_post_identity_aliases spa
        ON spa.tenant_id = $1::bigint
       AND spa.platform = $2::text
       AND spa.canonical_post_id = ppl.platform_post_id
      LEFT JOIN marketing_posts mp
        ON mp.tenant_id = ppl.tenant_id
       AND (
         mp.platform_post_id = ppl.platform_post_id
         OR mp.external_post_id = ppl.platform_post_id
         OR mp.platform_post_id = ppl.post_id
         OR mp.external_post_id = ppl.post_id
         OR mp.platform_post_id = ppl.media_id
         OR mp.external_post_id = ppl.media_id
       )
      LEFT JOIN products p
        ON p.id = ppl.product_id
      WHERE (
          ppl.tenant_id = $1::bigint
          OR ppl.business_id = $1::bigint
        )
        AND ppl.platform = $2::text
        AND spa.alias_value = ANY($4::text[])
        AND COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) <> ALL($3::text[])
    )
    SELECT
      sibling_post_id,
      mapped_post_id,
      mapped_media_id,
      product_id,
      product_name,
      permalink_url,
      mapping_source,
      source_id_match,
      image_url_match,
      text_hash_match,
      slug_match,
      match_reason,
      match_score,
      CASE
        WHEN sibling_post_id = '' THEN 'missing_sibling_post_id'
        WHEN match_score <= 0 THEN 'no_match_signal'
        ELSE ''
      END AS rejected_reason
    FROM sibling_candidates
    ORDER BY match_score DESC, is_primary DESC, updated_at DESC, sibling_post_id ASC
    `,
    params
  ).catch((error) => {
    console.warn("POST_PRODUCT_LINKS_SIBLING_QUERY_ERROR", {
      tenant_id: safeTenantId || null,
      platform: normalizedPlatform,
      post_id: text(postId || row?.post_id || post?.post_id || ""),
      message: error?.message || "",
      code: text(error?.code || ""),
    });
    return { rows: [] };
  });
  const siblingCandidates = Array.isArray(siblingResult.rows) ? siblingResult.rows : [];
  const siblingRow = siblingCandidates.find((candidate) => text(candidate.sibling_post_id || "") && Number(candidate.match_score || 0) > 0) || null;
  if (!siblingRow?.sibling_post_id) {
    const candidatePreview = siblingCandidates.slice(0, 10).map((candidate) => ({
      mapped_post_id: text(candidate.mapped_post_id || ""),
      mapped_media_id: text(candidate.mapped_media_id || ""),
      product_id: Number(candidate.product_id || 0) || null,
      product_name: text(candidate.product_name || ""),
      mapping_source: text(candidate.mapping_source || "marketing_post_product_links"),
      permalink_url: text(candidate.permalink_url || ""),
      text_hash_match: Boolean(candidate.text_hash_match),
      image_url_match: Boolean(candidate.image_url_match),
      source_id_match: Boolean(candidate.source_id_match),
      slug_match: Boolean(candidate.slug_match),
      rejected_reason: text(candidate.rejected_reason || "no_matching_sibling"),
    }));
    console.info("POST_PRODUCT_LINKS_SIBLING_CANDIDATES", {
      tenant_id: safeTenantId || null,
      platform: normalizedPlatform,
      post_id: text(postId || row?.post_id || post?.post_id || ""),
      candidate_count: siblingCandidates.length,
      current_post_ids: currentPostIds,
      text_hash_count: signals.text_hashes.length,
      image_url_count: signals.image_urls.length,
      source_id_count: signals.source_ids.length,
      slug_hint_count: signals.slug_hints.length,
      rejected_reason: siblingCandidates.length ? "no_matching_sibling" : "no_candidates_returned",
      candidates: candidatePreview,
    });
    const fallbackNameMatchResult = await db.query(
      `
      SELECT DISTINCT ON (ppl.product_id)
        COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) AS matched_post_id,
        ppl.product_id,
        COALESCE(NULLIF(p.name, ''), '') AS product_name,
        COALESCE(NULLIF(p.canonical_slug, ''), NULLIF(p.slug, '')) AS product_slug,
        ppl.updated_at
      FROM marketing_post_product_links ppl
      LEFT JOIN products p
        ON p.id = ppl.product_id
      WHERE (
          ppl.tenant_id = $1::bigint
          OR ppl.business_id = $1::bigint
        )
        AND ppl.platform = $2::text
        AND ppl.product_id IS NOT NULL
        AND COALESCE(NULLIF(ppl.platform_post_id, ''), NULLIF(ppl.post_id, ''), NULLIF(ppl.media_id, '')) <> ALL($3::text[])
      ORDER BY ppl.product_id ASC, ppl.is_primary DESC, ppl.updated_at DESC, ppl.id DESC
      `,
      [safeTenantId, normalizedPlatform, currentPostIds]
    ).catch(() => ({ rows: [] }));
    const nameMatchedCandidate = (fallbackNameMatchResult.rows || []).find((candidate) => {
      const productName = text(candidate.product_name || "");
      const terms = tokenizeComparableTerms(`${productName} ${text(candidate.product_slug || "").replace(/[-_]+/g, " ")}`);
      if (terms.length < 2 || !currentTextCorpus) return false;
      const matchedTerms = terms.filter((term) => currentTextCorpus.includes(term));
      return matchedTerms.length >= 2;
    }) || null;
    if (nameMatchedCandidate?.matched_post_id) {
      const fallbackMappings = await getMappings({
        tenantId: safeTenantId,
        platform: normalizedPlatform,
        postId: text(nameMatchedCandidate.matched_post_id || ""),
        row: {
          ...row,
          post_id: text(nameMatchedCandidate.matched_post_id || ""),
          canonical_post_id: text(nameMatchedCandidate.matched_post_id || ""),
          platform_post_id: text(nameMatchedCandidate.matched_post_id || ""),
        },
        post: {
          ...post,
          post_id: text(nameMatchedCandidate.matched_post_id || ""),
          canonical_post_id: text(nameMatchedCandidate.matched_post_id || ""),
          platform_post_id: text(nameMatchedCandidate.matched_post_id || ""),
        },
      }).catch(() => null);
      if (fallbackMappings?.linked_products?.length) {
        console.info("POST_PRODUCT_LINKS_SIBLING_MATCHED", {
          tenant_id: safeTenantId || null,
          platform: normalizedPlatform,
          post_id: text(postId || row?.post_id || post?.post_id || ""),
          reason: "product_name_text_match",
          product_ids: fallbackMappings.product_ids || [],
          matched_product_name: text(nameMatchedCandidate.product_name || ""),
          matched_post_id: text(nameMatchedCandidate.matched_post_id || ""),
        });
        return {
          ...fallbackMappings,
          sibling_post_id: text(nameMatchedCandidate.matched_post_id || ""),
          sibling_match_reason: "product_name_text_match",
          sibling_match_score: 50,
        };
      }
    }
    console.info("POST_PRODUCT_LINKS_SIBLING_NOT_FOUND", {
      tenant_id: safeTenantId || null,
      platform: normalizedPlatform,
      post_id: text(postId || row?.post_id || post?.post_id || ""),
      current_post_ids: currentPostIds,
      reason: "no_matching_sibling",
    });
    return null;
  }
  const siblingMappings = await getMappings({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: text(siblingRow.sibling_post_id || ""),
    row: {
      ...row,
      post_id: text(siblingRow.sibling_post_id || ""),
      canonical_post_id: text(siblingRow.sibling_post_id || ""),
      platform_post_id: text(siblingRow.sibling_post_id || ""),
    },
    post: {
      ...post,
      post_id: text(siblingRow.sibling_post_id || ""),
      canonical_post_id: text(siblingRow.sibling_post_id || ""),
      platform_post_id: text(siblingRow.sibling_post_id || ""),
    },
  }).catch(() => null);
  if (!siblingMappings?.linked_products?.length) {
    console.info("POST_PRODUCT_LINKS_SIBLING_NOT_FOUND", {
      tenant_id: safeTenantId || null,
      platform: normalizedPlatform,
      post_id: text(postId || row?.post_id || post?.post_id || ""),
      sibling_post_id: text(siblingRow.sibling_post_id || ""),
      reason: "sibling_mapping_readback_empty",
    });
    return null;
  }
  console.info("POST_PRODUCT_LINKS_SIBLING_MATCHED", {
    tenant_id: safeTenantId || null,
    platform: normalizedPlatform,
    post_id: text(postId || row?.post_id || post?.post_id || ""),
    sibling_post_id: text(siblingRow.sibling_post_id || ""),
    product_ids: siblingMappings.product_ids || [],
    mapping_source: text(siblingRow.mapping_source || "marketing_post_product_links"),
    match_reason: text(siblingRow.match_reason || ""),
    match_score: Number(siblingRow.match_score || 0) || 0,
  });
  return {
    ...siblingMappings,
    sibling_post_id: text(siblingRow.sibling_post_id || ""),
    sibling_match_reason: text(siblingRow.match_reason || ""),
    sibling_match_score: Number(siblingRow.match_score || 0) || 0,
  };
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
  let rowsAffected = 0;
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
  const lookupPostIds = Array.from(
    new Set(
      [
        platformPostId,
        ...(Array.isArray(canonicalIdentity?.aliases) ? canonicalIdentity.aliases.map((alias) => text(alias?.alias_value || "")) : []),
      ].map((value) => text(value)).filter(Boolean)
    )
  );
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
      [safeTenantId, normalizedPlatform, productIdValue, lookupPostIds]
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
      [safeTenantId, normalizedPlatform, lookupPostIds]
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
  resolveProductMappingForSiblingPost,
};

export const buildPostIdentityTrace = resolvePostIdentityTrace;
export const collectPostIdentityTraceCandidates = collectPostIdentityCandidates;
