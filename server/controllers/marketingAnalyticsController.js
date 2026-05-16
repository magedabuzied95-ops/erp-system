import { getTenantId } from "../utils/requestScope.js";
import { buildMarketingAnalyticsOverview, syncMarketingAnalyticsForTenant } from "../services/marketingAnalyticsService.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";

const getTenantScope = (req) => getTenantId(req, req.user?.tenant_id) ?? 1;

export const getMarketingAnalytics = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const data = await buildMarketingAnalyticsOverview({
      tenantId,
      platform: req.query?.platform || "",
      from: req.query?.from || req.query?.date_from || null,
      to: req.query?.to || req.query?.date_to || null,
      limit: req.query?.limit || 20,
      offset: req.query?.offset || 0,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error("[marketing-analytics] get analytics error", {
      message: error?.message,
      status: error?.status,
      stack: error?.stack,
    });
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load marketing analytics" });
  }
};

export const syncMarketingAnalytics = async (req, res) => {
  try {
    await ensureMarketingSchema();
    const tenantId = getTenantScope(req);
    const result = await syncMarketingAnalyticsForTenant({
      tenantId,
      platform: req.body?.platform || req.query?.platform || "",
      from: req.body?.from || req.query?.from || null,
      to: req.body?.to || req.query?.to || null,
      force: true,
    });

    const overview = await buildMarketingAnalyticsOverview({
      tenantId,
      platform: req.body?.platform || req.query?.platform || "",
      from: req.body?.from || req.query?.from || null,
      to: req.body?.to || req.query?.to || null,
      limit: req.body?.limit || req.query?.limit || 20,
      offset: req.body?.offset || req.query?.offset || 0,
    });

    res.json({
      success: true,
      data: {
        ...overview,
        sync: result,
      },
    });
  } catch (error) {
    console.error("[marketing-analytics] sync error", {
      message: error?.message,
      status: error?.status,
      stack: error?.stack,
    });
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to sync marketing analytics" });
  }
};

