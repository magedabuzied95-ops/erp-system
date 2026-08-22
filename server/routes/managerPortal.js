import express from "express";
import net from "node:net";
import employeeChatUpload from "../config/employeeChatUpload.js";
import {
  approveManagerPortalTask,
  updateManagerPortalTask,
  deleteManagerPortalTask,
  createManagerPortalTask,
  getManagerPortalChat,
  getManagerPortalChatThread,
  getManagerPortalDashboard,
  getManagerPortalInvoiceDetail,
  getManagerPortalMe,
  getManagerPortalTasks,
  getManagerPortalNotifications,
  getManagerPortalOperations,
  getManagerPortalInventoryApprovals,
  getManagerPortalInventoryApprovalSession,
  getManagerPortalSales,
  getManagerPortalStaff,
  getManagerPortalEmployeeDetails,
  createManagerPortalEmployeeAdjustment,
  cancelManagerPortalEmployeeAdjustment,
  correctManagerPortalAttendance,
  reviewManagerPortalAdvanceRequest,
  getManagerPortalStockAlerts,
  markManagerPortalChatRead,
  sendManagerPortalChatRing,
  answerManagerPortalChatRing,
  markManagerPortalNotificationRead,
  markManagerPortalNotificationsRead,
  noteManagerPortalTask,
  approveManagerPortalInventoryApproval,
  reopenManagerPortalTask,
  rejectManagerPortalInventoryApproval,
  rejectManagerPortalTask,
  sendManagerPortalChat,
  updateManagerPortalSettings,
  loadManagerPortalByToken,
} from "../services/managerPortalService.js";
import {
  getManagerPortalPushPublicKey,
  getManagerPortalPushSubscriptionDebug,
  subscribeManagerPortalPush,
  sendManagerPortalTestPush,
  unsubscribeManagerPortalPush,
} from "../services/managerPortalPushService.js";
import { canViewProfitForManager } from "../services/managerPortalService.js";
import { verifyProfitPin, issueProfitToken, revokeProfitToken, attemptKey, isRateLimited, registerFailedAttempt, registerSuccess } from "../services/managerProfitLock.js";

const router = express.Router();

const managerPortalManifest = (token) => ({
  name: "M1 Manager Portal",
  short_name: "Manager",
  description: "Manager portal for live sales, staff, tasks, stock alerts, and employee chat.",
  start_url: `/manager-portal/${encodeURIComponent(token)}?source=pwa`,
  scope: "/manager-portal/",
  display: "standalone",
  orientation: "portrait",
  dir: "rtl",
  lang: "ar",
  background_color: "#eff6ff",
  theme_color: "#0f172a",
  icons: [
    {
      src: "/icons/employee-portal-192.png?v=10",
      sizes: "192x192",
      type: "image/png",
      purpose: "any maskable",
    },
    {
      src: "/icons/employee-portal-512.png?v=10",
      sizes: "512x512",
      type: "image/png",
      purpose: "any maskable",
    },
    {
      src: "/apple-touch-icon.png?v=10",
      sizes: "180x180",
      type: "image/png",
      purpose: "any",
    },
  ],
});

const invalidPortalLinkMessage = "رابط بوابة المدير غير صحيح أو تم تغييره. اطلب رابطًا جديدًا من الإدارة.";

const portalTokenDebug = ({ req, token, manager = null, reason = "" }) => {
  console.info("[manager-portal:token]", {
    requestId: req.id,
    tokenLength: String(token || "").length,
    tokenPrefix: String(token || "").slice(0, 6),
    managerId: manager?.id || null,
    tenantId: manager?.tenant_id || null,
    branchId: manager?.branch_id || null,
    role: manager?.role || null,
    reason,
  });
};

const extractProfitToken = (req) => {
  const header = req.get?.("x-profit-authorization") || req.get?.("X-Profit-Authorization") || "";
  return String(header || "").replace(/^Bearer\s+/i, "").trim();
};

const portalRoutePath = (req) => `${req.baseUrl || ""}${req.route?.path || req.path || ""}`;

const invalidTokenResponse = async (req, res, token, reason = "invalid_token") => {
  console.warn("[manager-portal:token-invalid]", {
    requestId: req.id,
    routePath: portalRoutePath(req),
    tokenLength: String(token || "").length,
    tokenPrefix: String(token || "").slice(0, 6),
    reason,
  });
  return res.status(404).json({
    success: false,
    code: reason,
    message: invalidPortalLinkMessage,
  });
};

