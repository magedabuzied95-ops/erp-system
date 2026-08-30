import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import { getRecentPosOrders } from "../controllers/ordersController.js";
import {
  closePosShift,
  createQuickPosExpense,
  getActivePosShift,
  getPosOpeningCandidates,
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
import { createPosOnlineOrder } from "../controllers/storefrontController.js";

const router = express.Router();

router.get(
  "/recent-orders",
  protect,
  getRecentPosOrders
);

router.get("/shifts/active", protect, getActivePosShift);
router.get("/shifts/opening-candidates", protect, getPosOpeningCandidates);
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

// POS online-invoice mode. Deliberately the website checkout controller and not POST /orders:
// the address, the server-side shipping quote, the pending_confirmation status and the
// WhatsApp confirmation all live there, and a second implementation would drift from it.
router.post("/online-order", protect, permit("orders", "create"), createPosOnlineOrder);

export default router;
