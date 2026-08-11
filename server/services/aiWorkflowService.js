// AI Workflow service: db-backed persistence store + CRUD + run/approval orchestration.
// Thin orchestration only — the execution layer is the existing ERP/AI services, reached
// through the Tool Registry and the Agent adapter.

import db from "../database/db.js";
import permit from "../middleware/permissionMiddleware.js";
import { getSetting } from "./settingsService.js";
import { ensureAiWorkflowSchema, validateWorkflowDefinition, redactSecrets } from "./aiWorkflowSchema.js";
import { listTools, getTool, RISK, isDelegatableTool, listDelegatableTools, automaticDecision } from "./aiWorkflowToolRegistry.js";
import { startRunExecution, continueRunAfterApproval } from "./aiWorkflowExecutorService.js";
import { listTriggers, isGlobalAutomationEnabled } from "./aiWorkflowTriggerRegistry.js";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// ---- db-backed store (implements the executor's persistence port) ----
const dbStore = {
  async getWorkflow(id, tenantId) {
    const r = await db.query(`SELECT * FROM ai_workflows WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
    return r.rows[0] || null;
  },
  async createRun(run) {
    const r = await db.query(
      `INSERT INTO ai_workflow_runs (tenant_id, workflow_id, workflow_version, trigger, status, context, idempotency_key, started_by, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [run.tenant_id, run.workflow_id, run.workflow_version, run.trigger, run.status || "pending", JSON.stringify(run.context || {}), run.idempotency_key || null, run.started_by || null, new Date().toISOString()]
    );
    if (r.rows[0]) return r.rows[0];
    // idempotent hit — return the existing run
    const existing = await db.query(
      `SELECT * FROM ai_workflow_runs WHERE tenant_id = $1 AND workflow_id = $2 AND idempotency_key = $3 LIMIT 1`,
      [run.tenant_id, run.workflow_id, run.idempotency_key]
    );
    return existing.rows[0] || null;
  },
  async updateRun(runId, tenantId, patch) {
    const cols = [];
    const vals = [];
    let i = 1;
    for (const [key, val] of Object.entries(patch)) {
      cols.push(`${key} = $${i++}`);
      vals.push(key === "context" ? JSON.stringify(val || {}) : val);
    }
    cols.push(`updated_at = NOW()`);
    vals.push(runId, tenantId);
    await db.query(`UPDATE ai_workflow_runs SET ${cols.join(", ")} WHERE id = $${i++} AND tenant_id = $${i}`, vals);
  },
  async getRun(runId, tenantId) {
    const r = await db.query(`SELECT * FROM ai_workflow_runs WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [runId, tenantId]);
    return r.rows[0] || null;
  },
  async appendStep(step) {
    await db.query(
      `INSERT INTO ai_workflow_run_steps (tenant_id, run_id, seq, node_id, node_type, tool_id, risk_level, status, input, output, error, duration_ms, started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [step.tenant_id, step.run_id, step.seq, step.node_id, step.node_type, step.tool_id, step.risk_level, step.status, JSON.stringify(step.input || {}), JSON.stringify(step.output || {}), step.error, step.duration_ms, step.started_at, step.finished_at]
    );
  },
  async getSteps(runId, tenantId) {
    const r = await db.query(`SELECT * FROM ai_workflow_run_steps WHERE run_id = $1 AND tenant_id = $2 ORDER BY seq ASC`, [runId, tenantId]);
    return r.rows;
  },
  async createApproval(approval) {
    const r = await db.query(
      `INSERT INTO ai_workflow_approvals (tenant_id, workflow_id, run_id, node_id, tool_id, risk_level, requested_action, request_context, status, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (run_id, node_id) DO UPDATE SET status = 'pending', updated_at = NOW()
       RETURNING *`,
      [approval.tenant_id, approval.workflow_id, approval.run_id, approval.node_id, approval.tool_id, approval.risk_level, approval.requested_action, JSON.stringify(approval.request_context || {}), approval.status || "pending", approval.requested_by || null]
    );
    return r.rows[0];
  },
  async getApproval(approvalId, tenantId) {
    const r = await db.query(`SELECT * FROM ai_workflow_approvals WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [approvalId, tenantId]);
    return r.rows[0] || null;
  },
  async updateApproval(approvalId, tenantId, patch) {
    const cols = [];
    const vals = [];
    let i = 1;
    for (const [key, val] of Object.entries(patch)) {
      cols.push(`${key} = $${i++}`);
      vals.push(key === "request_context" ? JSON.stringify(val || {}) : val);
    }
    cols.push(`updated_at = NOW()`);
    vals.push(approvalId, tenantId);
    await db.query(`UPDATE ai_workflow_approvals SET ${cols.join(", ")} WHERE id = $${i++} AND tenant_id = $${i}`, vals);
  },
};

export { dbStore };

// ---- Agent adapter: reuses existing AI only; safe read-only default ----
export const runAgent = async ({ tenantId, config = {}, context = {} }) => {
  const mode = config.mode || "read_only_analysis";
  if (mode === "read_only_analysis") {
    // Deterministic, side-effect-free summary of prior step outputs. No LLM, no sends.
    const steps = context.steps || {};
    const summaryParts = [];
    for (const [nodeId, value] of Object.entries(steps)) {
      const out = value?.output ?? value?.result ?? value;
      if (out && typeof out === "object") {
        if (Array.isArray(out.products)) summaryParts.push(`${nodeId}: ${out.products.length} product(s)`);
        else summaryParts.push(`${nodeId}: ${Object.keys(out).length} field(s)`);
      } else {
        summaryParts.push(`${nodeId}: ${String(out)}`);
      }
    }
    return { mode, summary: summaryParts.join("; ") || "no prior data", generatedAt: new Date().toISOString() };
  }
  if (mode === "llm_grounded") {
    // Optional: reuse the EXISTING OpenAI gateway (openaiSupportService) + credentials/model.
    // Disabled unless explicitly enabled, to avoid cost/side-effects during Phase 2.
    if (String(process.env.AI_WORKFLOWS_AGENT_LLM || "").toLowerCase() !== "true") {
      return { mode, disabled: true, summary: "LLM agent is disabled (set AI_WORKFLOWS_AGENT_LLM=true to enable)." };
    }
    const { generateSupportAnswer } = await import("./openaiSupportService.js");
    const prompt = String(config.prompt || context?.trigger?.input?.query || "");
    const answer = await generateSupportAnswer({ tenantId, question: prompt, knowledge: "", facts: {} }).catch((e) => ({ error: String(e?.message || e) }));
    return { mode, answer };
  }
  return { mode, error: `unsupported agent mode: ${mode}` };
};

// ---- per-tool RBAC re-check reusing the real permit() middleware ----
export const buildPermissionChecker = (req) => async (permission) => {
  const [moduleName, action] = String(permission || "").split(".");
  if (!moduleName || !action) return false;
  return new Promise((resolve) => {
    const mw = permit(moduleName, action);
    const fakeRes = { status: () => fakeRes, json: () => resolve(false), send: () => resolve(false) };
    Promise.resolve(mw(req, fakeRes, () => resolve(true))).catch(() => resolve(false));
  });
};

export const buildDeps = (req) => ({ runAgent, hasPermission: buildPermissionChecker(req) });

// ---- reply-mode (existing policy) — surfaced for observability; never a competing policy ----
export const getAiReplyMode = async () => {
  try {
    return await getSetting("ai_channels.ai_reply_mode", "suggest_only");
  } catch {
    return "suggest_only";
  }
};

// ---- CRUD ----
// Archived workflows are hidden by default (never auto-run, kept for history/audit).
export const listWorkflows = async (tenantId, { includeArchived = false } = {}) => {
  await ensureAiWorkflowSchema();
  const where = includeArchived ? `w.tenant_id = $1` : `w.tenant_id = $1 AND w.archived_at IS NULL`;
  const r = await db.query(
    `SELECT w.*,
            (SELECT status FROM ai_workflow_runs r WHERE r.workflow_id = w.id AND r.tenant_id = w.tenant_id ORDER BY r.created_at DESC LIMIT 1) AS last_run_status,
            (SELECT created_at FROM ai_workflow_runs r WHERE r.workflow_id = w.id AND r.tenant_id = w.tenant_id ORDER BY r.created_at DESC LIMIT 1) AS last_run_at,
            (SELECT created_at FROM ai_workflow_runs r WHERE r.workflow_id = w.id AND r.tenant_id = w.tenant_id AND r.trigger <> 'manual' ORDER BY r.created_at DESC LIMIT 1) AS last_auto_run_at,
            (SELECT status FROM ai_workflow_runs r WHERE r.workflow_id = w.id AND r.tenant_id = w.tenant_id AND r.trigger <> 'manual' ORDER BY r.created_at DESC LIMIT 1) AS last_auto_run_status
     FROM ai_workflows w WHERE ${where} ORDER BY w.updated_at DESC`,
    [tenantId]
  );
  return r.rows;
};

export const getWorkflow = async (tenantId, id) => {
  await ensureAiWorkflowSchema();
  return dbStore.getWorkflow(id, tenantId);
};

export const createWorkflow = async (tenantId, { name, description, triggerType, definition, enabled }, userId) => {
  await ensureAiWorkflowSchema();
  const validation = validateWorkflowDefinition(definition);
  if (!validation.valid) {
    const err = new Error("Invalid workflow definition");
    err.status = 400;
    err.details = validation.errors;
    throw err;
  }
  const r = await db.query(
    `INSERT INTO ai_workflows (tenant_id, name, description, enabled, trigger_type, definition, version, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
    [tenantId, String(name || "Untitled workflow"), String(description || ""), Boolean(enabled), String(triggerType || "manual"), JSON.stringify(definition), Number(definition.version || 1), num(userId)]
  );
  return r.rows[0];
};

export const updateWorkflow = async (tenantId, id, patch, userId) => {
  await ensureAiWorkflowSchema();
  const existing = await dbStore.getWorkflow(id, tenantId);
  if (!existing) { const e = new Error("Workflow not found"); e.status = 404; throw e; }
  let definition = existing.definition;
  let version = existing.version;
  if (patch.definition !== undefined) {
    const validation = validateWorkflowDefinition(patch.definition);
    if (!validation.valid) { const e = new Error("Invalid workflow definition"); e.status = 400; e.details = validation.errors; throw e; }
    definition = patch.definition;
    version = Number(patch.definition.version || existing.version + 1);
  }
  const r = await db.query(
    `UPDATE ai_workflows SET name = $1, description = $2, enabled = $3, trigger_type = $4, definition = $5, version = $6, updated_by = $7, updated_at = NOW()
     WHERE id = $8 AND tenant_id = $9 RETURNING *`,
    [
      patch.name !== undefined ? String(patch.name) : existing.name,
      patch.description !== undefined ? String(patch.description) : existing.description,
      patch.enabled !== undefined ? Boolean(patch.enabled) : existing.enabled,
      patch.triggerType !== undefined ? String(patch.triggerType) : existing.trigger_type,
      JSON.stringify(definition),
      version,
      num(userId),
      id,
      tenantId,
    ]
  );
  return r.rows[0];
};

export const setWorkflowEnabled = async (tenantId, id, enabled, userId) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(
    `UPDATE ai_workflows SET enabled = $1, updated_by = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4 RETURNING *`,
    [Boolean(enabled), num(userId), id, tenantId]
  );
  if (!r.rows[0]) { const e = new Error("Workflow not found"); e.status = 404; throw e; }
  return r.rows[0];
};

export const validateDefinition = (definition) => validateWorkflowDefinition(definition);

// ---- Runs ----
export const runWorkflowManually = async (tenantId, workflowId, { input = {}, userId, req, idempotencyKey } = {}) => {
  await ensureAiWorkflowSchema();
  const workflow = await dbStore.getWorkflow(workflowId, tenantId);
  if (!workflow) { const e = new Error("Workflow not found"); e.status = 404; throw e; }
  const run = await dbStore.createRun({
    tenant_id: tenantId,
    workflow_id: workflow.id,
    workflow_version: workflow.version,
    trigger: "manual",
    status: "pending",
    context: { trigger: { input: redactSecrets(input) }, steps: {} },
    idempotency_key: idempotencyKey || null,
    started_by: num(userId),
  });
  if (!run) { const e = new Error("Could not create run"); e.status = 409; throw e; }
  // If idempotent hit returned an already-finished run, do not re-execute.
  if (["running", "completed", "failed", "awaiting_approval", "rejected", "cancelled"].includes(run.status) && run.started_at) {
    return { run, result: { status: run.status, idempotentReuse: true } };
  }
  const deps = buildDeps(req);
  const result = await startRunExecution({ store: dbStore, deps, tenantId, workflow, run });
  const finalRun = await dbStore.getRun(run.id, tenantId);
  return { run: finalRun, result };
};

export const listRuns = async (tenantId, { workflowId = null, limit = 50 } = {}) => {
  await ensureAiWorkflowSchema();
  const params = [tenantId];
  let where = `tenant_id = $1`;
  if (workflowId) { params.push(workflowId); where += ` AND workflow_id = $${params.length}`; }
  params.push(Math.min(Number(limit) || 50, 200));
  const r = await db.query(
    `SELECT r.*, w.name AS workflow_name FROM ai_workflow_runs r LEFT JOIN ai_workflows w ON w.id = r.workflow_id AND w.tenant_id = r.tenant_id
     WHERE r.${where} ORDER BY r.created_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows;
};

export const getRunWithSteps = async (tenantId, runId) => {
  await ensureAiWorkflowSchema();
  const run = await dbStore.getRun(runId, tenantId);
  if (!run) return null;
  const steps = await dbStore.getSteps(runId, tenantId);
  return { run, steps };
};

// ---- Approvals ----
export const listApprovals = async (tenantId, { status = "pending", limit = 100 } = {}) => {
  await ensureAiWorkflowSchema();
  const params = [tenantId];
  let where = `a.tenant_id = $1`;
  if (status && status !== "all") { params.push(status); where += ` AND a.status = $${params.length}`; }
  params.push(Math.min(Number(limit) || 100, 300));
  const r = await db.query(
    `SELECT a.*, w.name AS workflow_name FROM ai_workflow_approvals a LEFT JOIN ai_workflows w ON w.id = a.workflow_id AND w.tenant_id = a.tenant_id
     WHERE ${where} ORDER BY a.created_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows;
};

export const decideApproval = async (tenantId, approvalId, { decision, userId, req, note = "" } = {}) => {
  await ensureAiWorkflowSchema();
  const approval = await dbStore.getApproval(approvalId, tenantId);
  if (!approval) { const e = new Error("Approval not found"); e.status = 404; throw e; }
  if (approval.status !== "pending") { const e = new Error(`Approval already ${approval.status}`); e.status = 409; throw e; }

  if (decision === "reject") {
    await dbStore.updateApproval(approvalId, tenantId, { status: "rejected", decided_by: num(userId), decided_at: new Date().toISOString(), decision_note: String(note || "") });
    await dbStore.updateRun(approval.run_id, tenantId, { status: "rejected", error: "rejected by approver", finished_at: new Date().toISOString() });
    return { status: "rejected" };
  }

  // Approve: re-check permission for the tool BEFORE executing (approval never bypasses RBAC).
  const tool = approval.tool_id ? getTool(approval.tool_id) : null;
  if (tool?.requiredPermission) {
    const allowed = await buildPermissionChecker(req)(tool.requiredPermission);
    if (!allowed) { const e = new Error(`Approver lacks permission: ${tool.requiredPermission}`); e.status = 403; throw e; }
  }
  await dbStore.updateApproval(approvalId, tenantId, { status: "approved", decided_by: num(userId), decided_at: new Date().toISOString(), decision_note: String(note || "") });

  const workflow = await dbStore.getWorkflow(approval.workflow_id, tenantId);
  const run = await dbStore.getRun(approval.run_id, tenantId);
  if (!workflow || !run) { const e = new Error("Run or workflow missing"); e.status = 404; throw e; }
  const deps = buildDeps(req);
  const result = await continueRunAfterApproval({ store: dbStore, deps, tenantId, workflow, run, approval });
  return { status: "approved", result };
};

// ---- Tools (read-only registry view) ----
// `capabilities` lets the visual builder render an ACCURATE palette/config instead of
// guessing: it reflects the same server-side gates the executor enforces (agent LLM mode
// gated by env; only `manual` triggers are wired in this phase). Additive/read-only.
export const getToolRegistryView = () => {
  const tools = listTools();
  const llmEnabled = String(process.env.AI_WORKFLOWS_AGENT_LLM || "").toLowerCase() === "true";
  return {
    tools,
    grouped: {
      READ: tools.filter((t) => t.riskLevel === RISK.READ),
      WRITE: tools.filter((t) => t.riskLevel === RISK.WRITE),
      SENSITIVE: tools.filter((t) => t.riskLevel === RISK.SENSITIVE),
    },
    capabilities: {
      agentModes: [
        { id: "read_only_analysis", label: "Read-only analysis", available: true, description: "Deterministic, side-effect-free summary of prior step outputs. No LLM." },
        { id: "llm_grounded", label: "LLM grounded", available: llmEnabled, description: llmEnabled ? "Reuses the existing OpenAI gateway." : "Disabled on this server (set AI_WORKFLOWS_AGENT_LLM=true to enable)." },
      ],
      // Dynamic from the Trigger Registry (Phase 4) — the server is the source of truth
      // for which triggers exist and are available; the browser never decides this.
      triggerTypes: listTriggers().map((t) => ({
        id: t.id, label: t.name, available: t.available, category: t.category,
        description: t.description, riskLevel: t.riskLevel, configSchema: t.configSchema,
      })),
    },
  };
};

// ---- Seed: one safe READ-only proof workflow for the CURRENT tenant (disabled) ----
export const seedExampleWorkflow = async (tenantId, userId) => {
  await ensureAiWorkflowSchema();
  const existing = await db.query(`SELECT id FROM ai_workflows WHERE tenant_id = $1 AND name = $2 LIMIT 1`, [tenantId, "Example: Product lookup (read-only)"]);
  if (existing.rows[0]) return dbStore.getWorkflow(existing.rows[0].id, tenantId);
  const definition = {
    version: 1,
    nodes: [
      { id: "trigger", type: "trigger", config: { triggerType: "manual" } },
      { id: "search", type: "tool", config: { tool: "products.search", input: { query: { $from: "trigger.input.query" } } } },
      { id: "has_results", type: "condition", config: { condition: { left: "steps.search.output.products.length", op: "gt", right: 0 } } },
      { id: "analyze", type: "agent", config: { mode: "read_only_analysis" } },
      { id: "end_found", type: "end", config: {} },
      { id: "end_none", type: "end", config: {} },
    ],
    edges: [
      { from: "trigger", to: "search" },
      { from: "search", to: "has_results" },
      { from: "has_results", to: "analyze", when: "true" },
      { from: "has_results", to: "end_none", when: "false" },
      { from: "analyze", to: "end_found" },
    ],
  };
  return createWorkflow(tenantId, { name: "Example: Product lookup (read-only)", description: "Manual trigger → search products → condition → read-only analysis. READ-only, safe, disabled by default.", triggerType: "manual", definition, enabled: false }, userId);
};

// ---- Phase 6: Restock Customer Recovery template (disabled; current tenant only) ----
// inventory.restocked → check stock → find waiting customers → condition → analysis →
// create internal recovery follow-ups (WRITE, grant-required). Never messages customers.
export const RESTOCK_RECOVERY_NAME = "Restock Customer Recovery";
export const seedRestockRecoveryWorkflow = async (tenantId, userId) => {
  await ensureAiWorkflowSchema();
  const existing = await db.query(`SELECT id FROM ai_workflows WHERE tenant_id = $1 AND name = $2 AND archived_at IS NULL LIMIT 1`, [tenantId, RESTOCK_RECOVERY_NAME]);
  if (existing.rows[0]) return dbStore.getWorkflow(existing.rows[0].id, tenantId);
  const definition = {
    version: 1,
    nodes: [
      { id: "trigger", type: "trigger", config: { triggerType: "inventory.restocked" } },
      { id: "stock", type: "tool", config: { tool: "inventory.check_stock", input: { productId: { $from: "trigger.input.productId" }, variantId: { $from: "trigger.input.variantId" } } } },
      { id: "waiting", type: "tool", config: { tool: "restock.waiting_customers", input: { productId: { $from: "trigger.input.productId" } } } },
      { id: "has_waiting", type: "condition", config: { condition: { left: "steps.waiting.output.matchedCount", op: "gt", right: 0 } } },
      { id: "analyze", type: "agent", config: { mode: "read_only_analysis" } },
      { id: "recover", type: "action", config: { tool: "restock.recover" } },
      { id: "end_done", type: "end", config: {} },
      { id: "end_none", type: "end", config: {} },
    ],
    edges: [
      { from: "trigger", to: "stock" },
      { from: "stock", to: "waiting" },
      { from: "waiting", to: "has_waiting" },
      { from: "has_waiting", to: "analyze", when: "true" },
      { from: "has_waiting", to: "end_none", when: "false" },
      { from: "analyze", to: "recover" },
      { from: "recover", to: "end_done" },
    ],
  };
  return createWorkflow(tenantId, {
    name: RESTOCK_RECOVERY_NAME,
    description: "Inventory restocked → find waiting customers → create INTERNAL sales follow-ups. Requires enabling + automation + a grant for restock.recover. Never messages customers. Disabled by default.",
    triggerType: "inventory.restocked", definition, enabled: false,
  }, userId);
};

// ===========================================================================
// Phase 4 — automation: archive, tenant kill switch, status, system actor,
// and idempotent automatic-run creation. (Event matching/emission lives in
// aiWorkflowTriggerService.js; this file owns persistence + the executor call.)
// ===========================================================================

// ---- Archive / soft-delete (never hard-delete; runs/history are retained) ----
export const archiveWorkflow = async (tenantId, id, userId) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(
    `UPDATE ai_workflows SET archived_at = NOW(), archived_by = $1, enabled = FALSE, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3 AND archived_at IS NULL RETURNING *`,
    [num(userId), id, tenantId]
  );
  if (!r.rows[0]) { const e = new Error("Workflow not found or already archived"); e.status = 404; throw e; }
  return r.rows[0];
};

export const unarchiveWorkflow = async (tenantId, id, userId) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(
    `UPDATE ai_workflows SET archived_at = NULL, archived_by = NULL, updated_by = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3 RETURNING *`,
    [num(userId), id, tenantId]
  );
  if (!r.rows[0]) { const e = new Error("Workflow not found"); e.status = 404; throw e; }
  return r.rows[0]; // stays disabled until an authorized user re-enables it
};

// ---- Tenant automation kill switch (default OFF; existing tenants never auto-enabled) ----
export const getTenantAutomation = async (tenantId) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(`SELECT automation_enabled FROM ai_workflow_tenant_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  return Boolean(r.rows[0]?.automation_enabled);
};

export const setTenantAutomation = async (tenantId, enabled, userId) => {
  await ensureAiWorkflowSchema();
  await db.query(
    `INSERT INTO ai_workflow_tenant_settings (tenant_id, automation_enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET automation_enabled = EXCLUDED.automation_enabled, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [tenantId, Boolean(enabled), num(userId)]
  );
  return Boolean(enabled);
};

// ---- Automation status resolver (explains exactly why automation is/ isn't live) ----
export const getAutomationStatus = async (tenantId) => {
  await ensureAiWorkflowSchema();
  const globalOn = isGlobalAutomationEnabled();
  const tenantOn = await getTenantAutomation(tenantId);
  const active = globalOn && tenantOn;
  const counts = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE enabled = TRUE AND archived_at IS NULL AND trigger_type <> 'manual') AS active_auto_workflows,
        COUNT(*) FILTER (WHERE enabled = TRUE AND archived_at IS NULL) AS enabled_workflows
     FROM ai_workflows WHERE tenant_id = $1`,
    [tenantId]
  );
  const reasons = [];
  if (!globalOn) reasons.push("Global automation is disabled (AI_WORKFLOWS_AUTOMATION_ENABLED).");
  if (!tenantOn) reasons.push("Tenant automation is turned off.");
  return {
    active,
    global_enabled: globalOn,
    tenant_enabled: tenantOn,
    active_auto_workflows: Number(counts.rows[0]?.active_auto_workflows || 0),
    enabled_workflows: Number(counts.rows[0]?.enabled_workflows || 0),
    timezone: await getTenantTimezone(tenantId),
    reasons,
  };
};

// ---- READ-only system actor for AUTOMATIC runs (no logged-in user) ----
// SECURITY: automatic runs get NO superuser. They may only use READ tools. WRITE/SENSITIVE
// permissions are denied, so an automatic run that reaches such a node fails safely at RBAC
// and can never execute it (SENSITIVE therefore cannot be auto-run). WRITE authorization for
// automatic runs is deferred to Phase 5 (needs a proper delegated-actor model).
export const AUTOMATIC_READ_PERMISSIONS = Object.freeze(["products.view", "orders.view", "settings.view", "inventory.view"]);
const systemPermissionSet = new Set(AUTOMATIC_READ_PERMISSIONS);
export const systemPermissionChecker = async (permission) => systemPermissionSet.has(String(permission || ""));
export const buildSystemDeps = () => ({ runAgent, hasPermission: systemPermissionChecker });

// ---- Idempotent automatic-run creation for a single matched workflow ----
// Uses the EXISTING unique index on (tenant_id, workflow_id, idempotency_key). A fresh
// INSERT returns a row → we execute it; a conflict returns no row → it is a duplicate and
// is NOT re-executed (safe across restarts and concurrent emits). Event data is placed under
// context.trigger.input so downstream nodes reference it with the existing `$from` syntax.
export const runEventForWorkflow = async ({ tenantId, workflow, triggerType, eventId, occurredAt, eventData = {} }) => {
  await ensureAiWorkflowSchema();
  const idempotencyKey = `evt:${triggerType}:${eventId}`;
  const context = {
    trigger: {
      input: redactSecrets(eventData),
      event: { id: String(eventId), type: triggerType, occurredAt: occurredAt || new Date().toISOString(), source: "automatic" },
    },
    steps: {},
  };
  const inserted = await db.query(
    `INSERT INTO ai_workflow_runs (tenant_id, workflow_id, workflow_version, trigger, status, context, idempotency_key, event_id, started_by, started_at)
     VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,NULL,NOW())
     ON CONFLICT (tenant_id, workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [tenantId, workflow.id, workflow.version, triggerType, JSON.stringify(context), idempotencyKey, String(eventId)]
  );
  if (!inserted.rows[0]) return { duplicate: true, workflowId: workflow.id };
  const run = inserted.rows[0];
  const result = await startRunExecution({ store: dbStore, deps: buildDelegatedDeps({ tenantId, workflow }), tenantId, workflow, run });
  return { duplicate: false, workflowId: workflow.id, runId: run.id, status: result.status, result };
};

