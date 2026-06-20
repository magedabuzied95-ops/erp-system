import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { emitToRooms } from "../utils/socket.js";
import {
  getRecentEvolutionWebhookEvents,
  getStatus,
  handleIncomingWebhook,
  loadOrderForWhatsapp,
  normalizeEgyptPhone,
  sendTextMessage,
  sendWhatsAppButtonsDebugTest,
  triggerWhatsappAiAutoReply,
  verifyWebhookSecret,
} from "../services/whatsappGatewayService.js";
import { applyConfirmationAction, processConfirmationReply, sendOrderConfirmation } from "../services/whatsappOrderConfirmationService.js";

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

router.get("/webhook/debug-events", protect, permit("settings", "view"), async (req, res) => {
  const debugEvents = getRecentEvolutionWebhookEvents();
  return res.json({
    success: true,
    ...debugEvents,
  });
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

router.post("/debug/whatsapp/send-buttons-test", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const phone = normalizeEgyptPhone(req.body?.phone);
    const mode = String(req.body?.mode || "simple").trim().toLowerCase();
    const useSafeIds = Boolean(req.body?.useSafeIds);
    console.info("[whatsapp:buttons-debug-request]", {
      userId: req.user?.id,
      tenantId: tenantScope(req),
      phoneSuffix: phone ? phone.slice(-4) : "",
      mode,
      useSafeIds,
    });
    const result = await sendWhatsAppButtonsDebugTest({
      phone,
      mode,
      useSafeIds,
    });
    return res.json({ success: true, mode, result });
  } catch (error) {
    return sendError(res, error, "Failed to send WhatsApp buttons debug test");
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
    const result = await sendOrderConfirmation({ ...order, items: order.items || [] });
    return res.json({ success: true, order_id: order.id, result });
  } catch (error) {
    return sendError(res, error, "Failed to send order confirmation");
  }
});

router.post("/order-confirmation/:orderId/action", protect, permit("orders", "edit"), async (req, res) => {
  try {
    const order = await loadOrderForWhatsapp({ orderId: req.params.orderId, tenantId: tenantScope(req) });
    const rawAction = String(req.body?.action || "").trim().toLowerCase();
    const action = rawAction === "confirm" || rawAction === "edit" || rawAction === "cancel" ? rawAction : "";
    if (!action) {
      return res.status(400).json({ success: false, message: "Valid action is required" });
    }
    const currentStatus = String(order.status || "").toLowerCase();
    if ((action === "confirm" && currentStatus === "confirmed") ||
        (action === "edit" && currentStatus === "edit_requested") ||
        (action === "cancel" && currentStatus === "cancelled_by_customer")) {
      return res.json({ success: true, order });
    }
    const updated = await applyConfirmationAction({
      orderId: order.id,
      action,
      reason: String(req.body?.reason || req.body?.note || "").trim(),
      source: "admin_console",
      actorType: "staff",
      actorUserId: req.user?.id || null,
      actorUserName: req.user?.name || req.user?.full_name || "",
    });
    if (!updated) {
      return res.status(409).json({ success: false, message: "Order action could not be applied" });
    }
    const phone = normalizeEgyptPhone(order.customer_phone || order.phone || order.whatsapp || order.mobile);
    if (phone) {
      const notificationMessage = action === "confirm"
        ? `تم تأكيد طلبك رقم ${order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || order.id}. شكراً لك.`
        : action === "edit"
          ? `وصلنا طلب التعديل على طلبك رقم ${order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || order.id}. سيقوم الفريق بمراجعته الآن.`
          : `تم إلغاء طلبك رقم ${order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || order.id}. نأسف لعدم إكمال الطلب.`;
      await sendTextMessage({ phone, message: notificationMessage }).catch(() => {});
    }
    const tenantId = tenantScope(req);
    if (tenantId) {
      emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
        tenant_id: tenantId,
        order_id: updated.id,
        at: new Date().toISOString(),
      });
    }
    return res.json({ success: true, order: updated });
  } catch (error) {
    return sendError(res, error, "Failed to apply order confirmation action");
  }
});

router.post("/webhook", async (req, res) => {
  try {
    if (!verifyWebhookSecret(req)) {
      console.warn("[whatsapp:webhook-incoming]", { rejected: true, reason: "invalid_secret" });
      return res.status(401).json({ success: false, message: "Invalid webhook secret" });
    }
    const normalized = await handleIncomingWebhook(req.body || {});
    if (normalized?.skipped) {
      console.info("[whatsapp:webhook-early-skip]", {
        reason: normalized.skipReason || normalized.replyTargetReason || "evolution_noise",
        event: normalized.event || "",
        remoteJid: normalized.remoteJid || "",
        key_remoteJid: normalized.raw?.key?.remoteJid || normalized.raw?.key?.remote_jid || "",
        message_key_id: normalized.raw?.message?.key?.id || normalized.raw?.key?.id || "",
        messageId: normalized.messageId || "",
        text: normalized.text || "",
        textLength: String(normalized.text || "").length,
        fromMe: normalized.fromMe === true,
      });
      return res.status(200).json({
        success: true,
        received: true,
        message: "skipped",
        skipReason: normalized.skipReason || normalized.replyTargetReason || "evolution_noise",
      });
    }
    const confirmation = normalized.text
      ? await processConfirmationReply(normalized)
      : { action: "ignored", reason: "no_text" };
    const aiReply = normalized.text && !["confirmed", "cancelled", "cancelled_by_customer", "edit_requested", "cancel_reason_saved"].includes(confirmation?.action)
      ? await triggerWhatsappAiAutoReply(normalized).catch((error) => ({ triggered: false, sent: false, error: error?.message || "AI auto reply failed" }))
      : { triggered: false, sent: false, reason: confirmation?.action || "no_text" };
    return res.status(200).json({ success: true, received: true, message: normalized.text ? "ok" : "no_text", confirmation, aiReply });
  } catch (error) {
    console.error("[whatsapp:error]", { route: "webhook", message: error?.message || error });
    return res.status(200).json({ success: false, received: true });
  }
});

export default router;
