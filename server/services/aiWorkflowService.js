// AI Workflow service: db-backed persistence store + CRUD + run/approval orchestration.
// Thin orchestration only — the execution layer is the existing ERP/AI services, reached
// through the Tool Registry and the Agent adapter.

import db from "../database/db.js";
import permit from "../middleware/permissionMiddleware.js";
import { getSetting } from "./settingsService.js";
import { ensureAiWorkflowSchema, validateWorkflowDefinition, redactSecrets } from "./aiWorkflowSchema.js";
import { listTools, getTool, RISK } from "./aiWorkflowToolRegistry.js";
import { startRunExecution, continueRunAfterApproval } from "./aiWorkflowExecutorService.js";

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
export const listWorkflows = async (tenantId) => {
  await ensureAiWorkflowSchema();
  const r = await db.query(
    `SELECT w.*,
            (SELECT status FROM ai_workflow_runs r WHERE r.workflow_id = w.id AND r.tenant_id = w.tenant_id ORDER BY r.created_at DESC LIMIT 1) AS last_run_status,
            (SELECT created_at FROM ai_workflow_runs r WHERE r.workflow_id = w.id AND r.tenant_id = w.tenant_id ORDER BY r.created_at DESC LIMIT 1) AS last_run_at
     FROM ai_workflows w WHERE w.tenant_id = $1 ORDER BY w.updated_at DESC`,
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
      triggerTypes: [
        { id: "manual", label: "Manual", available: true, description: "Run on demand from the builder or the Workflows list." },
        { id: "webhook", label: "Channel webhook", available: false, description: "Coming later — production Meta/WhatsApp/Instagram webhooks are not rerouted through workflows." },
        { id: "schedule", label: "Scheduled", available: false, description: "Coming later — no scheduler is wired in this phase." },
      ],
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
