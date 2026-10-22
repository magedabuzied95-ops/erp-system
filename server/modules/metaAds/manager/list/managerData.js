// Read side of the Ads Manager screen: bootstrap, the three level lists with
// insight totals, and the per-object series / breakdown for the charts drawer.
// Every query is tenant-scoped; nothing here ever selects a token column.

import db from "../../../../database/db.js";
import { BREAKDOWNS, metaAdsCatalog } from "../../metaAdsCatalog.js";
import { getAccountContext, httpError, listAccounts, syncBreakdown, text } from "../../metaAdsCore.js";
import { adReviewUrl, rejectionSummary } from "../../metaAdsReview.js";

export const LEVELS = ["campaign", "adset", "ad"];
export const LEVEL_TABLE = { campaign: "meta_ads_campaigns", adset: "meta_ads_adsets", ad: "meta_ads_ads" };

export const parseLevel = (value) => {
  const level = text(value) || "campaign";
  if (!LEVELS.includes(level)) throw httpError(400, "Unknown level");
  return level;
};

// "all" (or anything not 7/30/90/1) → 0 = no date filter.
export const parseDays = (value) => {
  const days = Number(value);
  return [1, 7, 14, 30, 90].includes(days) ? days : 0;
};

export const parseId = (value, label = "id") => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, `Invalid ${label}`);
  return id;
};

// Window filter on meta_ads_insights.date_start, Cairo calendar days, today included.
const windowClause = (days, alias, paramIndex) =>
  days > 0 ? ` AND ${alias}.date_start > (NOW() AT TIME ZONE 'Africa/Cairo')::date - $${paramIndex}::int` : "";

// ------------------------------------------------------------------ bootstrap

export const loadBootstrap = async (tenantId) => {
  const accounts = await listAccounts(tenantId);
  const [audiences, forms, saved, productSets] = await Promise.all([
    db.query(`SELECT account_id, meta_id, name, subtype FROM meta_ads_audiences WHERE tenant_id = $1 ORDER BY name`, [tenantId]),
    db.query(`SELECT account_id, id, meta_id, name, status FROM meta_ads_lead_forms WHERE tenant_id = $1 ORDER BY name`, [tenantId]),
    db.query(`SELECT account_id, id, name, targeting FROM meta_ads_saved_audiences WHERE tenant_id = $1 ORDER BY name`, [tenantId]),
    db.query(`SELECT account_id, catalog_id, catalog_name, meta_id, name, product_count FROM meta_ads_product_sets WHERE tenant_id = $1 ORDER BY catalog_name, name`, [tenantId]),
  ]);
  const group = (rows, accountId, pick) => rows.filter((row) => String(row.account_id) === String(accountId)).map(pick);
  return {
    accounts: accounts.map((account) => ({
      ...account,
      custom_audiences: group(audiences.rows, account.id, ({ meta_id, name, subtype }) => ({ meta_id, name, subtype })),
      lead_forms: group(forms.rows, account.id, ({ id, meta_id, name, status }) => ({ id, meta_id, name, status })),
      saved_audiences: group(saved.rows, account.id, ({ id, name, targeting }) => ({ id, name, targeting })),
      product_sets: group(productSets.rows, account.id, ({ catalog_id, catalog_name, meta_id, name, product_count }) => ({ catalog_id, catalog_name, meta_id, name, product_count })),
    })),
    catalog: metaAdsCatalog(),
  };
};

// ------------------------------------------------------------------ list data

