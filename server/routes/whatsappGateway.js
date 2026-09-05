import express from "express";
import db from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { emitToRooms } from "../utils/socket.js";
import {
  connectInstance,
  getRecentEvolutionWebhookEvents,
  getStatus,
  handleIncomingWebhook,
  loadOrderForWhatsapp,
  mayDecideOrderConfirmation,
  normalizeEgyptPhone,
  sendTextMessage,
  sendWhatsAppButtonsDebugTest,
  syncWhatsappCustomerProfilePictures,
  triggerWhatsappAiAutoReply,
  verifyWebhookSecret,
} from "../services/whatsappGatewayService.js";
import { applyConfirmationAction, processConfirmationReply, sendOrderConfirmation } from "../services/whatsappOrderConfirmationService.js";
import { handleInboundMessageIntake } from "../services/aiInboundIntakeService.js";

const router = express.Router();

/* ==========================================================================================
 * Meta WhatsApp Cloud API webhook.
 *
 * This path is SHARED with the live Evolution inbound webhook, which has been POSTing here since
 * long before Cloud existed. The two are told apart by the payload itself: Meta stamps every
 * delivery with object "whatsapp_business_account", and Evolution never sends that key. The Meta
 * branch runs first and returns before anything Evolution-specific is touched, so the existing
 * integration is not modified in any way — it simply never sees a Meta body.
 *
 * The Facebook Messenger and Instagram webhooks are a different mount entirely
 * (/api/meta/webhook) and are not touched here.
 * ========================================================================================== */

const WHATSAPP_CLOUD_WEBHOOK_OBJECT = "whatsapp_business_account";

/*
 * The verify token. Defaulted rather than required, because a missing env var on the server would
 * turn Meta's verification into a silent 403 that reads exactly like a wrong token.
 */
const whatsappWebhookVerifyToken = () =>
  String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "M1_WHATSAPP_VERIFY_2026").trim();

export const isWhatsappCloudWebhookPayload = (body) =>
  Boolean(body) && typeof body === "object" && String(body.object || "").trim() === WHATSAPP_CLOUD_WEBHOOK_OBJECT;

/*
 * A summary, never the payload. An inbound WhatsApp body carries the customer's phone number and
 * the text they wrote; logging it whole would copy that into the container logs on every message.
 * Structure is what a webhook needs at this stage — shape, counts, and which fields arrived.
 */
const summariseCloudWebhook = (body = {}) => {
  const entries = Array.isArray(body.entry) ? body.entry : [];
  const changes = entries.flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []));
  const values = changes.map((change) => change?.value || {});
  return {
    object: String(body.object || ""),
    entry_count: entries.length,
    fields: [...new Set(changes.map((change) => String(change?.field || "")).filter(Boolean))],
    phone_number_ids: [...new Set(values.map((value) => String(value?.metadata?.phone_number_id || "")).filter(Boolean))],
    message_count: values.reduce((sum, value) => sum + (Array.isArray(value.messages) ? value.messages.length : 0), 0),
    message_types: [...new Set(values.flatMap((value) => (Array.isArray(value.messages) ? value.messages : []).map((message) => String(message?.type || ""))).filter(Boolean))],
    status_count: values.reduce((sum, value) => sum + (Array.isArray(value.statuses) ? value.statuses.length : 0), 0),
    from_suffixes: [...new Set(values.flatMap((value) => (Array.isArray(value.messages) ? value.messages : []).map((message) => String(message?.from || "").slice(-4))).filter(Boolean))],
  };
};

export const handleWhatsappCloudWebhookVerification = (req, res) => {
  const mode = String(req.query?.["hub.mode"] ?? "").trim();
  const verifyToken = String(req.query?.["hub.verify_token"] ?? "").trim();
  const challenge = String(req.query?.["hub.challenge"] ?? "").trim();
  const matched = mode === "subscribe" && verifyToken === whatsappWebhookVerifyToken() && verifyToken.length > 0;

  console.info("[whatsapp:cloud-webhook-verification]", {
    path: req.originalUrl || req.url || "",
    mode,
    token_matched: matched,
    challenge_present: challenge.length > 0,
  });

  /*
   * Meta compares the response BODY to the challenge byte for byte, so this must be the raw value
   * and nothing else: no JSON envelope, no trailing newline, no redirect. res.type is set before
   * send() because express would otherwise answer a numeric-looking string as JSON.
   */
  res.type("text/plain");
  if (matched && challenge) return res.status(200).send(challenge);
  return res.status(403).send("Forbidden");
};

/*
 * Accept, log, acknowledge. Nothing is processed yet: Meta retries anything that is not answered
 * quickly with a 200, so acknowledging first is the behaviour that keeps deliveries flowing while
 * the message pipeline is still being built.
 */
export const handleWhatsappCloudWebhookEvent = (req, res) => {
  try {
    console.info("[whatsapp:cloud-webhook-event]", {
      ...summariseCloudWebhook(req.body || {}),
      signature_present: Boolean(req.headers?.["x-hub-signature-256"]),
    });
  } catch (error) {
    // A malformed body must still be acknowledged, or Meta retries it forever.
    console.warn("[whatsapp:cloud-webhook-log-failed]", { message: error?.message || String(error) });
  }
  return res.status(200).json({ success: true, received: true });
};

router.get("/webhook", handleWhatsappCloudWebhookVerification);

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

