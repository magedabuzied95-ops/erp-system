// Shared plumbing for every Meta Ads route: tenant scoping, ad-account context
// (with its decrypted token) and the pull-sync from Meta into our tables.
//
// Sync is "Meta wins" for live objects: rows that carry a meta_id are overwritten
// from the API; drafts (is_draft = TRUE) are never touched by a sync.

import db from "../../database/db.js";
import { getTenantId } from "../../utils/requestScope.js";
import {
  MetaAdsGraphError,
  decryptSecret,
  fromMinorUnits,
  graphGet,
  graphGetAll,
} from "./metaAdsGraph.js";
import { BREAKDOWNS, RESULT_ACTION_BY_GOAL, breakdownValueOf } from "./metaAdsCatalog.js";
import { INSIGHT_ATTRIBUTION_WINDOWS, funnelFromInsightRow } from "./metaAdsFunnel.js";
import { templateCreative } from "./metaAdsCatalogAds.js";

export const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
export const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
export const nullableNum = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const ts = (value) => (value ? new Date(value) : null);

export const httpError = (status, message, code = undefined) => Object.assign(new Error(message), { status, code });

export const tenantOf = (req) => {
  const tenantId = getTenantId(req);
  if (!tenantId) throw httpError(400, "Tenant context missing");
  return tenantId;
};

// Express wrapper: { success: true, ...data } or a safe error body. Graph errors keep
// Meta's user-facing title/message so the wizard can show exactly what Meta said.
export const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, ...(data || {}) });
  } catch (error) {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
    const body = { success: false, message: error?.message || "Request failed", code: error?.code || undefined };
    if (error instanceof MetaAdsGraphError) {
      body.meta = {
        code: error.code,
        subcode: error.subcode,
        title: error.userTitle,
        message: error.userMessage || error.message,
        fbtrace_id: error.fbtraceId,
        reconnect: error.needsReconnect,
      };
    }
    if (status >= 500) console.warn("[meta-ads] request failed", { path: req.originalUrl, status, message: body.message });
    if (!res.headersSent) res.status(status).json(body);
  }
};

const ACCOUNT_PUBLIC_COLUMNS = `id, tenant_id, ad_account_id, name, currency, timezone, status, account_status,
  business_id, business_name, page_id, page_name, instagram_user_id, instagram_username, whatsapp_phone_number,
  pixel_id, application_id, app_store_url, webhook_fields, webhook_subscribed_at, min_daily_budget,
  admins, users, meta_user_id, meta_user_name, token_expires_at, last_synced_at, last_sync_error, created_at, updated_at,
  (user_access_token_encrypted IS NOT NULL AND user_access_token_encrypted <> '') AS has_token`;

