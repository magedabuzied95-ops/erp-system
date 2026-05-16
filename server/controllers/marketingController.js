import db from "../database/db.js";
import crypto from "crypto";
import { getTenantId } from "../utils/requestScope.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { publishFacebookText, publishPost as publishPostService } from "../services/socialPublisherService.js";
import { publishStoryEverywhere as publishStoryEverywhereService } from "../services/storyPublisherService.js";
import {
  generateCollageStory,
  generateInstagramSafeStoryImage,
  generateSingleProductStory,
  getStoryImageLocalPath,
  getStoryImageMetadata,
} from "../services/storyImageService.js";
import { getMetaTokenStatus, refreshMetaTokens } from "../services/metaTokenService.js";
import { refreshMarketingTenantMetaToken } from "../services/metaTokenAutoRefreshService.js";
import { ensureTrackingForPost } from "../services/marketingAttributionService.js";
import {
  commentMatchesRule,
  normalizeKeywords,
  renderCommentDmMessage,
  sendCommentPrivateReply,
} from "../services/commentDmAutomationService.js";
import {
  createAutoReplyRule as createMarketingAutoReplyRule,
  deleteAutoReplyRule as deleteMarketingAutoReplyRule,
  getAutoReplyRules as getMarketingAutoReplyRules,
  getCommentEvents as getMarketingCommentEvents,
  getMarketingConversations as getMarketingLeadConversations,
  getMetaWebhookStatus as getMarketingMetaWebhookStatus,
  processMetaWebhookPayload,
  saveLinksForPublishedPost,
  simulateCommentAutomation as simulateMarketingCommentAutomation,
  updateAutoReplyRule as updateMarketingAutoReplyRule,
} from "../services/marketingCommentAutomationService.js";

const getTenantScope = (req) => getTenantId(req, req.user?.tenant_id) ?? 1;

const safeJson = (value, fallback = []) => {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return fallback;
};