const insightTotalsCte = (days) => `
  WITH ins AS (
    SELECT i.object_meta_id,
           SUM(i.results) AS results,
           MAX(i.result_type) AS result_type,
           SUM(i.reach) AS reach,
           SUM(i.impressions) AS impressions,
           SUM(i.spend) AS spend,
           SUM(i.clicks) AS clicks,
           SUM(i.purchases) AS purchases,
           SUM(i.purchase_value) AS purchase_value,
           SUM(i.purchases_7d_click) AS purchases_7d_click,
           SUM(i.purchase_value_7d_click) AS purchase_value_7d_click,
           SUM(i.landing_page_views) AS landing_page_views,
           SUM(i.add_to_cart) AS add_to_cart,
           SUM(i.initiate_checkout) AS initiate_checkout,
           SUM(i.link_clicks) AS link_clicks,
           -- Meta's rankings are a verdict, not a sum: the newest day that has one speaks.
           (ARRAY_AGG(i.quality_ranking ORDER BY i.date_start DESC) FILTER (WHERE i.quality_ranking IS NOT NULL))[1] AS quality_ranking,
           (ARRAY_AGG(i.engagement_rate_ranking ORDER BY i.date_start DESC) FILTER (WHERE i.engagement_rate_ranking IS NOT NULL))[1] AS engagement_rate_ranking,
           (ARRAY_AGG(i.conversion_rate_ranking ORDER BY i.date_start DESC) FILTER (WHERE i.conversion_rate_ranking IS NOT NULL))[1] AS conversion_rate_ranking,
           -- Daily reach rows add the same person twice, so this frequency is a floor; a
           -- single day (days = 1) is exact.
           CASE WHEN SUM(i.reach) > 0 THEN SUM(i.impressions)::float / SUM(i.reach) END AS frequency
      FROM meta_ads_insights i
     WHERE i.tenant_id = $1 AND i.account_id = $2 AND i.level = $3${windowClause(days, "i", 4)}
     GROUP BY i.object_meta_id
  )`;

// Ratios divide the window's sums (not averages of daily ratios), the way Ads Manager does.
const INSIGHT_SELECT = `ins.results, ins.result_type, ins.reach, ins.impressions, ins.spend, ins.clicks,
  ins.purchases, ins.purchase_value, ins.purchases_7d_click, ins.purchase_value_7d_click,
  ins.landing_page_views, ins.add_to_cart, ins.initiate_checkout, ins.link_clicks,
  ins.quality_ranking, ins.engagement_rate_ranking, ins.conversion_rate_ranking, ins.frequency,
  CASE WHEN ins.spend > 0 THEN ins.purchase_value / ins.spend END AS roas,
  CASE WHEN ins.purchases > 0 THEN ins.spend / ins.purchases END AS cost_per_purchase,
  CASE WHEN ins.spend > 0 THEN ins.purchase_value_7d_click / ins.spend END AS roas_7d_click,
  CASE WHEN ins.purchases_7d_click > 0 THEN ins.spend / ins.purchases_7d_click END AS cost_per_purchase_7d_click`;

