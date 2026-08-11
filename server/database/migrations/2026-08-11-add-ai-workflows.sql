-- AI Studio Phase 2 — workflow engine persistence (tenant-scoped).
-- Mirrors ensureAiWorkflowSchema() in server/services/aiWorkflowSchema.js (runtime source of truth).

CREATE TABLE IF NOT EXISTS ai_workflows (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_workflows_tenant ON ai_workflows (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS ai_workflow_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  workflow_id BIGINT NOT NULL,
  workflow_version INTEGER NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'pending',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  pending_node_id TEXT NULL,
  error TEXT NULL,
  idempotency_key TEXT NULL,
  started_by BIGINT NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_workflow_runs_tenant ON ai_workflow_runs (tenant_id, workflow_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_workflow_runs_idem ON ai_workflow_runs (tenant_id, workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_workflow_run_steps (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  run_id BIGINT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  node_id TEXT NOT NULL DEFAULT '',
  node_type TEXT NOT NULL DEFAULT '',
  tool_id TEXT NULL,
  risk_level TEXT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT NULL,
  duration_ms INTEGER NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_workflow_run_steps_run ON ai_workflow_run_steps (tenant_id, run_id, seq);

CREATE TABLE IF NOT EXISTS ai_workflow_approvals (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  workflow_id BIGINT NOT NULL,
  run_id BIGINT NOT NULL,
  node_id TEXT NOT NULL DEFAULT '',
  tool_id TEXT NULL,
  risk_level TEXT NULL,
  requested_action TEXT NOT NULL DEFAULT '',
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by BIGINT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by BIGINT NULL,
  decided_at TIMESTAMP NULL,
  decision_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_workflow_approvals_pending ON ai_workflow_approvals (tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_workflow_approvals_run_node ON ai_workflow_approvals (run_id, node_id);
