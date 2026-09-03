import db from "../../database/db.js";
import { ensureWhatsappQueueSchema } from "./schema.js";
import { loadWhatsappQueueSettings, rulesForAutomation } from "./config.js";
import { resolveMessageBody } from "./variants.js";
import { whatsappAutomationCategory } from "../../../shared/whatsappQueueDefaults.js";

/*
 * The queue itself: how a message gets in, how exactly one worker gets it out, and every state
 * transition in between.
 *
 * The lifecycle, logged at every hop under [wa-queue]:
 *   created → queued → sending → sent
 *   created → queued → expired                (sat past its expiry while the session was down)
 *   created → queued → sending → failed → retrying → sent
 *   created → queued → cancelled              (an admin emptied the backlog)
 */

const text = (value, fallback = "") => String(value ?? fallback).trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/*
 * Errors carry secrets often enough that storing them raw is not worth the risk.
 *
 * Code AND message: the code alone ("EVOLUTION_API_ERROR") tells the operator nothing about why,
 * and "why" is the entire value of last_error on a dashboard row.
 */
const safeError = (error) => {
  const code = text(error?.code);
  const message = text(error?.message);
  return [code, message].filter(Boolean).join(": ")
    .replace(/[\r\n]+/g, " ")
    .replace(/(apikey|token|secret|authorization|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 1000) || "WhatsApp send failed";
};

export const logLifecycle = (event, fields = {}) => {
  console.info(`[wa-queue] ${event}`, fields);
};

/*
 * The idempotency key. Same event + same customer + same automation = one message, forever.
 *
 * `invoice:412:invoice_receipt:customer:88` is the whole guard against the duplicate the retry
 * path used to create: a retry updates its row, it never inserts a second one.
 */
export const buildIdempotencyKey = ({
  automationType = "",
  orderId = null,
  invoiceNumber = "",
  customerId = null,
  recipientPhone = "",
  suffix = "",
} = {}) => {
  const subject = orderId
    ? `order:${orderId}`
    : invoiceNumber
      ? `invoice:${text(invoiceNumber)}`
      : `phone:${text(recipientPhone)}`;
  const audience = customerId ? `customer:${customerId}` : `phone:${text(recipientPhone)}`;
  return [subject, text(automationType), audience, text(suffix)].filter(Boolean).join(":").slice(0, 200);
};

export const queueRuntimeRow = async (tenantId = 0) => {
  await ensureWhatsappQueueSchema();
  const safeTenantId = number(tenantId, 0);
  const result = await db.query(
    `
    INSERT INTO whatsapp_queue_runtime (tenant_id) VALUES ($1)
    ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
    RETURNING *
    `,
    [safeTenantId]
  );
  return result.rows[0];
};

export const setQueueState = async ({ tenantId = 0, state = "running", reason = "", details = {} } = {}) => {
  await queueRuntimeRow(tenantId);
  const isPaused = state !== "running";
  const result = await db.query(
    `
    UPDATE whatsapp_queue_runtime
    SET state = $2,
        pause_reason = $3,
        pause_details = $4::jsonb,
        paused_at = CASE WHEN $5::boolean THEN COALESCE(paused_at, NOW()) ELSE paused_at END,
        resumed_at = CASE WHEN $5::boolean THEN resumed_at ELSE NOW() END,
        updated_at = NOW()
    WHERE tenant_id = $1
    RETURNING *
    `,
    [number(tenantId, 0), state, reason || null, JSON.stringify(details || {}), isPaused]
  );
  logLifecycle(isPaused ? "paused" : "resumed", { tenant_id: number(tenantId, 0), state, reason: reason || "" });
  return result.rows[0];
};

export const recordConnectionState = async ({ tenantId = 0, connected = false, state = "" } = {}) => {
  const current = await queueRuntimeRow(tenantId);
  const wasConnected = text(current?.connection_state).toLowerCase() === "connected";
  // Only the EDGES move the timestamps. Stamping last_disconnected_at on every poll of a
  // still-dead session would reset the outage clock each tick and the offline breaker
  // would never see an outage longer than one tick.
  const changed = wasConnected !== connected || !current?.connection_state;
  const result = await db.query(
    `
    UPDATE whatsapp_queue_runtime
    SET connection_state = $2,
        last_connected_at = CASE WHEN $3::boolean AND $4::boolean THEN NOW() ELSE last_connected_at END,
        last_disconnected_at = CASE WHEN $3::boolean AND NOT $4::boolean THEN NOW() ELSE last_disconnected_at END,
        updated_at = NOW()
    WHERE tenant_id = $1
    RETURNING *
    `,
    [number(tenantId, 0), connected ? "connected" : (text(state) || "disconnected"), changed, connected]
  );
  if (changed) {
    logLifecycle(connected ? "gateway-reconnected" : "gateway-disconnected", {
      tenant_id: number(tenantId, 0),
      state: text(state) || (connected ? "open" : "closed"),
      previous: text(current?.connection_state) || "unknown",
    });
  }
  return { row: result.rows[0], changed, wasConnected };
};

/*
 * Put one automated message in the queue.
 *
 * Returns { queued, duplicate, id, status }. `duplicate: true` means the idempotency key was
 * already taken — the event has a message already and this call is a no-op, not a failure.
 */
export const enqueueWhatsappMessage = async ({
  tenantId = 0,
  automationType = "",
  customerId = null,
  orderId = null,
  invoiceNumber = "",
  recipientPhone = "",
  instance = "",
  send = {},
  values = {},
  fallbackBody = "",
  onSent = null,
  idempotencySuffix = "",
  scheduledAt = null,
  settings = null,
} = {}) => {
  await ensureWhatsappQueueSchema();
  const type = text(automationType);
  const phone = text(recipientPhone);
  if (!type) throw new Error("WHATSAPP_QUEUE_AUTOMATION_TYPE_REQUIRED");
  if (!phone) throw new Error("WHATSAPP_QUEUE_RECIPIENT_REQUIRED");

  const resolved = settings || await loadWhatsappQueueSettings();
  const rules = rulesForAutomation(type, resolved);
  const category = whatsappAutomationCategory(type);

  const { variantId, title: variantTitle, body: variantBody } = await resolveMessageBody({
    tenantId,
    automationType: type,
    variants: resolved.variants,
    values,
    fallbackBody,
  });
  const kind = text(send?.kind) || "text";
  const sendPayload = { ...send, kind };
  let body = variantBody;
  if (variantId) {
    /*
     * A variant is the whole message, header included. On a button message the title is the
     * bold header, so the variant's greeting replaces the one the automation passed; on a plain
     * text there is no header and the greeting opens the body. And the plain-text fallback — what
     * the customer gets when the button will not render — must say what the variant says, not
     * what the automation would have said without one.
     */
    if (text(variantTitle)) {
      if (kind === "text") body = `${text(variantTitle)}\n\n${body}`;
      else sendPayload.title = text(variantTitle);
    }
    sendPayload.fallbackText = kind === "text"
      ? body
      : [text(sendPayload.title), body].filter(Boolean).join("\n\n");
  }
  if (!text(body)) throw new Error("WHATSAPP_QUEUE_EMPTY_BODY");

  const idempotencyKey = buildIdempotencyKey({
    automationType: type,
    orderId,
    invoiceNumber,
    customerId,
    recipientPhone: phone,
    suffix: idempotencySuffix,
  });

  const payload = {
    send: sendPayload,
    on_sent: onSent || null,
    values: values || {},
  };

  const result = await db.query(
    `
    INSERT INTO whatsapp_message_queue (
      tenant_id, automation_type, category, customer_id, order_id, invoice_number,
      recipient_phone, instance, message_variant_id, rendered_body, payload,
      status, idempotency_key, scheduled_at, expires_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11::jsonb,
      -- timestamptz, not timestamp: the parameter arrives as an ISO string with a Z, and a
      -- ::timestamp cast would silently discard that offset and re-read the instant in the
      -- session's timezone — shifting every deadline by the host's UTC offset.
      'pending', $12, COALESCE($13::timestamptz, NOW()),
      COALESCE($13::timestamptz, NOW()) + make_interval(mins => $14::int)
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, status, expires_at, scheduled_at
    `,
    [
      number(tenantId, 0) || null,
      type,
      category,
      customerId ? number(customerId, 0) || null : null,
      orderId ? number(orderId, 0) || null : null,
      text(invoiceNumber) || null,
      phone,
      text(instance) || null,
      variantId,
      body,
      JSON.stringify(payload),
      idempotencyKey,
      scheduledAt ? new Date(scheduledAt).toISOString() : null,
      Math.max(1, Math.round(rules.expiry_minutes)),
    ]
  );

  if (!result.rows.length) {
    logLifecycle("duplicate-skipped", { automation_type: type, idempotency_key: idempotencyKey, order_id: orderId || null });
    return { queued: false, duplicate: true, idempotencyKey };
  }

  const row = result.rows[0];
  logLifecycle("created", {
    id: row.id,
    automation_type: type,
    category,
    order_id: orderId || null,
    customer_id: customerId || null,
    variant: variantId || "default",
    idempotency_key: idempotencyKey,
    expires_at: row.expires_at,
  });
  logLifecycle("queued", { id: row.id, automation_type: type, scheduled_at: row.scheduled_at });
  return { queued: true, duplicate: false, id: row.id, status: row.status, idempotencyKey, variantId, expiresAt: row.expires_at };
};

/*
 * Expire everything that sat too long.
 *
 * This is the rule that would have stopped the incident on its own: a receipt or a review ask
 * whose moment has passed is dropped, not delivered a day late in a burst.
 */
export const expireStaleMessages = async ({ tenantId = null, automationTypes = null } = {}) => {
  await ensureWhatsappQueueSchema();
  const result = await db.query(
    `
    UPDATE whatsapp_message_queue
    SET status = 'expired', expired_at = NOW(), locked_at = NULL, locked_by = NULL, updated_at = NOW()
    WHERE status IN ('pending','scheduled')
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND ($2::text[] IS NULL OR automation_type = ANY($2::text[]))
    RETURNING id, automation_type, order_id, created_at
    `,
    [tenantId === null ? null : number(tenantId, 0), automationTypes && automationTypes.length ? automationTypes : null]
  );
  for (const row of result.rows) {
    logLifecycle("expired", { id: row.id, automation_type: row.automation_type, order_id: row.order_id, created_at: row.created_at });
  }
  return { expired: result.rows.length, rows: result.rows };
};

/*
 * Claim work for exactly one worker.
 *
 * FOR UPDATE SKIP LOCKED plus the status transition in the same statement: a row leaves
 * 'pending' and enters 'sending' atomically, so two workers cannot both take it. The
 * `sending` branch reclaims rows whose worker died mid-send and left the lock behind.
 */
export const claimReadyMessages = async ({ limit = 5, workerId = "worker", claimTimeoutMinutes = 10, tenantId = null } = {}) => {
  await ensureWhatsappQueueSchema();
  const result = await db.query(
    `
    WITH ready AS (
      SELECT id FROM whatsapp_message_queue
      WHERE (
              (status IN ('pending','scheduled')
                AND scheduled_at <= NOW()
                AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
              OR (status = 'sending' AND locked_at IS NOT NULL AND locked_at < NOW() - make_interval(mins => $3::int))
            )
        AND (expires_at IS NULL OR expires_at > NOW())
        AND ($4::bigint IS NULL OR tenant_id = $4::bigint)
      ORDER BY scheduled_at ASC, id ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE whatsapp_message_queue q
    SET status = 'sending', locked_at = NOW(), locked_by = $2, updated_at = NOW()
    FROM ready
    WHERE q.id = ready.id
    RETURNING q.*
    `,
    [Math.max(1, Math.round(number(limit, 5))), text(workerId) || "worker", Math.max(1, Math.round(number(claimTimeoutMinutes, 10))), tenantId === null ? null : number(tenantId, 0)]
  );
  for (const row of result.rows) {
    logLifecycle("sending", { id: row.id, automation_type: row.automation_type, attempt: Number(row.retry_count || 0) + 1, worker: text(workerId) });
  }
  return result.rows;
};

export const markSent = async (id, { providerMessageId = "" } = {}) => {
  const result = await db.query(
    `
    UPDATE whatsapp_message_queue
    SET status = 'sent', sent_at = NOW(), locked_at = NULL, locked_by = NULL,
        last_error = NULL, error_code = NULL, provider_message_id = $2, updated_at = NOW()
    WHERE id = $1 AND status = 'sending'
    RETURNING *
    `,
    [id, text(providerMessageId) || null]
  );
  if (result.rows[0]) {
    logLifecycle("sent", {
      id,
      automation_type: result.rows[0].automation_type,
      order_id: result.rows[0].order_id,
      variant: result.rows[0].message_variant_id || "default",
      attempts: Number(result.rows[0].retry_count || 0) + 1,
    });
  }
  return result.rows[0] || null;
};

/*
 * A failure never creates a new message. It updates THIS row: retry_count, last_error,
 * next_retry_at. Same id, same variant, same rendered body, same idempotency key.
 */
export const markFailed = async (id, error, { maxRetries = 1, backoffSeconds = 120 } = {}) => {
  const message = safeError(error);
  const code = text(error?.code).slice(0, 80) || null;
  const result = await db.query(
    `
    UPDATE whatsapp_message_queue
    SET retry_count = retry_count + 1,
        last_retry_at = NOW(),
        last_error = $2,
        error_code = $3,
        locked_at = NULL,
        locked_by = NULL,
        status = CASE WHEN retry_count + 1 > $4::int THEN 'failed' ELSE 'pending' END,
        failed_at = CASE WHEN retry_count + 1 > $4::int THEN NOW() ELSE NULL END,
        next_retry_at = CASE
          WHEN retry_count + 1 > $4::int THEN NULL
          -- Exponential, capped: attempt 1 waits the base, attempt 2 double, and so on.
          ELSE NOW() + make_interval(secs => LEAST($5::int * POWER(2, retry_count)::int, 86400))
        END,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id, message, code, Math.max(0, Math.round(number(maxRetries, 1))), Math.max(5, Math.round(number(backoffSeconds, 120)))]
  );
  const row = result.rows[0];
  if (row) {
    logLifecycle(row.status === "failed" ? "failed" : "retrying", {
      id,
      automation_type: row.automation_type,
      order_id: row.order_id,
      retry_count: row.retry_count,
      max_retries: Math.max(0, Math.round(number(maxRetries, 1))),
      next_retry_at: row.next_retry_at,
      error: message,
    });
  }
  return row || null;
};

/* Release a claim without counting it as an attempt (the queue paused mid-batch, say). */
export const releaseClaim = async (id, { status = "pending" } = {}) => {
  const result = await db.query(
    `
    UPDATE whatsapp_message_queue
    SET status = $2, locked_at = NULL, locked_by = NULL, updated_at = NOW()
    WHERE id = $1 AND status = 'sending'
    RETURNING *
    `,
    [id, status]
  );
  return result.rows[0] || null;
};

export const expireById = async (id) => {
  const result = await db.query(
    `
    UPDATE whatsapp_message_queue
    SET status = 'expired', expired_at = NOW(), locked_at = NULL, locked_by = NULL, updated_at = NOW()
    WHERE id = $1 AND status NOT IN ('sent','cancelled')
    RETURNING *
    `,
    [id]
  );
  if (result.rows[0]) logLifecycle("expired", { id, automation_type: result.rows[0].automation_type });
  return result.rows[0] || null;
};

export const cancelPending = async ({ tenantId = null, automationType = "", ids = null } = {}) => {
  await ensureWhatsappQueueSchema();
  const result = await db.query(
    `
    UPDATE whatsapp_message_queue
    SET status = 'cancelled', cancelled_at = NOW(), locked_at = NULL, locked_by = NULL, updated_at = NOW()
    WHERE status IN ('pending','scheduled')
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND ($2::text IS NULL OR automation_type = $2::text)
      AND ($3::bigint[] IS NULL OR id = ANY($3::bigint[]))
    RETURNING id, automation_type
    `,
    [tenantId === null ? null : number(tenantId, 0), text(automationType) || null, ids && ids.length ? ids : null]
  );
  for (const row of result.rows) logLifecycle("cancelled", { id: row.id, automation_type: row.automation_type });
  return { cancelled: result.rows.length };
};

/*
 * Re-arm failures for another attempt. Deliberately NOT a re-enqueue: the same rows go back to
 * pending, keeping their id, their variant and their rendered body. An expired row is not
 * revived — it was dropped for a reason.
 */
export const retryFailed = async ({ tenantId = null, ids = null } = {}) => {
  await ensureWhatsappQueueSchema();
  const result = await db.query(
    `
    UPDATE whatsapp_message_queue
    SET status = 'pending', next_retry_at = NOW(), failed_at = NULL,
        locked_at = NULL, locked_by = NULL, updated_at = NOW()
    WHERE status = 'failed'
      AND (expires_at IS NULL OR expires_at > NOW())
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))
    RETURNING id, automation_type, retry_count, message_variant_id
    `,
    [tenantId === null ? null : number(tenantId, 0), ids && ids.length ? ids : null]
  );
  for (const row of result.rows) {
    logLifecycle("retrying", { id: row.id, automation_type: row.automation_type, retry_count: row.retry_count, variant: row.message_variant_id || "default", source: "admin" });
  }
  return { retried: result.rows.length };
};

export const queueCounts = async (tenantId = null) => {
  await ensureWhatsappQueueSchema();
  const result = await db.query(
    `
    SELECT status, COUNT(*)::int AS count
    FROM whatsapp_message_queue
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
    GROUP BY status
    `,
    [tenantId === null ? null : number(tenantId, 0)]
  );
  const counts = { pending: 0, scheduled: 0, sending: 0, sent: 0, failed: 0, expired: 0, cancelled: 0 };
  for (const row of result.rows) counts[row.status] = Number(row.count || 0);
  return counts;
};

export const sentInLastMinutes = async ({ tenantId = null, minutes = 1 } = {}) => {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM whatsapp_message_queue
    WHERE status = 'sent'
      AND sent_at >= NOW() - make_interval(mins => $2::int)
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
    `,
    [tenantId === null ? null : number(tenantId, 0), Math.max(1, Math.round(number(minutes, 1)))]
  );
  return Number(result.rows[0]?.count || 0);
};

