// Read side of the TikTok Ads screen: the three level lists with insight totals for a
// date window. Tenant-scoped; nothing here selects the token column.

import db from "../../database/db.js";
import { httpError, listAccounts, localDate, num, text } from "./tiktokAdsCore.js";

export const LEVELS = ["campaign", "adgroup", "ad"];
const LEVEL_TABLE = { campaign: "tiktok_ads_campaigns", adgroup: "tiktok_ads_adgroups", ad: "tiktok_ads_ads" };
const LEVEL_ID = { campaign: "campaign_id", adgroup: "adgroup_id", ad: "ad_id" };

export const parseLevel = (value) => {
  const level = text(value) || "campaign";
  if (!LEVELS.includes(level)) throw httpError(400, "Unknown level");
  return level;
};

// Anything not in the list → 0 = no date filter (lifetime of what was synced).
export const parseDays = (value) => {
  const days = Number(value);
  return [1, 7, 14, 30, 90].includes(days) ? days : 0;
};

// Ratios are computed from the window's sums, never averaged per day.
export const withRatios = (row) => {
  const spend = num(row.spend);
  const impressions = num(row.impressions);
  const clicks = num(row.clicks);
  const purchases = num(row.purchases);
  const value = num(row.purchase_value);
  return {
    ...row,
    spend,
    impressions,
    clicks,
    conversions: num(row.conversions),
    purchases,
    purchase_value: value,
    add_to_cart: num(row.add_to_cart),
    initiate_checkout: num(row.initiate_checkout),
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    roas: spend > 0 ? value / spend : null,
    cost_per_purchase: purchases > 0 ? spend / purchases : null,
  };
};

const SUMS = `COALESCE(SUM(i.spend),0) AS spend, COALESCE(SUM(i.impressions),0) AS impressions,
  COALESCE(SUM(i.clicks),0) AS clicks, COALESCE(SUM(i.conversions),0) AS conversions,
  COALESCE(SUM(i.purchases),0) AS purchases, COALESCE(SUM(i.purchase_value),0) AS purchase_value,
  COALESCE(SUM(i.add_to_cart),0) AS add_to_cart, COALESCE(SUM(i.initiate_checkout),0) AS initiate_checkout`;

export const loadBootstrap = async (tenantId) => ({ accounts: await listAccounts(tenantId) });

export const loadListData = async (tenantId, query = {}) => {
  const accountId = Number(query.account_id);
  if (!Number.isInteger(accountId) || accountId <= 0) throw httpError(400, "account_id is required");
  const { rows: accountRows } = await db.query(`SELECT id, timezone FROM tiktok_ads_accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
  const account = accountRows[0];
  if (!account) throw httpError(404, "TikTok ad account not found", "TIKTOK_ADS_NO_ACCOUNT");

  const level = parseLevel(query.level);
  const days = parseDays(query.days);
  const table = LEVEL_TABLE[level];
  const idKey = LEVEL_ID[level];

  // $1 tenant, $2 account, $3 level, $4 window start (or NULL)
  const windowStart = days > 0 ? (() => {
    const date = new Date(`${localDate(account.timezone)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (days - 1));
    return date.toISOString().slice(0, 10);
  })() : null;
  const params = [tenantId, accountId, level, windowStart];
  const where = ["o.tenant_id = $1", "o.account_id = $2"];
  const campaignId = text(query.campaign_id);
  const adgroupId = text(query.adgroup_id);
  if (campaignId && level !== "campaign") {
    params.push(campaignId);
    where.push(`o.campaign_id = $${params.length}`);
  }
  if (adgroupId && level === "ad") {
    params.push(adgroupId);
    where.push(`o.adgroup_id = $${params.length}`);
  }
  const q = text(query.q);
  if (q) {
    params.push(`%${q}%`, q);
    where.push(`(o.name ILIKE $${params.length - 1} OR o.${idKey} = $${params.length})`);
  }

  const { rows } = await db.query(
    `WITH ins AS (
       SELECT i.object_id, ${SUMS}
         FROM tiktok_ads_insights i
        WHERE i.tenant_id = $1 AND i.account_id = $2 AND i.level = $3
          AND ($4::date IS NULL OR i.stat_date >= $4::date)
        GROUP BY i.object_id
     )
     SELECT o.*, ${idKey} AS object_id,
            COALESCE(ins.spend,0) AS spend, COALESCE(ins.impressions,0) AS impressions, COALESCE(ins.clicks,0) AS clicks,
            COALESCE(ins.conversions,0) AS conversions, COALESCE(ins.purchases,0) AS purchases,
            COALESCE(ins.purchase_value,0) AS purchase_value, COALESCE(ins.add_to_cart,0) AS add_to_cart,
            COALESCE(ins.initiate_checkout,0) AS initiate_checkout
       FROM ${table} o
       LEFT JOIN ins ON ins.object_id = o.${idKey}
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(ins.spend,0) DESC, o.tiktok_created_at DESC NULLS LAST, o.id DESC
      LIMIT 1000`,
    params,
  );

  const list = rows.map(({ raw, ...row }) => withRatios(row));
  const totals = withRatios(
    list.reduce((sum, row) => {
      for (const key of ["spend", "impressions", "clicks", "conversions", "purchases", "purchase_value", "add_to_cart", "initiate_checkout"]) sum[key] += row[key];
      return sum;
    }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, purchases: 0, purchase_value: 0, add_to_cart: 0, initiate_checkout: 0 }),
  );

  const { rows: countRows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM tiktok_ads_campaigns WHERE account_id = $1)::int AS campaign,
            (SELECT COUNT(*) FROM tiktok_ads_adgroups WHERE account_id = $1)::int AS adgroup,
            (SELECT COUNT(*) FROM tiktok_ads_ads WHERE account_id = $1)::int AS ad`,
    [accountId],
  );
  return { level, days, window_start: windowStart, rows: list, totals, counts: countRows[0] };
};
