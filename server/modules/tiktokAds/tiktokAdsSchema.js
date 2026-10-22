// TikTok Ads (Marketing API) tables. New tables only — nothing existing is altered.
// Awaited at boot and non-fatal there: a failure disables the TikTok Ads module only.
// The advertiser token is stored as a tkb:v1 envelope (tiktokBusinessCryptoService);
// no route ever selects it.

let ensured = null;
let ready = false;

export const isTikTokAdsSchemaReady = () => ready;

const OBJECT_COLUMNS = `
    name TEXT NOT NULL DEFAULT '',
    operation_status TEXT NULL,
    secondary_status TEXT NULL,
    budget NUMERIC(14,2) NULL,
    budget_mode TEXT NULL,
    tiktok_created_at TIMESTAMPTZ NULL,
    tiktok_updated_at TIMESTAMPTZ NULL,
    raw JSONB NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tiktok_ads_accounts (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    advertiser_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NULL,
    role TEXT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    timezone TEXT NOT NULL DEFAULT '',
    balance NUMERIC(14,2) NULL,
    company TEXT NULL,
    country TEXT NULL,
    owner_bc_id TEXT NULL,
    access_token_encrypted TEXT NULL,
    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    connected_by BIGINT NULL,
    connected_at TIMESTAMPTZ NULL,
    raw JSONB NULL,
    structure_state TEXT NULL,
    report_state TEXT NULL,
    last_synced_at TIMESTAMPTZ NULL,
    last_sync_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, advertiser_id)
  )`,
  `CREATE TABLE IF NOT EXISTS tiktok_ads_oauth_states (
    state TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    user_id BIGINT NULL,
    return_to TEXT NOT NULL DEFAULT '',
    used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS tiktok_ads_campaigns (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    account_id BIGINT NOT NULL REFERENCES tiktok_ads_accounts(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL,
    objective_type TEXT NULL,
    ${OBJECT_COLUMNS},
    UNIQUE (account_id, campaign_id)
  )`,
  `CREATE TABLE IF NOT EXISTS tiktok_ads_adgroups (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    account_id BIGINT NOT NULL REFERENCES tiktok_ads_accounts(id) ON DELETE CASCADE,
    adgroup_id TEXT NOT NULL,
    campaign_id TEXT NULL,
    optimization_goal TEXT NULL,
    schedule_end_time TIMESTAMPTZ NULL,
    ${OBJECT_COLUMNS},
    UNIQUE (account_id, adgroup_id)
  )`,
  `CREATE TABLE IF NOT EXISTS tiktok_ads_ads (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    account_id BIGINT NOT NULL REFERENCES tiktok_ads_accounts(id) ON DELETE CASCADE,
    ad_id TEXT NOT NULL,
    adgroup_id TEXT NULL,
    campaign_id TEXT NULL,
    ad_format TEXT NULL,
    ad_text TEXT NULL,
    ${OBJECT_COLUMNS},
    UNIQUE (account_id, ad_id)
  )`,
  // One row per object per day (advertiser's own calendar day, as TikTok reports it).
  `CREATE TABLE IF NOT EXISTS tiktok_ads_insights (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    account_id BIGINT NOT NULL REFERENCES tiktok_ads_accounts(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    object_id TEXT NOT NULL,
    stat_date DATE NOT NULL,
    spend NUMERIC(14,2) NOT NULL DEFAULT 0,
    impressions BIGINT NOT NULL DEFAULT 0,
    clicks BIGINT NOT NULL DEFAULT 0,
    reach BIGINT NOT NULL DEFAULT 0,
    conversions NUMERIC(14,2) NOT NULL DEFAULT 0,
    purchases NUMERIC(14,2) NOT NULL DEFAULT 0,
    purchase_value NUMERIC(14,2) NOT NULL DEFAULT 0,
    add_to_cart NUMERIC(14,2) NOT NULL DEFAULT 0,
    initiate_checkout NUMERIC(14,2) NOT NULL DEFAULT 0,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, level, object_id, stat_date)
  )`,
  `CREATE INDEX IF NOT EXISTS tiktok_ads_insights_window_idx ON tiktok_ads_insights (account_id, level, stat_date)`,
];

export const TIKTOK_ADS_TABLES = Object.freeze([
  "tiktok_ads_accounts",
  "tiktok_ads_oauth_states",
  "tiktok_ads_campaigns",
  "tiktok_ads_adgroups",
  "tiktok_ads_ads",
  "tiktok_ads_insights",
]);

export const ensureTikTokAdsSchema = async (db) => {
  if (!ensured) {
    ensured = (async () => {
      for (const statement of STATEMENTS) await db.query(statement);
      ready = true;
    })().catch((error) => {
      ensured = null;
      throw error;
    });
  }
  return ensured;
};
