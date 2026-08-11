// AI Studio workflow API. Additive; mounted at /api/ai-studio.
// Uses existing auth (protect), RBAC (permit), and tenant isolation (getTenantId).

import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  setWorkflowEnabled,
  validateDefinition,
  runWorkflowManually,
  listRuns,
  getRunWithSteps,
  listApprovals,
  decideApproval,
  getToolRegistryView,
  getAiReplyMode,
  seedExampleWorkflow,
  archiveWorkflow,
  unarchiveWorkflow,
  getTenantAutomation,
  setTenantAutomation,
  getAutomationStatus,
  listGrants,
  grantTool,
  revokeGrant,
  listDelegatableToolsView,
  getTenantTimezone,
  setTenantTimezone,
  hasActiveGrant,
  seedRestockRecoveryWorkflow,
  RESTOCK_RECOVERY_NAME,
} from "../services/aiWorkflowService.js";
import { listTriggers } from "../services/aiWorkflowTriggerRegistry.js";
import { listRecoveries, getRecoveryCounts } from "../services/aiRestockRecoveryService.js";
import { createIntent, listIntents, cancelIntent, markIntentFulfilled, getIntentCounts } from "../services/restockIntentService.js";
import { listNotifications, getNotification, getNotificationCounts, editNotificationDraft, rejectNotification, sendApprovedRestockNotification, getMessagingMode, setMessagingMode } from "../services/restockNotificationService.js";
import { getDeliveryCounts, listUnmatchedDeliveryEvents } from "../services/messageDeliveryReconciliationService.js";

const router = express.Router();

const tid = (req) => getTenantId(req);
const uid = (req) => req.user?.id || null;
const fail = (res, error) => res.status(error?.status || 500).json({ success: false, message: error?.message || "Workflow error", details: error?.details });

// ---- Tools (read-only registry) ----
router.get("/tools", protect, permit("settings", "view"), (req, res) => {
  res.json({ success: true, ...getToolRegistryView() });
});

// ---- Triggers (read-only registry) + automation status/kill switch ----
router.get("/triggers", protect, permit("settings", "view"), (req, res) => {
  res.json({ success: true, triggers: listTriggers() });
});

router.get("/automation/status", protect, permit("settings", "view"), async (req, res) => {
  try { res.json({ success: true, ...(await getAutomationStatus(tid(req))) }); } catch (error) { fail(res, error); }
});

router.get("/automation/tenant", protect, permit("settings", "view"), async (req, res) => {
  try { res.json({ success: true, enabled: await getTenantAutomation(tid(req)) }); } catch (error) { fail(res, error); }
});

router.post("/automation/tenant", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, enabled: await setTenantAutomation(tid(req), Boolean(req.body?.enabled), uid(req)) }); } catch (error) { fail(res, error); }
});

// ---- Automation timezone (per-tenant IANA) ----
router.get("/automation/timezone", protect, permit("settings", "view"), async (req, res) => {
  try { res.json({ success: true, timezone: await getTenantTimezone(tid(req)) }); } catch (error) { fail(res, error); }
});
router.post("/automation/timezone", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, timezone: await setTenantTimezone(tid(req), String(req.body?.timezone || ""), uid(req)) }); } catch (error) { fail(res, error); }
});

// ---- Phase 6: Restock Customer Recovery ----
router.get("/restock-recovery", protect, permit("settings", "view"), async (req, res) => {
  try {
    const t = tid(req);
    const [recoveries, counts, status, workflows] = await Promise.all([listRecoveries(t, {}), getRecoveryCounts(t), getAutomationStatus(t), listWorkflows(t)]);
    const wf = (workflows || []).find((w) => w.name === RESTOCK_RECOVERY_NAME && !w.archived_at);
    const granted = wf ? Boolean(await hasActiveGrant(t, wf.id, "restock.recover")) : false;
    res.json({ success: true, recoveries, counts, automation: status, workflow: wf ? { id: wf.id, enabled: wf.enabled, granted } : null });
  } catch (error) { fail(res, error); }
});
router.post("/restock-recovery/seed-template", protect, permit("settings", "edit"), async (req, res) => {
  try { res.status(201).json({ success: true, workflow: await seedRestockRecoveryWorkflow(tid(req), uid(req)) }); } catch (error) { fail(res, error); }
});