const loadVerifiedManager = async (req, res) => {
  const token = String(req.params.token || "");
  if (!token) {
    await invalidTokenResponse(req, res, token, "missing_token");
    return null;
  }
  const manager = await loadManagerPortalByToken(token);
  if (!manager) {
    await invalidTokenResponse(req, res, token, "manager_not_found");
    return null;
  }
  portalTokenDebug({ req, token, manager });
  return manager;
};

const verifyManagerPortalToken = async (req, res, next) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    req.managerPortalManager = manager;
    next();
  } catch (error) {
    next(error);
  }
};

const uploadManagerChatAttachment = (req, res, next) => {
  employeeChatUpload.single("attachment")(req, res, (error) => {
    if (!error) return next();
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "chat_attachment_invalid",
      message: error.code === "LIMIT_FILE_SIZE" ? "Attachment is too large" : error.message || "Unsupported attachment",
    });
  });
};

router.get("/:token/manifest.webmanifest", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.json(managerPortalManifest(String(req.params.token || "")));
  } catch (error) {
    console.error("[manager-portal] manifest error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load manager portal manifest" });
  }
});

router.get("/:token/push/public-key", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const payload = await getManagerPortalPushPublicKey();
    console.info("[manager-push:public-key]", {
      manager_id: manager.id,
      hasKey: Boolean(payload.publicKey),
      keyLength: String(payload.publicKey || "").length,
    });
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("[manager-portal] push key error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load push key" });
  }
});

router.post("/:token/push/subscribe", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const subscription = req.body?.subscription || req.body || {};
    const result = await subscribeManagerPortalPush({
      manager,
      token: req.params.token,
      subscription: {
        ...subscription,
        application_server_key_length: Number(req.body?.application_server_key_length || req.body?.applicationServerKeyLength || subscription.application_server_key_length || 0) || 0,
      },
      userAgent: req.get?.("user-agent") || "",
      portalUrl: req.body?.portal_url || req.body?.portalUrl || "",
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("[manager-portal] push subscribe error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to save push subscription" });
  }
});

router.post("/:token/push/test", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const subscriptionDebug = await getManagerPortalPushSubscriptionDebug({ token: req.params.token });
    const result = await sendManagerPortalTestPush({ token: req.params.token, manager });
    return res.json({
      success: true,
      subscription_debug: {
        token: subscriptionDebug.token,
        active_count: subscriptionDebug.active_count,
        total_count: subscriptionDebug.total_count,
      },
      result: {
        token: result.token,
        active_count: result.active_count,
        sent: result.sent,
        failed: result.failed,
        deactivated: result.deactivated,
        skipped: Boolean(result.skipped),
      },
    });
  } catch (error) {
    console.error("[manager-portal] push test error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to send test push" });
  }
});

router.post("/:token/push/unsubscribe", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const subscription = req.body?.subscription || {};
    const result = await unsubscribeManagerPortalPush({
      manager,
      token: req.params.token,
      endpoint: req.body?.endpoint || subscription.endpoint || "",
    });
    return res.json({ success: true, subscription: result });
  } catch (error) {
    console.error("[manager-portal] push unsubscribe error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to remove push subscription" });
  }
});

router.delete("/:token/push/unsubscribe", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const result = await unsubscribeManagerPortalPush({
      manager,
      token: req.params.token,
      endpoint: req.body?.endpoint || req.query?.endpoint || "",
    });
    return res.json({ success: true, subscription: result });
  } catch (error) {
    console.error("[manager-portal] push unsubscribe error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to remove push subscription" });
  }
});

router.get("/:token/me", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    return res.json({ success: true, ...(await getManagerPortalMe(manager)) });
  } catch (error) {
    console.error("[manager-portal] me load error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load manager portal profile" });
  }
});

router.get("/:token/dashboard", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const dashboard = await getManagerPortalDashboard({ manager, filters: req.query || {}, profitToken: extractProfitToken(req) });
    return res.json({ success: true, dashboard });
  } catch (error) {
    console.error("[manager-portal] dashboard error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load dashboard" });
  }
});

