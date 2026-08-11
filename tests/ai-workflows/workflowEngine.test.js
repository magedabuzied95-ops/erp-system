import test from "node:test";
import assert from "node:assert/strict";

import { validateWorkflowDefinition, redactSecrets } from "../../server/services/aiWorkflowSchema.js";
import { isKnownTool, toolRequiresApproval, getTool, RISK } from "../../server/services/aiWorkflowToolRegistry.js";
import { startRunExecution, continueRunAfterApproval, __test } from "../../server/services/aiWorkflowExecutorService.js";

// ---- in-memory store (implements the executor persistence port) ----
function createMemoryStore() {
  const runs = new Map();
  const steps = [];
  const approvals = new Map();
  const workflows = new Map();
  let runSeq = 1;
  let apSeq = 1;
  return {
    _steps: steps, _approvals: approvals, _runs: runs, _workflows: workflows,
    async getWorkflow(id, t) { const w = workflows.get(Number(id)); return w && w.tenant_id === t ? w : null; },
    async createRun(run) { const id = runSeq++; const row = { ...run, id, context: run.context || {} }; runs.set(id, row); return row; },
    async updateRun(id, t, patch) { const r = runs.get(id); if (r && r.tenant_id === t) Object.assign(r, patch); },
    async getRun(id, t) { const r = runs.get(id); return r && r.tenant_id === t ? r : null; },
    async appendStep(s) { steps.push({ ...s, id: steps.length + 1 }); },
    async getSteps(runId, t) { return steps.filter((s) => s.run_id === runId && s.tenant_id === t); },
    async createApproval(a) { const id = apSeq++; const row = { ...a, id }; approvals.set(id, row); return row; },
    async getApproval(id, t) { const a = approvals.get(id); return a && a.tenant_id === t ? a : null; },
    async updateApproval(id, t, patch) { const a = approvals.get(id); if (a && a.tenant_id === t) Object.assign(a, patch); },
  };
}

const TENANT = 7;
let sensitiveCalls = 0;
const fakeTools = {
  "test.read": { id: "test.read", riskLevel: "READ", requiredPermission: "products.view", requiresApproval: false, executable: true, handler: async ({ input }) => ({ echo: input, token: "SECRET-should-be-redacted" }) },
  "test.sensitive": { id: "test.sensitive", riskLevel: "SENSITIVE", requiredPermission: "orders.edit", requiresApproval: true, executable: true, handler: async () => { sensitiveCalls += 1; return { confirmed: true }; } },
};
const fakeDeps = (allow = ["products.view", "orders.edit"]) => ({
  getTool: (id) => fakeTools[id] || null,
  toolRequiresApproval: (id) => fakeTools[id]?.riskLevel === "SENSITIVE" || Boolean(fakeTools[id]?.requiresApproval),
  runAgent: async () => ({ summary: "ok" }),
  hasPermission: async (perm) => allow.includes(perm),
});

const workflow = (nodes, edges) => ({ id: 1, tenant_id: TENANT, version: 1, definition: { version: 1, nodes, edges } });

