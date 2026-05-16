import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  getSalesCommissionPayroll,
  getSalesCommissionsReport,
} from "../controllers/salesCommissionsController.js";

const router = express.Router();

router.get("/report", protect, permit("employees", "view"), getSalesCommissionsReport);
router.get("/payroll/:employeeId", protect, permit("employees", "view"), getSalesCommissionPayroll);

export default router;
