import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createCustomer,
  adjustCustomerWallet,
  deleteCustomer,
  getCustomerLoyalty,
  getCustomerLoyaltyHistory,
  getCustomerOrders,
  getCustomerProfile,
  getCustomerStatement,
  getCustomerWalletAudit,
  listCustomers,
  updateCustomer,
} from "../controllers/customersController.js";

const router = express.Router();

router.get("/", protect, permit("customers", "view"), listCustomers);
router.post("/", protect, permit("customers", "create"), createCustomer);
router.get("/:id/profile", protect, permit("customers", "view"), getCustomerProfile);
router.get("/:id/orders", protect, permit("customers", "view"), getCustomerOrders);
router.get("/:id/loyalty", protect, permit("customers", "view"), getCustomerLoyalty);
router.get("/:id/loyalty/history", protect, permit("customers", "view"), getCustomerLoyaltyHistory);
router.get("/:id/wallet/audit", protect, permit("customers", "view"), getCustomerWalletAudit);
router.get("/:id/statement", protect, permit("customers", "view"), getCustomerStatement);
router.post("/:id/wallet/adjust", protect, permit("customers", "edit"), adjustCustomerWallet);
router.put("/:id", protect, permit("customers", "edit"), updateCustomer);
router.delete("/:id", protect, permit("customers", "delete"), deleteCustomer);

export default router;
