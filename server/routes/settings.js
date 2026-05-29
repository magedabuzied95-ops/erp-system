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
