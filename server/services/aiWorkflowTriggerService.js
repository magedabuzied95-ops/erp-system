// AI Workflow Trigger Service (event adapter)
// ---------------------------------------------------------------------------
// THIN adapter: ERP event → find matching enabled workflows → create idempotent run →
// existing executor. It contains NO ERP business logic. The ERP operation always happens
// FIRST and succeeds independently; automation reacts AFTER, and any automation failure is
// caught here so it can NEVER roll back or break the ERP operation that emitted the event.
//
// Gates for an automatic run (ALL required):
//   global env flag (AI_WORKFLOWS_AUTOMATION_ENABLED) AND tenant automation ON
//   AND workflow enabled AND not archived AND trigger config matches the event.

import db from "../database/db.js";
import { redactSecrets } from "./aiWorkflowSchema.js";
import { getTrigger, isTriggerAvailable, isGlobalAutomationEnabled, triggerMatchesEvent } from "./aiWorkflowTriggerRegistry.js";
import {
  getTenantAutomation,
  listAutomaticWorkflowsForTrigger,
  listAutomationEnabledTenantIds,
  runEventForWorkflow,
} from "./aiWorkflowService.js";

const log = (...args) => console.log("[ai-workflow-trigger]", ...args);
const warn = (...args) => console.warn("[ai-workflow-trigger]", ...args);

// Only keep the plain, workflow-useful fields from an event; redact anything secret.
// Never place tokens/authorization/webhook secrets into a workflow event.
const sanitizeEventData = (payload) => {
  const clean = redactSecrets(payload && typeof payload === "object" ? payload : {});
  // Defensive: drop obviously-sensitive keys even if not caught by the regex.
  for (const k of ["headers", "authorization", "signature", "raw", "webhookSecret"]) delete clean[k];
  return clean;
};

const triggerNodeConfig = (workflow) => {
  const nodes = workflow?.definition?.nodes || [];
  const trigger = nodes.find((n) => n.type === "trigger");
  return trigger?.config || {};
};

// Default dependency wiring (overridable in tests to exercise the gating/matching without a DB).
const defaultDeps = {
  isGlobalEnabled: isGlobalAutomationEnabled,
  isTriggerAvailable,
  getTenantAutomation,
  listWorkflows: listAutomaticWorkflowsForTrigger,
  runEvent: runEventForWorkflow,
};

// ---- Core: emit an ERP event and fan out to matching workflows (idempotent) ----
// Returns a summary; NEVER throws (failure isolation is the whole point).
export const emitWorkflowEvent = async ({ tenantId, triggerType, eventId, occurredAt = null, payload = {} } = {}, deps = defaultDeps) => {
  try {
    if (!tenantId || !triggerType || !eventId) return { emitted: false, reason: "missing tenantId/triggerType/eventId" };
    if (!getTrigger(triggerType)) return { emitted: false, reason: `unknown trigger: ${triggerType}` };
    if (triggerType === "manual") return { emitted: false, reason: "manual is not an automatic trigger" };
    if (!deps.isGlobalEnabled()) return { emitted: false, reason: "global automation disabled" };
    if (!deps.isTriggerAvailable(triggerType)) return { emitted: false, reason: `trigger unavailable: ${triggerType}` };
    if (!(await deps.getTenantAutomation(tenantId))) return { emitted: false, reason: "tenant automation disabled" };

    const workflows = await deps.listWorkflows(tenantId, triggerType);
    if (!workflows.length) return { emitted: false, reason: "no matching enabled workflows" };

    const eventData = sanitizeEventData(payload);
    const runs = [];
    for (const wf of workflows) {
      // Server-side matching — the browser never decides whether a workflow runs.
      if (!triggerMatchesEvent(triggerType, triggerNodeConfig(wf), eventData)) continue;
      try {
        const r = await deps.runEvent({ tenantId, workflow: wf, triggerType, eventId, occurredAt, eventData });
        runs.push(r);
        if (!r.duplicate) log("run created", { tenantId, workflowId: wf.id, runId: r.runId, triggerType, eventId, status: r.status });
      } catch (err) {
        // One workflow failing must not stop the others, and must not surface to the ERP caller.
        warn("workflow run failed", { tenantId, workflowId: wf.id, triggerType, eventId, error: err?.message || String(err) });
        runs.push({ workflowId: wf.id, error: err?.message || String(err) });
      }
    }
    return { emitted: runs.some((r) => r.runId), matched: runs.length, runs, triggerType, eventId };
  } catch (err) {
    // Absolute backstop — an event-adapter failure never propagates to the ERP operation.
    warn("emitWorkflowEvent failed", { tenantId, triggerType, eventId, error: err?.message || String(err) });
    return { emitted: false, reason: "adapter error", error: err?.message || String(err) };
  }
};

// Pure restock-crossing test (<=0 -> >0), exposed for unit tests.
export const shouldEmitRestock = (movement = {}) => {
  const before = Number(movement.quantityBefore ?? movement.quantity_before);
  const after = Number(movement.quantityAfter ?? movement.quantity_after);
  return Number.isFinite(before) && Number.isFinite(after) && before <= 0 && after > 0;
};

// ===========================================================================
// ERP-side hooks — call these POST-COMMIT from the canonical ERP operations.
// Each is fire-and-forget and fully failure-isolated.
// ===========================================================================

