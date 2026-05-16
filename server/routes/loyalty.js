import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createLoyaltyRule,
  getLoyaltyCustomer,
  getLoyaltyCustomers,
  getLoyaltyRules,
  manualLoyaltyAdjustment,
  redeemLoyaltyPoints,
  rebuildLoyalty,
  validateLoyaltyRedemption,
  updateLoyaltyRule,
} from "../controllers/loyaltyController.js";

const router = express.Router();

router.get("/rules", protect, permit("loyalty", "view"), getLoyaltyRules);
router.post("/rules", protect, permit("loyalty", "edit"), createLoyaltyRule);
router.put("/rules/:id", protect, permit("loyalty", "edit"), updateLoyaltyRule);
router.get("/customers", protect, permit("loyalty", "view"), getLoyaltyCustomers);
router.get("/customers/:customerId", protect, permit("loyalty", "view"), getLoyaltyCustomer);
router.post("/validate", protect, permit("loyalty", "view"), validateLoyaltyRedemption);
router.post("/redeem", protect, permit("loyalty", "redeem"), redeemLoyaltyPoints);
router.post("/rebuild", protect, permit("loyalty", "edit"), rebuildLoyalty);
router.post("/adjust", protect, permit("loyalty", "edit"), manualLoyaltyAdjustment);

export default router;