// The shop's own orders over the same window, so Meta's purchase count sits next to what the ERP
// actually booked. Online = the storefront channel (canonicalOrderChannel in publicOrderNumber.js
// folds the old spellings; the IN list guards rows written before that fold). A lifetime window
// (days = 0) starts where the account's insights start, so the two sides cover the same days.
const erpOnlineOrders = async (tenantId, accountId, days) => {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS orders, COALESCE(SUM(o.total), 0)::float AS revenue
       FROM orders o
      WHERE o.tenant_id = $1
        AND LOWER(COALESCE(o.channel, '')) IN ('storefront', 'website', 'web', 'online')
        AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')
        AND o.created_at >= CASE
              WHEN $3::int > 0 THEN ((NOW() AT TIME ZONE 'Africa/Cairo')::date - $3::int + 1)::timestamp AT TIME ZONE 'Africa/Cairo'
              ELSE COALESCE((SELECT MIN(i.date_start)::timestamp AT TIME ZONE 'Africa/Cairo' FROM meta_ads_insights i WHERE i.tenant_id = $1 AND i.account_id = $2), o.created_at)
            END`,
    [tenantId, accountId, days || 0],
  );
  return { orders: Number(rows[0]?.orders) || 0, revenue: Number(rows[0]?.revenue) || 0 };
};
const LIVE_FILTER = (alias) => `(${alias}.is_draft OR (UPPER(${alias}.status) <> 'DELETED' AND UPPER(COALESCE(${alias}.effective_status, '')) <> 'DELETED'))`;
const ORDER = (alias) => `ORDER BY COALESCE(${alias}.meta_created_time, ${alias}.created_at) DESC, ${alias}.id DESC`;

export const loadManagerData = async (tenantId, { accountId, level, days, q, campaignId, adsetId }) => {
  const params = [tenantId, accountId, level];
  if (days > 0) params.push(days);
  else params.push(0); // keeps $4 present so the indices below never shift
  const extra = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (q) extra.push(`x.name ILIKE ${add(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)}`);

  let sql;
  if (level === "campaign") {
    sql = `${insightTotalsCte(days)}
      SELECT x.id, x.meta_id, x.name, x.is_draft, x.status, x.effective_status, x.objective, x.daily_budget, x.lifetime_budget,
             x.campaign_budget_optimization, x.start_time, x.stop_time, x.last_error, a.currency, ${INSIGHT_SELECT}
        FROM meta_ads_campaigns x
        JOIN meta_ads_accounts a ON a.id = x.account_id AND a.tenant_id = x.tenant_id
        LEFT JOIN ins ON ins.object_meta_id = x.meta_id
       WHERE x.tenant_id = $1 AND x.account_id = $2 AND ${LIVE_FILTER("x")} AND ($4::int IS NOT NULL)
       ${extra.length ? `AND ${extra.join(" AND ")}` : ""}
       ${ORDER("x")}`;
  } else if (level === "adset") {
    if (campaignId) extra.push(`x.campaign_id = ${add(campaignId)}`);
    sql = `${insightTotalsCte(days)}
      SELECT x.id, x.meta_id, x.name, x.is_draft, x.status, x.effective_status, x.campaign_id, c.name AS campaign_name,
             c.objective, x.optimization_goal, x.daily_budget, x.lifetime_budget, x.start_time, x.end_time, x.last_error,
             c.daily_budget AS campaign_daily_budget, c.lifetime_budget AS campaign_lifetime_budget,
             c.campaign_budget_optimization, a.currency, ${INSIGHT_SELECT}
        FROM meta_ads_adsets x
        JOIN meta_ads_accounts a ON a.id = x.account_id AND a.tenant_id = x.tenant_id
        LEFT JOIN meta_ads_campaigns c ON c.id = x.campaign_id AND c.tenant_id = x.tenant_id
        LEFT JOIN ins ON ins.object_meta_id = x.meta_id
       WHERE x.tenant_id = $1 AND x.account_id = $2 AND ${LIVE_FILTER("x")} AND ($4::int IS NOT NULL)
       ${extra.length ? `AND ${extra.join(" AND ")}` : ""}
       ${ORDER("x")}`;
  } else {
    if (adsetId) extra.push(`x.adset_id = ${add(adsetId)}`);
    if (campaignId) extra.push(`s.campaign_id = ${add(campaignId)}`);
    sql = `${insightTotalsCte(days)}
      SELECT x.id, x.meta_id, x.name, x.is_draft, x.status, x.effective_status, x.adset_id, s.name AS adset_name,
             s.campaign_id, x.creative_id, cr.image_url, cr.thumbnail_url, cr.creative_type, x.last_error, a.currency,
             x.review_feedback, x.issues, a.ad_account_id, ${INSIGHT_SELECT}
        FROM meta_ads_ads x
        JOIN meta_ads_accounts a ON a.id = x.account_id AND a.tenant_id = x.tenant_id
        LEFT JOIN meta_ads_adsets s ON s.id = x.adset_id AND s.tenant_id = x.tenant_id
        LEFT JOIN meta_ads_creatives cr ON cr.id = x.creative_id AND cr.tenant_id = x.tenant_id
        LEFT JOIN ins ON ins.object_meta_id = x.meta_id
       WHERE x.tenant_id = $1 AND x.account_id = $2 AND ${LIVE_FILTER("x")} AND ($4::int IS NOT NULL)
       ${extra.length ? `AND ${extra.join(" AND ")}` : ""}
       ${ORDER("x")}`;
  }

  const [{ rows }, counts, erp] = await Promise.all([db.query(sql, params), loadCounts(tenantId, accountId), erpOnlineOrders(tenantId, accountId, days)]);
  if (level === "ad") {
    // The row carries the verdict in one sentence plus the Ads Manager link that holds Meta's
    // own "request review" button; the raw feedback never leaves the server.
    for (const row of rows) {
      row.rejection = rejectionSummary(row);
      row.review_url = row.rejection ? adReviewUrl(row.ad_account_id, row.meta_id) : "";
      delete row.review_feedback;
      delete row.issues;
      delete row.ad_account_id;
    }
  }
  return { rows, counts, erp };
};

export const loadCounts = async (tenantId, accountId) => {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM meta_ads_campaigns x WHERE x.tenant_id = $1 AND x.account_id = $2 AND ${LIVE_FILTER("x")})::int AS campaign,
       (SELECT COUNT(*) FROM meta_ads_adsets x WHERE x.tenant_id = $1 AND x.account_id = $2 AND ${LIVE_FILTER("x")})::int AS adset,
       (SELECT COUNT(*) FROM meta_ads_ads x WHERE x.tenant_id = $1 AND x.account_id = $2 AND ${LIVE_FILTER("x")})::int AS ad`,
    [tenantId, accountId],
  );
  return rows[0] || { campaign: 0, adset: 0, ad: 0 };
};