// ========================= VALIDATION =========================
test("validation: a well-formed definition passes", () => {
  const def = { version: 1, nodes: [{ id: "t", type: "trigger", config: {} }, { id: "s", type: "tool", config: { tool: "products.search" } }, { id: "e", type: "end", config: {} }], edges: [{ from: "t", to: "s" }, { from: "s", to: "e" }] };
  assert.equal(validateWorkflowDefinition(def).valid, true);
});
test("validation: rejects unknown node type", () => {
  const r = validateWorkflowDefinition({ version: 1, nodes: [{ id: "t", type: "trigger" }, { id: "x", type: "wormhole" }], edges: [] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /unknown node type/.test(e)));
});
test("validation: rejects unknown tool", () => {
  const r = validateWorkflowDefinition({ version: 1, nodes: [{ id: "t", type: "trigger" }, { id: "s", type: "tool", config: { tool: "does.not.exist" } }], edges: [] });
  assert.ok(r.errors.some((e) => /unknown tool/.test(e)));
});
test("validation: rejects missing/duplicate trigger", () => {
  assert.ok(validateWorkflowDefinition({ version: 1, nodes: [{ id: "s", type: "end" }], edges: [] }).errors.some((e) => /exactly one trigger/.test(e)));
});
test("validation: rejects invalid edge target", () => {
  const r = validateWorkflowDefinition({ version: 1, nodes: [{ id: "t", type: "trigger" }], edges: [{ from: "t", to: "ghost" }] });
  assert.ok(r.errors.some((e) => /unknown node/.test(e)));
});
test("validation: cannot downgrade SENSITIVE tool approval", () => {
  const r = validateWorkflowDefinition({ version: 1, nodes: [{ id: "t", type: "trigger" }, { id: "c", type: "tool", config: { tool: "orders.confirm", requiresApproval: false } }], edges: [{ from: "t", to: "c" }] });
  assert.ok(r.errors.some((e) => /cannot set requiresApproval=false/.test(e)));
});

// ========================= REGISTRY / ALLOWLIST =========================
test("registry: allowlisting + SENSITIVE always requires approval", () => {
  assert.equal(isKnownTool("products.search"), true);
  assert.equal(isKnownTool("arbitrary.fn"), false);
  assert.equal(toolRequiresApproval("orders.confirm"), true); // SENSITIVE
  assert.equal(toolRequiresApproval("products.search"), false); // READ
  assert.equal(getTool("messaging.send_customer").executable, false); // described-only
  assert.equal(getTool("orders.confirm").riskLevel, RISK.SENSITIVE);
});

// ========================= REDACTION =========================
test("redaction: secret-like keys are removed", () => {
  const red = redactSecrets({ token: "abc", api_key: "x", authorization: "Bearer y", nested: { password: "p", ok: 1 }, keep: "v" });
  assert.equal(red.token, "[redacted]");
  assert.equal(red.api_key, "[redacted]");
  assert.equal(red.authorization, "[redacted]");
  assert.equal(red.nested.password, "[redacted]");
  assert.equal(red.nested.ok, 1);
  assert.equal(red.keep, "v");
});

// ========================= EXECUTOR: READ path =========================
test("executor: READ tool auto-executes to completion and redacts step output", async () => {
  const store = createMemoryStore();
  const wf = workflow(
    [{ id: "t", type: "trigger", config: {} }, { id: "r", type: "tool", config: { tool: "test.read", input: { q: { $from: "trigger.input.query" } } } }, { id: "e", type: "end", config: {} }],
    [{ from: "t", to: "r" }, { from: "r", to: "e" }]
  );
  store._workflows.set(1, wf);
  const run = await store.createRun({ tenant_id: TENANT, workflow_id: 1, workflow_version: 1, trigger: "manual", status: "pending", context: { trigger: { input: { query: "shoes" } }, steps: {} }, started_by: 3 });
  const result = await startRunExecution({ store, deps: fakeDeps(), tenantId: TENANT, workflow: wf, run });
  assert.equal(result.status, "completed");
  const toolStep = store._steps.find((s) => s.node_id === "r");
  assert.equal(toolStep.status, "ok");
  assert.equal(toolStep.output.token, "[redacted]");
  assert.deepEqual(toolStep.output.echo, { q: "shoes" });
});

// ========================= EXECUTOR: condition branching =========================
test("executor: condition routes true/false branches", async () => {
  const store = createMemoryStore();
  const wf = workflow(
    [{ id: "t", type: "trigger" }, { id: "c", type: "condition", config: { condition: { left: "trigger.input.n", op: "gt", right: 5 } } }, { id: "hi", type: "end" }, { id: "lo", type: "end" }],
    [{ from: "t", to: "c" }, { from: "c", to: "hi", when: "true" }, { from: "c", to: "lo", when: "false" }]
  );
  const run = await store.createRun({ tenant_id: TENANT, workflow_id: 1, trigger: "manual", context: { trigger: { input: { n: 9 } }, steps: {} } });
  await startRunExecution({ store, deps: fakeDeps(), tenantId: TENANT, workflow: wf, run });
  const condStep = store._steps.find((s) => s.node_id === "c");
  assert.equal(condStep.output.result, true);
});