export const listAccounts = async (tenantId) => {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_PUBLIC_COLUMNS} FROM meta_ads_accounts WHERE tenant_id = $1 ORDER BY name, id`,
    [tenantId],
  );
  return rows;
};

export const getAccountPublic = async (tenantId, accountId) => {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_PUBLIC_COLUMNS} FROM meta_ads_accounts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, accountId],
  );
  if (!rows[0]) throw httpError(404, "Ad account not found");
  return rows[0];
};

// Full row + decrypted tokens. Never send the result of this to the browser.
export const getAccountContext = async (tenantId, accountId) => {
  const id = Number(accountId);
  const { rows } = await db.query(
    id
      ? `SELECT * FROM meta_ads_accounts WHERE tenant_id = $1 AND id = $2`
      : `SELECT * FROM meta_ads_accounts WHERE tenant_id = $1 ORDER BY id LIMIT 1`,
    id ? [tenantId, id] : [tenantId],
  );
  const row = rows[0];
  if (!row) throw httpError(404, "No Meta ad account is connected", "META_ADS_NO_ACCOUNT");
  const token = decryptSecret(row.user_access_token_encrypted);
  return {
    account: row,
    token,
    pageToken: decryptSecret(row.page_access_token_encrypted) || token,
    actId: row.ad_account_id,
  };
};

export const requireToken = (ctx) => {
  if (!ctx.token) throw httpError(409, "This ad account is not connected to Facebook. Reconnect it from \"ربط الحساب\".", "META_ADS_NOT_CONNECTED");
  return ctx.token;
};

// ------------------------------------------------------------------ sync: structure

const CAMPAIGN_FIELDS = "id,name,objective,status,effective_status,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,buying_type,promoted_object,start_time,stop_time,created_time,updated_time";
const ADSET_FIELDS = "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,destination_type,bid_strategy,bid_amount,promoted_object,targeting,start_time,end_time,created_time,updated_time";
const AD_FIELDS = "id,name,adset_id,campaign_id,status,effective_status,ad_review_feedback,issues_info,tracking_specs,created_time,updated_time,creative{id,name,object_type,object_story_spec,asset_feed_spec,image_hash,image_url,thumbnail_url,video_id,call_to_action_type,body,title,url_tags,instagram_user_id,effective_instagram_media_id,product_set_id}";

const upsertCampaign = async (tenantId, account, row) => {
  const currency = account.currency;
  const { rows } = await db.query(
    `INSERT INTO meta_ads_campaigns (tenant_id, account_id, meta_id, name, objective, status, effective_status, daily_budget, lifetime_budget,
       bid_strategy, special_ad_categories, buying_type, campaign_budget_optimization, start_time, stop_time, meta_created_time, meta_updated_time, raw, is_draft, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18::jsonb,FALSE,NOW())
     ON CONFLICT (tenant_id, meta_id) WHERE meta_id IS NOT NULL DO UPDATE SET
       account_id = EXCLUDED.account_id, name = EXCLUDED.name, objective = EXCLUDED.objective, status = EXCLUDED.status,
       effective_status = EXCLUDED.effective_status, daily_budget = EXCLUDED.daily_budget, lifetime_budget = EXCLUDED.lifetime_budget,
       bid_strategy = EXCLUDED.bid_strategy, special_ad_categories = EXCLUDED.special_ad_categories, buying_type = EXCLUDED.buying_type,
       campaign_budget_optimization = EXCLUDED.campaign_budget_optimization, start_time = EXCLUDED.start_time, stop_time = EXCLUDED.stop_time,
       meta_created_time = EXCLUDED.meta_created_time, meta_updated_time = EXCLUDED.meta_updated_time, raw = EXCLUDED.raw,
       is_draft = FALSE, last_error = NULL, updated_at = NOW()
     RETURNING id`,
    [
      tenantId, account.id, text(row.id), text(row.name), text(row.objective) || null, text(row.status) || "PAUSED",
      text(row.effective_status) || null, fromMinorUnits(row.daily_budget, currency), fromMinorUnits(row.lifetime_budget, currency),
      text(row.bid_strategy) || null, JSON.stringify(row.special_ad_categories || []), text(row.buying_type) || null,
      Boolean(row.daily_budget || row.lifetime_budget), ts(row.start_time), ts(row.stop_time), ts(row.created_time), ts(row.updated_time),
      JSON.stringify(row),
    ],
  );
  return rows[0].id;
};

const upsertAdset = async (tenantId, account, row, campaignIdByMeta) => {
  const currency = account.currency;
  const { rows } = await db.query(
    `INSERT INTO meta_ads_adsets (tenant_id, account_id, campaign_id, campaign_meta_id, meta_id, name, status, effective_status, daily_budget, lifetime_budget,
       optimization_goal, billing_event, destination_type, bid_strategy, bid_amount, promoted_object, targeting, start_time, end_time,
       meta_created_time, meta_updated_time, raw, is_draft, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20,$21,$22::jsonb,FALSE,NOW())
     ON CONFLICT (tenant_id, meta_id) WHERE meta_id IS NOT NULL DO UPDATE SET
       account_id = EXCLUDED.account_id, campaign_id = EXCLUDED.campaign_id, campaign_meta_id = EXCLUDED.campaign_meta_id, name = EXCLUDED.name,
       status = EXCLUDED.status, effective_status = EXCLUDED.effective_status, daily_budget = EXCLUDED.daily_budget,
       lifetime_budget = EXCLUDED.lifetime_budget, optimization_goal = EXCLUDED.optimization_goal, billing_event = EXCLUDED.billing_event,
       destination_type = EXCLUDED.destination_type, bid_strategy = EXCLUDED.bid_strategy, bid_amount = EXCLUDED.bid_amount,
       promoted_object = EXCLUDED.promoted_object, targeting = EXCLUDED.targeting, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
       meta_created_time = EXCLUDED.meta_created_time, meta_updated_time = EXCLUDED.meta_updated_time, raw = EXCLUDED.raw,
       is_draft = FALSE, last_error = NULL, updated_at = NOW()
     RETURNING id`,
    [
      tenantId, account.id, campaignIdByMeta.get(text(row.campaign_id)) || null, text(row.campaign_id) || null, text(row.id), text(row.name),
      text(row.status) || "PAUSED", text(row.effective_status) || null, fromMinorUnits(row.daily_budget, currency),
      fromMinorUnits(row.lifetime_budget, currency), text(row.optimization_goal) || null, text(row.billing_event) || null,
      text(row.destination_type) || null, text(row.bid_strategy) || null, fromMinorUnits(row.bid_amount, currency),
      JSON.stringify(row.promoted_object || {}), JSON.stringify(row.targeting || {}), ts(row.start_time), ts(row.end_time),
      ts(row.created_time), ts(row.updated_time), JSON.stringify(row),
    ],
  );
  return rows[0].id;
};

// Pulls text/media out of a creative whatever its shape (link_data, video_data,
// carousel child_attachments, or asset_feed_spec for Advantage+ creative).
export const flattenCreative = (creative = {}) => {
  const spec = creative.object_story_spec || {};
  const link = spec.link_data || {};
  const video = spec.video_data || {};
  const feed = creative.asset_feed_spec || {};
  const children = Array.isArray(link.child_attachments) ? link.child_attachments : [];
  const cta = link.call_to_action || video.call_to_action || {};
  // A catalog creative has no media of its own: its template names the product fields.
  const template = templateCreative(creative);
  let type = "single_image";
  if (template) type = template.creative_type;
  else if (children.length) type = "carousel";
  else if (video.video_id || creative.video_id) type = "video";
  return {
    creative_type: type,
    product_set_id: template?.product_set_id || null,
    page_id: text(spec.page_id) || null,
    instagram_user_id: text(spec.instagram_user_id || creative.instagram_user_id) || null,
    primary_text: template?.primary_text ?? (text(link.message || video.message || creative.body || feed.bodies?.[0]?.text) || null),
    headline: template?.headline ?? (text(link.name || video.title || creative.title || feed.titles?.[0]?.text) || null),
    description: template?.description ?? (text(link.description || video.link_description || feed.descriptions?.[0]?.text) || null),
    destination_url: template?.destination_url ?? (text(link.link || cta.value?.link || feed.link_urls?.[0]?.website_url) || null),
    display_url: text(link.caption || feed.link_urls?.[0]?.display_url) || null,
    url_tags: text(creative.url_tags) || null,
    call_to_action: template?.call_to_action ?? (text(cta.type || creative.call_to_action_type) || null),
    image_hash: text(link.image_hash || video.image_hash || creative.image_hash) || null,
    image_url: text(link.picture || video.image_url || creative.image_url || creative.thumbnail_url) || null,
    video_id: text(video.video_id || creative.video_id) || null,
    thumbnail_url: text(creative.thumbnail_url || video.image_url) || null,
    carousel_cards: children.map((child) => ({
      headline: text(child.name),
      description: text(child.description),
      link: text(child.link),
      image_hash: text(child.image_hash),
      image_url: text(child.picture),
      video_id: text(child.video_id),
    })),
  };
};

const upsertCreative = async (tenantId, account, creative) => {
  if (!creative?.id) return null;
  const flat = flattenCreative(creative);
  const { rows } = await db.query(
    `INSERT INTO meta_ads_creatives (tenant_id, account_id, meta_id, name, status, creative_type, page_id, instagram_user_id, primary_text, headline,
       description, destination_url, display_url, url_tags, call_to_action, image_hash, image_url, video_id, thumbnail_url, carousel_cards, raw, product_set_id, is_draft, updated_at)
     VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,FALSE,NOW())
     ON CONFLICT (tenant_id, meta_id) WHERE meta_id IS NOT NULL DO UPDATE SET
       name = EXCLUDED.name, creative_type = EXCLUDED.creative_type, page_id = EXCLUDED.page_id, instagram_user_id = EXCLUDED.instagram_user_id,
       primary_text = EXCLUDED.primary_text, headline = EXCLUDED.headline, description = EXCLUDED.description,
       destination_url = EXCLUDED.destination_url, display_url = EXCLUDED.display_url, url_tags = EXCLUDED.url_tags,
       call_to_action = EXCLUDED.call_to_action, image_hash = EXCLUDED.image_hash, image_url = EXCLUDED.image_url,
       video_id = EXCLUDED.video_id, thumbnail_url = EXCLUDED.thumbnail_url, carousel_cards = EXCLUDED.carousel_cards,
       raw = EXCLUDED.raw, product_set_id = EXCLUDED.product_set_id, is_draft = FALSE, updated_at = NOW()
     RETURNING id`,
    [
      tenantId, account.id, text(creative.id), text(creative.name), flat.creative_type, flat.page_id, flat.instagram_user_id,
      flat.primary_text, flat.headline, flat.description, flat.destination_url, flat.display_url, flat.url_tags, flat.call_to_action,
      flat.image_hash, flat.image_url, flat.video_id, flat.thumbnail_url, JSON.stringify(flat.carousel_cards), JSON.stringify(creative),
      flat.product_set_id,
    ],
  );
  return rows[0].id;
};

const upsertAd = async (tenantId, account, row, adsetIdByMeta) => {
  const creativeId = await upsertCreative(tenantId, account, row.creative);
  const { rows } = await db.query(
    `INSERT INTO meta_ads_ads (tenant_id, account_id, adset_id, adset_meta_id, campaign_meta_id, meta_id, name, status, effective_status,
       creative_id, creative_meta_id, tracking_specs, meta_created_time, meta_updated_time, raw, review_feedback, issues, is_draft, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,FALSE,NOW())
     ON CONFLICT (tenant_id, meta_id) WHERE meta_id IS NOT NULL DO UPDATE SET
       account_id = EXCLUDED.account_id, adset_id = EXCLUDED.adset_id, adset_meta_id = EXCLUDED.adset_meta_id,
       campaign_meta_id = EXCLUDED.campaign_meta_id, name = EXCLUDED.name, status = EXCLUDED.status,
       effective_status = EXCLUDED.effective_status, creative_id = EXCLUDED.creative_id, creative_meta_id = EXCLUDED.creative_meta_id,
       tracking_specs = EXCLUDED.tracking_specs, meta_created_time = EXCLUDED.meta_created_time,
       meta_updated_time = EXCLUDED.meta_updated_time, raw = EXCLUDED.raw, review_feedback = EXCLUDED.review_feedback,
       issues = EXCLUDED.issues, is_draft = FALSE, last_error = NULL, updated_at = NOW()
     RETURNING id`,
    [
      tenantId, account.id, adsetIdByMeta.get(text(row.adset_id)) || null, text(row.adset_id) || null, text(row.campaign_id) || null,
      text(row.id), text(row.name), text(row.status) || "PAUSED", text(row.effective_status) || null, creativeId,
      text(row.creative?.id) || null, JSON.stringify(row.tracking_specs || []), ts(row.created_time), ts(row.updated_time), JSON.stringify(row),
      // Why Meta rejected it (metaAdsReview.js reads these): null when the ad is clean.
      row.ad_review_feedback ? JSON.stringify(row.ad_review_feedback) : null, JSON.stringify(row.issues_info || []),
    ],
  );
  return rows[0].id;
};

const metaIdMap = async (table, tenantId, accountId) => {
  const { rows } = await db.query(`SELECT id, meta_id FROM ${table} WHERE tenant_id = $1 AND account_id = $2 AND meta_id IS NOT NULL`, [tenantId, accountId]);
  return new Map(rows.map((row) => [row.meta_id, row.id]));
};

export const syncStructure = async (ctx, { only = null } = {}) => {
  const token = requireToken(ctx);
  const { account } = ctx;
  const tenantId = account.tenant_id;
  const counts = { campaigns: 0, adsets: 0, ads: 0 };
  const filtering = [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO", "ARCHIVED"] }];

  if (!only || only === "campaigns") {
    const campaigns = await graphGetAll(`/${ctx.actId}/campaigns`, token, { fields: CAMPAIGN_FIELDS, filtering });
    for (const row of campaigns) {
      await upsertCampaign(tenantId, account, row);
      counts.campaigns += 1;
    }
  }
  if (!only || only === "adsets") {
    const campaignIdByMeta = await metaIdMap("meta_ads_campaigns", tenantId, account.id);
    const adsets = await graphGetAll(`/${ctx.actId}/adsets`, token, { fields: ADSET_FIELDS, filtering });
    for (const row of adsets) {
      await upsertAdset(tenantId, account, row, campaignIdByMeta);
      counts.adsets += 1;
    }
  }
  if (!only || only === "ads") {
    const adsetIdByMeta = await metaIdMap("meta_ads_adsets", tenantId, account.id);
    const ads = await graphGetAll(`/${ctx.actId}/ads`, token, { fields: AD_FIELDS, filtering });
    for (const row of ads) {
      await upsertAd(tenantId, account, row, adsetIdByMeta);
      counts.ads += 1;
    }
  }
  return counts;
};

// ------------------------------------------------------------------ sync: insights

const resultFromActions = (actions = [], goal = "") => {
  const list = Array.isArray(actions) ? actions : [];
  const wanted = RESULT_ACTION_BY_GOAL[goal];
  const pick = (type) => list.find((action) => action.action_type === type);
  const hit = (wanted && pick(wanted))
    || pick("onsite_conversion.messaging_conversation_started_7d")
    || pick("lead")
    || pick("offsite_conversion.fb_pixel_purchase")
    || pick("link_click");
  return hit ? { value: num(hit.value), type: hit.action_type } : { value: 0, type: null };
};

const goalByObject = async (tenantId, accountId) => {
  const map = new Map();
  const { rows } = await db.query(
    `SELECT s.meta_id AS adset_meta_id, s.optimization_goal, s.campaign_meta_id, a.meta_id AS ad_meta_id
       FROM meta_ads_adsets s LEFT JOIN meta_ads_ads a ON a.adset_id = s.id
      WHERE s.tenant_id = $1 AND s.account_id = $2 AND s.meta_id IS NOT NULL`,
    [tenantId, accountId],
  );
  for (const row of rows) {
    if (row.adset_meta_id) map.set(row.adset_meta_id, row.optimization_goal);
    if (row.ad_meta_id) map.set(row.ad_meta_id, row.optimization_goal);
    if (row.campaign_meta_id && !map.has(row.campaign_meta_id)) map.set(row.campaign_meta_id, row.optimization_goal);
  }
  return map;
};

const INSIGHT_FIELDS = "campaign_id,adset_id,ad_id,impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,actions,action_values,date_start,date_stop";

export const syncInsights = async (ctx, { days = 30, levels = ["campaign", "adset", "ad"] } = {}) => {
  const token = requireToken(ctx);
  const { account } = ctx;
  const tenantId = account.tenant_id;
  const goals = await goalByObject(tenantId, account.id);
  // days = 0 → the account's whole history (Meta serves up to 37 months), one row per day, so
  // a day the hourly job never covered is filled in rather than left as a hole in the chart.
  const window = days > 0
    ? (() => {
      const until = new Date();
      const since = new Date(until.getTime() - days * 86400000);
      return { time_range: { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) } };
    })()
    : { date_preset: "maximum" };
  let written = 0;
  for (const level of levels) {
    const rows = await graphGetAll(`/${ctx.actId}/insights`, token, {
      level,
      fields: INSIGHT_FIELDS,
      ...window,
      time_increment: 1,
      action_attribution_windows: INSIGHT_ATTRIBUTION_WINDOWS,
    }, { limit: 20000 });
    for (const row of rows) {
      const objectId = text(row[`${level}_id`]);
      if (!objectId) continue;
      const result = resultFromActions(row.actions, goals.get(objectId));
      const funnel = funnelFromInsightRow(row);
      await db.query(
        `INSERT INTO meta_ads_insights (tenant_id, account_id, level, object_meta_id, date_start, date_stop, impressions, reach, clicks, spend,
           ctr, cpc, cpm, frequency, results, result_type, actions, action_values,
           purchases, purchase_value, purchases_7d_click, purchase_value_7d_click, landing_page_views, add_to_cart, initiate_checkout, link_clicks, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23,$24,$25,$26,NOW())
         ON CONFLICT (tenant_id, level, object_meta_id, date_start, date_stop) DO UPDATE SET
           impressions = EXCLUDED.impressions, reach = EXCLUDED.reach, clicks = EXCLUDED.clicks, spend = EXCLUDED.spend,
           ctr = EXCLUDED.ctr, cpc = EXCLUDED.cpc, cpm = EXCLUDED.cpm, frequency = EXCLUDED.frequency, results = EXCLUDED.results,
           result_type = EXCLUDED.result_type, actions = EXCLUDED.actions, action_values = EXCLUDED.action_values,
           purchases = EXCLUDED.purchases, purchase_value = EXCLUDED.purchase_value,
           purchases_7d_click = EXCLUDED.purchases_7d_click, purchase_value_7d_click = EXCLUDED.purchase_value_7d_click,
           landing_page_views = EXCLUDED.landing_page_views, add_to_cart = EXCLUDED.add_to_cart,
           initiate_checkout = EXCLUDED.initiate_checkout, link_clicks = EXCLUDED.link_clicks, synced_at = NOW()`,
        [
          tenantId, account.id, level, objectId, row.date_start, row.date_stop, num(row.impressions), num(row.reach), num(row.clicks),
          num(row.spend), num(row.ctr), num(row.cpc), num(row.cpm), num(row.frequency), result.value, result.type, JSON.stringify(row.actions || []),
          JSON.stringify(row.action_values || []),
          funnel.purchases, funnel.purchase_value, funnel.purchases_7d_click, funnel.purchase_value_7d_click,
          funnel.landing_page_views, funnel.add_to_cart, funnel.initiate_checkout, funnel.link_clicks,
        ],
      );
      written += 1;
    }
  }
  return { insights: written };
};

// Breakdown for one object (charts drawer). range_days 0 = lifetime.
export const syncBreakdown = async (ctx, { level, objectMetaId, breakdown, rangeDays = 30 }) => {
  const token = requireToken(ctx);
  const apiFields = BREAKDOWNS[breakdown];
  if (!apiFields) throw httpError(400, "Unknown breakdown");
  const params = { fields: "impressions,reach,clicks,spend,actions,action_values", breakdowns: apiFields.join(",") };
  if (rangeDays > 0) {
    const until = new Date();
    const since = new Date(until.getTime() - rangeDays * 86400000);
    params.time_range = { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
  } else {
    params.date_preset = "maximum";
  }
  const rows = await graphGetAll(`/${objectMetaId}/insights`, token, params);
  const tenantId = ctx.account.tenant_id;
  await db.query(
    `DELETE FROM meta_ads_insight_breakdowns WHERE tenant_id = $1 AND level = $2 AND object_meta_id = $3 AND breakdown = $4 AND range_days = $5`,
    [tenantId, level, objectMetaId, breakdown, rangeDays],
  );
  for (const row of rows) {
    const value = breakdownValueOf(row, breakdown);
    const result = resultFromActions(row.actions);
    const funnel = funnelFromInsightRow(row);
    await db.query(
      `INSERT INTO meta_ads_insight_breakdowns (tenant_id, account_id, level, object_meta_id, breakdown, breakdown_value, range_days, impressions, reach, clicks, spend, results, purchases, purchase_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (tenant_id, level, object_meta_id, breakdown, breakdown_value, range_days) DO UPDATE SET
         impressions = EXCLUDED.impressions, reach = EXCLUDED.reach, clicks = EXCLUDED.clicks, spend = EXCLUDED.spend, results = EXCLUDED.results,
         purchases = EXCLUDED.purchases, purchase_value = EXCLUDED.purchase_value, synced_at = NOW()`,
      [tenantId, ctx.account.id, level, objectMetaId, breakdown, value, rangeDays, num(row.impressions), num(row.reach), num(row.clicks), num(row.spend), result.value, funnel.purchases, funnel.purchase_value],
    );
  }
  return rows.length;
};

// ------------------------------------------------------------------ sync: account info / audiences / lead forms / page insights

export const syncAccountInfo = async (ctx) => {
  const token = requireToken(ctx);
  const info = await graphGet(`/${ctx.actId}`, token, {
    fields: "name,currency,timezone_name,account_status,business{id,name},min_daily_budget",
  });
  let pixelId = ctx.account.pixel_id;
  if (!pixelId) {
    try {
      const pixels = await graphGet(`/${ctx.actId}/adspixels`, token, { fields: "id,name", limit: 5 });
      pixelId = text(pixels?.data?.[0]?.id) || null;
    } catch {
      pixelId = ctx.account.pixel_id;
    }
  }
  let admins = ctx.account.admins || [];
  let users = ctx.account.users || [];
  try {
    const assigned = await graphGet(`/${ctx.actId}/assigned_users`, token, { fields: "id,name,tasks", business: info?.business?.id || undefined });
    const list = (assigned?.data || []).map((user) => ({ id: text(user.id), name: text(user.name), tasks: user.tasks || [] }));
    admins = list.filter((user) => (user.tasks || []).includes("MANAGE"));
    users = list.filter((user) => !(user.tasks || []).includes("MANAGE"));
  } catch {
    // assigned_users needs business_management on a Business-owned account; keep what we had.
  }
  await db.query(
    `UPDATE meta_ads_accounts SET name = COALESCE(NULLIF($3,''), name), currency = COALESCE(NULLIF($4,''), currency),
       timezone = COALESCE(NULLIF($5,''), timezone), account_status = $6,
       status = CASE WHEN $6 = 1 THEN 'active' WHEN $6 = 2 THEN 'disabled' WHEN $6 = 3 THEN 'unsettled' ELSE status END,
       business_id = COALESCE(NULLIF($7,''), business_id), business_name = COALESCE(NULLIF($8,''), business_name),
       pixel_id = COALESCE(NULLIF($9,''), pixel_id), min_daily_budget = $10::jsonb, admins = $11::jsonb, users = $12::jsonb,
       raw = $13::jsonb, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2`,
    [
      ctx.account.tenant_id, ctx.account.id, text(info.name), text(info.currency), text(info.timezone_name), nullableNum(info.account_status),
      text(info.business?.id), text(info.business?.name), text(pixelId), JSON.stringify({ min: info.min_daily_budget ?? null }),
      JSON.stringify(admins), JSON.stringify(users), JSON.stringify(info),
    ],
  );
  return { account: text(info.name) };
};

export const syncAudiences = async (ctx) => {
  const token = requireToken(ctx);
  const rows = await graphGetAll(`/${ctx.actId}/customaudiences`, token, {
    fields: "id,name,subtype,description,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status",
  });
  for (const row of rows) {
    await db.query(
      `INSERT INTO meta_ads_audiences (tenant_id, account_id, meta_id, name, subtype, description, approximate_count_lower, approximate_count_upper, status, raw, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
       ON CONFLICT (tenant_id, meta_id) DO UPDATE SET name = EXCLUDED.name, subtype = EXCLUDED.subtype, description = EXCLUDED.description,
         approximate_count_lower = EXCLUDED.approximate_count_lower, approximate_count_upper = EXCLUDED.approximate_count_upper,
         status = EXCLUDED.status, raw = EXCLUDED.raw, last_synced_at = NOW()`,
      [
        ctx.account.tenant_id, ctx.account.id, text(row.id), text(row.name), text(row.subtype) || null, text(row.description) || null,
        nullableNum(row.approximate_count_lower_bound), nullableNum(row.approximate_count_upper_bound),
        text(row.delivery_status?.description || row.operation_status?.description) || null, JSON.stringify(row),
      ],
    );
  }
  return { audiences: rows.length };
};

export const syncLeadForms = async (ctx) => {
  if (!ctx.account.page_id) return { lead_forms: 0 };
  const rows = await graphGetAll(`/${ctx.account.page_id}/leadgen_forms`, ctx.pageToken, {
    fields: "id,name,status,locale,leads_count,questions,privacy_policy_url,created_time",
  });
  for (const row of rows) {
    await db.query(
      `INSERT INTO meta_ads_lead_forms (tenant_id, account_id, page_id, meta_id, name, status, locale, leads_count, questions, privacy_policy_url, raw, last_synced_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,NOW(),NOW())
       ON CONFLICT (tenant_id, meta_id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, locale = EXCLUDED.locale,
         leads_count = EXCLUDED.leads_count, questions = EXCLUDED.questions, privacy_policy_url = EXCLUDED.privacy_policy_url,
         raw = EXCLUDED.raw, last_synced_at = NOW(), updated_at = NOW()`,
      [
        ctx.account.tenant_id, ctx.account.id, ctx.account.page_id, text(row.id), text(row.name), text(row.status) || "ACTIVE",
        text(row.locale) || null, num(row.leads_count), JSON.stringify(row.questions || []), text(row.privacy_policy_url?.url || row.privacy_policy_url) || null,
        JSON.stringify(row),
      ],
    );
  }
  return { lead_forms: rows.length };
};

// Product sets of every catalog the business owns, for the wizard's catalog-ad pickers. An
// account outside a Business (or a token without catalog_management) simply has none.
export const syncProductSets = async (ctx) => {
  const token = requireToken(ctx);
  const businessId = text(ctx.account.business_id);
  if (!businessId) return { product_sets: 0 };
  const catalogs = await graphGetAll(`/${businessId}/owned_product_catalogs`, token, { fields: "id,name" });
  const seen = [];
  for (const catalog of catalogs) {
    const sets = await graphGetAll(`/${catalog.id}/product_sets`, token, { fields: "id,name,product_count" });
    for (const set of sets) {
      await db.query(
        `INSERT INTO meta_ads_product_sets (tenant_id, account_id, catalog_id, catalog_name, meta_id, name, product_count, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (tenant_id, account_id, meta_id) DO UPDATE SET catalog_id = EXCLUDED.catalog_id, catalog_name = EXCLUDED.catalog_name,
           name = EXCLUDED.name, product_count = EXCLUDED.product_count, last_synced_at = NOW()`,
        [ctx.account.tenant_id, ctx.account.id, text(catalog.id), text(catalog.name), text(set.id), text(set.name), num(set.product_count)],
      );
      seen.push(text(set.id));
    }
  }
  // A set deleted on Meta leaves the picker.
  await db.query(
    `DELETE FROM meta_ads_product_sets WHERE tenant_id = $1 AND account_id = $2 AND NOT (meta_id = ANY($3::text[]))`,
    [ctx.account.tenant_id, ctx.account.id, seen],
  );
  return { product_sets: seen.length };
};

const PAGE_METRICS = ["page_impressions", "page_impressions_unique", "page_post_engagements", "page_fans", "page_views_total", "page_fan_adds"];

export const syncPageInsights = async (ctx, { days = 28 } = {}) => {
  if (!ctx.account.page_id) return { page_insights: 0 };
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  let written = 0;
  for (const metric of PAGE_METRICS) {
    let payload;
    try {
      payload = await graphGet(`/${ctx.account.page_id}/insights`, ctx.pageToken, { metric, period: "day", since, until });
    } catch (error) {
      // Meta retires page metrics from time to time; one missing metric must not stop the rest.
      if (error instanceof MetaAdsGraphError && error.code === 100) continue;
      throw error;
    }
    for (const series of payload?.data || []) {
      for (const point of series.values || []) {
        const endDate = text(point.end_time).slice(0, 10);
        if (!endDate) continue;
        await db.query(
          `INSERT INTO meta_ads_page_insights (tenant_id, account_id, page_id, page_name, metric, period, value, date_start, date_stop, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date - 1,$8::date,NOW())
           ON CONFLICT (tenant_id, page_id, metric, period, date_stop) DO UPDATE SET value = EXCLUDED.value, page_name = EXCLUDED.page_name, synced_at = NOW()`,
          [ctx.account.tenant_id, ctx.account.id, ctx.account.page_id, ctx.account.page_name, series.name, series.period, num(point.value), endDate],
        );
        written += 1;
      }
    }
  }
  return { page_insights: written };
};

// "مزامنة" in the Ads Manager: structure + 30 days of insights + account info.
export const syncAll = async (ctx, { days = 30 } = {}) => {
  const tenantId = ctx.account.tenant_id;
  try {
    const info = await syncAccountInfo(ctx);
    const structure = await syncStructure(ctx);
    const insights = await syncInsights(ctx, { days });
    await db.query(`UPDATE meta_ads_accounts SET last_synced_at = NOW(), last_sync_error = NULL WHERE tenant_id = $1 AND id = $2`, [tenantId, ctx.account.id]);
    return { ...info, ...structure, ...insights };
  } catch (error) {
    await db.query(`UPDATE meta_ads_accounts SET last_sync_error = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, ctx.account.id, text(error?.message).slice(0, 500)]);
    throw error;
  }
};
