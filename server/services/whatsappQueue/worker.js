import db from "../../database/db.js";
import { ensureWhatsappQueueSchema } from "./schema.js";
import { loadWhatsappQueueSettings, rulesForAutomation } from "./config.js";
import {
  claimReadyMessages,
  expireById,
  expireStaleMessages,
  failuresInWindow,
  logLifecycle,
  markFailed,
  markSent,
  queueCounts,
  queueRuntimeRow,
  recordConnectionState,
  releaseClaim,
  sentInLastMinutes,
  setQueueState,
} from "./queueService.js";
import { appendWhatsappOutboundSupportReply } from "../aiSupportLogService.js";
import { emitToRooms } from "../../utils/socket.js";

/*
 * The pacer.
 *
 * Everything about this file exists to make one thing impossible: a reconnect that empties the
 * backlog at line speed. Four independent brakes, any one of which stops a drain —
 *
 *   1. the connection gate      — nothing leaves while the session is not genuinely `open`
 *   2. the circuit breaker      — a long outage, a big backlog or a run of failures latches the
 *                                 queue at paused_for_review and waits for a human
 *   3. the rate limiter         — at most messages_per_minute leave in any rolling minute
 *   4. the inter-message delay  — a random gap between min_delay_seconds and max_delay_seconds
 *
 * And running before all four, on every tick including the offline ones: expiry. A receipt whose
 * moment has passed is dropped while the session is still down, so it is not even a candidate
 * when the session returns.
 */

const text = (value, fallback = "") => String(value ?? fallback).trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/*
 * Which order columns a queue item may stamp on delivery. An allowlist rather than trust in the
 * payload: the column name is interpolated into SQL, and a queue row is data.
 */
const SENT_AT_COLUMNS = new Set([
  "whatsapp_invoice_sent_at",
  "whatsapp_shipment_created_sent_at",
  "whatsapp_shipped_sent_at",
  "whatsapp_out_for_delivery_sent_at",
  "whatsapp_delivered_sent_at",
  "whatsapp_confirmation_sent_at",
  "whatsapp_payment_review_sent_at",
]);

const WORKER_ID = `wa-queue-${process.pid}`;

let draining = false;
let workerTimer = null;

export const extractWhatsAppMessageId = (result = {}) => text(
  result?.result?.message_id
  || result?.result?.messageId
  || result?.result?.key?.id
  || result?.message_id
  || result?.id
  || ""
);

/*
 * Perform the send. The queue stores WHAT to send declaratively so the worker never has to
 * import the automation services back — which would be a cycle, since they import the queue.
 */
export const performSend = async (row, gateway) => {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const send = payload.send && typeof payload.send === "object" ? payload.send : {};
  const kind = text(send.kind) || "text";
  const phone = text(row.recipient_phone);
  const body = text(row.rendered_body);
  const instance = text(row.instance);

  if (kind === "cta_url") {
    // The receipt's review button. A CTA cannot be mixed with reply buttons, so if it will not
    // render the receipt still goes as plain text — losing a review ask is nothing, losing the
    // customer's invoice is not. Same rule as the direct path it replaces.
    try {
      return await gateway.sendCtaUrlMessage({
        phone,
        title: text(send.title),
        text: body,
        footer: text(send.footer),
        displayText: text(send.displayText),
        url: text(send.url),
        fallbackText: text(send.fallbackText) || body,
      });
    } catch (ctaError) {
      logLifecycle("cta-unavailable", { id: row.id, automation_type: row.automation_type, error: ctaError?.message || String(ctaError) });
      return gateway.sendTextMessage({ phone, message: text(send.fallbackText) || body, instance });
    }
  }

  if (kind === "carousel") {
    return gateway.sendCartCarouselMessage({
      phone,
      body,
      cards: Array.isArray(send.cards) ? send.cards : [],
      fallbackText: text(send.fallbackText) || body,
    });
  }

  if (kind === "order_confirmation_buttons") {
    /*
     * The confirmation prompt carries ✅/✏️/❌ reply buttons, and Evolution tracks the sent message
     * so a button press can be tied back to this order. If the buttons will not render the order
     * still has to be confirmable, so the fallback is the same links text the direct path used —
     * losing the buttons costs a tap, losing the message costs the order.
     */
    try {
      return await gateway.sendOrderConfirmationInteractiveMessage({
        phone,
        title: text(send.title) || "تأكيد الطلب",
        text: body,
        footer: text(send.footer) || "M1 Store",
        orderId: row.order_id,
      });
    } catch (buttonsError) {
      logLifecycle("buttons-unavailable", {
        id: row.id,
        order_id: row.order_id,
        error: buttonsError?.message || String(buttonsError),
      });
      return gateway.sendTextMessage({ phone, message: text(send.fallbackText) || body, instance });
    }
  }

  return gateway.sendTextMessage({ phone, message: body, instance });
};