const safeJsonObject = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const uniqueList = (items = []) =>
  Array.from(
    new Set(
      items
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );

const parseMaybeJsonArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const imageFromGalleryItem = (item) => {
  if (!item) return "";
  if (typeof item === "string") return item;
  return item.url || item.image_url || item.image || item.path || item.src || "";
};

const normalizeMediaUrls = (value, fallbackImage = "") => {
  const media = uniqueList(parseMaybeJsonArray(value).map(imageFromGalleryItem));
  return media.length ? media : uniqueList([fallbackImage]);
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizePostRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  product_id: row.product_id ?? null,
  campaign_id: row.campaign_id ?? null,
  template_id: row.template_id ?? null,
  product_name: row.product_name || "",
  title: row.title || "",
  caption: row.caption || "",
  hashtags: row.hashtags || "",
  hashtags_list: safeJson(row.hashtags_list, safeJson(row.hashtags, [])),
  image_url: row.image_url || "",
  media_urls: normalizeMediaUrls(row.media_urls, row.image_url),
  channel: row.channel || "facebook",
  status: row.status || "draft",
  scheduled_at: row.scheduled_at || null,
  published_at: row.published_at || null,
  external_post_id: row.external_post_id || null,
  platform_post_id: row.platform_post_id || row.external_post_id || null,
  platform_publish_results: safeJsonObject(row.platform_publish_results, {}),
  story_status: row.story_status || "draft",
  story_type: row.story_type || "story",
  story_scheduled_at: row.story_scheduled_at || null,
  story_published_at: row.story_published_at || null,
  story_publish_results: safeJsonObject(row.story_publish_results, {}),
  story_error_message: row.story_error_message || null,
  error_message: row.error_message || null,
  tracking_code: row.tracking_code || null,
  tracking_link: row.tracking_link || null,
  tracking_source: row.tracking_source || null,
  tracking_kind: row.tracking_kind || "post",
  campaign_name: row.campaign_name || "",
  template_name: row.template_name || "",
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const normalizeCampaignRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  name: row.name || "",
  description: row.description || "",
  status: row.status || "draft",
  start_date: row.start_date || null,
  end_date: row.end_date || null,
  budget: toNumber(row.budget, 0),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const normalizeTemplateRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  name: row.name || "",
  channel: row.channel || "facebook",
  title_template: row.title_template || "",
  caption_template: row.caption_template || "",
  hashtags: row.hashtags || "",
  is_default: Boolean(row.is_default),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const normalizeSettingsRow = (row = {}) => {
  const tokenStatus = getMetaTokenStatus(row);
  const autoRefreshEnabled = Boolean(
    (process.env.META_APP_ID || process.env.FACEBOOK_APP_ID) &&
      (process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET) &&
      row.long_lived_user_token
  );
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    provider: row.provider || "meta",
    page_id: row.page_id || "",
    facebook_page_id: row.page_id || "",
    instagram_account_id: row.instagram_account_id || "",
    is_connected: Boolean(row.is_connected),
    access_token_set: Boolean(row.access_token_encrypted || row.page_access_token),
    long_lived_user_token_set: Boolean(row.long_lived_user_token),
    page_access_token_set: Boolean(row.page_access_token),
    token_status: row.token_status || tokenStatus.status,
    token_health_status: tokenStatus.status,
    token_expires_at: row.token_expires_at || null,
    token_last_validated_at: row.token_last_validated_at || null,
    token_error_message: row.token_error_message || tokenStatus.error || tokenStatus.warning || null,
    auto_refresh_enabled: autoRefreshEnabled,
    last_auto_refresh_at: row.last_auto_refresh_at || null,
    next_refresh_check_at: row.next_refresh_check_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
};

const normalizeCommentDmRuleRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  name: row.name || "",
  platform: row.platform || "facebook",
  post_id: row.post_id ?? null,
  platform_post_id: row.platform_post_id || "",
  trigger_keywords: normalizeKeywords(row.trigger_keywords),
  excluded_keywords: normalizeKeywords(row.excluded_keywords),
  match_mode: row.match_mode || "any",
  response_message: row.response_message || "",
  is_active: Boolean(row.is_active),
  last_checked_at: row.last_checked_at || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const normalizeCommentDmLogRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  rule_id: row.rule_id ?? null,
  post_id: row.post_id ?? null,
  platform: row.platform || "facebook",
  platform_post_id: row.platform_post_id || "",
  platform_comment_id: row.platform_comment_id || "",
  commenter_id: row.commenter_id || "",
  commenter_name: row.commenter_name || "",
  comment_text: row.comment_text || "",
  response_message: row.response_message || "",
  status: row.status || "pending",
  error_message: row.error_message || null,
  meta_response: safeJsonObject(row.meta_response, {}),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const nullableString = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
};

const optionalNullableString = (value) => (value === undefined ? null : nullableString(value));

const trimSlashes = (value = "") => String(value).replace(/^\/+|\/+$/g, "");

const getPublicUploadUrl = (value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const publicBackendUrl = String(process.env.PUBLIC_BACKEND_URL || "").trim().replace(/\/+$/g, "");
  if (!publicBackendUrl) return imageUrl;
  if (imageUrl.startsWith("/uploads/") || imageUrl.startsWith("uploads/")) {
    return `${publicBackendUrl}/${trimSlashes(imageUrl)}`;
  }
  return imageUrl;
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const verifyMetaSignature = (req) => {
  const appSecret = nullableString(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET);
  if (!appSecret) return { valid: false, reason: "missing_app_secret" };

  const signature = nullableString(req.get("x-hub-signature-256"));
  if (!signature || !signature.startsWith("sha256=")) return { valid: false, reason: "missing_signature" };

  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (signatureBuffer.length !== expectedBuffer.length) return { valid: false, reason: "signature_mismatch" };
  return {
    valid: crypto.timingSafeEqual(signatureBuffer, expectedBuffer),
    reason: "signature_mismatch",
  };
};

const ensureSettingsRow = async (tenantId) => {
  await db.query(
    `
    INSERT INTO marketing_settings (tenant_id, provider)
    VALUES ($1::bigint, 'meta'::varchar)
    ON CONFLICT (tenant_id) DO NOTHING
    `,
    [tenantId]
  );
};

const getSettingsRow = async (tenantId) => {
  await ensureSettingsRow(tenantId);
  const result = await db.query(
    `
    SELECT *
    FROM marketing_settings
    WHERE tenant_id = $1::bigint
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0] || null;
};

const uniqueValues = (rows = [], key) =>
  Array.from(
    new Set(
      rows
        .map((row) => String(row?.[key] || "").trim())
        .filter(Boolean)
    )
  );

const buildProductCaption = ({ productName, price, variants = [] }) => {
  const colors = uniqueValues(variants, "color");
  const sizes = uniqueValues(variants, "size");
  const details = [];
  if (colors.length) details.push(`الألوان: ${colors.slice(0, 6).join("، ")}`);
  if (sizes.length) details.push(`المقاسات: ${sizes.slice(0, 8).join("، ")}`);

  return [
    "وصل جديد",
    productName,
    "",
    "متاح الآن بألوان ومقاسات مميزة.",
    ...details,
    `السعر يبدأ من: ${price} ج.م`,
    "",
    "اطلبه الآن قبل نفاد الكمية ✨",
  ].join("\n");
};

const resolveProductPostData = (productRow = {}, variantRows = []) => {
  const productName = productRow.name || "New product";
  const priceCandidates = [
    productRow.sale_price,
    productRow.price,
    ...variantRows
      .map((variant) => variant.sale_price ?? variant.price)
      .filter((value) => value !== undefined && value !== null),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const price = priceCandidates.length ? Math.min(...priceCandidates) : 0;
  const mediaUrls = collectVariantMediaUrls(variantRows);

  return {
    title: productName,
    caption: buildProductCaption({
      productName,
      price: price || "0",
      variants: variantRows,
    }),
    hashtags: "#fashion #shoes #new_arrival #shopping",
    image_url: mediaUrls[0] || "",
    media_urls: mediaUrls,
    channel: "facebook",
  };
};

const getProductStoryCreative = (productRow = {}, variantRows = []) => {
  const generated = resolveProductPostData(productRow, variantRows);
  const storyImageUrls = collectProductStoryImageUrls(productRow, variantRows);
  const price = productRow.sale_price || productRow.price || variantRows.find((variant) => variant.sale_price || variant.price)?.sale_price || variantRows.find((variant) => variant.price)?.price || "";
  return {
    title: productRow.name || generated.title || "Product Story",
    caption: [productRow.name || generated.title, price ? `${price} ج.م` : "", "اطلبه الآن"].filter(Boolean).join("\n"),
    hashtags: generated.hashtags,
    image_url: storyImageUrls[0] || generated.image_url,
    media_urls: storyImageUrls.length ? storyImageUrls : generated.media_urls,
    channel: "all",
    story_type: "product",
  };
};

const collectGalleryMediaUrls = (productRow = {}, variantRows = []) =>
  uniqueList([
    ...parseMaybeJsonArray(productRow.gallery_images).map(imageFromGalleryItem),
    ...parseMaybeJsonArray(productRow.images).map(imageFromGalleryItem),
    ...parseMaybeJsonArray(productRow.media_urls).map(imageFromGalleryItem),
    ...variantRows.flatMap((variant = {}) => [
      ...parseMaybeJsonArray(variant.gallery_images).map(imageFromGalleryItem),
      ...parseMaybeJsonArray(variant.images).map(imageFromGalleryItem),
      ...parseMaybeJsonArray(variant.media_urls).map(imageFromGalleryItem),
    ]),
  ]);

const isStoryInactiveValue = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["inactive", "disabled", "archived", "false", "0", "no"].includes(normalized);
};

const hasPositiveStock = (value) => Number(value ?? 0) > 0;

const normalizeStoryVariantStock = (variant = {}) => {
  const candidates = [
    variant.stock,
    variant.quantity,
    variant.qty,
    variant.available_quantity,
    variant.inventory_quantity,
    variant.current_stock,
  ];

  const normalized = candidates
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!normalized.length) return 0;
  return Math.max(...normalized);
};

const resolveVariantStoryImageUrl = (variant = {}) =>
  uniqueList([
    variant.variant_image_url,
    variant.image_url,
    variant.color_image_url,
    variant.image,
    variant.photo_url,
    variant.thumbnail_url,
    ...parseMaybeJsonArray(variant.gallery_images).map(imageFromGalleryItem),
    ...parseMaybeJsonArray(variant.images).map(imageFromGalleryItem),
    ...parseMaybeJsonArray(variant.media_urls).map(imageFromGalleryItem),
  ])[0] || "";

const isStoryEligibleVariant = (variant = {}) => {
  if (!hasPositiveStock(normalizeStoryVariantStock(variant))) return false;
  if (variant.is_active === false || variant.active === false || variant.enabled === false || variant.disabled === true) return false;
  if (isStoryInactiveValue(variant.status) || isStoryInactiveValue(variant.state)) return false;
  return true;
};

const isStoryEligibleProduct = (productRow = {}) => {
  if (!hasPositiveStock(productRow.stock ?? productRow.quantity ?? productRow.qty)) return false;
  if (productRow.is_active === false || productRow.active === false || productRow.enabled === false || productRow.disabled === true) return false;
  if (isStoryInactiveValue(productRow.status) || isStoryInactiveValue(productRow.state)) return false;
  return true;
};

const getProductStoryImageSelection = (productRow = {}, variantRows = []) => {
  const productAvailable = isStoryEligibleProduct(productRow);
  const normalizedVariants = variantRows.map((variant = {}) => {
    const normalizedStock = normalizeStoryVariantStock(variant);
    const imageUrl = resolveVariantStoryImageUrl(variant);
    return {
      ...variant,
      normalizedStock,
      imageUrl,
      hasImage: Boolean(imageUrl),
    };
  });

  const eligibleVariants = normalizedVariants.filter(isStoryEligibleVariant);
  const inStockVariantImageUrls = uniqueList(
    eligibleVariants.flatMap((variant = {}) => [
      variant.variant_image_url,
      variant.image_url,
      variant.color_image_url,
      variant.image,
      variant.photo_url,
      variant.thumbnail_url,
      ...parseMaybeJsonArray(variant.gallery_images).map(imageFromGalleryItem),
      ...parseMaybeJsonArray(variant.images).map(imageFromGalleryItem),
      ...parseMaybeJsonArray(variant.media_urls).map(imageFromGalleryItem),
    ])
  );
  const anyVariantImageUrls = uniqueList(
    normalizedVariants.flatMap((variant = {}) => [
      variant.variant_image_url,
      variant.image_url,
      variant.color_image_url,
      variant.image,
      variant.photo_url,
      variant.thumbnail_url,
      ...parseMaybeJsonArray(variant.gallery_images).map(imageFromGalleryItem),
      ...parseMaybeJsonArray(variant.images).map(imageFromGalleryItem),
      ...parseMaybeJsonArray(variant.media_urls).map(imageFromGalleryItem),
    ])
  );

  console.log("[FAST_STORY_STOCK_FILTER]", {
    productId: productRow?.id ?? productRow?.product_id ?? null,
    variants: normalizedVariants.map((variant) => ({
      id: variant.id,
      color: variant.color || variant.color_name || variant.name,
      stock: variant.stock,
      quantity: variant.quantity,
      qty: variant.qty,
      available_quantity: variant.available_quantity,
      inventory_quantity: variant.inventory_quantity,
      current_stock: variant.current_stock,
      normalizedStock: variant.normalizedStock,
      hasImage: Boolean(variant.imageUrl),
    })),
    selectedImageCount: inStockVariantImageUrls.length,
    selectedImageUrls: inStockVariantImageUrls,
  });

  if (inStockVariantImageUrls.length) {
    return {
      images: inStockVariantImageUrls,
      eligibleVariants,
      hasEligibleVariants: eligibleVariants.length > 0,
      hasVariantImages: true,
      productAvailable,
      inStockVariantImageUrls,
      anyVariantImageUrls,
    };
  }

  if (anyVariantImageUrls.length) {
    return {
      images: [],
      eligibleVariants,
      hasEligibleVariants: eligibleVariants.length > 0,
      hasVariantImages: true,
      productAvailable,
      inStockVariantImageUrls,
      anyVariantImageUrls,
    };
  }

  if (productAvailable) {
    return {
      images: collectGalleryMediaUrls(productRow, []),
      eligibleVariants,
      hasEligibleVariants: eligibleVariants.length > 0,
      hasVariantImages: false,
      productAvailable,
      inStockVariantImageUrls,
      anyVariantImageUrls,
    };
  }

  return {
    images: [],
    eligibleVariants,
    hasEligibleVariants: eligibleVariants.length > 0,
    hasVariantImages: false,
    productAvailable: false,
    inStockVariantImageUrls,
    anyVariantImageUrls,
  };
};

const collectProductStoryImageUrls = (productRow = {}, variantRows = []) => {
  return getProductStoryImageSelection(productRow, variantRows).images;
};

const collectVariantMediaUrls = (variantRows = []) =>
  uniqueList(
    variantRows.flatMap((variant = {}) => [
      variant.variant_image_url,
      variant.image_url,
      variant.color_image_url,
      variant.image,
      variant.photo_url,
      variant.thumbnail_url,
      ...parseMaybeJsonArray(variant.gallery_images).map(imageFromGalleryItem),
      ...parseMaybeJsonArray(variant.images).map(imageFromGalleryItem),
      ...parseMaybeJsonArray(variant.media_urls).map(imageFromGalleryItem),
    ])
  );

const fetchProductBundle = async (productId, tenantId) => {
  const productResult = await db.query(
    `
    SELECT
      p.*,
      COALESCE(NULLIF(b.logo_url, ''), NULLIF(b.image_url, '')) AS brand_logo_url,
      COALESCE(NULLIF(b.image_url, ''), NULLIF(b.logo_url, '')) AS brand_image,
      COALESCE(NULLIF(b.logo_url, ''), NULLIF(b.image_url, '')) AS brand_logo,
      b.name AS brand_relation_name
    FROM products p
    LEFT JOIN brands b
      ON b.id = p.brand_id
      AND ($2::bigint IS NULL OR b.tenant_id = $2::bigint OR b.tenant_id IS NULL)
    WHERE p.id = $1
      AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
    LIMIT 1
    `,
    [productId, tenantId]
  );

  const product = productResult.rows[0];
  if (!product) return { product: null, variants: [] };

  const variantsResult = await db.query(
    `
    SELECT
      v.*,
      COALESCE(NULLIF(v.image_url, ''), '') AS variant_image_url
    FROM product_variants v
    WHERE v.product_id = $1
      AND ($2::bigint IS NULL OR v.tenant_id = $2::bigint OR v.tenant_id IS NULL)
    ORDER BY v.id ASC
    `,
    [productId, tenantId]
  );

  return { product, variants: variantsResult.rows || [] };
};

const publishAndPersist = async (postId, tenantId) => {
  console.log("[publish] requested channel", { post_id: postId, tenant_id: tenantId });
  const postResult = await db.query(
    `
    SELECT *
    FROM marketing_posts
    WHERE id = $1
      AND tenant_id = $2
    LIMIT 1
    `,
    [postId, tenantId]
  );

  const post = postResult.rows[0];
  if (!post) {
    const error = new Error("Marketing post not found");
    error.status = 404;
    throw error;
  }

  console.log("[publish] saved post channel", { post_id: postId, channel: post.channel || null });
  const settings = await getSettingsRow(tenantId);
  const result = await publishPostService(post, settings);
  await saveLinksForPublishedPost({ post, publishResult: result });

  const updated = await db.query(
    `
    UPDATE marketing_posts
    SET
      status = $1::varchar,
      published_at = $2::timestamp,
      external_post_id = $3::varchar,
      platform_post_id = $4::text,
      platform_publish_results = $5::jsonb,
      error_message = $6::text,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $7::bigint
      AND tenant_id = $8::bigint
    RETURNING *
    `,
    [
      result.status,
      result.published_at,
      result.external_post_id || result.platform_post_id,
      result.platform_post_id || result.external_post_id,
      JSON.stringify(result.platform_publish_results || {}),
      result.error_message,
      postId,
      tenantId,
    ]
  );

  const trackingUpdated = await ensureTrackingForPost(updated.rows[0], {
    kind: "post",
    platform: updated.rows[0]?.channel || post.channel || "facebook",
  });

  return normalizePostRow(trackingUpdated || updated.rows[0]);
};

const persistStoryResult = async (postId, tenantId, result) => {
  const updated = await db.query(
    `
    UPDATE marketing_posts
    SET
      story_status = $1::varchar,
      story_published_at = $2::timestamp,
      story_publish_results = $3::jsonb,
      story_error_message = $4::text,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $5::bigint
      AND tenant_id = $6::bigint
    RETURNING *
    `,
    [
      result.status,
      result.published_at,
      JSON.stringify(result.story_publish_results || {}),
      result.error_message,
      postId,
      tenantId,
    ]
  );
  const trackingUpdated = result.status === "published"
    ? await ensureTrackingForPost(updated.rows[0], {
        kind: "story",
        platform: updated.rows[0]?.channel || "facebook",
      })
    : updated.rows[0];
  return normalizePostRow(trackingUpdated || updated.rows[0]);
};

const publishStoryForRow = async (post, tenantId) => {
  const story = await ensureSafeStoryImageForPost(post, tenantId);
  const settings = await getSettingsRow(tenantId);
  const result = await publishStoryEverywhereService({ story, settings });
  return persistStoryResult(story.id, tenantId, result);
};

const logFastStoryGeneration = async ({ productId, postId, collectedImages, safeImageUrl, source }) => {
  let metadata;
  try {
    metadata = await getStoryImageMetadata(safeImageUrl);
  } catch (error) {
    metadata = { error: error?.message || "metadata unavailable" };
  }
  console.log("[fast-story] generated asset", {
    source,
    product_id: productId || null,
    post_id: postId || null,
    collected_image_count: collectedImages.length,
    collected_image_urls: collectedImages,
    generated_story_file_path: getStoryImageLocalPath(safeImageUrl),
    generated_story_url: safeImageUrl,
    generated_story_public_url: getPublicUploadUrl(safeImageUrl),
    generated_story_metadata: metadata,
  });
};

const assertFastStoryMetadata = (metadata) => {
  if (metadata?.width !== 1080 || metadata?.height !== 1920) {
    const error = new Error("Fast story generation failed: generated story image is not 1080x1920.");
    error.status = 500;
    throw error;
  }
};

const buildGeneratedStoryUrl = async ({ productId, postId = null, tenantId, imageUrls, source }) => {
  const collectedImages = uniqueList(imageUrls || []);
  const generatedStoryUrl = await generateInstagramSafeStoryImage({
    imageUrl: collectedImages[0] || "",
    imageUrls: collectedImages,
    postId: postId || productId,
    tenantId,
  });
  const metadata = await getStoryImageMetadata(generatedStoryUrl);
  assertFastStoryMetadata(metadata);
  const generatedStoryPublicUrl = getPublicUploadUrl(generatedStoryUrl);

  try {
    console.log("[FAST_STORY_HARD_CHECK]", {
      productId: productId || null,
      postId: postId || null,
      source,
      collectedImageCount: collectedImages.length,
      collectedImageUrls: collectedImages,
      generatedStoryPublicUrl,
      finalMediaUrl: generatedStoryPublicUrl,
      metadata,
    });
  } catch (error) {
    console.error("[FAST_STORY_HARD_CHECK] log failed", { error: error?.message });
  }

  await logFastStoryGeneration({
    productId,
    postId,
    collectedImages,
    safeImageUrl: generatedStoryUrl,
    source,
  });

  return { generatedStoryUrl, generatedStoryPublicUrl, collectedImages, metadata };
};

const assertGeneratedStoryFile = async (storyUrl) => {
  const metadata = await getStoryImageMetadata(storyUrl);
  assertFastStoryMetadata(metadata);
  return metadata;
};

const buildProductFastStoryAssets = async ({ product, variants, tenantId, postId = null }) => {
  const selection = getProductStoryImageSelection(product, variants);
  const collectedImages = uniqueList(selection.images);
  if (!collectedImages.length) {
    const error = new Error(
      selection.hasVariantImages
        ? "No in-stock variants available for story generation."
        : selection.productAvailable
          ? "Product has no image for story publishing."
          : "No in-stock variants available for story generation."
    );
    error.status = 400;
    throw error;
  }

  const assets = [];
  const collageUrl = await generateCollageStory({
    product,
    images: collectedImages,
    postId: postId || product.id,
    tenantId,
  });
  assets.push({
    kind: "collage",
    url: collageUrl,
    metadata: await assertGeneratedStoryFile(collageUrl),
  });

  for (const [index, image] of collectedImages.entries()) {
    const singleUrl = await generateSingleProductStory({
      product,
      image,
      postId: `${postId || product.id}-${index + 1}`,
      tenantId,
    });
    assets.push({
      kind: "single",
      sourceImage: image,
      url: singleUrl,
      metadata: await assertGeneratedStoryFile(singleUrl),
    });
  }

  try {
    console.log("[FAST_STORY_HARD_CHECK]", {
      productId: product.id || null,
      postId: postId || null,
      collectedImageCount: collectedImages.length,
      generatedStoryUrls: assets.map((asset) => asset.url),
      finalMediaUrls: assets.map((asset) => getPublicUploadUrl(asset.url)),
      metadata: assets.map((asset) => ({ kind: asset.kind, ...asset.metadata })),
    });
  } catch (error) {
    console.error("[FAST_STORY_HARD_CHECK] log failed", { error: error?.message });
  }

  return { collectedImages, assets };
};

const publishGeneratedStoryAsset = async ({ baseStory, settings, asset }) => {
  const generatedStoryUrl = asset.url;
  const story = {
    ...baseStory,
    image_url: generatedStoryUrl,
    media_urls: [generatedStoryUrl],
    story_type: "product",
    require_generated_story_asset: true,
  };
  return publishStoryEverywhereService({ story, settings });
};

const aggregateFastStoryBatchResult = (results = []) => {
  const publishedCount = results.filter((item) => item.result?.status === "published").length;
  const partialCount = results.filter((item) => item.result?.status === "partial_success").length;
  const successCount = publishedCount + partialCount;
  const status = successCount === results.length ? "published" : successCount > 0 ? "partial_success" : "failed";
  const errorMessage = results
    .filter((item) => item.result?.status !== "published")
    .map((item) => `${item.kind}: ${item.result?.error_message || "Story publish failed"}`)
    .join("; ");
  return {
    status,
    published_at: successCount > 0 ? new Date().toISOString() : null,
    story_publish_results: {
      batch: results.map((item, index) => ({
        index,
        kind: item.kind,
        image_url: item.url,
        metadata: item.metadata,
        result: item.result,
      })),
    },
    error_message: status === "published" ? null : errorMessage,
  };
};

const ensureSafeStoryImageForPost = async (post, tenantId) => {
  let storySourceUrls = [];
  let source = "post-media";

  if (post.product_id) {
    const { product, variants } = await fetchProductBundle(post.product_id, tenantId);
    if (product) {
      const selection = getProductStoryImageSelection(product, variants);
      storySourceUrls = selection.images;
      source = "product-variants";
      if (!storySourceUrls.length && selection.hasVariantImages) {
        const error = new Error("No in-stock variants available for story generation.");
        error.status = 400;
        throw error;
      }
      if (!storySourceUrls.length && !selection.hasVariantImages && !selection.productAvailable) {
        const error = new Error("No in-stock variants available for story generation.");
        error.status = 400;
        throw error;
      }
    }
  }

  if (!storySourceUrls.length) {
    storySourceUrls = normalizeMediaUrls(post.media_urls, post.image_url);
  }

  storySourceUrls = uniqueList(storySourceUrls);
  const { generatedStoryPublicUrl } = await buildGeneratedStoryUrl({
    productId: post.product_id,
    postId: post.id,
    tenantId,
    imageUrls: storySourceUrls,
    source,
  });

  const updated = await db.query(
    `
    UPDATE marketing_posts
    SET
      image_url = $1::text,
      media_urls = $2::jsonb,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3::bigint
      AND tenant_id = $4::bigint
    RETURNING *
    `,
    [generatedStoryPublicUrl, JSON.stringify([generatedStoryPublicUrl]), post.id, tenantId]
  );

  return {
    ...(updated.rows[0] || post),
    image_url: generatedStoryPublicUrl,
    media_urls: [generatedStoryPublicUrl],
    require_generated_story_asset: true,
  };
};

const createProductStoryPost = async (productId, tenantId, overrides = {}) => {
  const { product, variants } = await fetchProductBundle(productId, tenantId);
  if (!product) {
    const error = new Error("Product not found");
    error.status = 404;
    throw error;
  }
  const creative = { ...getProductStoryCreative(product, variants), ...overrides };
  if (!creative.image_url) {
    const error = new Error("Product has no image for story publishing.");
    error.status = 400;
    throw error;
  }
  const { generatedStoryPublicUrl } = await buildGeneratedStoryUrl({
    productId: product.id,
    tenantId,
    imageUrls: uniqueList(creative.media_urls || []),
    source: "product-create",
  });
  const safeMediaUrls = [generatedStoryPublicUrl];
  const result = await db.query(
    `
    INSERT INTO marketing_posts (
      tenant_id,
      product_id,
      title,
      caption,
      hashtags,
      image_url,
      media_urls,
      channel,
      status,
      story_type,
      story_status,
      story_scheduled_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'draft',$9,$10,$11)
    RETURNING *
    `,
    [
      tenantId,
      product.id,
      creative.title,
      creative.caption,
      creative.hashtags,
      generatedStoryPublicUrl,
      JSON.stringify(safeMediaUrls),
      creative.channel || "all",
      creative.story_type || "product",
      creative.story_status || "draft",
      creative.story_scheduled_at || null,
    ]
  );
  return result.rows[0];
};

export const getDashboard = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);

    const [statsResult, recentPostsResult, campaignsResult, settingsRow] = await Promise.all([
      db.query(
        `
        SELECT
          COUNT(*)::int AS total_posts,
          COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled_posts,
          COUNT(*) FILTER (WHERE status = 'published')::int AS published_posts,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_posts,
          COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_posts
        FROM marketing_posts
        WHERE tenant_id = $1
        `,
        [tenantId]
      ),
      db.query(
        `
        SELECT
          mp.*,
          p.name AS product_name,
          c.name AS campaign_name,
          t.name AS template_name
        FROM marketing_posts mp
        LEFT JOIN products p ON p.id = mp.product_id
        LEFT JOIN marketing_campaigns c ON c.id = mp.campaign_id
        LEFT JOIN marketing_post_templates t ON t.id = mp.template_id
        WHERE mp.tenant_id = $1
        ORDER BY mp.created_at DESC
        LIMIT 8
        `,
        [tenantId]
      ),
      db.query(
        `
        SELECT COUNT(*)::int AS active_campaigns
        FROM marketing_campaigns
        WHERE tenant_id = $1
          AND status = 'active'
        `,
        [tenantId]
      ),
      getSettingsRow(tenantId),
    ]);

    res.json({
      success: true,
      data: {
        metrics: {
          ...(statsResult.rows[0] || {}),
          active_campaigns: Number(campaignsResult.rows[0]?.active_campaigns || 0),
        },
        recent_posts: recentPostsResult.rows.map(normalizePostRow),
        settings: settingsRow ? normalizeSettingsRow(settingsRow) : null,
      },
    });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load dashboard" });
  }
};

export const getCampaigns = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      SELECT *
      FROM marketing_campaigns
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      `,
      [tenantId]
    );
    res.json({ success: true, data: result.rows.map(normalizeCampaignRow) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load campaigns" });
  }
};

export const createCampaign = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const { name, description = "", status = "draft", start_date = null, end_date = null, budget = 0 } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: "Campaign name is required" });
    const result = await db.query(
      `
      INSERT INTO marketing_campaigns (tenant_id, name, description, status, start_date, end_date, budget)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [tenantId, name, description, status, start_date || null, end_date || null, budget || 0]
    );
    res.status(201).json({ success: true, data: normalizeCampaignRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create campaign" });
  }
};

export const updateCampaign = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const { id } = req.params;
    const { name, description = "", status = "draft", start_date = null, end_date = null, budget = 0 } = req.body || {};
    const result = await db.query(
      `
      UPDATE marketing_campaigns
      SET name = $1, description = $2, status = $3, start_date = $4, end_date = $5, budget = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 AND tenant_id = $8
      RETURNING *
      `,
      [name, description, status, start_date || null, end_date || null, budget || 0, id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Campaign not found" });
    res.json({ success: true, data: normalizeCampaignRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update campaign" });
  }
};

export const deleteCampaign = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      DELETE FROM marketing_campaigns
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
      `,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Campaign not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete campaign" });
  }
};