// ---- Resolve enabled, non-archived workflows for a trigger type (matching happens in the adapter) ----
export const listAutomaticWorkflowsForTrigger = async (tenantId, triggerType) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(
    `SELECT * FROM ai_workflows WHERE tenant_id = $1 AND enabled = TRUE AND archived_at IS NULL AND trigger_type = $2`,
    [tenantId, triggerType]
  );
  return r.rows;
};

// ---- Enumerate tenants with automation enabled (for the scheduler tick) ----
export const listAutomationEnabledTenantIds = async () => {
  await ensureAiWorkflowSchema();
  if (!isGlobalAutomationEnabled()) return [];
  const r = await db.query(`SELECT tenant_id FROM ai_workflow_tenant_settings WHERE automation_enabled = TRUE`);
  return r.rows.map((x) => Number(x.tenant_id));
};

// ===========================================================================
// Phase 5 — delegated WRITE authorization, write-op idempotency, timezone, audit.
// ===========================================================================

// Canonical audit row (matches the repo's direct-INSERT convention). Never throws.
export const writeAudit = async ({ tenantId, userId = null, action, entityType, entityId = null, details = {} }) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [tenantId, num(userId), String(action), String(entityType), entityId != null ? Number(entityId) : null, JSON.stringify(redactSecrets(details || {}))]
    );
  } catch { /* audit failure must never break the operation */ }
};

