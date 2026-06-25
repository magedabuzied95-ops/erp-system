import db from "../database/db.js";
import crypto from "crypto";
import { getTenantId } from "../utils/requestScope.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { enqueueJob, registerJobHandler } from "../services/jobQueueService.js";
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
import { ensureProductVariantImagesSchema } from "../services/productVariantImagesService.js";
import {
  commentMatchesRule,
  normalizeKeywords,
  renderCommentDmMessage,
  sendCommentPrivateReply,
} from "../services/commentDmAutomationService.js";
import { processMetaWebhook } from "../services/metaIntegrationService.js";
import {
  createAutoReplyRule as createMarketingAutoReplyRule,
  deleteAutoReplyRule as deleteMarketingAutoReplyRule,
  getAutoReplyRules as getMarketingAutoReplyRules,
  getCommentEvents as getMarketingCommentEvents,
  getMarketingConversations as getMarketingLeadConversations,
  getMetaWebhookStatus as getMarketingMetaWebhookStatus,
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

const TIKTOK_PUBLISHING_NOT_CONNECTED_MESSAGE = "TikTok publishing is not connected yet.";
const DISABLED_MARKETING_CHANNELS = new Set(["tiktok"]);

const assertMarketingChannelIsEnabled = (channel = "") => {
  const normalized = String(channel || "").trim().toLowerCase();
  if (DISABLED_MARKETING_CHANNELS.has(normalized)) {
    const error = new Error(TIKTOK_PUBLISHING_NOT_CONNECTED_MESSAGE);
    error.status = 400;
    throw error;
  }
};

const CONTENT_DRAFT_STATUSES = new Set(["draft", "pending_approval", "approved", "scheduled", "published", "failed", "rejected"]);

const normalizePlatforms = (value) => {
  const parsed = safeJson(value, Array.isArray(value) ? value : []);
  const platforms = uniqueList(parsed.length ? parsed : String(value || "").split(","));
  const allowed = platforms
    .map((platform) => String(platform || "").trim().toLowerCase())
    .filter((platform) => ["facebook", "instagram"].includes(platform));
  return allowed.length ? allowed : ["facebook", "instagram"];
};

const normalizeContentDraftRow = (row = {}) => {
  const mediaUrls = normalizeMediaUrls(row.media_urls, "");
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    product_id: row.product_id ?? null,
    product_name: row.product_name || "",
    content_type: row.content_type || "Feed Post",
    tone: row.tone || "Luxury",
    platforms: normalizePlatforms(row.platforms),
    title: row.title || "",
    caption: row.caption || "",
    hook: row.hook || "",
    body: row.body || "",
    hashtags: row.hashtags || "",
    image_url: mediaUrls[0] || "",
    media_urls: mediaUrls,
    status: row.status || "draft",
    scheduled_at: row.scheduled_at || null,
    published_at: row.published_at || null,
    rejected_at: row.rejected_at || null,
    error_message: row.error_message || null,
    created_by: row.created_by ?? null,
    approved_by: row.approved_by ?? null,
    rejected_by: row.rejected_by ?? null,
    ai_metadata: safeJsonObject(row.ai_metadata, {}),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
};

const contentTypeToChannel = (contentType, platforms = []) => {
  const normalizedPlatforms = normalizePlatforms(platforms);
  if (normalizedPlatforms.length > 1) return "all";
  return normalizedPlatforms[0] || "facebook";
};

const assertDraftMedia = (draft = {}) => {
  const mediaUrls = normalizeMediaUrls(draft.media_urls, "");
  if (!mediaUrls.length) {
    const error = new Error("Add media before publishing or scheduling this draft.");
    error.status = 400;
    throw error;
  }
  return mediaUrls;
};

const draftToPostPayload = (draft = {}) => {
  const mediaUrls = assertDraftMedia(draft);
  return {
    product_id: draft.product_id || null,
    title: draft.title || draft.product_name || "Marketing content",
    caption: draft.caption || draft.body || draft.hook || "",
    hashtags: draft.hashtags || "",
    image_url: mediaUrls[0] || "",
    media_urls: mediaUrls,
    channel: contentTypeToChannel(draft.content_type, draft.platforms),
    status: "draft",
  };
};

const createPostFromDraft = async (draft = {}, tenantId) => {
  const payload = draftToPostPayload(draft);
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
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
    RETURNING *
    `,
    [
      tenantId,
      payload.product_id,
      payload.title,
      payload.caption,
      payload.hashtags,
      payload.image_url,
      JSON.stringify(payload.media_urls),
      payload.channel,
      payload.status,
    ]
  );
  return normalizePostRow(result.rows[0]);
};

const getContentDraftRow = async (draftId, tenantId) => {
  const result = await db.query(
    `
    SELECT d.*, p.name AS product_name
    FROM marketing_content_drafts d
    LEFT JOIN products p ON p.id = d.product_id
    WHERE d.id = $1::bigint
      AND d.tenant_id = $2::bigint
    LIMIT 1
    `,
    [draftId, tenantId]
  );
  return result.rows[0] || null;
};

const WEEKLY_PACK_RULES = {
  light: ["Feed Post", "Feed Post", "Story"],
  balanced: ["Feed Post", "Feed Post", "Story", "Story", "Reel Script", "Ad Copy"],
  aggressive: ["Feed Post", "Feed Post", "Feed Post", "Story", "Story", "Story", "Reel Script", "Reel Script", "Ad Copy", "Ad Copy"],
};

const WEEKLY_PACK_TIMES = {
  "Feed Post": ["12:00", "20:00"],
  Story: ["16:00", "21:00"],
  "Reel Script": ["19:00", "22:00"],
  "Ad Copy": ["18:00"],
};

const parseWeekStart = (value) => {
  const raw = nullableString(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatLocalDateTime = (date, time) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${time}:00`;
};

const loadWeeklyPackCandidates = async (tenantId) => {
  const [productColumns, variantColumns] = await Promise.all([
    getTableColumns("products"),
    getTableColumns("product_variants"),
  ]);
  if (!productColumns.has("id") || !productColumns.has("tenant_id") || !productColumns.has("name")) return [];

  const activeProductSql = productColumns.has("status")
    ? "COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive','disabled','archived','deleted','draft')"
    : "TRUE";
  const productCreatedExpr = productColumns.has("created_at") ? "p.created_at" : "CURRENT_TIMESTAMP";
  const productImageBase = productColumns.has("image_url") ? "NULLIF(p.image_url, '')" : "NULL";
  const hasVariants = variantColumns.has("product_id") && variantColumns.has("stock");
  const productStockExpr = productColumns.has("stock") ? "COALESCE(p.stock, 0)" : "0";
  const thresholdExpr = productColumns.has("low_stock_alert") ? "GREATEST(COALESCE(NULLIF(p.low_stock_alert, 0), 0), 3)" : "3";
  const variantTenantClause = variantColumns.has("tenant_id") ? "AND v.tenant_id = p.tenant_id" : "";
  const variantActiveClause = variantColumns.has("is_active") ? "AND COALESCE(v.is_active, TRUE) = TRUE" : "";
  const variantDeletedClause = variantColumns.has("deleted_at") ? "AND v.deleted_at IS NULL" : "";
  const variantImageSql = hasVariants && variantColumns.has("image_url")
    ? `
      NULLIF((
        SELECT v2.image_url
        FROM product_variants v2
        WHERE v2.product_id = p.id
          ${variantColumns.has("tenant_id") ? "AND v2.tenant_id = p.tenant_id" : ""}
          ${variantColumns.has("deleted_at") ? "AND v2.deleted_at IS NULL" : ""}
          AND NULLIF(v2.image_url, '') IS NOT NULL
        ORDER BY ${variantColumns.has("stock") ? "v2.stock DESC NULLS LAST," : ""} v2.id DESC
        LIMIT 1
      ), '')
    `
    : "NULL";

  const stockSql = hasVariants
    ? `
      COALESCE((
        SELECT SUM(GREATEST(v.stock, 0))::int
        FROM product_variants v
        WHERE v.product_id = p.id
          ${variantTenantClause}
          ${variantActiveClause}
          ${variantDeletedClause}
      ), ${productStockExpr})
    `
    : productStockExpr;

  const result = await db.query(
    `
    SELECT
      p.id,
      p.name,
      COALESCE(${productImageBase}, ${variantImageSql}, '') AS image_url,
      ${productCreatedExpr} AS created_at,
      ${stockSql} AS stock,
      ${thresholdExpr} AS threshold
    FROM products p
    WHERE p.tenant_id = $1::bigint
      AND ${activeProductSql}
    ORDER BY
      CASE WHEN ${stockSql} = 1 THEN 0 WHEN ${stockSql} <= ${thresholdExpr} THEN 1 ELSE 2 END,
      ${productCreatedExpr} DESC,
      p.id DESC
    LIMIT 30
    `,
    [tenantId]
  );

  return result.rows.map((row) => {
    const stock = Number(row.stock || 0);
    const threshold = Number(row.threshold || 3);
    const createdAt = row.created_at ? new Date(row.created_at) : null;
    const recent = createdAt && !Number.isNaN(createdAt.getTime()) && createdAt >= new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const type = stock === 1 ? "last_piece" : stock > 1 && stock <= threshold ? "low_stock" : recent ? "new_arrival" : "new_arrival";
    const tone = type === "new_arrival" ? "Luxury" : "Urgent Sale";
    return {
      product_id: row.id,
      product_name: row.name,
      product_image: row.image_url || "",
      type,
      tone,
      reason: type === "last_piece"
        ? "Only 1 piece left"
        : type === "low_stock"
          ? `Low stock: ${stock} available`
          : "Product is ready for a weekly marketing push",
    };
  });
};

const startOfLocalWeek = (date, nextWeek = false) => {
  const base = new Date(date);
  base.setHours(0, 0, 0, 0);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + diff + (nextWeek ? 7 : 0));
  return base;
};

const computeNextAutomationRun = (day = 1, time = "09:00") => {
  const now = new Date();
  const [hourRaw, minuteRaw] = String(time || "09:00").split(":");
  const target = new Date(now);
  const weeklyDay = Math.max(0, Math.min(6, Number(day)));
  target.setHours(Number(hourRaw) || 9, Number(minuteRaw) || 0, 0, 0);
  const diff = (weeklyDay - target.getDay() + 7) % 7;
  target.setDate(target.getDate() + diff);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target;
};

const normalizeAutomationSettingsRow = (row = {}, tenantId = null) => ({
  id: row.id || null,
  tenant_id: row.tenant_id ?? tenantId,
  enabled: Boolean(row.enabled),
  weekly_generation_day: Number(row.weekly_generation_day ?? 1),
  weekly_generation_time: row.weekly_generation_time || "09:00",
  default_platforms: normalizePlatforms(row.default_platforms),
  default_intensity: ["light", "balanced", "aggressive"].includes(row.default_intensity) ? row.default_intensity : "balanced",
  default_approval_mode: ["draft", "drafts"].includes(row.default_approval_mode) ? "draft" : "pending_approval",
  auto_generate_next_week: row.auto_generate_next_week !== false,
  auto_publish_enabled: Boolean(row.auto_publish_enabled),
  auto_publish_requires_approval: row.auto_publish_requires_approval !== false,
  auto_publish_platforms: normalizePlatforms(row.auto_publish_platforms),
  auto_publish_window_start: String(row.auto_publish_window_start || "10:00").slice(0, 5),
  auto_publish_window_end: String(row.auto_publish_window_end || "22:00").slice(0, 5),
  max_auto_posts_per_day: Math.max(1, Number(row.max_auto_posts_per_day || 2)),
  auto_publish_failed_count: Number(row.auto_publish_failed_count || 0),
  last_auto_publish_at: row.last_auto_publish_at || null,
  last_generated_at: row.last_generated_at || null,
  next_run_at: row.next_run_at || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const AUTOMATION_LOG_EVENTS = new Set([
  "automation_event",
  "weekly_pack_generated",
  "weekly_pack_skipped_duplicate",
  "weekly_pack_failed",
  "auto_publish_started",
  "auto_publish_success",
  "auto_publish_failed",
  "automation_runner_started",
  "automation_runner_skipped_lock",
  "automation_settings_updated",
  "manual_run_now",
]);

const AUTOMATION_LOG_STATUSES = new Set(["info", "success", "warning", "failed", "error", "skipped"]);

const safeAutomationMessage = (message) => String(message || "").replace(/\s+/g, " ").trim().slice(0, 500);

const sanitizeAutomationMetadata = (value, depth = 0) => {
  if (depth > 4) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeAutomationMetadata(item, depth + 1));
  if (typeof value !== "object") return value;
  return Object.entries(value).reduce((acc, [key, item]) => {
    const lower = String(key).toLowerCase();
    if (/(token|secret|password|credential|authorization|api[_-]?key)/.test(lower)) {
      acc[key] = "[redacted]";
    } else {
      acc[key] = sanitizeAutomationMetadata(item, depth + 1);
    }
    return acc;
  }, {});
};

const normalizeAutomationLogRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id ?? null,
  event_type: row.event_type || "automation_event",
  status: row.status || "info",
  message: row.message || "",
  draft_id: row.draft_id ?? null,
  product_id: row.product_id ?? null,
  platform: row.platform || null,
  metadata: safeJsonObject(row.metadata, {}),
  created_at: row.created_at || null,
});

const normalizeBrandList = (value) => uniqueList(safeJson(value, Array.isArray(value) ? value : String(value || "").split(",")));

const normalizeBrandIdentityRow = (row = {}, tenantId = null) => ({
  id: row.id || null,
  tenant_id: row.tenant_id ?? tenantId,
  brand_name: row.brand_name || "",
  brand_tone: row.brand_tone || "",
  audience: row.audience || "",
  language: row.language || "",
  dialect: row.dialect || "",
  primary_colors: normalizeBrandList(row.primary_colors),
  forbidden_words: normalizeBrandList(row.forbidden_words),
  preferred_cta: row.preferred_cta || "",
  hashtag_style: row.hashtag_style || "",
  notes: row.notes || "",
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const getOrCreateBrandIdentity = async (tenantId) => {
  const result = await db.query(
    `
    INSERT INTO marketing_brand_identity (tenant_id)
    VALUES ($1::bigint)
    ON CONFLICT (tenant_id) DO NOTHING
    RETURNING *
    `,
    [tenantId]
  );
  if (result.rows[0]) return normalizeBrandIdentityRow(result.rows[0], tenantId);
  const existing = await db.query(
    `
    SELECT *
    FROM marketing_brand_identity
    WHERE tenant_id = $1::bigint
    LIMIT 1
    `,
    [tenantId]
  );
  return normalizeBrandIdentityRow(existing.rows[0] || {}, tenantId);
};

const hasBrandIdentityContent = (brand = {}) =>
  Boolean(
    nullableString(brand.brand_name) ||
      nullableString(brand.brand_tone) ||
      nullableString(brand.audience) ||
      nullableString(brand.language) ||
      nullableString(brand.dialect) ||
      nullableString(brand.preferred_cta) ||
      nullableString(brand.hashtag_style) ||
      nullableString(brand.notes) ||
      normalizeBrandList(brand.primary_colors).length ||
      normalizeBrandList(brand.forbidden_words).length
  );

const makeBrandHashtag = (brandName = "") => {
  const normalized = String(brandName || "").replace(/[^a-zA-Z0-9]+/g, "").trim();
  return normalized ? `#${normalized}` : "";
};

const removeForbiddenWords = (text = "", words = []) => {
  let next = String(text || "");
  normalizeBrandList(words).forEach((word) => {
    const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped) next = next.replace(new RegExp(escaped, "gi"), "").replace(/[ \t]{2,}/g, " ");
  });
  return next.trim();
};

const applyBrandIdentityToCreative = (creative = {}, brand = {}) => {
  if (!hasBrandIdentityContent(brand)) return creative;
  const brandName = nullableString(brand.brand_name);
  const tone = nullableString(brand.brand_tone);
  const audience = nullableString(brand.audience);
  const language = nullableString(brand.language);
  const dialect = nullableString(brand.dialect);
  const preferredCta = nullableString(brand.preferred_cta);
  const notes = nullableString(brand.notes);
  const colors = normalizeBrandList(brand.primary_colors);
  const contextLines = [
    brandName ? `Brand: ${brandName}` : "",
    tone ? `Voice: ${tone}` : "",
    audience ? `Audience: ${audience}` : "",
    language || dialect ? `Language: ${[language, dialect].filter(Boolean).join(" - ")}` : "",
    colors.length ? `Colors: ${colors.slice(0, 4).join(", ")}` : "",
    notes ? `Note: ${notes}` : "",
  ].filter(Boolean);
  const captionParts = [
    creative.caption || "",
    preferredCta ? `\n${preferredCta}` : "",
    contextLines.length ? `\n${contextLines.join(" | ")}` : "",
  ].filter(Boolean);
  const brandHashtag = makeBrandHashtag(brandName);
  const hashtags = uniqueList([
    ...(String(creative.hashtags || "").match(/#[\w-]+/g) || String(creative.hashtags || "").split(/\s+/)),
    brandHashtag,
  ]).join(" ");
  return {
    ...creative,
    title: removeForbiddenWords(brandName && creative.title ? `${brandName} - ${creative.title}` : creative.title, brand.forbidden_words),
    caption: removeForbiddenWords(captionParts.join("\n"), brand.forbidden_words),
    hashtags: removeForbiddenWords(hashtags, brand.forbidden_words),
    brand_identity: {
      brand_name: brandName || "",
      brand_tone: tone || "",
      audience: audience || "",
      language: language || "",
      dialect: dialect || "",
      preferred_cta: preferredCta || "",
      hashtag_style: brand.hashtag_style || "",
    },
  };
};

const STORY_CAMPAIGN_TYPES = new Set(["last_piece", "new_arrival", "offer", "trending", "engagement", "low_stock", "size_urgency", "luxury_showcase"]);
const STORY_CAMPAIGN_STATUSES = new Set(["draft", "generated", "approved", "scheduled", "published", "rejected"]);
const STORY_CAMPAIGN_PLATFORMS = new Set(["instagram", "facebook", "all"]);
const STORY_TRIGGER_TYPES = new Set(["last_piece", "low_stock", "size_urgency", "new_arrival", "trending_product", "slow_moving", "high_interest_low_sales"]);
const STORY_TRIGGER_STATUSES = new Set(["pending", "generated", "dismissed", "expired"]);
const STORY_TRIGGER_PRIORITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 };

const normalizeStoryCampaignType = (value) => {
  const normalized = String(value || "new_arrival").trim().toLowerCase();
  return STORY_CAMPAIGN_TYPES.has(normalized) ? normalized : "new_arrival";
};

const normalizeStoryCampaignStatus = (value) => {
  const normalized = String(value || "draft").trim().toLowerCase();
  return STORY_CAMPAIGN_STATUSES.has(normalized) ? normalized : "draft";
};

const normalizeStoryCampaignPlatform = (value) => {
  const normalized = String(value || "instagram").trim().toLowerCase();
  return STORY_CAMPAIGN_PLATFORMS.has(normalized) ? normalized : "instagram";
};

const normalizeStoriesJson = (value) => {
  const parsed = safeJson(value, []);
  return parsed
    .filter((story) => story && typeof story === "object" && !Array.isArray(story))
    .map((story, index) => ({
      position: Number(story.position || index + 1),
      type: nullableString(story.type) || "showcase",
      headline: nullableString(story.headline) || "",
      subtext: nullableString(story.subtext) || "",
      cta: nullableString(story.cta),
      visual_direction: nullableString(story.visual_direction) || "",
      animation_hint: nullableString(story.animation_hint) || "",
      stickers: normalizeBrandList(story.stickers),
    }));
};

const normalizeStoryCampaignRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  branch_id: row.branch_id ?? null,
  campaign_type: row.campaign_type || "new_arrival",
  product_id: row.product_id ?? null,
  product_name: row.product_name || "",
  product_image: row.product_image || "",
  title: row.title || "",
  tone: row.tone || "Luxury",
  platform: row.platform || "instagram",
  visual_style: row.visual_style || "Luxury",
  cta_goal: row.cta_goal || "Website",
  story_count: Number(row.story_count || 0),
  stories_json: normalizeStoriesJson(row.stories_json),
  status: row.status || "draft",
  generated_by: row.generated_by ?? null,
  scheduled_at: row.scheduled_at || null,
  published_at: row.published_at || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const normalizeStoryExportRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  branch_id: row.branch_id ?? null,
  story_campaign_id: row.story_campaign_id ?? null,
  template_id: row.template_id || "",
  export_type: row.export_type || "png",
  file_count: Number(row.file_count || 0),
  filenames: normalizeBrandList(row.filenames_json),
  status: row.status || "completed",
  created_by: row.created_by ?? null,
  created_at: row.created_at || null,
});

