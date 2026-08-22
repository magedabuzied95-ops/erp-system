import express from "express";
import employeeChatUpload from "../config/employeeChatUpload.js";
import db from "../database/db.js";
import { getEmployeeChat, sendEmployeeChatMessage } from "../services/employeeChatService.js";

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
 * "My" chat: the employee side of the management chat for a JWT login that is
 * linked to an employee row (the POS cashier). Deliberately gated by `protect`
 * only — a cashier has no `employees` permission — and the employee is
 * resolved by the strict `employees.user_id` link, never by name or email:
 * a fuzzy match here would hand someone another employee's private thread.
 */
const loadLinkedEmployee = async (req, res) => {
  const userId = Number(req.user?.id || 0);
  if (!userId) {
    res.status(401).json({ success: false, code: "unauthorized", message: "Unauthorized" });
    return null;
  }
  const result = await db.query(
    `
    SELECT e.id, e.tenant_id, e.branch_id, e.full_name, e.employee_code, e.user_id, b.name AS branch_name
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE e.user_id = $1
      AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint)
      AND COALESCE(e.is_deleted, FALSE) = FALSE
    ORDER BY e.id DESC
    LIMIT 1
    `,
    [userId, req.tenantId || null]
  );
  const employee = result.rows[0];
  if (!employee) {
    res.status(404).json({ success: false, code: "employee_not_linked", message: "No employee is linked to this account" });
    return null;
  }
  return employee;
};

router.get("/chat/me", protect, async (req, res) => {
  try {
    const employee = await loadLinkedEmployee(req, res);
    if (!employee) return;
    const chat = await getEmployeeChat({ employee });
    return res.json({ success: true, employee, ...chat });
  } catch (error) {
    console.error("[employees] my chat load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load chat" });
  }
});

router.post("/chat/me/messages", protect, uploadEmployeeChatAttachment, async (req, res) => {
  try {
    const employee = await loadLinkedEmployee(req, res);
    if (!employee) return;
    const result = await sendEmployeeChatMessage({
      employee,
      body: req.body?.body || req.body?.message || "",
      file: req.file || null,
      replyToMessageId: req.body?.reply_to_message_id || req.body?.replyToMessageId || null,
      attachmentDurationSeconds: req.body?.attachment_duration_seconds || req.body?.duration || null,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("[employees] my chat send error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to send message" });
  }
});

router.post("/chat/me/read", protect, async (req, res) => {
  try {
    const employee = await loadLinkedEmployee(req, res);
    if (!employee) return;
    // getEmployeeChat marks every admin message read and tells the admin room.
    const chat = await getEmployeeChat({ employee });
    return res.json({ success: true, thread: chat.thread });
  } catch (error) {
    console.error("[employees] my chat read error", error);
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
