-- AI Studio Phase 10 — Inbound Omnichannel Intake (human-approved AI replies). Additive only.
-- Mirrors ensureInboundIntakeSchema in aiInboundIntakeService.js. Default OFF.

-- Per-tenant inbound AI mode: off | suggest_only | approval_reply (default off).
ALTER TABLE ai_workflow_tenant_settings ADD COLUMN IF NOT EXISTS inbound_ai_mode TEXT NOT NULL DEFAULT 'off';

-- Bounded, sanitized observability log (no message text, no secrets, no raw provider payloads).
CREATE TABLE IF NOT EXISTS ai_inbound_intake_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  channel TEXT NULL,
  conversation_id TEXT NULL,
  canonical_message_id BIGINT NULL,
  provider_message_id TEXT NULL,
  intent TEXT NULL,
  outcome TEXT NOT NULL,
  confidence NUMERIC NULL,
  reason TEXT NULL,
  duration_ms INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_inbound_intake_log_tenant ON ai_inbound_intake_log (tenant_id, created_at DESC);
