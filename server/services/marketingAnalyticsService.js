import db from "../database/db.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { validateMetaToken } from "./metaTokenService.js";

const GRAPH_API_VERSION = "v25.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const trimString = (value) => String(value || "").trim();
const nullableString = (value) => {
  const normalized = trimString(value);
  return normalized || null;
};

const toNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseMetaResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const getMetaErrorMessage = (payload, fallback = "Meta Graph API request failed") => {
  if (payload?.error?.message) return payload.error.message;
  if (payload?.error) return JSON.stringify(payload.error);
  if (payload?.message) return payload.message;
  return fallback;
};

const callMetaGet = async ({ path, params, label }) => {
  const target = new URL(`${GRAPH_API_BASE_URL}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    const normalized = nullableString(value);
    if (normalized !== null) target.searchParams.set(key, normalized);
  });

  const safeTarget = target
    .toString()
    .replace(/(access_token|client_secret|fb_exchange_token)=[^&]+/g, "$1=***");
  console.log("[marketing-analytics] Meta request", { label, target: safeTarget });

  const response = await fetch(target);
  const payload = await parseMetaResponse(response);
  if (response.ok) {
    return payload;
  }

  const error = new Error(getMetaErrorMessage(payload));
  error.status = response.status;
  error.metaResponse = payload;
  throw error;
};

const isPermissionLimitedError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  const code = Number(error?.metaResponse?.error?.code || error?.metaResponse?.error?.error_subcode || 0);
  return (
    message.includes("permission") ||
    message.includes("insufficient") ||
    message.includes("unsupported get request") ||
    [10, 200, 2500].includes(code)
  );
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

const getSettingsRow = async (tenantId) => {
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

const getPublishedPostsForTenant = async (tenantId) => {
  const result = await db.query(
    `
    SELECT
      id,
      tenant_id,
      title,
      channel,
      status,
      published_at,
      created_at,
      platform_post_id,
      platform_publish_results
    FROM marketing_posts
    WHERE tenant_id = $1::bigint
      AND (
        status = 'published'
        OR status = 'partial_success'
        OR published_at IS NOT NULL
        OR platform_post_id IS NOT NULL
        OR platform_publish_results <> '{}'::jsonb
      )
    ORDER BY published_at DESC NULLS LAST, created_at DESC
    `,
    [tenantId]
  );

  return result.rows || [];
};

const ensureAiMarketingPerformanceSchema = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_marketing_performance_snapshots (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      queue_id BIGINT NULL,
      platform VARCHAR(30) NOT NULL,
      platform_post_id TEXT NOT NULL DEFAULT '',
      reach INTEGER NULL,
      impressions INTEGER NULL,
      reactions INTEGER NULL,
      likes INTEGER NULL,
      comments INTEGER NULL,
      shares INTEGER NULL,
      saves INTEGER NULL,
      clicks INTEGER NULL,
      profile_visits INTEGER NULL,
      engagement_rate NUMERIC(10,4) NULL,
      performance_score INTEGER NOT NULL DEFAULT 0,
      raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_marketing_perf_queue ON ai_marketing_performance_snapshots (tenant_id, queue_id, synced_at DESC)`);
};

const getPublishedAiQueueItemsForTenant = async (tenantId) => {
  await ensureAiMarketingPerformanceSchema();
  const exists = await db.query(`SELECT to_regclass('public.ai_marketing_content_queue') AS table_name`);
  if (!exists.rows[0]?.table_name) return [];
  const result = await db.query(
    `
    SELECT id, tenant_id, title, content_type, strategy_type, color, published_at, created_at, platform_post_id,
           facebook_post_id, instagram_media_id, instagram_publish_id, platform_publish_results, design_json, metadata
    FROM ai_marketing_content_queue
    WHERE tenant_id = $1::bigint
      AND status = 'published'
      AND (platform_post_id IS NOT NULL OR facebook_post_id IS NOT NULL OR instagram_media_id IS NOT NULL OR platform_publish_results <> '{}'::jsonb)
    ORDER BY published_at DESC NULLS LAST, created_at DESC
    `,
    [tenantId]
  );
  return result.rows || [];
};

