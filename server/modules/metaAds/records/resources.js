// Server-side registry for the Meta Ads record pages (/api/meta-ads/records/:resource).
//
// One entry per resource key (the same keys the frontend uses in /meta-ads/r/:resource):
//   table      the meta_ads_* table, always aliased `t`
//   joins      LEFT JOINs that bring display names (account / campaign / ad set / …)
//   display    extra SELECT expressions returned with the record (name → SQL)
//   columns    what the list may return / filter / sort on: key → { sql, type }
//              type: text | enum | bool | number | date | datetime | id
//   search     expressions the toolbar search (q) runs ILIKE over
//   order      default ordering (newest first) — must end with a unique tiebreaker
//   relations  relation filters used by smart buttons: param → { sql, type }
//   editable   fields PUT may change: key → field spec (see F below)
//   secrets    form key → encrypted column. Never returned; the record carries
//              <key>_masked + has_<key> instead. A new value is encrypted on write.
//   create     false, or { prepare(tenantId, body) → extra columns } for POST
//   remove     false | true | "drafts"
//   duplicate  false, or { overrides(suffix) → { column: sqlExpression } }
//   counts     async (tenantId, record) → { key: number } for the smart buttons
//   actions    action keys accepted by POST /:id/actions/:action (recordsActions.js)
//   aiObject   object_type for meta_ads_ai_instructions (campaign | adset | ad)
//   catalog    rows come from metaAdsCatalog() instead of a table (read-only)

import db from "../../../database/db.js";
import { BILLING_EVENTS, OPTIMIZATION_GOALS } from "../metaAdsCatalog.js";
import { httpError, text } from "../metaAdsCore.js";
import { normalizeAdAccountId } from "../metaAdsGraph.js";

// ------------------------------------------------------------------ field specs

// kind: text | number | bool | ts | date | id | enum | json
// notNull: an empty value becomes '' instead of NULL (NOT NULL text columns)
// draftOnly: may only change while the row is still a draft (is_draft = TRUE)
// ref: an id that must belong to the same tenant in that table
const F = {
  text: { kind: "text" },
  name: { kind: "text", notNull: true },
  number: { kind: "number" },
  bool: { kind: "bool" },
  ts: { kind: "ts" },
  id: { kind: "id" },
  enum: { kind: "enum" },
};
const ref = (table, extra = {}) => ({ kind: "id", ref: table, ...extra });

const count = async (sql, params) => {
  const { rows } = await db.query(sql, params);
  return Number(rows[0]?.n || 0);
};

const ACCOUNT_JOIN = "LEFT JOIN meta_ads_accounts a ON a.id = t.account_id AND a.tenant_id = t.tenant_id";
const ACCOUNT_DISPLAY = { account_name: "a.name", account_currency: "a.currency" };

const OBJECT_DRAFT_OVERRIDES = (suffix) => ({
  meta_id: "NULL",
  is_draft: "TRUE",
  status: "'PAUSED'",
  effective_status: "NULL",
  raw: "NULL",
  last_error: "NULL",
  meta_created_time: "NULL",
  meta_updated_time: "NULL",
  name: `t.name || ${literal(suffix)}`,
});

