import db from "../database/db.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";

const normalizePlatform = (value) => String(value || "").trim().toLowerCase() || "all";

const toDateSql = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const safeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildOrderFilters = ({ platform = "", from = null, to = null } = {}) => {
  const clauses = ["o.tenant_id = $1::bigint"];
  if (normalizePlatform(platform) !== "all") {
    clauses.push(
      "($2::text = 'all' OR LOWER(COALESCE(o.marketing_platform, o.marketing_source, '')) = $2::text OR LOWER(COALESCE(o.marketing_source, '')) = $2::text)"
    );
  }
  if (from) {
    clauses.push("o.created_at >= $3::timestamp");
  }
  if (to) {
    clauses.push("o.created_at <= $4::timestamp + INTERVAL '23 hours 59 minutes 59 seconds'");
  }
  return clauses.join(" AND ");
};

const buildEventFilters = ({ platform = "", from = null, to = null } = {}) => {
  const clauses = ["e.tenant_id = $1::bigint"];
  if (normalizePlatform(platform) !== "all") {
    clauses.push(
      "($2::text = 'all' OR LOWER(COALESCE(e.platform, e.source, '')) = $2::text OR LOWER(COALESCE(e.source, '')) = $2::text)"
    );
  }
  if (from) {
    clauses.push("e.created_at >= $3::timestamp");
  }
  if (to) {
    clauses.push("e.created_at <= $4::timestamp + INTERVAL '23 hours 59 minutes 59 seconds'");
  }
  return clauses.join(" AND ");
};

const buildQueryParams = ({ tenantId, platform = "", from = null, to = null, limit = 20, offset = 0 } = {}) => {
  const normalizedPlatform = normalizePlatform(platform);
  return {
    tenantId,
    platform: normalizedPlatform,
    from: toDateSql(from),
    to: toDateSql(to),
    limit: Math.max(1, Math.min(Number(limit) || 20, 100)),
    offset: Math.max(0, Number(offset) || 0),
  };
};

const getOrdersBase = async (tenantId, platform, from, to) => {
  const where = buildOrderFilters({ platform, from, to });
  const result = await db.query(
    `
    SELECT
      o.id,
      o.created_at,
      o.updated_at,
      o.total,
      o.paid_amount,
      o.marketing_source,
      o.marketing_platform,
      o.marketing_post_id,
      o.marketing_campaign,
      o.attribution_type,
      o.channel
    FROM orders o
    WHERE ${where}
      AND (
        o.marketing_source IS NOT NULL
        OR o.marketing_platform IS NOT NULL
        OR o.marketing_post_id IS NOT NULL
        OR o.marketing_campaign IS NOT NULL
        OR o.attribution_type IS NOT NULL
      )
    `,
    [tenantId, platform, from, to]
  );
  return result.rows || [];
};

const getEventsBase = async (tenantId, platform, from, to) => {
  const where = buildEventFilters({ platform, from, to });
  const result = await db.query(
    `
    SELECT
      e.id,
      e.created_at,
      e.event_type,
      e.source,
      e.platform,
      e.post_id,
      e.campaign,
      e.order_id,
      e.attribution_type,
      e.tracking_code
    FROM marketing_attribution_events e
    WHERE ${where}
    `,
    [tenantId, platform, from, to]
  );
  return result.rows || [];
};

const aggregatePostsFromOrders = (rows = []) => {
  const map = new Map();
  for (const row of rows) {
    const postId = row.marketing_post_id;
    if (postId === null || postId === undefined) continue;
    const platform = normalizePlatform(row.marketing_platform || row.marketing_source || row.channel || "other");
    const key = `${postId}:${platform}`;
    const current = map.get(key) || {
      post_id: postId,
      platform,
      title: `Post #${postId}`,
      tracking_kind: String(row.attribution_type || "").toLowerCase().includes("story") ? "story" : "post",
      orders: 0,
      revenue: 0,
      paid_amount: 0,
      last_event_at: null,
    };
    current.orders += 1;
    current.revenue += safeNumber(row.total);
    current.paid_amount += safeNumber(row.paid_amount);
    const updatedAt = row.created_at || row.updated_at || null;
    if (!current.last_event_at || (updatedAt && new Date(updatedAt) > new Date(current.last_event_at))) {
      current.last_event_at = updatedAt;
    }
    map.set(key, current);
  }
  return map;
};

