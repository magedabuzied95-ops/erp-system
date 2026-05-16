import db from "../database/db.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { buildTrackingLink, detectMarketingSession, generateTrackingCode, normalizeAttributionPlatform } from "../utils/marketingAttribution.js";

const trimString = (value) => String(value || "").trim();

const getTenantRows = async () => {
  const result = await db.query(
    `
    SELECT DISTINCT tenant_id
    FROM marketing_posts
    WHERE tenant_id IS NOT NULL
    ORDER BY tenant_id ASC
    `
  );
  return result.rows.map((row) => row.tenant_id);
};

const getMarketingBaseOrigin = () =>
  String(process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL || "").trim().replace(/\/$/, "");

export const ensureTrackingForPost = async (post, { kind = "post", platform = null } = {}) => {
  if (!post?.id) return null;
  const currentKind = trimString(kind || post.tracking_kind || "post");
  const sourcePlatform = normalizeAttributionPlatform(platform || post.channel || post.tracking_source || "facebook");
  const code = trimString(post.tracking_code);
  const resolvedCode = code || generateTrackingCode({ tenantId: post.tenant_id || 1, platform: sourcePlatform, postId: post.id, kind: currentKind });
  const resolvedLink = buildTrackingLink({
    origin: getMarketingBaseOrigin(),
    code: resolvedCode,
    source: sourcePlatform,
    postId: post.id,
    campaign: post.campaign_name || "",
    platform: sourcePlatform,
  });

  const result = await db.query(
    `
    UPDATE marketing_posts
    SET
      tracking_code = $1::text,
      tracking_link = $2::text,
      tracking_source = $3::text,
      tracking_kind = $4::varchar,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $5::bigint
    RETURNING *
    `,
    [resolvedCode, resolvedLink, sourcePlatform, currentKind, post.id]
  );

  return result.rows[0] || null;
};

export const logAttributionEvent = async ({
  tenantId,
  eventType,
  sessionId = null,
  source = null,
  platform = null,
  postId = null,
  campaign = null,
  productId = null,
  orderId = null,
  trackingCode = null,
  trackingLink = null,
  attributionType = null,
  referrer = null,
  userAgent = null,
  ipAddress = null,
  metadata = {},
} = {}) => {
  if (!tenantId || !eventType) return null;

  const result = await db.query(
    `
    INSERT INTO marketing_attribution_events (
      tenant_id,
      event_type,
      session_id,
      source,
      platform,
      post_id,
      campaign,
      product_id,
      order_id,
      tracking_code,
      tracking_link,
      attribution_type,
      referrer,
      user_agent,
      ip_address,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
    RETURNING *
    `,
    [
      tenantId,
      eventType,
      sessionId,
      source,
      platform,
      postId,
      campaign,
      productId,
      orderId,
      trackingCode,
      trackingLink,
      attributionType,
      referrer,
      userAgent,
      ipAddress,
      JSON.stringify(metadata || {}),
    ]
  );

  return result.rows[0] || null;
};

