import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  checkIn,
  checkOut,
  createEmployee,
  createEmployeeShift,
  getDailyReport,
  getEmployeeReport,
  getEmployeeShifts,
  getEmployees,
  getBranchReport,
  getAttendanceKioskSnapshot,
  getAttendanceToday,
  getAttendanceReports,
  scanQrAttendance,
  updateEmployee,
  updateEmployeeShift,
} from "../controllers/attendanceController.js";

const router = express.Router();

router.get("/employees", protect, permit("attendance", "view"), getEmployees);
router.post("/employees", protect, permit("attendance", "create"), createEmployee);
router.put("/employees/:id", protect, permit("attendance", "edit"), updateEmployee);
router.get("/employees/:id/shifts", protect, permit("attendance", "view"), getEmployeeShifts);
router.post("/employees/:id/shifts", protect, permit("attendance", "edit"), createEmployeeShift);
router.put("/shifts/:id", protect, permit("attendance", "edit"), updateEmployeeShift);

router.get("/reports/daily", protect, permit("attendance", "view"), getDailyReport);
router.get("/reports/employee/:id", protect, permit("attendance", "view"), getEmployeeReport);
router.get("/reports/branch", protect, permit("attendance", "view"), getBranchReport);
router.get("/today", protect, permit("attendance", "view"), getAttendanceToday);
router.get("/reports", protect, permit("attendance", "view"), getAttendanceReports);

router.post("/check-in", protect, permit("attendance", "create"), checkIn);
router.post("/check-out", protect, permit("attendance", "create"), checkOut);
router.post("/qr-scan", protect, permit("attendance", "create"), scanQrAttendance);
router.get("/kiosk", protect, permit("attendance", "view"), getAttendanceKioskSnapshot);

export default router;
