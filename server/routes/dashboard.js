import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  aiInsights,
  branchPerformance,
  hourlySales,
  inventory,
  liveActivity,
  lowStock,
  marketing,
  overview,
  paymentAnalytics,
  posLive,
  salesTrend,
  topProducts,
} from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/overview", protect, overview);
router.get("/sales-trend", protect, salesTrend);
router.get("/top-products", protect, topProducts);
router.get("/low-stock", protect, lowStock);
router.get("/live-activity", protect, liveActivity);
router.get("/branch-performance", protect, branchPerformance);
router.get("/payment-analytics", protect, paymentAnalytics);
router.get("/hourly-sales", protect, hourlySales);
router.get("/marketing", protect, marketing);
router.get("/pos-live", protect, posLive);
router.get("/inventory", protect, inventory);
router.get("/ai-insights", protect, aiInsights);

export default router;
