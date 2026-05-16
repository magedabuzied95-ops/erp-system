import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  getTenants,
  getCurrentTenant,
  getCompanySettings,
  upsertCompanySettings,
  updateTenantStatus,
} from "../controllers/tenantsController.js";

const router = express.Router();

router.get("/", protect, permit("settings", "view"), getTenants);
router.get("/current", protect, getCurrentTenant);
router.get("/company", protect, permit("settings", "view"), getCompanySettings);
router.put("/company", protect, permit("settings", "edit"), upsertCompanySettings);
router.patch("/:id/status", protect, permit("settings", "approve"), updateTenantStatus);

export default router;