const aggregatePostsFromEvents = (rows = []) => {
  const map = new Map();
  for (const row of rows) {
    const postId = row.post_id;
    if (postId === null || postId === undefined) continue;
    const platform = normalizePlatform(row.platform || row.source || "other");
    const key = `${postId}:${platform}`;
    const current = map.get(key) || {
      post_id: postId,
      platform,
      clicks: 0,
      add_to_cart: 0,
      checkout: 0,
      order_created: 0,
      last_event_at: null,
    };
    if (row.event_type === "click") current.clicks += 1;
    if (row.event_type === "add_to_cart") current.add_to_cart += 1;
    if (row.event_type === "checkout") current.checkout += 1;
    if (row.event_type === "order_created") current.order_created += 1;
    const createdAt = row.created_at || null;
    if (!current.last_event_at || (createdAt && new Date(createdAt) > new Date(current.last_event_at))) {
      current.last_event_at = createdAt;
    }
    map.set(key, current);
  }
  return map;
};

const mergePostAggregates = (ordersMap, eventsMap) => {
  const merged = new Map();

  for (const [key, value] of ordersMap.entries()) {
    merged.set(key, { ...value });
  }

  for (const [key, value] of eventsMap.entries()) {
    const current = merged.get(key) || {
      post_id: value.post_id,
      platform: value.platform,
      title: `Post #${value.post_id}`,
      tracking_kind: "post",
      orders: 0,
      revenue: 0,
      paid_amount: 0,
      clicks: 0,
      add_to_cart: 0,
      checkout: 0,
      order_created: 0,
      last_event_at: null,
    };

    current.clicks = (current.clicks || 0) + (value.clicks || 0);
    current.add_to_cart = (current.add_to_cart || 0) + (value.add_to_cart || 0);
    current.checkout = (current.checkout || 0) + (value.checkout || 0);
    current.order_created = (current.order_created || 0) + (value.order_created || 0);
    if (!current.last_event_at || (value.last_event_at && new Date(value.last_event_at) > new Date(current.last_event_at))) {
      current.last_event_at = value.last_event_at;
    }
    merged.set(key, current);
  }

  return Array.from(merged.values());
};