/*
 * The bookkeeping that used to sit inline after a direct send: stamp the order's once-only
 * column, write the outbound into the AI-inbox transcript, refresh the open inbox. Runs AFTER
 * the customer has the message, and a failure in it is never treated as a failed send.
 */
export const runOnSent = async (row, sendResult) => {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const onSent = payload.on_sent && typeof payload.on_sent === "object" ? payload.on_sent : null;
  if (!onSent) return;

  const column = text(onSent.order_column);
  if (column && row.order_id) {
    if (!SENT_AT_COLUMNS.has(column)) {
      console.warn("[wa-queue] refused unknown order column", { id: row.id, column });
    } else {
      await db.query(
        `UPDATE orders SET ${column} = COALESCE(${column}, NOW()), updated_at = NOW() WHERE id = $1`,
        [row.order_id]
      );
    }
  }

  /*
   * A carousel's inbox row is not a text bubble — it is a product-card message, and the cards were
   * resolved at enqueue (image variants and all) so the worker never has to rebuild them.
   */
  const cardTranscript = onSent.product_card_transcript && typeof onSent.product_card_transcript === "object"
    ? onSent.product_card_transcript
    : null;
  if (cardTranscript) {
    const cardTenantId = number(row.tenant_id, 0) || null;
    const cardSessionId = text(cardTranscript.session_id);
    const productCards = Array.isArray(cardTranscript.product_cards) ? cardTranscript.product_cards : [];
    if (cardTenantId && cardSessionId && productCards.length) {
      const { appendChannelOutboundSupportReply } = await import("../aiSupportLogService.js");
      const saved = await appendChannelOutboundSupportReply({
        tenantId: cardTenantId,
        sessionId: cardSessionId,
        channel: "whatsapp",
        senderType: "system",
        message: text(row.rendered_body),
        messageType: "product_card",
        productCards,
        deliveryStatus: "sent",
        clientRequestId: text(cardTranscript.client_request_id) || `wa_queue:${row.id}`,
        source: text(cardTranscript.source) || `whatsapp_${row.automation_type}`,
        sourcePath: text(cardTranscript.source_path) || `whatsapp_${row.automation_type}`,
        insertSource: text(cardTranscript.insert_source) || `whatsapp_${row.automation_type}`,
        whatsappInstance: sendResult?.instanceName || sendResult?.instance || "",
        remoteJid: cardSessionId,
        resolvedReplyJid: cardSessionId,
        resolvedPhone: text(cardTranscript.resolved_phone) || text(row.recipient_phone),
        // A marketing nudge must never touch the workflow: handing a human-run conversation back
        // to the AI, or overwriting the list preview, is not something the customer did.
        sessionStatus: "ai_active",
        preserveSessionState: true,
      });
      if (saved) {
        const tenantRoom = `tenant:${cardTenantId}`;
        emitToRooms([tenantRoom], "ai_inbox:message", {
          tenant_id: cardTenantId,
          session_id: cardSessionId,
          channel: "whatsapp",
          message: { ...saved, from_me: true, direction: "outbound" },
        });
        emitToRooms([tenantRoom], "ai_inbox:refresh", { tenant_id: cardTenantId, session_id: cardSessionId, at: new Date().toISOString() });
      }
    }
  }

  const transcript = onSent.transcript && typeof onSent.transcript === "object" ? onSent.transcript : null;
  if (!transcript) return;
  const tenantId = number(row.tenant_id, 0) || null;
  const sessionId = text(transcript.session_id) || `whatsapp:${text(row.recipient_phone)}`;
  /*
   * What the transcript shows must be what the customer received. A CTA send splits the message
   * across title/body/button, so the caller supplies the single-string version it wants logged —
   * but the moment a variant is in play that stored string is stale, and the variant body IS the
   * message. rendered_body wins whenever a variant was chosen.
   */
  const transcriptMessage = row.message_variant_id
    ? text(row.rendered_body)
    : (text(transcript.message) || text(row.rendered_body));
  const saved = await appendWhatsappOutboundSupportReply({
    tenantId,
    sessionId,
    message: transcriptMessage,
    messageType: "text",
    senderType: "system",
    source: text(transcript.source) || `whatsapp_${row.automation_type}`,
    channel: "whatsapp",
    deliveryStatus: "sent",
    deliveryError: "",
    externalMessageId: extractWhatsAppMessageId(sendResult),
    providerMessageId: extractWhatsAppMessageId(sendResult),
    whatsappInstance: sendResult?.instanceName || sendResult?.instance || "",
    remoteJid: sessionId,
    resolvedReplyJid: sessionId,
    resolvedPhone: text(row.recipient_phone),
    preserveExactMessage: true,
    upsertSession: true,
    sessionStatus: "ai_active",
    sessionSource: "whatsapp",
    sessionChannel: "whatsapp",
    sessionCustomerName: text(transcript.customer_name),
    sourcePath: text(transcript.source_path) || text(transcript.source) || `whatsapp_${row.automation_type}`,
    insertSource: text(transcript.insert_source) || text(transcript.source) || `whatsapp_${row.automation_type}`,
    confidence: 1,
    detectedIntent: text(transcript.detected_intent) || text(transcript.source) || `whatsapp_${row.automation_type}`,
  });
  if (saved && tenantId) {
    const tenantRoom = `tenant:${tenantId}`;
    emitToRooms([tenantRoom], "ai_inbox:message", { tenant_id: tenantId, session_id: sessionId, message: saved, at: new Date().toISOString() });
    emitToRooms([tenantRoom], "ai_inbox:refresh", { tenant_id: tenantId, session_id: sessionId, at: new Date().toISOString() });
  }
};