export const getTemplates = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      SELECT *
      FROM marketing_post_templates
      WHERE tenant_id = $1
      ORDER BY is_default DESC, created_at DESC
      `,
      [tenantId]
    );
    res.json({ success: true, data: result.rows.map(normalizeTemplateRow) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load templates" });
  }
};

export const createTemplate = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const { name, channel = "facebook", title_template = "", caption_template = "", hashtags = "", is_default = false } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: "Template name is required" });
    if (is_default) {
      await db.query(`UPDATE marketing_post_templates SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1`, [tenantId]);
    }
    const result = await db.query(
      `
      INSERT INTO marketing_post_templates (tenant_id, name, channel, title_template, caption_template, hashtags, is_default)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [tenantId, name, channel, title_template, caption_template, hashtags, Boolean(is_default)]
    );
    res.status(201).json({ success: true, data: normalizeTemplateRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create template" });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const { id } = req.params;
    const { name, channel = "facebook", title_template = "", caption_template = "", hashtags = "", is_default = false } = req.body || {};
    if (is_default) {
      await db.query(`UPDATE marketing_post_templates SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id <> $2`, [tenantId, id]);
    }
    const result = await db.query(
      `
      UPDATE marketing_post_templates
      SET name = $1, channel = $2, title_template = $3, caption_template = $4, hashtags = $5, is_default = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 AND tenant_id = $8
      RETURNING *
      `,
      [name, channel, title_template, caption_template, hashtags, Boolean(is_default), id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, data: normalizeTemplateRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update template" });
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      DELETE FROM marketing_post_templates
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
      `,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete template" });
  }
};

export const getPosts = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const { status = "", channel = "", search = "" } = req.query || {};
    const params = [tenantId];
    const clauses = ["mp.tenant_id = $1"];
    if (status) {
      params.push(status);
      clauses.push(`mp.status = $${params.length}`);
    }
    if (channel) {
      params.push(channel);
      clauses.push(`mp.channel = $${params.length}`);
    }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      clauses.push(`(mp.title ILIKE $${params.length} OR mp.caption ILIKE $${params.length})`);
    }
    const result = await db.query(
      `
      SELECT
        mp.*,
        p.name AS product_name,
        c.name AS campaign_name,
        t.name AS template_name
      FROM marketing_posts mp
      LEFT JOIN products p ON p.id = mp.product_id
      LEFT JOIN marketing_campaigns c ON c.id = mp.campaign_id
      LEFT JOIN marketing_post_templates t ON t.id = mp.template_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY mp.created_at DESC
      `,
      params
    );
    res.json({ success: true, data: result.rows.map(normalizePostRow) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load posts" });
  }
};

export const getPostById = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      SELECT
        mp.*,
        p.name AS product_name,
        c.name AS campaign_name,
        t.name AS template_name
      FROM marketing_posts mp
      LEFT JOIN products p ON p.id = mp.product_id
      LEFT JOIN marketing_campaigns c ON c.id = mp.campaign_id
      LEFT JOIN marketing_post_templates t ON t.id = mp.template_id
      WHERE mp.id = $1 AND mp.tenant_id = $2
      LIMIT 1
      `,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Post not found" });
    res.json({ success: true, data: normalizePostRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load post" });
  }
};

export const createPost = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    const result = await db.query(
      `
      INSERT INTO marketing_posts (
        tenant_id,
        product_id,
        campaign_id,
        template_id,
        title,
        caption,
        hashtags,
        image_url,
        media_urls,
        channel,
        status,
        scheduled_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
      RETURNING *
      `,
      [
        tenantId,
        payload.product_id || null,
        payload.campaign_id || null,
        payload.template_id || null,
        payload.title || "",
        payload.caption || "",
        payload.hashtags || "",
        payload.image_url || "",
        JSON.stringify(normalizeMediaUrls(payload.media_urls, payload.image_url)),
        payload.channel || "facebook",
        payload.status || "draft",
        payload.scheduled_at || null,
      ]
    );
    res.status(201).json({ success: true, data: normalizePostRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create post" });
  }
};

export const updatePost = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    const result = await db.query(
      `
      UPDATE marketing_posts
      SET
        product_id = $1,
        campaign_id = $2,
        template_id = $3,
        title = $4,
        caption = $5,
        hashtags = $6,
        image_url = $7,
        media_urls = $8::jsonb,
        channel = $9,
        status = $10,
        scheduled_at = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12 AND tenant_id = $13
      RETURNING *
      `,
      [
        payload.product_id || null,
        payload.campaign_id || null,
        payload.template_id || null,
        payload.title || "",
        payload.caption || "",
        payload.hashtags || "",
        payload.image_url || "",
        JSON.stringify(normalizeMediaUrls(payload.media_urls, payload.image_url)),
        payload.channel || "facebook",
        payload.status || "draft",
        payload.scheduled_at || null,
        req.params.id,
        tenantId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Post not found" });
    res.json({ success: true, data: normalizePostRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update post" });
  }
};

export const deletePost = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      DELETE FROM marketing_posts
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
      `,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Post not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete post" });
  }
};

export const generateProductPost = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const { product, variants } = await fetchProductBundle(req.params.productId, tenantId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const generated = resolveProductPostData(product, variants);
    if (!generated.media_urls.length) {
      return res.status(400).json({ success: false, message: "No variant images found for this product." });
    }

    const result = await db.query(
      `
      INSERT INTO marketing_posts (
        tenant_id,
        product_id,
        title,
        caption,
        hashtags,
        image_url,
        media_urls,
        channel,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'draft')
      RETURNING *
      `,
      [tenantId, product.id, generated.title, generated.caption, generated.hashtags, generated.image_url, JSON.stringify(generated.media_urls), generated.channel]
    );

    res.status(201).json({
      success: true,
      data: normalizePostRow({
        ...result.rows[0],
        product_name: product.name,
      }),
      product,
      variants,
    });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to generate post" });
  }
};

export const publishMarketingPost = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await publishAndPersist(req.params.postId, tenantId);
    const platformResults = result.platform_publish_results || {};
    const facebookPublished = platformResults.facebook?.status === "published";
    const instagramPublished = platformResults.instagram?.status === "published";
    const message =
      facebookPublished && instagramPublished
        ? "Published to Facebook and Instagram"
        : facebookPublished && platformResults.instagram
          ? "Facebook published, Instagram failed"
          : instagramPublished && platformResults.facebook
            ? "Instagram published, Facebook failed"
            : result.error_message || `Meta published successfully: ${result.platform_post_id || result.external_post_id}`;
    res.json({
      success: result.status === "published",
      message,
      data: result,
    });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to publish post" });
  }
};

export const testFacebookPublish = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const settings = await getSettingsRow(tenantId);
    const message = nullableString(req.body?.message) || "Test post from ERP";
    const metaResponse = await publishFacebookText({ message, settings });
    res.json({ success: true, data: metaResponse });
  } catch (error) {
    console.error("[marketing] test Facebook publish error", {
      message: error?.message,
      status: error?.status,
      metaResponse: error?.metaResponse,
      stack: error?.stack,
    });
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Meta publish failed",
      error: error?.metaResponse || null,
    });
  }
};

export const scheduleMarketingPost = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const scheduledAt = req.body?.scheduled_at || req.body?.scheduledAt || null;
    const result = await db.query(
      `
      UPDATE marketing_posts
      SET status = 'scheduled', scheduled_at = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND tenant_id = $3
      RETURNING *
      `,
      [scheduledAt, req.params.postId, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Post not found" });
    res.json({ success: true, data: normalizePostRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to schedule post" });
  }
};

export const publishStoryForPost = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      SELECT *
      FROM marketing_posts
      WHERE id = $1::bigint
        AND tenant_id = $2::bigint
      LIMIT 1
      `,
      [req.params.postId, tenantId]
    );
    const post = result.rows[0];
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    const updated = await publishStoryForRow(post, tenantId);
    res.json({ success: updated.story_status === "published", data: updated, message: updated.story_error_message || "Story publish completed" });
  } catch (error) {
    console.error("[story] publish post error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to publish story" });
  }
};

export const scheduleStoryForPost = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const scheduledAt = req.body?.scheduled_at || req.body?.story_scheduled_at || null;
    if (!scheduledAt) return res.status(400).json({ success: false, message: "scheduled_at is required" });
    const result = await db.query(
      `
      UPDATE marketing_posts
      SET
        story_status = 'scheduled',
        story_type = COALESCE(NULLIF($1::varchar, ''), story_type),
        story_scheduled_at = $2::timestamp,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3::bigint
        AND tenant_id = $4::bigint
      RETURNING *
      `,
      [req.body?.story_type || "story", scheduledAt, req.params.postId, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Post not found" });
    res.json({ success: true, data: normalizePostRow(result.rows[0]), message: "Story scheduled" });
  } catch (error) {
    console.error("[story] schedule post error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to schedule story" });
  }
};

export const publishStoryForProduct = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const { product, variants } = await fetchProductBundle(req.params.productId, tenantId);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const { collectedImages, assets } = await buildProductFastStoryAssets({
      product,
      variants,
      tenantId,
    });
    const creative = getProductStoryCreative(product, variants);
    const firstAsset = assets[0];
    const rowResult = await db.query(
      `
      INSERT INTO marketing_posts (
        tenant_id,
        product_id,
        title,
        caption,
        hashtags,
        image_url,
        media_urls,
        channel,
        status,
        story_type,
        story_status,
        story_scheduled_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'draft','product','draft',NULL)
      RETURNING *
      `,
      [
        tenantId,
        product.id,
        product.name || creative.title || "Product Story",
        product.name || creative.title || "",
        creative.hashtags,
        firstAsset.url,
        JSON.stringify([firstAsset.url]),
        "all",
      ]
    );
    const row = rowResult.rows[0];
    const settings = await getSettingsRow(tenantId);
    const results = [];
    for (const asset of assets) {
      const result = await publishGeneratedStoryAsset({
        baseStory: row,
        settings,
        asset,
      });
      results.push({
        kind: asset.kind,
        url: asset.url,
        metadata: asset.metadata,
        result,
      });
    }
    const publishResult = aggregateFastStoryBatchResult(results);
    console.log("[fast-story] published batch", {
      product_id: product.id,
      post_id: row.id,
      collected_image_count: collectedImages.length,
      story_count: assets.length,
      story_urls: assets.map((asset) => asset.url),
      status: publishResult.status,
    });
    const updated = await persistStoryResult(row.id, tenantId, publishResult);
    res.status(201).json({ success: updated.story_status === "published", data: updated, message: updated.story_error_message || "Story publish completed" });
  } catch (error) {
    console.error("[story] publish product error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to publish product story" });
  }
};

