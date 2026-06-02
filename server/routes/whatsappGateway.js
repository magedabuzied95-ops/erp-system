import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  getStatus,
  handleIncomingWebhook,
  loadOrderForWhatsapp,
  normalizeEgyptPhone,
  sendOrderConfirmationMessage,
  sendTextMessage,
  verifyWebhookSecret,
} from "../services/whatsappGatewayService.js";

const router = express.Router();

const tenantScope = (req) =>
  req.user?.tenant_id ||
  req.user?.tenantId ||
  req.tenant?.id ||
  req.headers?.["x-tenant-id"] ||
  null;

const sendError = (res, error, fallback = "WhatsApp gateway error") => {
  console.error("[whatsapp:error]", {
    code: error?.code,
    message: error?.message || fallback,
    status: error?.status || 500,
  });
  return res.status(error?.status || 500).json({
    success: false,
    code: error?.code || "WHATSAPP_GATEWAY_ERROR",
    message: error?.message || fallback,
  });
};

router.get("/status", protect, permit("settings", "view"), async (req, res) => {
  try {
    const status = await getStatus();
    return res.json({ success: true, status });
  } catch (error) {
    return sendError(res, error, "Failed to load WhatsApp gateway status");
  }
});

router.post("/send-test", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const phone = normalizeEgyptPhone(req.body?.phone);
    const message = String(req.body?.message || "").trim();
    console.info("[whatsapp:send-test]", {
      userId: req.user?.id,
      tenantId: tenantScope(req),
      phoneSuffix: phone ? phone.slice(-4) : "",
      messageLength: message.length,
    });
    const result = await sendTextMessage({ phone, message });
    return res.json({ success: true, result });
  } catch (error) {
    return sendError(res, error, "Failed to send WhatsApp test message");
  }
});

router.post("/order-confirmation/:orderId", protect, permit("orders", "edit"), async (req, res) => {
  try {
    const order = await loadOrderForWhatsapp({ orderId: req.params.orderId, tenantId: tenantScope(req) });
    console.info("[whatsapp:order-confirmation]", {
      userId: req.user?.id,
      tenantId: tenantScope(req),
      orderId: order.id,
      orderNumber: order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || String(order.id),
      phoneSuffix: normalizeEgyptPhone(order.customer_phone).slice(-4),
    });
    const result = await sendOrderConfirmationMessage({ order });
    return res.json({ success: true, order_id: order.id, result });
  } catch (error) {
    return sendError(res, error, "Failed to send order confirmation");
  }
});

router.post("/webhook", async (req, res) => {
  try {
    if (!verifyWebhookSecret(req)) {
      console.warn("[whatsapp:webhook-incoming]", { rejected: true, reason: "invalid_secret" });
      return res.status(401).json({ success: false, message: "Invalid webhook secret" });
    }
    const normalized = await handleIncomingWebhook(req.body || {});
    return res.status(200).json({ success: true, received: true, message: normalized.text ? "ok" : "no_text" });
  } catch (error) {
    console.error("[whatsapp:error]", { route: "webhook", message: error?.message || error });
    return res.status(200).json({ success: false, received: true });
  }
});

export default router;