// ---- Phase 7: Restock Intents (variant-level explicit requests) ----
router.get("/restock-intents", protect, permit("settings", "view"), async (req, res) => {
  try {
    const filter = { status: req.query.status || null, limit: req.query.limit, phone: req.query.phone || null, customerId: req.query.customerId || null };
    const [intents, counts] = await Promise.all([listIntents(tid(req), filter), getIntentCounts(tid(req))]);
    res.json({ success: true, intents, counts });
  } catch (error) { fail(res, error); }
});
// Employee-created intent (e.g. from AI Inbox) — EXPLICIT action, never autonomous. `source` records origin.
router.post("/restock-intents", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const b = req.body || {};
    const r = await createIntent({ tenantId: tid(req), customerId: b.customerId || b.customer_id || null, phone: b.phone || null, productId: Number(b.productId ?? b.product_id), variantId: (b.variantId ?? b.variant_id) ? Number(b.variantId ?? b.variant_id) : null, source: b.source === "ai_inbox" ? "ai_inbox" : "admin", sourceReference: b.sourceReference || b.source_reference || null });
    res.status(r.created ? 201 : 200).json({ success: true, ...r });
  } catch (error) { fail(res, error); }
});
router.post("/restock-intents/:id/cancel", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, intent: await cancelIntent(tid(req), req.params.id) }); } catch (error) { fail(res, error); }
});
router.post("/restock-intents/:id/fulfil", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, intent: await markIntentFulfilled(tid(req), req.params.id) }); } catch (error) { fail(res, error); }
});

// ---- Phase 8: Human-approved customer restock messaging ----
const maskRecipient = (r) => (r ? `${String(r).slice(0, 2)}***${String(r).slice(-2)}` : null);
router.get("/restock-messaging/mode", protect, permit("settings", "view"), async (req, res) => {
  try { res.json({ success: true, mode: await getMessagingMode(tid(req)) }); } catch (error) { fail(res, error); }
});
router.post("/restock-messaging/mode", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, mode: await setMessagingMode(tid(req), String(req.body?.mode || ""), uid(req)) }); } catch (error) { fail(res, error); }
});
router.get("/restock-notifications", protect, permit("settings", "view"), async (req, res) => {
  try {
    const [notifications, counts, mode, deliveryCounts] = await Promise.all([
      listNotifications(tid(req), { status: req.query.status || null, limit: req.query.limit }),
      getNotificationCounts(tid(req)),
      getMessagingMode(tid(req)),
      getDeliveryCounts(tid(req)),
    ]);
    res.json({ success: true, notifications, counts, mode, deliveryCounts });
  } catch (error) { fail(res, error); }
});
// Phase 9 observability: provider delivery events that could not be correlated to a known message.
router.get("/restock-notifications/unmatched-events", protect, permit("settings", "view"), async (req, res) => {
  try { res.json({ success: true, events: await listUnmatchedDeliveryEvents(tid(req), { limit: req.query.limit }) }); } catch (error) { fail(res, error); }
});
router.get("/restock-notifications/:id", protect, permit("settings", "view"), async (req, res) => {
  try {
    const n = await getNotification(tid(req), req.params.id);
    if (!n) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, notification: { ...n, recipient_reference: maskRecipient(n.recipient_reference) } });
  } catch (error) { fail(res, error); }
});
router.post("/restock-notifications/:id/edit", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, notification: await editNotificationDraft(tid(req), req.params.id, String(req.body?.text || ""), uid(req)) }); } catch (error) { fail(res, error); }
});
router.post("/restock-notifications/:id/reject", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, notification: await rejectNotification(tid(req), req.params.id, { userId: uid(req), reason: req.body?.reason || "" }) }); } catch (error) { fail(res, error); }
});
// SENSITIVE, human-approved send. Idempotent. Blocked unless messaging mode is approval_send.
router.post("/restock-notifications/:id/approve-send", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, ...(await sendApprovedRestockNotification({ tenantId: tid(req), notificationId: req.params.id, approvedBy: uid(req), req })) }); } catch (error) { fail(res, error); }
});

// ---- Delegated WRITE grants (per-workflow) ----
router.get("/delegatable-tools", protect, permit("settings", "view"), (req, res) => {
  res.json({ success: true, tools: listDelegatableToolsView() });
});
router.get("/workflows/:id/grants", protect, permit("settings", "view"), async (req, res) => {
  try { res.json({ success: true, grants: await listGrants(tid(req), req.params.id) }); } catch (error) { fail(res, error); }
});
router.post("/workflows/:id/grants", protect, permit("settings", "edit"), async (req, res) => {
  try { res.status(201).json({ success: true, grant: await grantTool(tid(req), req.params.id, String(req.body?.toolId || ""), { userId: uid(req), req }) }); } catch (error) { fail(res, error); }
});
router.delete("/workflows/:id/grants/:toolId", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, grant: await revokeGrant(tid(req), req.params.id, req.params.toolId, { userId: uid(req) }) }); } catch (error) { fail(res, error); }
});

// ---- Archive / soft-delete (never hard-delete) ----
router.post("/workflows/:id/archive", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, workflow: await archiveWorkflow(tid(req), req.params.id, uid(req)) }); } catch (error) { fail(res, error); }
});

