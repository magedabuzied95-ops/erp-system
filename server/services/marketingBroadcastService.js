// Broadcasts: one message, many customers, through the machinery that already exists.
//
// Nothing here sends. It builds an audience, records a campaign, and hands each recipient to
// `queueWhatsappAutomation` — the same queue that carries order confirmations, with its four brakes
// (connection gate, circuit breaker, rolling-minute rate limit, randomized inter-message delay).
// Re-implementing any of that for marketing would be the fastest way to get the number restricted.
//
// Four rules are enforced here and cannot be switched off from the UI:
//   1. opted-out customers are excluded, always (marketingConsentService);
//   2. quiet hours — nothing leaves between 22:00 and 09:00 Cairo, it waits for the morning;
//   3. a per-customer frequency cap — at most one marketing message every N days;
//   4. the whole feature is behind a flag that ships OFF.
//
// The audience query deliberately does NOT reuse analyticsCustomersService. That service segments
// customers well, but it is hard-blocked from ever selecting `customers.phone` at any permission
// level, and a broadcast needs the phone. Its segment thresholds are mirrored here instead.

import db from "../database/db.js";
import { queueWhatsappAutomation } from "./whatsappQueue/index.js";
import { ensureMarketingConsentSchema } from "./marketingConsentService.js";

const text = (value) => String(value ?? "").trim();
const int = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Ships OFF. The owner turns it on when they have decided what the first campaign says.
export const broadcastsEnabled = () =>
  String(process.env.MARKETING_BROADCASTS_ENABLED || "").trim().toLowerCase() === "true";

export const BROADCAST_AUTOMATION_TYPE = "marketing_broadcast";

// Cairo, because the shop and its customers are. A message at 3am reads as spam even when it is not.
const QUIET_HOURS = Object.freeze({ startHour: 22, endHour: 9, timeZone: "Africa/Cairo" });
const DEFAULT_FREQUENCY_CAP_DAYS = 7;
const MAX_AUDIENCE = 5000;

const cairoParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: QUIET_HOURS.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = int(parts.find((part) => part.type === "hour")?.value, 0);
  const minute = int(parts.find((part) => part.type === "minute")?.value, 0);
  return { hour, minute };
};

/**
 * When a message created now may actually go out. Inside quiet hours it is pushed to the next 09:00
 * Cairo; otherwise it leaves as soon as the queue reaches it.
 */
export const resolveSendWindow = (now = new Date()) => {
  const { hour, minute } = cairoParts(now);
  const inQuietHours = hour >= QUIET_HOURS.startHour || hour < QUIET_HOURS.endHour;
  if (!inQuietHours) return { scheduledAt: null, deferred: false };
  const hoursUntilMorning = hour >= QUIET_HOURS.startHour
    ? 24 - hour + QUIET_HOURS.endHour
    : QUIET_HOURS.endHour - hour;
  const scheduledAt = new Date(now.getTime() + hoursUntilMorning * 60 * 60 * 1000 - minute * 60 * 1000);
  return { scheduledAt, deferred: true };
};

let schemaReadyPromise = null;

