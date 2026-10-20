import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getUsageOverview, syncUsageFromMeta, updateUsageAlerts } from "../services/whatsappUsageService.js";

/*
 * WhatsApp usage & cost (inbox top bar → WhatsApp → Usage & cost). Mounted at /api/whatsapp/usage.
 * Read is settings:view; pulling from Meta and changing the budget alert are settings:edit.
 */

const router = express.Router();

const tenantOf = (req) => req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[whatsapp-usage:error]", { code: error?.code, message: error?.message });
  return res.status(status).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "WHATSAPP_USAGE_ERROR",
    meaning: error?.details?.meaning || "",
  });
};

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, ...(await getUsageOverview({ tenantId: tenantOf(req) })) });
  } catch (error) {
    return fail(res, error, "Failed to load WhatsApp usage");
  }
});

router.post("/sync", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const summary = await syncUsageFromMeta({ tenantId: tenantOf(req) });
    return res.json({ success: true, summary, ...(await getUsageOverview({ tenantId: tenantOf(req) })) });
  } catch (error) {
    return fail(res, error, "Failed to sync WhatsApp usage from Meta");
  }
});

router.put("/alerts", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const body = req.body || {};
    const alerts = await updateUsageAlerts({
      tenantId: tenantOf(req),
      monthlyBudgetUsd: body.monthly_budget_usd ?? body.monthlyBudgetUsd ?? 0,
      alertPercent: body.alert_percent ?? body.alertPercent ?? 80,
    });
    return res.json({ success: true, alerts, ...(await getUsageOverview({ tenantId: tenantOf(req) })) });
  } catch (error) {
    return fail(res, error, "Failed to save the usage alert");
  }
});

export default router;