export const buildMarketingAttributionDashboard = async ({ tenantId, platform = "", from = null, to = null, limit = 20 } = {}) => {
  await ensureMarketingSchema();
  const filters = buildQueryParams({ tenantId, platform, from, to, limit });

  const [orderRows, eventRows, topCampaignRows, storyVsPostRows, salesOverTimeRows, platformComparisonRows] = await Promise.all([
    getOrdersBase(filters.tenantId, filters.platform, filters.from, filters.to),
    getEventsBase(filters.tenantId, filters.platform, filters.from, filters.to),
    db.query(
      `
      SELECT
        COALESCE(o.marketing_campaign, 'Unassigned') AS campaign,
        LOWER(COALESCE(o.marketing_platform, o.marketing_source, 'other')) AS platform,
        COUNT(*)::int AS orders,
        COALESCE(SUM(COALESCE(o.total, 0)), 0)::numeric AS revenue,
        COALESCE(MAX(o.created_at), MAX(o.updated_at)) AS last_event_at
      FROM orders o
      WHERE ${buildOrderFilters({ platform: filters.platform, from: filters.from, to: filters.to })}
        AND (
          o.marketing_source IS NOT NULL
          OR o.marketing_platform IS NOT NULL
          OR o.marketing_post_id IS NOT NULL
          OR o.marketing_campaign IS NOT NULL
          OR o.attribution_type IS NOT NULL
        )
        AND o.marketing_campaign IS NOT NULL
      GROUP BY campaign, platform
      ORDER BY revenue DESC, orders DESC
      LIMIT $5::int
      `,
      [filters.tenantId, filters.platform, filters.from, filters.to, filters.limit]
    ),
    db.query(
      `
      SELECT
        CASE WHEN COALESCE(o.attribution_type, '') IN ('story', 'instagram_story') THEN 'story' ELSE 'post' END AS tracking_kind,
        COUNT(*)::int AS orders,
        COALESCE(SUM(COALESCE(o.total, 0)), 0)::numeric AS revenue
      FROM orders o
      WHERE ${buildOrderFilters({ platform: filters.platform, from: filters.from, to: filters.to })}
        AND (
          o.marketing_source IS NOT NULL
          OR o.marketing_platform IS NOT NULL
          OR o.marketing_post_id IS NOT NULL
          OR o.marketing_campaign IS NOT NULL
          OR o.attribution_type IS NOT NULL
        )
        AND o.marketing_post_id IS NOT NULL
      GROUP BY tracking_kind
      ORDER BY revenue DESC, orders DESC
      `,
      [filters.tenantId, filters.platform, filters.from, filters.to]
    ),
    db.query(
      `
      SELECT
        DATE_TRUNC('day', o.created_at) AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM(COALESCE(o.total, 0)), 0)::numeric AS revenue
      FROM orders o
      WHERE ${buildOrderFilters({ platform: filters.platform, from: filters.from, to: filters.to })}
        AND (
          o.marketing_source IS NOT NULL
          OR o.marketing_platform IS NOT NULL
          OR o.marketing_post_id IS NOT NULL
          OR o.marketing_campaign IS NOT NULL
          OR o.attribution_type IS NOT NULL
        )
      GROUP BY DATE_TRUNC('day', o.created_at)
      ORDER BY day ASC
      `,
      [filters.tenantId, filters.platform, filters.from, filters.to]
    ),
    db.query(
      `
      SELECT
        LOWER(COALESCE(o.marketing_platform, o.marketing_source, 'other')) AS platform,
        COUNT(*)::int AS orders,
        COALESCE(SUM(COALESCE(o.total, 0)), 0)::numeric AS revenue,
        COALESCE(MAX(o.created_at), MAX(o.updated_at)) AS last_event_at
      FROM orders o
      WHERE ${buildOrderFilters({ platform: filters.platform, from: filters.from, to: filters.to })}
        AND (
          o.marketing_source IS NOT NULL
          OR o.marketing_platform IS NOT NULL
          OR o.marketing_post_id IS NOT NULL
          OR o.marketing_campaign IS NOT NULL
          OR o.attribution_type IS NOT NULL
        )
      GROUP BY LOWER(COALESCE(o.marketing_platform, o.marketing_source, 'other'))
      ORDER BY revenue DESC, orders DESC
      `,
      [filters.tenantId, filters.platform, filters.from, filters.to]
    ),
  ]);

  const ordersMap = aggregatePostsFromOrders(orderRows);
  const eventsMap = aggregatePostsFromEvents(eventRows);
  const mergedPosts = mergePostAggregates(ordersMap, eventsMap).sort((a, b) => {
    const revenueDiff = safeNumber(b.revenue) - safeNumber(a.revenue);
    if (revenueDiff !== 0) return revenueDiff;
    return safeNumber(b.orders) - safeNumber(a.orders);
  });

  const topPosts = mergedPosts.slice(0, filters.limit).map((row) => {
    const engagement = safeNumber(row.clicks) + safeNumber(row.add_to_cart) + safeNumber(row.checkout) + safeNumber(row.order_created);
    const engagementRate = safeNumber(row.orders) > 0 ? (engagement / safeNumber(row.orders)) * 100 : null;
    return {
      post_id: row.post_id,
      platform: row.platform,
      title: row.title || `Post #${row.post_id}`,
      tracking_kind: row.tracking_kind || "post",
      orders: safeNumber(row.orders),
      revenue: safeNumber(row.revenue),
      paid_amount: safeNumber(row.paid_amount),
      clicks: safeNumber(row.clicks),
      add_to_cart: safeNumber(row.add_to_cart),
      checkout: safeNumber(row.checkout),
      order_created: safeNumber(row.order_created),
      engagement,
      engagement_rate: engagementRate,
      last_event_at: row.last_event_at || null,
    };
  });

  const summaryOrders = orderRows.reduce(
    (acc, row) => {
      acc.orders += 1;
      acc.revenue += safeNumber(row.total);
      acc.paid_amount += safeNumber(row.paid_amount);
      if (String(row.attribution_type || "").toLowerCase().includes("story")) acc.story_orders += 1;
      else if (row.marketing_post_id !== null && row.marketing_post_id !== undefined) acc.post_orders += 1;
      if (row.marketing_campaign) acc.campaign_orders += 1;
      return acc;
    },
    { orders: 0, revenue: 0, paid_amount: 0, story_orders: 0, post_orders: 0, campaign_orders: 0 }
  );

  const summaryEvents = eventRows.reduce(
    (acc, row) => {
      if (row.event_type === "click") acc.clicks += 1;
      if (row.event_type === "add_to_cart") acc.add_to_cart += 1;
      if (row.event_type === "checkout") acc.checkout += 1;
      if (row.event_type === "order_created") acc.order_created += 1;
      return acc;
    },
    { clicks: 0, add_to_cart: 0, checkout: 0, order_created: 0 }
  );

  const engagement = summaryEvents.clicks + summaryEvents.add_to_cart + summaryEvents.checkout + summaryEvents.order_created;
  const conversionRate = summaryEvents.clicks > 0 ? (summaryEvents.order_created / summaryEvents.clicks) * 100 : null;

  const summary = {
    revenue_from_marketing: summaryOrders.revenue,
    marketing_orders: summaryOrders.orders,
    attributed_orders: summaryOrders.orders,
    attributed_campaign_orders: summaryOrders.campaign_orders,
    attributed_revenue: summaryOrders.revenue,
    story_orders: summaryOrders.story_orders,
    post_orders: summaryOrders.post_orders,
    clicks: summaryEvents.clicks,
    add_to_cart: summaryEvents.add_to_cart,
    checkout: summaryEvents.checkout,
    order_created: summaryEvents.order_created,
    engagement,
    conversion_rate: conversionRate,
    last_synced_at: orderRows.reduce((latest, row) => {
      const candidate = row.updated_at || row.created_at || null;
      if (!candidate) return latest;
      if (!latest) return candidate;
      return new Date(candidate) > new Date(latest) ? candidate : latest;
    }, null),
  };

  const platformComparison = platformComparisonRows.rows.map((row) => {
    const key = normalizePlatform(row.platform);
    const totalOrders = safeNumber(row.orders);
    const totalRevenue = safeNumber(row.revenue);
    return {
      platform: key,
      orders: totalOrders,
      revenue: totalRevenue,
      conversion_rate: summaryEvents.clicks > 0 ? (totalOrders / summaryEvents.clicks) * 100 : null,
      last_event_at: row.last_event_at || null,
    };
  });

  const bestPlatform = platformComparison.slice().sort((a, b) => safeNumber(b.revenue) - safeNumber(a.revenue))[0] || null;
  const topConvertingPost = topPosts.slice().sort((a, b) => safeNumber(b.orders) - safeNumber(a.orders))[0] || null;

  return {
    filters: {
      platform: filters.platform || "all",
      from: filters.from,
      to: filters.to,
      limit: filters.limit,
      offset: filters.offset,
    },
    summary: {
      ...summary,
      best_platform: bestPlatform?.platform || null,
      top_converting_post: topConvertingPost
        ? {
            post_id: topConvertingPost.post_id,
            title: topConvertingPost.title,
            platform: topConvertingPost.platform,
            revenue: topConvertingPost.revenue,
            orders: topConvertingPost.orders,
          }
        : null,
    },
    top_posts: topPosts,
    top_campaigns: topCampaignRows.rows.map((row) => ({
      campaign: row.campaign,
      platform: row.platform,
      orders: safeNumber(row.orders),
      revenue: safeNumber(row.revenue),
      last_event_at: row.last_event_at || null,
    })),
    story_vs_post: storyVsPostRows.rows.map((row) => ({
      tracking_kind: row.tracking_kind || "post",
      orders: safeNumber(row.orders),
      revenue: safeNumber(row.revenue),
    })),
    sales_over_time: salesOverTimeRows.rows.map((row) => ({
      day: row.day,
      orders: safeNumber(row.orders),
      revenue: safeNumber(row.revenue),
    })),
    platform_comparison: platformComparison,
  };
};