// inventory.restocked — emit only on a real restock crossing (<=0 -> >0).
// `movement` is the object returned by adjustVariantStock / recordInventoryMovement.
export const notifyInventoryRestock = ({ tenantId, movement } = {}) => {
  try {
    if (!tenantId || !movement) return;
    const before = Number(movement.quantityBefore ?? movement.quantity_before);
    const after = Number(movement.quantityAfter ?? movement.quantity_after);
    if (!(Number.isFinite(before) && Number.isFinite(after))) return;
    if (!(before <= 0 && after > 0)) return; // not a restock crossing
    const productId = movement.productId ?? movement.product_id ?? null;
    const variantId = movement.variantId ?? movement.variant_id ?? null;
    const movementId = movement.movement?.id ?? movement.id ?? null;
    const eventId = movementId ? `inv:${movementId}` : `inv:${tenantId}:${productId}:${variantId}:${after}:${Date.now()}`;
    void emitWorkflowEvent({
      tenantId,
      triggerType: "inventory.restocked",
      eventId,
      payload: {
        productId, variantId, previousQty: before, newQty: after,
        movementId, sourceType: movement.movement?.movement_type ?? movement.movement_type ?? null,
        referenceType: movement.movement?.reference_type ?? movement.reference_type ?? null,
        referenceId: movement.movement?.reference_id ?? movement.reference_id ?? null,
      },
    }).catch(() => {});
  } catch { /* never break the ERP inventory operation */ }
};

// followup.due — emitted by the automation tick when a follow-up becomes due (read-only).
const emitFollowupDue = (row) => {
  const eventId = `followup.due:${row.id}`; // one event per follow-up, ever
  return emitWorkflowEvent({
    tenantId: Number(row.tenant_id),
    triggerType: "followup.due",
    eventId,
    occurredAt: row.scheduled_at,
    payload: {
      followupId: row.id,
      customerId: row.profile_id ?? null,
      conversationId: row.session_id ?? null,
      followupType: row.trigger_type ?? null,
      scheduledAt: row.scheduled_at ?? null,
      sourceChannel: row.source_channel ?? null,
      status: row.status ?? null,
    },
  });
};

// ===========================================================================
// Automation scheduler tick — one bounded pass. Registered in server.js via
// backgroundIntervals (the existing setInterval convention). No Redis/Bull/cron.
// ===========================================================================

let lastFollowupScanAt = null; // module memory; on boot we look back a small window
const FOLLOWUP_LOOKBACK_MS = 2 * 60 * 1000;

// Deterministic slot id for a schedule workflow at "now" (server local time; documented).
export const computeScheduleSlot = (config = {}, now = new Date()) => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  if (config.frequency === "hourly") return { slotId: `${y}-${m}-${d}T${hh}:00`, due: true };
  if (config.frequency === "daily") {
    const [th, tm] = String(config.time || "09:00").split(":");
    const targetH = Number(th); const targetM = Number(tm || 0);
    const dueTime = new Date(now); dueTime.setHours(targetH, targetM, 0, 0);
    return { slotId: `${y}-${m}-${d}T${String(targetH).padStart(2, "0")}:${String(targetM).padStart(2, "0")}`, due: now >= dueTime };
  }
  return { slotId: null, due: false };
};

const runDueSchedules = async (tenantId, now) => {
  const workflows = await listAutomaticWorkflowsForTrigger(tenantId, "schedule.interval");
  for (const wf of workflows) {
    try {
      const cfg = triggerNodeConfig(wf);
      const { slotId, due } = computeScheduleSlot(cfg, now);
      if (!slotId || !due) continue;
      // idempotency (evt:schedule.interval:schedule:<wfId>:<slot>) ensures one run per slot,
      // even across backend restarts.
      await runEventForWorkflow({
        tenantId, workflow: wf, triggerType: "schedule.interval",
        eventId: `schedule:${wf.id}:${slotId}`, occurredAt: now.toISOString(),
        eventData: { frequency: cfg.frequency, time: cfg.time || null, slot: slotId },
      });
    } catch (err) {
      warn("schedule run failed", { tenantId, workflowId: wf.id, error: err?.message || String(err) });
    }
  }
};

const scanDueFollowups = async (tenantId, now, since) => {
  // Only scan when the tenant actually has an enabled follow-up workflow (bounds cost).
  const wf = await listAutomaticWorkflowsForTrigger(tenantId, "followup.due");
  if (!wf.length) return;
  const rows = await db.query(
    `SELECT id, tenant_id, profile_id, session_id, trigger_type, scheduled_at, source_channel, status
       FROM ai_followup_tasks
      WHERE tenant_id = $1 AND status IN ('pending','snoozed')
        AND scheduled_at > $2 AND scheduled_at <= $3
      ORDER BY scheduled_at ASC LIMIT 200`,
    [tenantId, since, now]
  ).catch(() => ({ rows: [] })); // table may not exist in some deployments — fail safe
  for (const row of rows.rows) {
    try { await emitFollowupDue(row); } catch (err) { warn("followup emit failed", { tenantId, id: row.id, error: err?.message }); }
  }
};

// One automation pass across all automation-enabled tenants. Never throws.
export const runAutomationTick = async (now = new Date()) => {
  try {
    if (!isGlobalAutomationEnabled()) return { ran: false, reason: "global disabled" };
    const tenants = await listAutomationEnabledTenantIds();
    const since = lastFollowupScanAt || new Date(now.getTime() - FOLLOWUP_LOOKBACK_MS);
    for (const tenantId of tenants) {
      try {
        await runDueSchedules(tenantId, now);
        await scanDueFollowups(tenantId, now.toISOString(), since.toISOString ? since.toISOString() : since);
      } catch (err) {
        warn("tenant tick failed", { tenantId, error: err?.message || String(err) });
      }
    }
    lastFollowupScanAt = now;
    return { ran: true, tenants: tenants.length };
  } catch (err) {
    warn("automation tick failed", { error: err?.message || String(err) });
    return { ran: false, error: err?.message || String(err) };
  }
};

// Test seam.
export const __test = { sanitizeEventData, triggerNodeConfig, computeScheduleSlot };
