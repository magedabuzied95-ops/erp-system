-- AI Studio Phase 4 — event-driven workflow automation (additive).
-- Mirrors the idempotent ensureAiWorkflowSchema() ALTERs in
-- server/services/aiWorkflowSchema.js. Safe to run more than once.

-- Soft-delete / archive (workflows and run history are never hard-deleted).
ALTER TABLE ai_workflows ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL;
ALTER TABLE ai_workflows ADD COLUMN IF NOT EXISTS archived_by BIGINT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_workflows_active
  ON ai_workflows (tenant_id, trigger_type)
  WHERE archived_at IS NULL AND enabled = TRUE;

-- Run observability: which ERP event caused an automatic run.
-- (Duplicate suppression reuses the existing uq_ai_workflow_runs_idem index
--  on (tenant_id, workflow_id, idempotency_key).)
ALTER TABLE ai_workflow_runs ADD COLUMN IF NOT EXISTS event_id TEXT NULL;

-- Per-tenant automation kill switch. Default OFF; existing tenants are never
-- auto-enabled. Automatic runs require: global env flag ON AND this row ON AND
-- the workflow enabled+non-archived AND a matching enabled trigger.
CREATE TABLE IF NOT EXISTS ai_workflow_tenant_settings (
  tenant_id BIGINT PRIMARY KEY,
  automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
