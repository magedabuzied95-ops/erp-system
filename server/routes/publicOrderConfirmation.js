import express from "express";

import { consumeOrderConfirmationLink } from "../services/whatsappOrderConfirmationService.js";

const router = express.Router();

router.post("/:token", async (req, res) => {
  try {
    const result = await consumeOrderConfirmationLink({
      token: req.params.token,
      ipAddress: req.ip || req.socket?.remoteAddress || "",
      userAgent: req.headers?.["user-agent"] || "",
      source: "public_order_confirmation_link",
    });
    return res.json({
      success: true,
      action: result.action,
      message: result.message,
      target_status: result.target_status,
      already_applied: result.already_applied,
      order: result.order ? {
        id: result.order.id,
        public_order_number: result.order.public_order_number || result.order.display_order_number || result.order.invoice_number || result.order.order_number || String(result.order.id),
        status: result.order.status,
      } : null,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      code: error?.code || "ORDER_CONFIRMATION_LINK_ERROR",
      message: error?.message || "Unable to process order confirmation link",
    });
  }
});

export default router;
