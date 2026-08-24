-- Multi-channel accounts foundation (AI Inbox).
-- 1) channel_accounts: one row per connected account (WhatsApp number, Facebook
--    Page, Instagram account, Telegram bot, TikTok account) so the inbox can
--    list, badge, and filter by the specific account a conversation lives on.
-- 2) meta_integration_configs: retire the one-page-per-tenant constraint.
--    Identity becomes (tenant_id, facebook_page_id) so a tenant can connect
--    several Facebook Pages / Instagram accounts side by side.
-- Additive and idempotent: safe to run on a database where the runtime
-- ensure-schema already applied the same changes.

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
);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_tenant_platform
  ON channel_accounts (tenant_id, platform, is_active);

-- Conversations already carry the owning account inside metadata; index the
-- keys the account filter will query by.
CREATE INDEX IF NOT EXISTS idx_ai_channel_conversations_page_id
  ON ai_channel_conversations ((metadata->>'page_id'));
CREATE INDEX IF NOT EXISTS idx_ai_channel_conversations_ig_account
  ON ai_channel_conversations ((metadata->>'instagram_business_account_id'));

-- Meta: allow several pages per tenant. The new identity must exist before the
-- old one is dropped so upserts always have a conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_integration_tenant_page
  ON meta_integration_configs (tenant_id, facebook_page_id);

DO $$
DECLARE con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'meta_integration_configs'::regclass
      AND c.contype = 'u'
      AND c.conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = c.conrelid AND attname = 'tenant_id'
      )]
  LOOP
    EXECUTE format('ALTER TABLE meta_integration_configs DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;
