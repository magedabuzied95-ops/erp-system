import express from "express";

import {
  exportCsv,
  emailPdf,
  exportPdf,
  generateCampaignCoupons,
  getCampaignCoupons,
  getCampaignRedemptions,
  getCampaigns,
  getStats,
  postCampaign,
  putCampaign,
  redeem,
  removeCampaign,
  validate,
} from "../controllers/couponsController.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";

const router = express.Router();
const requireCouponManager = (req, res, next) => {
  const role = String(req.user?.role_name || req.user?.role || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (["admin", "super admin", "superadmin", "manager", "owner"].includes(role) || req.user?.is_super_admin) return next();
  return res.status(403).json({ success: false, message: "Coupon campaign management requires admin or manager access" });
};

// /validate is public (the storefront checkout calls it before login). Codes are PREFIX-XXXXXX over a
// 32-symbol alphabet, so brute force is impractical — but an unthrottled oracle still leaks which codes
// exist. Fixed window per client IP, in-process; good enough for a single backend instance.
const VALIDATE_WINDOW_MS = 60_000;
const VALIDATE_MAX_PER_WINDOW = Number(process.env.COUPON_VALIDATE_RATE_LIMIT || 20);
const validateHits = new Map();
const validateRateLimit = (req, res, next) => {
  const now = Date.now();
  const key = String(req.ip || req.socket?.remoteAddress || "unknown");
  const entry = validateHits.get(key);
  if (!entry || now - entry.start >= VALIDATE_WINDOW_MS) {
    validateHits.set(key, { start: now, count: 1 });
    if (validateHits.size > 5000) {
      for (const [k, v] of validateHits) if (now - v.start >= VALIDATE_WINDOW_MS) validateHits.delete(k);
    }
    return next();
  }
  entry.count += 1;
  if (entry.count > VALIDATE_MAX_PER_WINDOW) {
    res.set("Retry-After", String(Math.ceil((VALIDATE_WINDOW_MS - (now - entry.start)) / 1000)));
    return res.status(429).json({ success: false, valid: false, reason: "Too many coupon checks, try again in a minute" });
  }
  return next();
};

// Manual redemption burns a coupon; it must always point at the order it was burned for.
const requireRedeemOrder = (req, res, next) => {
  const orderId = req.body?.order_id ?? req.body?.orderId;
  if (!orderId || !Number.isFinite(Number(orderId))) {
    return res.status(400).json({ success: false, message: "order_id is required to redeem a coupon" });
  }
  return next();
};

router.post("/validate", validateRateLimit, validate);
router.post("/redeem", protect, requireCouponManager, requireRedeemOrder, redeem);

router.get("/campaigns", protect, permit("marketing", "view"), getCampaigns);
router.post("/campaigns", protect, requireCouponManager, permit("marketing", "create"), postCampaign);
router.put("/campaigns/:id", protect, requireCouponManager, permit("marketing", "update"), putCampaign);
router.delete("/campaigns/:id", protect, requireCouponManager, permit("marketing", "delete"), removeCampaign);

router.post("/campaigns/:id/generate", protect, requireCouponManager, permit("marketing", "create"), generateCampaignCoupons);
router.get("/campaigns/:id/coupons", protect, permit("marketing", "view"), getCampaignCoupons);
router.get("/campaigns/:id/stats", protect, permit("marketing", "view"), getStats);
router.get("/campaigns/:id/redemptions", protect, permit("marketing", "view"), getCampaignRedemptions);

router.get("/export/pdf", protect, requireCouponManager, permit("marketing", "view"), exportPdf);
router.post("/export/pdf/email", protect, requireCouponManager, permit("marketing", "view"), emailPdf);
router.get("/export/csv", protect, requireCouponManager, permit("marketing", "view"), exportCsv);

export default router;
