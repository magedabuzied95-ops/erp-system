// AI Studio Phase 5 — delegated WRITE authorization, write-op idempotency, timezone schedules,
// multi-variant restock. Pure/injected-dep tests (no DB), mirroring earlier phases.

import test from "node:test";
import assert from "node:assert/strict";

process.env.AI_WORKFLOWS_AUTOMATION_ENABLED = "true";

const {
  toolAutomaticPolicy, isDelegatableTool, listDelegatableTools, automaticDecision, AUTO_POLICY,
} = await import("../../server/services/aiWorkflowToolRegistry.js");
const { computeScheduleSlot, wallClockParts, shouldEmitRestock } = await import("../../server/services/aiWorkflowTriggerService.js");
const { isValidTimezone } = await import("../../server/services/aiWorkflowService.js");
const executor = await import("../../server/services/aiWorkflowExecutorService.js");

// ---- Tool policy ----
test("automatic-execution policy: READ=AUTO, followups.create=DELEGATABLE, SENSITIVE=APPROVAL_REQUIRED", () => {
  assert.equal(toolAutomaticPolicy("products.search"), AUTO_POLICY.AUTO);
  assert.equal(toolAutomaticPolicy("followups.create"), AUTO_POLICY.DELEGATABLE);
  assert.equal(toolAutomaticPolicy("orders.confirm"), AUTO_POLICY.APPROVAL_REQUIRED);
  assert.equal(toolAutomaticPolicy("orders.update_status"), AUTO_POLICY.APPROVAL_REQUIRED);
  assert.equal(toolAutomaticPolicy("messaging.send_customer"), AUTO_POLICY.APPROVAL_REQUIRED);
});

test("only vetted low-risk WRITE tools are delegatable; SENSITIVE/READ are not", () => {
  assert.equal(isDelegatableTool("followups.create"), true);
  assert.equal(isDelegatableTool("orders.confirm"), false);      // SENSITIVE
  assert.equal(isDelegatableTool("messaging.send_customer"), false); // SENSITIVE
  assert.equal(isDelegatableTool("products.search"), false);     // READ
  assert.equal(isDelegatableTool("leads.create_opportunity"), false); // WRITE described-only, not opted-in
  const delegatable = listDelegatableTools().map((t) => t.id);
  assert.ok(delegatable.includes("followups.create"));
  assert.equal(delegatable.includes("orders.confirm"), false); // SENSITIVE never delegatable
  assert.equal(delegatable.includes("products.search"), false); // READ never needs delegation
});

// ---- Authorization decision (pure) ----
test("READ needs no grant; DELEGATABLE needs a grant; SENSITIVE denied even 'with a grant'", () => {
  assert.deepEqual(automaticDecision("products.search", false), { allow: true, policy: AUTO_POLICY.AUTO });
  assert.equal(automaticDecision("followups.create", false).allow, false); // no grant
  assert.equal(automaticDecision("followups.create", true).allow, true);   // granted
  // SENSITIVE can never be delegated — a truthy "grant" must NOT allow it
  assert.equal(automaticDecision("orders.confirm", true).allow, false);
  assert.match(automaticDecision("orders.confirm", true).reason, /approval/i);
  assert.equal(automaticDecision("unknown.tool", true).allow, false);
});

// ---- Timezone ----
test("isValidTimezone accepts IANA, rejects garbage and offsets", () => {
  assert.equal(isValidTimezone("Africa/Cairo"), true);
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("+03:00"), false);
  assert.equal(isValidTimezone("Not/AZone"), false);
  assert.equal(isValidTimezone(""), false);
});

test("wallClockParts reflects the timezone (same instant, different local hour)", () => {
  const instant = new Date("2026-08-11T23:30:00Z"); // 23:30 UTC
  const cairo = wallClockParts(instant, "Africa/Cairo");   // UTC+3 (no DST in Egypt 2026 baseline) -> 02:30 next day
  const utc = wallClockParts(instant, "UTC");
  assert.equal(utc.hh, "23");
  // Cairo is ahead of UTC -> different local day/hour
  assert.notEqual(cairo.hh, utc.hh);
});

test("daily schedule slot is tz-local, due only after target, and stable per local day", () => {
  const instant = new Date("2026-08-11T06:30:00Z"); // 09:30 in Cairo (UTC+3)
  const before = computeScheduleSlot({ frequency: "daily", time: "10:00" }, instant, "Africa/Cairo"); // 09:30 < 10:00
  assert.equal(before.due, false);
  const after = computeScheduleSlot({ frequency: "daily", time: "09:00" }, instant, "Africa/Cairo");   // 09:30 >= 09:00
  assert.equal(after.due, true);
  assert.equal(after.slotId, "2026-08-11T09:00");
  // Later same local day -> identical slot id (idempotency = one run/day)
  const later = computeScheduleSlot({ frequency: "daily", time: "09:00" }, new Date("2026-08-11T15:00:00Z"), "Africa/Cairo");
  assert.equal(later.slotId, after.slotId);
});