// Re-pair a dropped WhatsApp session from inside the ERP. Gated on settings:edit
// because the QR it returns links a device to the shop's WhatsApp account — the
// same authority the Evolution manager grants, and the reason the gateway API
// key never leaves the server.
router.post("/instance/connect", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await connectInstance({
      instance: req.body?.instance || "",
      number: req.body?.number || "",
      // "New code" has to mean a NEW code: a wedged instance repeats its cached,
      // long-expired QR forever otherwise, and the scan does nothing.
      restart: req.body?.restart === true,
    });
    console.info("[whatsapp:instance-connect]", {
      instanceName: result.instanceName,
      state: result.state,
      hasQr: Boolean(result.qr_image),
      alreadyConnected: result.already_connected,
      userId: req.user?.id || null,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to start WhatsApp pairing");
  }
});

router.get("/webhook/debug-events", protect, permit("settings", "view"), async (req, res) => {
  const debugEvents = getRecentEvolutionWebhookEvents();
  return res.json({
    success: true,
    ...debugEvents,
  });
});

router.post("/profile-pictures/sync", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await syncWhatsappCustomerProfilePictures({
      tenantId: tenantScope(req),
      limit: req.body?.limit,
      force: req.body?.force === true,
    });
    emitToRooms([`tenant:${tenantScope(req)}`], "ai_inbox:refresh", {
      tenant_id: tenantScope(req),
      source: "whatsapp_profile_picture_sync",
      at: new Date().toISOString(),
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to sync WhatsApp profile pictures");
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
    // Meta first, and before verifyWebhookSecret: Meta does not carry the Evolution secret, so
    // the existing check would answer it 401 and Meta would disable the subscription.
    if (isWhatsappCloudWebhookPayload(req.body)) return handleWhatsappCloudWebhookEvent(req, res);
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
    // ── Colour-card tap ────────────────────────────────────────────────────────────────────────
    // A tap on a colour carousel card arrives as a button reply whose id names the exact variant.
    // The AI pipeline grounds colours from TEXT, so the tap is rewritten into the one sentence the
    // grounding gate resolves deterministically — the product name and the colour string exactly
    // as the catalog spells them. The customer's tap label ("اطلب اللون ده") says nothing usable;
    // this rewrite is what turns it into an unambiguous colour choice.
    const colorTap = String(normalized.selectedButtonId || "").match(/^choose_color:(\d+)$/);
    if (colorTap) {
      try {
        const variantRow = await db.query(
          `SELECT v.id, v.color, p.name AS product_name
           FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE v.id = $1 LIMIT 1`,
          [Number(colorTap[1])]
        );
        const picked = variantRow.rows[0];
        if (picked) {
          const rewritten = `عايز ${picked.product_name}${picked.color ? ` لون ${picked.color}` : ""}`;
          console.info("[whatsapp:color-choice-tap]", {
            variant_id: picked.id,
            color: picked.color || "",
            product: picked.product_name || "",
            rewritten,
          });
          normalized.text = rewritten;
          normalized.original_message = rewritten;
          normalized.normalized_message = "";
          normalized.normalized_for_intent = "";
        }
      } catch (colorTapError) {
        console.warn("[whatsapp:color-choice-tap-failed]", {
          selected: normalized.selectedButtonId || "",
          message: colorTapError?.message || String(colorTapError),
        });
      }
    }
    const mayDecide = mayDecideOrderConfirmation(normalized);
    const confirmation = mayDecide
      ? await processConfirmationReply(normalized)
      : { action: "ignored", reason: normalized.fromMe === true ? "own_outgoing_message" : "no_text" };
    if (!mayDecide && normalized.text) {
      console.info("[whatsapp:confirmation-skipped-own-echo]", {
        messageId: normalized.messageId || "",
        remoteJid: normalized.remoteJid || "",
        rawEvent: normalized.rawEvent || "",
        textPreview: String(normalized.text).slice(0, 80),
      });
    }
    const aiReply = normalized.text && !["confirmed", "cancelled", "cancelled_by_customer", "edit_requested", "cancel_reason_saved"].includes(confirmation?.action)
      ? await triggerWhatsappAiAutoReply(normalized).catch((error) => ({ triggered: false, sent: false, error: error?.message || "AI auto reply failed" }))
      : { triggered: false, sent: false, reason: confirmation?.action || "no_text" };
    // Phase 10 (default OFF): pre-generate a grounded reply SUGGESTION for human approval. Fire-and-forget
    // so the webhook never waits on or fails because of it; it never sends and only runs on a genuinely
    // new persisted inbound text message that the autonomous path did not already auto-send.
    if (normalized.text && normalized.fromMe !== true && normalized.inbox?.saved === true && normalized.inbox?.duplicate !== true) {
      handleInboundMessageIntake({
        tenantId: normalized.inbox?.message?.tenant_id,
        channel: "whatsapp",
        conversationId: normalized.inbox?.session_id || normalized.inbox?.message?.session_id,
        canonicalMessageId: normalized.inbox?.message?.id || null,
        providerMessageId: normalized.messageId || normalized.inbox?.message?.provider_message_id || "",
        text: normalized.text,
        fromMe: false,
        autoSent: aiReply?.sent === true,
      }).catch(() => {});
    }
    return res.status(200).json({ success: true, received: true, message: normalized.text ? "ok" : "no_text", confirmation, aiReply });
  } catch (error) {
    console.error("[whatsapp:error]", { route: "webhook", message: error?.message || error });
    return res.status(200).json({ success: false, received: true });
  }
});

export default router;