// ------------------------------------------------------------------ single object

export const loadObject = async (tenantId, level, id) => {
  const { rows } = await db.query(`SELECT * FROM ${LEVEL_TABLE[level]} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows[0]) throw httpError(404, "Object not found");
  return rows[0];
};

// ------------------------------------------------------------------ charts drawer

export const loadSeries = async (tenantId, { accountId, level, id, days }) => {
  const row = await loadObject(tenantId, level, id);
  if (!row.meta_id) return { points: [] };
  const params = [tenantId, row.account_id || accountId, level, days || 0, row.meta_id];
  const { rows } = await db.query(
    `SELECT to_char(i.date_start, 'YYYY-MM-DD') AS date,
            SUM(i.results)::float AS results, SUM(i.spend)::float AS spend, SUM(i.impressions)::bigint AS impressions,
            SUM(i.reach)::bigint AS reach, SUM(i.clicks)::bigint AS clicks,
            SUM(i.purchases)::float AS purchases, SUM(i.purchase_value)::float AS purchase_value
       FROM meta_ads_insights i
      WHERE i.tenant_id = $1 AND i.account_id = $2 AND i.level = $3 AND i.object_meta_id = $5 AND ($4::int IS NOT NULL)
        ${windowClause(days, "i", 4)}
      GROUP BY i.date_start
      ORDER BY i.date_start`,
    params,
  );
  return {
    points: rows.map((point) => ({
      date: point.date,
      results: Number(point.results) || 0,
      spend: Number(point.spend) || 0,
      impressions: Number(point.impressions) || 0,
      reach: Number(point.reach) || 0,
      clicks: Number(point.clicks) || 0,
      purchases: Number(point.purchases) || 0,
      purchase_value: Number(point.purchase_value) || 0,
    })),
  };
};

const BREAKDOWN_KEYS = Object.keys(BREAKDOWNS);

export const loadBreakdown = async (tenantId, { level, id, breakdown, days }) => {
  if (!BREAKDOWN_KEYS.includes(breakdown)) throw httpError(400, "Unknown breakdown");
  const row = await loadObject(tenantId, level, id);
  if (!row.meta_id) return { rows: [] };
  const read = async () => {
    const { rows } = await db.query(
      `SELECT breakdown_value AS key, results::float AS results, spend::float AS spend, impressions, reach, clicks,
              purchases::float AS purchases, purchase_value::float AS purchase_value
         FROM meta_ads_insight_breakdowns
        WHERE tenant_id = $1 AND level = $2 AND object_meta_id = $3 AND breakdown = $4 AND range_days = $5
        ORDER BY spend DESC, impressions DESC`,
      [tenantId, level, row.meta_id, breakdown, days || 0],
    );
    return rows.map((item) => ({
      key: item.key,
      results: Number(item.results) || 0,
      spend: Number(item.spend) || 0,
      impressions: Number(item.impressions) || 0,
      reach: Number(item.reach) || 0,
      clicks: Number(item.clicks) || 0,
      purchases: Number(item.purchases) || 0,
      purchase_value: Number(item.purchase_value) || 0,
      roas: Number(item.spend) > 0 ? Number(item.purchase_value) / Number(item.spend) : null,
    }));
  };
  let rows = await read();
  let warning = null;
  if (!rows.length) {
    const ctx = await getAccountContext(tenantId, row.account_id);
    if (ctx.token) {
      try {
        await syncBreakdown(ctx, { level, objectMetaId: row.meta_id, breakdown, rangeDays: days || 0 });
        rows = await read();
      } catch (error) {
        // The drawer still renders (empty) — the daily chart is independent of this call.
        warning = text(error?.userMessage || error?.message) || "Breakdown sync failed";
      }
    }
  }
  return { rows, warning };
};