// ---- Grants (per-workflow delegated WRITE authorization) ----
export const listGrants = async (tenantId, workflowId, { includeRevoked = false } = {}) => {
  await ensureAiWorkflowSchema();
  const where = includeRevoked ? `tenant_id = $1 AND workflow_id = $2` : `tenant_id = $1 AND workflow_id = $2 AND revoked_at IS NULL`;
  const r = await db.query(`SELECT * FROM ai_workflow_grants WHERE ${where} ORDER BY granted_at DESC`, [tenantId, workflowId]);
  return r.rows;
};

export const hasActiveGrant = async (tenantId, workflowId, toolId) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(`SELECT id FROM ai_workflow_grants WHERE tenant_id = $1 AND workflow_id = $2 AND tool_id = $3 AND revoked_at IS NULL LIMIT 1`, [tenantId, workflowId, toolId]);
  return r.rows[0]?.id || null;
};

export const grantTool = async (tenantId, workflowId, toolId, { userId, req } = {}) => {
  await ensureAiWorkflowSchema();
  const tool = getTool(toolId);
  if (!tool) { const e = new Error(`Unknown tool: ${toolId}`); e.status = 400; throw e; }
  // A grant can ONLY target a DELEGATABLE tool — never SENSITIVE, never READ, never described-only.
  if (!isDelegatableTool(toolId)) { const e = new Error(`Tool "${toolId}" cannot be delegated for automatic execution`); e.status = 400; throw e; }
  const wf = await dbStore.getWorkflow(workflowId, tenantId);
  if (!wf) { const e = new Error("Workflow not found"); e.status = 404; throw e; }
  // Granter must also hold the tool's own business permission (defence in depth beyond settings.edit).
  if (req && tool.requiredPermission) {
    const ok = await buildPermissionChecker(req)(tool.requiredPermission);
    if (!ok) { const e = new Error(`You lack the permission required to grant this tool: ${tool.requiredPermission}`); e.status = 403; throw e; }
  }
  const r = await db.query(
    `INSERT INTO ai_workflow_grants (tenant_id, workflow_id, tool_id, granted_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, workflow_id, tool_id) WHERE revoked_at IS NULL DO NOTHING
     RETURNING *`,
    [tenantId, workflowId, toolId, num(userId)]
  );
  const grant = r.rows[0] || (await db.query(`SELECT * FROM ai_workflow_grants WHERE tenant_id=$1 AND workflow_id=$2 AND tool_id=$3 AND revoked_at IS NULL LIMIT 1`, [tenantId, workflowId, toolId])).rows[0];
  await writeAudit({ tenantId, userId, action: "ai_workflow.grant", entityType: "ai_workflow", entityId: workflowId, details: { tool_id: toolId, grant_id: grant?.id } });
  return grant;
};