/*
 * Should the queue be latched shut? Pure so it can be tested without a database or a gateway.
 *
 * Returns a reason string, or "" to keep draining. The order matters: the longest-lived signal
 * is checked first so the admin alert names the root cause, not the symptom.
 */
export const evaluateCircuitBreaker = ({
  config = {},
  outageMinutes = 0,
  justReconnected = false,
  pendingCount = 0,
  recentFailures = 0,
} = {}) => {
  const offlineLimit = number(config.offline_pause_minutes, 0);
  /*
   * A long outage only latches the queue when there is actually a backlog behind it.
   *
   * The point of paused_for_review is to put a decision in front of a human: hundreds of stale
   * messages are about to go out — do you want them to? With nothing waiting there is no decision,
   * and pausing does no good at all. It cost four invoices on 3 September: the session came back at
   * 00:42 after 54 hours down, the queue was empty because everything old had already been expired
   * or cancelled, and the breaker latched anyway. Four orders arrived overnight, were queued behind
   * a pause nobody knew about, and expired unsent.
   */
  if (offlineLimit > 0 && justReconnected && outageMinutes >= offlineLimit && pendingCount > 0) return "long_offline";
  const pendingLimit = number(config.pending_pause_threshold, 0);
  if (pendingLimit > 0 && pendingCount > pendingLimit) return "backlog_threshold";
  const failureLimit = number(config.failure_pause_threshold, 0);
  if (failureLimit > 0 && recentFailures >= failureLimit) return "failure_threshold";
  return "";
};