const getDistinctTenantIdsForSync = async () => {
  const result = await db.query(
    `
    SELECT DISTINCT tenant_id
    FROM marketing_posts
    WHERE status = 'published'
       OR status = 'partial_success'
       OR published_at IS NOT NULL
       OR platform_post_id IS NOT NULL
       OR platform_publish_results <> '{}'::jsonb
    ORDER BY tenant_id ASC
    `
  );
  const queueTenants = await db.query(`
    SELECT DISTINCT tenant_id
    FROM ai_marketing_content_queue
    WHERE status = 'published'
      AND (platform_post_id IS NOT NULL OR facebook_post_id IS NOT NULL OR instagram_media_id IS NOT NULL OR platform_publish_results <> '{}'::jsonb)
  `).catch(() => ({ rows: [] }));
  return Array.from(new Set([...result.rows.map((row) => row.tenant_id), ...queueTenants.rows.map((row) => row.tenant_id)]));
};

const addCandidate = (items, platform, platformPostId, sourcePost) => {
  const normalizedPostId = nullableString(platformPostId);
  if (!normalizedPostId) return;
  if (items.some((item) => item.platform === platform && item.platform_post_id === normalizedPostId)) return;
  items.push({
    post_id: sourcePost.id,
    platform,
    platform_post_id: normalizedPostId,
    title: sourcePost.title || "",
    published_at: sourcePost.published_at || sourcePost.created_at || null,
  });
};

const buildAnalyticsCandidates = (post = {}) => {
  const candidates = [];
  const results = safeJsonObject(post.platform_publish_results, {});

  addCandidate(candidates, "facebook", results.facebook?.platform_post_id || results.facebook?.external_post_id, post);
  addCandidate(candidates, "instagram", results.instagram?.platform_post_id || results.instagram?.external_post_id, post);

  if (!candidates.length && post.platform_post_id) {
    const guessedPlatform = post.channel === "instagram" ? "instagram" : "facebook";
    addCandidate(candidates, guessedPlatform, post.platform_post_id, post);
  }

  return candidates;
};

const buildAiQueueAnalyticsCandidates = (item = {}) => {
  const candidates = [];
  const results = safeJsonObject(item.platform_publish_results, {});
  addCandidate(candidates, "facebook", item.facebook_post_id || results.facebook?.platform_post_id || results.facebook?.platform_story_id || results.facebook?.id, { ...item, id: item.id });
  addCandidate(candidates, "instagram", item.instagram_media_id || item.instagram_publish_id || results.instagram?.platform_post_id || results.instagram?.platform_story_id || results.instagram?.id, { ...item, id: item.id });
  return candidates.map((candidate) => ({ ...candidate, queue_id: item.id, source_item: item }));
};

const extractMetricValue = (payload, name) => {
  const entry = Array.isArray(payload?.data) ? payload.data.find((item) => item?.name === name) : null;
  const value = entry?.values?.[0]?.value;
  return toNumber(value, null);
};

const fetchFacebookMetrics = async ({ platformPostId, accessToken }) => {
  const metrics = {
    likes: null,
    comments: null,
    shares: null,
    reach: null,
    impressions: null,
    saves: null,
    clicks: null,
    warnings: [],
  };

  try {
    const summary = await callMetaGet({
      path: `/${encodeURIComponent(platformPostId)}`,
      label: "facebook_post_summary",
      params: {
        fields: "comments.summary(true).limit(0),reactions.summary(true).limit(0),shares",
        access_token: accessToken,
      },
    });

    metrics.comments = toNumber(summary?.comments?.summary?.total_count ?? summary?.comments?.data?.length, null);
    metrics.likes = toNumber(summary?.reactions?.summary?.total_count ?? summary?.reactions?.data?.length, null);
    metrics.shares = toNumber(summary?.shares?.count ?? summary?.shares, null);
  } catch (error) {
    metrics.warnings.push(`Facebook post counts unavailable: ${error?.message || "Meta request failed"}`);
  }

  try {
    const insights = await callMetaGet({
      path: `/${encodeURIComponent(platformPostId)}/insights`,
      label: "facebook_post_insights",
      params: {
        metric: "post_impressions,post_impressions_unique,post_clicks,post_engaged_users",
        access_token: accessToken,
      },
    });

    metrics.impressions = extractMetricValue(insights, "post_impressions");
    metrics.reach = extractMetricValue(insights, "post_impressions_unique");
    metrics.clicks = extractMetricValue(insights, "post_clicks");
  } catch (error) {
    if (isPermissionLimitedError(error)) {
      metrics.warnings.push("Facebook reach/impressions require additional Meta permissions and were skipped.");
    } else {
      metrics.warnings.push(`Facebook insights unavailable: ${error?.message || "Meta request failed"}`);
    }
  }

  return metrics;
};