router.get("/:token/invoices/:invoiceId", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const invoice = await getManagerPortalInvoiceDetail({ manager, invoiceId: req.params.invoiceId, profitToken: extractProfitToken(req) });
    return res.json({ success: true, invoice });
  } catch (error) {
    console.error("[manager-portal] invoice detail error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load invoice details" });
  }
});

router.get("/:token/staff", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const staff = await getManagerPortalStaff({ manager });
    return res.json({ success: true, staff });
  } catch (error) {
    console.error("[manager-portal] staff error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load staff" });
  }
});

router.get("/:token/staff/:employeeId/details", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const details = await getManagerPortalEmployeeDetails({ manager, employeeId: req.params.employeeId, month: req.query.month });
    return res.json({ success: true, details });
  } catch (error) {
    console.error("[manager-portal] employee details error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load employee details" });
  }
});

router.post("/:token/staff/:employeeId/adjustments", verifyManagerPortalToken, async (req, res) => {
  try {
    const result = await createManagerPortalEmployeeAdjustment({ manager: req.managerPortalManager, employeeId: req.params.employeeId, payload: req.body || {} });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("[manager-portal] employee adjustment error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to save adjustment" });
  }
});

const managerRequestIp = (req) => {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const candidate = forwarded || req.ip || req.socket?.remoteAddress || "";
  const normalized = String(candidate).replace(/^::ffff:/, "").trim();
  return net.isIP(normalized) ? normalized : null;
};

router.delete("/:token/staff/:employeeId/adjustments/:kind/:adjustmentId", verifyManagerPortalToken, async (req, res) => {
  try {
    const result = await cancelManagerPortalEmployeeAdjustment({
      manager: req.managerPortalManager,
      employeeId: req.params.employeeId,
      kind: req.params.kind,
      adjustmentId: req.params.adjustmentId,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[manager-portal] employee adjustment cancel error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete adjustment" });
  }
});

router.post("/:token/staff/:employeeId/attendance", verifyManagerPortalToken, async (req, res) => {
  try {
    const result = await correctManagerPortalAttendance({
      manager: req.managerPortalManager,
      employeeId: req.params.employeeId,
      payload: req.body || {},
      request: { ip: managerRequestIp(req), userAgent: req.headers?.["user-agent"] || null },
    });
    return res.status(result.created ? 201 : 200).json({ success: true, ...result });
  } catch (error) {
    if (!error?.status) console.error("[manager-portal] attendance correction error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code || null, message: error.message || "Failed to save attendance correction" });
  }
});

router.patch("/:token/advance-requests/:requestId", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const request = await reviewManagerPortalAdvanceRequest({
      manager,
      requestId: req.params.requestId,
      status: req.body?.status,
      adminNote: req.body?.admin_note || "",
    });
    return res.json({ success: true, request });
  } catch (error) {
    console.error("[manager-portal] advance request review error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to review advance request" });
  }
});

router.get("/:token/tasks", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const tasks = await getManagerPortalTasks({ manager });
    return res.json({ success: true, tasks });
  } catch (error) {
    console.error("[manager-portal] tasks error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load tasks" });
  }
});

router.get("/:token/sales", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const sales = await getManagerPortalSales({ manager, profitToken: extractProfitToken(req) });
    return res.json({ success: true, sales });
  } catch (error) {
    console.error("[manager-portal] sales error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load sales analytics" });
  }
});

router.get("/:token/operations", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const operations = await getManagerPortalOperations({ manager, query: req.query || {} });
    return res.json({ success: true, ...operations });
  } catch (error) {
    console.error("[manager-portal] operations error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load invoice operations" });
  }
});

router.get("/:token/stock-alerts", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const stockAlerts = await getManagerPortalStockAlerts({ manager });
    return res.json({ success: true, stockAlerts });
  } catch (error) {
    console.error("[manager-portal] stock alerts error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load stock alerts" });
  }
});

router.get("/:token/inventory-approvals", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const inventoryApprovals = await getManagerPortalInventoryApprovals({ manager, query: req.query || {} });
    return res.json({ success: true, inventoryApprovals });
  } catch (error) {
    console.error("[manager-portal] inventory approvals error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load inventory approvals" });
  }
});

router.get("/:token/inventory-approvals/:sessionId", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const approval = await getManagerPortalInventoryApprovalSession({ manager, sessionId: req.params.sessionId });
    if (!approval) return res.status(404).json({ success: false, message: "Inventory count session not found" });
    return res.json({ success: true, approval });
  } catch (error) {
    console.error("[manager-portal] inventory approval detail error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load inventory approval" });
  }
});

