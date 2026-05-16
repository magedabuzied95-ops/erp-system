import express from "express";

import {
  createSupplierController,
  deleteSupplierController,
  getSupplierController,
  listSuppliersController,
  updateSupplierController,
} from "../controllers/suppliersController.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";

const router = express.Router();

router.get("/", protect, permit("suppliers", "view"), listSuppliersController);
router.get("/:id", protect, permit("suppliers", "view"), getSupplierController);
router.post("/", protect, permit("suppliers", "create"), createSupplierController);
router.put("/:id", protect, permit("suppliers", "edit"), updateSupplierController);
router.delete("/:id", protect, permit("suppliers", "delete"), deleteSupplierController);

export default router;
