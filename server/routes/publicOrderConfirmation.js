import express from "express";

import { consumeOrderConfirmationLink } from "../services/whatsappOrderConfirmationService.js";

const router = express.Router();

const serializeOrder = (order = null) =>
  order ? {
    id: order.id,
    public_order_number: order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || String(order.id),
    status: order.status,
  } : null;

const handleRequest = async (req, res) => {
  try {
    const result = await consumeOrderConfirmationLink({
      code: req.params.code,
      action: req.body?.action || req.query?.action || "",
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
      code_expires_at: result.code_expires_at,
      used_at: result.used_at,
      supported_actions: ["confirm", "edit", "cancel"],
      order: serializeOrder(result.order),
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      code: error?.code || "ORDER_CONFIRMATION_LINK_ERROR",
      message: error?.message || "Unable to process order confirmation link",
    });
  }
};

router.get("/:code", handleRequest);
router.post("/:code", handleRequest);

export default router;
