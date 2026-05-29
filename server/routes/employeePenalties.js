import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  cancelEmployeePenaltyRecord,
  createEmployeePenaltyRecord,
  getEmployeePenalties,
  updateEmployeePenaltyRecord,
} from "../controllers/employeesController.js";

const router = express.Router();

router.get("/employees/:employeeId/penalties", protect, permit("employees", "view"), getEmployeePenalties);
router.post("/employees/:employeeId/penalties", protect, permit("employees", "edit"), createEmployeePenaltyRecord);
router.patch("/employee-penalties/:id", protect, permit("employees", "edit"), updateEmployeePenaltyRecord);
router.delete("/employee-penalties/:id", protect, permit("employees", "edit"), cancelEmployeePenaltyRecord);

export default router;
