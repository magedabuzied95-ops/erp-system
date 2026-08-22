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
import { getWebsiteSettings } from "../services/liveActivityService.js";
import { getTenantId } from "../utils/requestScope.js";
import { normalizeSettingsCategory, settingsByCategory } from "../../shared/settingsRegistry.js";
import { refreshOpenAiCredentialOverrides } from "../services/openaiCredentials.js";
import { refreshAttendanceTimeZone } from "../utils/attendanceTimezone.js";
import { paymobOnlineAvailability } from "../services/paymobOnlineService.js";

const router = express.Router();

const publicTenantId = (req) => {
  const raw = req.headers?.["x-tenant-id"] || req.body?.tenant_id || req.query?.tenant_id || req.body?.tenantId || req.query?.tenantId || 1;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

router.get("/public", async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const [settings, websiteSettings] = await Promise.all([
      getPublicSettings(),
      getWebsiteSettings({ tenantId }).catch(() => ({})),
    ]);
    const saleModeEnabled = websiteSettings?.sale_mode_enabled;
    const mergedSettings = {
      ...settings,
      sale_mode_enabled: saleModeEnabled ?? settings?.sale_mode_enabled,
      global_sale_enabled: websiteSettings?.global_sale_enabled ?? saleModeEnabled ?? settings?.global_sale_enabled,
      sale_prices_enabled: websiteSettings?.sale_prices_enabled ?? saleModeEnabled ?? settings?.sale_prices_enabled,
      storefront: {
        ...(settings?.storefront || {}),
        sale_mode_enabled: saleModeEnabled ?? settings?.storefront?.sale_mode_enabled,
        global_sale_enabled: websiteSettings?.global_sale_enabled ?? saleModeEnabled ?? settings?.storefront?.global_sale_enabled,
        sale_prices_enabled: websiteSettings?.sale_prices_enabled ?? saleModeEnabled ?? settings?.storefront?.sale_prices_enabled,
        // Booleans only — this endpoint is unauthenticated, so the Paymob keys
        // themselves must never be reflected here.
        online_payment: paymobOnlineAvailability(),
      },
    };
    res.json({ success: true, settings: mergedSettings });
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
    if (category === "shipping") {
      const currentSettings = await getSettingsByCategory(category);
      const currentByKey = new Map(currentSettings.map((item) => [item.key, item.value]));
      const handlingMin = Number(incoming["storefront.shipping_handling_min_days"] ?? currentByKey.get("storefront.shipping_handling_min_days"));
      const handlingMax = Number(incoming["storefront.shipping_handling_max_days"] ?? currentByKey.get("storefront.shipping_handling_max_days"));
      if (!Number.isInteger(handlingMin) || !Number.isInteger(handlingMax) || handlingMin < 0 || handlingMax < 0) {
        return res.status(400).json({ success: false, message: "مدة التجهيز يجب أن تكون رقمًا صحيحًا يبدأ من صفر." });
      }
      if (handlingMax < handlingMin) {
        return res.status(400).json({ success: false, message: "الحد الأقصى لمدة التجهيز لا يمكن أن يقل عن الحد الأدنى." });
      }
    }

    for (const [key, value] of entries) {
      await setSetting(key, value, category, req.user?.id || null);
    }
    clearSettingsCache();
    if (category === "ai_channels") await refreshOpenAiCredentialOverrides();
    // Attendance date maths reads the timezone synchronously from a warm cache,
    // so it has to be re-read here for the change to take effect without a
    // restart.
    if (category === "employees") await refreshAttendanceTimeZone();
    const settings = await getSettingsByCategory(category);
    res.json({ success: true, category, settings });
  } catch (error) {
    console.error("[settings] update error", error);
    res.status(400).json({ success: false, message: error.message || "Failed to update settings" });
  }
});

export default router;