const normalizeStoryTriggerType = (value) => {
  const normalized = String(value || "new_arrival").trim().toLowerCase();
  return STORY_TRIGGER_TYPES.has(normalized) ? normalized : "new_arrival";
};

const normalizeStoryTriggerStatus = (value) => {
  const normalized = String(value || "pending").trim().toLowerCase();
  return STORY_TRIGGER_STATUSES.has(normalized) ? normalized : "pending";
};

const priorityForScore = (score) => {
  const numeric = Math.max(0, Math.min(100, Number(score || 0)));
  if (numeric >= 92) return "critical";
  if (numeric >= 78) return "high";
  if (numeric >= 60) return "medium";
  return "low";
};

const normalizeStoryTriggerRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  branch_id: row.branch_id ?? null,
  trigger_type: row.trigger_type || "new_arrival",
  product_id: row.product_id ?? null,
  variant_id: row.variant_id ?? null,
  product_name: row.product_name || "",
  product_image: row.product_image || "",
  title: row.title || "",
  reason: row.reason || "",
  priority: row.priority || priorityForScore(row.signal_score),
  signal_score: Number(row.signal_score || 0),
  signal_snapshot: safeJsonObject(row.signal_snapshot_json, {}),
  suggested_campaign_type: row.suggested_campaign_type || "new_arrival",
  suggested_story_count: Number(row.suggested_story_count || 4),
  suggested_visual_style: row.suggested_visual_style || "Luxury",
  suggested_cta_goal: row.suggested_cta_goal || "Website",
  status: row.status || "pending",
  generated_campaign_id: row.generated_campaign_id ?? null,
  dismissed_at: row.dismissed_at || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const isStockStoryTriggerSuggestion = (item = {}) => ["last_piece", "low_stock", "size_urgency"].includes(String(item.trigger_type || "").toLowerCase());

const storyTriggerProductKey = (item = {}) =>
  String(item.product_id || item.productId || item.signal_snapshot?.product_id || item.signal_snapshot?.productId || item.id || "");

const normalizeStoryTriggerVariant = (variant = {}) => {
  const qty = Number(variant.qty ?? variant.stock_qty ?? variant.stockQty ?? variant.stock_quantity ?? variant.stockQuantity ?? variant.stock ?? variant.quantity ?? 0);
  return {
    id: variant.id || variant.variant_id || variant.variantId || null,
    variant_id: variant.variant_id || variant.variantId || variant.id || null,
    color: String(variant.color || variant.color_name || variant.colorName || "").trim(),
    size: String(variant.size || variant.size_name || variant.sizeName || "").trim(),
    qty: Number.isFinite(qty) ? qty : 0,
    stock: Number.isFinite(qty) ? qty : 0,
    image: variant.image || variant.image_url || variant.variant_image_url || "",
  };
};

const storyTriggerVariantSources = (item = {}) => {
  const snapshot = item.signal_snapshot && typeof item.signal_snapshot === "object" ? item.signal_snapshot : {};
  const lists = [
    item.lastPieceVariants,
    item.lowStockVariants,
    item.variants,
    snapshot.lastPieceVariants,
    snapshot.lowStockVariants,
    snapshot.low_stock_variants,
    snapshot.critical_sizes,
    snapshot.variants,
  ].filter(Array.isArray);
  const directVariant = item.variant_id || snapshot.variant?.id
    ? {
        id: item.variant_id || snapshot.variant?.id,
        color: snapshot.variant?.color || "",
        size: snapshot.variant?.size || "",
        stock: snapshot.variant?.stock ?? snapshot.stock ?? 1,
        image: snapshot.variant?.image || "",
      }
    : null;
  return [...lists.flat(), directVariant].filter(Boolean);
};

const groupStoryTriggerSuggestionsByProduct = (suggestions = []) => {
  const grouped = new Map();
  const passthrough = [];

  for (const item of Array.isArray(suggestions) ? suggestions : []) {
    if (!isStockStoryTriggerSuggestion(item)) {
      passthrough.push(item);
      continue;
    }
    const productKey = storyTriggerProductKey(item);
    if (!productKey) {
      passthrough.push(item);
      continue;
    }
    const current = grouped.get(productKey) || {
      ...item,
      variant_id: null,
      _variants: [],
      _score: Number(item.signal_score || 0),
    };
    current._score = Math.max(Number(current._score || 0), Number(item.signal_score || 0));
    if ((STORY_TRIGGER_PRIORITY_WEIGHT[item.priority] || 0) > (STORY_TRIGGER_PRIORITY_WEIGHT[current.priority] || 0)) {
      current.priority = item.priority;
    }
    current._variants.push(
      ...storyTriggerVariantSources(item)
        .map(normalizeStoryTriggerVariant)
        .filter((variant) => variant.qty > 0)
    );
    grouped.set(productKey, current);
  }

  const normalizedGrouped = Array.from(grouped.values()).map((item) => {
    const seenVariants = new Set();
    const variants = item._variants
      .filter((variant) => {
        const key = String(variant.variant_id || variant.id || `${variant.color}-${variant.size}-${variant.qty}`);
        if (seenVariants.has(key)) return false;
        seenVariants.add(key);
        return true;
      })
      .sort((left, right) => left.qty - right.qty || left.size.localeCompare(right.size) || left.color.localeCompare(right.color))
      .slice(0, 3);
    const count = variants.length;
    return {
      ...item,
      title: count === 1 ? `Last piece story for ${item.product_name}` : `Last ${count} pieces story for ${item.product_name}`,
      reason: count === 1 ? "Last piece" : `Last ${count} low-stock variants`,
      signal_score: item._score,
      signal_snapshot: {
        ...(item.signal_snapshot || {}),
        lastPieceVariants: variants,
        low_stock_variants: variants,
      },
      _variants: undefined,
      _score: undefined,
    };
  });

  return [...normalizedGrouped, ...passthrough].sort((left, right) =>
    (STORY_TRIGGER_PRIORITY_WEIGHT[right.priority] || 0) - (STORY_TRIGGER_PRIORITY_WEIGHT[left.priority] || 0) ||
    Number(right.signal_score || 0) - Number(left.signal_score || 0)
  );
};

const getProductStockSignal = (product = {}, variants = []) => {
  const variantStocks = variants
    .map((variant) => Number(variant.stock ?? variant.quantity ?? variant.qty ?? variant.available_quantity ?? variant.current_stock))
    .filter((value) => Number.isFinite(value));
  const productStock = Number(product.stock ?? product.quantity ?? product.qty ?? product.available_quantity ?? 0);
  const stock = variantStocks.length ? variantStocks.reduce((sum, value) => sum + Math.max(0, value), 0) : (Number.isFinite(productStock) ? Math.max(0, productStock) : 0);
  const threshold = Number(product.low_stock_alert ?? product.product_low_stock_threshold ?? 3);
  return {
    stock,
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 3,
    is_last_piece: stock === 1,
    is_low_stock: stock > 0 && stock <= (Number.isFinite(threshold) && threshold > 0 ? threshold : 3),
  };
};

