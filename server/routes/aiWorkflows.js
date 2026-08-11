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
} from "../services/aiWorkflowService.js";

const router = express.Router();

const tid = (req) => getTenantId(req);
const uid = (req) => req.user?.id || null;
const fail = (res, error) => res.status(error?.status || 500).json({ success: false, message: error?.message || "Workflow error", details: error?.details });

// ---- Tools (read-only registry) ----
router.get("/tools", protect, permit("settings", "view"), (req, res) => {
  res.json({ success: true, ...getToolRegistryView() });
});

// ---- Overview extras (reply-mode policy surface) ----
router.get("/overview", protect, permit("settings", "view"), async (req, res) => {
  try {
    const [workflows, pending, replyMode] = await Promise.all([
      listWorkflows(tid(req)),
      listApprovals(tid(req), { status: "pending" }),
      getAiReplyMode(),
    ]);
    res.json({
      success: true,
      workflow_count: workflows.length,
      enabled_workflow_count: workflows.filter((w) => w.enabled).length,
      pending_approvals: pending.length,
      ai_reply_mode: replyMode,
    });
  } catch (error) { fail(res, error); }
});

// ---- Workflows CRUD ----
router.get("/workflows", protect, permit("settings", "view"), async (req, res) => {
  try { res.json({ success: true, workflows: await listWorkflows(tid(req)) }); } catch (error) { fail(res, error); }
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
