import express from "express";
import employeeChatUpload from "../config/employeeChatUpload.js";
import {
  answerAdminChatRing,
  answerBranchPosChatRing,
  getBranchPosChat,
  markBranchPosChatDelivered,
  markAdminEmployeeChatThreadDelivered,
  updateAdminEmployeeChatThreadPrefs,
  sendAdminChatRing,
  sendBranchPosChatMessage,
  sendBranchPosChatRing,
} from "../services/employeeChatService.js";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { repairMissingEmployeePortalTokens } from "../services/employeePayrollPortalService.js";
import { getSalesOpportunitiesForScope } from "../services/salesOpportunityService.js";
import {
  cleanupFakeEmployees,
  createCommissionRule,
  createEmployeePenaltyRecord,
  deleteEmployeeChatThreadMessageRecord,
  cancelEmployeePenaltyRecord,
  getEmployees,
  getCommissions,
  getCommissionRules,
  getEmployeePenalties,
  getEmployeeGamificationSettingsRecord,
  getEmployeeChatThreadRecord,
  getEmployeeChatThreads,
  forwardEmployeeChatThreadMessageRecord,
  reactEmployeeChatThreadMessageRecord,
  getEmployeePortalRequests,
  getSalesPerformance,
  getTopPerformers,
  grantEmployeeRewardRecord,
  markEmployeeChatThreadReadRecord,
  regenerateEmployeePayrollPortalToken,
  regenerateManagerPortalTokenRecord,
  reviewEmployeePortalRequestRecord,
  sendEmployeeChatThreadMessageRecord,
  updateCommissionRule,
  updateEmployeePenaltyRecord,
  updateEmployeePayrollSettings,
  updateEmployeeGamificationSettingsRecord,
  updateEmployeeChatThreadMessageRecord,
  repairMissingManagerPortalTokensRecord,
} from "../controllers/employeesController.js";

const router = express.Router();

const uploadEmployeeChatAttachment = (req, res, next) => {
  employeeChatUpload.single("attachment")(req, res, (error) => {
    if (!error) return next();
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "chat_attachment_invalid",
      message: error.code === "LIMIT_FILE_SIZE" ? "Attachment is too large" : error.message || "Unsupported attachment",
    });
  });
};

const logPortalTokenRegenerateRouteHit = (req, _res, next) => {
  console.info("[employees] portal token regenerate route hit", {
    requestId: req.id,
    employeeId: req.params.employeeId,
    method: req.method,
    url: req.originalUrl,
  });
  next();
};

const repairMissingEmployeePayrollPortalTokens = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id || req.user?.tenantId || null;
    const result = await repairMissingEmployeePortalTokens({
      tenantId,
      limit: req.body?.limit || req.query?.limit || 500,
    });
    console.info("[employees] missing payroll portal tokens repaired", {
      requestId: req.id,
      tenantId,
      scanned: result.scanned,
      repaired_count: result.repaired_count,
    });
    return res.json({
      success: true,
      scanned: result.scanned,
      repaired_count: result.repaired_count,
      repaired_employee_ids: result.repaired.map((employee) => employee.id),
    });
  } catch (error) {
    console.error("[employees] repair missing payroll portal tokens error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to repair employee portal tokens" });
  }
};

router.get("/", protect, permit("employees", "view"), getEmployees);
router.post("/cleanup/fake-legacy", protect, permit("employees", "delete"), cleanupFakeEmployees);
router.get("/sales-performance", protect, permit("employees", "view"), getSalesPerformance);
router.get("/sales-opportunities", protect, permit("employees", "view"), async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id || req.user?.tenantId || null;
    const branchId = req.query?.branch_id || req.query?.branchId || req.user?.branch_id || req.user?.branchId || null;
    const opportunities = await getSalesOpportunitiesForScope({
      tenantId,
      branchId,
    });
    return res.json({ success: true, opportunities });
  } catch (error) {
    console.error("[employees] sales opportunities load error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load sales opportunities" });
  }
});
router.get("/commissions", protect, permit("employees", "view"), getCommissions);
router.get("/top-performers", protect, permit("employees", "view"), getTopPerformers);
router.get("/commission-rules", protect, permit("employees", "view"), getCommissionRules);
router.post("/commission-rules", protect, permit("employees", "edit"), createCommissionRule);
router.put("/commission-rules/:id", protect, permit("employees", "edit"), updateCommissionRule);
router.get("/portal-requests", protect, permit("employees", "view"), getEmployeePortalRequests);
router.patch("/portal-requests/:id", protect, permit("employees", "edit"), reviewEmployeePortalRequestRecord);
/*
 * Branch POS channel: "كاشير فرع X". The cashier side of this thread is
 * whichever POS device is on that branch — no employee link required. Gated by
 * `protect` only (a cashier has no `employees` permission); the branch must
 * belong to the caller's tenant, which the service enforces.
 */