export const revokeGrant = async (tenantId, workflowId, toolId, { userId } = {}) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(
    `UPDATE ai_workflow_grants SET revoked_at = NOW(), revoked_by = $1, updated_at = NOW()
     WHERE tenant_id = $2 AND workflow_id = $3 AND tool_id = $4 AND revoked_at IS NULL RETURNING *`,
    [num(userId), tenantId, workflowId, toolId]
  );
  if (r.rows[0]) await writeAudit({ tenantId, userId, action: "ai_workflow.revoke", entityType: "ai_workflow", entityId: workflowId, details: { tool_id: toolId, grant_id: r.rows[0].id } });
  return r.rows[0] || null;
};

// ---- Write-op reservation (idempotency for side-effecting steps; DB-enforced) ----
export const reserveWriteOp = async ({ tenantId, runId, nodeId, toolId, key }) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(
    `INSERT INTO ai_workflow_write_ops (tenant_id, run_id, node_id, tool_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`,
    [tenantId, runId, nodeId, toolId || null, key]
  );
  if (r.rows[0]) return { created: true };
  const existing = await db.query(`SELECT result_ref FROM ai_workflow_write_ops WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`, [tenantId, key]);
  return { created: false, resultRef: existing.rows[0]?.result_ref || null };
};

// ---- Delegated automatic actor (replaces Phase 4's blanket READ-only checker) ----
// READ -> auto; DELEGATABLE WRITE -> only with an active grant; SENSITIVE/DENIED -> refused
// (SENSITIVE can never be auto-run; it fails safely here and never bypasses approval).
export const buildDelegatedDeps = ({ tenantId, workflow }) => ({
  runAgent,
  authorizeTool: async ({ tool }) => {
    // Resolve the active grant only for delegatable tools; the decision itself is pure.
    const grantId = isDelegatableTool(tool.id) ? await hasActiveGrant(tenantId, workflow.id, tool.id) : null;
    const decision = automaticDecision(tool.id, Boolean(grantId));
    return decision.allow ? { allow: true, grantId } : { allow: false, reason: decision.reason };
  },
  reserveWriteOp,
  onWriteExecuted: async ({ run, node, tool, grantId, output }) =>
    writeAudit({ tenantId, userId: null, action: "ai_workflow.auto_write", entityType: "ai_workflow_run", entityId: run.id, details: { workflow_id: workflow.id, node_id: node.id, tool_id: tool.id, grant_id: grantId, event_id: run.event_id, result_ref: output?.taskId ?? null } }),
});