const getProductPriceSignal = (product = {}, variants = []) => {
  const prices = [
    product.sale_price,
    product.price,
    ...variants.map((variant) => variant.sale_price ?? variant.price),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return prices.length ? Math.min(...prices) : 0;
};

const ctaTextForGoal = (goal = "Website") => {
  const normalized = String(goal || "").toLowerCase();
  if (normalized.includes("whatsapp")) return "WhatsApp";
  if (normalized.includes("dm")) return "DM Now";
  if (normalized.includes("order")) return "Order Now";
  return "Shop Now";
};

const storyFlowForCampaignType = (campaignType, requestedCount) => {
  const flows = {
    last_piece: ["hook", "product_showcase", "urgency", "cta"],
    low_stock: ["hook", "product_showcase", "urgency", "cta"],
    engagement: ["engagement", "product_comparison", "social_proof", "cta"],
    luxury_showcase: ["hook", "product_showcase", "social_proof", "cta"],
    offer: ["hook", "product_showcase", "urgency", "cta"],
    trending: ["hook", "social_proof", "product_showcase", "cta"],
    new_arrival: ["hook", "product_showcase", "social_proof", "cta"],
  };
  const base = flows[campaignType] || flows.new_arrival;
  const count = Math.max(2, Math.min(8, Number(requestedCount || base.length)));
  return Array.from({ length: count }, (_, index) => base[index % base.length]);
};

const buildStoryCampaignStory = ({ type, position, product, stockSignal, price, campaignType, tone, visualStyle, ctaGoal, brandIdentity }) => {
  const productName = product?.name || "Featured product";
  const brandName = nullableString(brandIdentity?.brand_name);
  const cta = ctaTextForGoal(ctaGoal);
  const stockText = stockSignal.is_last_piece
    ? "Only 1 piece left"
    : stockSignal.is_low_stock
      ? `Only ${stockSignal.stock} left`
      : "Limited drop";
  const priceText = price ? `Starts from ${price}` : "Available now";
  const style = String(visualStyle || "Luxury").toLowerCase();
  const visualBase = `${style} ${productName} story layout`;
  const templates = {
    hook: {
      headline: campaignType === "last_piece" ? `${productName} is almost gone` : campaignType === "engagement" ? `Which style wins?` : `${productName} just landed`,
      subtext: brandName ? `${brandName} pick for ${tone}` : `${tone} edit for this week`,
      cta: null,
      visual_direction: `${visualBase}, bold first frame`,
      animation_hint: "slow zoom",
      stickers: campaignType === "new_arrival" ? ["NEW"] : ["HOT"],
    },
    product_showcase: {
      headline: productName,
      subtext: `${priceText}${product.category_name ? ` | ${product.category_name}` : ""}`,
      cta: null,
      visual_direction: `${visualBase}, close-up product details`,
      animation_hint: "pan across details",
      stickers: ["FEATURED"],
    },
    urgency: {
      headline: stockText,
      subtext: "Move before the size or color sells out",
      cta,
      visual_direction: `${visualBase}, stock urgency layout`,
      animation_hint: "pulse effect",
      stickers: stockSignal.is_last_piece ? ["LAST PIECE"] : ["LOW STOCK"],
    },
    cta: {
      headline: `Ready to get it?`,
      subtext: ctaGoal === "DM" ? "Send us a message and we will help you order" : "Tap through and complete your order",
      cta,
      visual_direction: `${visualBase}, clean CTA end card`,
      animation_hint: "swipe up cue",
      stickers: [cta.toUpperCase()],
    },
    social_proof: {
      headline: campaignType === "trending" ? "Customers keep checking this one" : "A customer favorite",
      subtext: "Strong demand signal from current product activity",
      cta: null,
      visual_direction: `${visualBase}, review-style proof frame`,
      animation_hint: "count-up reveal",
      stickers: ["TRENDING"],
    },
    engagement: {
      headline: "Pick your favorite",
      subtext: `Would you wear ${productName}?`,
      cta: null,
      visual_direction: `${visualBase}, poll sticker composition`,
      animation_hint: "tap poll",
      stickers: ["POLL"],
    },
    product_comparison: {
      headline: "This or that?",
      subtext: "Compare color, fit, or styling angle",
      cta: null,
      visual_direction: `${visualBase}, split-screen comparison`,
      animation_hint: "side reveal",
      stickers: ["VOTE"],
    },
  };
  const story = templates[type] || templates.product_showcase;
  return {
    position,
    type,
    ...story,
  };
};

const generateStoryCampaignSequence = ({ campaignType, storyCount, product, variants, tone, visualStyle, ctaGoal, brandIdentity }) => {
  const stockSignal = getProductStockSignal(product, variants);
  const price = getProductPriceSignal(product, variants);
  return storyFlowForCampaignType(campaignType, storyCount).map((type, index) =>
    buildStoryCampaignStory({
      type,
      position: index + 1,
      product,
      stockSignal,
      price,
      campaignType,
      tone,
      visualStyle,
      ctaGoal,
      brandIdentity,
    })
  );
};

const writeAutomationLog = async ({
  tenantId = null,
  eventType,
  status = "info",
  message = "",
  draftId = null,
  productId = null,
  platform = null,
  metadata = {},
}) => {
  try {
    const normalizedEvent = AUTOMATION_LOG_EVENTS.has(eventType) ? eventType : "automation_event";
    const normalizedStatus = AUTOMATION_LOG_STATUSES.has(status) ? status : "info";
    await db.query(
      `
      INSERT INTO marketing_automation_logs (
        tenant_id, event_type, status, message, draft_id, product_id, platform, metadata
      )
      VALUES ($1::bigint,$2,$3,$4,$5::bigint,$6::bigint,$7,$8::jsonb)
      `,
      [
        tenantId,
        normalizedEvent,
        normalizedStatus,
        safeAutomationMessage(message),
        draftId,
        productId,
        platform ? String(platform).toLowerCase() : null,
        JSON.stringify(sanitizeAutomationMetadata(metadata)),
      ]
    );
  } catch (logError) {
    console.warn("[ai-marketing-automation-log] write failed", logError?.message || logError);
  }
};

const getOrCreateAutomationSettings = async (tenantId) => {
  const result = await db.query(
    `
    INSERT INTO marketing_automation_settings (tenant_id, next_run_at)
    VALUES ($1::bigint, $2::timestamp)
    ON CONFLICT (tenant_id) DO NOTHING
    RETURNING *
    `,
    [tenantId, computeNextAutomationRun(1, "09:00")]
  );
  if (result.rows[0]) return normalizeAutomationSettingsRow(result.rows[0], tenantId);
  const existing = await db.query(
    `
    SELECT *
    FROM marketing_automation_settings
    WHERE tenant_id = $1::bigint
    LIMIT 1
    `,
    [tenantId]
  );
  return normalizeAutomationSettingsRow(existing.rows[0] || {}, tenantId);
};

const createWeeklyContentPack = async ({
  tenantId,
  userId = null,
  weekStart,
  platforms = ["facebook", "instagram"],
  intensity = "balanced",
  approvalMode = "pending_approval",
  source = "weekly_content_pack",
  skipExisting = false,
}) => {
  const normalizedIntensity = ["light", "balanced", "aggressive"].includes(String(intensity || "").toLowerCase())
    ? String(intensity).toLowerCase()
    : "balanced";
  const planTypes = WEEKLY_PACK_RULES[normalizedIntensity] || WEEKLY_PACK_RULES.balanced;
  const normalizedPlatforms = normalizePlatforms(platforms);
  const status = ["draft", "drafts"].includes(String(approvalMode || "").toLowerCase()) ? "draft" : "pending_approval";
  const weekKey = formatLocalDateTime(weekStart, "00:00").slice(0, 10);

  if (skipExisting) {
    const duplicate = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM marketing_content_drafts
      WHERE tenant_id = $1::bigint
        AND ai_metadata->>'source' IN ('weekly_content_pack','automation_weekly_pack')
        AND ai_metadata->>'week_start_date' = $2::text
      `,
      [tenantId, weekKey]
    );
    if (Number(duplicate.rows[0]?.count || 0) > 0) {
      return {
        created: [],
        summary: {
          requested: planTypes.length,
          created: 0,
          skipped: planTypes.length,
          breakdown: {},
          scheduled_days: [],
          skipped_reasons: [{ reason: "Weekly pack already exists for this week" }],
          duplicate_week_skipped: true,
        },
      };
    }
  }

  const candidates = await loadWeeklyPackCandidates(tenantId);
  const brandIdentity = await getOrCreateBrandIdentity(tenantId);
  const created = [];
  const skipped = [];
  const usedPairs = new Set();
  const dayCounts = new Map();
  const weekendCandidate = {
    type: "weekend_sale",
    product_id: null,
    product_name: "Weekend campaign",
    product_image: "",
    tone: "Hype",
    reason: "Weekend campaign slot",
    generic: true,
  };

  const findCandidate = (contentType, index) => {
    const ordered = [
      ...candidates.filter((item) => {
        if (contentType === "Story") return ["last_piece", "low_stock", "abandoned_cart"].includes(item.type);
        if (contentType === "Reel Script") return ["high_views_low_sales", "new_arrival"].includes(item.type);
        if (contentType === "Ad Copy") return ["abandoned_cart", "high_views_low_sales", "low_stock"].includes(item.type);
        return ["new_arrival", "last_piece", "low_stock", "high_views_low_sales"].includes(item.type);
      }),
      ...candidates,
    ];
    const found = ordered.find((item) => !usedPairs.has(`${item.product_id || "generic"}:${contentType}`));
    if (found) return found;
    if (contentType !== "Ad Copy" && index >= Math.max(2, planTypes.length - 2)) return weekendCandidate;
    return null;
  };

  for (let index = 0; index < planTypes.length; index += 1) {
    const contentType = planTypes[index];
    const candidate = findCandidate(contentType, index);
    if (!candidate) {
      skipped.push({ content_type: contentType, reason: "No matching product or suggestion data available" });
      continue;
    }
    const key = `${candidate.product_id || "generic"}:${contentType}`;
    if (usedPairs.has(key)) {
      skipped.push({ content_type: contentType, reason: "Skipped duplicate product/content type" });
      continue;
    }
    usedPairs.add(key);

    let dayOffset = index % 7;
    for (let attempts = 0; attempts < 7; attempts += 1) {
      if ((dayCounts.get(dayOffset) || 0) < 2) break;
      dayOffset = (dayOffset + 1) % 7;
    }
    dayCounts.set(dayOffset, (dayCounts.get(dayOffset) || 0) + 1);
    const scheduledDay = new Date(weekStart);
    scheduledDay.setDate(weekStart.getDate() + dayOffset);
    const times = WEEKLY_PACK_TIMES[contentType] || ["12:00"];
    const scheduledAt = formatLocalDateTime(scheduledDay, times[(dayCounts.get(dayOffset) - 1) % times.length]);

    let generated = {};
    let product = null;
    if (candidate.product_id) {
      const bundle = await fetchProductBundle(candidate.product_id, tenantId);
      product = bundle.product;
      if (!product) {
        skipped.push({ content_type: contentType, reason: "Product was no longer available" });
        continue;
      }
      generated = resolveProductPostData(bundle.product, bundle.variants, brandIdentity);
    }

    const tone = contentType === "Feed Post" && candidate.type === "new_arrival" ? "Luxury" : candidate.tone || "Hype";
    const title = candidate.generic
      ? `Weekend ${contentType}`
      : [generated.title || product?.name || candidate.product_name, contentType, tone].filter(Boolean).join(" - ");
    const caption = candidate.generic ? "Plan a focused weekend push across Facebook and Instagram." : generated.caption || "";
    const mediaUrls = normalizeMediaUrls(generated.media_urls, generated.image_url || candidate.product_image);
    const metadata = {
      source,
      suggestion_type: candidate.type,
      reason: candidate.reason,
      intensity: normalizedIntensity,
      week_start_date: weekKey,
      brand_identity: generated.brand_identity || normalizeBrandIdentityRow(brandIdentity, tenantId),
    };

    const result = await db.query(
      `
      INSERT INTO marketing_content_drafts (
        tenant_id, product_id, content_type, tone, platforms, title, caption, hook, body,
        hashtags, media_urls, status, scheduled_at, created_by, ai_metadata
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::timestamp,$14,$15::jsonb)
      RETURNING *
      `,
      [
        tenantId,
        candidate.product_id,
        contentType,
        tone,
        JSON.stringify(normalizedPlatforms),
        title,
        caption,
        candidate.reason || "",
        caption,
        generated.hashtags || "",
        JSON.stringify(mediaUrls),
        status,
        scheduledAt,
        userId,
        JSON.stringify(metadata),
      ]
    );
    created.push(normalizeContentDraftRow({ ...result.rows[0], product_name: product?.name || candidate.product_name || "" }));
  }

  const breakdown = created.reduce((acc, draft) => {
    acc[draft.content_type] = (acc[draft.content_type] || 0) + 1;
    return acc;
  }, {});
  const scheduledDays = uniqueList(created.map((draft) => String(draft.scheduled_at || "").slice(0, 10)).filter(Boolean));
  return {
    created,
    summary: {
      requested: planTypes.length,
      created: created.length,
      skipped: skipped.length,
      breakdown,
      scheduled_days: scheduledDays,
      skipped_reasons: skipped,
    },
  };
};

const isWithinAutoPublishWindow = (settings) => {
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const start = settings.auto_publish_window_start || "10:00";
  const end = settings.auto_publish_window_end || "22:00";
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
};

const markAutoPublishFailure = async (draft, tenantId, message) => {
  const metadata = {
    ...safeJsonObject(draft.ai_metadata, {}),
    auto_publish: true,
    auto_publish_error: message,
    auto_publish_attempted_at: new Date().toISOString(),
  };
  await db.query(
    `
    UPDATE marketing_content_drafts
    SET status = 'failed',
        error_message = $1::text,
        ai_metadata = $2::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $3::bigint
      AND tenant_id = $4::bigint
    `,
    [message, JSON.stringify(metadata), draft.id, tenantId]
  );
};

const runAutoPublishForTenant = async (tenantId, settings) => {
  if (!settings.auto_publish_enabled) {
    return { published: [], failed: [], skipped: [{ reason: "Auto-publish is disabled" }] };
  }
  await writeAutomationLog({
    tenantId,
    eventType: "auto_publish_started",
    status: "info",
    message: "Auto-publish scan started.",
    metadata: {
      requires_approval: settings.auto_publish_requires_approval,
      platforms: settings.auto_publish_platforms,
      max_auto_posts_per_day: settings.max_auto_posts_per_day,
    },
  });
  if (!isWithinAutoPublishWindow(settings)) {
    return { published: [], failed: [], skipped: [{ reason: "Outside auto-publish window" }] };
  }

  const publishedToday = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM marketing_content_drafts
    WHERE tenant_id = $1::bigint
      AND status = 'published'
      AND published_at::date = CURRENT_DATE
      AND ai_metadata->>'auto_publish' = 'true'
    `,
    [tenantId]
  );
  const remaining = Math.max(0, Number(settings.max_auto_posts_per_day || 2) - Number(publishedToday.rows[0]?.count || 0));
  if (remaining <= 0) {
    return { published: [], failed: [], skipped: [{ reason: "Daily auto-publish limit reached" }] };
  }

  const candidatesResult = await db.query(
    `
    SELECT d.*, p.name AS product_name
    FROM marketing_content_drafts d
    LEFT JOIN products p ON p.id = d.product_id
    WHERE d.tenant_id = $1::bigint
      AND d.status = 'scheduled'
      AND d.scheduled_at <= CURRENT_TIMESTAMP
      ${settings.auto_publish_requires_approval ? "AND d.approved_by IS NOT NULL" : ""}
    ORDER BY d.scheduled_at ASC, d.created_at ASC
    LIMIT 25
    `,
    [tenantId]
  );

  const allowedPlatforms = normalizePlatforms(settings.auto_publish_platforms);
  const published = [];
  const failed = [];
  const skipped = [];

  for (const row of candidatesResult.rows) {
    if (published.length >= remaining) break;
    const draft = normalizeContentDraftRow(row);
    const draftPlatforms = normalizePlatforms(draft.platforms);
    if (!draftPlatforms.every((platform) => allowedPlatforms.includes(platform))) {
      skipped.push({ id: draft.id, reason: "Draft platform is not allowed for auto-publish" });
      continue;
    }
    if (!draft.caption || !draft.caption.trim()) {
      const message = "Caption is required before auto-publish.";
      await markAutoPublishFailure(draft, tenantId, message);
      await writeAutomationLog({
        tenantId,
        eventType: "auto_publish_failed",
        status: "failed",
        message,
        draftId: draft.id,
        productId: draft.product_id,
        platform: draftPlatforms[0] || null,
      });
      failed.push({ id: draft.id, reason: message });
      continue;
    }
    if (!normalizeMediaUrls(draft.media_urls, "").length) {
      const message = "Media is required before auto-publish.";
      await markAutoPublishFailure(draft, tenantId, message);
      await writeAutomationLog({
        tenantId,
        eventType: "auto_publish_failed",
        status: "failed",
        message,
        draftId: draft.id,
        productId: draft.product_id,
        platform: draftPlatforms[0] || null,
      });
      failed.push({ id: draft.id, reason: message });
      continue;
    }
    try {
      const post = await createPostFromDraft(draft, tenantId);
      const isStory = String(draft.content_type || "").toLowerCase() === "story";
      const result = isStory ? await publishStoryForRow(post, tenantId) : await publishAndPersist(post.id, tenantId);
      const ok = isStory ? result.story_status === "published" : result.status === "published";
      if (!ok) {
        const message = result.error_message || result.story_error_message || "Auto-publish failed.";
        await markAutoPublishFailure(draft, tenantId, message);
        await writeAutomationLog({
          tenantId,
          eventType: "auto_publish_failed",
          status: "failed",
          message,
          draftId: draft.id,
          productId: draft.product_id,
          platform: draftPlatforms[0] || null,
          metadata: { marketing_post_id: post.id },
        });
        failed.push({ id: draft.id, reason: message });
        continue;
      }
      const metadata = {
        ...safeJsonObject(draft.ai_metadata, {}),
        auto_publish: true,
        auto_publish_at: new Date().toISOString(),
        marketing_post_id: post.id,
      };
      const updated = await db.query(
        `
        UPDATE marketing_content_drafts
        SET status = 'published',
            published_at = CURRENT_TIMESTAMP,
            error_message = NULL,
            ai_metadata = $1::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2::bigint
          AND tenant_id = $3::bigint
        RETURNING *
        `,
        [JSON.stringify(metadata), draft.id, tenantId]
      );
      const publishedDraft = normalizeContentDraftRow(updated.rows[0]);
      await writeAutomationLog({
        tenantId,
        eventType: "auto_publish_success",
        status: "success",
        message: "Scheduled draft auto-published.",
        draftId: draft.id,
        productId: draft.product_id,
        platform: draftPlatforms[0] || null,
        metadata: { marketing_post_id: post.id, content_type: draft.content_type, platforms: draftPlatforms },
      });
      published.push(publishedDraft);
    } catch (error) {
      const message = error.message || "Auto-publish failed.";
      await markAutoPublishFailure(draft, tenantId, message);
      await writeAutomationLog({
        tenantId,
        eventType: "auto_publish_failed",
        status: "failed",
        message,
        draftId: draft.id,
        productId: draft.product_id,
        platform: draftPlatforms[0] || null,
      });
      failed.push({ id: draft.id, reason: message });
    }
  }

  return { published, failed, skipped };
};

const AI_MARKETING_AUTOMATION_INTERVAL_MS = Math.max(Number(process.env.AI_MARKETING_AUTOMATION_INTERVAL_MS || 10 * 60 * 1000), 5 * 60 * 1000);
let aiMarketingAutomationRunnerStarted = false;
let aiMarketingAutomationRunnerTimer = null;
let aiMarketingAutomationRunnerRunning = false;

const updateAutoPublishRunStats = async (tenantId, settings, result) => {
  const updated = await db.query(
    `
    UPDATE marketing_automation_settings
    SET last_auto_publish_at = CASE WHEN $1::int > 0 THEN CURRENT_TIMESTAMP ELSE last_auto_publish_at END,
        auto_publish_failed_count = auto_publish_failed_count + $2::int,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $3::bigint
    RETURNING *
    `,
    [result.published.length, result.failed.length, tenantId]
  );
  return normalizeAutomationSettingsRow(updated.rows[0] || settings, tenantId);
};

export const runAiMarketingAutomationBackgroundScan = async () => {
  if (aiMarketingAutomationRunnerRunning) return { skipped: true, reason: "already_running" };
  aiMarketingAutomationRunnerRunning = true;
  let lockAcquired = false;
  const totals = { tenants: 0, packs: 0, published: 0, failures: 0 };
  try {
    await ensureMarketingSchema();
    const lockResult = await db.query("SELECT pg_try_advisory_lock($1) AS locked", [74017101]);
    lockAcquired = Boolean(lockResult.rows[0]?.locked);
    if (!lockAcquired) {
      await writeAutomationLog({
        eventType: "automation_runner_skipped_lock",
        status: "skipped",
        message: "Automation runner skipped because another run holds the lock.",
      });
      return { skipped: true, reason: "lock_busy" };
    }

    const settingsResult = await db.query(
      `
      SELECT *
      FROM marketing_automation_settings
      WHERE enabled = TRUE
         OR auto_publish_enabled = TRUE
      ORDER BY tenant_id ASC
      `
    );
    totals.tenants = settingsResult.rows.length;

    for (const row of settingsResult.rows) {
      const settings = normalizeAutomationSettingsRow(row);
      const tenantId = settings.tenant_id;
      try {
        await writeAutomationLog({
          tenantId,
          eventType: "automation_runner_started",
          status: "info",
          message: "Automation runner scanned tenant settings.",
          metadata: {
            weekly_generation_enabled: settings.enabled,
            auto_publish_enabled: settings.auto_publish_enabled,
            next_run_at: settings.next_run_at,
          },
        });
        if (settings.enabled && settings.next_run_at && new Date(settings.next_run_at) <= new Date()) {
          const weekStart = startOfLocalWeek(new Date(), settings.auto_generate_next_week);
          const { summary } = await createWeeklyContentPack({
            tenantId,
            userId: null,
            weekStart,
            platforms: settings.default_platforms,
            intensity: settings.default_intensity,
            approvalMode: settings.default_approval_mode,
            source: "automation_weekly_pack",
            skipExisting: true,
          });
          const nextRunAt = computeNextAutomationRun(settings.weekly_generation_day, settings.weekly_generation_time);
          await db.query(
            `
            UPDATE marketing_automation_settings
            SET last_generated_at = CURRENT_TIMESTAMP,
                next_run_at = $1::timestamp,
                updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $2::bigint
            `,
            [nextRunAt, tenantId]
          );
          totals.packs += Number(summary.created || 0);
          await writeAutomationLog({
            tenantId,
            eventType: summary.duplicate_week_skipped ? "weekly_pack_skipped_duplicate" : "weekly_pack_generated",
            status: summary.duplicate_week_skipped ? "skipped" : "success",
            message: summary.duplicate_week_skipped
              ? "Weekly pack skipped because one already exists for the target week."
              : "Weekly content pack generated by automation.",
            metadata: summary,
          });
        }

        if (settings.auto_publish_enabled) {
          const result = await runAutoPublishForTenant(tenantId, settings);
          await updateAutoPublishRunStats(tenantId, settings, result);
          totals.published += result.published.length;
          totals.failures += result.failed.length;
        }
      } catch (tenantError) {
        totals.failures += 1;
        await writeAutomationLog({
          tenantId,
          eventType: "weekly_pack_failed",
          status: "failed",
          message: tenantError?.message || "Automation tenant run failed.",
        });
        console.error("[ai-marketing-runner] tenant error", {
          tenant_id: tenantId,
          message: tenantError?.message || String(tenantError),
        });
      }
    }

    console.log("[ai-marketing-runner] scan complete", totals);
    return totals;
  } catch (error) {
    console.error("[ai-marketing-runner] scan error", error);
    return { error: error?.message || String(error), ...totals };
  } finally {
    if (lockAcquired) {
      try {
        await db.query("SELECT pg_advisory_unlock($1)", [74017101]);
      } catch (unlockError) {
        console.warn("[ai-marketing-runner] advisory unlock failed", unlockError?.message || unlockError);
      }
    }
    aiMarketingAutomationRunnerRunning = false;
  }
};

export const startAiMarketingAutomationRunner = () => {
  if (globalThis.__aiMarketingAutomationRunner?.started) return;
  if (aiMarketingAutomationRunnerStarted) return;
  aiMarketingAutomationRunnerStarted = true;
  console.log("[ai-marketing-runner] started", { intervalMs: AI_MARKETING_AUTOMATION_INTERVAL_MS });
  const run = () => {
    void runAiMarketingAutomationBackgroundScan();
  };
  aiMarketingAutomationRunnerTimer = setInterval(run, AI_MARKETING_AUTOMATION_INTERVAL_MS);
  if (typeof aiMarketingAutomationRunnerTimer.unref === "function") aiMarketingAutomationRunnerTimer.unref();
  globalThis.__aiMarketingAutomationRunner = { started: true, timer: aiMarketingAutomationRunnerTimer };
  run();
};

export const stopAiMarketingAutomationRunner = () => {
  if (aiMarketingAutomationRunnerTimer) {
    clearInterval(aiMarketingAutomationRunnerTimer);
    aiMarketingAutomationRunnerTimer = null;
  }
  if (globalThis.__aiMarketingAutomationRunner?.timer && globalThis.__aiMarketingAutomationRunner.timer !== aiMarketingAutomationRunnerTimer) {
    clearInterval(globalThis.__aiMarketingAutomationRunner.timer);
  }
  globalThis.__aiMarketingAutomationRunner = { started: false, timer: null };
  aiMarketingAutomationRunnerStarted = false;
  aiMarketingAutomationRunnerRunning = false;
};

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

const tableExists = async (tableName) => {
  const result = await db.query("SELECT to_regclass($1) AS regclass", [`public.${tableName}`]);
  return Boolean(result.rows[0]?.regclass);
};

const getTableColumns = async (tableName) => {
  if (!(await tableExists(tableName))) return new Set();
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const columnExpr = (alias, columns, names = [], fallback = "NULL") => {
  const found = names.find((name) => columns.has(name));
  return found ? `${alias}.${found}` : fallback;
};

const nullIfTextExpr = (alias, columns, names = []) => {
  const parts = names.filter((name) => columns.has(name)).map((name) => `NULLIF(${alias}.${name}::text, '')`);
  return parts.length ? `COALESCE(${parts.join(", ")}, '')` : "''";
};

const loadStoryTriggerSalesSignals = async (tenantId) => {
  if (!(await tableExists("order_items"))) return new Map();
  const itemColumns = await getTableColumns("order_items");
  if (!itemColumns.has("product_id")) return new Map();
  const orderColumns = await getTableColumns("orders");
  const hasOrders = orderColumns.size > 0;
  if (!itemColumns.has("tenant_id") && !(hasOrders && orderColumns.has("tenant_id"))) return new Map();
  const quantityExpr = itemColumns.has("quantity") ? "COALESCE(oi.quantity, 1)" : "1";
  const tenantClause = itemColumns.has("tenant_id")
    ? "oi.tenant_id = $1::bigint"
    : hasOrders && orderColumns.has("tenant_id")
      ? "o.tenant_id = $1::bigint"
      : "$1::bigint IS NOT NULL";
  const dateClause = hasOrders && orderColumns.has("created_at")
    ? "AND o.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'"
    : "";
  const statusClause = hasOrders && orderColumns.has("status")
    ? "AND COALESCE(o.status, '') NOT IN ('cancelled','canceled','refunded','failed')"
    : "";
  const joinOrders = hasOrders && itemColumns.has("order_id") ? "LEFT JOIN orders o ON o.id = oi.order_id" : "";
  try {
    const result = await db.query(
      `
      SELECT oi.product_id::bigint AS product_id, COALESCE(SUM(${quantityExpr}), 0)::int AS sold_qty
      FROM order_items oi
      ${joinOrders}
      WHERE oi.product_id IS NOT NULL
        AND ${tenantClause}
        ${dateClause}
        ${statusClause}
      GROUP BY oi.product_id
      `,
      [tenantId]
    );
    return new Map(result.rows.map((row) => [String(row.product_id), Number(row.sold_qty || 0)]));
  } catch (error) {
    console.warn("[story-triggers] sales signal skipped", error?.message || error);
    return new Map();
  }
};

const loadStoryTriggerInterestSignals = async (tenantId) => {
  if (!(await tableExists("marketing_attribution_events"))) return new Map();
  const columns = await getTableColumns("marketing_attribution_events");
  if (!columns.has("product_id") || !columns.has("event_type")) return new Map();
  if (!columns.has("tenant_id")) return new Map();
  const tenantClause = columns.has("tenant_id") ? "tenant_id = $1::bigint" : "$1::bigint IS NOT NULL";
  const dateClause = columns.has("created_at") ? "AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'" : "";
  try {
    const result = await db.query(
      `
      SELECT
        product_id::bigint AS product_id,
        COUNT(*) FILTER (WHERE event_type IN ('view_product','product_view','view','click'))::int AS views,
        COUNT(*) FILTER (WHERE event_type IN ('add_to_cart','cart_add','cart'))::int AS carts,
        COUNT(*) FILTER (WHERE event_type IN ('order_created','purchase','checkout'))::int AS conversions
      FROM marketing_attribution_events
      WHERE product_id IS NOT NULL
        AND ${tenantClause}
        ${dateClause}
      GROUP BY product_id
      `,
      [tenantId]
    );
    return new Map(result.rows.map((row) => [String(row.product_id), {
      views: Number(row.views || 0),
      carts: Number(row.carts || 0),
      conversions: Number(row.conversions || 0),
    }]));
  } catch (error) {
    console.warn("[story-triggers] interest signal skipped", error?.message || error);
    return new Map();
  }
};

const loadStoryTriggerProductSignals = async (tenantId) => {
  if (!(await tableExists("products"))) return [];
  const productColumns = await getTableColumns("products");
  const variantColumns = await getTableColumns("product_variants");
  const hasVariants = variantColumns.size > 0;
  const productNameExpr = columnExpr("p", productColumns, ["name", "title", "product_name"], "'Product ' || p.id::text");
  const productImageExpr = nullIfTextExpr("p", productColumns, ["image_url", "image", "photo_url", "thumbnail_url"]);
  const productStockExpr = productColumns.has("stock") ? "GREATEST(COALESCE(p.stock, 0), 0)" : "0";
  const thresholdParts = ["product_low_stock_threshold", "low_stock_alert", "min_stock", "reorder_level"]
    .filter((name) => productColumns.has(name))
    .map((name) => `NULLIF(p.${name}, 0)`);
  const thresholdExpr = `COALESCE(${thresholdParts.length ? `${thresholdParts.join(", ")}, ` : ""}5)`;
  const createdAtExpr = productColumns.has("created_at") ? "p.created_at" : "CURRENT_TIMESTAMP";
  const tenantClause = productColumns.has("tenant_id") ? "AND (p.tenant_id = $1::bigint OR p.tenant_id IS NULL)" : "";
  const activeClause = [
    productColumns.has("is_active") ? "p.is_active IS DISTINCT FROM FALSE" : null,
    productColumns.has("deleted_at") ? "p.deleted_at IS NULL" : null,
    productColumns.has("status") ? "COALESCE(p.status, 'active') NOT IN ('deleted','archived','inactive')" : null,
  ].filter(Boolean).join(" AND ");
  const variantJoin = hasVariants
    ? `
      LEFT JOIN product_variants v
        ON v.product_id = p.id
        ${variantColumns.has("tenant_id") ? "AND (v.tenant_id = $1::bigint OR v.tenant_id IS NULL)" : ""}
        ${variantColumns.has("is_active") ? "AND v.is_active IS DISTINCT FROM FALSE" : ""}
        ${variantColumns.has("deleted_at") ? "AND v.deleted_at IS NULL" : ""}
    `
    : "";
  const variantTotalExpr = hasVariants && variantColumns.has("stock")
    ? `COALESCE(SUM(GREATEST(COALESCE(v.stock, 0), 0)) FILTER (WHERE v.id IS NOT NULL), ${productStockExpr})`
    : productStockExpr;
  const variantsJsonExpr = hasVariants
    ? `
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', v.id,
            'size', ${variantColumns.has("size") ? "v.size" : "NULL"},
            'color', ${variantColumns.has("color") ? "v.color" : "NULL"},
            'stock', ${variantColumns.has("stock") ? "COALESCE(v.stock, 0)" : "0"},
            'threshold', ${variantColumns.has("low_stock_alert") ? "COALESCE(NULLIF(v.low_stock_alert, 0), 2)" : "2"}
          )
          ORDER BY ${variantColumns.has("stock") ? "COALESCE(v.stock, 0)" : "v.id"} ASC
        ) FILTER (WHERE v.id IS NOT NULL),
        '[]'::jsonb
      )
    `
    : "'[]'::jsonb";
  try {
    const result = await db.query(
      `
      SELECT
        p.id::bigint AS product_id,
        ${productNameExpr} AS product_name,
        ${productImageExpr} AS product_image,
        ${variantTotalExpr}::int AS total_stock,
        ${thresholdExpr}::int AS low_stock_threshold,
        ${createdAtExpr} AS created_at,
        ${variantsJsonExpr} AS variants_json
      FROM products p
      ${variantJoin}
      WHERE p.id IS NOT NULL
        ${tenantClause}
        ${activeClause ? `AND ${activeClause}` : ""}
      GROUP BY p.id
      ORDER BY p.id DESC
      LIMIT 300
      `,
      [tenantId]
    );
    return result.rows.map((row) => ({
      ...row,
      total_stock: Number(row.total_stock || 0),
      low_stock_threshold: Number(row.low_stock_threshold || 5),
      variants: safeJson(row.variants_json, []),
    }));
  } catch (error) {
    console.warn("[story-triggers] product signal scan skipped", error?.message || error);
    return [];
  }
};

const storyTriggerCampaignDefaults = (triggerType) => {
  const map = {
    last_piece: { campaignType: "last_piece", storyCount: 4, visualStyle: "Aggressive Sale", ctaGoal: "Order Now" },
    low_stock: { campaignType: "low_stock", storyCount: 4, visualStyle: "Aggressive Sale", ctaGoal: "Order Now" },
    size_urgency: { campaignType: "size_urgency", storyCount: 4, visualStyle: "Streetwear", ctaGoal: "DM" },
    new_arrival: { campaignType: "new_arrival", storyCount: 4, visualStyle: "Luxury", ctaGoal: "Website" },
    trending_product: { campaignType: "trending", storyCount: 5, visualStyle: "Streetwear", ctaGoal: "Website" },
    slow_moving: { campaignType: "offer", storyCount: 4, visualStyle: "Minimal", ctaGoal: "Order Now" },
    high_interest_low_sales: { campaignType: "trending", storyCount: 5, visualStyle: "Dark", ctaGoal: "Website" },
  };
  return map[triggerType] || map.new_arrival;
};

const makeStoryTriggerSuggestion = ({ triggerType, product, variant = null, score, reason, snapshot = {} }) => {
  const normalizedType = normalizeStoryTriggerType(triggerType);
  const defaults = storyTriggerCampaignDefaults(normalizedType);
  const productName = product.product_name || `Product ${product.product_id}`;
  const titleMap = {
    last_piece: `Last piece story for ${productName}`,
    low_stock: `Low stock story for ${productName}`,
    size_urgency: `Size urgency story for ${productName}`,
    new_arrival: `New arrival story for ${productName}`,
    trending_product: `Trending story for ${productName}`,
    slow_moving: `Move stock with a story for ${productName}`,
    high_interest_low_sales: `High interest story for ${productName}`,
  };
  const signalScore = Math.max(0, Math.min(100, Math.round(Number(score || 0))));
  return {
    trigger_type: normalizedType,
    product_id: product.product_id,
    variant_id: variant?.id || null,
    title: titleMap[normalizedType] || `Story opportunity for ${productName}`,
    reason,
    priority: normalizedType === "size_urgency" && signalScore >= 70 ? "high" : priorityForScore(signalScore),
    signal_score: signalScore,
    signal_snapshot: {
      product_name: productName,
      product_image: product.product_image || "",
      total_stock: product.total_stock,
      total_product_stock: product.total_stock,
      low_stock_threshold: product.low_stock_threshold,
      variant: variant ? {
        id: variant.id,
        size: variant.size || "",
        color: variant.color || "",
        stock: Number(variant.stock || 0),
      } : null,
      ...snapshot,
    },
    suggested_campaign_type: defaults.campaignType,
    suggested_story_count: defaults.storyCount,
    suggested_visual_style: defaults.visualStyle,
    suggested_cta_goal: defaults.ctaGoal,
  };
};

const normalizeCriticalSize = (variant = {}) => {
  const stock = Number(variant.stock || 0);
  return {
    id: variant.id || variant.variant_id || null,
    size: String(variant.size || "").trim(),
    color: String(variant.color || "").trim(),
    stock,
  };
};

const topLowStockVariants = (product = {}, threshold = 3) =>
  (Array.isArray(product.variants) ? product.variants : [])
    .map(normalizeCriticalSize)
    .filter((variant) => variant.stock > 0 && variant.stock <= threshold)
    .sort((left, right) => left.stock - right.stock || left.size.localeCompare(right.size) || left.color.localeCompare(right.color))
    .slice(0, 3);

const buildStoryTriggerCandidates = ({ products = [], salesSignals = new Map(), interestSignals = new Map() }) => {
  const suggestions = [];
  const now = Date.now();
  products.forEach((product) => {
    const totalStock = Number(product.total_stock || 0);
    const threshold = Math.max(2, Number(product.low_stock_threshold || 5));
    const productKey = String(product.product_id);
    const soldQty = Number(salesSignals.get(productKey) || 0);
    const interest = interestSignals.get(productKey) || { views: 0, carts: 0, conversions: 0 };
    const createdAt = product.created_at ? new Date(product.created_at).getTime() : 0;
    const ageDays = createdAt ? Math.floor((now - createdAt) / 86400000) : null;

    if (totalStock > 0 && totalStock <= 3) {
      const lastPieceVariants = topLowStockVariants(product, threshold);
      suggestions.push(makeStoryTriggerSuggestion({
        triggerType: "last_piece",
        product,
        score: Math.max(95, 101 - totalStock),
        reason: `Only ${totalStock} total pieces left across all colors and sizes.`,
        snapshot: {
          sold_qty_30d: soldQty,
          views_30d: interest.views,
          carts_30d: interest.carts,
          total_product_stock: totalStock,
          lastPieceVariants,
        },
      }));
    } else if (totalStock <= threshold) {
      const severity = Math.max(0, threshold - totalStock);
      const lastPieceVariants = topLowStockVariants(product, threshold);
      suggestions.push(makeStoryTriggerSuggestion({
        triggerType: "low_stock",
        product,
        score: Math.min(90, 75 + severity * 3),
        reason: `${totalStock} pieces left, below the low-stock threshold of ${threshold}.`,
        snapshot: {
          sold_qty_30d: soldQty,
          views_30d: interest.views,
          carts_30d: interest.carts,
          total_product_stock: totalStock,
          lastPieceVariants,
        },
      }));
    }

    const criticalSizes = (Array.isArray(product.variants) ? product.variants : [])
      .filter((variant) => {
        const stock = Number(variant.stock || 0);
        return stock > 0 && stock <= 2 && totalStock > 3;
      })
      .map(normalizeCriticalSize)
      .sort((left, right) => left.stock - right.stock || left.size.localeCompare(right.size) || left.color.localeCompare(right.color));

    if (criticalSizes.length) {
      const preview = criticalSizes
        .slice(0, 3)
        .map((item) => [item.size, item.color].filter(Boolean).join(" / ") || "variant")
        .join(", ");
      suggestions.push(makeStoryTriggerSuggestion({
        triggerType: "size_urgency",
        product,
        score: Math.min(75, 55 + criticalSizes.length * 5 + (criticalSizes.some((item) => item.stock === 1) ? 10 : 0)),
        reason: `${criticalSizes.length} size/color ${criticalSizes.length === 1 ? "option is" : "options are"} nearly sold out while total product stock is ${totalStock}. ${preview}`,
        snapshot: {
          sold_qty_30d: soldQty,
          total_product_stock: totalStock,
          affected_sizes_count: criticalSizes.length,
          critical_sizes: criticalSizes,
        },
      }));
    }

    if (ageDays !== null && ageDays >= 0 && ageDays <= 14 && totalStock > 0) {
      suggestions.push(makeStoryTriggerSuggestion({
        triggerType: "new_arrival",
        product,
        score: Math.max(60, 80 - ageDays),
        reason: `Created ${ageDays === 0 ? "today" : `${ageDays} days ago`}; good timing for a launch story.`,
        snapshot: { age_days: ageDays, total_stock: totalStock },
      }));
    }

    if (soldQty >= 3 && totalStock > 0) {
      suggestions.push(makeStoryTriggerSuggestion({
        triggerType: "trending_product",
        product,
        score: Math.min(90, 70 + soldQty * 3),
        reason: `${soldQty} units sold in the recent sales window.`,
        snapshot: { sold_qty_30d: soldQty, total_stock: totalStock },
      }));
    }

    if (salesSignals.size > 0 && totalStock >= Math.max(5, threshold) && soldQty === 0) {
      suggestions.push(makeStoryTriggerSuggestion({
        triggerType: "slow_moving",
        product,
        score: Math.min(75, 50 + Math.min(25, totalStock)),
        reason: `${totalStock} units are available with no recent sales detected.`,
        snapshot: { sold_qty_30d: soldQty, total_stock: totalStock },
      }));
    }

    const interestTotal = Number(interest.views || 0) + Number(interest.carts || 0) * 3;
    const weakOrders = soldQty + Number(interest.conversions || 0);
    if (interestSignals.size > 0 && interestTotal >= 8 && weakOrders <= 1 && totalStock > 0) {
      suggestions.push(makeStoryTriggerSuggestion({
        triggerType: "high_interest_low_sales",
        product,
        score: Math.min(95, 80 + Math.min(15, Math.floor(interestTotal / 4))),
        reason: `${interest.views} views and ${interest.carts} cart signals with weak sales conversion.`,
        snapshot: { views_30d: interest.views, carts_30d: interest.carts, conversions_30d: interest.conversions, sold_qty_30d: soldQty },
      }));
    }
  });

  const seen = new Set();
  return suggestions
    .filter((item) => {
      const key = `${item.trigger_type}:${item.product_id || 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      (STORY_TRIGGER_PRIORITY_WEIGHT[right.priority] || 0) - (STORY_TRIGGER_PRIORITY_WEIGHT[left.priority] || 0) ||
      right.signal_score - left.signal_score
    )
    .slice(0, 30);
};

const refreshStoryTriggerSuggestionsForTenant = async (tenantId) => {
  console.info("[marketing-story-triggers] refresh scanner start", { tenant_id: tenantId });
  const [products, salesSignals, interestSignals] = await Promise.all([
    loadStoryTriggerProductSignals(tenantId),
    loadStoryTriggerSalesSignals(tenantId),
    loadStoryTriggerInterestSignals(tenantId),
  ]);
  const candidates = buildStoryTriggerCandidates({ products, salesSignals, interestSignals });
  const activeKeys = new Set();
  let created = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const key = `${candidate.trigger_type}:${candidate.product_id || 0}:${candidate.variant_id || 0}`;
    activeKeys.add(key);
    const existing = await db.query(
      `
      SELECT *
      FROM marketing_story_trigger_suggestions
      WHERE tenant_id = $1::bigint
        AND trigger_type = $2
        AND COALESCE(product_id, 0) = COALESCE($3::bigint, 0)
        AND status IN ('pending','generated','dismissed')
      ORDER BY
        CASE WHEN COALESCE(variant_id, 0) = COALESCE($4::bigint, 0) THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1
      `,
      [tenantId, candidate.trigger_type, candidate.product_id, candidate.variant_id]
    );
    const prior = existing.rows[0];
    if (prior?.status === "dismissed") {
      const oldSnapshot = safeJsonObject(prior.signal_snapshot_json, {});
      const oldScore = Number(prior.signal_score || 0);
      const signalChanged = Math.abs(oldScore - candidate.signal_score) >= 12 ||
        Number(oldSnapshot.total_product_stock ?? oldSnapshot.total_stock ?? -1) !== Number(candidate.signal_snapshot.total_product_stock ?? candidate.signal_snapshot.total_stock ?? -1) ||
        JSON.stringify(oldSnapshot.critical_sizes || []) !== JSON.stringify(candidate.signal_snapshot.critical_sizes || []);
      if (!signalChanged) continue;
    }
    if (prior) {
      await db.query(
        `
        UPDATE marketing_story_trigger_suggestions
        SET title = $3,
            reason = $4,
            priority = $5,
            signal_score = $6,
            signal_snapshot_json = $7::jsonb,
            suggested_campaign_type = $8,
            suggested_story_count = $9,
            suggested_visual_style = $10,
            suggested_cta_goal = $11,
            variant_id = $12,
            status = CASE WHEN status = 'generated' THEN status ELSE 'pending' END,
            dismissed_at = CASE WHEN status = 'dismissed' THEN NULL ELSE dismissed_at END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::bigint
          AND tenant_id = $2::bigint
        `,
        [
          prior.id,
          tenantId,
          candidate.title,
          candidate.reason,
          candidate.priority,
          candidate.signal_score,
          JSON.stringify(candidate.signal_snapshot),
          candidate.suggested_campaign_type,
          candidate.suggested_story_count,
          candidate.suggested_visual_style,
          candidate.suggested_cta_goal,
          candidate.variant_id,
        ]
      );
      updated += 1;
    } else {
      await db.query(
        `
        INSERT INTO marketing_story_trigger_suggestions (
          tenant_id, trigger_type, product_id, variant_id, title, reason, priority, signal_score,
          signal_snapshot_json, suggested_campaign_type, suggested_story_count, suggested_visual_style, suggested_cta_goal, status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,'pending')
        `,
        [
          tenantId,
          candidate.trigger_type,
          candidate.product_id,
          candidate.variant_id,
          candidate.title,
          candidate.reason,
          candidate.priority,
          candidate.signal_score,
          JSON.stringify(candidate.signal_snapshot),
          candidate.suggested_campaign_type,
          candidate.suggested_story_count,
          candidate.suggested_visual_style,
          candidate.suggested_cta_goal,
        ]
      );
      created += 1;
    }
  }

  const activeRows = await db.query(
    `
    SELECT id, trigger_type, product_id, variant_id
    FROM marketing_story_trigger_suggestions
    WHERE tenant_id = $1::bigint
      AND status = 'pending'
    `,
    [tenantId]
  );
  const expiredIds = activeRows.rows
    .filter((row) => !activeKeys.has(`${row.trigger_type}:${row.product_id || 0}:${row.variant_id || 0}`))
    .map((row) => row.id);
  if (expiredIds.length) {
    await db.query(
      `
      UPDATE marketing_story_trigger_suggestions
      SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1::bigint
        AND id = ANY($2::bigint[])
      `,
      [tenantId, expiredIds]
    );
  }

  const summary = { created, updated, expired: expiredIds.length, scanned_products: products.length, candidates: candidates.length };
  console.info("[marketing-story-triggers] refresh scanner complete", { tenant_id: tenantId, ...summary });
  return summary;
};

const normalizeSuggestionRow = (row = {}) => ({
  id: String(row.id || `${row.type || "suggestion"}-${row.product_id || "general"}`),
  type: row.type || "general",
  priority: Number(row.priority || 0),
  title: row.title || "",
  description: row.description || "",
  product_id: row.product_id ?? null,
  product_name: row.product_name || "",
  product_image: row.product_image || "",
  reason: row.reason || "",
  recommended_content_type: row.recommended_content_type || "Feed Post",
  recommended_tone: row.recommended_tone || "Hype",
  recommended_platforms: Array.isArray(row.recommended_platforms) ? row.recommended_platforms : ["facebook", "instagram"],
  action_label: row.action_label || "Generate Content",
  metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {},
});

const pushUniqueSuggestions = (target, rows = []) => {
  const seen = new Set(target.map((item) => `${item.type}:${item.product_id || item.id}`));
  rows.forEach((row) => {
    const normalized = normalizeSuggestionRow(row);
    const key = `${normalized.type}:${normalized.product_id || normalized.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    target.push(normalized);
  });
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

const resolveProductPostData = (productRow = {}, variantRows = [], brandIdentity = {}) => {
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
  const mediaUrls = collectProductMarketingMediaUrls(productRow, variantRows);

  return applyBrandIdentityToCreative({
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
  }, brandIdentity);
};

const getProductStoryCreative = (productRow = {}, variantRows = [], brandIdentity = {}) => {
  const generated = resolveProductPostData(productRow, variantRows, brandIdentity);
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
      variant.primary_image_url,
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

const collectProductMarketingMediaUrls = (productRow = {}, variantRows = []) =>
  uniqueList([
    ...collectVariantMediaUrls(variantRows),
    productRow.image_url,
    productRow.product_image_url,
    ...collectGalleryMediaUrls(productRow, []),
  ]);

const fetchProductBundle = async (productId, tenantId) => {
  await ensureProductVariantImagesSchema();
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
      COALESCE(
        NULLIF((
          SELECT vi.image_url
          FROM product_variant_images vi
          WHERE vi.product_id = v.product_id
            AND NULLIF(TRIM(vi.image_url), '') IS NOT NULL
            AND (
              vi.variant_id = v.id
              OR LOWER(TRIM(vi.color_name)) = LOWER(TRIM(COALESCE(v.color, '')))
            )
          ORDER BY vi.is_primary DESC, vi.sort_order ASC, vi.id ASC
          LIMIT 1
        ), ''),
        NULLIF(v.image_url, ''),
        ''
      ) AS variant_image_url,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'image_url', vi.image_url,
            'color_name', vi.color_name,
            'color_value', vi.color_value,
            'sort_order', vi.sort_order,
            'is_primary', vi.is_primary
          )
          ORDER BY vi.is_primary DESC, vi.sort_order ASC, vi.id ASC
        )
        FROM product_variant_images vi
        WHERE vi.product_id = v.product_id
          AND NULLIF(TRIM(vi.image_url), '') IS NOT NULL
          AND (
            vi.variant_id = v.id
            OR LOWER(TRIM(vi.color_name)) = LOWER(TRIM(COALESCE(v.color, '')))
          )
      ), '[]'::jsonb) AS images
    FROM product_variants v
    WHERE v.product_id = $1
      AND ($2::bigint IS NULL OR v.tenant_id = $2::bigint OR v.tenant_id IS NULL)
      AND v.is_active IS DISTINCT FROM FALSE
      AND v.deleted_at IS NULL
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

  assertMarketingChannelIsEnabled(post.channel);
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

const publishStoryJob = async ({ postId, tenantId }) => {
  const scopedTenantId = Number(tenantId || 0);
  const postResult = await db.query(
    `
    SELECT *
    FROM marketing_posts
    WHERE id = $1::bigint
      AND tenant_id = $2::bigint
    LIMIT 1
    `,
    [postId, scopedTenantId]
  );
  const post = postResult.rows[0];
  if (!post) {
    const error = new Error("Scheduled story post not found");
    error.status = 404;
    throw error;
  }

  try {
    return await publishStoryForRow(post, scopedTenantId);
  } catch (error) {
    await db.query(
      `
      UPDATE marketing_posts
      SET story_status = 'failed', story_error_message = $1::text, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2::bigint
        AND tenant_id = $3::bigint
      `,
      [error?.message || "Scheduled story publish failed", post.id, scopedTenantId]
    );
    throw error;
  }
};

let marketingJobsRegistered = false;

export const registerMarketingJobHandlers = () => {
  if (marketingJobsRegistered) return;
  marketingJobsRegistered = true;

  registerJobHandler("social.publish", async (payload = {}) => {
    return publishAndPersist(payload.postId || payload.post_id, payload.tenantId || payload.tenant_id);
  });

  registerJobHandler("story.publish", async (payload = {}) => {
    return publishStoryJob({
      postId: payload.postId || payload.post_id,
      tenantId: payload.tenantId || payload.tenant_id,
    });
  });
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

export const getAiCenterSuggestions = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const suggestions = [];

    const [productColumns, variantColumns, orderColumns, orderItemColumns, recentlyViewedColumns, sessionColumns] = await Promise.all([
      getTableColumns("products"),
      getTableColumns("product_variants"),
      getTableColumns("orders"),
      getTableColumns("order_items"),
      getTableColumns("recently_viewed_products"),
      getTableColumns("storefront_customer_sessions"),
    ]);

    const hasProducts = productColumns.size > 0;
    const hasVariants = variantColumns.size > 0;
    const hasOrders = orderColumns.has("id") && orderColumns.has("tenant_id") && orderColumns.has("created_at");
    const hasOrderItems = orderItemColumns.has("tenant_id") && orderItemColumns.has("order_id") && orderItemColumns.has("product_id") && orderItemColumns.has("quantity");
    const hasViews = recentlyViewedColumns.has("tenant_id") && recentlyViewedColumns.has("product_id") && recentlyViewedColumns.has("viewed_at");
    const hasSessions = sessionColumns.has("tenant_id") && sessionColumns.has("cart_items") && sessionColumns.has("updated_at");
    const hasStockedVariants = hasVariants && variantColumns.has("product_id") && variantColumns.has("stock");

    if (!hasProducts) {
      return res.json({ success: true, data: [] });
    }

    const activeProductSql = productColumns.has("status")
      ? "COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive','disabled','archived','deleted','draft')"
      : "TRUE";
    const productImageBase = productColumns.has("image_url") ? "NULLIF(p.image_url, '')" : "NULL";
    const hasProductStock = productColumns.has("stock");
    const productLowStockThresholdExpr = productColumns.has("product_low_stock_threshold") ? "COALESCE(NULLIF(p.product_low_stock_threshold, 0), 0)" : "0";
    const productLowStockAlertExpr = productColumns.has("low_stock_alert") ? "COALESCE(NULLIF(p.low_stock_alert, 0), 0)" : "0";
    const productStockExpr = hasProductStock ? "COALESCE(p.stock, 0)" : "0";
    const productCreatedExpr = productColumns.has("created_at") ? "p.created_at" : "CURRENT_TIMESTAMP";
    const productUpdatedOrder = productColumns.has("updated_at") ? "p.updated_at DESC NULLS LAST," : "";
    const styleExpr = productColumns.has("style") ? "p.style" : "''";
    const productTypeExpr = productColumns.has("product_type") ? "p.product_type" : "''";
    const variantImageSql = hasVariants && variantColumns.has("image_url")
      ? `
        NULLIF((
          SELECT pv2.image_url
          FROM product_variants pv2
          WHERE pv2.product_id = p.id
            ${variantColumns.has("deleted_at") ? "AND pv2.deleted_at IS NULL" : ""}
            AND NULLIF(pv2.image_url, '') IS NOT NULL
          ORDER BY ${variantColumns.has("stock") ? "pv2.stock DESC NULLS LAST," : ""} pv2.id DESC
          LIMIT 1
        ), '')
      `
      : "NULL";
    const imageSql = `COALESCE(${productImageBase}, ${variantImageSql}, '')`;
    const variantTenantClause = variantColumns.has("tenant_id") ? "AND v.tenant_id = $1::bigint" : "";
    const variantActiveClause = variantColumns.has("is_active") ? "AND COALESCE(v.is_active, TRUE) = TRUE" : "";
    const variantDeletedClause = variantColumns.has("deleted_at") ? "AND v.deleted_at IS NULL" : "";
    const variantImageExpr = variantColumns.has("image_url") ? "COALESCE(NULLIF(v.image_url, ''), " + imageSql + ")" : imageSql;
    const variantColorExpr = variantColumns.has("color") ? "COALESCE(v.color, '')" : "''";
    const variantSizeExpr = variantColumns.has("size") ? "COALESCE(v.size, '')" : "''";
    const variantLowStockExpr = variantColumns.has("low_stock_alert") ? "MIN(NULLIF(v.low_stock_alert, 0))" : "NULL::integer";

    if (hasStockedVariants) {
      const lastPieceResult = await db.query(
        `
        SELECT
          CONCAT('last_piece-product-', p.id) AS id,
          'last_piece' AS type,
          100 AS priority,
          CASE WHEN last_piece_summary.low_count = 1 THEN 'Last piece available' ELSE CONCAT('Last ', LEAST(last_piece_summary.low_count, 3), ' pieces') END AS title,
          CONCAT(p.name, ' has ', last_piece_summary.low_count, ' low-stock variant', CASE WHEN last_piece_summary.low_count = 1 THEN '' ELSE 's' END, '. Push it before it sells out.') AS description,
          p.id AS product_id,
          p.name AS product_name,
          COALESCE(NULLIF(last_piece_summary.first_image, ''), ${imageSql}) AS product_image,
          CASE WHEN last_piece_summary.low_count = 1 THEN 'Last piece' ELSE CONCAT('Last ', LEAST(last_piece_summary.low_count, 3), ' low-stock variants') END AS reason,
          'Story' AS recommended_content_type,
          'Urgent Sale' AS recommended_tone,
          ARRAY['facebook','instagram'] AS recommended_platforms,
          'Generate Content' AS action_label,
          jsonb_build_object(
            'stock', last_piece_summary.low_count,
            'source', 'product_variants',
            'lastPieceVariants', last_piece_summary.variants_json
          ) AS metadata
        FROM products p
        JOIN LATERAL (
          SELECT
            COUNT(*)::int AS low_count,
            MAX(NULLIF(limited_variants.image_url, '')) AS first_image,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', limited_variants.id,
                  'variant_id', limited_variants.id,
                  'stock', limited_variants.stock,
                  'qty', limited_variants.stock,
                  'color', limited_variants.color,
                  'size', limited_variants.size,
                  'image', limited_variants.image_url,
                  'price', limited_variants.price,
                  'sale_price', limited_variants.sale_price
                )
                ORDER BY limited_variants.stock ASC, limited_variants.id ASC
              ),
              '[]'::jsonb
            ) AS variants_json
          FROM (
            SELECT
              v.id,
              COALESCE(v.stock, 0)::int AS stock,
              ${variantColorExpr} AS color,
              ${variantSizeExpr} AS size,
              ${variantColumns.has("image_url") ? "COALESCE(NULLIF(v.image_url, ''), '')" : "''"} AS image_url,
              ${variantColumns.has("price") ? "v.price" : "NULL"} AS price,
              ${variantColumns.has("sale_price") ? "v.sale_price" : "NULL"} AS sale_price
            FROM product_variants v
            WHERE v.product_id = p.id
              ${variantTenantClause}
              ${variantActiveClause}
              ${variantDeletedClause}
              AND COALESCE(v.stock, 0) > 0
              AND COALESCE(v.stock, 0) <= 1
            ORDER BY COALESCE(v.stock, 0) ASC, v.id ASC
            LIMIT 3
          ) limited_variants
        ) last_piece_summary ON TRUE
        WHERE p.tenant_id = $1::bigint
          AND ${activeProductSql}
          AND last_piece_summary.low_count > 0
        ORDER BY last_piece_summary.low_count DESC, ${productUpdatedOrder} p.id DESC
        LIMIT 4
        `,
        [tenantId]
      );
      pushUniqueSuggestions(suggestions, lastPieceResult.rows);
    }

    if (hasProductStock) {
    const productLastPieceResult = await db.query(
      `
      SELECT
        CONCAT('last_piece-product-', p.id) AS id,
        'last_piece' AS type,
        96 AS priority,
        'Last piece available' AS title,
        CONCAT(p.name, ' has one piece left in product stock.') AS description,
        p.id AS product_id,
        p.name AS product_name,
        ${imageSql} AS product_image,
        'Product stock is exactly 1' AS reason,
        'Feed Post' AS recommended_content_type,
        'Urgent Sale' AS recommended_tone,
        ARRAY['facebook','instagram'] AS recommended_platforms,
        'Generate Content' AS action_label,
        jsonb_build_object('stock', ${productStockExpr}, 'source', 'products') AS metadata
      FROM products p
      WHERE p.tenant_id = $1::bigint
        AND ${activeProductSql}
        AND ${productStockExpr} = 1
      ORDER BY ${productUpdatedOrder} p.id DESC
      LIMIT 3
      `,
      [tenantId]
    );
    pushUniqueSuggestions(suggestions, productLastPieceResult.rows);
    }

    if (hasStockedVariants) {
      const lowStockResult = await db.query(
        `
        SELECT
          CONCAT('low_stock-', p.id) AS id,
          'low_stock' AS type,
          86 AS priority,
          'Low stock needs attention' AS title,
          CONCAT(p.name, ' is below its low-stock threshold.') AS description,
          p.id AS product_id,
          p.name AS product_name,
          ${imageSql} AS product_image,
          CONCAT('Available stock: ', stock_summary.total_stock, ', threshold: ', stock_summary.threshold) AS reason,
          'Story' AS recommended_content_type,
          'Urgent Sale' AS recommended_tone,
          ARRAY['facebook','instagram'] AS recommended_platforms,
          'Generate Content' AS action_label,
          jsonb_build_object('stock', stock_summary.total_stock, 'threshold', stock_summary.threshold, 'source', 'products/product_variants') AS metadata
        FROM products p
        JOIN LATERAL (
          SELECT
              COALESCE(SUM(GREATEST(v.stock, 0)), ${productStockExpr})::int AS total_stock,
              GREATEST(
              ${productLowStockThresholdExpr},
              ${productLowStockAlertExpr},
              COALESCE(NULLIF(${variantLowStockExpr}, 0), 0),
              3
            )::int AS threshold
          FROM product_variants v
          WHERE v.product_id = p.id
            ${variantTenantClause}
            ${variantActiveClause}
            ${variantDeletedClause}
        ) stock_summary ON TRUE
        WHERE p.tenant_id = $1::bigint
          AND ${activeProductSql}
          AND stock_summary.total_stock > 1
          AND stock_summary.total_stock <= stock_summary.threshold
        ORDER BY stock_summary.total_stock ASC, ${productUpdatedOrder} p.id DESC
        LIMIT 4
        `,
        [tenantId]
      );
      pushUniqueSuggestions(suggestions, lowStockResult.rows);
    } else if (hasProductStock) {
      const lowStockResult = await db.query(
        `
        SELECT
          CONCAT('low_stock-product-', p.id) AS id,
          'low_stock' AS type,
          82 AS priority,
          'Low stock needs attention' AS title,
          CONCAT(p.name, ' is below its low-stock threshold.') AS description,
          p.id AS product_id,
          p.name AS product_name,
          ${imageSql} AS product_image,
          CONCAT('Available stock: ', ${productStockExpr}, ', threshold: ', GREATEST(${productLowStockThresholdExpr}, ${productLowStockAlertExpr}, 3)) AS reason,
          'Story' AS recommended_content_type,
          'Urgent Sale' AS recommended_tone,
          ARRAY['facebook','instagram'] AS recommended_platforms,
          'Generate Content' AS action_label,
          jsonb_build_object('stock', ${productStockExpr}, 'source', 'products') AS metadata
        FROM products p
        WHERE p.tenant_id = $1::bigint
          AND ${activeProductSql}
          AND ${productStockExpr} > 1
          AND ${productStockExpr} <= GREATEST(${productLowStockThresholdExpr}, ${productLowStockAlertExpr}, 3)
        ORDER BY ${productStockExpr} ASC, ${productUpdatedOrder} p.id DESC
        LIMIT 4
        `,
        [tenantId]
      );
      pushUniqueSuggestions(suggestions, lowStockResult.rows);
    }

    const newArrivalResult = await db.query(
      `
      SELECT
        CONCAT('new_arrival-', p.id) AS id,
        'new_arrival' AS type,
        62 AS priority,
        'New arrival ready to promote' AS title,
        CONCAT(p.name, ' was recently added to the catalog.') AS description,
        p.id AS product_id,
        p.name AS product_name,
        ${imageSql} AS product_image,
        CONCAT('Created ', TO_CHAR(${productCreatedExpr}, 'Mon DD')) AS reason,
        'Feed Post' AS recommended_content_type,
        CASE
          WHEN LOWER(COALESCE(${styleExpr}, ${productTypeExpr}, '')) LIKE '%street%' THEN 'Streetwear'
          ELSE 'Luxury'
        END AS recommended_tone,
        ARRAY['facebook','instagram'] AS recommended_platforms,
        'Generate Content' AS action_label,
        jsonb_build_object('created_at', ${productCreatedExpr}, 'style', ${styleExpr}, 'product_type', ${productTypeExpr}, 'source', 'products') AS metadata
      FROM products p
      WHERE p.tenant_id = $1::bigint
        AND ${activeProductSql}
        AND ${productCreatedExpr} >= CURRENT_TIMESTAMP - INTERVAL '21 days'
      ORDER BY ${productCreatedExpr} DESC, p.id DESC
      LIMIT 4
      `,
      [tenantId]
    );
    pushUniqueSuggestions(suggestions, newArrivalResult.rows);

    if (hasViews && hasOrders && hasOrderItems) {
      const orderSuccessClause = orderColumns.has("status")
        ? "AND COALESCE(NULLIF(LOWER(o.status), ''), 'completed') NOT IN ('cancelled','canceled','failed','refunded','returned')"
        : "";
      const highViewsResult = await db.query(
        `
        WITH views AS (
          SELECT product_id, COUNT(*)::int AS view_count
          FROM recently_viewed_products
          WHERE tenant_id = $1::bigint
            AND viewed_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
          GROUP BY product_id
        ),
        sales AS (
          SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::int AS sold_qty
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE oi.tenant_id = $1::bigint
            AND o.tenant_id = $1::bigint
            AND o.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
            ${orderSuccessClause}
          GROUP BY oi.product_id
        )
        SELECT
          CONCAT('high_views_low_sales-', p.id) AS id,
          'high_views_low_sales' AS type,
          76 AS priority,
          'High views, low sales' AS title,
          CONCAT(p.name, ' is getting attention but not enough orders.') AS description,
          p.id AS product_id,
          p.name AS product_name,
          ${imageSql} AS product_image,
          CONCAT(views.view_count, ' views and ', COALESCE(sales.sold_qty, 0), ' sold in 30 days') AS reason,
          'Reel Script' AS recommended_content_type,
          'Hype' AS recommended_tone,
          ARRAY['facebook','instagram'] AS recommended_platforms,
          'Generate Content' AS action_label,
          jsonb_build_object('views_30d', views.view_count, 'sold_30d', COALESCE(sales.sold_qty, 0), 'source', 'recently_viewed_products/order_items') AS metadata
        FROM views
        JOIN products p ON p.id = views.product_id
        LEFT JOIN sales ON sales.product_id = views.product_id
        WHERE p.tenant_id = $1::bigint
          AND ${activeProductSql}
          AND views.view_count >= 3
          AND COALESCE(sales.sold_qty, 0) <= 1
        ORDER BY views.view_count DESC, COALESCE(sales.sold_qty, 0) ASC
        LIMIT 4
        `,
        [tenantId]
      );
      pushUniqueSuggestions(suggestions, highViewsResult.rows);
    }

    if (hasSessions && hasOrders && hasOrderItems && sessionColumns.has("cart_items")) {
      const orderSuccessClause = orderColumns.has("status")
        ? "AND COALESCE(NULLIF(LOWER(o.status), ''), 'completed') NOT IN ('cancelled','canceled','failed','refunded','returned')"
        : "";
      const abandonedResult = await db.query(
        `
        WITH cart_products AS (
          SELECT
            COALESCE(
              CASE WHEN COALESCE(item->>'product_id', '') ~ '^[0-9]+$' THEN (item->>'product_id')::bigint END,
              CASE WHEN COALESCE(item->>'productId', '') ~ '^[0-9]+$' THEN (item->>'productId')::bigint END,
              CASE WHEN COALESCE(item->>'id', '') ~ '^[0-9]+$' THEN (item->>'id')::bigint END
            ) AS product_id,
            COUNT(*)::int AS cart_count
          FROM storefront_customer_sessions s
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.cart_items, '[]'::jsonb)) item
          WHERE s.tenant_id = $1::bigint
            AND s.updated_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
          GROUP BY 1
        ),
        sales AS (
          SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::int AS sold_qty
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE oi.tenant_id = $1::bigint
            AND o.tenant_id = $1::bigint
            AND o.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
            ${orderSuccessClause}
          GROUP BY oi.product_id
        )
        SELECT
          CONCAT('abandoned_cart-', p.id) AS id,
          'abandoned_cart' AS type,
          72 AS priority,
          'Cart interest needs a push' AS title,
          CONCAT(p.name, ' is being saved in carts more than it is being purchased.') AS description,
          p.id AS product_id,
          p.name AS product_name,
          ${imageSql} AS product_image,
          CONCAT(cart_products.cart_count, ' cart adds and ', COALESCE(sales.sold_qty, 0), ' sold in 30 days') AS reason,
          'Ad Copy' AS recommended_content_type,
          'Urgent Sale' AS recommended_tone,
          ARRAY['facebook','instagram'] AS recommended_platforms,
          'Generate Content' AS action_label,
          jsonb_build_object('cart_count_30d', cart_products.cart_count, 'sold_30d', COALESCE(sales.sold_qty, 0), 'source', 'storefront_customer_sessions/order_items') AS metadata
        FROM cart_products
        JOIN products p ON p.id = cart_products.product_id
        LEFT JOIN sales ON sales.product_id = cart_products.product_id
        WHERE cart_products.product_id IS NOT NULL
          AND p.tenant_id = $1::bigint
          AND ${activeProductSql}
          AND cart_products.cart_count >= 2
          AND COALESCE(sales.sold_qty, 0) < cart_products.cart_count
        ORDER BY cart_products.cart_count DESC, COALESCE(sales.sold_qty, 0) ASC
        LIMIT 4
        `,
        [tenantId]
      );
      pushUniqueSuggestions(suggestions, abandonedResult.rows);
    }

    const dayOfWeek = new Date().getDay();
    if ([4, 5, 6].includes(dayOfWeek)) {
      pushUniqueSuggestions(suggestions, [
        {
          id: "weekend_sale",
          type: "weekend_sale",
          priority: 58,
          title: "Weekend sale window",
          description: "Use the weekend traffic window for a focused Facebook and Instagram push.",
          product_id: null,
          product_name: "",
          product_image: "",
          reason: "Friday/Saturday weekend campaign timing is active or near.",
          recommended_content_type: "Feed Post",
          recommended_tone: "Hype",
          recommended_platforms: ["facebook", "instagram"],
          action_label: "Generate Content",
          metadata: { source: "calendar", day_of_week: dayOfWeek },
        },
      ]);
    }

    const sorted = suggestions
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, 12);

    res.json({ success: true, data: sorted });
  } catch (error) {
    console.error("[marketing-ai-center] suggestions error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load AI marketing suggestions" });
  }
};

