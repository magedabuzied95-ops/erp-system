import express from "express";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

import {
  createOrder,
  createReturn,
  confirmShippingPayment,
  cancelOrder,
  editOrder,
  getOrders,
  getSingleOrder,
  getOrdersCount,
  logOrderReprint,
  returnOrder,
  rejectShippingPayment,
  getShiftReport,
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

router.post(
  "/:id/reprint-log",
  protect,
  permit("orders", "view"),
  logOrderReprint
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

router.patch(
  "/:id/edit",
  protect,
  permit("orders", "edit"),
  editOrder
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
