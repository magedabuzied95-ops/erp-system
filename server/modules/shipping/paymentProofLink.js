import { createHmac } from "node:crypto";

import db from "../../database/db.js";
import { generateOrderLinkCode, orderLinkSecret } from "../../utils/orderLinkSecret.js";
import { resolvePublicAppUrl } from "../../utils/whatsapp.js";
import { emitToRooms } from "../../utils/socket.js";
import { describeShippingFeeAdvance } from "./shippingFeeAdvance.js";

/*
 * The shipping-fee payment card and the page it links to.
 *
 * Under the restricted closing system an order outside the COD governorates has to prepay its
 * shipping fee. The WhatsApp confirmation request used to end with the wallet number, the InstaPay
 * handle and "ابعت صورة التحويل هنا" — but nothing in the system ever read a screenshot sent in the
 * chat: it sat in the inbox as a photo, unattached to any order, and the visual search could answer
 * it with shoes.
 *
 * Now the request is followed by a card of its own: pay by InstaPay (opens the app), copy the
 * Vodafone Cash number, upload the transfer screenshot. The upload link (/pay/:code) attaches the
 * picture to the order and puts it in payment review, where staff approve it with one tap (or the
 * Vodafone Cash SMS matches it on its own). A screenshot sent in the chat anyway is answered with
 * the same link.
 *
 * Codes live in order_confirmation_codes under their own action and their own HMAC namespace, and
 * the confirmation link refuses them, so an upload code can never confirm or cancel an order.
 */

export const PAYMENT_PROOF_CODE_ACTION = "payment_proof";
export const PAYMENT_PROOF_METHODS = Object.freeze(["instapay", "vodafone_cash"]);
export const PAYMENT_PROOF_TIMELINE_ACTION = "payment_proof_uploaded";
export const PAYMENT_PROOF_SOURCE = "payment_proof_link";

const LINK_TTL_DAYS = Math.max(1, Number(process.env.PAYMENT_PROOF_LINK_TTL_DAYS || 7) || 7);
// A code with less than this left is replaced rather than handed out again.
const REUSE_MIN_REMAINING_MS = 24 * 60 * 60 * 1000;
const CLOSED_STATUSES = new Set([
  "cancelled", "canceled", "cancelled_by_customer", "returned", "delivered", "completed",
  "shipped", "out_for_delivery",
]);
const FOOTER = "M1 Store";

