import express from "express";
import employeeChatUpload from "../config/employeeChatUpload.js";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  cleanupFakeEmployees,
  createCommissionRule,
  createEmployeePenaltyRecord,
  cancelEmployeePenaltyRecord,
  getEmployees,
  getCommissions,
  getCommissionRules,
  getEmployeePenalties,
  getEmployeeGamificationSettingsRecord,
  getEmployeeChatThreadRecord,
  getEmployeeChatThreads,
  getEmployeePortalRequests,
  getSalesPerformance,
  getTopPerformers,
  grantEmployeeRewardRecord,
  markEmployeeChatThreadReadRecord,
  repairMissingEmployeePayrollPortalTokens,
  regenerateEmployeePayrollPortalToken,
  reviewEmployeePortalRequestRecord,
  sendEmployeeChatThreadMessageRecord,
  updateCommissionRule,
  updateEmployeePenaltyRecord,
  updateEmployeePayrollSettings,
  updateEmployeeGamificationSettingsRecord,
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

router.get("/", protect, permit("employees", "view"), getEmployees);
router.post("/cleanup/fake-legacy", protect, permit("employees", "delete"), cleanupFakeEmployees);
router.get("/sales-performance", protect, permit("employees", "view"), getSalesPerformance);
router.get("/commissions", protect, permit("employees", "view"), getCommissions);
router.get("/top-performers", protect, permit("employees", "view"), getTopPerformers);
router.get("/commission-rules", protect, permit("employees", "view"), getCommissionRules);
router.post("/commission-rules", protect, permit("employees", "edit"), createCommissionRule);
router.put("/commission-rules/:id", protect, permit("employees", "edit"), updateCommissionRule);
router.get("/portal-requests", protect, permit("employees", "view"), getEmployeePortalRequests);
router.patch("/portal-requests/:id", protect, permit("employees", "edit"), reviewEmployeePortalRequestRecord);
router.get("/chat/threads", protect, permit("employees", "view"), getEmployeeChatThreads);
router.get("/chat/threads/:threadId", protect, permit("employees", "view"), getEmployeeChatThreadRecord);
router.post("/chat/threads/:threadId/messages", protect, permit("employees", "edit"), uploadEmployeeChatAttachment, sendEmployeeChatThreadMessageRecord);
router.patch("/chat/threads/:threadId/read", protect, permit("employees", "edit"), markEmployeeChatThreadReadRecord);
router.get("/gamification/settings", protect, permit("employees", "view"), getEmployeeGamificationSettingsRecord);
router.patch("/gamification/settings", protect, permit("employees", "edit"), updateEmployeeGamificationSettingsRecord);
router.post("/gamification/rewards", protect, permit("employees", "edit"), grantEmployeeRewardRecord);
router.patch("/:employeeId/payroll-settings", protect, permit("employees", "edit"), updateEmployeePayrollSettings);
router.post("/portal-token/repair-missing", protect, permit("employees", "edit"), repairMissingEmployeePayrollPortalTokens);
router.post("/:employeeId/portal-token/regenerate", logPortalTokenRegenerateRouteHit, protect, permit("employees", "edit"), regenerateEmployeePayrollPortalToken);
router.get("/:employeeId/penalties", protect, permit("employees", "view"), getEmployeePenalties);
router.post("/:employeeId/penalties", protect, permit("employees", "edit"), createEmployeePenaltyRecord);
router.patch("/employee-penalties/:id", protect, permit("employees", "edit"), updateEmployeePenaltyRecord);
router.delete("/employee-penalties/:id", protect, permit("employees", "edit"), cancelEmployeePenaltyRecord);

export default router;
