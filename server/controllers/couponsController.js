import {
  createCampaign,
  deleteCampaign,
  exportCouponsCsv,
  exportCouponsPdfBuffer,
  generateCoupons,
  getCampaignStats,
  listCampaigns,
  listCoupons,
  redeemCoupon,
  updateCampaign,
  validateCoupon,
} from "../services/couponsService.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

const scopedTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));

const sendError = (res, error, fallback = "Request failed") => {
  const status = Number(error?.status || 500);
  if (status >= 500) console.error("[coupons]", error);
  return res.status(status).json({
    success: false,
    message: status >= 500 ? fallback : error.message || fallback,
    validation: error.validation,
  });
};

export const getCampaigns = async (req, res) => {
  try {
    const campaigns = await listCampaigns({ tenantId: scopedTenantId(req) });
    return res.json({ success: true, campaigns });
  } catch (error) {
    return sendError(res, error, "Failed to load coupon campaigns");
  }
};

export const postCampaign = async (req, res) => {
  try {
    const campaign = await createCampaign({ tenantId: scopedTenantId(req), userId: req.user?.id || null, body: req.body });
    return res.status(201).json({ success: true, campaign });
  } catch (error) {
    return sendError(res, error, "Failed to create coupon campaign");
  }
};

export const putCampaign = async (req, res) => {
  try {
    const campaign = await updateCampaign({ tenantId: scopedTenantId(req), id: req.params.id, body: req.body });
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    return res.json({ success: true, campaign });
  } catch (error) {
    return sendError(res, error, "Failed to update coupon campaign");
  }
};

export const removeCampaign = async (req, res) => {
  try {
    const deleted = await deleteCampaign({ tenantId: scopedTenantId(req), id: req.params.id });
    if (!deleted) return res.status(404).json({ success: false, message: "Campaign not found" });
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, "Failed to delete coupon campaign");
  }
};

export const generateCampaignCoupons = async (req, res) => {
  try {
    const result = await generateCoupons({
      tenantId: scopedTenantId(req),
      campaignId: req.params.id,
      quantity: req.body?.quantity,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to generate coupons");
  }
};

export const getCampaignCoupons = async (req, res) => {
  try {
    const coupons = await listCoupons({
      tenantId: scopedTenantId(req),
      campaignId: req.params.id,
      search: req.query.search || "",
      status: req.query.status || "all",
    });
    return res.json({ success: true, coupons });
  } catch (error) {
    return sendError(res, error, "Failed to load coupons");
  }
};

export const getStats = async (req, res) => {
  try {
    const stats = await getCampaignStats({ tenantId: scopedTenantId(req), campaignId: req.params.id });
    return res.json({ success: true, stats });
  } catch (error) {
    return sendError(res, error, "Failed to load coupon stats");
  }
};

export const validate = async (req, res) => {
  try {
    const tenantId = req.user ? scopedTenantId(req) : getTenantId(req, null);
    const result = await validateCoupon({
      tenantId,
      code: req.body?.code,
      orderTotal: req.body?.order_total ?? req.body?.orderTotal,
      source: req.body?.source,
      customerId: req.body?.customer_id ?? req.body?.customerId,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Unable to validate coupon");
  }
};

export const redeem = async (req, res) => {
  try {
    const tenantId = req.user ? scopedTenantId(req) : getTenantId(req, null);
    const result = await redeemCoupon({
      tenantId,
      code: req.body?.code,
      orderId: req.body?.order_id ?? req.body?.orderId,
      customerId: req.body?.customer_id ?? req.body?.customerId,
      source: req.body?.source,
      orderTotal: req.body?.order_total ?? req.body?.orderTotal,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Unable to redeem coupon");
  }
};

export const exportCsv = async (req, res) => {
  try {
    const csv = await exportCouponsCsv({ tenantId: scopedTenantId(req), campaignId: req.query.campaign_id });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="coupons-${req.query.campaign_id || "export"}.csv"`);
    return res.send(csv);
  } catch (error) {
    return sendError(res, error, "Failed to export CSV");
  }
};

export const exportPdf = async (req, res) => {
  try {
    const storeName = req.tenant?.name || process.env.STORE_NAME || process.env.APP_NAME || "ERP Store";
    const buffer = await exportCouponsPdfBuffer({ tenantId: scopedTenantId(req), campaignId: req.query.campaign_id, storeName });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="coupons-${req.query.campaign_id || "export"}.pdf"`);
    return res.send(buffer);
  } catch (error) {
    return sendError(res, error, "Failed to export PDF");
  }
};