const text = (value = "") => String(value ?? "").trim();
const money = (value) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next * 100) / 100 : 0;
};
const formatMoney = (value) => {
  const amount = money(value);
  const hasPiastres = Math.round(amount * 100) % 100 !== 0;
  return amount.toLocaleString("en-US", { minimumFractionDigits: hasPiastres ? 2 : 0, maximumFractionDigits: hasPiastres ? 2 : 0 });
};
const orderRef = (order = {}) =>
  text(order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || order.id).replace(/^#/, "");
const orderTotal = (order = {}) => money(order.total_amount ?? order.total_price ?? order.total ?? 0);
const firstName = (name = "") => text(name).split(/\s+/).filter(Boolean)[0] || "";
const tenantOf = (order = {}) => Number(order.tenant_id) || Number(process.env.WHATSAPP_TENANT_ID) || 1;
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

export const hashPaymentProofCode = (code = "") =>
  createHmac("sha256", orderLinkSecret()).update(`${PAYMENT_PROOF_CODE_ACTION}:${text(code)}`).digest("hex");

export const paymentProofPublicUrl = (code = "") => {
  const safeCode = text(code);
  if (!safeCode) return "";
  const base = text(resolvePublicAppUrl()).replace(/\/+$/, "");
  return `${base}/pay/${encodeURIComponent(safeCode)}`;
};

/* ------------------------------------------------------------------ codes */

// One live link per order. A code that still has a day left is handed out again, so a resent
// confirmation does not kill the link in the card the customer already has.
export const issuePaymentProofLink = async ({ order = {}, client = db } = {}) => {
  if (!order?.id) throw httpError(400, "ORDER_REQUIRED", "Order is required");
  const tenantId = tenantOf(order);
  const existing = await client.query(
    `
    SELECT code, expires_at
    FROM order_confirmation_codes
    WHERE tenant_id = $1 AND order_id = $2 AND action = $3
    LIMIT 1
    `,
    [tenantId, order.id, PAYMENT_PROOF_CODE_ACTION]
  );
  const row = existing.rows[0];
  if (row?.code && new Date(row.expires_at).getTime() - Date.now() > REUSE_MIN_REMAINING_MS) {
    return { code: row.code, url: paymentProofPublicUrl(row.code), expiresAt: row.expires_at };
  }
  const code = generateOrderLinkCode();
  const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
  await client.query(
    `
    INSERT INTO order_confirmation_codes (tenant_id, order_id, action, code, code_hash, expires_at, used_at, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NULL, NOW(), NOW())
    ON CONFLICT (tenant_id, order_id, action)
    DO UPDATE SET code = EXCLUDED.code, code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
                  used_at = NULL, used_action = NULL, used_order_status = NULL, updated_at = NOW()
    `,
    [tenantId, order.id, PAYMENT_PROOF_CODE_ACTION, code, hashPaymentProofCode(code), expiresAt]
  );
  return { code, url: paymentProofPublicUrl(code), expiresAt };
};

/* ------------------------------------------------------------------- card */

/**
 * The card, as pure data so it can be tested without a gateway. `transfer` is loadTransferDetails().
 * Buttons that have nothing behind them are left out.
 *
 * One number takes both kinds of transfer: the shop's Vodafone Cash wallet is also its InstaPay
 * number (owner, 2026-09-15). So the card shows that ONE number and says it works for InstaPay and
 * Vodafone Cash alike, rather than a separate InstaPay handle the customer has to choose between.
 */
export const buildShippingFeePaymentCard = ({ order = {}, amount = 0, transfer = {}, uploadUrl = "" } = {}) => {
  const fee = formatMoney(amount);
  const rest = Math.max(0, money(orderTotal(order) - money(amount)));
  const ref = orderRef(order);
  const instapayUrl = text(transfer.instapayUrl);
  // The transfer number; the InstaPay handle only stands in when no wallet number is set.
  const number = text(transfer.vodafone) || text(transfer.instapayHandle);

  // Evolution refuses more than TWO CTA buttons on a message ("Maximum of 2 CTA buttons allowed" —
  // INV-1652 went out as plain text because the card had three). The upload button always stays;
  // the other slot copies the number (or opens InstaPay when a payment link is set and there is no
  // number). The number is also written in the body.
  const payButton = number
    ? { type: "copy", displayText: "انسخ الرقم", copyCode: number }
    : instapayUrl ? { type: "url", displayText: "ادفع بانستا باي", url: instapayUrl } : null;
  const buttons = [
    payButton,
    uploadUrl ? { type: "url", displayText: "ارفع صورة التحويل", url: uploadUrl } : null,
  ].filter(Boolean);

  const title = "💳 دفع رسوم الشحن";
  const opening = `رسوم الشحن لطلبك${ref ? ` رقم ${ref}` : ""}: ${fee} جنيه${rest > 0 ? `، والباقي ${formatMoney(rest)} جنيه تدفعه عند الاستلام` : ""}.`;
  const closing = "وأول ما نراجع التحويل هنأكد طلبك ونشحنه على طول ✅";
  const payStep = number
    ? `1️⃣ حوّل ${fee} جنيه على الرقم ده:\n📱 ${number}\nينفع تحوّل عليه بانستا باي أو فودافون كاش 👌`
    : instapayUrl ? `1️⃣ حوّل ${fee} جنيه بانستا باي` : `1️⃣ حوّل ${fee} جنيه`;

  const body = [
    opening,
    payStep,
    uploadUrl ? "2️⃣ اضغط «ارفع صورة التحويل» وابعت الصورة" : "2️⃣ ابعت صورة التحويل هنا",
    closing,
  ].join("\n\n");

  // What the customer gets when the buttons do not render: every value spelled out.
  const fallbackText = [
    title,
    opening,
    [payStep, !number && instapayUrl ? `🏦 ${instapayUrl}` : ""].filter(Boolean).join("\n"),
    uploadUrl ? `2️⃣ ارفع صورة التحويل من هنا:\n${uploadUrl}` : "2️⃣ ابعت صورة التحويل هنا",
    closing,
  ].join("\n\n");

  const transcriptButtons = [
    { type: "whatsapp_footer", title: FOOTER },
    ...buttons.map((button) => ({
      type: button.type === "copy" ? "whatsapp_copy_button" : "whatsapp_url_button",
      title: button.displayText,
      value: button.url || button.copyCode || "",
    })),
  ];

  return { title, body, footer: FOOTER, buttons, fallbackText, transcriptButtons };
};

/**
 * Everything the confirmation request needs to know before it is worded: whether a card will
 * follow it. Returns null when it will not (nothing owed, or the link could not be issued), and the
 * request then keeps the payment details in its own body as before.
 */
export const prepareShippingFeePaymentCard = async ({ order = {}, amount = 0 } = {}) => {
  try {
    if (!order?.id || !(money(amount) > 0)) return null;
    const { loadTransferDetails } = await import("../../services/codPolicyReplyService.js");
    const [transfer, link] = await Promise.all([loadTransferDetails(), issuePaymentProofLink({ order })]);
    const card = buildShippingFeePaymentCard({ order, amount, transfer, uploadUrl: link.url });
    return card.buttons.length ? { ...card, uploadUrl: link.url } : null;
  } catch (error) {
    console.warn("[payment-proof] card not prepared", { orderId: order?.id, message: error?.message || String(error) });
    return null;
  }
};

/**
 * For a WhatsApp message that confirms an order: the closing-system notice, and the card that
 * follows it. With a card the notice only names the amount; without one (nothing owed, or the link
 * could not be issued) it keeps the wallet details, exactly as before. Never throws.
 */
export const shippingFeeNoticeWithPaymentCard = async (order = {}) => {
  const { shippingFeeAdvanceNoticeForOrder } = await import("../../services/codPolicyReplyService.js");
  let card = null;
  try {
    if (order?.id) {
      const { loadCodPolicySettings } = await import("../../services/storefrontShippingService.js");
      const advance = describeShippingFeeAdvance({ order, policy: await loadCodPolicySettings() });
      if (advance.required && advance.status !== "paid") card = await prepareShippingFeePaymentCard({ order, amount: advance.amount });
    }
  } catch (error) {
    console.warn("[payment-proof] card check failed", { orderId: order?.id, message: error?.message || String(error) });
  }
  const notice = await shippingFeeAdvanceNoticeForOrder(order, { paymentCardFollows: Boolean(card) });
  // A notice that came back empty means nothing is owed after all: no card either.
  return { notice, card: notice ? card : null };
};

/* ------------------------------------------------------ WhatsApp plumbing */

const appendSystemTranscript = async ({ tenantId, phone, message, source, buttons = [], result = null, customerName = "" }) => {
  try {
    const { appendWhatsappOutboundSupportReply } = await import("../../services/aiSupportLogService.js");
    // Same fields whatsappOrderConfirmationService reads the provider id from.
    const messageId = text(result?.result?.message_id || result?.result?.messageId || result?.result?.key?.id || result?.message_id || result?.id);
    const saved = await appendWhatsappOutboundSupportReply({
      tenantId,
      sessionId: `whatsapp:${phone}`,
      message,
      messageType: "text",
      senderType: "system",
      suggestedActions: buttons,
      source,
      channel: "whatsapp",
      deliveryStatus: "sent",
      externalMessageId: messageId,
      providerMessageId: messageId,
      whatsappInstance: result?.instanceName || result?.instance || "",
      remoteJid: `whatsapp:${phone}`,
      resolvedReplyJid: `whatsapp:${phone}`,
      resolvedPhone: phone,
      preserveExactMessage: true,
      upsertSession: true,
      sessionStatus: "ai_active",
      sessionSource: "whatsapp",
      sessionChannel: "whatsapp",
      sessionCustomerName: customerName,
      sourcePath: source,
      insertSource: source,
      confidence: 1,
      detectedIntent: source,
    });
    if (saved && tenantId) {
      const room = `tenant:${tenantId}`;
      emitToRooms([room], "ai_inbox:message", { tenant_id: tenantId, session_id: `whatsapp:${phone}`, message: saved, at: new Date().toISOString() });
      emitToRooms([room], "ai_inbox:refresh", { tenant_id: tenantId, session_id: `whatsapp:${phone}`, at: new Date().toISOString() });
    }
  } catch (error) {
    console.warn("[payment-proof] transcript not saved", { source, message: error?.message || String(error) });
  }
};

const orderPhone = async (order = {}) => {
  const { normalizeEgyptPhone } = await import("../../services/whatsappGatewayService.js");
  return normalizeEgyptPhone(order.customer_phone || order.phone || order.whatsapp || order.mobile || "");
};

/** Queue the prepared card right behind the confirmation request. Never throws. */
export const queueShippingFeePaymentCard = async ({ order = {}, card = null, phone = "", tenantId = null, idempotencySuffix = "" } = {}) => {
  if (!card || !order?.id || !phone) return { queued: false, reason: "nothing_to_send" };
  const safeTenantId = Number(tenantId) || tenantOf(order);
  const transcriptMessage = `${card.title}\n\n${card.body}`;
  try {
    const [{ queueWhatsappAutomation }, gateway] = await Promise.all([
      import("../../services/whatsappQueue/index.js"),
      import("../../services/whatsappGatewayService.js"),
    ]);
    const directSend = async () => {
      let result = null;
      let buttons = card.transcriptButtons;
      let message = transcriptMessage;
      try {
        result = await gateway.sendCtaButtonsMessage({ phone, title: card.title, text: card.body, footer: card.footer, buttons: card.buttons, fallbackText: card.fallbackText });
      } catch (error) {
        console.warn("[payment-proof] card buttons unavailable, sending text", { orderId: order.id, message: error?.message || String(error) });
        result = await gateway.sendTextMessage({ phone, message: card.fallbackText });
        buttons = [];
        message = card.fallbackText;
      }
      await appendSystemTranscript({ tenantId: safeTenantId, phone, message, source: "whatsapp_shipping_fee_payment_card", buttons, result, customerName: text(order.customer_name) });
      return result;
    };
    const queued = await queueWhatsappAutomation({
      tenantId: safeTenantId,
      automationType: "shipping_fee_payment_card",
      idempotencySuffix,
      customerId: order.customer_id || null,
      orderId: order.id,
      invoiceNumber: text(order.invoice_number),
      recipientPhone: phone,
      // A beat behind the confirmation request, so the card never lands above it.
      scheduledAt: new Date(Date.now() + 2000),
      send: {
        kind: "cta_buttons",
        title: card.title,
        footer: card.footer,
        buttons: card.buttons,
        fallbackText: card.fallbackText,
      },
      values: { customer_name: text(order.customer_name), order_number: orderRef(order) },
      fallbackBody: card.body,
      onSent: {
        transcript: {
          session_id: `whatsapp:${phone}`,
          source: "whatsapp_shipping_fee_payment_card",
          customer_name: text(order.customer_name),
          message: transcriptMessage,
          buttons: card.transcriptButtons,
        },
      },
      // Taken by the queue itself when it is switched off (or unreachable).
      directSend,
    });
    return queued;
  } catch (error) {
    console.warn("[payment-proof] card not sent", { orderId: order.id, message: error?.message || String(error) });
    return { queued: false, reason: "send_failed" };
  }
};

// A short system message about the transfer. Queued (paced, recorded) when the queue is on.
const sendOrderPaymentText = async ({ order = {}, automationType, message, idempotencySuffix = "", source }) => {
  const phone = await orderPhone(order);
  if (!phone || !message) return { sent: false, reason: "missing_phone" };
  const tenantId = tenantOf(order);
  try {
    const [{ queueWhatsappAutomation }, gateway] = await Promise.all([
      import("../../services/whatsappQueue/index.js"),
      import("../../services/whatsappGatewayService.js"),
    ]);
    const directSend = async () => {
      const result = await gateway.sendTextMessage({ phone, message });
      await appendSystemTranscript({ tenantId, phone, message, source, result, customerName: text(order.customer_name) });
      return result;
    };
    const queued = await queueWhatsappAutomation({
      tenantId,
      automationType,
      idempotencySuffix,
      customerId: order.customer_id || null,
      orderId: order.id,
      invoiceNumber: text(order.invoice_number),
      recipientPhone: phone,
      send: { kind: "text" },
      values: { customer_name: text(order.customer_name), order_number: orderRef(order) },
      fallbackBody: message,
      onSent: { transcript: { session_id: `whatsapp:${phone}`, source, customer_name: text(order.customer_name), message } },
      directSend,
    });
    return { sent: Boolean(queued.queued || queued.direct), queued: Boolean(queued.queued), duplicate: Boolean(queued.duplicate) };
  } catch (error) {
    console.warn("[payment-proof] message not sent", { orderId: order.id, automationType, message: error?.message || String(error) });
    return { sent: false, reason: "send_failed" };
  }
};

export const buildPaymentProofReceivedMessage = (order = {}) => {
  const ref = orderRef(order);
  return [
    `🧾 استلمنا صورة تحويل رسوم الشحن لطلبك${ref ? ` رقم ${ref}` : ""}`,
    "⏳ طلبك دلوقتي في مراجعة الدفع، وهنأكدلك أول ما نراجعها.",
    "شكراً لاختيارك M1 Store ❤️",
  ].join("\n\n");
};

export const buildPaymentProofApprovedMessage = (order = {}) => {
  const ref = orderRef(order);
  const total = orderTotal(order);
  const collect = Math.max(0, money(total - money(order.paid_amount)));
  return [
    `✅ تم تأكيد دفع رسوم الشحن لطلبك${ref ? ` رقم ${ref}` : ""}`,
    `🚚 طلبك بيتجهز للشحن دلوقتي${collect > 0 ? `، والمندوب هيحصّل ${formatMoney(collect)} جنيه عند الاستلام` : ""}.`,
    "شكراً لاختيارك M1 Store ❤️",
  ].join("\n\n");
};

const uploadedThroughLink = (order = {}) =>
  (Array.isArray(order.timeline) ? order.timeline : []).some(
    (entry) => entry?.action === PAYMENT_PROOF_TIMELINE_ACTION && entry?.source === PAYMENT_PROOF_SOURCE
  );

/**
 * Tell the customer their transfer was approved — only when they uploaded it through the link, so
 * every other approval path (website checkout proofs, staff-recorded payments) stays as silent as
 * it was. Never throws; call it after the approving transaction has committed.
 */
export const notifyPaymentProofApproved = async (order = null) => {
  if (!order?.id || !uploadedThroughLink(order)) return { sent: false, reason: "not_link_upload" };
  return sendOrderPaymentText({
    order,
    automationType: "payment_proof_approved",
    message: buildPaymentProofApprovedMessage(order),
    source: "whatsapp_payment_proof_approved",
  });
};

/* ---------------------------------------------------------- public page */

const loadCodeRow = async (client, code, { lock = false } = {}) => {
  const safeCode = text(code);
  if (!safeCode) throw httpError(400, "PAYMENT_PROOF_CODE_MISSING", "الرابط غير صالح.");
  const result = await client.query(
    `
    SELECT *
    FROM order_confirmation_codes
    WHERE code_hash = $1 AND action = $2
    LIMIT 1
    ${lock ? "FOR UPDATE" : ""}
    `,
    [hashPaymentProofCode(safeCode), PAYMENT_PROOF_CODE_ACTION]
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, "PAYMENT_PROOF_CODE_NOT_FOUND", "الرابط غير صالح.");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw httpError(410, "PAYMENT_PROOF_CODE_EXPIRED", "الرابط انتهت صلاحيته. ابعتلنا رسالة على واتساب وهنبعتلك رابط جديد.");
  }
  return row;
};