router.post("/workflows/:id/unarchive", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, workflow: await unarchiveWorkflow(tid(req), req.params.id, uid(req)) }); } catch (error) { fail(res, error); }
});

// ---- Overview extras (reply-mode policy surface) ----
router.get("/overview", protect, permit("settings", "view"), async (req, res) => {
  try {
    const [workflows, pending, replyMode, automation, autoRuns] = await Promise.all([
      listWorkflows(tid(req)),
      listApprovals(tid(req), { status: "pending" }),
      getAiReplyMode(),
      getAutomationStatus(tid(req)),
      listRuns(tid(req), { limit: 200 }),
    ]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const autoToday = autoRuns.filter((r) => r.trigger && r.trigger !== "manual" && new Date(r.created_at) >= today);
    res.json({
      success: true,
      workflow_count: workflows.length,
      enabled_workflow_count: workflows.filter((w) => w.enabled).length,
      pending_approvals: pending.length,
      ai_reply_mode: replyMode,
      automation,
      automatic_runs_today: autoToday.length,
      automatic_runs_today_succeeded: autoToday.filter((r) => r.status === "completed").length,
      automatic_runs_today_failed: autoToday.filter((r) => r.status === "failed" || r.status === "rejected").length,
    });
  } catch (error) { fail(res, error); }
});

// ---- Workflows CRUD ----
router.get("/workflows", protect, permit("settings", "view"), async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";
    res.json({ success: true, workflows: await listWorkflows(tid(req), { includeArchived }) });
  } catch (error) { fail(res, error); }
});

router.get("/workflows/:id", protect, permit("settings", "view"), async (req, res) => {
  try {
    const wf = await getWorkflow(tid(req), req.params.id);
    if (!wf) return res.status(404).json({ success: false, message: "Workflow not found" });
    res.json({ success: true, workflow: wf });
  } catch (error) { fail(res, error); }
});

router.post("/workflows/validate", protect, permit("settings", "view"), (req, res) => {
  const result = validateDefinition(req.body?.definition);
  res.json({ success: true, ...result });
});

router.post("/workflows", protect, permit("settings", "edit"), async (req, res) => {
  try { res.status(201).json({ success: true, workflow: await createWorkflow(tid(req), req.body || {}, uid(req)) }); } catch (error) { fail(res, error); }
});

router.post("/workflows/seed-example", protect, permit("settings", "edit"), async (req, res) => {
  try { res.status(201).json({ success: true, workflow: await seedExampleWorkflow(tid(req), uid(req)) }); } catch (error) { fail(res, error); }
});

router.put("/workflows/:id", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, workflow: await updateWorkflow(tid(req), req.params.id, req.body || {}, uid(req)) }); } catch (error) { fail(res, error); }
});

router.post("/workflows/:id/enable", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, workflow: await setWorkflowEnabled(tid(req), req.params.id, Boolean(req.body?.enabled), uid(req)) }); } catch (error) { fail(res, error); }
});

router.post("/workflows/:id/run", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const out = await runWorkflowManually(tid(req), req.params.id, { input: req.body?.input || {}, userId: uid(req), req, idempotencyKey: req.body?.idempotencyKey || null });
    res.json({ success: true, ...out });
  } catch (error) { fail(res, error); }
});

// ---- Runs / executions ----
router.get("/runs", protect, permit("settings", "view"), async (req, res) => {
  try { res.json({ success: true, runs: await listRuns(tid(req), { workflowId: req.query.workflowId || null, limit: req.query.limit }) }); } catch (error) { fail(res, error); }
});

router.get("/runs/:id", protect, permit("settings", "view"), async (req, res) => {
  try {
    const data = await getRunWithSteps(tid(req), req.params.id);
    if (!data) return res.status(404).json({ success: false, message: "Run not found" });
    res.json({ success: true, ...data });
  } catch (error) { fail(res, error); }
});

// ---- Approvals ----
router.get("/approvals", protect, permit("settings", "view"), async (req, res) => {
  try { res.json({ success: true, approvals: await listApprovals(tid(req), { status: req.query.status || "pending" }) }); } catch (error) { fail(res, error); }
});

router.post("/approvals/:id/approve", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, ...(await decideApproval(tid(req), req.params.id, { decision: "approve", userId: uid(req), req, note: req.body?.note || "" })) }); } catch (error) { fail(res, error); }
});

router.post("/approvals/:id/reject", protect, permit("settings", "edit"), async (req, res) => {
  try { res.json({ success: true, ...(await decideApproval(tid(req), req.params.id, { decision: "reject", userId: uid(req), req, note: req.body?.note || "" })) }); } catch (error) { fail(res, error); }
});

export default router;