const posChannelBranchId = (req) => Number(req.query?.branch_id || req.body?.branch_id || req.params?.branchId || 0) || null;
const posChannelSenderName = (req) => String(req.user?.name || req.user?.full_name || req.user?.username || req.user?.email || "").trim();

router.get("/chat/pos", protect, async (req, res) => {
  try {
    const chat = await getBranchPosChat({ tenantId: req.tenantId || null, branchId: posChannelBranchId(req), beforeId: req.query?.before || req.query?.before_id || null, limit: req.query?.limit || null });
    return res.json({ success: true, ...chat });
  } catch (error) {
    if (!error.status) console.error("[employees] pos channel load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load chat" });
  }
});

router.post("/chat/pos/messages", protect, uploadEmployeeChatAttachment, async (req, res) => {
  try {
    const result = await sendBranchPosChatMessage({
      tenantId: req.tenantId || null,
      branchId: posChannelBranchId(req),
      userId: req.user?.id || null,
      senderName: posChannelSenderName(req),
      body: req.body?.body || req.body?.message || "",
      file: req.file || null,
      replyToMessageId: req.body?.reply_to_message_id || req.body?.replyToMessageId || null,
      attachmentDurationSeconds: req.body?.attachment_duration_seconds || req.body?.duration || null,
      clientId: req.body?.client_id || req.body?.clientId || null,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (!error.status) console.error("[employees] pos channel send error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to send message" });
  }
});

const chatFailure = (res, error, fallback) => {
  if (!error.status) console.error("[employees] chat error", error);
  return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || fallback });
};

router.post("/chat/pos/ring", protect, async (req, res) => {
  try {
    const result = await sendBranchPosChatRing({ tenantId: req.tenantId || null, branchId: posChannelBranchId(req), userId: req.user?.id || null, senderName: posChannelSenderName(req) });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return chatFailure(res, error, "Failed to ring");
  }
});

router.post("/chat/pos/ring/:messageId/answer", protect, async (req, res) => {
  try {
    const result = await answerBranchPosChatRing({ tenantId: req.tenantId || null, branchId: posChannelBranchId(req), messageId: req.params.messageId, answeredBy: posChannelSenderName(req) });
    return res.json({ success: true, ...result });
  } catch (error) {
    return chatFailure(res, error, "Failed to answer ring");
  }
});

router.post("/chat/threads/:threadId/ring", protect, permit("employees", "edit"), async (req, res) => {
  try {
    const result = await sendAdminChatRing({ tenantId: req.tenantId || null, threadId: req.params.threadId, userId: req.user?.id || null, senderName: posChannelSenderName(req) });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return chatFailure(res, error, "Failed to ring");
  }
});

router.post("/chat/threads/:threadId/ring/:messageId/answer", protect, permit("employees", "edit"), async (req, res) => {
  try {
    const result = await answerAdminChatRing({ tenantId: req.tenantId || null, messageId: req.params.messageId, answeredBy: posChannelSenderName(req) });
    return res.json({ success: true, ...result });
  } catch (error) {
    return chatFailure(res, error, "Failed to answer ring");
  }
});

router.post("/chat/pos/delivered", protect, async (req, res) => {
  try {
    const result = await markBranchPosChatDelivered({ tenantId: req.tenantId || null, branchId: posChannelBranchId(req), upToMessageId: req.body?.up_to_message_id || null });
    return res.json({ success: true, ...result });
  } catch (error) {
    return chatFailure(res, error, "Failed to mark delivered");
  }
});

