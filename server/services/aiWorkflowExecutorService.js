// Deterministic AI Workflow executor.
// ---------------------------------------------------------------------------
// Traverses a validated declarative definition, records every step, invokes ONLY
// allowlisted Tool Registry handlers, pauses on required approvals, and resumes safely.
// It never lets an LLM choose which server function to run — the definition + registry
// are the sole source of executable capability.
//
// The executor takes an injectable `store` (persistence port) and `deps` so it can be
// unit-tested with an in-memory store and stubbed adapters.

import { getTool as registryGetTool, toolRequiresApproval as registryToolRequiresApproval } from "./aiWorkflowToolRegistry.js";
import { redactSecrets } from "./aiWorkflowSchema.js";

const MAX_STEPS = 100; // cycle / runaway guard

const getByPath = (root, path) => {
  if (!path || typeof path !== "string") return undefined;
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), root);
};

const resolveInput = (input, context) => {
  if (Array.isArray(input)) return input.map((item) => resolveInput(item, context));
  if (input && typeof input === "object") {
    if (typeof input.$from === "string") return getByPath(context, input.$from);
    const out = {};
    for (const [key, val] of Object.entries(input)) out[key] = resolveInput(val, context);
    return out;
  }
  return input;
};

const evaluateCondition = (condition, context) => {
  const left = getByPath(context, condition.left);
  const right = condition.right;
  switch (condition.op) {
    case "eq": return left === right;
    case "neq": return left !== right;
    case "gt": return Number(left) > Number(right);
    case "lt": return Number(left) < Number(right);
    case "gte": return Number(left) >= Number(right);
    case "lte": return Number(left) <= Number(right);
    case "exists": return left !== undefined && left !== null;
    case "not_exists": return left === undefined || left === null;
    case "truthy": return Boolean(left);
    case "falsy": return !left;
    case "contains":
      if (Array.isArray(left)) return left.includes(right);
      if (typeof left === "string") return left.includes(String(right));
      return false;
    default: return false;
  }
};

const nodeMap = (definition) => new Map((definition.nodes || []).map((n) => [n.id, n]));

const nextNodeId = (definition, nodeId, branch = null) => {
  const edges = (definition.edges || []).filter((e) => e.from === nodeId);
  if (branch !== null) {
    const match = edges.find((e) => String(e.when) === String(branch));
    return match ? match.to : null;
  }
  const plain = edges.find((e) => e.when === undefined) || edges[0];
  return plain ? plain.to : null;
};

