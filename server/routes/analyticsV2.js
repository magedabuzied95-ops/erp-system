import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  getOverview,
  getSalesBreakdownController,
  getSalesProductsController,
  getSalesSizesController,
  getSalesSummaryController,
} from "../controllers/analyticsV2Controller.js";

const router = express.Router();

// reports:view is the entry gate. reports:cost and reports:profit are resolved inside
// the service layer (analyticsScope) and control which columns are computed at all,
// so a caller without them never receives a cost or profit value in the response.
const viewReports = permit("reports", "view");

router.get("/overview", protect, viewReports, getOverview);

// R3 — Sales & Profit Intelligence. Four endpoints so the page can load in parallel
// and degrade section by section rather than blocking on one large query.
router.get("/sales/summary", protect, viewReports, getSalesSummaryController);
router.get("/sales/breakdown", protect, viewReports, getSalesBreakdownController);
router.get("/sales/products", protect, viewReports, getSalesProductsController);
router.get("/sales/sizes", protect, viewReports, getSalesSizesController);

export default router;
