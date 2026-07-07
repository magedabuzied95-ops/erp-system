import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  getWebsiteSettings,
  updateWebsiteSettings,
} from "../services/liveActivityService.js";

const router = express.Router();

router.get("/settings", protect, permit("website", "settings"), async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const settings = await getWebsiteSettings({ tenantId });
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    console.debug("WEBSITE_SETTINGS_GET_SALE_MODE", {
      tenant_id: tenantId,
      sale_mode_enabled: settings.sale_mode_enabled,
    });
    res.json({ success: true, settings });
  } catch {
    res.status(500).json({ success: false, message: "Failed to load website settings" });
  }
});

router.put("/settings", protect, permit("website", "settings"), async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    console.debug("WEBSITE_SETTINGS_PUT_BODY_SALE_MODE", {
      tenant_id: tenantId,
      sale_mode_enabled: req.body?.sale_mode_enabled,
      body_keys: Object.keys(req.body || {}),
    });
    const settings = await updateWebsiteSettings({ tenantId, settings: req.body || {} });
    console.debug("WEBSITE_SETTINGS_PUT_SAVED_SALE_MODE", {
      tenant_id: tenantId,
      sale_mode_enabled: settings?.sale_mode_enabled,
    });
    res.json({ success: true, settings });
  } catch {
    res.status(500).json({ success: false, message: "Failed to save website settings" });
  }
});

export default router;
