ALTER TABLE channel_conversation_map
  ADD COLUMN IF NOT EXISTS external_username VARCHAR(255),
  ADD COLUMN IF NOT EXISTS external_display_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS conversation_fingerprint VARCHAR(128),
  ADD COLUMN IF NOT EXISTS identity_confidence VARCHAR(16),
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

ALTER TABLE channel_conversation_map DROP CONSTRAINT IF EXISTS channel_conversation_map_identity_confidence;
ALTER TABLE channel_conversation_map ADD CONSTRAINT channel_conversation_map_identity_confidence
  CHECK (identity_confidence IS NULL OR identity_confidence IN ('high','medium','low'));

CREATE INDEX IF NOT EXISTS idx_channel_conversation_map_fingerprint
  ON channel_conversation_map (connection_id, conversation_fingerprint)
  WHERE conversation_fingerprint IS NOT NULL;

ALTER TABLE channel_message_map
  ADD COLUMN IF NOT EXISTS dom_fingerprint VARCHAR(128),
  ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS reconciliation_checked_at TIMESTAMPTZ;

ALTER TABLE outbound_message_jobs DROP CONSTRAINT IF EXISTS outbound_message_jobs_status;
ALTER TABLE outbound_message_jobs ADD CONSTRAINT outbound_message_jobs_status CHECK (status IN (
  'queued', 'processing', 'sent', 'sent_unconfirmed', 'confirmed', 'retrying', 'failed', 'cancelled', 'needs_manual_review'
));

CREATE TABLE IF NOT EXISTS channel_bridge_runtime_state (
  connection_id BIGINT PRIMARY KEY REFERENCES channel_connections(id) ON DELETE CASCADE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paused BOOLEAN NOT NULL DEFAULT TRUE,
  health_status VARCHAR(32) NOT NULL DEFAULT 'paused',
  selector_version VARCHAR(80),
  last_incoming_at TIMESTAMPTZ,
  last_outgoing_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  pending_jobs INTEGER NOT NULL DEFAULT 0,
  failed_jobs INTEGER NOT NULL DEFAULT 0,
  manual_review_count INTEGER NOT NULL DEFAULT 0,
  health JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel_outbound_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES outbound_message_jobs(id) ON DELETE CASCADE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expected_text_hash VARCHAR(128) NOT NULL,
  send_clicked_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_checked_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  reason VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_outbound_reconciliation_status CHECK (status IN ('pending','confirmed','retrying','needs_manual_review')),
  CONSTRAINT channel_outbound_reconciliation_job_unique UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_outbound_reconciliations_pending
  ON channel_outbound_reconciliations (tenant_id, created_at)
  WHERE status IN ('pending','retrying');
