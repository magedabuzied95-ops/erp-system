import express from "express";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

import {
  getInventoryHistory,
  getInventoryMovementsLedger,
  getLowStockAlerts,
  getVariantHistory,
  undoInventoryMovementById,
  updateStock
} from "../controllers/inventoryController.js";

const router = express.Router();

/* ======================================================
   UPDATE PRODUCT STOCK
====================================================== */

router.put(
  "/update-stock",
  protect,
  permit("inventory", "edit"),
  updateStock
);

router.get(
  "/movements",
  protect,
  permit("inventory", "movements:view"),
  getInventoryMovementsLedger
);

router.post(
  "/movements/:id/undo",
  protect,
  permit("inventory", "movements:undo"),
  undoInventoryMovementById
);

router.get(
  "/low-stock",
  protect,
  permit("inventory", "alerts:view"),
  getLowStockAlerts
);

router.get(
  "/history",
  protect,
  permit("inventory", "view"),
  getInventoryHistory
);

router.get(
  "/variant/:id/history",
  protect,
  permit("inventory", "view"),
  getVariantHistory
);

export default router;