export const getAiCenterDrafts = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const status = nullableString(req.query?.status);
    const fromDate = nullableString(req.query?.from_date || req.query?.fromDate);
    const toDate = nullableString(req.query?.to_date || req.query?.toDate);
    const productId = nullableString(req.query?.product_id || req.query?.productId);
    const platform = nullableString(req.query?.platform);
    const params = [tenantId];
    const clauses = ["d.tenant_id = $1::bigint"];
    const calendarDateExpr = `
      COALESCE(
        CASE WHEN d.status = 'scheduled' THEN d.scheduled_at END,
        CASE WHEN d.status = 'published' THEN d.published_at END,
        d.scheduled_at,
        d.published_at,
        d.created_at
      )
    `;
    if (status) {
      params.push(status);
      clauses.push(`d.status = $${params.length}::varchar`);
    }
    if (fromDate) {
      params.push(fromDate);
      clauses.push(`${calendarDateExpr} >= $${params.length}::timestamp`);
    }
    if (toDate) {
      params.push(toDate);
      clauses.push(`${calendarDateExpr} <= $${params.length}::timestamp`);
    }
    if (productId) {
      params.push(productId);
      clauses.push(`d.product_id = $${params.length}::bigint`);
    }
    if (platform) {
      params.push(platform.toLowerCase());
      clauses.push(`d.platforms ? $${params.length}`);
    }
    const result = await db.query(
      `
      SELECT d.*, p.name AS product_name
      FROM marketing_content_drafts d
      LEFT JOIN products p ON p.id = d.product_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${calendarDateExpr} DESC, d.created_at DESC
      LIMIT 100
      `,
      params
    );
    res.json({ success: true, data: result.rows.map(normalizeContentDraftRow) });
  } catch (error) {
    console.error("[marketing-ai-center] drafts load error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load content drafts" });
  }
};