test("hourly schedule slot id is the tz-local hour and always due", () => {
  const s = computeScheduleSlot({ frequency: "hourly" }, new Date("2026-08-11T06:34:00Z"), "Africa/Cairo"); // 09:34 Cairo
  assert.equal(s.due, true);
  assert.equal(s.slotId, "2026-08-11T09:00");
});

test("day-boundary: an instant that is a different day in another tz gets that tz's date", () => {
  const instant = new Date("2026-08-11T22:30:00Z"); // 01:30 next day in Cairo
  const s = computeScheduleSlot({ frequency: "hourly" }, instant, "Africa/Cairo");
  assert.equal(s.slotId, "2026-08-12T01:00");
});

// ---- Multi-variant restock filtering ----
test("multi-variant purchase: only <=0 -> >0 crossings qualify", () => {
  const movements = [
    { variant_id: "A", quantity_before: 0, quantity_after: 5 },   // crossing
    { variant_id: "B", quantity_before: 3, quantity_after: 8 },   // already in stock -> no
    { variant_id: "C", quantity_before: -1, quantity_after: 4 },  // crossing
  ];
  const restocked = movements.filter(shouldEmitRestock).map((m) => m.variant_id);
  assert.deepEqual(restocked, ["A", "C"]);
});

// ---- Executor: delegated authorization + write-op idempotency (in-memory) ----
function makeStore() {
  const steps = []; const runs = {}; const writeOps = new Set();
  return {
    steps, writeOps,
    async updateRun(id, t, patch) { runs[id] = { ...(runs[id] || {}), ...patch }; },
    async appendStep(s) { steps.push(s); },
    async getSteps() { return steps; },
    async createApproval() {},
    async reserveWriteOp({ key }) { if (writeOps.has(key)) return { created: false }; writeOps.add(key); return { created: true }; },
  };
}
const WRITE_TOOL = { id: "followups.create", name: "Create internal follow-up", riskLevel: "WRITE", requiredPermission: "settings.edit", executable: true, requiresApproval: false, handler: async () => ({ taskId: 999, created: true }) };
const wfDef = (toolId) => ({ nodes: [{ id: "t", type: "trigger", config: {} }, { id: "w", type: "action", config: { tool: toolId, input: { title: "x" } } }, { id: "e", type: "end", config: {} }], edges: [{ from: "t", to: "w" }, { from: "w", to: "e" }] });

test("automatic WRITE without a grant is denied and the handler never runs", async () => {
  let called = 0;
  const deps = {
    getTool: () => ({ ...WRITE_TOOL, handler: async () => { called++; return {}; } }),
    toolRequiresApproval: () => false,
    authorizeTool: async () => ({ allow: false, reason: "no grant" }),
    runAgent: async () => ({}),
  };
  const store = makeStore();
  const run = { id: 1, started_by: null, context: { trigger: { input: {} }, steps: {} } };
  const res = await executor.startRunExecution({ store, deps, tenantId: 1, workflow: { id: 1, definition: wfDef("followups.create") }, run });
  assert.equal(res.status, "failed");
  assert.equal(called, 0);
});

test("automatic WRITE with a grant executes exactly once; a retry is idempotent (no duplicate)", async () => {
  let called = 0;
  const deps = {
    getTool: () => ({ ...WRITE_TOOL, handler: async () => { called++; return { taskId: 42 }; } }),
    toolRequiresApproval: () => false,
    authorizeTool: async () => ({ allow: true, grantId: 7 }),
    reserveWriteOp: (store => async ({ key }) => (store.writeOps.has(key) ? { created: false } : (store.writeOps.add(key), { created: true }))),
    runAgent: async () => ({}),
  };
  const store = makeStore();
  deps.reserveWriteOp = store.reserveWriteOp;
  const wf = { id: 1, definition: wfDef("followups.create") };
  const run1 = { id: 10, started_by: null, context: { trigger: { input: {} }, steps: {} } };
  const r1 = await executor.startRunExecution({ store, deps, tenantId: 1, workflow: wf, run: run1 });
  assert.equal(r1.status, "completed");
  assert.equal(called, 1);
  // simulate a retry of the SAME run+node (write-op key already reserved) -> handler NOT called again
  const run2 = { id: 10, started_by: null, context: { trigger: { input: {} }, steps: {} } };
  await executor.startRunExecution({ store, deps, tenantId: 1, workflow: wf, run: run2 });
  assert.equal(called, 1); // still once
});
