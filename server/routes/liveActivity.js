import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  getWebsiteSettings,
  updateWebsiteSettings,
} from "../services/liveActivityService.js";

const router = express.Router();

const publicTenantId = (req) => {
  const raw = req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.query?.tenantId || null;
  const tenantId = Number(raw);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

router.get("/settings", async (req, res) => {
  try {
    const settings = await getWebsiteSettings({ tenantId: publicTenantId(req) });
    res.json({ success: true, settings });
  } catch {
    res.status(500).json({ success: false, message: "Failed to load website settings" });
  }
});

router.put("/settings", protect, permit("website", "settings"), async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const settings = await updateWebsiteSettings({ tenantId, settings: req.body || {} });
    res.json({ success: true, settings });
  } catch {
    res.status(500).json({ success: false, message: "Failed to save website settings" });
  }
});

export default router;