export const createAiCenterDraft = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    const productId = payload.product_id || payload.productId || null;
    const contentType = nullableString(payload.content_type || payload.contentType) || "Feed Post";
    const tone = nullableString(payload.tone) || "Luxury";
    const platforms = normalizePlatforms(payload.platforms);
    const brandIdentity = await getOrCreateBrandIdentity(tenantId);
    let generated = {};
    let product = null;

    if (productId && (!payload.caption || !payload.title)) {
      const bundle = await fetchProductBundle(productId, tenantId);
      product = bundle.product;
      if (!product) return res.status(404).json({ success: false, message: "Product not found" });
      generated = resolveProductPostData(bundle.product, bundle.variants, brandIdentity);
    }

    const mediaUrls = normalizeMediaUrls(payload.media_urls || generated.media_urls, payload.image_url || generated.image_url);
    const title = nullableString(payload.title) || [generated.title || product?.name || "Generated content", contentType, tone].filter(Boolean).join(" - ");
    const caption = nullableString(payload.caption) || generated.caption || "";
    const status = CONTENT_DRAFT_STATUSES.has(payload.status) ? payload.status : "pending_approval";
    const metadata = {
      source: "ai_marketing_center",
      suggestion_id: payload.suggestion_id || payload.suggestionId || null,
      content_type: contentType,
      tone,
      generated_from_product: Boolean(productId),
      brand_identity: generated.brand_identity || normalizeBrandIdentityRow(brandIdentity, tenantId),
      ...(safeJsonObject(payload.ai_metadata, {})),
    };

    const result = await db.query(
      `
      INSERT INTO marketing_content_drafts (
        tenant_id,
        product_id,
        content_type,
        tone,
        platforms,
        title,
        caption,
        hook,
        body,
        hashtags,
        media_urls,
        status,
        scheduled_at,
        created_by,
        ai_metadata
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15::jsonb)
      RETURNING *
      `,
      [
        tenantId,
        productId,
        contentType,
        tone,
        JSON.stringify(platforms),
        title,
        caption,
        payload.hook || "",
        payload.body || caption,
        payload.hashtags || generated.hashtags || "",
        JSON.stringify(mediaUrls),
        status,
        payload.scheduled_at || payload.scheduledAt || null,
        req.user?.id || null,
        JSON.stringify(metadata),
      ]
    );
    res.status(201).json({ success: true, data: normalizeContentDraftRow({ ...result.rows[0], product_name: product?.name || "" }) });
  } catch (error) {
    console.error("[marketing-ai-center] draft create error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create content draft" });
  }
};

