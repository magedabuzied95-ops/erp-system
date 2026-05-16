import { getTenantId } from "../utils/requestScope.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import {
  buildMarketingAttributionDashboard,
  syncAllMarketingAttribution,
} from "../services/marketingAttributionAnalyticsService.js";
import { syncMarketingAttribution } from "../services/marketingAttributionService.js";

const getTenantScope = (req) => getTenantId(req, req.user?.tenant_id) ?? 1;

export const getMarketingAttribution = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const data = await buildMarketingAttributionDashboard({
      tenantId,
      platform: req.query?.platform || "",
      from: req.query?.from || req.query?.date_from || null,
      to: req.query?.to || req.query?.date_to || null,
      limit: req.query?.limit || 20,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error("[marketing-attribution] dashboard error", {
      message: error?.message,
      stack: error?.stack,
    });
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load marketing attribution" });
  }
};

export const syncMarketingAttributionNow = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await syncMarketingAttribution({
      tenantId,
      platform: req.body?.platform || req.query?.platform || "",
      from: req.body?.from || req.query?.from || null,
      to: req.body?.to || req.query?.to || null,
    });
    const overview = await buildMarketingAttributionDashboard({
      tenantId,
      platform: req.body?.platform || req.query?.platform || "",
      from: req.body?.from || req.query?.from || null,
      to: req.body?.to || req.query?.to || null,
      limit: req.body?.limit || req.query?.limit || 20,
    });
    res.json({ success: true, data: { ...overview, sync: result } });
  } catch (error) {
    console.error("[marketing-attribution] sync error", {
      message: error?.message,
      stack: error?.stack,
    });
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to sync marketing attribution" });
  }
};

export const syncAllMarketingAttributionNow = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const result = await syncAllMarketingAttribution();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[marketing-attribution] global sync error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to sync marketing attribution" });
  }
};
