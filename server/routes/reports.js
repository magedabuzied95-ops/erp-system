import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  exportReport,
  getAiInsights,
  getCustomerReports,
  getEmployeeReports,
  getFinancialReports,
  getInventoryReports,
  getReportsDashboard,
  getSalesReports,
} from "../controllers/reportsController.js";

const router = express.Router();

router.get("/dashboard", protect, permit("reports", "view"), getReportsDashboard);
router.get("/sales", protect, permit("reports", "view"), getSalesReports);
router.get("/employees", protect, permit("reports", "view"), getEmployeeReports);
router.get("/inventory", protect, permit("reports", "view"), getInventoryReports);
router.get("/customers", protect, permit("reports", "view"), getCustomerReports);
router.get("/financial", protect, permit("reports", "view"), getFinancialReports);
router.get("/insights", protect, permit("reports", "view"), getAiInsights);
router.get("/export", protect, permit("reports", "view"), exportReport);

export default router;
