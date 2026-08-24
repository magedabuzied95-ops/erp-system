import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  getCustomersBreakdownController,
  getCustomersListController,
  getCustomersSummaryController,
  getEmployeesBreakdownController,
  getEmployeesListController,
  getEmployeesSummaryController,
  getInventoryBreakdownController,
  getInventoryProductsController,
  getInventorySizesController,
  getInventorySummaryController,
  createPresetController,
  deletePresetController,
  getFilterOptionsController,
  importPresetsController,
  listPresetsController,
  updatePresetController,
  getOverview,
  getReconciliationController,
  getPurchasingBreakdownController,
  getPurchasingProductsController,
  getPurchasingSummaryController,
  getPurchasingSuppliersController,
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

// R4 — Inventory Intelligence. Four endpoints so the page loads in parallel and each
// section degrades on its own, exactly as R3 does.
router.get("/inventory/summary", protect, viewReports, getInventorySummaryController);
router.get("/inventory/breakdown", protect, viewReports, getInventoryBreakdownController);
router.get("/inventory/products", protect, viewReports, getInventoryProductsController);
router.get("/inventory/sizes", protect, viewReports, getInventorySizesController);

// R5 — Purchasing & Supplier Intelligence. Same shape again: summary, one-dimension
// breakdown, per-product price trend, per-supplier performance.
router.get("/purchasing/summary", protect, viewReports, getPurchasingSummaryController);
router.get("/purchasing/breakdown", protect, viewReports, getPurchasingBreakdownController);
router.get("/purchasing/products", protect, viewReports, getPurchasingProductsController);
router.get("/purchasing/suppliers", protect, viewReports, getPurchasingSuppliersController);

// R6 — Customer Intelligence. Aggregated intelligence only; the named list is gated a
// second time on customers:view inside the service.
router.get("/customers/summary", protect, viewReports, getCustomersSummaryController);
router.get("/customers/breakdown", protect, viewReports, getCustomersBreakdownController);
router.get("/customers/list", protect, viewReports, getCustomersListController);

// R9 — Employee & Channel Intelligence. Who sold it, who rang it up, through which
// channel. Revenue only: COGS lives on the line and a line has no seller.
router.get("/employees/summary", protect, viewReports, getEmployeesSummaryController);
router.get("/employees/breakdown", protect, viewReports, getEmployeesBreakdownController);
router.get("/employees/list", protect, viewReports, getEmployeesListController);

// R10 — Reconciliation. Cost and profit comparisons are withheld inside the service for
// a caller without those permissions, so the entry gate stays reports:view like the rest.
router.get("/reconciliation", protect, viewReports, getReconciliationController);

// The values every filter control can take, scoped to what this caller can see.
router.get("/filter-options", protect, viewReports, getFilterOptionsController);

/*
 * Saved presets. Same reports:view gate as every report — a preset is a saved question
 * about the reports, so anyone who may read a report may save one. Ownership is enforced
 * inside the service by user id in the WHERE clause, not by the route.
 */
router.get("/presets", protect, viewReports, listPresetsController);
router.post("/presets", protect, viewReports, createPresetController);
router.patch("/presets/:id", protect, viewReports, updatePresetController);
router.delete("/presets/:id", protect, viewReports, deletePresetController);
router.post("/presets/import", protect, viewReports, importPresetsController);

export default router;
