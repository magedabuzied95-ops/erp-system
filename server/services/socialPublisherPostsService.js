import db from "../database/db.js";
import { loadProductsWithVariantsPayload } from "../controllers/productsController.js";
import { resolveStorefrontPriceBreakdown } from "../../src/shared/lib/storefrontPricing.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { getMetaIntegrationStatus } from "./metaIntegrationService.js";
import { validateMetaToken } from "./metaTokenService.js";
import { publishPost as publishMetaPost } from "./socialPublisherService.js";

const trimString = (value) => String(value || "").trim();
const TIKTOK_PUBLISHING_NOT_CONNECTED_MESSAGE = "TikTok publishing is not connected yet.";
const DISABLED_SOCIAL_PUBLISHER_PLATFORMS = new Set(["tiktok"]);
const SOCIAL_PUBLISHER_SCHEDULER_LOCK_KEY = 74017102;
const META_GRAPH_API_VERSION = "v19.0";
const META_GRAPH_API_BASE_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

const parseJsonArray = (value, fallback = []) => {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const normalizePlatforms = (value) => {
  const items = parseJsonArray(value, []);
  const normalized = items
    .map((item) => trimString(item).toLowerCase())
    .filter((item) => ["facebook", "instagram", "tiktok"].includes(item));
  return Array.from(new Set(normalized));
};

const assertSocialPublisherPlatformsAreEnabled = (platforms = []) => {
  const normalized = normalizePlatforms(platforms);
  if (normalized.some((platform) => DISABLED_SOCIAL_PUBLISHER_PLATFORMS.has(platform))) {
    const error = new Error(TIKTOK_PUBLISHING_NOT_CONNECTED_MESSAGE);
    error.status = 400;
    throw error;
  }
  return normalized;
};

const normalizeMediaType = (value = "") => {
  const normalized = trimString(value).toLowerCase();
  if (normalized === "video") return "video";
  return "image";
};

const normalizePublishSettings = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    facebook_page_id: trimString(value.facebook_page_id || value.page_id),
    facebook_page_name: trimString(value.facebook_page_name || value.page_name),
    instagram_account_id: trimString(value.instagram_account_id),
    instagram_username: trimString(value.instagram_username),
  };
};

const normalizeSocialPublisherPostRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  caption: row.caption || "",
  first_comment: row.first_comment || "",
  first_comment_status: row.first_comment_status || null,
  first_comment_error: row.first_comment_error || null,
  first_comment_external_id: row.first_comment_external_id || null,
  first_comment_published_at: row.first_comment_published_at || null,
  media_url: row.media_url || "",
  media_urls: uniqueTextList([row.media_url, ...parseJsonArray(row.media_urls, [])]),
  media_type: normalizeMediaType(row.media_type),
  platforms: normalizePlatforms(row.platforms),
  publish_settings: normalizePublishSettings(row.publish_settings),
  status: row.status || "draft",
  scheduled_at: row.scheduled_at || null,
  published_at: row.published_at || null,
  error_message: row.error_message || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const parseMetaPayload = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const metaErrorMessage = (payload = {}, fallback = "Meta Graph API request failed") =>
  payload?.error?.message || payload?.message || fallback;

export const callMetaComment = async ({ targetId, accessToken, message, platform }) => {
  const endpoint = `${META_GRAPH_API_BASE_URL}/${encodeURIComponent(trimString(targetId))}/comments`;
  console.log("[social-publisher-first-comment]", {
    platform,
    target_id: trimString(targetId) || null,
    post_id: trimString(targetId) || null,
    status: "publishing",
    error: "",
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      message: trimString(message),
      access_token: trimString(accessToken),
    }),
  });
  const payload = await parseMetaPayload(response);
  if (!response.ok) {
    const error = new Error(metaErrorMessage(payload));
    error.status = response.status;
    error.metaResponse = payload;
    throw error;
  }
  return payload;
};

