import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  clearSettingsCache,
  getPrivateSettings,
  getPublicSettings,
  getSettingsByCategory,
  setSetting,
} from "../services/settingsService.js";
import {
  getSiteSettings,
  updateSiteSettings,
} from "../services/siteSettingsService.js";
import { getTenantId } from "../utils/requestScope.js";
import { normalizeSettingsCategory, settingsByCategory } from "../../shared/settingsRegistry.js";

const router = express.Router();

router.get("/public", async (req, res) => {
  try {
    const settings = await getPublicSettings();
    res.json({ success: true, settings });
  } catch (error) {
    console.error("[settings] public settings error", error);
    res.status(500).json({ success: false, message: "Failed to load public settings" });
  }
});

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    const payload = await getPrivateSettings();
    res.json({ success: true, ...payload });
  } catch (error) {
    console.error("[settings] list error", error);
    res.status(500).json({ success: false, message: "Failed to load settings" });
  }
});

router.get("/site", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const site = await getSiteSettings({ tenantId });
    res.json({ success: true, site, settings: site });
  } catch (error) {
    console.error("[settings] site get error", error);
    res.status(500).json({ success: false, message: "Failed to load site settings" });
  }
});

router.patch("/site", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const incoming = req.body?.site && typeof req.body.site === "object" ? req.body.site : req.body || {};
    const site = await updateSiteSettings({
      tenantId,
      name: incoming.name ?? incoming.siteName ?? incoming.company_name ?? incoming.companyName,
      slug: incoming.slug ?? incoming.site_slug ?? incoming.siteSlug,
      companyName: incoming.company_name ?? incoming.companyName,
      companyLogoUrl: incoming.company_logo_url ?? incoming.companyLogoUrl,
      faviconUrl: incoming.favicon_url ?? incoming.faviconUrl,
      updatedBy: req.user?.id || null,
    });
    clearSettingsCache();
    res.json({ success: true, site, settings: site });
  } catch (error) {
    console.error("[settings] site patch error", error);
    res.status(400).json({ success: false, message: error.message || "Failed to save site settings" });
  }
});

router.get("/:category", protect, permit("settings", "view"), async (req, res) => {
  try {
    const category = normalizeSettingsCategory(req.params.category);
    if (!category) return res.status(404).json({ success: false, message: "Unknown settings category" });
    const settings = await getSettingsByCategory(category);
    res.json({ success: true, category, settings });
  } catch (error) {
    console.error("[settings] category error", error);
    res.status(500).json({ success: false, message: "Failed to load settings category" });
  }
});

router.put("/:category", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const category = normalizeSettingsCategory(req.params.category);
    if (!category) return res.status(404).json({ success: false, message: "Unknown settings category" });

    const incoming = req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : req.body || {};
    const allowedKeys = new Set((settingsByCategory[category] || []).map((setting) => setting.key));
    const entries = Object.entries(incoming).filter(([key]) => allowedKeys.has(key));
    if (!entries.length) {
      return res.status(400).json({ success: false, message: "No valid settings were provided" });
    }

    for (const [key, value] of entries) {
      await setSetting(key, value, category, req.user?.id || null);
    }
    clearSettingsCache();
    const settings = await getSettingsByCategory(category);
    res.json({ success: true, category, settings });
  } catch (error) {
    console.error("[settings] update error", error);
    res.status(400).json({ success: false, message: error.message || "Failed to update settings" });
  }
});

export default router;
