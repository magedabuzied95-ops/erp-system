import {
  assignCouponToCustomer,
  createCampaign,
  deleteCampaign,
  exportCouponsCsv,
  exportCouponsPdfBuffer,
  generateCoupons,
  getCampaignStats,
  listCampaigns,
  listCoupons,
  listRedemptions,
  redeemCoupon,
  updateCampaign,
  validateCoupon,
} from "../services/couponsService.js";
import { sendSmtpMail } from "../services/staffTaskEmailNotificationService.js";
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
      shippingAmount: req.body?.shipping_amount ?? req.body?.shippingAmount ?? 0,
      items: req.body?.items,
      appliedDiscounts: req.body?.applied_discounts ?? req.body?.appliedDiscounts ?? {},
      source: req.body?.source,
      customerId: req.body?.customer_id ?? req.body?.customerId,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Unable to validate coupon");
  }
};

export const assignCoupon = async (req, res) => {
  try {
    const result = await assignCouponToCustomer({
      tenantId: scopedTenantId(req),
      campaignId: req.params.id,
      customerId: req.body?.customer_id ?? req.body?.customerId,
      userId: req.user?.id || null,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to assign coupon");
  }
};

export const getCampaignRedemptions = async (req, res) => {
  try {
    const rows = await listRedemptions({
      tenantId: scopedTenantId(req),
      campaignId: req.params.id,
      couponId: req.query.coupon_id || req.query.couponId || null,
      limit: req.query.limit,
    });
    return res.json({ success: true, redemptions: rows });
  } catch (error) {
    return sendError(res, error, "Failed to load coupon redemptions");
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
    const layout = String(req.query.layout || "a4").toLowerCase();
    const buffer = await exportCouponsPdfBuffer({
      tenantId: scopedTenantId(req),
      campaignId: req.query.campaign_id,
      couponId: req.query.coupon_id || null,
      layout,
    });
    res.setHeader("Content-Type", "application/pdf");
    const suffix = req.query.coupon_id ? `coupon-${req.query.coupon_id}` : `coupons-${req.query.campaign_id || "export"}`;
    res.setHeader("Content-Disposition", `${req.query.inline === "1" ? "inline" : "attachment"}; filename="${suffix}-${layout}.pdf"`);
    return res.send(buffer);
  } catch (error) {
    return sendError(res, error, "Failed to export PDF");
  }
};

export const emailPdf = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "A valid email address is required" });
    }
    const layout = String(req.body?.layout || "a4").toLowerCase();
    const campaignId = req.body?.campaign_id || req.body?.campaignId;
    const couponId = req.body?.coupon_id || req.body?.couponId || null;
    const buffer = await exportCouponsPdfBuffer({ tenantId: scopedTenantId(req), campaignId, couponId, layout });
    await sendSmtpMail({
      to: email,
      subject: "قسائم الخصم",
      body: "مرفق ملف قسائم الخصم الجاهز للطباعة والاستخدام.",
      attachments: [{ filename: `coupons-${campaignId || "export"}-${layout}.pdf`, contentType: "application/pdf", content: buffer }],
    });
    return res.json({ success: true, message: "Coupon PDF sent successfully" });
  } catch (error) {
    return sendError(res, error, "Failed to send coupon PDF by email");
  }
};