export const generateAiCenterWeeklyPack = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    const weekStart = parseWeekStart(payload.week_start_date || payload.weekStartDate || payload.week_start || payload.weekStart);
    if (!weekStart) return res.status(400).json({ success: false, message: "week_start_date is required" });

    const { created, summary } = await createWeeklyContentPack({
      tenantId,
      userId: req.user?.id || null,
      weekStart,
      platforms: payload.platforms,
      intensity: payload.intensity,
      approvalMode: payload.approval_mode || payload.approvalMode,
      source: "weekly_content_pack",
      skipExisting: false,
    });
    await writeAutomationLog({
      tenantId,
      eventType: "weekly_pack_generated",
      status: summary.created ? "success" : "warning",
      message: summary.created
        ? "Weekly content pack generated."
        : "Weekly content pack request completed without creating drafts.",
      metadata: summary,
    });

    res.status(201).json({
      success: true,
      data: created,
      summary,
      message: summary.created < summary.requested
        ? "Weekly pack created with fewer items because there was not enough product data."
        : "Weekly content pack created.",
    });
  } catch (error) {
    const tenantId = getTenantScope(req);
    await writeAutomationLog({
      tenantId,
      eventType: "weekly_pack_failed",
      status: "failed",
      message: error.message || "Weekly pack generation failed.",
    });
    console.error("[marketing-ai-center] weekly pack error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to generate weekly content pack" });
  }
};

export const getAiCenterAutomationSettings = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const settings = await getOrCreateAutomationSettings(tenantId);
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error("[marketing-ai-center] automation settings load error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load automation settings" });
  }
};

