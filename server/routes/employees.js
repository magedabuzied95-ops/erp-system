import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createCommissionRule,
  getCommissions,
  getCommissionRules,
  getSalesPerformance,
  getTopPerformers,
  updateCommissionRule,
} from "../controllers/employeesController.js";

const router = express.Router();

router.get("/sales-performance", protect, permit("employees", "view"), getSalesPerformance);
router.get("/commissions", protect, permit("employees", "view"), getCommissions);
router.get("/top-performers", protect, permit("employees", "view"), getTopPerformers);
router.get("/commission-rules", protect, permit("employees", "view"), getCommissionRules);
router.post("/commission-rules", protect, permit("employees", "edit"), createCommissionRule);
router.put("/commission-rules/:id", protect, permit("employees", "edit"), updateCommissionRule);

export default router;