export const scheduleStoryForProduct = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const scheduledAt = req.body?.scheduled_at || req.body?.story_scheduled_at || null;
    if (!scheduledAt) return res.status(400).json({ success: false, message: "scheduled_at is required" });
    const row = await createProductStoryPost(req.params.productId, tenantId, {
      ...(req.body || {}),
      story_status: "scheduled",
      story_scheduled_at: scheduledAt,
    });
    res.status(201).json({ success: true, data: normalizePostRow(row), message: "Story scheduled" });
  } catch (error) {
    console.error("[story] schedule product error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to schedule product story" });
  }
};

let storySchedulerRunning = false;

export const runDueStoryPublishes = async () => {
  if (storySchedulerRunning) return;
  storySchedulerRunning = true;
  try {
    await ensureMarketingSchema();
    const due = await db.query(
      `
      SELECT *
      FROM marketing_posts
      WHERE story_status = 'scheduled'
        AND story_scheduled_at <= CURRENT_TIMESTAMP
      ORDER BY story_scheduled_at ASC
      LIMIT 10
      `
    );
    for (const post of due.rows) {
      try {
        await db.query(
          `
          UPDATE marketing_posts
          SET story_status = 'publishing', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::bigint AND story_status = 'scheduled'
          `,
          [post.id]
        );
        await publishStoryForRow(post, post.tenant_id);
      } catch (error) {
        console.error("[story-scheduler] publish error", { post_id: post.id, error: error?.message });
        await db.query(
          `
          UPDATE marketing_posts
          SET story_status = 'failed', story_error_message = $1::text, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2::bigint
          `,
          [error?.message || "Scheduled story publish failed", post.id]
        );
      }
    }
  } catch (error) {
    console.error("[story-scheduler] scan error", error);
  } finally {
    storySchedulerRunning = false;
  }
};