export const updateAiCenterAutomationSettings = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const current = await getOrCreateAutomationSettings(tenantId);
    const payload = req.body || {};
    const enabled = payload.enabled === undefined ? current.enabled : Boolean(payload.enabled);
    const weeklyDayRaw = payload.weekly_generation_day ?? payload.weeklyGenerationDay ?? current.weekly_generation_day;
    const weeklyDay = Math.max(0, Math.min(6, Number(weeklyDayRaw)));
    const weeklyTimeRaw = nullableString(payload.weekly_generation_time || payload.weeklyGenerationTime || current.weekly_generation_time) || "09:00";
    const weeklyTime = /^\d{2}:\d{2}$/.test(weeklyTimeRaw) ? weeklyTimeRaw : "09:00";
    const defaultIntensity = ["light", "balanced", "aggressive"].includes(String(payload.default_intensity || payload.defaultIntensity || "").toLowerCase())
      ? String(payload.default_intensity || payload.defaultIntensity).toLowerCase()
      : current.default_intensity;
    const approvalRaw = String(payload.default_approval_mode || payload.defaultApprovalMode || current.default_approval_mode || "pending_approval").toLowerCase();
    const approvalMode = ["draft", "drafts"].includes(approvalRaw) ? "draft" : "pending_approval";
    const defaultPlatforms = payload.default_platforms || payload.defaultPlatforms || current.default_platforms;
    const autoGenerateNextWeek = payload.auto_generate_next_week === undefined && payload.autoGenerateNextWeek === undefined
      ? current.auto_generate_next_week
      : Boolean(payload.auto_generate_next_week ?? payload.autoGenerateNextWeek);
    const autoPublishEnabled = payload.auto_publish_enabled === undefined && payload.autoPublishEnabled === undefined
      ? current.auto_publish_enabled
      : Boolean(payload.auto_publish_enabled ?? payload.autoPublishEnabled);
    const autoPublishRequiresApproval = payload.auto_publish_requires_approval === undefined && payload.autoPublishRequiresApproval === undefined
      ? current.auto_publish_requires_approval
      : Boolean(payload.auto_publish_requires_approval ?? payload.autoPublishRequiresApproval);
    const autoPublishPlatforms = payload.auto_publish_platforms || payload.autoPublishPlatforms || current.auto_publish_platforms;
    const autoPublishWindowStartRaw = nullableString(payload.auto_publish_window_start || payload.autoPublishWindowStart || current.auto_publish_window_start) || "10:00";
    const autoPublishWindowEndRaw = nullableString(payload.auto_publish_window_end || payload.autoPublishWindowEnd || current.auto_publish_window_end) || "22:00";
    const autoPublishWindowStart = /^\d{2}:\d{2}$/.test(autoPublishWindowStartRaw) ? autoPublishWindowStartRaw : "10:00";
    const autoPublishWindowEnd = /^\d{2}:\d{2}$/.test(autoPublishWindowEndRaw) ? autoPublishWindowEndRaw : "22:00";
    const maxAutoPostsPerDay = Math.max(1, Math.min(10, Number(payload.max_auto_posts_per_day ?? payload.maxAutoPostsPerDay ?? current.max_auto_posts_per_day ?? 2)));
    const nextRunAt = enabled ? computeNextAutomationRun(weeklyDay, weeklyTime) : null;

    const result = await db.query(
      `
      INSERT INTO marketing_automation_settings (
        tenant_id,
        enabled,
        weekly_generation_day,
        weekly_generation_time,
        default_platforms,
        default_intensity,
        default_approval_mode,
        auto_generate_next_week,
        auto_publish_enabled,
        auto_publish_requires_approval,
        auto_publish_platforms,
        auto_publish_window_start,
        auto_publish_window_end,
        max_auto_posts_per_day,
        next_run_at
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12::time,$13::time,$14,$15::timestamp)
      ON CONFLICT (tenant_id) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          weekly_generation_day = EXCLUDED.weekly_generation_day,
          weekly_generation_time = EXCLUDED.weekly_generation_time,
          default_platforms = EXCLUDED.default_platforms,
          default_intensity = EXCLUDED.default_intensity,
          default_approval_mode = EXCLUDED.default_approval_mode,
          auto_generate_next_week = EXCLUDED.auto_generate_next_week,
          auto_publish_enabled = EXCLUDED.auto_publish_enabled,
          auto_publish_requires_approval = EXCLUDED.auto_publish_requires_approval,
          auto_publish_platforms = EXCLUDED.auto_publish_platforms,
          auto_publish_window_start = EXCLUDED.auto_publish_window_start,
          auto_publish_window_end = EXCLUDED.auto_publish_window_end,
          max_auto_posts_per_day = EXCLUDED.max_auto_posts_per_day,
          next_run_at = EXCLUDED.next_run_at,
          updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [
        tenantId,
        enabled,
        weeklyDay,
        weeklyTime,
        JSON.stringify(normalizePlatforms(defaultPlatforms)),
        defaultIntensity,
        approvalMode,
        autoGenerateNextWeek,
        autoPublishEnabled,
        autoPublishRequiresApproval,
        JSON.stringify(normalizePlatforms(autoPublishPlatforms)),
        autoPublishWindowStart,
        autoPublishWindowEnd,
        maxAutoPostsPerDay,
        nextRunAt,
      ]
    );
    const saved = normalizeAutomationSettingsRow(result.rows[0], tenantId);
    await writeAutomationLog({
      tenantId,
      eventType: "automation_settings_updated",
      status: "success",
      message: "Automation settings updated.",
      metadata: {
        enabled: saved.enabled,
        auto_publish_enabled: saved.auto_publish_enabled,
        default_intensity: saved.default_intensity,
        default_approval_mode: saved.default_approval_mode,
      },
    });
    res.json({ success: true, data: saved });
  } catch (error) {
    console.error("[marketing-ai-center] automation settings update error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to save automation settings" });
  }
};

export const runAiCenterAutomationNow = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const settings = await getOrCreateAutomationSettings(tenantId);
    const weekStart = startOfLocalWeek(new Date(), settings.auto_generate_next_week);
    const { created, summary } = await createWeeklyContentPack({
      tenantId,
      userId: req.user?.id || null,
      weekStart,
      platforms: settings.default_platforms,
      intensity: settings.default_intensity,
      approvalMode: settings.default_approval_mode,
      source: "automation_weekly_pack",
      skipExisting: true,
    });
    const nextRunAt = settings.enabled ? computeNextAutomationRun(settings.weekly_generation_day, settings.weekly_generation_time) : null;
    const updated = await db.query(
      `
      UPDATE marketing_automation_settings
      SET last_generated_at = CURRENT_TIMESTAMP,
          next_run_at = $1::timestamp,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $2::bigint
      RETURNING *
      `,
      [nextRunAt, tenantId]
    );
    await writeAutomationLog({
      tenantId,
      eventType: "manual_run_now",
      status: summary.duplicate_week_skipped ? "skipped" : "success",
      message: summary.duplicate_week_skipped
        ? "Manual automation run skipped duplicate weekly pack."
        : "Manual automation run generated a weekly pack.",
      metadata: summary,
    });
    await writeAutomationLog({
      tenantId,
      eventType: summary.duplicate_week_skipped ? "weekly_pack_skipped_duplicate" : "weekly_pack_generated",
      status: summary.duplicate_week_skipped ? "skipped" : "success",
      message: summary.duplicate_week_skipped
        ? "Weekly pack skipped because one already exists for the target week."
        : "Weekly content pack generated.",
      metadata: summary,
    });
    res.status(201).json({
      success: true,
      data: created,
      summary,
      settings: normalizeAutomationSettingsRow(updated.rows[0] || settings, tenantId),
      message: summary.duplicate_week_skipped
        ? "A weekly automation pack already exists for this week. No duplicate drafts were created."
        : summary.created < summary.requested
          ? "Automation ran with fewer items because there was not enough product data."
          : "Automation pack created.",
    });
  } catch (error) {
    const tenantId = getTenantScope(req);
    await writeAutomationLog({
      tenantId,
      eventType: "manual_run_now",
      status: "failed",
      message: error.message || "Manual automation run failed.",
    });
    await writeAutomationLog({
      tenantId,
      eventType: "weekly_pack_failed",
      status: "failed",
      message: error.message || "Weekly pack generation failed.",
    });
    console.error("[marketing-ai-center] automation run error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to run marketing automation" });
  }
};

export const runAiCenterAutoPublishNow = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const settings = await getOrCreateAutomationSettings(tenantId);
    const result = await runAutoPublishForTenant(tenantId, settings);
    const failedCount = result.failed.length;
    const updated = await db.query(
      `
      UPDATE marketing_automation_settings
      SET last_auto_publish_at = CASE WHEN $1::int > 0 THEN CURRENT_TIMESTAMP ELSE last_auto_publish_at END,
          auto_publish_failed_count = auto_publish_failed_count + $2::int,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $3::bigint
      RETURNING *
      `,
      [result.published.length, failedCount, tenantId]
    );
    await writeAutomationLog({
      tenantId,
      eventType: "manual_run_now",
      status: result.failed.length ? "warning" : "success",
      message: "Manual auto-publish run completed.",
      metadata: {
        published: result.published.length,
        failed: result.failed.length,
        skipped: result.skipped.length,
      },
    });
    res.json({
      success: true,
      data: result.published,
      summary: {
        published: result.published.length,
        failed: result.failed.length,
        skipped: result.skipped.length,
        failed_items: result.failed,
        skipped_items: result.skipped,
      },
      settings: normalizeAutomationSettingsRow(updated.rows[0] || settings, tenantId),
      message: result.published.length
        ? "Due scheduled drafts were auto-published."
        : "No due drafts were auto-published.",
    });
  } catch (error) {
    const tenantId = getTenantScope(req);
    await writeAutomationLog({
      tenantId,
      eventType: "auto_publish_failed",
      status: "failed",
      message: error.message || "Manual auto-publish run failed.",
    });
    console.error("[marketing-ai-center] auto-publish run error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to run auto-publish" });
  }
};

export const getAiCenterAutomationLogs = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const filters = [];
    const values = [tenantId];
    let index = values.length;

    const status = nullableString(req.query.status);
    if (status && AUTOMATION_LOG_STATUSES.has(status)) {
      index += 1;
      values.push(status);
      filters.push(`status = $${index}`);
    }

    const eventType = nullableString(req.query.event_type || req.query.eventType);
    if (eventType && AUTOMATION_LOG_EVENTS.has(eventType)) {
      index += 1;
      values.push(eventType);
      filters.push(`event_type = $${index}`);
    }

    const fromDate = nullableString(req.query.from_date || req.query.fromDate);
    if (fromDate) {
      index += 1;
      values.push(fromDate);
      filters.push(`created_at >= $${index}::timestamp`);
    }

    const toDate = nullableString(req.query.to_date || req.query.toDate);
    if (toDate) {
      index += 1;
      values.push(toDate);
      filters.push(`created_at <= $${index}::timestamp`);
    }

    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 30)));
    index += 1;
    values.push(limit);

    const result = await db.query(
      `
      SELECT *
      FROM marketing_automation_logs
      WHERE tenant_id = $1::bigint
        ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT $${index}
      `,
      values
    );

    res.json({ success: true, data: result.rows.map(normalizeAutomationLogRow) });
  } catch (error) {
    console.error("[marketing-ai-center] automation logs error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load automation logs" });
  }
};

export const getAiCenterBrandIdentity = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const brandIdentity = await getOrCreateBrandIdentity(tenantId);
    res.json({ success: true, data: brandIdentity });
  } catch (error) {
    console.error("[marketing-ai-center] brand identity load error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load brand identity" });
  }
};

export const updateAiCenterBrandIdentity = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    const result = await db.query(
      `
      INSERT INTO marketing_brand_identity (
        tenant_id, brand_name, brand_tone, audience, language, dialect,
        primary_colors, forbidden_words, preferred_cta, hashtag_style, notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)
      ON CONFLICT (tenant_id) DO UPDATE
      SET brand_name = EXCLUDED.brand_name,
          brand_tone = EXCLUDED.brand_tone,
          audience = EXCLUDED.audience,
          language = EXCLUDED.language,
          dialect = EXCLUDED.dialect,
          primary_colors = EXCLUDED.primary_colors,
          forbidden_words = EXCLUDED.forbidden_words,
          preferred_cta = EXCLUDED.preferred_cta,
          hashtag_style = EXCLUDED.hashtag_style,
          notes = EXCLUDED.notes,
          updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [
        tenantId,
        nullableString(payload.brand_name || payload.brandName) || "",
        nullableString(payload.brand_tone || payload.brandTone) || "",
        nullableString(payload.audience) || "",
        nullableString(payload.language) || "",
        nullableString(payload.dialect) || "",
        JSON.stringify(normalizeBrandList(payload.primary_colors || payload.primaryColors)),
        JSON.stringify(normalizeBrandList(payload.forbidden_words || payload.forbiddenWords)),
        nullableString(payload.preferred_cta || payload.preferredCta) || "",
        nullableString(payload.hashtag_style || payload.hashtagStyle) || "",
        nullableString(payload.notes) || "",
      ]
    );
    res.json({ success: true, data: normalizeBrandIdentityRow(result.rows[0], tenantId) });
  } catch (error) {
    console.error("[marketing-ai-center] brand identity save error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to save brand identity" });
  }
};

export const generateStoryCampaign = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const payload = req.body || {};
    console.info("[marketing-story-campaigns] generate request", {
      tenant_id: tenantId,
      user_id: req.user?.id || null,
      product_id: payload.product_id || payload.productId || null,
      campaign_type: payload.campaign_type || payload.campaignType || null,
      story_count: payload.story_count || payload.storyCount || null,
    });
    const productId = payload.product_id || payload.productId;
    if (!productId) return res.status(400).json({ success: false, message: "product_id is required" });

    const bundle = await fetchProductBundle(productId, tenantId);
    if (!bundle.product) return res.status(404).json({ success: false, message: "Product not found" });

    const campaignType = normalizeStoryCampaignType(payload.campaign_type || payload.campaignType);
    const storyCount = Math.max(2, Math.min(8, Number(payload.story_count || payload.storyCount || 4)));
    const tone = nullableString(payload.tone) || "Luxury";
    const platform = normalizeStoryCampaignPlatform(payload.platform);
    const visualStyle = nullableString(payload.visual_style || payload.visualStyle) || "Luxury";
    const ctaGoal = nullableString(payload.cta_goal || payload.ctaGoal) || "Website";
    const brandIdentity = await getOrCreateBrandIdentity(tenantId);
    const stories = generateStoryCampaignSequence({
      campaignType,
      storyCount,
      product: bundle.product,
      variants: bundle.variants,
      tone,
      visualStyle,
      ctaGoal,
      brandIdentity,
    });
    const brandPrefix = nullableString(brandIdentity.brand_name);
    const title = nullableString(payload.title) || [brandPrefix, bundle.product.name, campaignType.replaceAll("_", " ")].filter(Boolean).join(" - ");
    const result = await db.query(
      `
      INSERT INTO marketing_story_campaigns (
        tenant_id, branch_id, campaign_type, product_id, title, tone, platform,
        visual_style, cta_goal, story_count, stories_json, status, generated_by, scheduled_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::timestamp)
      RETURNING *
      `,
      [
        tenantId,
        payload.branch_id || payload.branchId || req.user?.branch_id || null,
        campaignType,
        productId,
        title,
        tone,
        platform,
        visualStyle,
        ctaGoal,
        storyCount,
        JSON.stringify(stories),
        "generated",
        req.user?.id || null,
        payload.scheduled_at || payload.scheduledAt || null,
      ]
    );
    const campaign = normalizeStoryCampaignRow({
      ...result.rows[0],
      product_name: bundle.product.name || "",
      product_image: normalizeMediaUrls(bundle.product.media_urls || bundle.product.gallery_images, bundle.product.image_url)[0] || "",
    });
    console.info("[marketing-story-campaigns] generate success", {
      tenant_id: tenantId,
      campaign_id: campaign.id,
      product_id: campaign.product_id,
      stories: campaign.stories_json.length,
    });
    res.status(201).json({
      success: true,
      campaign,
      data: campaign,
      message: "Story campaign generated.",
    });
  } catch (error) {
    console.error("[marketing-story-campaigns] generate error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to generate story campaign" });
  }
};

export const getStoryCampaigns = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      SELECT
        c.*,
        p.name AS product_name,
        COALESCE(NULLIF(p.image_url, ''), '') AS product_image
      FROM marketing_story_campaigns c
      LEFT JOIN products p ON p.id = c.product_id
      WHERE c.tenant_id = $1::bigint
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 40
      `,
      [tenantId]
    );
    const campaigns = result.rows.map(normalizeStoryCampaignRow);
    res.json({ success: true, campaigns, data: campaigns });
  } catch (error) {
    console.error("[marketing-story-campaigns] list error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load story campaigns" });
  }
};

export const getStoryCampaignById = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      SELECT
        c.*,
        p.name AS product_name,
        COALESCE(NULLIF(p.image_url, ''), '') AS product_image
      FROM marketing_story_campaigns c
      LEFT JOIN products p ON p.id = c.product_id
      WHERE c.id = $1::bigint
        AND c.tenant_id = $2::bigint
      LIMIT 1
      `,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Story campaign not found" });
    res.json({ success: true, data: normalizeStoryCampaignRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing-story-campaigns] detail error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load story campaign" });
  }
};

export const updateStoryCampaign = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const current = await db.query(
      "SELECT * FROM marketing_story_campaigns WHERE id = $1::bigint AND tenant_id = $2::bigint LIMIT 1",
      [req.params.id, tenantId]
    );
    if (!current.rows[0]) return res.status(404).json({ success: false, message: "Story campaign not found" });
    const payload = req.body || {};
    const stories = payload.stories_json !== undefined || payload.storiesJson !== undefined
      ? normalizeStoriesJson(payload.stories_json ?? payload.storiesJson)
      : normalizeStoriesJson(current.rows[0].stories_json);
    const status = payload.status ? normalizeStoryCampaignStatus(payload.status) : current.rows[0].status;
    const result = await db.query(
      `
      UPDATE marketing_story_campaigns
      SET title = $1,
          tone = $2,
          platform = $3,
          visual_style = $4,
          cta_goal = $5,
          story_count = $6,
          stories_json = $7::jsonb,
          status = $8,
          scheduled_at = $9::timestamp,
          published_at = $10::timestamp,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $11::bigint
        AND tenant_id = $12::bigint
      RETURNING *
      `,
      [
        nullableString(payload.title) ?? current.rows[0].title,
        nullableString(payload.tone) ?? current.rows[0].tone,
        payload.platform ? normalizeStoryCampaignPlatform(payload.platform) : current.rows[0].platform,
        nullableString(payload.visual_style || payload.visualStyle) ?? current.rows[0].visual_style,
        nullableString(payload.cta_goal || payload.ctaGoal) ?? current.rows[0].cta_goal,
        Math.max(1, Number(stories.length || current.rows[0].story_count || 1)),
        JSON.stringify(stories),
        status,
        payload.scheduled_at !== undefined || payload.scheduledAt !== undefined ? (payload.scheduled_at || payload.scheduledAt || null) : current.rows[0].scheduled_at,
        payload.published_at !== undefined || payload.publishedAt !== undefined ? (payload.published_at || payload.publishedAt || null) : current.rows[0].published_at,
        req.params.id,
        tenantId,
      ]
    );
    res.json({ success: true, data: normalizeStoryCampaignRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing-story-campaigns] update error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update story campaign" });
  }
};

