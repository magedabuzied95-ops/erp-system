import express from "express";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";
import {
  cancelOrderBostaShipment,
  createOrderBostaShipment,
  refreshOrderBostaShipment,
} from "../modules/shipping/shipping.controller.js";

import {
  createOrder,
  createReturn,
  archiveOrder,
  confirmShippingPayment,
  cancelOrder,
  deleteOrder,
  editOrder,
  getOrders,
  getSupplierReturnItems,
  getPosOrderSummary,
  getPosEditOrder,
  getSingleOrder,
  getOrdersCount,
  logOrderReprint,
  markPosEditTiming,
  permanentDeleteOrder,
  returnOrder,
  rejectShippingPayment,
  startPosEditTiming,
  getShiftReport,
  updateOrderShipment,
} from "../controllers/ordersController.js";

const router = express.Router();

/* ======================================================
   CREATE ORDER
====================================================== */

router.post(
  "/",
  protect,
  permit("orders", "create"),
  createOrder
);

/* ======================================================
   GET ORDERS COUNT
====================================================== */

router.get(
  "/stats/count",
  protect,
  permit("orders", "view"),
  getOrdersCount
);

router.get(
  "/shift-report/:attendanceLogId",
  protect,
  permit("orders", "view"),
  getShiftReport
);

/* ======================================================
   GET ALL ORDERS
====================================================== */

router.get(
  "/",
  protect,
  permit("orders", "view"),
  getOrders
);

/* ======================================================
   CREATE RETURN
====================================================== */

router.post(
  "/returns",
  protect,
  permit("orders", "create"),
  createReturn
);

router.get(
  "/supplier-returns",
  protect,
  permit("orders", "view"),
  getSupplierReturnItems
);

router.post(
  "/:id/reprint-log",
  protect,
  permit("orders", "view"),
  logOrderReprint
);

router.get(
  "/:id/pos-summary",
  protect,
  permit("orders", "view"),
  getPosOrderSummary
);

router.get(
  "/:id/pos-edit",
  startPosEditTiming,
  protect,
  markPosEditTiming("auth_ms"),
  permit("orders", "view"),
  markPosEditTiming("permissions_ms"),
  getPosEditOrder
);

router.post(
  "/:id/confirm-payment",
  protect,
  permit("orders", "edit"),
  confirmShippingPayment
);

router.post(
  "/:id/reject-payment",
  protect,
  permit("orders", "edit"),
  rejectShippingPayment
);

router.post(
  "/:id/shipment/:action",
  protect,
  permit("orders", "edit"),
  updateOrderShipment
);

router.post(
  "/:id/shipment/bosta/create",
  protect,
  permit("orders", "edit"),
  createOrderBostaShipment
);

router.post(
  "/:id/shipping/bosta/create",
  protect,
  permit("orders", "edit"),
  createOrderBostaShipment
);

router.post(
  "/:id/shipping/bosta/refresh",
  protect,
  permit("orders", "edit"),
  refreshOrderBostaShipment
);

router.post(
  "/:id/shipping/bosta/cancel",
  protect,
  permit("orders", "edit"),
  cancelOrderBostaShipment
);

router.patch(
  "/:id/edit",
  protect,
  permit("orders", "edit"),
  editOrder
);

router.patch(
  "/:id",
  protect,
  permit("orders", "edit"),
  editOrder
);

router.patch(
  "/:id/archive",
  protect,
  permit("orders", "delete"),
  archiveOrder
);

router.delete(
  "/:id/permanent",
  protect,
  permit("orders", "delete"),
  permanentDeleteOrder
);

router.delete(
  "/:id",
  protect,
  permit("orders", "delete"),
  deleteOrder
);

router.post(
  "/:id/cancel",
  protect,
  permit("orders", "edit"),
  cancelOrder
);

router.post(
  "/:id/return",
  protect,
  permit("orders", "create"),
  returnOrder
);

/* ======================================================
   GET SINGLE ORDER
====================================================== */

router.get(
  "/:id",
  protect,
  permit("orders", "view"),
  getSingleOrder
);

export default router;
