import express from "express";

import {
  exportCsv,
  emailPdf,
  exportPdf,
  generateCampaignCoupons,
  getCampaignCoupons,
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

router.post("/validate", validate);
router.post("/redeem", protect, redeem);

router.get("/campaigns", protect, permit("marketing", "view"), getCampaigns);
router.post("/campaigns", protect, requireCouponManager, permit("marketing", "create"), postCampaign);
router.put("/campaigns/:id", protect, requireCouponManager, permit("marketing", "update"), putCampaign);
router.delete("/campaigns/:id", protect, requireCouponManager, permit("marketing", "delete"), removeCampaign);

router.post("/campaigns/:id/generate", protect, requireCouponManager, permit("marketing", "create"), generateCampaignCoupons);
router.get("/campaigns/:id/coupons", protect, permit("marketing", "view"), getCampaignCoupons);
router.get("/campaigns/:id/stats", protect, permit("marketing", "view"), getStats);

router.get("/export/pdf", protect, requireCouponManager, permit("marketing", "view"), exportPdf);
router.post("/export/pdf/email", protect, requireCouponManager, permit("marketing", "view"), emailPdf);
router.get("/export/csv", protect, requireCouponManager, permit("marketing", "view"), exportCsv);

export default router;