export const detectMarketingAttribution = (req = {}) => {
  const session = detectMarketingSession(req);
  const referrer = trimString(req.headers?.referer || req.headers?.referrer || "");
  const userAgent = trimString(req.headers?.["user-agent"] || "");
  const ipAddress = trimString(req.headers?.["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "");
  return { ...session, referrer, userAgent, ipAddress };
};

export const resolveTrackedProductRedirect = async ({ code, req } = {}) => {
  const safeCode = trimString(code);
  if (!safeCode) return null;

  const result = await db.query(
    `
    SELECT
      mp.id AS post_id,
      mp.tenant_id,
      mp.product_id,
      mp.tracking_code,
      mp.tracking_link,
      mp.tracking_source,
      mp.tracking_kind,
      mp.campaign_id,
      mp.title,
      mp.channel,
      c.name AS campaign_name
    FROM marketing_posts mp
    LEFT JOIN marketing_campaigns c ON c.id = mp.campaign_id
    WHERE mp.tracking_code = $1
    LIMIT 1
    `,
    [safeCode]
  );

  const post = result.rows[0] || null;
  if (!post) return null;

  const source = post.tracking_source || post.channel || "other";
  const platform = normalizeAttributionPlatform(source);
  const event = await logAttributionEvent({
    tenantId: post.tenant_id,
    eventType: "click",
    sessionId: detectMarketingSession(req).session_id,
    source,
    platform,
    postId: post.post_id,
    campaign: post.campaign_name || null,
    productId: post.product_id || null,
    trackingCode: post.tracking_code,
    trackingLink: post.tracking_link,
    attributionType: "click",
    referrer: req.headers?.referer || req.headers?.referrer || null,
    userAgent: req.headers?.["user-agent"] || null,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    metadata: {
      query: req.query || {},
    },
  });

  return {
    post,
    event,
  };
};

export const backfillTrackingForTenant = async (tenantId) => {
  await ensureMarketingSchema();
  const result = await db.query(
    `
    SELECT *
    FROM marketing_posts
    WHERE tenant_id = $1::bigint
      AND status = 'published'
    ORDER BY created_at ASC
    `,
    [tenantId]
  );

  const updated = [];
  for (const row of result.rows || []) {
    const rowWithTracking = await ensureTrackingForPost(row, {
      kind: row.story_status === "published" ? "story" : "post",
      platform: row.channel || "facebook",
    });
    if (rowWithTracking) updated.push(rowWithTracking);
  }

  return updated;
};

export const syncMarketingAttribution = async ({ tenantId = null } = {}) => {
  await ensureMarketingSchema();
  const tenantIds = tenantId ? [tenantId] : await getTenantRows();
  const results = [];

  for (const tenantId of tenantIds) {
    try {
      const updatedPosts = await backfillTrackingForTenant(tenantId);
      const orderBackfill = await db.query(
        `
        UPDATE orders o
        SET
          marketing_source = COALESCE(o.marketing_source, e.source, e.platform),
          marketing_platform = COALESCE(o.marketing_platform, e.platform, e.source),
          marketing_post_id = COALESCE(o.marketing_post_id, e.post_id),
          marketing_campaign = COALESCE(o.marketing_campaign, e.campaign),
          attribution_type = COALESCE(o.attribution_type, e.attribution_type),
          marketing_tracking_code = COALESCE(o.marketing_tracking_code, e.tracking_code),
          marketing_session_id = COALESCE(o.marketing_session_id, e.session_id),
          updated_at = CURRENT_TIMESTAMP
        FROM marketing_attribution_events e
        WHERE o.id = e.order_id
          AND o.tenant_id = $1::bigint
          AND e.tenant_id = $1::bigint
          AND e.event_type = 'order_created'
        RETURNING o.id
        `,
        [tenantId]
      );

      results.push({
        tenantId,
        updated_posts: updatedPosts.length,
        updated_orders: orderBackfill.rowCount || 0,
      });
    } catch (error) {
      console.error("[marketing-attribution] sync error", { tenantId, message: error?.message });
      results.push({ tenantId, error: error?.message || "Sync failed" });
    }
  }

  return results;
};

let attributionSyncSchedulerStarted = false;
let attributionSyncSchedulerRunning = false;
let attributionSyncSchedulerTimer = null;

export const startMarketingAttributionSyncScheduler = () => {
  if (attributionSyncSchedulerStarted) return;
  attributionSyncSchedulerStarted = true;

  const runOnce = async () => {
    if (attributionSyncSchedulerRunning) return;
    attributionSyncSchedulerRunning = true;
    try {
      const results = await syncMarketingAttribution();
      console.log("[marketing-attribution] scheduler sync complete", {
        tenants: Array.isArray(results) ? results.length : 0,
      });
    } catch (error) {
      console.error("[marketing-attribution] scheduler scan error", error);
    } finally {
      attributionSyncSchedulerRunning = false;
    }
  };

  console.log("[marketing-attribution] scheduler started", { intervalMs: 6 * 60 * 60 * 1000 });
  void runOnce();
  attributionSyncSchedulerTimer = setInterval(() => {
    void runOnce();
  }, 6 * 60 * 60 * 1000);
};

export const stopMarketingAttributionSyncScheduler = () => {
  if (attributionSyncSchedulerTimer) {
    clearInterval(attributionSyncSchedulerTimer);
    attributionSyncSchedulerTimer = null;
  }
  attributionSyncSchedulerStarted = false;
  attributionSyncSchedulerRunning = false;
};