function literal(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

// CRM Leads = ad clicks attributed to the object + lead-form leads that carry its Meta id.
const crmLeads = async (tenantId, clickColumn, id, leadColumn, metaId) => {
  const clicks = await count(`SELECT COUNT(*) AS n FROM meta_ads_ad_clicks WHERE tenant_id = $1 AND ${clickColumn} = $2`, [tenantId, id]);
  const leads = metaId
    ? await count(`SELECT COUNT(*) AS n FROM meta_ads_leads WHERE tenant_id = $1 AND ${leadColumn} = $2`, [tenantId, metaId])
    : 0;
  return clicks + leads;
};

const insightsCount = (tenantId, level, metaId) =>
  metaId
    ? count(`SELECT COUNT(*) AS n FROM meta_ads_insights WHERE tenant_id = $1 AND level = $2 AND object_meta_id = $3`, [tenantId, level, metaId])
    : Promise.resolve(0);

const firstAccountId = async (tenantId) => {
  const { rows } = await db.query(`SELECT id FROM meta_ads_accounts WHERE tenant_id = $1 ORDER BY id LIMIT 1`, [tenantId]);
  return rows[0]?.id || null;
};

const ownedAccountId = async (tenantId, value) => {
  const id = Number(value) || (await firstAccountId(tenantId));
  if (!id) throw httpError(409, "No Meta ad account is connected", "META_ADS_NO_ACCOUNT");
  const { rows } = await db.query(`SELECT id FROM meta_ads_accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows[0]) throw httpError(400, "Unknown ad account", "META_ADS_BAD_ACCOUNT");
  return rows[0].id;
};

// ------------------------------------------------------------------ registry

export const RESOURCES = {
  "ad-accounts": {
    table: "meta_ads_accounts",
    joins: "",
    display: {},
    columns: {
      name: { sql: "t.name", type: "text" },
      ad_account_id: { sql: "t.ad_account_id", type: "text" },
      currency: { sql: "t.currency", type: "text" },
      status: { sql: "t.status", type: "enum" },
      timezone: { sql: "t.timezone", type: "text" },
    },
    search: ["t.name", "t.ad_account_id", "t.business_name", "t.page_name"],
    order: "t.id DESC",
    relations: {},
    editable: {
      name: F.name,
      app_id: F.text,
      business_id: F.text,
      webhook_verify_token: F.text,
      pixel_id: F.text,
      application_id: F.text,
      app_store_url: F.text,
      page_id: F.text,
      page_name: F.text,
      instagram_username: F.text,
      instagram_user_id: F.text,
    },
    secrets: { user_access_token: "user_access_token_encrypted", app_secret: "app_secret_encrypted" },
    create: {
      prepare: async (tenantId, body) => {
        const adAccountId = normalizeAdAccountId(body.ad_account_id);
        if (!adAccountId) throw httpError(400, "Ad account id is required", "META_ADS_FIELD_REQUIRED");
        return { ad_account_id: adAccountId };
      },
    },
    remove: false,
    duplicate: false,
    counts: async (tenantId, row) => ({
      insights: await count(`SELECT COUNT(*) AS n FROM meta_ads_insights WHERE tenant_id = $1 AND account_id = $2`, [tenantId, row.id]),
      campaigns: await count(`SELECT COUNT(*) AS n FROM meta_ads_campaigns WHERE tenant_id = $1 AND account_id = $2`, [tenantId, row.id]),
      lead_forms: await count(`SELECT COUNT(*) AS n FROM meta_ads_lead_forms WHERE tenant_id = $1 AND account_id = $2`, [tenantId, row.id]),
      audiences: await count(`SELECT COUNT(*) AS n FROM meta_ads_audiences WHERE tenant_id = $1 AND account_id = $2`, [tenantId, row.id]),
    }),
    actions: ["sync_campaigns", "sync_insights", "sync_page_insights", "subscribe_webhook", "subscribe_ads_webhooks", "sync_info"],
  },

  campaigns: {
    table: "meta_ads_campaigns",
    joins: ACCOUNT_JOIN,
    display: ACCOUNT_DISPLAY,
    columns: {
      name: { sql: "t.name", type: "text" },
      objective: { sql: "t.objective", type: "enum" },
      status: { sql: "t.status", type: "enum" },
      effective_status: { sql: "t.effective_status", type: "enum" },
      daily_budget: { sql: "t.daily_budget", type: "number" },
      account_name: { sql: "a.name", type: "text" },
    },
    extra: ["t.is_draft", "t.meta_id", "t.account_id", "a.currency AS account_currency"],
    search: ["t.name", "t.meta_id"],
    order: "t.id DESC",
    relations: { account_id: { sql: "t.account_id", type: "id" } },
    editable: {
      name: F.name,
      objective: F.enum,
      chat_team_id: F.id,
      daily_budget: F.number,
      lifetime_budget: F.number,
      bid_strategy: F.enum,
      start_time: F.ts,
      stop_time: F.ts,
    },
    create: {
      prepare: async (tenantId, body) => ({ account_id: await ownedAccountId(tenantId, body.account_id), is_draft: true, status: "PAUSED" }),
    },
    remove: "drafts",
    duplicate: { overrides: OBJECT_DRAFT_OVERRIDES },
    counts: async (tenantId, row) => ({
      insights: await insightsCount(tenantId, "campaign", row.meta_id),
      adsets: await count(`SELECT COUNT(*) AS n FROM meta_ads_adsets WHERE tenant_id = $1 AND campaign_id = $2`, [tenantId, row.id]),
      crm_leads: await crmLeads(tenantId, "campaign_id", row.id, "campaign_meta_id", row.meta_id),
    }),
    actions: ["push_to_meta", "update_on_meta", "delete_on_meta", "create_adset", "sync_adsets", "pause", "activate"],
    aiObject: "campaign",
    level: "campaign",
  },

  adsets: {
    table: "meta_ads_adsets",
    joins: `${ACCOUNT_JOIN} LEFT JOIN meta_ads_campaigns c ON c.id = t.campaign_id AND c.tenant_id = t.tenant_id`,
    display: { ...ACCOUNT_DISPLAY, campaign_name: "c.name" },
    columns: {
      name: { sql: "t.name", type: "text" },
      status: { sql: "t.status", type: "enum" },
      effective_status: { sql: "t.effective_status", type: "enum" },
      daily_budget: { sql: "t.daily_budget", type: "number" },
      optimization_goal: { sql: "t.optimization_goal", type: "enum" },
      campaign_name: { sql: "c.name", type: "text" },
    },
    extra: ["t.is_draft", "t.meta_id", "t.campaign_id", "a.currency AS account_currency"],
    search: ["t.name", "t.meta_id"],
    order: "t.id DESC",
    relations: {
      account_id: { sql: "t.account_id", type: "id" },
      campaign_id: { sql: "t.campaign_id", type: "id" },
    },
    editable: {
      name: F.name,
      campaign_id: ref("meta_ads_campaigns", { draftOnly: true }),
      chat_team_id: F.id,
      optimization_goal: F.enum,
      billing_event: F.enum,
      bid_strategy: F.enum,
      daily_budget: F.number,
      lifetime_budget: F.number,
      start_time: F.ts,
      end_time: F.ts,
    },
    create: {
      prepare: async (tenantId, body) => {
        const { rows } = await db.query(`SELECT id, account_id, meta_id FROM meta_ads_campaigns WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(body.campaign_id) || 0]);
        if (!rows[0]) throw httpError(400, "Choose the campaign first", "META_ADS_FIELD_REQUIRED");
        return { account_id: rows[0].account_id, campaign_id: rows[0].id, campaign_meta_id: rows[0].meta_id, is_draft: true, status: "PAUSED" };
      },
    },
    afterWrite: async (tenantId, id) => {
      await db.query(
        `UPDATE meta_ads_adsets s SET campaign_meta_id = c.meta_id, account_id = c.account_id
           FROM meta_ads_campaigns c WHERE s.tenant_id = $1 AND s.id = $2 AND c.id = s.campaign_id AND c.tenant_id = s.tenant_id`,
        [tenantId, id],
      );
    },
    remove: "drafts",
    duplicate: { overrides: OBJECT_DRAFT_OVERRIDES },
    counts: async (tenantId, row) => ({
      insights: await insightsCount(tenantId, "adset", row.meta_id),
      ads: await count(`SELECT COUNT(*) AS n FROM meta_ads_ads WHERE tenant_id = $1 AND adset_id = $2`, [tenantId, row.id]),
      crm_leads: await crmLeads(tenantId, "adset_id", row.id, "adset_meta_id", row.meta_id),
    }),
    actions: ["push_to_meta", "update_on_meta", "create_ad", "create_creative", "sync_ads", "pause", "activate"],
    aiObject: "adset",
    level: "adset",
  },

  ads: {
    table: "meta_ads_ads",
    joins: `${ACCOUNT_JOIN} LEFT JOIN meta_ads_adsets s ON s.id = t.adset_id AND s.tenant_id = t.tenant_id
            LEFT JOIN meta_ads_creatives cr ON cr.id = t.creative_id AND cr.tenant_id = t.tenant_id`,
    display: { ...ACCOUNT_DISPLAY, adset_name: "s.name", creative_name: "cr.name" },
    columns: {
      name: { sql: "t.name", type: "text" },
      status: { sql: "t.status", type: "enum" },
      effective_status: { sql: "t.effective_status", type: "enum" },
      adset_name: { sql: "s.name", type: "text" },
      creative_meta_id: { sql: "t.creative_meta_id", type: "text" },
    },
    extra: ["t.is_draft", "t.meta_id", "t.adset_id", "t.creative_id"],
    search: ["t.name", "t.meta_id"],
    order: "t.id DESC",
    relations: {
      account_id: { sql: "t.account_id", type: "id" },
      adset_id: { sql: "t.adset_id", type: "id" },
      creative_id: { sql: "t.creative_id", type: "id" },
    },
    editable: {
      name: F.name,
      adset_id: ref("meta_ads_adsets", { draftOnly: true }),
      chat_team_id: F.id,
      creative_id: ref("meta_ads_creatives"),
    },
    create: {
      prepare: async (tenantId, body) => {
        const { rows } = await db.query(`SELECT id, account_id, meta_id, campaign_meta_id FROM meta_ads_adsets WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(body.adset_id) || 0]);
        if (!rows[0]) throw httpError(400, "Choose the ad set first", "META_ADS_FIELD_REQUIRED");
        return { account_id: rows[0].account_id, adset_id: rows[0].id, adset_meta_id: rows[0].meta_id, campaign_meta_id: rows[0].campaign_meta_id, is_draft: true, status: "PAUSED" };
      },
    },
    afterWrite: async (tenantId, id) => {
      await db.query(
        `UPDATE meta_ads_ads x SET adset_meta_id = s.meta_id, campaign_meta_id = s.campaign_meta_id, account_id = s.account_id
           FROM meta_ads_adsets s WHERE x.tenant_id = $1 AND x.id = $2 AND s.id = x.adset_id AND s.tenant_id = x.tenant_id`,
        [tenantId, id],
      );
      await db.query(
        `UPDATE meta_ads_ads x SET creative_meta_id = cr.meta_id
           FROM meta_ads_creatives cr WHERE x.tenant_id = $1 AND x.id = $2 AND cr.id = x.creative_id AND cr.tenant_id = x.tenant_id`,
        [tenantId, id],
      );
    },
    remove: "drafts",
    duplicate: { overrides: OBJECT_DRAFT_OVERRIDES },
    counts: async (tenantId, row) => ({
      insights: await insightsCount(tenantId, "ad", row.meta_id),
      creative: row.creative_id ? 1 : 0,
      crm_leads: await crmLeads(tenantId, "ad_id", row.id, "ad_meta_id", row.meta_id),
      ad_clicks: await count(`SELECT COUNT(*) AS n FROM meta_ads_ad_clicks WHERE tenant_id = $1 AND ad_id = $2`, [tenantId, row.id]),
    }),
    actions: ["create_creative", "push_to_meta", "update_on_meta", "pause", "activate"],
    aiObject: "ad",
    level: "ad",
  },

  "ad-events": {
    table: "meta_ads_events",
    joins: `${ACCOUNT_JOIN} LEFT JOIN meta_ads_campaigns c ON c.id = t.campaign_id AND c.tenant_id = t.tenant_id
            LEFT JOIN meta_ads_ads ad ON ad.id = t.ad_id AND ad.tenant_id = t.tenant_id`,
    display: { account_name: "a.name", campaign_name: "c.name", ad_name: "ad.name" },
    columns: {
      event_time: { sql: "t.event_time", type: "datetime" },
      severity: { sql: "t.severity", type: "enum" },
      webhook: { sql: "t.webhook", type: "text" },
      summary: { sql: "t.summary", type: "text" },
      account_name: { sql: "a.name", type: "text" },
      object_type: { sql: "t.object_type", type: "enum" },
      campaign_name: { sql: "c.name", type: "text" },
      ad_name: { sql: "ad.name", type: "text" },
      object_meta_id: { sql: "t.object_meta_id", type: "text" },
      notified: { sql: "t.notified", type: "bool" },
      processed: { sql: "t.processed", type: "bool" },
    },
    extra: ["t.campaign_id", "t.ad_id", "t.account_id"],
    search: ["t.summary", "t.webhook", "t.object_meta_id"],
    order: "t.event_time DESC, t.id DESC",
    relations: {
      account_id: { sql: "t.account_id", type: "id" },
      campaign_id: { sql: "t.campaign_id", type: "id" },
      ad_id: { sql: "t.ad_id", type: "id" },
      object_meta_id: { sql: "t.object_meta_id", type: "text" },
    },
    editable: { notified: F.bool, processed: F.bool },
    create: false,
    remove: false,
    duplicate: false,
    counts: null,
    actions: [],
  },

  "lead-forms": {
    table: "meta_ads_lead_forms",
    joins: ACCOUNT_JOIN,
    display: { account_name: "a.name" },
    columns: {
      name: { sql: "t.name", type: "text" },
      status: { sql: "t.status", type: "enum" },
      leads_count: { sql: "t.leads_count", type: "number" },
      webhook_enabled: { sql: "t.webhook_enabled", type: "bool" },
      account_name: { sql: "a.name", type: "text" },
    },
    extra: ["t.meta_id"],
    search: ["t.name", "t.meta_id"],
    order: "t.id DESC",
    relations: { account_id: { sql: "t.account_id", type: "id" } },
    editable: { webhook_enabled: F.bool },
    create: false,
    remove: false,
    duplicate: false,
    counts: async (tenantId, row) => ({
      leads: await count(`SELECT COUNT(*) AS n FROM meta_ads_leads WHERE tenant_id = $1 AND form_id = $2`, [tenantId, row.id]),
    }),
    actions: ["sync_leads"],
  },

  leads: {
    table: "meta_ads_leads",
    joins: `LEFT JOIN meta_ads_lead_forms f ON f.id = t.form_id AND f.tenant_id = t.tenant_id
            LEFT JOIN customers cu ON cu.id = t.customer_id AND cu.tenant_id = t.tenant_id`,
    display: { form_name: "f.name", customer_name: "cu.name" },
    columns: {
      name: { sql: "t.name", type: "text" },
      email: { sql: "t.email", type: "text" },
      phone: { sql: "t.phone", type: "text" },
      status: { sql: "t.status", type: "enum" },
      customer_name: { sql: "cu.name", type: "text" },
      created: { sql: "COALESCE(t.created_time, t.created_at)", type: "datetime" },
    },
    extra: ["t.customer_id", "t.form_id"],
    search: ["t.name", "t.email", "t.phone"],
    order: "COALESCE(t.created_time, t.created_at) DESC, t.id DESC",
    relations: {
      form_id: { sql: "t.form_id", type: "id" },
      customer_id: { sql: "t.customer_id", type: "id" },
      campaign_meta_id: { sql: "t.campaign_meta_id", type: "text" },
      adset_meta_id: { sql: "t.adset_meta_id", type: "text" },
      ad_meta_id: { sql: "t.ad_meta_id", type: "text" },
    },
    editable: { name: F.text, email: F.text, phone: F.text, status: { kind: "enum", notNull: true } },
    create: false,
    remove: false,
    duplicate: false,
    counts: null,
    actions: [],
  },

  audiences: {
    table: "meta_ads_audiences",
    joins: ACCOUNT_JOIN,
    display: { account_name: "a.name" },
    columns: {
      name: { sql: "t.name", type: "text" },
      subtype: { sql: "t.subtype", type: "text" },
      approximate_count: { sql: "COALESCE(t.approximate_count_upper, t.approximate_count_lower)", type: "number" },
      status: { sql: "t.status", type: "text" },
      account_name: { sql: "a.name", type: "text" },
    },
    extra: ["t.meta_id"],
    search: ["t.name", "t.meta_id"],
    order: "t.id DESC",
    relations: { account_id: { sql: "t.account_id", type: "id" } },
    editable: {},
    create: false,
    remove: false,
    duplicate: false,
    counts: null,
    actions: [],
  },

  creatives: {
    table: "meta_ads_creatives",
    joins: ACCOUNT_JOIN,
    display: { account_name: "a.name" },
    columns: {
      name: { sql: "t.name", type: "text" },
      creative_type: { sql: "t.creative_type", type: "enum" },
      meta_id: { sql: "t.meta_id", type: "text" },
      page_id: { sql: "t.page_id", type: "text" },
      account_name: { sql: "a.name", type: "text" },
    },
    extra: ["t.is_draft", "t.thumbnail_url", "t.image_url"],
    search: ["t.name", "t.meta_id", "t.headline"],
    order: "t.id DESC",
    relations: { account_id: { sql: "t.account_id", type: "id" } },
    editable: {
      name: F.name,
      creative_type: { kind: "enum", notNull: true },
      page_id: F.text,
      instagram_user_id: F.text,
      primary_text: F.text,
      headline: F.text,
      description: F.text,
      destination_url: F.text,
      call_to_action: F.enum,
      image_hash: F.text,
      image_url: F.text,
      video_id: F.text,
      video_url: F.text,
    },
    create: {
      prepare: async (tenantId, body) => {
        const accountId = await ownedAccountId(tenantId, body.account_id);
        const { rows } = await db.query(`SELECT page_id, instagram_user_id FROM meta_ads_accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
        return {
          account_id: accountId,
          is_draft: true,
          status: "PAUSED",
          page_id: text(body.page_id) || rows[0]?.page_id || null,
          instagram_user_id: text(body.instagram_user_id) || rows[0]?.instagram_user_id || null,
        };
      },
    },
    remove: false,
    duplicate: { overrides: OBJECT_DRAFT_OVERRIDES },
    counts: async (tenantId, row) => ({
      ads: await count(`SELECT COUNT(*) AS n FROM meta_ads_ads WHERE tenant_id = $1 AND creative_id = $2`, [tenantId, row.id]),
    }),
    actions: ["push_to_meta"],
    level: "creative",
  },

  "ad-insights": {
    table: "meta_ads_insights",
    joins: ACCOUNT_JOIN,
    display: { account_name: "a.name", account_currency: "a.currency" },
    columns: {
      level: { sql: "t.level", type: "enum" },
      object_meta_id: { sql: "t.object_meta_id", type: "text" },
      account_name: { sql: "a.name", type: "text" },
      impressions: { sql: "t.impressions", type: "number" },
      reach: { sql: "t.reach", type: "number" },
      clicks: { sql: "t.clicks", type: "number" },
      spend: { sql: "t.spend", type: "number" },
      ctr: { sql: "t.ctr", type: "number" },
      cpc: { sql: "t.cpc", type: "number" },
      cpm: { sql: "t.cpm", type: "number" },
      frequency: { sql: "t.frequency", type: "number" },
      date_start: { sql: "t.date_start", type: "date" },
      date_stop: { sql: "t.date_stop", type: "date" },
      synced_at: { sql: "t.synced_at", type: "datetime" },
    },
    extra: ["a.currency AS account_currency"],
    search: ["t.object_meta_id"],
    order: "t.date_start DESC, t.id DESC",
    relations: {
      account_id: { sql: "t.account_id", type: "id" },
      object_meta_id: { sql: "t.object_meta_id", type: "text" },
      level: { sql: "t.level", type: "text" },
    },
    editable: {},
    create: false,
    remove: false,
    duplicate: false,
    counts: null,
    actions: [],
  },

  "page-insights": {
    table: "meta_ads_page_insights",
    joins: ACCOUNT_JOIN,
    display: { account_name: "a.name" },
    columns: {
      page_name: { sql: "t.page_name", type: "text" },
      page_id: { sql: "t.page_id", type: "text" },
      metric: { sql: "t.metric", type: "text" },
      period: { sql: "t.period", type: "enum" },
      value: { sql: "t.value", type: "number" },
      date_start: { sql: "t.date_start", type: "date" },
      date_stop: { sql: "t.date_stop", type: "date" },
      account_name: { sql: "a.name", type: "text" },
      synced_at: { sql: "t.synced_at", type: "datetime" },
    },
    search: ["t.page_name", "t.page_id", "t.metric"],
    order: "t.date_stop DESC, t.id DESC",
    relations: {
      account_id: { sql: "t.account_id", type: "id" },
      page_id: { sql: "t.page_id", type: "text" },
    },
    editable: {},
    create: false,
    remove: false,
    duplicate: false,
    counts: null,
    actions: [],
  },

  "ad-clicks": {
    table: "meta_ads_ad_clicks",
    joins: `${ACCOUNT_JOIN}
            LEFT JOIN customers cu ON cu.id = t.customer_id AND cu.tenant_id = t.tenant_id
            LEFT JOIN meta_ads_campaigns c ON c.id = t.campaign_id AND c.tenant_id = t.tenant_id
            LEFT JOIN meta_ads_adsets s ON s.id = t.adset_id AND s.tenant_id = t.tenant_id
            LEFT JOIN meta_ads_ads ad ON ad.id = t.ad_id AND ad.tenant_id = t.tenant_id`,
    display: {
      account_name: "a.name",
      customer_name: "cu.name",
      campaign_name: "c.name",
      adset_name: "s.name",
      ad_name: "ad.name",
      ad_meta_id: "COALESCE(ad.meta_id, t.source_id)",
    },
    columns: {
      clicked_at: { sql: "t.clicked_at", type: "datetime" },
      channel: { sql: "t.channel", type: "enum" },
      customer_name: { sql: "cu.name", type: "text" },
      contact_name: { sql: "t.contact_name", type: "text" },
      ad_headline: { sql: "t.ad_headline", type: "text" },
      campaign_name: { sql: "c.name", type: "text" },
      adset_name: { sql: "s.name", type: "text" },
      ad_name: { sql: "ad.name", type: "text" },
      attribution_status: { sql: "t.attribution_status", type: "enum" },
      ad_meta_id: { sql: "COALESCE(ad.meta_id, t.source_id)", type: "text" },
      first_touch: { sql: "t.first_touch", type: "bool" },
      source_url: { sql: "t.source_url", type: "text" },
    },
    extra: ["t.customer_id", "t.campaign_id", "t.adset_id", "t.ad_id", "t.contact_handle"],
    search: ["t.contact_name", "t.contact_handle", "t.ad_headline", "cu.name"],
    order: "t.clicked_at DESC, t.id DESC",
    relations: {
      account_id: { sql: "t.account_id", type: "id" },
      campaign_id: { sql: "t.campaign_id", type: "id" },
      adset_id: { sql: "t.adset_id", type: "id" },
      ad_id: { sql: "t.ad_id", type: "id" },
      customer_id: { sql: "t.customer_id", type: "id" },
    },
    editable: {},
    create: false,
    remove: false,
    duplicate: false,
    counts: null,
    actions: [],
  },

  "conversion-datasets": {
    table: "meta_ads_conversion_datasets",
    joins: "",
    display: {},
    columns: {
      channel: { sql: "t.channel", type: "enum" },
      statement: { sql: "t.statement", type: "text" },
      business_id: { sql: "t.business_id", type: "text" },
      dataset_id: { sql: "t.dataset_id", type: "text" },
      enabled: { sql: "t.enabled", type: "bool" },
      permission: { sql: "t.permission", type: "text" },
      required_permission: { sql: "t.required_permission", type: "text" },
      last_event_at: { sql: "t.last_event_at", type: "datetime" },
      failure_count: { sql: "t.failure_count", type: "number" },
    },
    search: ["t.statement", "t.dataset_id", "t.business_id"],
    order: "t.id DESC",
    relations: {},
    editable: {
      channel: { kind: "enum", notNull: true },
      statement: F.name,
      business_id: F.text,
      dataset_id: { kind: "text", notNull: true },
      enabled: F.bool,
      permission: F.text,
      required_permission: F.text,
    },
    secrets: { access_token: "access_token_encrypted" },
    create: {
      prepare: async (tenantId, body) => {
        if (!text(body.dataset_id)) throw httpError(400, "Dataset id is required", "META_ADS_FIELD_REQUIRED");
        return {};
      },
    },
    remove: true,
    duplicate: {
      overrides: (suffix) => ({
        statement: `t.statement || ${literal(suffix)}`,
        dataset_id: `t.dataset_id || '-copy-' || to_char(NOW(), 'YYYYMMDDHH24MISS')`,
        last_event_at: "NULL",
        failure_count: "0",
      }),
    },
    counts: async (tenantId, row) => ({
      conversion_events: await count(`SELECT COUNT(*) AS n FROM meta_ads_conversion_events WHERE tenant_id = $1 AND dataset_id = $2`, [tenantId, row.id]),
    }),
    actions: ["test_event"],
  },

  "conversion-events": {
    table: "meta_ads_conversion_events",
    joins: `LEFT JOIN meta_ads_conversion_datasets d ON d.id = t.dataset_id AND d.tenant_id = t.tenant_id
            LEFT JOIN customers cu ON cu.id = t.customer_id AND cu.tenant_id = t.tenant_id`,
    display: { dataset_name: "COALESCE(NULLIF(d.statement, ''), d.dataset_id)", lead_name: "COALESCE(cu.name, t.lead_label)" },
    columns: {
      event_time: { sql: "t.event_time", type: "datetime" },
      event_name: { sql: "t.event_name", type: "text" },
      status: { sql: "t.status", type: "enum" },
      channel: { sql: "t.channel", type: "enum" },
      lead_name: { sql: "COALESCE(cu.name, t.lead_label)", type: "text" },
      dataset_name: { sql: "COALESCE(NULLIF(d.statement, ''), d.dataset_id)", type: "text" },
      attempts: { sql: "t.attempts", type: "number" },
      error: { sql: "t.error", type: "text" },
      sent_at: { sql: "t.sent_at", type: "datetime" },
    },
    extra: ["t.dataset_id", "t.customer_id"],
    search: ["t.event_name", "t.event_id", "t.lead_label", "t.error"],
    order: "t.event_time DESC, t.id DESC",
    relations: {
      dataset_id: { sql: "t.dataset_id", type: "id" },
      customer_id: { sql: "t.customer_id", type: "id" },
    },
    editable: {},
    create: false,
    remove: false,
    duplicate: false,
    counts: null,
    actions: [],
  },

  competitors: {
    table: "meta_ads_competitors",
    joins: "",
    display: {},
    columns: {
      name: { sql: "t.name", type: "text" },
      page_id: { sql: "t.page_id", type: "text" },
      facebook_url: { sql: "t.facebook_url", type: "text" },
      instagram: { sql: "t.instagram", type: "text" },
      country: { sql: "t.country", type: "text" },
      is_own_page: { sql: "t.is_own_page", type: "bool" },
      ads_tracked: { sql: "t.ads_tracked", type: "number" },
      posts_tracked: { sql: "t.posts_tracked", type: "number" },
      active: { sql: "t.active", type: "bool" },
      last_scanned_at: { sql: "t.last_scanned_at", type: "datetime" },
      posts_scanned_at: { sql: "t.posts_scanned_at", type: "datetime" },
    },
    search: ["t.name", "t.page_id", "t.facebook_url", "t.instagram"],
    order: "t.id DESC",
    relations: {},
    editable: {
      name: F.name,
      page_id: F.text,
      facebook_url: F.text,
      instagram: F.text,
      country: { kind: "text", notNull: true, fallback: "ALL" },
      is_own_page: F.bool,
      active: F.bool,
    },
    create: {
      prepare: async (tenantId, body) => {
        if (!text(body.name)) throw httpError(400, "Competitor name is required", "META_ADS_FIELD_REQUIRED");
        return {};
      },
    },
    remove: true,
    duplicate: {
      overrides: (suffix) => ({
        name: `t.name || ${literal(suffix)}`,
        ads_tracked: "0",
        last_scanned_at: "NULL",
        last_scan_error: "NULL",
        posts_tracked: "0",
        posts_scanned_at: "NULL",
        posts_scan_error: "NULL",
      }),
    },
    counts: async (tenantId, row) => ({
      competitor_ads: await count(`SELECT COUNT(*) AS n FROM meta_ads_competitor_ads WHERE tenant_id = $1 AND competitor_id = $2`, [tenantId, row.id]),
      competitor_posts: await count(`SELECT COUNT(*) AS n FROM meta_ads_competitor_posts WHERE tenant_id = $1 AND competitor_id = $2`, [tenantId, row.id]),
    }),
    actions: ["scan_now", "scan_posts"],
  },

  "competitor-posts": {
    table: "meta_ads_competitor_posts",
    joins: "LEFT JOIN meta_ads_competitors co ON co.id = t.competitor_id AND co.tenant_id = t.tenant_id",
    display: { competitor_name: "co.name" },
    columns: {
      competitor_name: { sql: "co.name", type: "text" },
      body: { sql: "t.body", type: "text" },
      media_type: { sql: "t.media_type", type: "enum" },
      posted_at: { sql: "t.posted_at", type: "datetime" },
      likes: { sql: "t.likes", type: "number" },
      comments: { sql: "t.comments", type: "number" },
      shares: { sql: "t.shares", type: "number" },
      views: { sql: "t.views", type: "number" },
      engagement: { sql: "t.engagement", type: "number" },
    },
    extra: ["t.competitor_id"],
    search: ["t.body", "t.page_name", "co.name"],
    order: "t.engagement DESC, t.id DESC",
    relations: { competitor_id: { sql: "t.competitor_id", type: "id" } },
    editable: {},
    create: false,
    remove: true,
    duplicate: false,
    counts: null,
    actions: [],
  },

  "competitor-report-schedules": {
    table: "meta_ads_competitor_report_schedules",
    joins: "",
    display: {},
    columns: {
      name: { sql: "t.name", type: "text" },
      weekday: { sql: "t.weekday", type: "enum" },
      days_window: { sql: "t.days_window", type: "number" },
      telegram_chat_id: { sql: "t.telegram_chat_id", type: "text" },
      email_to: { sql: "t.email_to", type: "text" },
      active: { sql: "t.active", type: "bool" },
      last_report_at: { sql: "t.last_report_at", type: "datetime" },
    },
    search: ["t.name", "t.email_to", "t.telegram_chat_id"],
    order: "t.id DESC",
    relations: {},
    editable: {
      name: F.name,
      weekday: { kind: "number", notNull: true, fallback: 6 },
      days_window: { kind: "number", notNull: true, fallback: 7 },
      telegram_chat_id: F.text,
      email_to: F.text,
      notes: F.text,
      active: F.bool,
    },
    create: {
      prepare: async (tenantId, body) => {
        if (!text(body.name)) throw httpError(400, "Report name is required", "META_ADS_FIELD_REQUIRED");
        const weekday = text(body.weekday) ? Number(body.weekday) : 6;
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw httpError(400, "Invalid weekday", "META_ADS_FIELD_INVALID");
        const days = text(body.days_window) ? Number(body.days_window) : 7;
        if (!Number.isInteger(days) || days < 1 || days > 90) throw httpError(400, "Report period must be 1–90 days", "META_ADS_FIELD_INVALID");
        return { weekday, days_window: days };
      },
    },
    remove: true,
    duplicate: {
      overrides: (suffix) => ({
        name: `t.name || ${literal(suffix)}`,
        last_report_at: "NULL",
        last_error: "NULL",
      }),
    },
    counts: async (tenantId, row) => ({
      competitor_reports: await count(`SELECT COUNT(*) AS n FROM meta_ads_competitor_reports WHERE tenant_id = $1 AND schedule_id = $2`, [tenantId, row.id]),
    }),
    actions: ["generate_report"],
  },

  "competitor-reports": {
    table: "meta_ads_competitor_reports",
    joins: "LEFT JOIN meta_ads_competitor_report_schedules sc ON sc.id = t.schedule_id AND sc.tenant_id = t.tenant_id",
    display: { schedule_name: "sc.name" },
    columns: {
      title: { sql: "t.title", type: "text" },
      schedule_name: { sql: "sc.name", type: "text" },
      status: { sql: "t.status", type: "enum" },
      competitors_count: { sql: "t.competitors_count", type: "number" },
      posts_count: { sql: "t.posts_count", type: "number" },
      created_at: { sql: "t.created_at", type: "datetime" },
      sent_telegram_at: { sql: "t.sent_telegram_at", type: "datetime" },
      sent_email_at: { sql: "t.sent_email_at", type: "datetime" },
    },
    extra: ["t.schedule_id"],
    search: ["t.title", "t.summary", "sc.name"],
    order: "t.id DESC",
    relations: { schedule_id: { sql: "t.schedule_id", type: "id" } },
    editable: {},
    create: false,
    remove: true,
    duplicate: false,
    counts: null,
    actions: ["send_report"],
  },

  "competitor-ads": {
    table: "meta_ads_competitor_ads",
    joins: "LEFT JOIN meta_ads_competitors co ON co.id = t.competitor_id AND co.tenant_id = t.tenant_id",
    display: { competitor_name: "co.name" },
    columns: {
      competitor_name: { sql: "co.name", type: "text" },
      headline: { sql: "t.headline", type: "text" },
      format: { sql: "t.format", type: "enum" },
      call_to_action: { sql: "t.call_to_action", type: "text" },
      ai_angle: { sql: "t.ai_angle", type: "text" },
      is_active: { sql: "t.is_active", type: "bool" },
      days_running: { sql: "t.days_running", type: "number" },
      started_at: { sql: "t.started_at", type: "date" },
      last_seen_at: { sql: "t.last_seen_at", type: "datetime" },
    },
    extra: ["t.competitor_id"],
    search: ["t.headline", "t.body", "t.page_name", "co.name"],
    order: "t.id DESC",
    relations: { competitor_id: { sql: "t.competitor_id", type: "id" } },
    editable: {},
    create: false,
    remove: false,
    duplicate: false,
    counts: null,
    actions: ["analyze"],
  },

  "optimization-goals": {
    catalog: () => OPTIMIZATION_GOALS.map((goal) => ({ id: goal.code, code: goal.code, objectives: goal.objectives, promoted: goal.promoted, destination: goal.destination })),
    columns: { code: { type: "text" }, objectives: { type: "text" } },
  },

  "billing-events": {
    catalog: () => BILLING_EVENTS.map((event) => ({ id: event.code, code: event.code, goals: event.goals })),
    columns: { code: { type: "text" }, goals: { type: "text" } },
  },
};