export const syncMarketingAttributionForTenant = async ({ tenantId, platform = "", from = null, to = null } = {}) => {
  await ensureMarketingSchema();
  const result = await db.query(
    `
    SELECT *
    FROM marketing_posts
    WHERE tenant_id = $1::bigint
      AND (
        status = 'published'
        OR story_status = 'published'
        OR platform_post_id IS NOT NULL
      )
    ORDER BY created_at ASC
    `,
    [tenantId]
  );

  const rows = result.rows || [];
  return {
    tenantId,
    platform: normalizePlatform(platform),
    from: toDateSql(from),
    to: toDateSql(to),
    scanned: rows.length,
  };
};

const syncSchedulerState = {
  started: false,
  running: false,
  timer: null,
};

export const syncAllMarketingAttribution = async () => {
  await ensureMarketingSchema();
  const tenantResult = await db.query(
    `
    SELECT DISTINCT tenant_id
    FROM marketing_posts
    WHERE tenant_id IS NOT NULL
    ORDER BY tenant_id ASC
    `
  );

  const results = [];
  for (const row of tenantResult.rows || []) {
    try {
      results.push(await syncMarketingAttributionForTenant({ tenantId: row.tenant_id }));
    } catch (error) {
      console.error("[marketing-attribution] tenant sync error", {
        tenantId: row.tenant_id,
        reason: error?.message || "Unknown attribution sync failure",
      });
      results.push({
        tenantId: row.tenant_id,
        skipped: true,
        reason: error?.message || "Unknown attribution sync failure",
      });
    }
  }

  return results;
};

export const startMarketingAttributionSyncScheduler = () => {
  if (syncSchedulerState.started) return;
  syncSchedulerState.started = true;

  const runOnce = async () => {
    if (syncSchedulerState.running) return;
    syncSchedulerState.running = true;
    try {
      const results = await syncAllMarketingAttribution();
      console.log("[marketing-attribution] scheduler sync complete", {
        tenants: Array.isArray(results) ? results.length : 0,
      });
    } catch (error) {
      console.error("[marketing-attribution] scheduler scan error", error);
    } finally {
      syncSchedulerState.running = false;
    }
  };

  console.log("[marketing-attribution] scheduler started", { intervalMs: 6 * 60 * 60 * 1000 });
  void runOnce();
  syncSchedulerState.timer = setInterval(() => {
    void runOnce();
  }, 6 * 60 * 60 * 1000);
};

export const stopMarketingAttributionSyncScheduler = () => {
  if (syncSchedulerState.timer) {
    clearInterval(syncSchedulerState.timer);
    syncSchedulerState.timer = null;
  }
  syncSchedulerState.started = false;
  syncSchedulerState.running = false;
};