// Runs the graph starting at `startNodeId`. Returns { status, pendingNodeId?, error? }.
async function traverse({ store, deps, tenantId, workflow, run, definition, startNodeId, seqStart = 0 }) {
  const getTool = deps.getTool || registryGetTool;
  const toolRequiresApproval = deps.toolRequiresApproval || registryToolRequiresApproval;
  const nodes = nodeMap(definition);
  const context = run.context || { trigger: { input: {} }, steps: {} };
  context.steps = context.steps || {};
  let currentId = startNodeId;
  let seq = seqStart;

  while (currentId) {
    if (seq - seqStart > MAX_STEPS) {
      await store.updateRun(run.id, tenantId, { status: "failed", error: "max steps exceeded", finished_at: new Date().toISOString() });
      return { status: "failed", error: "max steps exceeded" };
    }
    const node = nodes.get(currentId);
    if (!node) break;
    const startedAt = Date.now();
    seq += 1;

    const recordStep = async (patch) => {
      await store.appendStep({
        tenant_id: tenantId,
        run_id: run.id,
        seq,
        node_id: node.id,
        node_type: node.type,
        tool_id: node.config?.tool || null,
        risk_level: patch.risk_level || null,
        status: patch.status,
        input: redactSecrets(patch.input || {}),
        output: redactSecrets(patch.output || {}),
        error: patch.error || null,
        duration_ms: Date.now() - startedAt,
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
      });
    };

    try {
      if (node.type === "trigger") {
        await recordStep({ status: "ok", output: context.trigger?.input || {} });
        currentId = nextNodeId(definition, node.id);
        continue;
      }

      if (node.type === "condition") {
        const result = evaluateCondition(node.config?.condition || {}, context);
        context.steps[node.id] = { result };
        await recordStep({ status: "ok", input: node.config?.condition || {}, output: { result } });
        currentId = nextNodeId(definition, node.id, result ? "true" : "false");
        continue;
      }

      if (node.type === "agent") {
        const output = await deps.runAgent({ tenantId, config: node.config || {}, context });
        context.steps[node.id] = { output };
        await recordStep({ status: "ok", input: { mode: node.config?.mode || "read_only_analysis" }, output });
        currentId = nextNodeId(definition, node.id);
        continue;
      }

      if (node.type === "tool" || node.type === "action" || node.type === "approval") {
        // Approval node with no tool = pure human gate.
        const toolId = node.config?.tool || null;
        const tool = toolId ? getTool(toolId) : null;
        const resolvedInput = resolveInput(node.config?.input || {}, context);

        // RBAC enforced BEFORE anything else.
        if (tool?.requiredPermission) {
          const allowed = await deps.hasPermission(tool.requiredPermission);
          if (!allowed) {
            await recordStep({ status: "failed", risk_level: tool?.riskLevel, input: resolvedInput, error: `permission denied: ${tool.requiredPermission}` });
            await store.updateRun(run.id, tenantId, { status: "failed", error: `permission denied: ${tool.requiredPermission}`, finished_at: new Date().toISOString() });
            return { status: "failed", error: "permission denied" };
          }
        }

        const needsApproval = node.type === "approval" || (toolId && toolRequiresApproval(toolId)) || node.config?.requiresApproval === true;
        const alreadyApproved = run.__approvedNodeId === node.id; // set by resume path

        if (needsApproval && !alreadyApproved) {
          await store.createApproval({
            tenant_id: tenantId,
            workflow_id: workflow.id,
            run_id: run.id,
            node_id: node.id,
            tool_id: toolId,
            risk_level: tool?.riskLevel || (node.type === "approval" ? "SENSITIVE" : null),
            requested_action: tool?.name || node.config?.label || node.type,
            request_context: redactSecrets({ input: resolvedInput, node_type: node.type }),
            status: "pending",
            requested_by: run.started_by || null,
          });
          await recordStep({ status: "awaiting_approval", risk_level: tool?.riskLevel, input: resolvedInput });
          await store.updateRun(run.id, tenantId, { status: "awaiting_approval", pending_node_id: node.id });
          return { status: "awaiting_approval", pendingNodeId: node.id };
        }

        // Execute (either READ auto, approved, or non-approval WRITE if configured off — never SENSITIVE).
        if (!tool) {
          // approval node without a tool: just a gate that has now been approved.
          context.steps[node.id] = { approved: true };
          await recordStep({ status: "ok", output: { approved: true } });
          currentId = nextNodeId(definition, node.id);
          continue;
        }
        if (tool.executable === false || typeof tool.handler !== "function") {
          await recordStep({ status: "failed", risk_level: tool.riskLevel, input: resolvedInput, error: `tool "${toolId}" is not executable in this phase` });
          await store.updateRun(run.id, tenantId, { status: "failed", error: `tool not executable: ${toolId}`, finished_at: new Date().toISOString() });
          return { status: "failed", error: "tool not executable" };
        }
        const output = await tool.handler({ tenantId, input: resolvedInput, actorUserId: run.started_by || null, context });
        context.steps[node.id] = { output };
        await recordStep({ status: "ok", risk_level: tool.riskLevel, input: resolvedInput, output });
        run.__approvedNodeId = null;
        currentId = nextNodeId(definition, node.id);
        continue;
      }

      if (node.type === "end") {
        await recordStep({ status: "ok" });
        currentId = null;
        break;
      }

      // Unknown node type at runtime (should have been rejected by validation).
      await recordStep({ status: "failed", error: `unknown node type: ${node.type}` });
      await store.updateRun(run.id, tenantId, { status: "failed", error: `unknown node type: ${node.type}`, finished_at: new Date().toISOString() });
      return { status: "failed", error: "unknown node type" };
    } catch (error) {
      await recordStep({ status: "failed", error: String(error?.message || error) });
      await store.updateRun(run.id, tenantId, { status: "failed", error: String(error?.message || error), finished_at: new Date().toISOString() });
      return { status: "failed", error: String(error?.message || error) };
    }
    // persist evolving context after each node so a later approval can resume accurately
    await store.updateRun(run.id, tenantId, { context });
  }

  await store.updateRun(run.id, tenantId, { status: "completed", context, pending_node_id: null, finished_at: new Date().toISOString() });
  return { status: "completed" };
}

// Public: start a fresh run from the trigger node.
export async function startRunExecution({ store, deps, tenantId, workflow, run }) {
  const definition = workflow.definition || {};
  const trigger = (definition.nodes || []).find((n) => n.type === "trigger");
  if (!trigger) {
    await store.updateRun(run.id, tenantId, { status: "failed", error: "no trigger node", finished_at: new Date().toISOString() });
    return { status: "failed", error: "no trigger node" };
  }
  await store.updateRun(run.id, tenantId, { status: "running", started_at: new Date().toISOString() });
  return traverse({ store, deps, tenantId, workflow, run, definition, startNodeId: trigger.id });
}

// Public: resume after an approval decision. Executes the approved node, then continues.
export async function continueRunAfterApproval({ store, deps, tenantId, workflow, run, approval }) {
  const definition = workflow.definition || {};
  const seqStart = (await store.getSteps(run.id, tenantId)).length;
  run.__approvedNodeId = approval.node_id; // allow the pending node to execute once
  await store.updateRun(run.id, tenantId, { status: "running", pending_node_id: null });
  return traverse({ store, deps, tenantId, workflow, run, definition, startNodeId: approval.node_id, seqStart });
}

export const __test = { getByPath, resolveInput, evaluateCondition, nextNodeId };
