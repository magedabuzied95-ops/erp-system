import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createSalesEmployee,
  finalizeSalesEmployeePayroll,
  getSalesEmployees,
  getSalesEmployeeProfiles,
  getSalesEmployeePayrollPreview,
  markSalesEmployeePayrollAsPaid,
  upsertSalesEmployeeProfile,
  updateSalesEmployee,
  updateSalesEmployeeSettings,
} from "../controllers/salesEmployeesController.js";

const router = express.Router();

router.get("/", protect, getSalesEmployees);
router.get("/profiles", protect, getSalesEmployeeProfiles);
router.post("/profiles/:employee_id", protect, permit("employees", "edit"), upsertSalesEmployeeProfile);
router.put("/profiles/:employee_id", protect, permit("employees", "edit"), upsertSalesEmployeeProfile);
router.get("/:id/payroll-preview", protect, permit("employees", "view"), getSalesEmployeePayrollPreview);
router.post("/:id/payroll-finalize", protect, permit("employees", "edit"), finalizeSalesEmployeePayroll);
router.post("/:id/payroll-paid", protect, permit("employees", "edit"), markSalesEmployeePayrollAsPaid);
router.post("/", protect, permit("employees", "edit"), createSalesEmployee);
router.put("/settings", protect, permit("employees", "edit"), updateSalesEmployeeSettings);
router.put("/:id", protect, permit("employees", "edit"), updateSalesEmployee);

export default router;
