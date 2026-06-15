ALTER TABLE IF EXISTS ai_channel_conversations
  ADD COLUMN IF NOT EXISTS lead_status TEXT NOT NULL DEFAULT 'new';

ALTER TABLE IF EXISTS ai_channel_conversations
  ADD COLUMN IF NOT EXISTS thread_kind TEXT NOT NULL DEFAULT 'dm';

CREATE INDEX IF NOT EXISTS idx_ai_channel_conversations_tenant_lead_status
  ON ai_channel_conversations (tenant_id, lead_status, updated_at DESC);

