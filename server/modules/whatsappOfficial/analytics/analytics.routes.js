// /api/whatsapp-official/analytics — WhatsApp template analytics (inbox top bar → WhatsApp →
// Template Analytics, and the Analytics block inside one template).
//
//   GET  /templates?account=&campaigns=1,2&from=YYYY-MM-DD&to=YYYY-MM-DD   cached page data
//   GET  /templates/:id?from=&to=                                           one template (local id or Meta id)
//   POST /sync     { account?, campaigns?, from?, to?, template_id? }       pull from Meta, then the page data
//   POST /enable   { account? }                                             switch template insights on for the WABA
//   GET  /export?account=&campaigns=&from=&to=[&as=json]                    CSV (or { filename, csv })
//
// Read is settings:view; anything that talks to Meta is settings:edit (same as templates).
import express from "express";

import { protect } from "../../../middleware/authMiddleware.js";
import permit from "../../../middleware/permissionMiddleware.js";
import { enableTemplateInsights, exportAnalyticsCsv, getTemplateAnalytics, syncAnalytics } from "./analytics.service.js";

const router = express.Router();

const tenantOf = (req) => req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[wa-analytics:error]", { code: error?.code, message: error?.message });
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "WA_ANALYTICS_ERROR",
    meaning: error?.details?.meaning || "",
  });
};

const filtersOf = (source = {}) => ({
  account: source.account || "",
  campaigns: source.campaigns || "",
  from: source.from || "",
  to: source.to || "",
});

router.get("/templates", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, ...(await getTemplateAnalytics({ tenantId: tenantOf(req), ...filtersOf(req.query) })) });
  } catch (error) {
    return fail(res, error, "Failed to load template analytics");
  }
});

router.get("/templates/:id", protect, permit("settings", "view"), async (req, res) => {
  try {
    const data = await getTemplateAnalytics({ tenantId: tenantOf(req), from: req.query.from, to: req.query.to, templateId: req.params.id });
    if (!data.template) return res.status(404).json({ success: false, message: "Template not found", code: "WHATSAPP_TEMPLATE_NOT_FOUND" });
    return res.json({ success: true, ...data });
  } catch (error) {
    return fail(res, error, "Failed to load template analytics");
  }
});

router.post("/sync", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const body = req.body || {};
    const templateId = String(body.template_id || "").trim();
    const filters = filtersOf(body);
    const summary = await syncAnalytics({ tenantId: tenantOf(req), account: filters.account, from: filters.from, to: filters.to, templateId });
    const data = await getTemplateAnalytics({ tenantId: tenantOf(req), ...filters, templateId });
    return res.json({ success: true, summary, ...data });
  } catch (error) {
    return fail(res, error, "Failed to sync template analytics from Meta");
  }
});

router.post("/enable", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json({ success: true, ...(await enableTemplateInsights({ tenantId: tenantOf(req), account: req.body?.account || "" })) });
  } catch (error) {
    return fail(res, error, "Meta refused to enable template analytics");
  }
});

router.get("/export", protect, permit("settings", "view"), async (req, res) => {
  try {
    const { filename, csv } = await exportAnalyticsCsv({ tenantId: tenantOf(req), ...filtersOf(req.query) });
    if (String(req.query.as || "") === "json") return res.json({ success: true, filename, csv });
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    return fail(res, error, "Failed to export template analytics");
  }
});

export default router;