const getMarketingSettingsRow = async (tenantId) => {
  const result = await db.query(
    `
    SELECT *
    FROM marketing_settings
    WHERE tenant_id = $1::integer
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0] || null;
};

const resolveChannel = (platforms = []) => {
  const normalized = normalizePlatforms(platforms);
  if (normalized.includes("facebook") && normalized.includes("instagram")) return "all";
  if (normalized.includes("instagram")) return "instagram";
  return "facebook";
};

const normalizeFirstCommentStatus = (value = "") => {
  const normalized = trimString(value).toLowerCase();
  if (["published", "failed", "skipped"].includes(normalized)) return normalized;
  return "";
};

const normalizePositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const pickFirstPositiveNumber = (...values) => {
  for (const value of values) {
    const parsed = normalizePositiveNumber(value);
    if (parsed > 0) return parsed;
  }
  return 0;
};

const uniqueTextList = (...sources) => {
  const seen = new Set();
  const items = [];
  const pushValue = (value) => {
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    const text = trimString(value);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push(text);
  };
  sources.forEach(pushValue);
  return items;
};

const collectMediaUrls = (...sources) => {
  const seen = new Set();
  const items = [];

  const pushValue = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    if (typeof value === "string") {
      const text = trimString(value);
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          parsed.forEach(pushValue);
          return;
        }
      } catch {
        // Fall through to plain text handling.
      }
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      items.push(text);
      return;
    }
    if (typeof value === "object") {
      pushValue(
        value.image_url ||
          value.url ||
          value.src ||
          value.media_url ||
          value.primary_image_url ||
          value.variant_image_url ||
          value.color_image_url ||
          value.image ||
          value.photo_url ||
          value.thumbnail_url ||
          value.file_url ||
          ""
      );
      pushValue(value.images);
      pushValue(value.gallery_images);
      pushValue(value.media_urls);
    }
  };

  sources.forEach(pushValue);
  return items;
};

const isAvailableVariantForMedia = (variant = {}) => {
  const quantity = Number(
    variant.quantity ??
      variant.stock ??
      variant.stock_quantity ??
      variant.available_quantity ??
      variant.inventory_quantity ??
      variant.current_stock ??
      0
  );
  const available = variant.available === true || variant.in_stock === true || variant.is_available === true;
  return quantity > 0 || available;
};

const resolveSocialPublisherProductUrl = (product = {}) => {
  const slug = trimString(product.canonical_slug || product.slug || "");
  if (slug) return `/shop/product/${slug}`;
  const id = trimString(product.id || product.product_id || "");
  return id ? `/shop/product/${id}` : "";
};

const resolveSocialPublisherPricing = (product = {}) => {
  const resolved = resolveStorefrontPriceBreakdown(product);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const availableStock = variants.reduce(
    (sum, variant) => sum + Math.max(0, Number(variant.stock ?? variant.stock_quantity ?? variant.quantity ?? variant.available_stock ?? 0)),
    0
  ) || Math.max(
    0,
    Number(
      product.available_stock ??
        product.stock_quantity ??
        product.stock ??
        product.total_stock ??
        0
    )
  );
  console.warn("[social-publisher-price-resolver]", {
    product_id: product.id ?? product.product_id ?? null,
    base_price: Number(resolved.base_price || 0),
    sale_price: Number(resolved.sale_price || 0),
    current_price: Number(resolved.current_price || 0),
    old_crossed_price: Number(resolved.old_crossed_price || 0),
    discount_percent: resolved.discount_percent || "",
    source: resolved.source || "",
  });
  return {
    base_price: Number(resolved.base_price || 0),
    price: Number(resolved.base_price || resolved.current_price || 0),
    sale_price: Number(resolved.sale_price || 0),
    current_price: Number(resolved.current_price || 0),
    original_price: Number(resolved.old_crossed_price || 0) || Number(resolved.current_price || 0),
    old_crossed_price: Number(resolved.old_crossed_price || 0),
    discount_percent: resolved.discount_percent || "",
    sale_active: Boolean(resolved.sale_active),
    price_source: resolved.source || "",
    stock_quantity: availableStock,
    available_stock: availableStock,
  };
};

const normalizeSocialPublisherProduct = (product = {}) => {
  const pricing = resolveSocialPublisherPricing(product);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const galleryImages = collectMediaUrls(product.gallery_images, product.images, product.media_urls);
  const variantMediaUrls = uniqueTextList(
    variants.flatMap((variant) => collectMediaUrls(variant.primary_image_url, variant.variant_image_url, variant.color_image_url, variant.image_url, variant.image, variant.photo_url, variant.thumbnail_url, variant.images, variant.gallery_images, variant.media_urls))
  );
  const availableVariantMedia = variants.filter(isAvailableVariantForMedia);
  const availableColorEntries = [];
  const seenColorKeys = new Set();

  const addColorEntry = (variant = {}, source = "") => {
    const color = trimString(variant.color || variant.color_name || variant.colour || variant.variant_color || variant.name || "");
    if (!color) return;
    const colorKey = color.toLowerCase();
    if (seenColorKeys.has(colorKey)) return;
    const mediaUrls = collectMediaUrls(
      variant.primary_image_url,
      variant.variant_image_url,
      variant.color_image_url,
      variant.image_url,
      variant.image,
      variant.photo_url,
      variant.thumbnail_url,
      variant.images,
      variant.gallery_images,
      variant.media_urls
    );
    if (!mediaUrls.length) return;
    seenColorKeys.add(colorKey);
    availableColorEntries.push({
      color,
      color_key: colorKey,
      image_url: mediaUrls[0],
      images: mediaUrls.slice(1),
      media_urls: mediaUrls,
      available: true,
      source,
    });
  };

  const colorImageSources = Array.isArray(product.color_images) ? product.color_images : [];
  colorImageSources.forEach((entry) => addColorEntry(entry, "color_images"));

  if (product.images_by_color && typeof product.images_by_color === "object" && !Array.isArray(product.images_by_color)) {
    Object.entries(product.images_by_color).forEach(([color, value]) => {
      const mediaUrls = collectMediaUrls(value);
      if (!mediaUrls.length || !trimString(color)) return;
      const colorKey = trimString(color).toLowerCase();
      if (seenColorKeys.has(colorKey)) return;
      seenColorKeys.add(colorKey);
      availableColorEntries.push({
        color: trimString(color),
        color_key: colorKey,
        image_url: mediaUrls[0],
        images: mediaUrls.slice(1),
        media_urls: mediaUrls,
        available: true,
        source: "images_by_color",
      });
    });
  }

  availableVariantMedia.forEach((variant) => addColorEntry(variant, "variant"));

  const fallbackCoverImage =
    collectMediaUrls(
      product.image_url,
      product.product_image_url,
      product.thumbnail_url,
      product.photo_url,
      product.image,
      variants[0]?.image_url,
      variants[0]?.variant_image_url,
      galleryImages[0]
    )[0] || "";
  const primaryMediaUrl = availableColorEntries[0]?.image_url || fallbackCoverImage || "";
  const availableColors = availableColorEntries.length
    ? uniqueTextList(availableColorEntries.map((item) => item.color))
    : uniqueTextList(
        product.available_colors,
        product.colors,
        product.color_names,
        variants.map((variant) => variant.color || variant.color_name || "")
      );
  const imagesByColor = availableColorEntries.reduce((acc, item) => {
    acc[item.color_key] = uniqueTextList([item.image_url, ...item.images, ...(item.media_urls || [])]);
    return acc;
  }, {});
  const availableSizes = uniqueTextList(
    product.available_sizes,
    product.sizes,
    variants.map((variant) => variant.fixed_size_label || variant.size_label || variant.size_name || variant.size || "")
  );
  return {
    id: product.id ?? product.product_id ?? null,
    name: trimString(product.name || product.product_name || ""),
    image_url: fallbackCoverImage,
    cover_image_url: fallbackCoverImage,
    primary_media_url: primaryMediaUrl,
    media_urls: uniqueTextList([primaryMediaUrl, fallbackCoverImage, ...galleryImages, ...variantMediaUrls]),
    gallery_images: galleryImages,
    variant_images: variantMediaUrls,
    color_images: availableColorEntries,
    images_by_color: imagesByColor,
    price: pricing.price,
    sale_price: pricing.sale_price,
    current_price: pricing.current_price,
    original_price: pricing.original_price,
    discount_percent: pricing.discount_percent,
    stock_quantity: pricing.stock_quantity,
    available_stock: pricing.available_stock,
    available_sizes: availableSizes,
    available_colors: availableColors,
    product_url: resolveSocialPublisherProductUrl(product),
    base_price: pricing.base_price,
    sale_active: pricing.sale_active,
    price_source: pricing.price_source,
    old_crossed_price: pricing.old_crossed_price,
  };
};

export const listSocialPublisherPosts = async ({ tenantId, limit = 20 } = {}) => {
  await ensureMarketingSchema();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const result = await db.query(
    `
    SELECT *
    FROM social_publisher_posts
    WHERE tenant_id = $1::integer
    ORDER BY created_at DESC, id DESC
    LIMIT $2
    `,
    [tenantId, safeLimit]
  );
  return result.rows.map(normalizeSocialPublisherPostRow);
};

export const createSocialPublisherPostRow = async ({
  tenantId,
  caption = "",
  firstComment = "",
  mediaUrl = "",
  mediaUrls = [],
  mediaType = "image",
  platforms = [],
  publishSettings = {},
  status = "draft",
  scheduledAt = null,
  publishedAt = null,
  errorMessage = null,
} = {}) => {
  await ensureMarketingSchema();
  assertSocialPublisherPlatformsAreEnabled(platforms);
  const normalizedPublishSettings = normalizePublishSettings(publishSettings);
  const result = await db.query(
    `
    INSERT INTO social_publisher_posts (
      tenant_id,
      caption,
      first_comment,
      media_url,
      media_urls,
      media_type,
      platforms,
      publish_settings,
      status,
      scheduled_at,
      published_at,
      error_message
    )
    VALUES ($1::integer, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9, $10::timestamp, $11::timestamp, $12)
    RETURNING *
    `,
    [
      tenantId,
      trimString(caption),
      trimString(firstComment),
      trimString(mediaUrl),
      JSON.stringify(uniqueTextList([mediaUrl, ...parseJsonArray(mediaUrls, [])])),
      normalizeMediaType(mediaType),
      JSON.stringify(normalizePlatforms(platforms)),
      JSON.stringify(normalizedPublishSettings),
      trimString(status) || "draft",
      scheduledAt || null,
      publishedAt || null,
      errorMessage || null,
    ]
  );
  return normalizeSocialPublisherPostRow(result.rows[0]);
};

export const getSocialPublisherPostRow = async ({ tenantId, id } = {}) => {
  await ensureMarketingSchema();
  const result = await db.query(
    `
    SELECT *
    FROM social_publisher_posts
    WHERE tenant_id = $1::integer
      AND id = $2::bigint
    LIMIT 1
    `,
    [tenantId, id]
  );
  return result.rows[0] ? normalizeSocialPublisherPostRow(result.rows[0]) : null;
};

export const listSocialPublisherMetaAccounts = async ({ tenantId } = {}) => {
  console.log("[social-publisher-meta-accounts-service-hit]", {
    tenant: Number(tenantId || 1) || 1,
  });
  await ensureMarketingSchema();
  const scopedTenantId = Number(tenantId || 1) || 1;
  console.log("[social-publisher-meta-accounts] start", { tenant: scopedTenantId });

  let result;
  try {
    result = await db.query(
      `
      WITH meta_rows AS (
        SELECT
          id,
          facebook_page_id,
          facebook_page_name,
          page_name,
          instagram_business_account_id,
          instagram_username,
          page_access_token_encrypted,
          status,
          updated_at
        FROM meta_integration_configs
        WHERE tenant_id = $1::integer
          AND COALESCE(facebook_page_id, '') <> ''
        ORDER BY updated_at DESC, id DESC
      ),
      marketing_row AS (
        SELECT
          NULL::bigint AS id,
          page_id AS facebook_page_id,
          ''::text AS facebook_page_name,
          ''::text AS page_name,
          instagram_account_id AS instagram_business_account_id,
          ''::text AS instagram_username,
          COALESCE(page_access_token, access_token_encrypted, '') AS page_access_token_encrypted,
          CASE WHEN is_connected THEN 'connected' ELSE 'not_connected' END AS status,
          updated_at
        FROM marketing_settings
        WHERE tenant_id = $1::integer
          AND COALESCE(page_id, '') <> ''
        LIMIT 1
      )
      SELECT * FROM meta_rows
      UNION ALL
      SELECT * FROM marketing_row
      `,
      [tenantId]
    );
  } catch (error) {
    console.error("[social-publisher-meta-accounts] meta rows query failed", {
      tenant: scopedTenantId,
      message: error?.message || "unknown",
      code: error?.code || "",
      stack: error?.stack || "",
    });
    throw error;
  }

  const pageMap = new Map();
  const instagramMap = new Map();
  let selectedPageId = "";
  let selectedInstagramAccountId = "";

  const selectedSettingsResult = await db.query(
    `
    SELECT page_id, instagram_account_id
    FROM marketing_settings
    WHERE tenant_id = $1::integer
    LIMIT 1
    `,
    [tenantId]
  );
  const selectedSettings = selectedSettingsResult.rows[0] || null;

  for (const row of result.rows || []) {
    const pageId = trimString(row.facebook_page_id);
    const pageName = trimString(row.facebook_page_name || row.page_name);
    const instagramAccountId = trimString(row.instagram_business_account_id);
    const instagramUsername = trimString(row.instagram_username);
    const pageOption = {
      facebook_page_id: pageId,
      facebook_page_name: pageName,
      instagram_business_account_id: instagramAccountId,
      instagram_username: instagramUsername,
      token_status: trimString(row.status || ""),
      connected: Boolean(trimString(row.page_access_token_encrypted || "")),
      updated_at: row.updated_at || null,
    };
    if (pageId && !pageMap.has(pageId)) pageMap.set(pageId, pageOption);
    if (instagramAccountId && !instagramMap.has(instagramAccountId)) {
      instagramMap.set(instagramAccountId, {
        instagram_account_id: instagramAccountId,
        instagram_username: instagramUsername || instagramAccountId,
        facebook_page_id: pageId,
        facebook_page_name: pageName,
      });
    }
  }

  const pages = Array.from(pageMap.values());
  const instagramAccounts = Array.from(instagramMap.values());
  let metaStatus = null;
  try {
    metaStatus = await getMetaIntegrationStatus({ tenantId });
  } catch (error) {
    console.error("[social-publisher-meta-accounts] meta integration status lookup failed", {
      tenant: scopedTenantId,
      message: error?.message || "unknown",
      code: error?.code || "",
      stack: error?.stack || "",
    });
    metaStatus = null;
  }
  const metaConfig = metaStatus?.config || {};
  const metaPageId = trimString(metaConfig.facebook_page_id || metaConfig.page_id || "");
  const metaPageName = trimString(metaConfig.facebook_page_name || metaConfig.page_name || metaPageId);
  const metaInstagramId = trimString(metaConfig.instagram_business_account_id || metaConfig.instagram_account_id || "");
  const metaInstagramUsername = trimString(metaConfig.instagram_username || metaInstagramId);

  if (!pages.length && metaPageId) {
    pages.push({
      facebook_page_id: metaPageId,
      facebook_page_name: metaPageName || metaPageId,
      instagram_business_account_id: metaInstagramId,
      instagram_username: metaInstagramUsername,
      token_status: trimString(metaConfig.token_status || metaConfig.status || ""),
      connected: Boolean(metaConfig.page_access_token_configured || metaConfig.page_access_token_masked),
      updated_at: metaConfig.updated_at || null,
    });
  }

  if (!instagramAccounts.length && metaInstagramId) {
    instagramAccounts.push({
      instagram_account_id: metaInstagramId,
      instagram_username: metaInstagramUsername || metaInstagramId,
      facebook_page_id: metaPageId,
      facebook_page_name: metaPageName || metaPageId,
    });
  }

  selectedPageId = trimString(selectedSettings?.page_id || metaPageId || pages[0]?.facebook_page_id || "");
  selectedInstagramAccountId = trimString(
    selectedSettings?.instagram_account_id ||
      metaInstagramId ||
      instagramAccounts.find((item) => item.facebook_page_id === selectedPageId)?.instagram_account_id ||
      pages.find((item) => item.facebook_page_id === selectedPageId)?.instagram_business_account_id ||
      instagramAccounts[0]?.instagram_account_id ||
      ""
  );

  const response = {
    selected: {
      facebook_page_id: selectedPageId,
      facebook_page_name: pages.find((item) => item.facebook_page_id === selectedPageId)?.facebook_page_name || metaPageName || "",
      instagram_account_id: selectedInstagramAccountId,
      instagram_username:
        instagramAccounts.find((item) => item.instagram_account_id === selectedInstagramAccountId)?.instagram_username ||
        metaInstagramUsername ||
        "",
    },
    pages,
    facebook_pages: pages,
    instagram_accounts: instagramAccounts,
    instagramBusinessAccounts: instagramAccounts,
    has_facebook: pages.length > 0,
    has_instagram: instagramAccounts.length > 0,
    meta_integration_connected: Boolean(metaStatus?.overall_status && ["connected", "fully_connected", "active", "saved", "partially_connected"].includes(String(metaStatus.overall_status || "").toLowerCase())),
    meta_connected: Boolean(metaStatus?.overall_status && ["connected", "fully_connected", "active", "saved", "partially_connected"].includes(String(metaStatus.overall_status || "").toLowerCase())),
    meta_config: {
      facebook_page_id: metaPageId,
      facebook_page_name: metaPageName,
      instagram_business_account_id: metaInstagramId,
      instagram_username: metaInstagramUsername,
      status: metaStatus?.overall_status || metaConfig?.status || "",
    },
  };
  console.log("[social-publisher-meta-accounts]", {
    tenant: scopedTenantId,
    metaIntegrationStatus: metaStatus?.overall_status || null,
    meta_config: response.meta_config,
    pages: response.pages,
    instagram_accounts: response.instagram_accounts,
  });
  return response;
};

export const searchSocialPublisherProducts = async ({ tenantId, query = "", limit = 20 } = {}) => {
  await ensureMarketingSchema();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
  const normalizedQuery = trimString(query);
  const payload = await loadProductsWithVariantsPayload({
    query: {
      search: normalizedQuery,
      limit: safeLimit,
    },
    user: {
      tenant_id: tenantId,
    },
    requestId: "social-publisher-products-search",
  });
  const products = Array.isArray(payload?.products) ? payload.products : Array.isArray(payload?.data) ? payload.data : [];
  const normalizedProducts = products.map(normalizeSocialPublisherProduct).filter((product) => product.id);
  console.warn("[social-publisher-products-search]", {
    tenant: Number(tenantId || 1) || 1,
    query: normalizedQuery,
    count: normalizedProducts.length,
    sample: normalizedProducts.slice(0, 2),
  });
  return normalizedProducts;
};

export const resolveFirstCommentTargets = ({ post = {}, publishResult = {} } = {}) => {
  const platformResults = publishResult?.platform_publish_results || {};
  const singlePlatformTarget = (platform) => {
    const normalizedPlatform = trimString(platform).toLowerCase();
    if (!normalizedPlatform) return null;
    const candidateId =
      trimString(platformResults?.[normalizedPlatform]?.platform_post_id) ||
      trimString(publishResult?.platform_post_id) ||
      trimString(publishResult?.external_post_id);
    if (!candidateId) return null;
    return {
      platform: normalizedPlatform,
      targetId: candidateId,
    };
  };

  if (trimString(publishResult?.mode).toLowerCase() === "all") {
    return ["facebook", "instagram"].map((platform) => ({
      platform,
      targetId: trimString(platformResults?.[platform]?.platform_post_id),
    })).filter((item) => item.targetId);
  }

  const mode = trimString(publishResult?.mode || resolveChannel(post.platforms)).toLowerCase();
  const target = singlePlatformTarget(mode);
  return target ? [target] : [];
};

const persistFirstCommentState = async ({
  tenantId,
  id,
  status,
  errorMessage = null,
  externalId = null,
  publishedAt = null,
} = {}) => {
  await db.query(
    `
    UPDATE social_publisher_posts
    SET
      first_comment_status = $1,
      first_comment_error = $2,
      first_comment_external_id = $3,
      first_comment_published_at = $4::timestamp,
      updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $5::integer
      AND id = $6::bigint
    `,
    [
      normalizeFirstCommentStatus(status) || null,
      trimString(errorMessage) || null,
      trimString(externalId) || null,
      publishedAt || null,
      tenantId,
      id,
    ]
  );
};

const publishFirstCommentIfNeeded = async ({
  tenantId,
  id,
  post,
  publishResult,
  accessToken,
} = {}) => {
  const commentText = trimString(post?.first_comment || "");
  const currentStatus = normalizeFirstCommentStatus(post?.first_comment_status || "");
  if (!commentText) {
    console.log("[social-publisher-first-comment]", {
      platform: "all",
      post_id: publishResult?.platform_post_id || publishResult?.external_post_id || null,
      status: "skipped",
      error: "first_comment is empty",
    });
    await persistFirstCommentState({
      tenantId,
      id,
      status: "skipped",
      errorMessage: "first_comment is empty",
      externalId: null,
      publishedAt: null,
    });
    return { status: "skipped", error: "first_comment is empty" };
  }

  if (!trimString(accessToken)) {
    const reason = "Meta access token is not configured.";
    console.log("[social-publisher-first-comment]", {
      platform: "all",
      post_id: publishResult?.platform_post_id || publishResult?.external_post_id || null,
      status: "skipped",
      error: reason,
    });
    await persistFirstCommentState({ tenantId, id, status: "skipped", errorMessage: reason });
    return { status: "skipped", error: reason };
  }

  if (currentStatus === "published" || currentStatus === "skipped" || currentStatus === "failed") {
    console.log("[social-publisher-first-comment]", {
      platform: "all",
      post_id: publishResult?.platform_post_id || publishResult?.external_post_id || null,
      status: "skipped",
      error: `first_comment already ${currentStatus}`,
    });
    return {
      status: "skipped",
      error: `first_comment already ${currentStatus}`,
    };
  }

  const targets = resolveFirstCommentTargets({ post, publishResult });
  if (!targets.length) {
    const reason = "No supported post/media id available for first comment.";
    console.log("[social-publisher-first-comment]", {
      platform: "all",
      post_id: publishResult?.platform_post_id || publishResult?.external_post_id || null,
      status: "skipped",
      error: reason,
    });
    await persistFirstCommentState({ tenantId, id, status: "skipped", errorMessage: reason });
    return { status: "skipped", error: reason };
  }

  const results = [];
  for (const target of targets) {
    try {
      const payload = await callMetaComment({
        targetId: target.targetId,
        accessToken,
        message: commentText,
        platform: target.platform,
      });
      const commentId = trimString(payload?.id || payload?.comment_id || payload?.post_id || "");
      console.log("[social-publisher-first-comment]", {
        platform: target.platform,
        post_id: target.targetId,
        status: "published",
        error: "",
      });
      results.push({ platform: target.platform, status: "published", commentId, targetId: target.targetId });
    } catch (error) {
      const message = error?.message || "First comment publish failed";
      console.error("[social-publisher-first-comment]", {
        platform: target.platform,
        post_id: target.targetId,
        status: "failed",
        error: message,
      });
      results.push({ platform: target.platform, status: "failed", error: message, targetId: target.targetId });
    }
  }

  const publishedResults = results.filter((item) => item.status === "published");
  const failedResults = results.filter((item) => item.status === "failed");
  if (publishedResults.length && !failedResults.length) {
    const lastPublished = publishedResults[publishedResults.length - 1];
    await persistFirstCommentState({
      tenantId,
      id,
      status: "published",
      errorMessage: null,
      externalId: lastPublished.commentId || lastPublished.targetId,
      publishedAt: new Date().toISOString(),
    });
    return { status: "published", commentId: lastPublished.commentId || null };
  }

  const reason = failedResults.map((item) => `${item.platform}: ${item.error}`).join("; ") || "First comment publish skipped";
  await persistFirstCommentState({
    tenantId,
    id,
    status: publishedResults.length ? "failed" : "failed",
    errorMessage: reason,
    externalId: publishedResults[0]?.commentId || null,
    publishedAt: publishedResults.length ? new Date().toISOString() : null,
  });
  return {
    status: "failed",
    error: reason,
    commentId: publishedResults[0]?.commentId || null,
  };
};

export const publishSocialPublisherPostRow = async ({ tenantId, id } = {}) => {
  await ensureMarketingSchema();
  const post = await getSocialPublisherPostRow({ tenantId, id });
  if (!post) {
    return {
      success: false,
      status: 404,
      message: "Social publisher post not found",
      data: null,
    };
  }

  assertSocialPublisherPlatformsAreEnabled(post.platforms);
  const settings = await getMarketingSettingsRow(tenantId);
  const publishSettings = normalizePublishSettings(post.publish_settings);
  const effectiveSettings = {
    ...(settings || {}),
    page_id: publishSettings.facebook_page_id || settings?.page_id || settings?.facebook_page_id || "",
    facebook_page_id: publishSettings.facebook_page_id || settings?.page_id || settings?.facebook_page_id || "",
    page_name: publishSettings.facebook_page_name || settings?.page_name || settings?.facebook_page_name || "",
    facebook_page_name: publishSettings.facebook_page_name || settings?.page_name || settings?.facebook_page_name || "",
    instagram_account_id: publishSettings.instagram_account_id || settings?.instagram_account_id || "",
    instagram_business_account_id: publishSettings.instagram_account_id || settings?.instagram_business_account_id || "",
    instagram_username: publishSettings.instagram_username || settings?.instagram_username || "",
  };
  let accessToken = "";
  try {
    accessToken = validateMetaToken(effectiveSettings).accessToken || "";
  } catch (error) {
    accessToken = "";
  }
  const publishPayload = {
    ...post,
    channel: resolveChannel(post.platforms),
    image_url: post.media_url || "",
    media_urls: uniqueTextList([post.media_url, ...(post.media_urls || [])]),
  };

  let publishResult = null;
  try {
    publishResult = await publishMetaPost(publishPayload, effectiveSettings);
  } catch (error) {
    publishResult = {
      success: false,
      status: "failed",
      error_message: error?.message || "Social publisher publish failed",
    };
  }
  const nextStatus = publishResult?.status || (publishResult?.success ? "published" : "failed");
  const publishSucceeded = nextStatus === "published" || nextStatus === "partial_success";
  const errorMessage = publishResult?.error_message || null;
  const publishedAt = publishSucceeded ? publishResult?.published_at || new Date().toISOString() : null;

  if (publishSucceeded) {
    try {
      await publishFirstCommentIfNeeded({
        tenantId,
        id,
        post,
        publishResult,
        accessToken,
      });
    } catch (error) {
      console.error("[social-publisher-first-comment]", {
        platform: "all",
        post_id: publishResult?.platform_post_id || publishResult?.external_post_id || null,
        status: "failed",
        error: error?.message || "First comment publish failed",
      });
      await persistFirstCommentState({
        tenantId,
        id,
        status: "failed",
        errorMessage: error?.message || "First comment publish failed",
        externalId: null,
        publishedAt: null,
      });
    }
  }

  const updatedResult = await db.query(
    `
    UPDATE social_publisher_posts
    SET
      status = $1,
      published_at = $2::timestamp,
      error_message = $3,
      updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $4::integer
      AND id = $5::bigint
    RETURNING *
    `,
    [
      nextStatus,
      publishedAt,
      errorMessage,
      tenantId,
      id,
    ]
  );

  const updated = updatedResult.rows[0] ? normalizeSocialPublisherPostRow(updatedResult.rows[0]) : post;
  return {
    success: publishSucceeded,
    status: nextStatus,
    message: publishResult?.error_message || (nextStatus === "published" ? "Published successfully" : "Publish failed"),
    data: updated,
    meta_result: publishResult || null,
  };
};

export const runDueSocialPublisherPublishes = async () => {
  await ensureMarketingSchema();
  const lockResult = await db.query("SELECT pg_try_advisory_lock($1) AS locked", [SOCIAL_PUBLISHER_SCHEDULER_LOCK_KEY]);
  const lockAcquired = Boolean(lockResult.rows[0]?.locked);
  if (!lockAcquired) {
    return { skipped: true, reason: "lock_busy", published: 0, failed: 0, due: 0 };
  }

  try {
    const dueResult = await db.query(
      `
      SELECT id, tenant_id, status, scheduled_at
      FROM social_publisher_posts
      WHERE status = 'scheduled'
        AND scheduled_at IS NOT NULL
        AND scheduled_at <= CURRENT_TIMESTAMP
      ORDER BY scheduled_at ASC, created_at ASC, id ASC
      `
    );

    let published = 0;
    let failed = 0;

    for (const row of dueResult.rows) {
      try {
        const result = await publishSocialPublisherPostRow({
          tenantId: row.tenant_id,
          id: row.id,
        });
        if (result?.success) {
          published += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        const message = error?.message || "Scheduled social publisher publish failed";
        console.error("[social-publisher-scheduler] publish error", {
          post_id: row.id,
          tenant_id: row.tenant_id,
          message,
        });
        await db.query(
          `
          UPDATE social_publisher_posts
          SET
            status = 'failed',
            published_at = NULL,
            error_message = $1::text,
            updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $2::integer
            AND id = $3::bigint
          `,
          [message, row.tenant_id, row.id]
        );
      }
    }

    return {
      skipped: false,
      due: dueResult.rows.length,
      published,
      failed,
    };
  } finally {
    try {
      await db.query("SELECT pg_advisory_unlock($1)", [SOCIAL_PUBLISHER_SCHEDULER_LOCK_KEY]);
    } catch (unlockError) {
      console.warn("[social-publisher-scheduler] advisory unlock failed", unlockError?.message || unlockError);
    }
  }
};

export const getSocialPublisherSettingsRow = getMarketingSettingsRow;
