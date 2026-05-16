import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createSection,
  generateMasterQr,
  getCycleTasks,
  getMasterQr,
  getSectionByCode,
  getSmartReports,
  listCounts,
  listSections,
  saveQuickCount,
} from "../controllers/smartWarehouseController.js";

const router = express.Router();

router.get("/sections", protect, permit("warehouses", "view"), listSections);
router.post("/sections", protect, permit("warehouses", "create"), createSection);
router.get("/sections/:code", protect, permit("warehouses", "view"), getSectionByCode);

router.post("/master-qr/products/:productId", protect, permit("products", "view"), generateMasterQr);
router.get("/master-qr/:qrValue", protect, permit("inventory", "view"), getMasterQr);

router.get("/counts", protect, permit("inventory", "view"), listCounts);
router.post("/counts/quick", protect, permit("inventory", "edit"), saveQuickCount);
router.get("/counts/cycle-tasks", protect, permit("inventory", "view"), getCycleTasks);

router.get("/reports", protect, permit("reports", "view"), getSmartReports);

export default router;