// ---- Delegatable tools view (for the grant UI) ----
export const listDelegatableToolsView = () => listDelegatableTools();

// ---- Tenant timezone (per-tenant IANA; resolved tenant -> env -> Africa/Cairo) ----
export const DEFAULT_TIMEZONE = String(process.env.APP_TIMEZONE || process.env.TZ || "Africa/Cairo").trim() || "Africa/Cairo";

export const isValidTimezone = (tz) => {
  if (!tz || typeof tz !== "string") return false;
  // IANA identifiers only — reject raw UTC offsets (e.g. "+03:00") because DST rules can change.
  if (tz.includes(":") || /^[+-]?\d/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};

export const getTenantTimezone = async (tenantId) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(`SELECT timezone FROM ai_workflow_tenant_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  const tz = r.rows[0]?.timezone;
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
};

export const setTenantTimezone = async (tenantId, timezone, userId) => {
  await ensureAiWorkflowSchema();
  if (!isValidTimezone(timezone)) { const e = new Error(`Invalid IANA timezone: ${timezone}`); e.status = 400; throw e; }
  await db.query(
    `INSERT INTO ai_workflow_tenant_settings (tenant_id, timezone, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET timezone = EXCLUDED.timezone, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [tenantId, timezone, num(userId)]
  );
  return timezone;
};