const fetchInstagramMetrics = async ({ platformPostId, accessToken }) => {
  const metrics = {
    likes: null,
    comments: null,
    shares: null,
    reach: null,
    impressions: null,
    saves: null,
    clicks: null,
    warnings: [],
  };

  try {
    const summary = await callMetaGet({
      path: `/${encodeURIComponent(platformPostId)}`,
      label: "instagram_media_summary",
      params: {
        fields: "like_count,comments_count",
        access_token: accessToken,
      },
    });

    metrics.likes = toNumber(summary?.like_count, null);
    metrics.comments = toNumber(summary?.comments_count, null);
  } catch (error) {
    metrics.warnings.push(`Instagram post counts unavailable: ${error?.message || "Meta request failed"}`);
  }

  try {
    const insights = await callMetaGet({
      path: `/${encodeURIComponent(platformPostId)}/insights`,
      label: "instagram_media_insights",
      params: {
        metric: "impressions,reach,saved,engagement",
        access_token: accessToken,
      },
    });

    metrics.impressions = extractMetricValue(insights, "impressions");
    metrics.reach = extractMetricValue(insights, "reach");
    metrics.saves = extractMetricValue(insights, "saved");
  } catch (error) {
    if (isPermissionLimitedError(error)) {
      metrics.warnings.push("Instagram reach/impressions require additional Meta permissions and were skipped.");
    } else {
      metrics.warnings.push(`Instagram insights unavailable: ${error?.message || "Meta request failed"}`);
    }
  }

  return metrics;
};