export const getCommentDmRules = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      SELECT *
      FROM marketing_comment_dm_rules
      WHERE tenant_id = $1::bigint
      ORDER BY is_active DESC, created_at DESC
      `,
      [tenantId]
    );
    res.json({ success: true, data: result.rows.map(normalizeCommentDmRuleRow) });
  } catch (error) {
    console.error("[comment-dm] rules load error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load Comment-to-DM rules" });
  }
};

export const verifyMetaMarketingWebhook = async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || "";

  if (mode === "subscribe" && expectedToken && token === expectedToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
};

export const receiveMetaMarketingWebhook = async (req, res) => {
  try {
    const signature = verifyMetaSignature(req);
    if (!signature.valid) {
      console.warn("[meta-webhook] invalid signature rejected", { reason: signature.reason });
      return res.status(401).json({ success: false, message: "Invalid Meta webhook signature" });
    }

    await ensureMarketingSchema();
    const result = await processMetaWebhookPayload(req.body || {});
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("[meta-webhook] processing error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to process Meta webhook" });
  }
};

export const getAutoReplyRules = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const rows = await getMarketingAutoReplyRules(tenantId);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("[marketing-auto-reply] rules load error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load auto reply rules" });
  }
};

export const createAutoReplyRule = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const row = await createMarketingAutoReplyRule(tenantId, req.body || {});
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("[marketing-auto-reply] rule create error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create auto reply rule" });
  }
};

export const updateAutoReplyRule = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const row = await updateMarketingAutoReplyRule(tenantId, req.params.id, req.body || {});
    if (!row) return res.status(404).json({ success: false, message: "Auto reply rule not found" });
    res.json({ success: true, data: row });
  } catch (error) {
    console.error("[marketing-auto-reply] rule update error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update auto reply rule" });
  }
};

export const deleteAutoReplyRule = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const row = await deleteMarketingAutoReplyRule(tenantId, req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Auto reply rule not found" });
    res.json({ success: true, data: row });
  } catch (error) {
    console.error("[marketing-auto-reply] rule delete error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete auto reply rule" });
  }
};

export const simulateAutomationComment = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    if (!nullableString(payload.message)) {
      return res.status(400).json({ success: false, message: "message is required" });
    }
    const result = await simulateMarketingCommentAutomation(tenantId, payload);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error("[marketing-auto-reply] simulate comment error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to simulate comment" });
  }
};

export const getCommentEvents = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const rows = await getMarketingCommentEvents(tenantId);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("[marketing-auto-reply] events load error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load comment events" });
  }
};

export const getMarketingConversations = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const rows = await getMarketingLeadConversations(tenantId);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("[marketing-auto-reply] conversations load error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load marketing conversations" });
  }
};

export const getMetaWebhookStatus = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const status = await getMarketingMetaWebhookStatus(tenantId);
    res.json({ success: true, data: status });
  } catch (error) {
    console.error("[meta-webhook] status load error", error);
    res.json({
      success: true,
      data: {
        verify_token_configured: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN),
        signature_validation_enabled: Boolean(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET),
        last_event_at: null,
        recent_payload_preview: null,
        webhook_url: process.env.PUBLIC_BACKEND_URL
          ? `${String(process.env.PUBLIC_BACKEND_URL).replace(/\/+$/g, "")}/api/marketing/webhooks/meta`
          : "/api/marketing/webhooks/meta",
      },
    });
  }
};

export const createCommentDmRule = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    const name = nullableString(payload.name);
    const responseMessage = nullableString(payload.response_message);
    if (!name) return res.status(400).json({ success: false, message: "Rule name is required" });
    if (!responseMessage) return res.status(400).json({ success: false, message: "Response message is required" });

    const result = await db.query(
      `
      INSERT INTO marketing_comment_dm_rules (
        tenant_id,
        name,
        platform,
        post_id,
        platform_post_id,
        trigger_keywords,
        excluded_keywords,
        match_mode,
        response_message,
        is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
      RETURNING *
      `,
      [
        tenantId,
        name,
        payload.platform || "facebook",
        payload.post_id || null,
        nullableString(payload.platform_post_id),
        JSON.stringify(normalizeKeywords(payload.trigger_keywords)),
        JSON.stringify(normalizeKeywords(payload.excluded_keywords)),
        payload.match_mode || "any",
        responseMessage,
        parseBoolean(payload.is_active, true),
      ]
    );
    res.status(201).json({ success: true, data: normalizeCommentDmRuleRow(result.rows[0]) });
  } catch (error) {
    console.error("[comment-dm] rule create error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create Comment-to-DM rule" });
  }
};

export const updateCommentDmRule = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    const name = nullableString(payload.name);
    const responseMessage = nullableString(payload.response_message);
    if (!name) return res.status(400).json({ success: false, message: "Rule name is required" });
    if (!responseMessage) return res.status(400).json({ success: false, message: "Response message is required" });

    const result = await db.query(
      `
      UPDATE marketing_comment_dm_rules
      SET
        name = $1::varchar,
        platform = $2::varchar,
        post_id = $3::bigint,
        platform_post_id = $4::text,
        trigger_keywords = $5::jsonb,
        excluded_keywords = $6::jsonb,
        match_mode = $7::varchar,
        response_message = $8::text,
        is_active = $9::boolean,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10::bigint
        AND tenant_id = $11::bigint
      RETURNING *
      `,
      [
        name,
        payload.platform || "facebook",
        payload.post_id || null,
        nullableString(payload.platform_post_id),
        JSON.stringify(normalizeKeywords(payload.trigger_keywords)),
        JSON.stringify(normalizeKeywords(payload.excluded_keywords)),
        payload.match_mode || "any",
        responseMessage,
        parseBoolean(payload.is_active, true),
        req.params.id,
        tenantId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Comment-to-DM rule not found" });
    res.json({ success: true, data: normalizeCommentDmRuleRow(result.rows[0]) });
  } catch (error) {
    console.error("[comment-dm] rule update error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update Comment-to-DM rule" });
  }
};

export const deleteCommentDmRule = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      DELETE FROM marketing_comment_dm_rules
      WHERE id = $1::bigint
        AND tenant_id = $2::bigint
      RETURNING id
      `,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Comment-to-DM rule not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("[comment-dm] rule delete error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete Comment-to-DM rule" });
  }
};

