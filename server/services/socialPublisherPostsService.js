import db from "../database/db.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { publishPost as publishMetaPost } from "./socialPublisherService.js";

const trimString = (value) => String(value || "").trim();
const TIKTOK_PUBLISHING_NOT_CONNECTED_MESSAGE = "TikTok publishing is not connected yet.";
const DISABLED_SOCIAL_PUBLISHER_PLATFORMS = new Set(["tiktok"]);

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

const normalizeSocialPublisherPostRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  caption: row.caption || "",
  media_url: row.media_url || "",
  media_type: normalizeMediaType(row.media_type),
  platforms: normalizePlatforms(row.platforms),
  status: row.status || "draft",
  scheduled_at: row.scheduled_at || null,
  published_at: row.published_at || null,
  error_message: row.error_message || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

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
  mediaUrl = "",
  mediaType = "image",
  platforms = [],
  status = "draft",
  scheduledAt = null,
  publishedAt = null,
  errorMessage = null,
} = {}) => {
  await ensureMarketingSchema();
  assertSocialPublisherPlatformsAreEnabled(platforms);
  const result = await db.query(
    `
    INSERT INTO social_publisher_posts (
      tenant_id,
      caption,
      media_url,
      media_type,
      platforms,
      status,
      scheduled_at,
      published_at,
      error_message
    )
    VALUES ($1::integer, $2, $3, $4, $5::jsonb, $6, $7::timestamp, $8::timestamp, $9)
    RETURNING *
    `,
    [
      tenantId,
      trimString(caption),
      trimString(mediaUrl),
      normalizeMediaType(mediaType),
      JSON.stringify(normalizePlatforms(platforms)),
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
  const publishPayload = {
    ...post,
    channel: resolveChannel(post.platforms),
    image_url: post.media_url || "",
    media_urls: post.media_url ? [post.media_url] : [],
  };

  const publishResult = await publishMetaPost(publishPayload, settings || {});
  const nextStatus = publishResult?.status || (publishResult?.success ? "published" : "failed");
  const publishSucceeded = nextStatus === "published" || nextStatus === "partial_success";
  const errorMessage = publishResult?.error_message || null;
  const publishedAt = publishSucceeded ? publishResult?.published_at || new Date().toISOString() : null;

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

export const getSocialPublisherSettingsRow = getMarketingSettingsRow;