router.post("/:token/inventory-approvals/:sessionId/approve", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const result = await approveManagerPortalInventoryApproval({ manager, sessionId: req.params.sessionId });
    return res.json({ success: true, session: result.session, adjustments: result.adjustments || [] });
  } catch (error) {
    console.error("[manager-portal] inventory approval approve error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to approve inventory count session" });
  }
});

router.post("/:token/inventory-approvals/:sessionId/reject", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const result = await rejectManagerPortalInventoryApproval({
      manager,
      sessionId: req.params.sessionId,
      rejectionReason: req.body?.rejectionReason || req.body?.rejection_reason || req.body?.reason || "",
    });
    return res.json({ success: true, session: result.session, rejected: result.rejected === true });
  } catch (error) {
    console.error("[manager-portal] inventory approval reject error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to reject inventory count session" });
  }
});

router.get("/:token/notifications", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const notifications = await getManagerPortalNotifications({ manager, query: req.query || {} });
    return res.json({ success: true, ...notifications });
  } catch (error) {
    console.error("[manager-portal] notifications error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load notifications" });
  }
});

router.post("/:token/notifications/:id/read", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const notification = await markManagerPortalNotificationRead({ manager, notificationId: req.params.id });
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });
    return res.json({ success: true, notification });
  } catch (error) {
    console.error("[manager-portal] notification read error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to mark notification as read" });
  }
});

router.post("/:token/notifications/read-all", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const count = await markManagerPortalNotificationsRead({ manager });
    return res.json({ success: true, count });
  } catch (error) {
    console.error("[manager-portal] notifications read all error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to mark notifications as read" });
  }
});

router.get("/:token/chat", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const chat = await getManagerPortalChat({ manager, threadId: req.query?.thread_id || req.query?.threadId || null });
    return res.json({ success: true, ...chat });
  } catch (error) {
    console.error("[manager-portal] chat load error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load chat" });
  }
});

router.get("/:token/chat/:threadId", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const chat = await getManagerPortalChatThread({ manager, threadId: req.params.threadId });
    return res.json({ success: true, ...chat });
  } catch (error) {
    console.error("[manager-portal] chat thread error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load chat thread" });
  }
});

router.post("/:token/chat/:threadId/ring", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const result = await sendManagerPortalChatRing({ manager, threadId: req.params.threadId });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (!error.status) console.error("[manager-portal] chat ring error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to ring" });
  }
});

router.post("/:token/chat/:threadId/ring/:messageId/answer", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const result = await answerManagerPortalChatRing({ manager, messageId: req.params.messageId });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (!error.status) console.error("[manager-portal] chat ring answer error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to answer ring" });
  }
});

router.post("/:token/chat/:threadId/read", async (req, res) => {
  try {
    const manager = await loadVerifiedManager(req, res);
    if (!manager) return;
    const thread = await markManagerPortalChatRead({ manager, threadId: req.params.threadId });
    return res.json({ success: true, ...thread });
  } catch (error) {
    console.error("[manager-portal] chat read error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to mark chat read" });
  }
});

router.post("/:token/chat/:threadId/messages", verifyManagerPortalToken, uploadManagerChatAttachment, async (req, res) => {
  try {
    const manager = req.managerPortalManager;
    const result = await sendManagerPortalChat({
      manager,
      threadId: req.params.threadId,
      body: req.body?.body || req.body?.message || "",
      file: req.file || null,
      replyToMessageId: req.body?.reply_to_message_id || req.body?.replyToMessageId || null,
      attachmentDurationSeconds: req.body?.attachment_duration_seconds || req.body?.duration || null,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("[manager-portal] chat send error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to send message" });
  }
});

router.post("/:token/tasks", verifyManagerPortalToken, async (req, res) => {
  try {
    const manager = req.managerPortalManager;
    const task = await createManagerPortalTask({ manager, data: req.body || {} });
    return res.status(201).json({ success: true, task });
  } catch (error) {
    console.error("[manager-portal] task create error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create task" });
  }
});

router.patch("/:token/tasks/:id", verifyManagerPortalToken, async (req, res) => {
  try {
    const task = await updateManagerPortalTask({ manager: req.managerPortalManager, taskId: req.params.id, data: req.body || {} });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    console.error("[manager-portal] task update error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update task" });
  }
});