export const getCommentDmLogs = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      SELECT *
      FROM marketing_comment_dm_logs
      WHERE tenant_id = $1::bigint
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [tenantId]
    );
    res.json({ success: true, data: result.rows.map(normalizeCommentDmLogRow) });
  } catch (error) {
    console.error("[comment-dm] logs load error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load Comment-to-DM logs" });
  }
};

export const testCommentDmRule = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const ruleResult = await db.query(
      `
      SELECT *
      FROM marketing_comment_dm_rules
      WHERE id = $1::bigint
        AND tenant_id = $2::bigint
      LIMIT 1
      `,
      [req.params.id, tenantId]
    );
    const rule = ruleResult.rows[0];
    if (!rule) return res.status(404).json({ success: false, message: "Comment-to-DM rule not found" });

    const context = {
      commenter_name: req.body?.commenter_name || "Customer",
      comment_text: req.body?.comment_text || "",
      post_id: req.body?.post_id || rule.post_id || "",
    };
    res.json({
      success: true,
      data: {
        matched: commentMatchesRule(rule, context.comment_text),
        message: renderCommentDmMessage(rule.response_message, context),
      },
    });
  } catch (error) {
    console.error("[comment-dm] rule test error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to test Comment-to-DM rule" });
  }
};

export const processCommentDmAutomation = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    const platform = nullableString(payload.platform) || "facebook";
    const platformCommentId = nullableString(payload.platform_comment_id || payload.comment_id);
    const commentText = nullableString(payload.comment_text || payload.message) || "";
    const platformPostId = nullableString(payload.platform_post_id || payload.external_post_id);
    const postId = payload.post_id || null;

    if (!platformCommentId) return res.status(400).json({ success: false, message: "platform_comment_id is required" });
    if (!commentText) return res.status(400).json({ success: false, message: "comment_text is required" });

    const existing = await db.query(
      `
      SELECT *
      FROM marketing_comment_dm_logs
      WHERE tenant_id = $1::bigint
        AND platform = $2::varchar
        AND platform_comment_id = $3::text
      LIMIT 1
      `,
      [tenantId, platform, platformCommentId]
    );
    if (existing.rows[0]) {
      return res.json({ success: true, skipped: true, reason: "already_processed", data: normalizeCommentDmLogRow(existing.rows[0]) });
    }

    const rulesResult = await db.query(
      `
      SELECT *
      FROM marketing_comment_dm_rules
      WHERE tenant_id = $1::bigint
        AND is_active = TRUE
        AND platform = $2::varchar
        AND ($3::bigint IS NULL OR post_id IS NULL OR post_id = $3::bigint)
        AND ($4::text IS NULL OR platform_post_id IS NULL OR platform_post_id = '' OR platform_post_id = $4::text)
      ORDER BY post_id NULLS LAST, platform_post_id NULLS LAST, created_at DESC
      `,
      [tenantId, platform, postId, platformPostId]
    );
    const rule = rulesResult.rows.find((candidate) => commentMatchesRule(candidate, commentText));
    if (!rule) {
      return res.json({ success: true, skipped: true, reason: "no_matching_rule" });
    }

    const responseMessage = renderCommentDmMessage(rule.response_message, {
      commenter_name: payload.commenter_name || "Customer",
      comment_text: commentText,
      post_id: postId || "",
    });

    let status = "sent";
    let errorMessage = null;
    let metaResponse = {};
    try {
      const settings = await getSettingsRow(tenantId);
      metaResponse = await sendCommentPrivateReply({
        commentId: platformCommentId,
        message: responseMessage,
        settings,
      });
    } catch (sendError) {
      status = "failed";
      errorMessage = sendError?.message || "Failed to send automated DM";
      metaResponse = sendError?.metaResponse || {};
    }

    const inserted = await db.query(
      `
      INSERT INTO marketing_comment_dm_logs (
        tenant_id,
        rule_id,
        post_id,
        platform,
        platform_post_id,
        platform_comment_id,
        commenter_id,
        commenter_name,
        comment_text,
        response_message,
        status,
        error_message,
        meta_response
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
      ON CONFLICT (tenant_id, platform, platform_comment_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        error_message = EXCLUDED.error_message,
        meta_response = EXCLUDED.meta_response,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [
        tenantId,
        rule.id,
        postId,
        platform,
        platformPostId,
        platformCommentId,
        nullableString(payload.commenter_id),
        nullableString(payload.commenter_name),
        commentText,
        responseMessage,
        status,
        errorMessage,
        JSON.stringify(metaResponse || {}),
      ]
    );

    await db.query(`UPDATE marketing_comment_dm_rules SET last_checked_at = CURRENT_TIMESTAMP WHERE id = $1::bigint`, [rule.id]);
    res.status(status === "sent" ? 201 : 502).json({ success: status === "sent", data: normalizeCommentDmLogRow(inserted.rows[0]) });
  } catch (error) {
    console.error("[comment-dm] process error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to process Comment-to-DM automation" });
  }
};

export const getSettings = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const row = await getSettingsRow(tenantId);
    res.json({ success: true, data: row ? normalizeSettingsRow(row) : null });
  } catch (error) {
    console.error("[marketing] request error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load settings" });
  }
};

export const updateSettings = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ success: false, message: "Invalid settings payload" });
    }

    const provider = nullableString(payload.provider ?? "meta");
    const pageId = nullableString(payload.facebook_page_id ?? payload.page_id);
    const instagramAccountId = optionalNullableString(payload.instagram_account_id);
    const tokenValue = optionalNullableString(payload.access_token ?? payload.access_token_encrypted);
    const isConnected = Boolean(payload.is_connected);

    if (!provider) {
      return res.status(400).json({ success: false, message: "Provider is required" });
    }

    await ensureSettingsRow(tenantId);

    let tokenData = null;
    if (tokenValue) {
      try {
        tokenData = await refreshMetaTokens({
          shortLivedUserToken: tokenValue,
          pageId,
        });
      } catch (tokenError) {
        console.error("[marketing] Meta token refresh failed during settings save", {
          tenantId,
          pageId,
          message: tokenError?.message,
          status: tokenError?.status,
          metaResponse: tokenError?.metaResponse || null,
        });
        await db.query(
          `
          UPDATE marketing_settings
          SET
            provider = $1::varchar,
            page_id = $2::text,
            instagram_account_id = $3::text,
            token_status = 'error'::varchar,
            token_error_message = $4::text,
            updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $5::bigint
          `,
          [provider, pageId, instagramAccountId, tokenError?.message || "Meta token refresh failed", tenantId]
        );
        return res.status(tokenError.status || 400).json({
          success: false,
          message: tokenError.message || "Meta token refresh failed",
          error: tokenError?.metaResponse || null,
        });
      }
    }

    const result = await db.query(
      `
      UPDATE marketing_settings
      SET
        provider = $1::varchar,
        page_id = $2::text,
        instagram_account_id = $3::text,
        access_token_encrypted = CASE
          WHEN $4::text IS NULL THEN access_token_encrypted
          ELSE $4::text
        END,
        long_lived_user_token = CASE
          WHEN $5::text IS NULL THEN long_lived_user_token
          ELSE $5::text
        END,
        page_access_token = CASE
          WHEN $6::text IS NULL THEN page_access_token
          ELSE $6::text
        END,
        token_expires_at = CASE
          WHEN $7::timestamp IS NULL THEN token_expires_at
          ELSE $7::timestamp
        END,
        token_status = CASE
          WHEN $8::varchar IS NULL THEN token_status
          ELSE $8::varchar
        END,
        token_last_validated_at = CASE
          WHEN $9::boolean THEN CURRENT_TIMESTAMP
          ELSE token_last_validated_at
        END,
        token_error_message = CASE
          WHEN $9::boolean THEN NULL::text
          ELSE token_error_message
        END,
        next_refresh_check_at = CASE
          WHEN $10::boolean THEN CURRENT_TIMESTAMP + INTERVAL '24 hours'
          ELSE next_refresh_check_at
        END,
        is_connected = $11::boolean,
        updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $12::bigint
      RETURNING *
      `,
      [
        provider,
        tokenData?.pageId || pageId,
        instagramAccountId,
        tokenData?.pageAccessToken || null,
        tokenData?.longLivedUserToken || null,
        tokenData?.pageAccessToken || null,
        tokenData?.tokenExpiresAt || null,
        tokenData ? "active" : null,
        Boolean(tokenData),
        Boolean(tokenData),
        Boolean(isConnected || tokenData?.pageAccessToken),
        tenantId,
      ]
    );

    if (!result.rows[0]) {
      console.error("[marketing] settings update returned no row", { tenantId });
      return res.status(404).json({ success: false, message: "Marketing settings row not found" });
    }

    res.json({ success: true, data: normalizeSettingsRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] settings update error", {
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      stack: error?.stack,
    });
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update settings" });
  }
};

export const refreshSettingsTokens = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    const current = await getSettingsRow(tenantId);

    const pageId = nullableString(payload.facebook_page_id ?? payload.page_id ?? current?.page_id);
    const shortLivedUserToken = optionalNullableString(payload.access_token ?? payload.access_token_encrypted);
    const existingLongLivedToken = optionalNullableString(current?.long_lived_user_token);

    const tokenData = await refreshMetaTokens({
      shortLivedUserToken,
      longLivedUserToken: shortLivedUserToken ? null : existingLongLivedToken,
      pageId,
    });

    const result = await db.query(
      `
      UPDATE marketing_settings
      SET
        page_id = $1::text,
        access_token_encrypted = $2::text,
        long_lived_user_token = $3::text,
        page_access_token = $4::text,
        token_expires_at = CASE
          WHEN $5::timestamp IS NULL THEN token_expires_at
          ELSE $5::timestamp
        END,
        token_status = 'active'::varchar,
        token_last_validated_at = CURRENT_TIMESTAMP,
        token_error_message = NULL::text,
        is_connected = TRUE,
        next_refresh_check_at = CURRENT_TIMESTAMP + INTERVAL '24 hours',
        updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $6::bigint
      RETURNING *
      `,
      [
        tokenData.pageId,
        tokenData.pageAccessToken,
        tokenData.longLivedUserToken,
        tokenData.pageAccessToken,
        tokenData.tokenExpiresAt || null,
        tenantId,
      ]
    );

    res.json({ success: true, data: normalizeSettingsRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing] Meta token reconnect error", {
      message: error?.message,
      status: error?.status,
      metaResponse: error?.metaResponse || null,
      stack: error?.stack,
    });
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to reconnect Meta tokens",
      error: error?.metaResponse || null,
    });
  }
};

export const testAutoRefreshSettings = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const current = await getSettingsRow(tenantId);
    if (!current) {
      return res.status(404).json({ success: false, message: "Marketing settings row not found" });
    }

    const result = await refreshMarketingTenantMetaToken({
      tenantId,
      force: true,
      source: "manual-test",
    });

    const updated = await getSettingsRow(tenantId);
    res.json({
      success: true,
      skipped: Boolean(result?.skipped),
      reason: result?.reason || null,
      data: normalizeSettingsRow(updated || current),
    });
  } catch (error) {
    console.error("[marketing] Meta auto refresh test error", {
      message: error?.message,
      status: error?.status,
      metaResponse: error?.metaResponse || null,
      stack: error?.stack,
    });
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to test auto refresh",
      error: error?.metaResponse || null,
    });
  }
};
