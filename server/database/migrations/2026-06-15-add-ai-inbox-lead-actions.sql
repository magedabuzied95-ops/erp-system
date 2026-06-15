ALTER TABLE IF EXISTS ai_customer_profiles
  ADD COLUMN IF NOT EXISTS external_customer_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_ai_customer_profiles_external_customer_id
  ON ai_customer_profiles (tenant_id, external_customer_id);

CREATE TABLE IF NOT EXISTS ai_lead_opportunities (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  profile_id BIGINT NOT NULL REFERENCES ai_customer_profiles(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_lead_opportunities_scope
  ON ai_lead_opportunities (tenant_id, profile_id, conversation_id, source_key);

CREATE INDEX IF NOT EXISTS idx_ai_lead_opportunities_tenant_status
  ON ai_lead_opportunities (tenant_id, status, created_at DESC);
