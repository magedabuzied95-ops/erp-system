// Channel accounts registry: one row per connected messaging account — a
// Facebook Page, an Instagram business account, a WhatsApp number (Evolution
// instance), a Telegram bot. Conversations keep carrying the owning account in
// their metadata (page_id / instagram_business_account_id / instance); this
// table is the tenant-facing list those identifiers resolve against, so the
// inbox can name, badge, and filter accounts without re-deriving them from
// credentials scattered across env vars and per-platform config tables.
import db from "../database/db.js";

const text = (value) => (value === null || value === undefined ? "" : String(value).trim());
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const CHANNEL_ACCOUNT_PLATFORMS = Object.freeze({
  WHATSAPP: "whatsapp",
  FACEBOOK_MESSENGER: "facebook_messenger",
  INSTAGRAM: "instagram",
  TELEGRAM: "telegram",
  TIKTOK: "tiktok",
});

let schemaReadyPromise = null;

export const ensureChannelAccountsSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS channel_accounts (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          platform TEXT NOT NULL,
          external_account_id TEXT NOT NULL,
          display_name TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT '',
          config_ref BIGINT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          is_default BOOLEAN NOT NULL DEFAULT FALSE,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, platform, external_account_id)
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_channel_accounts_tenant_platform
        ON channel_accounts (tenant_id, platform, is_active)
      `);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

export const upsertChannelAccount = async ({
  tenantId,
  platform,
  externalAccountId,
  displayName = "",
  provider = "",
  configRef = null,
  isActive = true,
  metadata = {},
} = {}) => {
  await ensureChannelAccountsSchema();
  const scopedTenantId = numberOrNull(tenantId);
  const safePlatform = text(platform);
  const safeExternalId = text(externalAccountId);
  if (!scopedTenantId || !safePlatform || !safeExternalId) return null;
  const result = await db.query(
    `
    INSERT INTO channel_accounts (
      tenant_id, platform, external_account_id, display_name, provider, config_ref, is_active, metadata, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
    ON CONFLICT (tenant_id, platform, external_account_id) DO UPDATE SET
      display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE channel_accounts.display_name END,
      provider = CASE WHEN EXCLUDED.provider <> '' THEN EXCLUDED.provider ELSE channel_accounts.provider END,
      config_ref = COALESCE(EXCLUDED.config_ref, channel_accounts.config_ref),
      is_active = EXCLUDED.is_active,
      metadata = channel_accounts.metadata || EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING *
    `,
    [
      scopedTenantId,
      safePlatform,
      safeExternalId,
      text(displayName),
      text(provider),
      numberOrNull(configRef),
      isActive !== false,
      JSON.stringify(metadata || {}),
    ]
  );
  return result.rows[0] || null;
};

export const listChannelAccounts = async ({ tenantId, platform = "", includeInactive = false } = {}) => {
  await ensureChannelAccountsSchema();
  const scopedTenantId = numberOrNull(tenantId);
  if (!scopedTenantId) return [];
  const result = await db.query(
    `
    SELECT id, tenant_id, platform, external_account_id, display_name, provider, config_ref, is_active, is_default, metadata, created_at, updated_at
    FROM channel_accounts
    WHERE tenant_id = $1
      AND ($2::text = '' OR platform = $2)
      AND ($3::boolean OR is_active = TRUE)
    ORDER BY platform, is_default DESC, display_name, id
    `,
    [scopedTenantId, text(platform), includeInactive === true]
  );
  return result.rows;
};

// Mirror every connected Meta page / Instagram account into the registry.
// meta_integration_configs stays the credential authority; this only projects
// identity + display fields, so re-running is always safe.
export const syncMetaChannelAccounts = async ({ tenantId } = {}) => {
  const scopedTenantId = numberOrNull(tenantId);
  if (!scopedTenantId) return [];
  const configs = await db.query(
    `
    SELECT id, facebook_page_id, page_name, facebook_page_name,
           instagram_business_account_id, instagram_username, status,
           messenger_enabled, instagram_dm_enabled
    FROM meta_integration_configs
    WHERE tenant_id = $1
    `,
    [scopedTenantId]
  ).catch(() => ({ rows: [] }));
  const synced = [];
  for (const config of configs.rows) {
    const active = !["invalid", "token_expired", "revoked", "error", "not_connected", "duplicate"].includes(text(config.status).toLowerCase());
    const pageId = text(config.facebook_page_id);
    if (pageId) {
      synced.push(await upsertChannelAccount({
        tenantId: scopedTenantId,
        platform: CHANNEL_ACCOUNT_PLATFORMS.FACEBOOK_MESSENGER,
        externalAccountId: pageId,
        displayName: text(config.facebook_page_name || config.page_name),
        provider: "meta",
        configRef: config.id,
        isActive: active && config.messenger_enabled !== false,
        metadata: { page_id: pageId },
      }));
    }
    const igId = text(config.instagram_business_account_id);
    if (igId) {
      synced.push(await upsertChannelAccount({
        tenantId: scopedTenantId,
        platform: CHANNEL_ACCOUNT_PLATFORMS.INSTAGRAM,
        externalAccountId: igId,
        displayName: text(config.instagram_username),
        provider: "meta",
        configRef: config.id,
        isActive: active && config.instagram_dm_enabled !== false,
        metadata: { instagram_business_account_id: igId, page_id: pageId },
      }));
    }
  }
  return synced.filter(Boolean);
};

// The WhatsApp number and Telegram bot are still configured through env vars
// (one each per deployment, until their own multi-account phases land).
// Registering them here makes the registry the one complete account list the
// UI reads, instead of a Meta-only one.
export const syncEnvChannelAccounts = async ({ tenantId } = {}) => {
  const scopedTenantId = numberOrNull(tenantId);
  if (!scopedTenantId) return [];
  const synced = [];
  const whatsappInstance = text(
    process.env.WHATSAPP_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE_NAME || process.env.instanceName
  );
  if (whatsappInstance) {
    synced.push(await upsertChannelAccount({
      tenantId: scopedTenantId,
      platform: CHANNEL_ACCOUNT_PLATFORMS.WHATSAPP,
      externalAccountId: whatsappInstance,
      displayName: whatsappInstance,
      provider: "evolution",
      metadata: { source: "env", instance: whatsappInstance },
    }));
  }
  const telegramToken = text(process.env.TELEGRAM_BOT_TOKEN);
  const telegramBotId = telegramToken.includes(":") ? telegramToken.split(":")[0] : "";
  if (telegramBotId) {
    synced.push(await upsertChannelAccount({
      tenantId: scopedTenantId,
      platform: CHANNEL_ACCOUNT_PLATFORMS.TELEGRAM,
      externalAccountId: telegramBotId,
      displayName: text(process.env.TELEGRAM_BOT_USERNAME) || `bot ${telegramBotId}`,
      provider: "telegram_bot",
      metadata: { source: "env" },
    }));
  }
  return synced.filter(Boolean);
};

export default {
  CHANNEL_ACCOUNT_PLATFORMS,
  ensureChannelAccountsSchema,
  upsertChannelAccount,
  listChannelAccounts,
  syncMetaChannelAccounts,
  syncEnvChannelAccounts,
};
