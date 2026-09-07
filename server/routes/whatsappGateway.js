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
import { handleWhatsappCloudWebhookRequest } from "./aiAgentOrders.js";
import { updateAiSupportMessageDeliveryStatus } from "../services/aiSupportLogService.js";
import {
  completeEmbeddedSignup,
  consumeSignupState,
  disconnectIntegration,
  findIntegrationByPhoneNumberId,
  issueSignupState,
  listIntegrations,
  publicEmbeddedSignupConfig,
  publicIntegrationShape,
} from "../services/whatsappEmbeddedSignupService.js";

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
 * The delivery statuses Meta reports for a message we sent.
 *
 * "sent" is only that we handed it over; "delivered" is the customer's phone; "read" is them
 * opening it; "failed" carries an errors[] saying why. They arrive out of order and the same id
 * can repeat, so anything acting on these later has to treat them as a set, not a sequence.
 */
const CLOUD_DELIVERY_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/*
 * Coexistence sends us our OWN outgoing messages back, because a message typed on the phone in
 * the WhatsApp Business app is an event this app never produced. Those must never be read as a
 * customer writing in — that is exactly the mistake that once confirmed an order 0.8s after we
 * asked about it (see mayDecideOrderConfirmation). The check is structural: the sender is our own
 * number, not the customer's.
 */
export const isCloudOwnEcho = (message = {}, metadata = {}) => {
  const from = String(message?.from || "").replace(/\D/g, "");
  const ours = String(metadata?.display_phone_number || "").replace(/\D/g, "");
  return Boolean(from && ours && from === ours);
};

/*
 * Everything that is NOT the acknowledgement. Runs detached: Meta retries anything not answered
 * quickly, so the response goes out first and this cannot delay or fail it.
 */
export const processWhatsappCloudWebhook = async (body = {}) => {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      const phoneNumberId = String(metadata?.phone_number_id || "").trim();
      // Which of our connected numbers this belongs to. A delivery for a number we do not know
      // is logged and dropped rather than guessed at.
      const integration = phoneNumberId ? await findIntegrationByPhoneNumberId(phoneNumberId) : null;
      if (!integration) {
        console.warn("[whatsapp:cloud-webhook-unknown-number]", {
          phone_number_id: phoneNumberId,
          waba_id: String(entry?.id || ""),
          field: String(change?.field || ""),
        });
      }

      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        const name = String(status?.status || "").toLowerCase();
        const wamid = String(status?.id || "");
        const recipient = String(status?.recipient_id || "");
        /*
         * Move the outbound row the employee already sees, rather than writing anything new.
         *
         * updateAiSupportMessageDeliveryStatus matches on the wamid and only ever moves the
         * status FORWARD — that rank rule is what makes a duplicate webhook, or a "sent" that
         * arrives after "read", harmless. Meta redelivers freely and does not order these.
         */
        let updated = null;
        if (wamid && CLOUD_DELIVERY_STATUSES.has(name)) {
          updated = await updateAiSupportMessageDeliveryStatus({
            tenantId: Number(integration?.tenant_id ?? process.env.WHATSAPP_TENANT_ID ?? 1) || 1,
            sessionId: recipient ? `whatsapp:${recipient}` : "",
            providerMessageId: wamid,
            externalMessageId: wamid,
            deliveryStatus: name,
            deliveryError: String(status?.errors?.[0]?.title || status?.errors?.[0]?.message || ""),
            errorCode: String(status?.errors?.[0]?.code ?? ""),
            resolvedPhone: recipient,
            sourcePath: "whatsapp_cloud_status_webhook",
            insertSource: "whatsapp_cloud_status_webhook",
          }).catch((error) => {
            console.warn("[whatsapp:cloud-status-update-failed]", { message_id: wamid, status: name, message: error?.message || String(error) });
            return null;
          });
          if (updated) {
            // So the ticks move in an open inbox without a reload, the same way Evolution's do.
            emitToRooms([`tenant:${updated.tenant_id || integration?.tenant_id || 1}`], "ai_inbox:message", {
              tenant_id: updated.tenant_id || integration?.tenant_id || 1,
              session_id: updated.session_id || (recipient ? `whatsapp:${recipient}` : ""),
              message: updated,
              at: new Date().toISOString(),
            });
          }
        }
        console.info("[whatsapp:cloud-delivery-status]", {
          integration_id: integration?.id || null,
          phone_number_id: phoneNumberId,
          message_id: wamid,
          status: name,
          known_status: CLOUD_DELIVERY_STATUSES.has(name),
          recipient_suffix: recipient.slice(-4),
          error_code: status?.errors?.[0]?.code ?? null,
          row_updated: Boolean(updated),
          ai_support_message_id: updated?.id || null,
          resulting_status: updated?.delivery_status || "",
        });
      }

      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const echo = isCloudOwnEcho(message, metadata);
        console.info("[whatsapp:cloud-inbound]", {
          integration_id: integration?.id || null,
          phone_number_id: phoneNumberId,
          message_id: String(message?.id || ""),
          type: String(message?.type || ""),
          own_echo: echo,
          // A tap on a template's quick reply arrives here; the payload is what decides the order.
          button_payload: String(message?.button?.payload || message?.interactive?.button_reply?.id || ""),
          from_suffix: String(message?.from || "").slice(-4),
        });
      }
    }
  }
};

/*
 * Accept, acknowledge, then work. Meta retries anything not answered quickly with a 200, so the
 * acknowledgement is sent before any processing starts and no failure below can turn into a
 * retry storm.
 */
