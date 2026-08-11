// AI Studio Phase 4 — event-driven automation. Exercises the trigger registry, the event
// adapter's gating/matching/idempotency, the actor model, restock/schedule logic and
// failure isolation with INJECTED deps (no DB), mirroring the Phase 2 executor tests.

import test from "node:test";
import assert from "node:assert/strict";

// Registry is env-gated; force automation ON for the adapter tests below.
process.env.AI_WORKFLOWS_AUTOMATION_ENABLED = "true";

const {
  listTriggers, getTrigger, isKnownTrigger, isAuthorableTrigger, isTriggerAvailable, triggerMatchesEvent,
} = await import("../../server/services/aiWorkflowTriggerRegistry.js");
const {
  emitWorkflowEvent, shouldEmitRestock, computeScheduleSlot, __test,
} = await import("../../server/services/aiWorkflowTriggerService.js");

// ---- Trigger Registry ----
test("registry allowlists known triggers and rejects unknown", () => {
  assert.equal(isKnownTrigger("inventory.restocked"), true);
  assert.equal(isKnownTrigger("totally.made.up"), false);
  assert.equal(getTrigger("totally.made.up"), null);
});

test("channel trigger is never available or authorable (coming later)", () => {
  assert.equal(isTriggerAvailable("channel.message_received"), false);
  assert.equal(isAuthorableTrigger("channel.message_received"), false);
  const ch = listTriggers().find((t) => t.id === "channel.message_received");
  assert.equal(ch.available, false);
  assert.equal(ch.category, "CHANNEL");
});

test("ERP/schedule triggers are authorable and (with automation on) available", () => {
  for (const id of ["followup.due", "inventory.restocked", "schedule.interval"]) {
    assert.equal(isAuthorableTrigger(id), true);
    assert.equal(isTriggerAvailable(id), true);
  }
  assert.equal(isTriggerAvailable("manual"), true);
});

// ---- Matching ----
test("inventory.restocked matches on product/variant filters", () => {
  assert.equal(triggerMatchesEvent("inventory.restocked", {}, { productId: 5, variantId: 9 }), true);
  assert.equal(triggerMatchesEvent("inventory.restocked", { productId: 5 }, { productId: 5, variantId: 9 }), true);
  assert.equal(triggerMatchesEvent("inventory.restocked", { productId: 6 }, { productId: 5 }), false);
  assert.equal(triggerMatchesEvent("inventory.restocked", { variantId: 9 }, { productId: 5, variantId: 8 }), false);
});

test("followup.due matches on optional followup type", () => {
  assert.equal(triggerMatchesEvent("followup.due", {}, { followupType: "abandoned_order_details" }), true);
  assert.equal(triggerMatchesEvent("followup.due", { followupType: "abandoned_order_details" }, { followupType: "abandoned_order_details" }), true);
  assert.equal(triggerMatchesEvent("followup.due", { followupType: "x" }, { followupType: "y" }), false);
});

// ---- Restock crossing ----
test("shouldEmitRestock only fires on a <=0 -> >0 crossing", () => {
  assert.equal(shouldEmitRestock({ quantityBefore: 0, quantityAfter: 5 }), true);
  assert.equal(shouldEmitRestock({ quantityBefore: -3, quantityAfter: 1 }), true);
  assert.equal(shouldEmitRestock({ quantityBefore: 2, quantityAfter: 7 }), false); // already in stock
  assert.equal(shouldEmitRestock({ quantityBefore: 5, quantityAfter: 0 }), false); // sold out
  assert.equal(shouldEmitRestock({ quantity_before: 0, quantity_after: 3 }), true); // ledger naming
});

// ---- Schedule slots ----
test("computeScheduleSlot: hourly is always due, id is the current hour", () => {
  const now = new Date("2026-08-11T09:34:00");
  const s = computeScheduleSlot({ frequency: "hourly" }, now);
  assert.equal(s.due, true);
  assert.equal(s.slotId, "2026-08-11T09:00");
});

test("computeScheduleSlot: daily is due only after the configured time; slot id is stable per day", () => {
  const before = computeScheduleSlot({ frequency: "daily", time: "09:00" }, new Date("2026-08-11T08:59:00"));
  assert.equal(before.due, false);
  const after = computeScheduleSlot({ frequency: "daily", time: "09:00" }, new Date("2026-08-11T09:01:00"));
  assert.equal(after.due, true);
  assert.equal(after.slotId, "2026-08-11T09:00");
  // Same slot id regardless of when later in the day the tick runs -> idempotency = one run/day.
  const later = computeScheduleSlot({ frequency: "daily", time: "09:00" }, new Date("2026-08-11T18:00:00"));
  assert.equal(later.slotId, after.slotId);
});

// ---- Event payload sanitization ----
test("event data is redacted/sanitized (no secrets in workflow events)", () => {
  const clean = __test.sanitizeEventData({ productId: 5, apiKey: "sk-123", authorization: "Bearer x", headers: { a: 1 }, token: "t" });
  assert.equal(clean.productId, 5);
  assert.equal(clean.apiKey, "[redacted]");
  assert.equal(clean.token, "[redacted]");
  assert.equal("headers" in clean, false);
  assert.equal("authorization" in clean, false);
});

