import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import { getRecentPosOrders } from "../controllers/ordersController.js";
import {
  closePosShift,
  createQuickPosExpense,
  getActivePosShift,
  getPosPaymentAccountStatus,
  getPosReceiptRuntimeSettings,
  getPosSellerUsers,
  getPosShiftReport,
  openPosShift,
  getPaymobTerminalPaymentStatus,
  manuallyConfirmPaymobTerminalPayment,
  sendPaymobTerminalPayment,
} from "../controllers/posController.js";
import permit from "../middleware/permissionMiddleware.js";

const router = express.Router();

router.get(
  "/recent-orders",
  protect,
  getRecentPosOrders
);

router.get("/shifts/active", protect, getActivePosShift);
router.get("/shifts/:id/report", protect, getPosShiftReport);
router.post("/shifts/open", protect, openPosShift);
router.post("/shifts/:id/close", protect, closePosShift);
router.post("/expenses", protect, permit("pos.expenses", "create"), createQuickPosExpense);
router.get("/seller-users", protect, getPosSellerUsers);
router.get("/payment-account-status", protect, getPosPaymentAccountStatus);
router.get("/receipt-settings", protect, getPosReceiptRuntimeSettings);
router.post("/payments/paymob-terminal", protect, sendPaymobTerminalPayment);
router.get("/payments/paymob-terminal/status/:transactionId", protect, getPaymobTerminalPaymentStatus);
router.post("/payments/paymob-terminal/:transactionId/manual-confirm", protect, manuallyConfirmPaymobTerminalPayment);

export default router;