/**
 * Where the order stands, from the customer's side:
 *   ready        — owes the fee, may upload
 *   submitted    — a screenshot is waiting for review
 *   paid         — nothing left to do
 *   not_required — this order never needed a transfer
 *   closed       — cancelled / delivered / already out
 */
export const paymentProofState = ({ order = {}, advance = {} } = {}) => {
  if (CLOSED_STATUSES.has(text(order.status).toLowerCase())) return "closed";
  if (!advance.required) return "not_required";
  if (advance.status === "paid") return "paid";
  if (advance.status === "awaiting_review") return "submitted";
  return "ready";
};

const publicView = ({ order, advance, transfer, state }) => ({
  state,
  order: {
    number: orderRef(order),
    customer_first_name: firstName(order.customer_name),
    total: orderTotal(order),
    shipping_fee: money(advance.amount),
    remaining_on_delivery: Math.max(0, money(orderTotal(order) - money(advance.amount))),
  },
  methods: {
    instapay_url: text(transfer.instapayUrl),
    // The same number takes InstaPay and Vodafone Cash (see buildShippingFeePaymentCard).
    instapay_handle: text(transfer.vodafone) || text(transfer.instapayHandle),
    vodafone_cash: text(transfer.vodafone),
  },
  submitted_method: text(order.shipping_payment_method),
});