// ---- Adapter gating (injected deps; no DB) ----
const makeDeps = (over = {}) => {
  const calls = [];
  const seen = new Set();
  return {
    calls, seen,
    isGlobalEnabled: () => true,
    isTriggerAvailable: () => true,
    getTenantAutomation: async () => true,
    listWorkflows: async () => [{ id: 1, version: 1, definition: { nodes: [{ id: "t", type: "trigger", config: { triggerType: "inventory.restocked" } }] } }],
    // Simulate the DB unique-index idempotency: same eventId+workflow => duplicate.
    runEvent: async ({ workflow, eventId }) => {
      calls.push({ workflowId: workflow.id, eventId });
      const key = `${workflow.id}:${eventId}`;
      if (seen.has(key)) return { duplicate: true, workflowId: workflow.id };
      seen.add(key);
      return { duplicate: false, workflowId: workflow.id, runId: 100 + calls.length, status: "completed" };
    },
    ...over,
  };
};

const EVENT = { tenantId: 1, triggerType: "inventory.restocked", eventId: "inv:42", payload: { productId: 5 } };

test("global kill switch OFF => no automatic run (manual is separate)", async () => {
  const deps = makeDeps({ isGlobalEnabled: () => false });
  const r = await emitWorkflowEvent(EVENT, deps);
  assert.equal(r.emitted, false);
  assert.match(r.reason, /global automation disabled/);
  assert.equal(deps.calls.length, 0);
});

test("tenant kill switch OFF => no automatic run", async () => {
  const deps = makeDeps({ getTenantAutomation: async () => false });
  const r = await emitWorkflowEvent(EVENT, deps);
  assert.equal(r.emitted, false);
  assert.match(r.reason, /tenant automation disabled/);
  assert.equal(deps.calls.length, 0);
});

test("no enabled matching workflows => nothing runs", async () => {
  const deps = makeDeps({ listWorkflows: async () => [] });
  const r = await emitWorkflowEvent(EVENT, deps);
  assert.equal(r.emitted, false);
  assert.match(r.reason, /no matching enabled workflows/);
});

test("manual cannot be emitted as an automatic event", async () => {
  const r = await emitWorkflowEvent({ ...EVENT, triggerType: "manual" }, makeDeps());
  assert.equal(r.emitted, false);
  assert.match(r.reason, /manual is not an automatic trigger/);
});

test("all gates ON => one run is created", async () => {
  const deps = makeDeps();
  const r = await emitWorkflowEvent(EVENT, deps);
  assert.equal(r.emitted, true);
  assert.equal(deps.calls.length, 1);
  assert.equal(r.runs[0].runId, 101);
});

test("duplicate event replay creates NO second run", async () => {
  const deps = makeDeps();
  await emitWorkflowEvent(EVENT, deps);
  const second = await emitWorkflowEvent(EVENT, deps); // same eventId
  assert.equal(second.runs[0].duplicate, true);
  assert.equal(second.emitted, false); // no new run id this time
  // runEvent was called twice, but the second was suppressed as duplicate
  assert.equal(deps.calls.length, 2);
});

test("same event fans out to different matching workflows (distinct runs)", async () => {
  const deps = makeDeps({
    listWorkflows: async () => [
      { id: 1, version: 1, definition: { nodes: [{ id: "t", type: "trigger", config: { triggerType: "inventory.restocked" } }] } },
      { id: 2, version: 1, definition: { nodes: [{ id: "t", type: "trigger", config: { triggerType: "inventory.restocked", productId: 5 } }] } },
    ],
  });
  const r = await emitWorkflowEvent(EVENT, deps);
  assert.equal(deps.calls.length, 2); // both matched (wf2 filter productId=5 == event 5)
  assert.equal(r.runs.filter((x) => x.runId).length, 2);
});

test("server-side match filter excludes a non-matching workflow", async () => {
  const deps = makeDeps({
    listWorkflows: async () => [
      { id: 3, version: 1, definition: { nodes: [{ id: "t", type: "trigger", config: { triggerType: "inventory.restocked", productId: 999 } }] } },
    ],
  });
  const r = await emitWorkflowEvent(EVENT, deps); // event productId=5, filter=999 -> no match
  assert.equal(deps.calls.length, 0);
  assert.equal(r.emitted, false);
});

test("a workflow run error is isolated and never thrown to the ERP caller", async () => {
  const deps = makeDeps({ runEvent: async () => { throw new Error("boom"); } });
  const r = await emitWorkflowEvent(EVENT, deps); // must resolve, not reject
  assert.equal(r.emitted, false);
  assert.ok(r.runs[0].error);
});

// ---- Server-side definition validation of trigger types ----
test("validation rejects a channel trigger and unknown trigger; accepts an ERP trigger", async () => {
  const { validateWorkflowDefinition } = await import("../../server/services/aiWorkflowSchema.js");
  const mk = (triggerType) => ({ version: 1, nodes: [{ id: "t", type: "trigger", config: { triggerType } }, { id: "e", type: "end", config: {} }], edges: [{ from: "t", to: "e" }] });
  assert.equal(validateWorkflowDefinition(mk("channel.message_received")).valid, false);
  assert.equal(validateWorkflowDefinition(mk("does.not.exist")).valid, false);
  assert.equal(validateWorkflowDefinition(mk("inventory.restocked")).valid, true);
  assert.equal(validateWorkflowDefinition(mk("schedule.interval")).valid, true);
});

// ---- Actor model: automatic runs are READ-only (imported lazily; touches schema import only) ----
test("automatic system actor allows only READ view-permissions", async () => {
  const svc = await import("../../server/services/aiWorkflowService.js");
  assert.equal(await svc.systemPermissionChecker("products.view"), true);
  assert.equal(await svc.systemPermissionChecker("orders.view"), true);
  assert.equal(await svc.systemPermissionChecker("orders.edit"), false);   // WRITE denied
  assert.equal(await svc.systemPermissionChecker("settings.edit"), false); // SENSITIVE/WRITE denied
});