export const ensureBroadcastSchema = async (clientOrPool = db) => {
  const run = async () => {
    await ensureMarketingConsentSchema(clientOrPool);
    await clientOrPool.query(`
      CREATE TABLE IF NOT EXISTS marketing_broadcasts (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        audience JSONB NOT NULL DEFAULT '{}'::jsonb,
        message_body TEXT NOT NULL DEFAULT '',
        frequency_cap_days INTEGER NOT NULL DEFAULT 7,
        recipients_total INTEGER NOT NULL DEFAULT 0,
        recipients_queued INTEGER NOT NULL DEFAULT 0,
        recipients_skipped INTEGER NOT NULL DEFAULT 0,
        created_by BIGINT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ NULL,
        stopped_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await clientOrPool.query(`
      CREATE TABLE IF NOT EXISTS marketing_broadcast_recipients (
        id BIGSERIAL PRIMARY KEY,
        broadcast_id BIGINT NOT NULL REFERENCES marketing_broadcasts(id) ON DELETE CASCADE,
        tenant_id BIGINT NOT NULL,
        customer_id BIGINT NULL,
        phone VARCHAR(40) NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'queued',
        skip_reason VARCHAR(40) NOT NULL DEFAULT '',
        idempotency_key VARCHAR(200) NOT NULL DEFAULT '',
        queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (broadcast_id, customer_id)
      )
    `);
    await clientOrPool.query(
      `CREATE INDEX IF NOT EXISTS idx_marketing_broadcasts_tenant_created
         ON marketing_broadcasts (tenant_id, created_at DESC)`
    );
  };
  if (clientOrPool !== db) return run();
  if (!schemaReadyPromise) {
    schemaReadyPromise = run().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

/*
 * Audience filters. Every one of them is a WHERE clause over `customers`, and the opt-out and
 * frequency-cap conditions are appended unconditionally — they are not filters the caller chooses.
 */
const buildAudienceQuery = ({ tenantId, audience = {}, frequencyCapDays = DEFAULT_FREQUENCY_CAP_DAYS, limit = MAX_AUDIENCE }) => {
  const conditions = ["c.tenant_id = $1", "COALESCE(c.phone, '') <> ''", "c.marketing_opt_out_at IS NULL"];
  const params = [tenantId];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const minOrders = int(audience.min_orders, 0);
  if (minOrders > 0) conditions.push(`COALESCE(c.total_orders, 0) >= ${push(minOrders)}`);

  const minSpent = Number(audience.min_spent) || 0;
  if (minSpent > 0) conditions.push(`COALESCE(c.total_spent, 0) >= ${push(minSpent)}`);

  const tier = text(audience.loyalty_tier);
  if (tier && tier !== "all") conditions.push(`LOWER(COALESCE(c.loyalty_tier, '')) = LOWER(${push(tier)})`);

  // "Bought in the last N days" and "has not bought for N days" are the two that actually get used.
  // `customers` has no last-order column, so this comes from the orders roll-up joined below.
  const boughtWithinDays = int(audience.bought_within_days, 0);
  if (boughtWithinDays > 0) {
    conditions.push(`o.last_order_at IS NOT NULL AND o.last_order_at >= NOW() - (${push(boughtWithinDays)} || ' days')::interval`);
  }
  const quietForDays = int(audience.quiet_for_days, 0);
  if (quietForDays > 0) {
    conditions.push(`(o.last_order_at IS NULL OR o.last_order_at < NOW() - (${push(quietForDays)} || ' days')::interval)`);
  }

  // The frequency cap. Never optional, only tightenable.
  const capDays = Math.max(1, int(frequencyCapDays, DEFAULT_FREQUENCY_CAP_DAYS));
  conditions.push(
    `(c.marketing_last_sent_at IS NULL OR c.marketing_last_sent_at < NOW() - (${push(capDays)} || ' days')::interval)`
  );

  const capped = Math.max(1, Math.min(MAX_AUDIENCE, int(limit, MAX_AUDIENCE)));
  return {
    sql: `
      WITH customer_orders AS (
        SELECT customer_id, MAX(created_at) AS last_order_at
        FROM orders
        WHERE tenant_id = $1 AND customer_id IS NOT NULL
        GROUP BY customer_id
      )
      SELECT c.id, c.name, c.phone
      FROM customers c
      LEFT JOIN customer_orders o ON o.customer_id = c.id
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY c.total_spent DESC NULLS LAST, c.id
      LIMIT ${capped}
    `,
    params,
  };
};

export const previewBroadcastAudience = async ({ tenantId, audience = {}, frequencyCapDays } = {}) => {
  await ensureBroadcastSchema();
  const { sql, params } = buildAudienceQuery({ tenantId, audience, frequencyCapDays });
  const result = await db.query(sql, params);
  const rows = result.rows || [];
  return {
    total: rows.length,
    capped_at: MAX_AUDIENCE,
    // A handful of names so the owner can see WHO this is before sending, never the whole list.
    sample: rows.slice(0, 5).map((row) => ({ id: Number(row.id), name: text(row.name) })),
  };
};

const renderBody = (template = "", customer = {}) =>
  text(template).replace(/\{\{\s*customer_name\s*\}\}/g, text(customer.name) || "");

export const createBroadcast = async ({ tenantId, name, messageBody, audience = {}, frequencyCapDays, createdBy = null } = {}) => {
  await ensureBroadcastSchema();
  const body = text(messageBody);
  if (!body) throw Object.assign(new Error("A broadcast needs a message"), { status: 400 });
  const result = await db.query(
    `
    INSERT INTO marketing_broadcasts (tenant_id, name, status, audience, message_body, frequency_cap_days, created_by)
    VALUES ($1, $2, 'draft', $3::jsonb, $4, $5, $6)
    RETURNING *
    `,
    [
      tenantId,
      text(name).slice(0, 200),
      JSON.stringify(audience || {}),
      body,
      Math.max(1, int(frequencyCapDays, DEFAULT_FREQUENCY_CAP_DAYS)),
      Number(createdBy) || null,
    ]
  );
  return result.rows[0];
};

export const listBroadcasts = async ({ tenantId, limit = 20 } = {}) => {
  await ensureBroadcastSchema();
  const result = await db.query(
    `
    SELECT b.*,
           COUNT(r.id) FILTER (WHERE r.status = 'queued') AS queued_count,
           COUNT(r.id) FILTER (WHERE r.status = 'skipped') AS skipped_count
    FROM marketing_broadcasts b
    LEFT JOIN marketing_broadcast_recipients r ON r.broadcast_id = b.id
    WHERE b.tenant_id = $1
    GROUP BY b.id
    ORDER BY b.created_at DESC
    LIMIT $2
    `,
    [tenantId, Math.max(1, Math.min(100, int(limit, 20)))]
  );
  return result.rows;
};

/**
 * Queues one broadcast. Every recipient becomes one queue row; the queue does the sending.
 * Returns what was queued and what was skipped, with the reason.
 */
export const sendBroadcast = async ({ tenantId, broadcastId } = {}) => {
  if (!broadcastsEnabled()) {
    throw Object.assign(new Error("Broadcasts are switched off"), { status: 403, code: "BROADCASTS_DISABLED" });
  }
  await ensureBroadcastSchema();
  const found = await db.query(
    `SELECT * FROM marketing_broadcasts WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, broadcastId]
  );
  const broadcast = found.rows[0];
  if (!broadcast) throw Object.assign(new Error("Broadcast not found"), { status: 404 });
  if (broadcast.status !== "draft") {
    throw Object.assign(new Error(`Broadcast is already ${broadcast.status}`), { status: 409 });
  }

  const { sql, params } = buildAudienceQuery({
    tenantId,
    audience: broadcast.audience || {},
    frequencyCapDays: broadcast.frequency_cap_days,
  });
  const audienceRows = (await db.query(sql, params)).rows || [];
  const { scheduledAt, deferred } = resolveSendWindow();

  let queued = 0;
  let skipped = 0;
  for (const customer of audienceRows) {
    const phone = text(customer.phone);
    if (!phone) {
      skipped += 1;
      continue;
    }
    const idempotencySuffix = `broadcast-${broadcast.id}`;
    try {
      // No `directSend` is passed, on purpose. Every other automation keeps a direct path so a queue
      // outage cannot cost a customer their receipt; a broadcast has the opposite priority — hundreds
      // of unpaced messages is exactly the burst the pacer exists to prevent, so if it cannot be
      // queued it is not sent at all. The wrapper then returns `queued: false` rather than throwing,
      // which is why the result is inspected instead of being assumed to be a success.
      const result = await queueWhatsappAutomation({
        tenantId,
        automationType: BROADCAST_AUTOMATION_TYPE,
        customerId: Number(customer.id) || null,
        recipientPhone: phone,
        fallbackBody: renderBody(broadcast.message_body, customer),
        values: { customer_name: text(customer.name) },
        idempotencySuffix,
        scheduledAt,
      });
      if (!result?.queued) {
        skipped += 1;
        await db.query(
          `
          INSERT INTO marketing_broadcast_recipients (broadcast_id, tenant_id, customer_id, phone, status, skip_reason)
          VALUES ($1, $2, $3, $4, 'skipped', $5)
          ON CONFLICT (broadcast_id, customer_id) DO NOTHING
          `,
          [
            broadcast.id,
            tenantId,
            Number(customer.id) || null,
            phone,
            text(result?.reason || (result?.duplicate ? "duplicate" : "not_queued")).slice(0, 40),
          ]
        ).catch(() => {});
        continue;
      }
      await db.query(
        `
        INSERT INTO marketing_broadcast_recipients (broadcast_id, tenant_id, customer_id, phone, status, idempotency_key)
        VALUES ($1, $2, $3, $4, 'queued', $5)
        ON CONFLICT (broadcast_id, customer_id) DO NOTHING
        `,
        [broadcast.id, tenantId, Number(customer.id) || null, phone, idempotencySuffix]
      );
      // The frequency cap is only honest if it is stamped at queue time: a second broadcast started
      // a minute later must not see this customer as untouched.
      await db.query(
        `UPDATE customers SET marketing_last_sent_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, Number(customer.id) || 0]
      );
      queued += 1;
    } catch (error) {
      skipped += 1;
      await db.query(
        `
        INSERT INTO marketing_broadcast_recipients (broadcast_id, tenant_id, customer_id, phone, status, skip_reason)
        VALUES ($1, $2, $3, $4, 'skipped', $5)
        ON CONFLICT (broadcast_id, customer_id) DO NOTHING
        `,
        [broadcast.id, tenantId, Number(customer.id) || null, phone, text(error?.code || "queue_error").slice(0, 40)]
      ).catch(() => {});
    }
  }

  const updated = await db.query(
    `
    UPDATE marketing_broadcasts
       SET status = 'sending',
           started_at = NOW(),
           recipients_total = $3,
           recipients_queued = $4,
           recipients_skipped = $5,
           updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, broadcast.id, audienceRows.length, queued, skipped]
  );

  console.log("[marketing-broadcast] queued", {
    tenant_id: tenantId,
    broadcast_id: broadcast.id,
    audience: audienceRows.length,
    queued,
    skipped,
    deferred_to_morning: deferred,
  });

  return { broadcast: updated.rows[0], queued, skipped, deferred_to_morning: deferred };
};

/**
 * The kill switch. Cancels every queue row this broadcast created that has not gone out yet.
 * A message already sent cannot be unsent, and this does not pretend otherwise.
 */
export const stopBroadcast = async ({ tenantId, broadcastId } = {}) => {
  await ensureBroadcastSchema();
  const cancelled = await db.query(
    `
    UPDATE whatsapp_message_queue
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1
       AND automation_type = $2
       AND idempotency_key LIKE '%' || $3 || '%'
       AND status IN ('pending', 'scheduled')
    RETURNING id
    `,
    [tenantId, BROADCAST_AUTOMATION_TYPE, `broadcast-${broadcastId}`]
  ).catch(() => ({ rowCount: 0 }));

  const updated = await db.query(
    `
    UPDATE marketing_broadcasts
       SET status = 'stopped', stopped_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, broadcastId]
  );
  return { broadcast: updated.rows[0] || null, cancelled: cancelled.rowCount || 0 };
};

export default sendBroadcast;
