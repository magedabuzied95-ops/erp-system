import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createSalesEmployee,
  getSalesEmployees,
  updateSalesEmployee,
  updateSalesEmployeeSettings,
} from "../controllers/salesEmployeesController.js";

const router = express.Router();

router.get("/", protect, getSalesEmployees);
router.post("/", protect, permit("employees", "edit"), createSalesEmployee);
router.put("/settings", protect, permit("employees", "edit"), updateSalesEmployeeSettings);
router.put("/:id", protect, permit("employees", "edit"), updateSalesEmployee);

export default router;
