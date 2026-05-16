import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  getAnalyticsOverview,
  getAiInsights,
  getCustomerIntelligence,
  getCustomerAnalytics,
  getDeadStockAnalysis,
  getInventoryIntelligence,
  getProfitAnalytics,
  getReorderSuggestions,
  getSalesAnalytics,
} from "../controllers/analyticsController.js";

const router = express.Router();

router.get("/overview", protect, permit("reports", "view"), getAnalyticsOverview);
router.get("/sales", protect, permit("reports", "view"), getSalesAnalytics);
router.get("/profit", protect, permit("reports", "view"), getProfitAnalytics);
router.get("/inventory", protect, permit("reports", "view"), getInventoryIntelligence);
router.get("/customers", protect, permit("reports", "view"), getCustomerAnalytics);
router.get("/ai-insights", protect, permit("reports", "view"), getAiInsights);
router.get("/reorder-suggestions", protect, permit("reports", "view"), getReorderSuggestions);
router.get("/dead-stock", protect, permit("reports", "view"), getDeadStockAnalysis);
router.get("/customer-intelligence", protect, permit("reports", "view"), getCustomerIntelligence);

export default router;