export const failuresInWindow = async ({ tenantId = null, minutes = 15 } = {}) => {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM whatsapp_message_queue
    WHERE last_retry_at >= NOW() - make_interval(mins => $2::int)
      AND status IN ('failed','pending')
      AND retry_count > 0
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
    `,
    [tenantId === null ? null : number(tenantId, 0), Math.max(1, Math.round(number(minutes, 15)))]
  );
  return Number(result.rows[0]?.count || 0);
};

export const oldestPending = async (tenantId = null) => {
  const result = await db.query(
    `
    SELECT id, automation_type, created_at, expires_at, order_id
    FROM whatsapp_message_queue
    WHERE status IN ('pending','scheduled')
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
    ORDER BY created_at ASC
    LIMIT 1
    `,
    [tenantId === null ? null : number(tenantId, 0)]
  );
  return result.rows[0] || null;
};

/*
 * The summary an admin sees BEFORE resuming after a long outage:
 * "There are 347 pending messages, 290 of them are older than the configured expiry period."
 */
export const resumePreview = async (tenantId = null) => {
  await ensureWhatsappQueueSchema();
  const result = await db.query(
    `
    SELECT
      COUNT(*)::int AS pending,
      COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW())::int AS stale,
      COUNT(*) FILTER (WHERE category = 'transactional')::int AS transactional,
      COUNT(*) FILTER (WHERE category = 'engagement')::int AS engagement
    FROM whatsapp_message_queue
    WHERE status IN ('pending','scheduled')
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
    `,
    [tenantId === null ? null : number(tenantId, 0)]
  );
  const byType = await db.query(
    `
    SELECT automation_type,
           COUNT(*)::int AS pending,
           COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW())::int AS stale
    FROM whatsapp_message_queue
    WHERE status IN ('pending','scheduled')
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
    GROUP BY automation_type
    ORDER BY pending DESC
    `,
    [tenantId === null ? null : number(tenantId, 0)]
  );
  const summary = result.rows[0] || { pending: 0, stale: 0, transactional: 0, engagement: 0 };
  return {
    pending: Number(summary.pending || 0),
    stale: Number(summary.stale || 0),
    transactional: Number(summary.transactional || 0),
    engagement: Number(summary.engagement || 0),
    by_type: byType.rows.map((row) => ({
      automation_type: row.automation_type,
      pending: Number(row.pending || 0),
      stale: Number(row.stale || 0),
    })),
    message: `There are ${Number(summary.pending || 0)} pending messages, ${Number(summary.stale || 0)} of them are older than the configured expiry period.`,
    message_ar: `يوجد ${Number(summary.pending || 0)} رسالة في الانتظار، منها ${Number(summary.stale || 0)} تجاوزت مدة الصلاحية المحددة.`,
  };
};

export const listQueueItems = async ({ tenantId = null, status = "", automationType = "", limit = 50 } = {}) => {
  await ensureWhatsappQueueSchema();
  const result = await db.query(
    `
    SELECT id, tenant_id, automation_type, category, customer_id, order_id, invoice_number,
           recipient_phone, message_variant_id, status, idempotency_key, retry_count,
           last_retry_at, next_retry_at, last_error, error_code,
           created_at, scheduled_at, expires_at, sent_at, expired_at, cancelled_at, failed_at,
           LEFT(COALESCE(rendered_body, ''), 240) AS body_preview
    FROM whatsapp_message_queue
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND ($2::text IS NULL OR status = $2::text)
      AND ($3::text IS NULL OR automation_type = $3::text)
    ORDER BY created_at DESC
    LIMIT $4
    `,
    [
      tenantId === null ? null : number(tenantId, 0),
      text(status) || null,
      text(automationType) || null,
      Math.min(500, Math.max(1, Math.round(number(limit, 50)))),
    ]
  );
  return result.rows;
};