export const getResource = (key) => {
  const resource = Object.prototype.hasOwnProperty.call(RESOURCES, key) ? RESOURCES[key] : null;
  if (!resource) throw httpError(404, "Unknown record type", "META_ADS_UNKNOWN_RESOURCE");
  return resource;
};

// Many-to-one selects in the record forms: GET /lookups/:kind → [{ id, name }].
export const LOOKUPS = {
  accounts: { sql: "SELECT id, name, ad_account_id AS hint FROM meta_ads_accounts WHERE tenant_id = $1 ORDER BY name, id" },
  campaigns: { sql: "SELECT id, name, meta_id AS hint FROM meta_ads_campaigns WHERE tenant_id = $1 AND ($2::bigint IS NULL OR account_id = $2) ORDER BY id DESC LIMIT 500", account: true },
  adsets: { sql: "SELECT id, name, meta_id AS hint FROM meta_ads_adsets WHERE tenant_id = $1 AND ($2::bigint IS NULL OR account_id = $2) ORDER BY id DESC LIMIT 500", account: true },
  creatives: { sql: "SELECT id, name, meta_id AS hint FROM meta_ads_creatives WHERE tenant_id = $1 AND ($2::bigint IS NULL OR account_id = $2) ORDER BY id DESC LIMIT 500", account: true },
  competitors: { sql: "SELECT id, name, page_id AS hint FROM meta_ads_competitors WHERE tenant_id = $1 ORDER BY name, id" },
  "report-schedules": { sql: "SELECT id, name, email_to AS hint FROM meta_ads_competitor_report_schedules WHERE tenant_id = $1 ORDER BY name, id" },
  datasets: { sql: "SELECT id, COALESCE(NULLIF(statement, ''), dataset_id) AS name, dataset_id AS hint FROM meta_ads_conversion_datasets WHERE tenant_id = $1 ORDER BY id DESC" },
  "lead-forms": { sql: "SELECT id, name, meta_id AS hint FROM meta_ads_lead_forms WHERE tenant_id = $1 AND ($2::bigint IS NULL OR account_id = $2) ORDER BY name, id", account: true },
};
