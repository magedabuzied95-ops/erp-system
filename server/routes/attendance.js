import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  checkIn,
  checkOut,
  createEmployee,
  createEmployeeShift,
  deleteEmployee,
  getDailyReport,
  getEmployeeReport,
  getEmployeeShifts,
  getEmployees,
  getBranchReport,
  getAttendanceKioskSnapshot,
  getAttendanceToday,
  getAttendanceReports,
  getAttendanceSchedules,
  generateAttendanceOpeningSchedule,
  getAttendanceDashboard,
  getAttendanceList,
  getAttendanceLive,
  getAttendancePayrollImpact,
  getAttendanceOvertimeApprovals,
  updateAttendanceOvertimeApproval,
  getAttendanceCenterReports,
  getAttendanceLeaves,
  getAttendanceQrSessions,
  getAttendanceDevices,
  getAttendanceDeviceSettings,
  getAttendanceHrSettings,
  getBranchAttendanceQr,
  scanQrAttendance,
  getPublicBranchAttendance,
  identifyPublicBranchEmployee,
  recordPublicBranchAttendance,
  approveAttendanceDevice,
  rejectAttendanceDevice,
  resetEmployeeAttendanceDevice,
  updateAttendanceDeviceSettings,
  updateAttendanceHrSettings,
  updateEmployee,
  updateEmployeeShift,
} from "../controllers/attendanceController.js";

const router = express.Router();

router.get("/branch-entry/:branchKey", getPublicBranchAttendance);
router.get("/public/branch/:token", getPublicBranchAttendance);
router.post("/public/branch/:token/identify", identifyPublicBranchEmployee);
router.post("/public/branch/:token/actions", recordPublicBranchAttendance);

router.get("/employees", protect, permit("attendance", "view"), getEmployees);
router.post("/employees", protect, permit("attendance", "create"), createEmployee);
router.put("/employees/:id", protect, permit("attendance", "edit"), updateEmployee);
router.delete("/employees/:id", protect, permit("attendance", "delete"), deleteEmployee);
router.get("/employees/:id/shifts", protect, permit("attendance", "view"), getEmployeeShifts);
router.post("/employees/:id/shifts", protect, permit("attendance", "edit"), createEmployeeShift);
router.put("/shifts/:id", protect, permit("attendance", "edit"), updateEmployeeShift);

router.get("/reports/daily", protect, permit("attendance", "view"), getDailyReport);
router.get("/reports/employee/:id", protect, permit("attendance", "view"), getEmployeeReport);
router.get("/reports/branch", protect, permit("attendance", "view"), getBranchReport);
router.get("/dashboard", protect, permit("attendance", "view"), getAttendanceDashboard);
router.get("/schedules", protect, permit("attendance", "view"), getAttendanceSchedules);
router.post("/schedules/opening/generate", protect, permit("attendance", "edit"), generateAttendanceOpeningSchedule);
router.get("/list", protect, permit("attendance", "view"), getAttendanceList);
router.get("/live", protect, permit("attendance", "view"), getAttendanceLive);
router.get("/payroll-impact", protect, permit("attendance", "view"), getAttendancePayrollImpact);
router.get("/overtime-approvals", protect, permit("attendance", "view"), getAttendanceOvertimeApprovals);
router.put("/overtime-approvals/:id", protect, permit("attendance", "edit"), updateAttendanceOvertimeApproval);
router.get("/center-reports", protect, permit("attendance", "view"), getAttendanceCenterReports);
router.get("/leaves", protect, permit("attendance", "view"), getAttendanceLeaves);
router.get("/qr-sessions", protect, permit("attendance", "view"), getAttendanceQrSessions);
router.get("/today", protect, permit("attendance", "view"), getAttendanceToday);
router.get("/reports", protect, permit("attendance", "view"), getAttendanceReports);
router.get("/devices", protect, permit("attendance", "view"), getAttendanceDevices);
router.get("/devices/settings", protect, permit("attendance", "view"), getAttendanceDeviceSettings);
router.put("/devices/settings", protect, permit("attendance", "edit"), updateAttendanceDeviceSettings);
router.get("/settings/hr", protect, permit("attendance", "view"), getAttendanceHrSettings);
router.put("/settings/hr", protect, permit("attendance", "edit"), updateAttendanceHrSettings);
router.post("/devices/:id/approve", protect, permit("attendance", "edit"), approveAttendanceDevice);
router.post("/devices/:id/reject", protect, permit("attendance", "edit"), rejectAttendanceDevice);
router.post("/employees/:id/reset-device", protect, permit("attendance", "edit"), resetEmployeeAttendanceDevice);
router.get("/branch-qr/:branchId", protect, permit("attendance", "view"), getBranchAttendanceQr);

router.post("/check-in", protect, permit("attendance", "create"), checkIn);
router.post("/check-out", protect, permit("attendance", "create"), checkOut);
router.post("/qr-scan", protect, permit("attendance", "create"), scanQrAttendance);
router.get("/kiosk", protect, permit("attendance", "view"), getAttendanceKioskSnapshot);

export default router;
