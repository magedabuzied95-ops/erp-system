// AI Workflow persistence schema + declarative-definition validation.
// Tables are tenant-scoped and created idempotently (matches the ERP's ensure*Schema
// convention). A canonical migration also exists under server/database/migrations/.

import db from "../database/db.js";
import { isKnownTool, getTool, RISK } from "./aiWorkflowToolRegistry.js";
import { isKnownTrigger, isAuthorableTrigger } from "./aiWorkflowTriggerRegistry.js";

export const NODE_TYPES = Object.freeze(["trigger", "condition", "tool", "agent", "approval", "action", "end"]);
export const RUN_STATUSES = Object.freeze(["pending", "running", "awaiting_approval", "completed", "failed", "rejected", "cancelled"]);
export const APPROVAL_STATUSES = Object.freeze(["pending", "approved", "rejected", "cancelled", "expired"]);

let schemaReadyPromise = null;

export const ensureAiWorkflowSchema = async (client = db) => {
  if (schemaReadyPromise) return schemaReadyPromise;
  schemaReadyPromise = (async () => {
    await client.query(`
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
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_workflows_tenant ON ai_workflows (tenant_id, enabled)`);

    await client.query(`
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
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_workflow_runs_tenant ON ai_workflow_runs (tenant_id, workflow_id, created_at DESC)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_workflow_runs_idem ON ai_workflow_runs (tenant_id, workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);

    await client.query(`
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
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_workflow_run_steps_run ON ai_workflow_run_steps (tenant_id, run_id, seq)`);

    await client.query(`
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
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_workflow_approvals_pending ON ai_workflow_approvals (tenant_id, status, created_at DESC)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_workflow_approvals_run_node ON ai_workflow_approvals (run_id, node_id)`);

    // ---- Phase 4: event-driven automation (additive) ----
    // Soft-delete / archive (never hard-delete workflows or their run history).
    await client.query(`ALTER TABLE ai_workflows ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL`);
    await client.query(`ALTER TABLE ai_workflows ADD COLUMN IF NOT EXISTS archived_by BIGINT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_workflows_active ON ai_workflows (tenant_id, trigger_type) WHERE archived_at IS NULL AND enabled = TRUE`);
    // Run observability: which event caused an automatic run (idempotency_key already exists).
    await client.query(`ALTER TABLE ai_workflow_runs ADD COLUMN IF NOT EXISTS event_id TEXT NULL`);
    // Per-tenant automation kill switch (settings service is global-only). Default OFF.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_workflow_tenant_settings (
        tenant_id BIGINT PRIMARY KEY,
        automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        updated_by BIGINT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });
  return schemaReadyPromise;
};

// ---- Secret redaction (used before persisting step input/output) ----
const SECRET_KEY_RE = /(token|secret|api[_-]?key|apikey|authorization|password|passwd|cookie|credential|access[_-]?key|private[_-]?key|jwt|bearer)/i;
const REDACTED = "[redacted]";

export const redactSecrets = (value, depth = 0) => {
  if (depth > 6) return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redactSecrets(val, depth + 1);
    }
    return out;
  }
  return value;
};

// ---- Declarative workflow-definition validation ----
const CONDITION_OPS = new Set(["eq", "neq", "gt", "lt", "gte", "lte", "exists", "not_exists", "truthy", "falsy", "contains"]);

export const validateWorkflowDefinition = (definition) => {
  const errors = [];
  const def = definition && typeof definition === "object" ? definition : null;
  if (!def) return { valid: false, errors: ["definition must be an object"] };

  if (!Number.isInteger(def.version) || def.version < 1) errors.push("definition.version must be a positive integer");
  const nodes = Array.isArray(def.nodes) ? def.nodes : null;
  const edges = Array.isArray(def.edges) ? def.edges : [];
  if (!nodes) return { valid: false, errors: ["definition.nodes must be an array"] };
  if (!Array.isArray(def.edges)) errors.push("definition.edges must be an array");

  const ids = new Set();
  let triggerCount = 0;
  for (const node of nodes) {
    if (!node || typeof node !== "object") { errors.push("each node must be an object"); continue; }
    const id = String(node.id || "");
    if (!id) errors.push("node is missing a stable id");
    if (ids.has(id)) errors.push(`duplicate node id: ${id}`);
    ids.add(id);
    if (!NODE_TYPES.includes(node.type)) { errors.push(`unknown node type "${node.type}" (node ${id})`); continue; }
    const config = node.config && typeof node.config === "object" ? node.config : {};

    if (node.type === "trigger") {
      triggerCount += 1;
      // Phase 4: the trigger's type must be a known, authorable trigger (CHANNEL triggers
      // are "coming later" and cannot be saved as executable). Default to manual.
      const tt = config.triggerType || "manual";
      if (!isKnownTrigger(tt)) errors.push(`node ${id}: unknown trigger type "${tt}"`);
      else if (!isAuthorableTrigger(tt)) errors.push(`node ${id}: trigger "${tt}" is not available yet (coming later)`);
    }

    if (node.type === "tool" || node.type === "action") {
      if (!config.tool) errors.push(`node ${id}: tool node requires config.tool`);
      else if (!isKnownTool(config.tool)) errors.push(`node ${id}: unknown tool "${config.tool}"`);
      else {
        const tool = getTool(config.tool);
        // Unsafe config: cannot downgrade a SENSITIVE tool's approval requirement.
        if (tool.riskLevel === RISK.SENSITIVE && config.requiresApproval === false) {
          errors.push(`node ${id}: SENSITIVE tool "${config.tool}" cannot set requiresApproval=false`);
        }
        if (tool.executable === false && node.type === "action") {
          errors.push(`node ${id}: tool "${config.tool}" is not executable in this phase`);
        }
      }
    }

    if (node.type === "condition") {
      const cond = config.condition;
      if (!cond || typeof cond !== "object") errors.push(`node ${id}: condition node requires config.condition`);
      else {
        if (!cond.left || typeof cond.left !== "string") errors.push(`node ${id}: condition.left must be a context path string`);
        if (!CONDITION_OPS.has(cond.op)) errors.push(`node ${id}: condition.op "${cond.op}" is not supported`);
      }
    }

    if (node.type === "agent") {
      const mode = config.mode || "read_only_analysis";
      if (!["read_only_analysis", "llm_grounded"].includes(mode)) errors.push(`node ${id}: agent mode "${mode}" is not supported`);
    }
  }

  if (triggerCount !== 1) errors.push(`definition must contain exactly one trigger node (found ${triggerCount})`);

  for (const edge of edges) {
    if (!edge || typeof edge !== "object") { errors.push("each edge must be an object"); continue; }
    if (!ids.has(String(edge.from || ""))) errors.push(`edge.from references unknown node "${edge.from}"`);
    if (!ids.has(String(edge.to || ""))) errors.push(`edge.to references unknown node "${edge.to}"`);
    if (edge.when !== undefined && !["true", "false"].includes(String(edge.when))) {
      errors.push(`edge.when must be "true" or "false" when present (edge ${edge.from}->${edge.to})`);
    }
  }

  return { valid: errors.length === 0, errors };
};