const raiseAdminAlert = async ({ tenantId, reason, details }) => {
  try {
    const { createSystemNotification } = await import("../notificationsService.js");
    const pending = number(details?.pending, 0);
    await createSystemNotification("whatsapp_queue_paused", {
      tenant_id: number(tenantId, 0) || null,
      title: "طابور واتساب متوقف للمراجعة",
      message: `تم إيقاف طابور رسائل واتساب تلقائياً (${reason}). يوجد ${pending} رسالة في الانتظار تحتاج مراجعة قبل الإرسال.`,
      action_url: "/ai-support/integrations",
      priority: "critical",
      category: "ai",
    });
  } catch (error) {
    // The alert is how a human finds out, but failing to raise it must not un-pause the queue.
    console.warn("[wa-queue] admin alert failed", { reason, message: error?.message || String(error) });
  }
};

/*
 * Say out loud that the channel is dead.
 *
 * The circuit breaker cannot do this job: it judges an outage at the moment of RECONNECT, and an
 * outage nobody recovers from never reaches that moment. Nor can the backlog threshold, because
 * expiry drains the queue as fast as an outage fills it — in September the session was down for
 * three days, the pending count never passed sixteen, and not one alert fired. The shop found out
 * because a person noticed the invoices had stopped arriving.
 *
 * So this watches the clock instead of the queue, and fires once per outage: `offline_alerted_at`
 * is the latch, cleared when the session comes back so the next outage is announced too.
 *
 * Returns true only when it actually raised one.
 */
export const alertIfOfflineTooLong = async ({
  tenantId = 0,
  runtime = null,
  thresholdMinutes = 0,
  connectionState = "",
  pendingCount = 0,
} = {}) => {
  const threshold = number(thresholdMinutes, 0);
  if (threshold <= 0) return false;
  if (runtime?.offline_alerted_at) return false;

  const downSince = runtime?.last_disconnected_at ? new Date(runtime.last_disconnected_at).getTime() : 0;
  // No recorded drop yet — this tick is the first observation, and one tick is not an outage.
  if (!downSince) return false;
  const offlineMinutes = (Date.now() - downSince) / 60000;
  if (offlineMinutes < threshold) return false;

  const hours = Math.floor(offlineMinutes / 60);
  const minutes = Math.round(offlineMinutes % 60);
  const howLong = hours > 0 ? `${hours} ساعة و${minutes} دقيقة` : `${minutes} دقيقة`;

  try {
    const { createSystemNotification } = await import("../notificationsService.js");
    await createSystemNotification("whatsapp_gateway_offline", {
      tenant_id: number(tenantId, 0) || null,
      title: "واتساب مفصول",
      message: `جلسة واتساب مقفولة من ${howLong}. مفيش أي رسالة بتخرج — لا فواتير ولا تأكيد طلبات. تحتاج إعادة ربط بمسح QR من مركز التكاملات.`,
      action_url: "/ai-support/integrations?integrations=queue",
      priority: "critical",
      category: "ai",
    });
  } catch (error) {
    // Failing to raise the alert must not stop us latching it — otherwise a broken notifications
    // table would make every tick retry forever.
    console.warn("[wa-queue] offline alert could not be raised", { message: error?.message || String(error) });
  }

  await db.query(
    `UPDATE whatsapp_queue_runtime SET offline_alerted_at = NOW(), updated_at = NOW() WHERE tenant_id = $1`,
    [number(tenantId, 0)]
  );
  console.warn("[wa-queue] gateway offline past the alert threshold", {
    tenant_id: number(tenantId, 0),
    offline_minutes: Math.round(offlineMinutes),
    threshold_minutes: threshold,
    connection_state: connectionState,
    pending: pendingCount,
  });
  logLifecycle("gateway-offline-alert", { offline_minutes: Math.round(offlineMinutes), pending: pendingCount });
  return true;
};