export const loadPaymentProofPage = async ({ code = "" } = {}) => {
  const codeRow = await loadCodeRow(db, code);
  const orderResult = await db.query(`SELECT * FROM orders WHERE id = $1 LIMIT 1`, [codeRow.order_id]);
  const order = orderResult.rows[0];
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "الطلب غير موجود.");
  const [{ loadCodPolicySettings }, { loadTransferDetails }] = await Promise.all([
    import("../../services/storefrontShippingService.js"),
    import("../../services/codPolicyReplyService.js"),
  ]);
  const [policy, transfer] = await Promise.all([loadCodPolicySettings(), loadTransferDetails()]);
  const advance = describeShippingFeeAdvance({ order, policy });
  return publicView({ order, advance, transfer, state: paymentProofState({ order, advance }) });
};

const REFUSALS = {
  closed: [409, "ORDER_CLOSED", "الطلب ده مبقاش مستني دفع."],
  not_required: [409, "PAYMENT_NOT_REQUIRED", "طلبك مش محتاج تحويل مقدّم."],
  paid: [409, "ALREADY_PAID", "رسوم الشحن لطلبك اتأكدت خلاص."],
  submitted: [409, "ALREADY_SUBMITTED", "صورة التحويل وصلتنا قبل كده وطلبك في مراجعة الدفع."],
};

