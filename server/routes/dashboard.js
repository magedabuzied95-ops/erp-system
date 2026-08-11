import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
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

// Every route below returns tenant financial data (revenue, profit, payment mix,
// branch performance, stock valuation). They previously ran on `protect` alone, so
// any authenticated user could read them regardless of role. `dashboard:view` already
// exists in the frontend permission matrix (rbacStore MODULE_ACTIONS.dashboard) and is
// seeded + backfilled to existing roles by ensureCorePermissions, so current access is
// preserved while the endpoints become revocable and auditable.
const viewDashboard = permit("dashboard", "view");

router.get("/overview", protect, viewDashboard, overview);
router.get("/sales-trend", protect, viewDashboard, salesTrend);
router.get("/top-products", protect, viewDashboard, topProducts);
router.get("/low-stock", protect, viewDashboard, lowStock);
router.get("/live-activity", protect, viewDashboard, liveActivity);
router.get("/branch-performance", protect, viewDashboard, branchPerformance);
router.get("/payment-analytics", protect, viewDashboard, paymentAnalytics);
router.get("/hourly-sales", protect, viewDashboard, hourlySales);
router.get("/marketing", protect, viewDashboard, marketing);
router.get("/pos-live", protect, viewDashboard, posLive);
router.get("/inventory", protect, viewDashboard, inventory);
router.get("/ai-insights", protect, viewDashboard, aiInsights);

export default router;