export const clearOfflineAlert = async (tenantId = 0) => {
  await db.query(
    `UPDATE whatsapp_queue_runtime SET offline_alerted_at = NULL, updated_at = NOW() WHERE tenant_id = $1`,
    [number(tenantId, 0)]
  );
  logLifecycle("gateway-offline-alert-cleared", { tenant_id: number(tenantId, 0) });
};

export const pauseForReview = async ({ tenantId = 0, reason = "", details = {} } = {}) => {
  const runtime = await queueRuntimeRow(tenantId);
  if (text(runtime?.state) === "paused_for_review") return runtime;
  const row = await setQueueState({ tenantId, state: "paused_for_review", reason, details });
  console.warn("[wa-queue] paused_for_review", { tenant_id: number(tenantId, 0), reason, ...details });
  await raiseAdminAlert({ tenantId, reason, details });
  return row;
};

/*
 * One tick. Called on an interval; never overlaps itself.
 */
export const runWhatsappQueueTick = async ({ tenantId = 0, gateway = null } = {}) => {
  if (draining) return { skipped: true, reason: "already_draining" };
  const settings = await loadWhatsappQueueSettings();
  if (!settings.queue.enabled) return { skipped: true, reason: "queue_disabled" };

  draining = true;
  try {
    await ensureWhatsappQueueSchema();
    const resolvedGateway = gateway || await import("../whatsappGatewayService.js");

    // Expiry runs FIRST and unconditionally. A stale receipt should die while the session is
    // still down, not survive to become a candidate the moment it comes back.
    const expired = await expireStaleMessages({ tenantId: null });

    let connected = false;
    let connectionState = "unknown";
    try {
      const status = await resolvedGateway.getStatus();
      connected = status?.connected === true;
      connectionState = text(status?.state) || (connected ? "open" : "closed");
    } catch (error) {
      connectionState = "unreachable";
      logLifecycle("gateway-status-failed", { error: error?.message || String(error) });
    }

    const before = await queueRuntimeRow(tenantId);
    const previousDisconnectedAt = before?.last_disconnected_at || null;
    const { changed } = await recordConnectionState({ tenantId, connected, state: connectionState });
    const justReconnected = changed && connected;

    const counts = await queueCounts(null);
    const pendingCount = counts.pending + counts.scheduled;

    const runtime = await queueRuntimeRow(tenantId);
    if (text(runtime?.state) !== "running") {
      return { skipped: true, reason: runtime.state, expired: expired.expired, pending: pendingCount, connected };
    }

    if (!connected) {
      const alerted = await alertIfOfflineTooLong({
        tenantId,
        runtime,
        thresholdMinutes: settings.queue.offline_alert_minutes,
        connectionState,
        pendingCount,
      });
      return {
        skipped: true,
        reason: "gateway_offline",
        expired: expired.expired,
        pending: pendingCount,
        connected: false,
        state: connectionState,
        ...(alerted ? { offline_alert_raised: true } : {}),
      };
    }

    // Back up: re-arm the alarm so the NEXT outage is announced too.
    if (runtime?.offline_alerted_at) await clearOfflineAlert(tenantId);

    const outageMinutes = previousDisconnectedAt
      ? Math.max(0, (Date.now() - new Date(previousDisconnectedAt).getTime()) / 60000)
      : 0;
    const recentFailures = await failuresInWindow({ tenantId: null, minutes: settings.queue.failure_window_minutes });
    const breaker = evaluateCircuitBreaker({
      config: settings.queue,
      outageMinutes,
      justReconnected,
      pendingCount,
      recentFailures,
    });
    if (breaker) {
      await pauseForReview({
        tenantId,
        reason: breaker,
        details: {
          pending: pendingCount,
          outage_minutes: Math.round(outageMinutes),
          recent_failures: recentFailures,
          threshold: settings.queue.pending_pause_threshold,
        },
      });
      return { skipped: true, reason: breaker, paused: true, expired: expired.expired, pending: pendingCount };
    }

    // The rolling-minute allowance. Counting what actually left in the last 60 seconds — rather
    // than trusting the tick interval — keeps the rate honest across restarts and slow ticks.
    const sentLastMinute = await sentInLastMinutes({ tenantId: null, minutes: 1 });
    const allowance = Math.max(0, settings.queue.messages_per_minute - sentLastMinute);
    if (allowance <= 0) {
      return { skipped: true, reason: "rate_limited", sent_last_minute: sentLastMinute, expired: expired.expired, pending: pendingCount };
    }

    const batch = Math.min(settings.queue.batch_size, allowance);
    const rows = await claimReadyMessages({
      limit: batch,
      workerId: WORKER_ID,
      claimTimeoutMinutes: settings.queue.claim_timeout_minutes,
      tenantId: null,
    });
    if (!rows.length) {
      return { drained: 0, expired: expired.expired, pending: pendingCount, connected: true };
    }

    const results = { sent: 0, failed: 0, expired: expired.expired, skipped: 0 };
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rules = rulesForAutomation(row.automation_type, settings);

      // Re-check expiry against the row we actually hold: it may have gone stale between the
      // sweep at the top of this tick and the claim, and an expired message must never send.
      if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
        await expireById(row.id);
        results.skipped += 1;
        continue;
      }

      // The queue can be latched shut mid-batch by an admin. Put the row back untouched —
      // releasing is not a failed attempt and must not burn a retry.
      const live = await queueRuntimeRow(tenantId);
      if (text(live?.state) !== "running") {
        await releaseClaim(row.id, { status: "pending" });
        results.skipped += 1;
        continue;
      }

      try {
        const sendResult = await performSend(row, resolvedGateway);
        await markSent(row.id, { providerMessageId: extractWhatsAppMessageId(sendResult) });
        results.sent += 1;
        try {
          await runOnSent(row, sendResult);
        } catch (bookkeepingError) {
          console.warn("[wa-queue] post-send bookkeeping failed", { id: row.id, message: bookkeepingError?.message || String(bookkeepingError) });
        }
      } catch (error) {
        await markFailed(row.id, error, { maxRetries: rules.max_retries, backoffSeconds: rules.retry_backoff_seconds });
        results.failed += 1;
      }

      // The gap between messages. Skipped after the last one — the tick interval is the gap
      // to the next batch, and holding the worker open past its work buys nothing.
      if (index < rows.length - 1) {
        const min = settings.queue.min_delay_seconds * 1000;
        const max = settings.queue.max_delay_seconds * 1000;
        await sleep(min + Math.random() * Math.max(0, max - min));
      }
    }

    await db.query(`UPDATE whatsapp_queue_runtime SET last_drain_at = NOW(), updated_at = NOW() WHERE tenant_id = $1`, [number(tenantId, 0)]);
    logLifecycle("drain", { ...results, batch: rows.length, pending_before: pendingCount });
    return { ...results, drained: rows.length };
  } finally {
    draining = false;
  }
};

const WORKER_INTERVAL_MS = Math.max(5_000, Number(process.env.WHATSAPP_QUEUE_TICK_MS || 15_000));

export const startWhatsappQueueWorker = ({ tenantId = 0 } = {}) => {
  if (workerTimer) return workerTimer;
  const tick = () => {
    void runWhatsappQueueTick({ tenantId }).catch((error) => {
      console.error("[wa-queue] tick error", { message: error?.message || String(error) });
    });
  };
  workerTimer = setInterval(tick, WORKER_INTERVAL_MS);
  workerTimer.unref?.();
  tick();
  console.log("[wa-queue] worker started", { intervalMs: WORKER_INTERVAL_MS });
  return workerTimer;
};

export const stopWhatsappQueueWorker = () => {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
};