const upsertAnalyticsRow = async ({ postId, platform, platformPostId, metrics }) => {
  const result = await db.query(
    `
    INSERT INTO marketing_post_analytics (
      post_id,
      platform,
      platform_post_id,
      likes,
      comments,
      shares,
      reach,
      impressions,
      saves,
      clicks,
      synced_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)
    ON CONFLICT (post_id, platform)
    DO UPDATE SET
      platform_post_id = EXCLUDED.platform_post_id,
      likes = EXCLUDED.likes,
      comments = EXCLUDED.comments,
      shares = EXCLUDED.shares,
      reach = EXCLUDED.reach,
      impressions = EXCLUDED.impressions,
      saves = EXCLUDED.saves,
      clicks = EXCLUDED.clicks,
      synced_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      postId,
      platform,
      platformPostId,
      metrics.likes,
      metrics.comments,
      metrics.shares,
      metrics.reach,
      metrics.impressions,
      metrics.saves,
      metrics.clicks,
    ]
  );

  return result.rows[0] || null;
};

const calculatePerformanceScore = (metrics = {}) => {
  const reach = toNumber(metrics.reach, 0) || 0;
  const impressions = toNumber(metrics.impressions, reach) || reach;
  const likes = toNumber(metrics.likes, 0) || 0;
  const comments = toNumber(metrics.comments, 0) || 0;
  const shares = toNumber(metrics.shares, 0) || 0;
  const saves = toNumber(metrics.saves, 0) || 0;
  const clicks = toNumber(metrics.clicks, 0) || 0;
  const engagement = likes + comments + shares + saves + clicks;
  const engagementRate = impressions > 0 ? engagement / impressions : 0;
  const reachScore = Math.min(35, Math.log10(Math.max(reach, 1)) * 8);
  const engagementScore = Math.min(35, engagementRate * 900);
  const clickScore = Math.min(15, clicks * 1.5);
  const shareSaveScore = Math.min(15, (shares * 3) + (saves * 2));
  return Math.max(0, Math.min(100, Math.round(reachScore + engagementScore + clickScore + shareSaveScore)));
};

const performanceLabel = (score) => score >= 70 ? "High Performer" : score >= 40 ? "Average" : score > 0 ? "Low Performer" : "No Data";

const hasRealMetricValue = (metrics = {}) =>
  ["reach", "impressions", "likes", "comments", "shares", "saves", "clicks", "profile_visits"].some((key) => {
    const value = metrics[key];
    if (value === null || value === undefined || value === "") return false;
    return Number.isFinite(Number(value));
  });

const insertAiQueuePerformanceSnapshot = async ({ tenantId, queueId, platform, platformPostId, metrics }) => {
  if (!hasRealMetricValue(metrics)) {
    console.log("[marketing-performance-sync] no real metrics available; snapshot skipped", { tenantId, queueId, platform, platformPostId });
    return null;
  }
  const likes = toNumber(metrics.likes, 0) || 0;
  const comments = toNumber(metrics.comments, 0) || 0;
  const shares = toNumber(metrics.shares, 0) || 0;
  const saves = toNumber(metrics.saves, 0) || 0;
  const clicks = toNumber(metrics.clicks, 0) || 0;
  const impressions = toNumber(metrics.impressions, null);
  const engagement = likes + comments + shares + saves + clicks;
  const engagementRate = impressions && impressions > 0 ? (engagement / impressions) * 100 : null;
  const score = calculatePerformanceScore(metrics);
  const result = await db.query(
    `
    INSERT INTO ai_marketing_performance_snapshots (
      tenant_id, queue_id, platform, platform_post_id, reach, impressions, reactions, likes, comments, shares, saves, clicks,
      profile_visits, engagement_rate, performance_score, raw_metrics
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
    RETURNING *
    `,
    [
      tenantId,
      queueId,
      platform,
      platformPostId,
      metrics.reach,
      metrics.impressions,
      likes,
      likes,
      metrics.comments,
      metrics.shares,
      metrics.saves,
      metrics.clicks,
      metrics.profile_visits || null,
      engagementRate,
      score,
      JSON.stringify(metrics),
    ]
  );
  await db.query(
    `
    UPDATE ai_marketing_content_queue
    SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1 AND id = $2
    `,
    [
      tenantId,
      queueId,
      JSON.stringify({
        performance_score: score,
        performance_label: performanceLabel(score),
        performance_metrics: {
          reach: metrics.reach,
          impressions: metrics.impressions,
          likes,
          comments,
          shares,
          saves,
          clicks,
          engagement_rate: engagementRate,
          last_synced_at: new Date().toISOString(),
        },
      }),
    ]
  );
  return result.rows[0] || null;
};

export const syncMarketingAnalyticsForTenant = async ({ tenantId, platform = "", from = null, to = null } = {}) => {
  await ensureMarketingSchema();
  const settings = await getSettingsRow(tenantId);
  if (!settings) {
    return { tenantId, skipped: true, reason: "Marketing settings row not found", synced: 0, warnings: [] };
  }

  let accessToken;
  try {
    const validation = validateMetaToken(settings);
    accessToken = validation.accessToken;
  } catch (error) {
    return {
      tenantId,
      skipped: true,
      reason: error?.message || "Meta token is not valid.",
      synced: 0,
      warnings: [error?.message || "Meta token is not valid."],
    };
  }

  const posts = await getPublishedPostsForTenant(tenantId);
  const aiQueueItems = await getPublishedAiQueueItemsForTenant(tenantId);
  const fromDate = nullableString(from);
  const toDate = nullableString(to);
  const platformFilter = trimString(platform).toLowerCase();
  const syncedRows = [];
  const warnings = new Set();

  for (const post of posts) {
    const publishedDate = post.published_at || post.created_at || null;
    if (fromDate && publishedDate && new Date(publishedDate) < new Date(fromDate)) continue;
    if (toDate && publishedDate && new Date(publishedDate) > new Date(`${toDate}T23:59:59.999Z`)) continue;

    const candidates = buildAnalyticsCandidates(post);
    for (const candidate of candidates) {
      if (platformFilter && candidate.platform !== platformFilter) continue;

      console.log("[marketing-analytics] sync started", {
        tenantId,
        post_id: candidate.post_id,
        platform: candidate.platform,
        platform_post_id: candidate.platform_post_id,
      });

      const metrics =
        candidate.platform === "instagram"
          ? await fetchInstagramMetrics({ platformPostId: candidate.platform_post_id, accessToken })
          : await fetchFacebookMetrics({ platformPostId: candidate.platform_post_id, accessToken });

      metrics.warnings.forEach((warning) => warnings.add(warning));

      const saved = await upsertAnalyticsRow({
        postId: candidate.post_id,
        platform: candidate.platform,
        platformPostId: candidate.platform_post_id,
        metrics,
      });

      syncedRows.push({
        ...saved,
        title: candidate.title,
        published_at: candidate.published_at,
        warnings: metrics.warnings,
      });

      console.log("[marketing-analytics] sync success", {
        tenantId,
        post_id: candidate.post_id,
        platform: candidate.platform,
        platform_post_id: candidate.platform_post_id,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        reach: metrics.reach,
        impressions: metrics.impressions,
      });
    }
  }

  for (const item of aiQueueItems) {
    const publishedDate = item.published_at || item.created_at || null;
    if (fromDate && publishedDate && new Date(publishedDate) < new Date(fromDate)) continue;
    if (toDate && publishedDate && new Date(publishedDate) > new Date(`${toDate}T23:59:59.999Z`)) continue;

    const candidates = buildAiQueueAnalyticsCandidates(item);
    for (const candidate of candidates) {
      if (platformFilter && candidate.platform !== platformFilter) continue;
      console.log("[marketing-performance-sync] sync started", {
        tenantId,
        queue_id: candidate.queue_id,
        platform: candidate.platform,
        platform_post_id: candidate.platform_post_id,
      });
      const metrics =
        candidate.platform === "instagram"
          ? await fetchInstagramMetrics({ platformPostId: candidate.platform_post_id, accessToken })
          : await fetchFacebookMetrics({ platformPostId: candidate.platform_post_id, accessToken });
      metrics.warnings.forEach((warning) => warnings.add(warning));
      const saved = await insertAiQueuePerformanceSnapshot({
        tenantId,
        queueId: candidate.queue_id,
        platform: candidate.platform,
        platformPostId: candidate.platform_post_id,
        metrics,
      });
      if (!saved) continue;
      syncedRows.push({
        ...saved,
        queue_id: candidate.queue_id,
        title: candidate.title,
        published_at: candidate.published_at,
        warnings: metrics.warnings,
      });
    }
  }

  return {
    tenantId,
    skipped: false,
    reason: null,
    synced: syncedRows.length,
    warnings: Array.from(warnings),
    data: syncedRows,
  };
};

const normalizeAnalyticsRow = (row = {}) => {
  const likes = toNumber(row.likes, 0) || 0;
  const comments = toNumber(row.comments, 0) || 0;
  const shares = toNumber(row.shares, 0) || 0;
  const reach = toNumber(row.reach, null);
  const impressions = toNumber(row.impressions, null);
  const saves = toNumber(row.saves, 0) || 0;
  const clicks = toNumber(row.clicks, 0) || 0;
  const engagement = likes + comments + shares + saves + clicks;
  const engagementRate = impressions && impressions > 0 ? (engagement / impressions) * 100 : null;

  return {
    id: row.id,
    post_id: row.post_id,
    platform: row.platform,
    platform_post_id: row.platform_post_id,
    title: row.title || "",
    channel: row.channel || "",
    published_at: row.published_at || null,
    likes,
    comments,
    shares,
    reach,
    impressions,
    saves,
    clicks,
    engagement,
    engagement_rate: engagementRate,
    synced_at: row.synced_at || null,
  };
};

export const buildMarketingAnalyticsOverview = async ({ tenantId, platform = "", from = null, to = null, limit = 20, offset = 0 } = {}) => {
  await ensureMarketingSchema();
  const platformFilter = trimString(platform).toLowerCase();
  const fromDate = nullableString(from);
  const toDate = nullableString(to);
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const normalizedOffset = Math.max(0, Number(offset) || 0);

  const baseQuery = `
    FROM marketing_post_analytics a
    INNER JOIN marketing_posts p ON p.id = a.post_id
    WHERE p.tenant_id = $1::bigint
      AND ($2::text = '' OR a.platform = $2::text)
      AND ($3::timestamp IS NULL OR COALESCE(p.published_at, p.created_at) >= $3::timestamp)
      AND ($4::timestamp IS NULL OR COALESCE(p.published_at, p.created_at) <= $4::timestamp + INTERVAL '23 hours 59 minutes 59 seconds')
  `;

  const [summaryResult, rowsResult] = await Promise.all([
    db.query(
      `
      SELECT
        COUNT(DISTINCT a.post_id)::int AS tracked_posts,
        COUNT(*)::int AS analytics_rows,
        COALESCE(SUM(COALESCE(a.likes, 0)), 0)::int AS likes,
        COALESCE(SUM(COALESCE(a.comments, 0)), 0)::int AS comments,
        COALESCE(SUM(COALESCE(a.shares, 0)), 0)::int AS shares,
        COALESCE(SUM(COALESCE(a.reach, 0)), 0)::int AS reach,
        COALESCE(SUM(COALESCE(a.impressions, 0)), 0)::int AS impressions,
        COALESCE(SUM(COALESCE(a.saves, 0)), 0)::int AS saves,
        COALESCE(SUM(COALESCE(a.clicks, 0)), 0)::int AS clicks,
        MAX(a.synced_at) AS last_synced_at,
        COUNT(*) FILTER (WHERE a.reach IS NULL OR a.impressions IS NULL)::int AS permission_limited_rows
      ${baseQuery}
      `,
      [tenantId, platformFilter, fromDate, toDate]
    ),
    db.query(
      `
      SELECT
        a.*,
        p.title,
        p.channel,
        p.published_at,
        p.status
      ${baseQuery}
      ORDER BY
        (COALESCE(a.likes, 0) + COALESCE(a.comments, 0) + COALESCE(a.shares, 0) + COALESCE(a.saves, 0) + COALESCE(a.clicks, 0)) DESC,
        COALESCE(p.published_at, p.created_at) DESC,
        a.synced_at DESC
      LIMIT $5::int
      OFFSET $6::int
      `,
      [tenantId, platformFilter, fromDate, toDate, normalizedLimit, normalizedOffset]
    ),
  ]);

  const summary = summaryResult.rows[0] || {};
  const topPosts = rowsResult.rows.map(normalizeAnalyticsRow);
  const engagement = Number(summary.likes || 0) + Number(summary.comments || 0) + Number(summary.shares || 0) + Number(summary.saves || 0) + Number(summary.clicks || 0);
  const engagementRate = Number(summary.impressions || 0) > 0 ? (engagement / Number(summary.impressions || 0)) * 100 : null;

  return {
    filters: {
      platform: platformFilter || "all",
      from: fromDate,
      to: toDate,
      limit: normalizedLimit,
      offset: normalizedOffset,
    },
    summary: {
      tracked_posts: Number(summary.tracked_posts || 0),
      analytics_rows: Number(summary.analytics_rows || 0),
      likes: Number(summary.likes || 0),
      comments: Number(summary.comments || 0),
      shares: Number(summary.shares || 0),
      reach: Number(summary.reach || 0),
      impressions: Number(summary.impressions || 0),
      saves: Number(summary.saves || 0),
      clicks: Number(summary.clicks || 0),
      engagement,
      engagement_rate: engagementRate,
      last_synced_at: summary.last_synced_at || null,
      permission_limited_rows: Number(summary.permission_limited_rows || 0),
    },
    top_posts: topPosts,
  };
};

export const syncAllMarketingAnalytics = async () => {
  await ensureMarketingSchema();
  const tenantIds = await getDistinctTenantIdsForSync();
  const results = [];

  for (const tenantId of tenantIds) {
    try {
      results.push(await syncMarketingAnalyticsForTenant({ tenantId, force: false }));
    } catch (error) {
      console.error("[marketing-analytics] tenant sync error", {
        tenantId,
        reason: error?.message || "Unknown analytics sync failure",
      });
      results.push({
        tenantId,
        skipped: true,
        reason: error?.message || "Unknown analytics sync failure",
        synced: 0,
        warnings: [error?.message || "Unknown analytics sync failure"],
      });
    }
  }

  return results;
};

export const runMarketingPerformanceSync = syncAllMarketingAnalytics;

let analyticsSchedulerStarted = false;
let analyticsSchedulerRunning = false;
let analyticsSchedulerTimer = null;

export const startMarketingAnalyticsSyncScheduler = () => {
  if (analyticsSchedulerStarted) return;
  analyticsSchedulerStarted = true;

  const runOnce = async () => {
    if (analyticsSchedulerRunning) return;
    analyticsSchedulerRunning = true;
    try {
      console.log("[marketing-performance-sync] scheduler run");
      await runMarketingPerformanceSync();
    } catch (error) {
      console.error("[marketing-analytics] scheduler scan error", error);
    } finally {
      analyticsSchedulerRunning = false;
    }
  };

  console.log("[marketing-analytics] scheduler started", { intervalMs: SYNC_INTERVAL_MS });
  void runOnce();
  analyticsSchedulerTimer = setInterval(() => {
    void runOnce();
  }, SYNC_INTERVAL_MS);
};

export const stopMarketingAnalyticsSyncScheduler = () => {
  if (analyticsSchedulerTimer) {
    clearInterval(analyticsSchedulerTimer);
    analyticsSchedulerTimer = null;
  }
  analyticsSchedulerStarted = false;
  analyticsSchedulerRunning = false;
};

export const __marketingAnalyticsTestHooks = {
  calculatePerformanceScore,
  hasRealMetricValue,
  performanceLabel,
};