router.delete("/:token/tasks/:id", verifyManagerPortalToken, async (req, res) => {
  try {
    const task = await deleteManagerPortalTask({ manager: req.managerPortalManager, taskId: req.params.id });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    console.error("[manager-portal] task delete error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete task" });
  }
});

router.patch("/:token/tasks/:id/approve", verifyManagerPortalToken, async (req, res) => {
  try {
    const manager = req.managerPortalManager;
    const task = await approveManagerPortalTask({ manager, taskId: req.params.id, note: req.body?.note || "" });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    console.error("[manager-portal] task approve error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to approve task" });
  }
});

router.patch("/:token/tasks/:id/reject", verifyManagerPortalToken, async (req, res) => {
  try {
    const manager = req.managerPortalManager;
    const task = await rejectManagerPortalTask({ manager, taskId: req.params.id, note: req.body?.note || "" });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    console.error("[manager-portal] task reject error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to reject task" });
  }
});

router.patch("/:token/tasks/:id/reopen", verifyManagerPortalToken, async (req, res) => {
  try {
    const manager = req.managerPortalManager;
    const task = await reopenManagerPortalTask({ manager, taskId: req.params.id, note: req.body?.note || "" });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    console.error("[manager-portal] task reopen error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to reopen task" });
  }
});

router.post("/:token/tasks/:id/notes", verifyManagerPortalToken, async (req, res) => {
  try {
    const manager = req.managerPortalManager;
    const comment = await noteManagerPortalTask({ manager, taskId: req.params.id, note: req.body?.note || req.body?.comment || "" });
    if (!comment) return res.status(404).json({ success: false, message: "Task not found" });
    return res.status(201).json({ success: true, comment });
  } catch (error) {
    console.error("[manager-portal] task note error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to add task note" });
  }
});

router.patch("/:token/settings", verifyManagerPortalToken, async (req, res) => {
  try {
    const manager = req.managerPortalManager;
    const notification_settings = await updateManagerPortalSettings({
      employeeId: manager.id,
      tenantId: manager.tenant_id || null,
      settings: req.body?.notification_settings || req.body?.settings || req.body || {},
    });
    return res.json({
      success: true,
      notification_settings,
    });
  } catch (error) {
    console.error("[manager-portal] settings update error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update settings" });
  }
});

router.post("/:token/profit/unlock", verifyManagerPortalToken, async (req, res) => {
  try {
    const manager = req.managerPortalManager;
    if (!canViewProfitForManager(manager)) {
      return res.status(403).json({ success: false, message: "Invalid profit password" });
    }
    const key = attemptKey(manager.tenant_id, manager.id);
    if (isRateLimited(key)) {
      return res.status(429).json({ success: false, message: "Too many attempts. Please try again later." });
    }
    const ok = await verifyProfitPin(req.body?.password);
    if (!ok) {
      registerFailedAttempt(key);
      console.info("[manager-portal:profit]", { requestId: req.id, managerId: manager.id, tenantId: manager.tenant_id, action: "unlock_failed" });
      return res.status(401).json({ success: false, message: "Invalid profit password" });
    }
    registerSuccess(key);
    const issued = await issueProfitToken({ managerId: manager.id, tenantId: manager.tenant_id });
    console.info("[manager-portal:profit]", { requestId: req.id, managerId: manager.id, tenantId: manager.tenant_id, action: "unlock_success" });
    return res.json({ success: true, profit_unlocked: true, expires_in: issued.expiresIn, profit_token: issued.token });
  } catch (error) {
    console.error("[manager-portal] profit unlock error", error?.message || error);
    return res.status(500).json({ success: false, message: "Invalid profit password" });
  }
});

router.post("/:token/profit/lock", verifyManagerPortalToken, async (req, res) => {
  try {
    const manager = req.managerPortalManager;
    await revokeProfitToken(extractProfitToken(req) || req.body?.profit_token);
    console.info("[manager-portal:profit]", { requestId: req.id, managerId: manager.id, tenantId: manager.tenant_id, action: "manual_relock" });
    return res.json({ success: true, profit_locked: true });
  } catch (error) {
    console.error("[manager-portal] profit lock error", error?.message || error);
    return res.json({ success: true, profit_locked: true });
  }
});

export default router;
