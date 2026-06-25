import db from "../database/db.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { getMetaIntegrationStatus } from "./metaIntegrationService.js";
import { publishPost as publishMetaPost } from "./socialPublisherService.js";

const trimString = (value) => String(value || "").trim();
const TIKTOK_PUBLISHING_NOT_CONNECTED_MESSAGE = "TikTok publishing is not connected yet.";
const DISABLED_SOCIAL_PUBLISHER_PLATFORMS = new Set(["tiktok"]);
const SOCIAL_PUBLISHER_SCHEDULER_LOCK_KEY = 74017102;

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
  media_url: row.media_url || "",
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
      media_url,
      media_type,
      platforms,
      publish_settings,
      status,
      scheduled_at,
      published_at,
      error_message
    )
    VALUES ($1::integer, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::timestamp, $9::timestamp, $10)
    RETURNING *
    `,
    [
      tenantId,
      trimString(caption),
      trimString(mediaUrl),
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
  await ensureMarketingSchema();
  const result = await db.query(
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
        page_access_token,
        token_status,
        token_health_status,
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
        ''::text AS page_access_token,
        token_status,
        token_status AS token_health_status,
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
      token_status: trimString(row.token_status || row.token_health_status || row.status || ""),
      connected: Boolean(trimString(row.page_access_token_encrypted || row.page_access_token || "")),
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
  const metaStatus = await getMetaIntegrationStatus({ tenantId }).catch(() => null);
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

  return {
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
  const publishPayload = {
    ...post,
    channel: resolveChannel(post.platforms),
    image_url: post.media_url || "",
    media_urls: post.media_url ? [post.media_url] : [],
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
