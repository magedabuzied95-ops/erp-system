-- AI Studio Phase 5 — delegated WRITE automation + tenant timezone (additive).
-- Mirrors the idempotent ensureAiWorkflowSchema() statements. Safe to re-run.

-- Per-tenant IANA timezone for schedule slots (resolved: this column -> env APP_TIMEZONE/TZ -> Africa/Cairo).
ALTER TABLE ai_workflow_tenant_settings ADD COLUMN IF NOT EXISTS timezone TEXT NULL;

-- Explicit per-workflow delegated grants (an admin permits THIS workflow to use THIS
-- registered DELEGATABLE tool automatically). Never admin/superuser; never overrides SENSITIVE.
CREATE TABLE IF NOT EXISTS ai_workflow_grants (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  workflow_id BIGINT NOT NULL,
  tool_id TEXT NOT NULL,
  granted_by BIGINT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by BIGINT NULL,
  revoked_at TIMESTAMP NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_workflow_grants_active
  ON ai_workflow_grants (tenant_id, workflow_id, tool_id) WHERE revoked_at IS NULL;

-- Write-operation idempotency: a side-effecting step runs at most once per (run, node).
CREATE TABLE IF NOT EXISTS ai_workflow_write_ops (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  run_id BIGINT NOT NULL,
  node_id TEXT NOT NULL,
  tool_id TEXT NULL,
  idempotency_key TEXT NOT NULL,
  result_ref TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_workflow_write_ops_key
  ON ai_workflow_write_ops (tenant_id, idempotency_key);