router.patch("/chat/threads/:threadId/prefs", protect, permit("employees", "edit"), async (req, res) => {
  try {
    const result = await updateAdminEmployeeChatThreadPrefs({ tenantId: req.tenantId || null, threadId: req.params.threadId, pinned: req.body?.pinned, muted_until: req.body?.muted_until, archived: req.body?.archived });
    return res.json({ success: true, ...result });
  } catch (error) {
    return chatFailure(res, error, "Failed to update conversation");
  }
});

router.post("/chat/threads/:threadId/delivered", protect, permit("employees", "view"), async (req, res) => {
  try {
    const result = await markAdminEmployeeChatThreadDelivered({ tenantId: req.tenantId || null, threadId: req.params.threadId, upToMessageId: req.body?.up_to_message_id || null });
    return res.json({ success: true, ...result });
  } catch (error) {
    return chatFailure(res, error, "Failed to mark delivered");
  }
});

router.post("/chat/pos/read", protect, async (req, res) => {
  try {
    // getBranchPosChat marks every admin message read and tells the admin room.
    const chat = await getBranchPosChat({ tenantId: req.tenantId || null, branchId: posChannelBranchId(req) });
    return res.json({ success: true, thread: chat.thread });
  } catch (error) {
    if (!error.status) console.error("[employees] pos channel read error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to mark chat read" });
  }
});


router.get("/chat/threads", protect, permit("employees", "view"), getEmployeeChatThreads);
router.get("/chat/threads/:threadId", protect, permit("employees", "view"), getEmployeeChatThreadRecord);
router.post("/chat/threads/:threadId/messages", protect, permit("employees", "edit"), uploadEmployeeChatAttachment, sendEmployeeChatThreadMessageRecord);
router.post("/chat/messages/:messageId/forward", protect, permit("employees", "edit"), forwardEmployeeChatThreadMessageRecord);
router.post("/chat/messages/:messageId/reaction", protect, permit("employees", "edit"), reactEmployeeChatThreadMessageRecord);
router.patch("/chat/threads/:threadId/messages/:messageId", protect, permit("employees", "edit"), updateEmployeeChatThreadMessageRecord);
router.delete("/chat/threads/:threadId/messages/:messageId", protect, permit("employees", "edit"), deleteEmployeeChatThreadMessageRecord);
router.patch("/chat/threads/:threadId/read", protect, permit("employees", "edit"), markEmployeeChatThreadReadRecord);
router.get("/gamification/settings", protect, permit("employees", "view"), getEmployeeGamificationSettingsRecord);
router.patch("/gamification/settings", protect, permit("employees", "edit"), updateEmployeeGamificationSettingsRecord);
router.post("/gamification/rewards", protect, permit("employees", "edit"), grantEmployeeRewardRecord);
router.patch("/:employeeId/payroll-settings", protect, permit("employees", "edit"), updateEmployeePayrollSettings);
router.post("/portal-token/repair-missing", protect, permit("employees", "edit"), repairMissingEmployeePayrollPortalTokens);
router.post("/:employeeId/portal-token/regenerate", logPortalTokenRegenerateRouteHit, protect, permit("employees", "edit"), regenerateEmployeePayrollPortalToken);
router.post("/manager-portal-token/repair-missing", protect, permit("employees", "edit"), repairMissingManagerPortalTokensRecord);
router.post("/:employeeId/manager-portal-token/regenerate", logPortalTokenRegenerateRouteHit, protect, permit("employees", "edit"), regenerateManagerPortalTokenRecord);
router.get("/:employeeId/penalties", protect, permit("employees", "view"), getEmployeePenalties);
router.post("/:employeeId/penalties", protect, permit("employees", "edit"), createEmployeePenaltyRecord);
router.patch("/employee-penalties/:id", protect, permit("employees", "edit"), updateEmployeePenaltyRecord);
router.delete("/employee-penalties/:id", protect, permit("employees", "edit"), cancelEmployeePenaltyRecord);

export default router;