/**
 * The customer uploaded a screenshot. The picture goes on the order, the order goes into payment
 * review, staff are notified and the customer is told it arrived. A rejected transfer may be
 * uploaded again; a waiting or approved one may not.
 */
export const submitPaymentProof = async ({ code = "", method = "", proofPath = "" } = {}) => {
  const safeMethod = text(method).toLowerCase();
  if (!PAYMENT_PROOF_METHODS.includes(safeMethod)) throw httpError(400, "PAYMENT_METHOD_REQUIRED", "اختار طريقة الدفع.");
  if (!text(proofPath)) throw httpError(400, "PAYMENT_PROOF_REQUIRED", "اختار صورة التحويل.");
  const { loadCodPolicySettings } = await import("../../services/storefrontShippingService.js");
  const policy = await loadCodPolicySettings();

  const client = await db.connect();
  let updated = null;
  try {
    await client.query("BEGIN");
    const codeRow = await loadCodeRow(client, code, { lock: true });
    const locked = await client.query(`SELECT * FROM orders WHERE id = $1 LIMIT 1 FOR UPDATE`, [codeRow.order_id]);
    const order = locked.rows[0];
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "الطلب غير موجود.");
    const advance = describeShippingFeeAdvance({ order, policy });
    const state = paymentProofState({ order, advance });
    if (state !== "ready") throw httpError(...REFUSALS[state]);

    const timelineEntry = JSON.stringify([{
      action: PAYMENT_PROOF_TIMELINE_ACTION,
      status: text(order.status),
      note: safeMethod,
      source: PAYMENT_PROOF_SOURCE,
      actor: "customer",
      label: "العميل رفع صورة تحويل الشحن",
      amount: money(advance.amount),
      at: new Date().toISOString(),
    }]);
    const result = await client.query(
      `
      UPDATE orders
      SET shipping_payment_screenshot = $2,
          shipping_payment_method = $3,
          transfer_proof_status = 'pending',
          timeline = COALESCE(timeline, '[]'::jsonb) || $4::jsonb,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [order.id, text(proofPath), safeMethod, timelineEntry]
    );
    updated = result.rows[0];
    await client.query(
      `UPDATE order_confirmation_codes SET used_at = NOW(), used_action = $2, used_order_status = $3, updated_at = NOW() WHERE id = $1`,
      [codeRow.id, PAYMENT_PROOF_TIMELINE_ACTION, text(updated?.status)]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const ref = orderRef(updated);
  import("../../services/notificationsService.js")
    .then(({ createSystemNotification }) => createSystemNotification("payment_proof_uploaded", {
      tenant_id: updated.tenant_id,
      message: `طلب ${ref} — العميل رفع صورة تحويل رسوم الشحن وتحتاج مراجعة`,
      action_url: `/orders/${updated.id}`,
      entity_type: "order",
      entity_id: updated.id,
      metadata: { order_id: updated.id, invoice_number: updated.invoice_number, public_order_number: updated.public_order_number, proof: updated.shipping_payment_screenshot, source: PAYMENT_PROOF_SOURCE },
    }))
    .catch((error) => console.warn("[payment-proof] notification skipped", { orderId: updated.id, message: error?.message || String(error) }));
  await sendOrderPaymentText({
    order: updated,
    automationType: "payment_proof_received",
    message: buildPaymentProofReceivedMessage(updated),
    // A rejected transfer uploaded again is a new event and deserves its own receipt.
    idempotencySuffix: `upload-${Date.now()}`,
    source: "whatsapp_payment_proof_received",
  });
  console.info("[payment-proof] uploaded", { orderId: updated.id, method: text(updated.shipping_payment_method) });
  // The customer usually transfers first and uploads after, so the Vodafone Cash SMS may already be
  // sitting unmatched. Now that the order waits on review it can claim it. Never blocks the reply.
  import("../walletTransfers/walletTransfers.service.js")
    .then(({ rematchWalletTransfersForOrder }) => rematchWalletTransfersForOrder({ tenantId: updated.tenant_id ?? null, orderId: updated.id }))
    .catch((error) => console.warn("[payment-proof] wallet rematch skipped", { orderId: updated.id, message: error?.message || String(error) }));

  const { loadTransferDetails } = await import("../../services/codPolicyReplyService.js");
  const transfer = await loadTransferDetails().catch(() => ({}));
  const advance = describeShippingFeeAdvance({ order: updated, policy });
  return publicView({ order: updated, advance, transfer, state: paymentProofState({ order: updated, advance }) });
};

/* -------------------------------------------------- screenshot in the chat */

const recentChatReplies = new Map();
const CHAT_REPLY_COOLDOWN_MS = 2 * 60 * 1000;

// The newest order on this number that still owes its shipping fee (or is waiting on review).
export const findOrderAwaitingShippingTransfer = async ({ phone = "" } = {}) => {
  const digits = text(phone).replace(/\D/g, "");
  if (!digits) return null;
  const local = digits.replace(/^20/, "0");
  const result = await db.query(
    `
    SELECT *
    FROM orders
    WHERE regexp_replace(COALESCE(customer_phone, ''), '\\D', '', 'g') IN ($1, $2)
      AND created_at >= NOW() - INTERVAL '14 days'
      AND LOWER(COALESCE(status, '')) <> ALL($3::text[])
    ORDER BY created_at DESC, id DESC
    LIMIT 5
    `,
    [digits, local, [...CLOSED_STATUSES]]
  );
  if (!result.rows.length) return null;
  const { loadCodPolicySettings } = await import("../../services/storefrontShippingService.js");
  const policy = await loadCodPolicySettings();
  for (const order of result.rows) {
    const advance = describeShippingFeeAdvance({ order, policy });
    const state = paymentProofState({ order, advance });
    if (state === "ready" || state === "submitted") return { order, advance, state };
  }
  return null;
};

export const buildScreenshotInChatReply = ({ order = {}, state = "ready", uploadUrl = "" } = {}) => {
  const ref = orderRef(order);
  if (state === "submitted") {
    return `🧾 صورة التحويل لطلبك${ref ? ` رقم ${ref}` : ""} وصلتنا قبل كده، وطلبك في مراجعة الدفع ⏳\nهنأكدلك أول ما نراجعها.`;
  }
  return [
    `📸 عشان نربط التحويل بطلبك${ref ? ` رقم ${ref}` : ""} ونراجعه بسرعة، ارفع صورة التحويل من اللينك ده:`,
    uploadUrl,
    "وأول ما نراجعها هنأكد طلبك ونشحنه على طول ✅",
  ].filter(Boolean).join("\n\n");
};

/**
 * A photo arrived on WhatsApp from a customer whose order is waiting on its shipping transfer. It
 * is almost certainly the screenshot, so it is answered with the upload link instead of being run
 * through the product visual search. Returns { handled } — handled means the AI must not answer it.
 * Anyone without such an order gets handled:false and the photo goes where it always went.
 */
export const answerTransferScreenshotInChat = async ({ phone = "" } = {}) => {
  try {
    const { normalizeEgyptPhone, sendTextMessage } = await import("../../services/whatsappGatewayService.js");
    const safePhone = normalizeEgyptPhone(phone);
    if (!safePhone) return { handled: false, reason: "no_phone" };
    const found = await findOrderAwaitingShippingTransfer({ phone: safePhone });
    if (!found) return { handled: false, reason: "no_order_awaiting_transfer" };
    const { order, state } = found;
    const lastAt = recentChatReplies.get(safePhone) || 0;
    if (Date.now() - lastAt < CHAT_REPLY_COOLDOWN_MS) {
      // Several screenshots in a row get one answer, and none of them reach the visual search.
      return { handled: true, reason: "reply_cooldown", orderId: order.id };
    }
    const uploadUrl = state === "ready" ? (await issuePaymentProofLink({ order })).url : "";
    const message = buildScreenshotInChatReply({ order, state, uploadUrl });
    recentChatReplies.set(safePhone, Date.now());
    const result = await sendTextMessage({ phone: safePhone, message });
    await appendSystemTranscript({ tenantId: tenantOf(order), phone: safePhone, message, source: "whatsapp_payment_proof_chat_reply", result, customerName: text(order.customer_name) });
    console.info("[payment-proof] screenshot in chat answered", { orderId: order.id, state, phoneSuffix: safePhone.slice(-4) });
    return { handled: true, reason: state === "ready" ? "upload_link_sent" : "already_in_review", orderId: order.id };
  } catch (error) {
    // Never cost the customer the photo: fall through to the normal pipeline.
    console.warn("[payment-proof] screenshot-in-chat check failed", { message: error?.message || String(error) });
    return { handled: false, reason: "check_failed" };
  }
};

/**
 * Staff ask the customer for the shipping deposit from wherever they are — the AI Inbox, the order
 * page — instead of waiting for the order confirmation to carry the card. Same card, same upload
 * link, so an uploaded screenshot lands on the order and reaches payment review like any other.
 */
export const sendShippingFeePaymentRequest = async ({ orderId, tenantId = null } = {}) => {
  const found = await db.query(
    `SELECT * FROM orders WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL) LIMIT 1`,
    [orderId, tenantId]
  );
  const order = found.rows[0];
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "الطلب غير موجود.");
  const phone = text(order.customer_phone);
  if (!phone) throw httpError(409, "NO_CUSTOMER_PHONE", "الأوردر ده مفيهوش رقم تليفون نبعتله.");
  const { loadCodPolicySettings } = await import("../../services/storefrontShippingService.js");
  const advance = describeShippingFeeAdvance({ order, policy: await loadCodPolicySettings() });
  if (!advance.required) throw httpError(409, "PAYMENT_NOT_REQUIRED", "الأوردر ده مش محتاج تحويل مقدّم.");
  if (advance.status === "paid") throw httpError(409, "ALREADY_PAID", "رسوم الشحن للأوردر ده اتأكدت خلاص.");
  const card = await prepareShippingFeePaymentCard({ order, amount: advance.amount });
  if (!card) throw httpError(502, "CARD_UNAVAILABLE", "مش قادرين نجهّز كارت الدفع دلوقتي.");
  const queued = await queueShippingFeePaymentCard({
    order,
    card,
    phone,
    tenantId: Number(tenantId) || tenantOf(order),
    // Every manual ask is its own message: staff repeat it when the customer loses the first one.
    idempotencySuffix: `manual-${Date.now()}`,
  });
  console.info("[payment-proof] deposit requested by staff", { orderId: order.id, amount: advance.amount, queued: queued?.queued !== false });
  return { sent: queued?.queued !== false, amount: advance.amount, upload_url: card.uploadUrl, status: advance.status };
};