// ========================= EXECUTOR: SENSITIVE pause + resume =========================
test("executor: SENSITIVE tool pauses for approval and does NOT execute", async () => {
  sensitiveCalls = 0;
  const store = createMemoryStore();
  const wf = workflow(
    [{ id: "t", type: "trigger" }, { id: "s", type: "action", config: { tool: "test.sensitive" } }, { id: "e", type: "end" }],
    [{ from: "t", to: "s" }, { from: "s", to: "e" }]
  );
  const run = await store.createRun({ tenant_id: TENANT, workflow_id: 1, trigger: "manual", context: { trigger: { input: {} }, steps: {} }, started_by: 3 });
  const result = await startRunExecution({ store, deps: fakeDeps(), tenantId: TENANT, workflow: wf, run });
  assert.equal(result.status, "awaiting_approval");
  assert.equal(sensitiveCalls, 0, "SENSITIVE handler must NOT run before approval");
  assert.equal(store._approvals.size, 1);
  assert.equal([...store._approvals.values()][0].status, "pending");
  assert.equal(run.status, "awaiting_approval");
});

test("executor: resume after approval executes the SENSITIVE tool exactly once", async () => {
  sensitiveCalls = 0;
  const store = createMemoryStore();
  const wf = workflow(
    [{ id: "t", type: "trigger" }, { id: "s", type: "action", config: { tool: "test.sensitive" } }, { id: "e", type: "end" }],
    [{ from: "t", to: "s" }, { from: "s", to: "e" }]
  );
  const run = await store.createRun({ tenant_id: TENANT, workflow_id: 1, trigger: "manual", context: { trigger: { input: {} }, steps: {} }, started_by: 3 });
  await startRunExecution({ store, deps: fakeDeps(), tenantId: TENANT, workflow: wf, run });
  const approval = [...store._approvals.values()][0];
  const result = await continueRunAfterApproval({ store, deps: fakeDeps(), tenantId: TENANT, workflow: wf, run, approval });
  assert.equal(result.status, "completed");
  assert.equal(sensitiveCalls, 1);
});

// ========================= EXECUTOR: RBAC denial =========================
test("executor: tool RBAC denial fails the run without executing", async () => {
  sensitiveCalls = 0;
  const store = createMemoryStore();
  const wf = workflow(
    [{ id: "t", type: "trigger" }, { id: "s", type: "action", config: { tool: "test.sensitive" } }, { id: "e", type: "end" }],
    [{ from: "t", to: "s" }, { from: "s", to: "e" }]
  );
  const run = await store.createRun({ tenant_id: TENANT, workflow_id: 1, trigger: "manual", context: { trigger: { input: {} }, steps: {} } });
  const result = await startRunExecution({ store, deps: fakeDeps([]), tenantId: TENANT, workflow: wf, run });
  assert.equal(result.status, "failed");
  assert.equal(sensitiveCalls, 0);
});

// ========================= TENANT ISOLATION =========================
test("store: getRun enforces tenant boundary", async () => {
  const store = createMemoryStore();
  const run = await store.createRun({ tenant_id: TENANT, workflow_id: 1, trigger: "manual", context: {} });
  assert.ok(await store.getRun(run.id, TENANT));
  assert.equal(await store.getRun(run.id, 999), null);
});

// ========================= helpers =========================
test("helpers: getByPath + condition eval", () => {
  assert.equal(__test.getByPath({ a: { b: [1, 2, 3] } }, "a.b.length"), 3);
  assert.equal(__test.evaluateCondition({ left: "a.b.length", op: "gte", right: 3 }, { a: { b: [1, 2, 3] } }), true);
  assert.equal(__test.nextNodeId({ edges: [{ from: "c", to: "x", when: "true" }, { from: "c", to: "y", when: "false" }] }, "c", "false"), "y");
});