export const deleteStoryCampaign = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      "DELETE FROM marketing_story_campaigns WHERE id = $1::bigint AND tenant_id = $2::bigint RETURNING id",
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Story campaign not found" });
    res.json({ success: true, data: { id: result.rows[0].id } });
  } catch (error) {
    console.error("[marketing-story-campaigns] delete error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete story campaign" });
  }
};

export const createStoryCampaignExport = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const campaignResult = await db.query(
      "SELECT id, branch_id FROM marketing_story_campaigns WHERE id = $1::bigint AND tenant_id = $2::bigint LIMIT 1",
      [req.params.id, tenantId]
    );
    if (!campaignResult.rows[0]) return res.status(404).json({ success: false, message: "Story campaign not found" });
    const payload = req.body || {};
    const filenames = normalizeBrandList(payload.filenames || payload.filenames_json || payload.filenamesJson);
    const exportType = nullableString(payload.export_type || payload.exportType) || "png";
    const status = nullableString(payload.status) || "completed";
    const result = await db.query(
      `
      INSERT INTO marketing_story_exports (
        tenant_id, branch_id, story_campaign_id, template_id, export_type,
        file_count, filenames_json, status, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
      RETURNING *
      `,
      [
        tenantId,
        campaignResult.rows[0].branch_id || req.user?.branch_id || null,
        req.params.id,
        nullableString(payload.template_id || payload.templateId) || "",
        exportType,
        Number(payload.file_count || payload.fileCount || filenames.length || 0),
        JSON.stringify(filenames),
        status,
        req.user?.id || null,
      ]
    );
    res.status(201).json({ success: true, data: normalizeStoryExportRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing-story-campaigns] export create error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to save story export metadata" });
  }
};

export const getStoryCampaignExports = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const campaignResult = await db.query(
      "SELECT id FROM marketing_story_campaigns WHERE id = $1::bigint AND tenant_id = $2::bigint LIMIT 1",
      [req.params.id, tenantId]
    );
    if (!campaignResult.rows[0]) return res.status(404).json({ success: false, message: "Story campaign not found" });
    const result = await db.query(
      `
      SELECT *
      FROM marketing_story_exports
      WHERE tenant_id = $1::bigint
        AND story_campaign_id = $2::bigint
      ORDER BY created_at DESC, id DESC
      LIMIT 20
      `,
      [tenantId, req.params.id]
    );
    res.json({ success: true, data: result.rows.map(normalizeStoryExportRow) });
  } catch (error) {
    console.error("[marketing-story-campaigns] exports list error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load story export history" });
  }
};

export const getStoryTriggerSuggestions = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    console.info("[marketing-story-triggers] suggestions request", { tenant_id: tenantId, user_id: req.user?.id || null });
    const result = await db.query(
      `
      SELECT
        s.*,
        COALESCE(NULLIF(p.name, ''), s.signal_snapshot_json->>'product_name', '') AS product_name,
        COALESCE(NULLIF(p.image_url, ''), s.signal_snapshot_json->>'product_image', '') AS product_image
      FROM marketing_story_trigger_suggestions s
      LEFT JOIN products p
        ON p.id = s.product_id
        AND ($1::bigint IS NULL OR p.tenant_id = $1::bigint OR p.tenant_id IS NULL)
      WHERE s.tenant_id = $1::bigint
        AND s.status = 'pending'
      ORDER BY
        CASE s.priority
          WHEN 'critical' THEN 4
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 2
          ELSE 1
        END DESC,
        s.signal_score DESC,
        s.created_at DESC
      LIMIT 24
      `,
      [tenantId]
    );
    const suggestions = groupStoryTriggerSuggestionsByProduct(result.rows.map(normalizeStoryTriggerRow));
    console.info("[marketing-story-triggers] suggestions success", { tenant_id: tenantId, count: suggestions.length });
    res.json({ success: true, suggestions, data: suggestions });
  } catch (error) {
    console.error("[marketing-story-triggers] list error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load story trigger suggestions" });
  }
};

export const refreshStoryTriggerSuggestions = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    console.info("[marketing-story-triggers] refresh request", { tenant_id: tenantId, user_id: req.user?.id || null });
    const summary = await refreshStoryTriggerSuggestionsForTenant(tenantId);
    const refreshed = await db.query(
      `
      SELECT
        s.*,
        COALESCE(NULLIF(p.name, ''), s.signal_snapshot_json->>'product_name', '') AS product_name,
        COALESCE(NULLIF(p.image_url, ''), s.signal_snapshot_json->>'product_image', '') AS product_image
      FROM marketing_story_trigger_suggestions s
      LEFT JOIN products p
        ON p.id = s.product_id
        AND ($1::bigint IS NULL OR p.tenant_id = $1::bigint OR p.tenant_id IS NULL)
      WHERE s.tenant_id = $1::bigint
        AND s.status = 'pending'
      ORDER BY s.signal_score DESC, s.created_at DESC
      LIMIT 24
      `,
      [tenantId]
    );
    const suggestions = groupStoryTriggerSuggestionsByProduct(refreshed.rows.map(normalizeStoryTriggerRow));
    res.json({
      success: true,
      suggestions,
      data: suggestions,
      inserted: summary.created,
      updated: summary.updated,
      expired: summary.expired,
      summary,
    });
  } catch (error) {
    console.error("[marketing-story-triggers] refresh error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to refresh story trigger suggestions" });
  }
};

export const generateStoryCampaignFromTrigger = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    console.info("[marketing-story-triggers] generate campaign request", {
      tenant_id: tenantId,
      user_id: req.user?.id || null,
      suggestion_id: req.params.id,
    });
    const triggerResult = await db.query(
      `
      SELECT *
      FROM marketing_story_trigger_suggestions
      WHERE id = $1::bigint
        AND tenant_id = $2::bigint
        AND status = 'pending'
      LIMIT 1
      `,
      [req.params.id, tenantId]
    );
    const trigger = triggerResult.rows[0];
    if (!trigger) return res.status(404).json({ success: false, message: "Story trigger suggestion not found" });
    if (!trigger.product_id) return res.status(400).json({ success: false, message: "Story trigger has no product to generate" });

    const bundle = await fetchProductBundle(trigger.product_id, tenantId);
    if (!bundle.product) return res.status(404).json({ success: false, message: "Product not found" });
    const campaignType = normalizeStoryCampaignType(trigger.suggested_campaign_type);
    const storyCount = Math.max(2, Math.min(8, Number(trigger.suggested_story_count || 4)));
    const visualStyle = nullableString(trigger.suggested_visual_style) || "Luxury";
    const ctaGoal = nullableString(trigger.suggested_cta_goal) || "Website";
    const tone = ["last_piece", "low_stock", "size_urgency"].includes(trigger.trigger_type) ? "Urgent Sale" : "Luxury";
    const brandIdentity = await getOrCreateBrandIdentity(tenantId);
    const stories = generateStoryCampaignSequence({
      campaignType,
      storyCount,
      product: bundle.product,
      variants: bundle.variants,
      tone,
      visualStyle,
      ctaGoal,
      brandIdentity,
    });
    const campaignResult = await db.query(
      `
      INSERT INTO marketing_story_campaigns (
        tenant_id, branch_id, campaign_type, product_id, title, tone, platform,
        visual_style, cta_goal, story_count, stories_json, status, generated_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'generated',$12)
      RETURNING *
      `,
      [
        tenantId,
        trigger.branch_id || req.user?.branch_id || null,
        campaignType,
        trigger.product_id,
        trigger.title || `${bundle.product.name} story campaign`,
        tone,
        "instagram",
        visualStyle,
        ctaGoal,
        storyCount,
        JSON.stringify(stories),
        req.user?.id || null,
      ]
    );
    await db.query(
      `
      UPDATE marketing_story_trigger_suggestions
      SET status = 'generated',
          generated_campaign_id = $3::bigint,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::bigint
        AND tenant_id = $2::bigint
      `,
      [trigger.id, tenantId, campaignResult.rows[0].id]
    );
    const campaign = normalizeStoryCampaignRow({
      ...campaignResult.rows[0],
      product_name: bundle.product.name || "",
      product_image: normalizeMediaUrls(bundle.product.media_urls || bundle.product.gallery_images, bundle.product.image_url)[0] || "",
    });
    const suggestion = normalizeStoryTriggerRow({ ...trigger, status: "generated", generated_campaign_id: campaignResult.rows[0].id });
    console.info("[marketing-story-triggers] generate campaign success", {
      tenant_id: tenantId,
      suggestion_id: trigger.id,
      campaign_id: campaign.id,
    });
    res.status(201).json({
      success: true,
      campaign,
      suggestion,
      data: { campaign, suggestion },
      message: "Story campaign generated from trigger.",
    });
  } catch (error) {
    console.error("[marketing-story-triggers] generate error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to generate story campaign from trigger" });
  }
};

export const dismissStoryTriggerSuggestion = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      UPDATE marketing_story_trigger_suggestions
      SET status = 'dismissed',
          dismissed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::bigint
        AND tenant_id = $2::bigint
        AND status = 'pending'
      RETURNING *
      `,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Story trigger suggestion not found" });
    res.json({ success: true, data: normalizeStoryTriggerRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing-story-triggers] dismiss error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to dismiss story trigger suggestion" });
  }
};

export const updateAiCenterDraft = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const current = await getContentDraftRow(req.params.id, tenantId);
    if (!current) return res.status(404).json({ success: false, message: "Content draft not found" });
    const payload = req.body || {};
    const nextStatus = payload.status && CONTENT_DRAFT_STATUSES.has(payload.status) ? payload.status : current.status;
    const mediaUrls = payload.media_urls !== undefined || payload.image_url !== undefined
      ? normalizeMediaUrls(payload.media_urls, payload.image_url)
      : normalizeMediaUrls(current.media_urls, "");
    const result = await db.query(
      `
      UPDATE marketing_content_drafts
      SET
        product_id = $1::bigint,
        content_type = $2::varchar,
        tone = $3::varchar,
        platforms = $4::jsonb,
        title = $5::text,
        caption = $6::text,
        hook = $7::text,
        body = $8::text,
        hashtags = $9::text,
        media_urls = $10::jsonb,
        status = $11::varchar,
        scheduled_at = $12::timestamp,
        ai_metadata = $13::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14::bigint
        AND tenant_id = $15::bigint
      RETURNING *
      `,
      [
        payload.product_id ?? current.product_id,
        payload.content_type || payload.contentType || current.content_type,
        payload.tone || current.tone,
        JSON.stringify(payload.platforms ? normalizePlatforms(payload.platforms) : normalizePlatforms(current.platforms)),
        payload.title ?? current.title,
        payload.caption ?? current.caption,
        payload.hook ?? current.hook,
        payload.body ?? current.body,
        payload.hashtags ?? current.hashtags,
        JSON.stringify(mediaUrls),
        nextStatus,
        payload.scheduled_at ?? payload.scheduledAt ?? current.scheduled_at,
        JSON.stringify({ ...safeJsonObject(current.ai_metadata, {}), ...safeJsonObject(payload.ai_metadata, {}) }),
        req.params.id,
        tenantId,
      ]
    );
    res.json({ success: true, data: normalizeContentDraftRow({ ...result.rows[0], product_name: current.product_name || "" }) });
  } catch (error) {
    console.error("[marketing-ai-center] draft update error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update content draft" });
  }
};

export const approveAiCenterDraft = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      UPDATE marketing_content_drafts
      SET status = 'approved',
          approved_by = $1::bigint,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2::bigint
        AND tenant_id = $3::bigint
      RETURNING *
      `,
      [req.user?.id || null, req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Content draft not found" });
    res.json({ success: true, data: normalizeContentDraftRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing-ai-center] draft approve error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to approve content draft" });
  }
};

export const rejectAiCenterDraft = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await db.query(
      `
      UPDATE marketing_content_drafts
      SET status = 'rejected',
          rejected_at = CURRENT_TIMESTAMP,
          rejected_by = $1::bigint,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2::bigint
        AND tenant_id = $3::bigint
      RETURNING *
      `,
      [req.user?.id || null, req.params.id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Content draft not found" });
    res.json({ success: true, data: normalizeContentDraftRow(result.rows[0]) });
  } catch (error) {
    console.error("[marketing-ai-center] draft reject error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to reject content draft" });
  }
};

export const scheduleAiCenterDraft = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const scheduledAt = req.body?.scheduled_at || req.body?.scheduledAt || null;
    if (!scheduledAt) return res.status(400).json({ success: false, message: "scheduled_at is required" });
    const draft = await getContentDraftRow(req.params.id, tenantId);
    if (!draft) return res.status(404).json({ success: false, message: "Content draft not found" });
    const draftMetadata = safeJsonObject(draft.ai_metadata, {});
    const existingPostId = draftMetadata.marketing_post_id || null;
    let post = null;

    if (existingPostId) {
      const existing = await db.query(
        `
        SELECT *
        FROM marketing_posts
        WHERE id = $1::bigint
          AND tenant_id = $2::bigint
        LIMIT 1
        `,
        [existingPostId, tenantId]
      );
      post = existing.rows[0] ? normalizePostRow(existing.rows[0]) : null;
    }

    if (!post) {
      post = await createPostFromDraft(draft, tenantId);
    } else {
      assertDraftMedia(draft);
    }

    if (String(draft.content_type || "").toLowerCase() === "story") {
      await db.query(
        `
        UPDATE marketing_posts
        SET story_status = 'scheduled',
            story_scheduled_at = $1::timestamp,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2::bigint
          AND tenant_id = $3::bigint
        `,
        [scheduledAt, post.id, tenantId]
      );
    } else {
      await db.query(
        `
        UPDATE marketing_posts
        SET status = 'scheduled',
            scheduled_at = $1::timestamp,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2::bigint
          AND tenant_id = $3::bigint
        `,
        [scheduledAt, post.id, tenantId]
      );
    }

    const updated = await db.query(
      `
      UPDATE marketing_content_drafts
      SET status = 'scheduled',
          scheduled_at = $1::timestamp,
          approved_by = COALESCE(approved_by, $2::bigint),
          ai_metadata = ai_metadata || $3::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4::bigint
        AND tenant_id = $5::bigint
      RETURNING *
      `,
      [scheduledAt, req.user?.id || null, JSON.stringify({ marketing_post_id: post.id }), req.params.id, tenantId]
    );
    res.json({ success: true, data: normalizeContentDraftRow(updated.rows[0]), post });
  } catch (error) {
    console.error("[marketing-ai-center] draft schedule error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to schedule content draft" });
  }
};

export const publishNowAiCenterDraft = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const draft = await getContentDraftRow(req.params.id, tenantId);
    if (!draft) return res.status(404).json({ success: false, message: "Content draft not found" });
    const post = await createPostFromDraft(draft, tenantId);
    const isStory = String(draft.content_type || "").toLowerCase() === "story";
    const published = isStory ? await publishStoryForRow(post, tenantId) : await publishAndPersist(post.id, tenantId);
    const status = isStory
      ? (published.story_status === "published" ? "published" : "failed")
      : (published.status === "published" ? "published" : "failed");
    const updated = await db.query(
      `
      UPDATE marketing_content_drafts
      SET status = $1::varchar,
          published_at = CASE WHEN $1::varchar = 'published' THEN CURRENT_TIMESTAMP ELSE published_at END,
          approved_by = COALESCE(approved_by, $2::bigint),
          ai_metadata = ai_metadata || $3::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4::bigint
        AND tenant_id = $5::bigint
      RETURNING *
      `,
      [
        status,
        req.user?.id || null,
        JSON.stringify({
          marketing_post_id: post.id,
          publish_result: isStory ? published.story_publish_results || {} : published.platform_publish_results || {},
          error_message: published.error_message || published.story_error_message || null,
        }),
        req.params.id,
        tenantId,
      ]
    );
    res.status(status === "published" ? 200 : 502).json({
      success: status === "published",
      message: published.error_message || published.story_error_message || "Publish request completed",
      data: normalizeContentDraftRow(updated.rows[0]),
      post: published,
    });
  } catch (error) {
    console.error("[marketing-ai-center] draft publish error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to publish content draft" });
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
    assertMarketingChannelIsEnabled(payload.channel);
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
    assertMarketingChannelIsEnabled(payload.channel);
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
        const claimed = await db.query(
          `
          UPDATE marketing_posts
          SET story_status = 'publishing', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::bigint AND story_status = 'scheduled'
          RETURNING *
          `,
          [post.id]
        );
        const claimedPost = claimed.rows[0];
        if (!claimedPost) continue;

        let enqueueResult = null;
        try {
          enqueueResult = await enqueueJob(
            "story.publish",
            { postId: claimedPost.id, tenantId: claimedPost.tenant_id },
            { context: { postId: claimedPost.id, tenantId: claimedPost.tenant_id, source: "story-scheduler" } }
          );
        } catch (enqueueError) {
          console.warn("[story-scheduler] enqueue failed, publishing inline", { post_id: claimedPost.id, error: enqueueError?.message });
        }

        if (!enqueueResult?.accepted) {
          console.warn("[story-scheduler] queue unavailable, publishing inline", {
            post_id: claimedPost.id,
            fallback: enqueueResult?.fallback || "enqueue_failed",
          });
          await publishStoryJob({ postId: claimedPost.id, tenantId: claimedPost.tenant_id });
        }
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
    await ensureMarketingSchema();
    const result = await processMetaWebhook({ req });
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