export const handleWhatsappCloudWebhookEvent = (req, res) => {
  const body = req.body || {};
  try {
    console.info("[whatsapp:cloud-webhook-event]", {
      ...summariseCloudWebhook(body),
      signature_present: Boolean(req.headers?.["x-hub-signature-256"]),
    });
  } catch (error) {
    // A malformed body must still be acknowledged, or Meta retries it forever.
    console.warn("[whatsapp:cloud-webhook-log-failed]", { message: error?.message || String(error) });
  }
  /*
   * Hand the delivery to the pipeline that already owns Cloud inbound: it verifies Meta's
   * signature, resolves the tenant from metadata.phone_number_id, re-hosts media the webhook only
   * references by id, and writes into the SAME ai_support_messages the inbox reads. Writing a
   * second implementation here is exactly how a duplicate inbox happens.
   *
   * It answers the request itself and does so quickly; the diagnostic pass below runs after, so
   * the integration lookup and status logging cannot delay Meta's acknowledgement.
   */
  return handleWhatsappCloudWebhookRequest(req, res).finally(() => {
    setImmediate(() => {
      processWhatsappCloudWebhook(body).catch((error) => {
        console.error("[whatsapp:cloud-webhook-processing-failed]", { message: error?.message || String(error) });
      });
    });
  });
};

router.get("/webhook", handleWhatsappCloudWebhookVerification);

/* ==========================================================================================
 * WhatsApp Embedded Signup.
 *
 * The browser runs Meta's dialog and comes back with an authorization CODE. It is exchanged
 * here, never there: the app secret stays on this side, and nothing below ever returns a token
 * or a fragment of one to the client.
 *
 * These are new paths under the existing /api/whatsapp mount. The Messenger and Instagram
 * integrations live on /api/meta and /api/integrations/meta and are not touched.
 * ========================================================================================== */

// Public by design: the app id and config id travel inside Meta's own dialog URL. The secret is
// not part of this shape, and a test pins that it never becomes part of it.
router.get("/embedded-signup/config", protect, permit("settings", "view"), (req, res) => {
  return res.json({ success: true, config: publicEmbeddedSignupConfig() });
});

// One-time state, so a code cannot be replayed into this endpoint by a page the operator was
// tricked into opening while authenticated.
router.post("/embedded-signup/state", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const state = await issueSignupState({ tenantId: tenantScope(req) || 0, userId: req.user?.id || null });
    return res.json({ success: true, state });
  } catch (error) {
    return sendError(res, error, "Failed to start the WhatsApp connection");
  }
});

router.get("/embedded-signup/status", protect, permit("settings", "view"), async (req, res) => {
  try {
    const rows = await listIntegrations({ tenantId: tenantScope(req) || 0 });
    return res.json({
      success: true,
      config: publicEmbeddedSignupConfig(),
      integrations: rows.map(publicIntegrationShape),
      connected: rows.some((row) => row.status === "connected"),
    });
  } catch (error) {
    return sendError(res, error, "Failed to read the WhatsApp connection");
  }
});

router.post("/embedded-signup/callback", protect, permit("settings", "edit"), async (req, res) => {
  const tenantId = tenantScope(req) || 0;
  try {
    const code = String(req.body?.code || "").trim();
    const state = String(req.body?.state || "").trim();
    if (!code) return res.status(400).json({ success: false, code: "AUTH_CODE_REQUIRED", message: "لم يصل كود التفويض من ميتا" });
    if (!(await consumeSignupState({ state, tenantId }))) {
      return res.status(400).json({ success: false, code: "SIGNUP_STATE_INVALID", message: "انتهت صلاحية جلسة الربط، ابدأ من جديد" });
    }
    const result = await completeEmbeddedSignup({
      code,
      wabaId: String(req.body?.wabaId || req.body?.waba_id || "").trim(),
      phoneNumberId: String(req.body?.phoneNumberId || req.body?.phone_number_id || "").trim(),
      businessId: String(req.body?.businessId || req.body?.business_id || "").trim(),
      tenantId,
      userId: req.user?.id || null,
      signupEvent: req.body?.event && typeof req.body.event === "object" ? req.body.event : null,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    // A typed refusal is an outcome the operator has to read, not a server fault — and a 5xx
    // reaches the browser as an opaque CORS error, which would tell them nothing.
    console.error("[whatsapp-cloud:signup-failed]", {
      tenant_id: tenantId,
      code: error?.code || "",
      status: error?.status || 0,
      message: error?.message || String(error),
    });
    return res.status(error?.status && error.status < 500 ? error.status : 400).json({
      success: false,
      code: error?.code || "EMBEDDED_SIGNUP_FAILED",
      message: error?.message || "تعذر إتمام ربط واتساب",
    });
  }
});

/*
 * Disconnect is local. It flips our row and drops our copy of the token; it does NOT call Meta,
 * does not deregister the number, and does not delete the WABA — the operator's WhatsApp account
 * is exactly as it was and the dialog can be run again to reconnect.
 */
router.post("/embedded-signup/disconnect", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const rows = await disconnectIntegration({
      tenantId: tenantScope(req) || 0,
      id: req.body?.id ? Number(req.body.id) : null,
    });
    console.info("[whatsapp-cloud:disconnected]", {
      tenant_id: tenantScope(req) || 0,
      user_id: req.user?.id || null,
      count: rows.length,
      meta_side_untouched: true,
    });
    return res.json({ success: true, disconnected: rows.length, integrations: rows.map(publicIntegrationShape) });
  } catch (error) {
    return sendError(res, error, "Failed to disconnect WhatsApp");
  }
});

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
