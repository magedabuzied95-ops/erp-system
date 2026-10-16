import crypto from "node:crypto";
import db from "../../database/db.js";
import { normalizeMetaEgyptPhone, normalizeMetaEmail } from "../../../shared/metaEventMatching.js";
import { metaOrderReference } from "../../../shared/metaPurchaseEvent.js";
import {
  TIKTOK_EVENTS,
  buildTikTokEventProperties,
  isTikTokOrderPlaced,
  isTikTokPaymentComplete,
  tiktokContentId,
  tiktokOrderEventId,
} from "../../../shared/tiktokPixelEvent.js";
import { resolveTrustedClientIp } from "../../utils/trustedClientIp.js";

/*
 * TikTok Events API 2.0 (POST /open_api/v1.3/event/track/) for storefront orders.
 *
 * Two events, both keyed on the order so the browser Pixel and this sender agree on
 * `event` + `event_id` and TikTok keeps one of each:
 *   - PlaceAnOrder when the checkout commits the order;
 *   - Purchase once the order's payment_status is "paid" (never its shipping status).
 *
 * Every event goes through tiktok_event_outbox first. UNIQUE (tenant_id, event_name,
 * order_id) is what makes a re-saved order, a replayed webhook or a second worker
 * unable to send a second Purchase. The sweep finds paid orders on its own, so no
 * payment path (Bosta collection, wallet transfer, shipping prepayment, Paymob, a
 * manual edit) has to remember to call in here.
 *
 * Only orders whose checkout carried TikTok consent get a PlaceAnOrder row, and a
 * Purchase is only ever derived from one — an opted-out or till-raised order never
 * reaches TikTok. Matching data is hashed email, phone (E.164) and customer id, plus
 * ip / user agent / _ttp / ttclid, as TikTok's parameter reference asks. Names and
 * addresses are not sent.
 */

const TRACK_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
const DEFAULT_PIXEL_ID = "DB9980JC77UAEK31A0AG";
const REQUEST_TIMEOUT_MS = 10_000;
// Minutes before attempt n+1. After the last one the row is left as failed.
const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360, 1440];
const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
// A PlaceAnOrder older than this no longer watches for its payment.
const PAYMENT_WATCH_DAYS = 45;
const RETENTION_DAYS = 90;
// Unsent after this long (the API was off, TikTok was down for days): stale attribution,
// closed as expired instead of being sent late.
const MAX_EVENT_AGE_DAYS = 7;

const text = (value = "") => String(value ?? "").trim();
const enabledFlag = (value) => !["0", "false", "no", "off"].includes(text(value).toLowerCase());

const TEST_WINDOW_MAX_MS = 24 * 60 * 60 * 1000;
let warnedStaleTestCode = false;

/*
 * A test code routes every event to Events Manager → Test Events, where none counts. Left
 * set by mistake it would quietly drop the shop's real conversions, so it only applies
 * together with TIKTOK_EVENTS_TEST_UNTIL — a time at most 24h ahead. Past that time, or
 * without it, the code is ignored and events are live again.
 */
export const activeTestEventCode = (env = process.env, now = Date.now()) => {
  const code = text(env.TIKTOK_EVENTS_TEST_EVENT_CODE);
  if (!code) return "";
  const until = Date.parse(text(env.TIKTOK_EVENTS_TEST_UNTIL));
  if (Number.isFinite(until) && until > now && until - now <= TEST_WINDOW_MAX_MS) return code;
  if (!warnedStaleTestCode) {
    warnedStaleTestCode = true;
    console.warn("[tiktok-events] TIKTOK_EVENTS_TEST_EVENT_CODE ignored: TIKTOK_EVENTS_TEST_UNTIL is missing, past, or more than 24h ahead. Remove the code.");
  }
  return "";
};

export const tiktokEventsConfig = (env = process.env, now = Date.now()) => {
  const accessToken = text(env.TIKTOK_EVENTS_ACCESS_TOKEN);
  return {
    accessToken,
    pixelId: text(env.TIKTOK_PIXEL_ID) || DEFAULT_PIXEL_ID,
    testEventCode: activeTestEventCode(env, now),
    enabled: Boolean(accessToken) && enabledFlag(env.TIKTOK_EVENTS_API_ENABLED ?? "true"),
  };
};

export const sha256 = (value = "") => {
  const normalized = text(value);
  return normalized ? crypto.createHash("sha256").update(normalized, "utf8").digest("hex") : "";
};

// TikTok: trim + lowercase, then SHA-256.
export const tiktokHashedEmail = (value = "") => sha256(normalizeMetaEmail(value));

// TikTok: E.164 with the leading "+", then SHA-256.
export const tiktokHashedPhone = (value = "") => {
  const digits = normalizeMetaEgyptPhone(value);
  return digits ? sha256(`+${digits}`) : "";
};

const cleanIdentity = (identity = {}) => ({
  consent: identity?.consent !== false && identity?.consent !== "false",
  ttp: text(identity?.ttp).slice(0, 200),
  ttclid: text(identity?.ttclid).slice(0, 500),
  page_url: text(identity?.page_url).slice(0, 1000),
  referrer: text(identity?.referrer).slice(0, 1000),
});

const compact = (object = {}) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== "" && value !== null && value !== undefined));

export const buildTikTokUser = ({ req = null, checkout = {}, customer = {}, order = {}, identity = {} } = {}) =>
  compact({
    email: tiktokHashedEmail(checkout.email || customer.email || order.customer_email),
    phone: tiktokHashedPhone(checkout.primary_phone || customer.phone || order.customer_phone),
    external_id: sha256(text(order.customer_id || customer.id)),
    ttp: identity.ttp,
    ttclid: identity.ttclid,
    ip: req ? text(resolveTrustedClientIp(req)) : "",
    user_agent: text(req?.headers?.["user-agent"]).slice(0, 500),
  });

export const buildTikTokOrderContents = (items = []) =>
  (Array.isArray(items) ? items : []).map((item) => ({
    content_id: tiktokContentId(item || {}, item || {}),
    content_name: item?.product_name || item?.name,
    price: item?.price ?? item?.unit_price ?? item?.selling_price,
    quantity: item?.quantity,
  }));

const orderValue = (order = {}, fallback = 0) =>
  Number(order.total_amount) > 0 ? Number(order.total_amount) : Number(order.total) > 0 ? Number(order.total) : Number(fallback) || 0;

/* One `data[]` entry of /event/track/. Pure: the tests build it without a database. */
export const buildTikTokOrderEvent = ({ eventName, order = {}, items = [], value = 0, user = {}, page = {}, eventTime = null } = {}) => {
  const properties = buildTikTokEventProperties({ contents: buildTikTokOrderContents(items), value: orderValue(order, value) });
  if (!properties || !metaOrderReference(order)) return null;
  return {
    event: eventName,
    event_time: Number.isFinite(eventTime) ? eventTime : Math.floor(Date.now() / 1000),
    event_id: tiktokOrderEventId(eventName, order),
    user,
    page: compact({ url: page.url || "https://m1store-egy.com/checkout", referrer: page.referrer }),
    properties: { ...properties, order_id: metaOrderReference(order) },
  };
};

export const buildTrackRequestBody = (event, config = tiktokEventsConfig()) => ({
  event_source: "web",
  event_source_id: config.pixelId,
  ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
  data: [event],
});

/* ------------------------------------------------------------------ schema */

export const ensureTikTokEventsSchema = async (client = db) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS tiktok_event_outbox (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      order_id BIGINT NOT NULL,
      event_name TEXT NOT NULL,
      event_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, event_name, order_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_tiktok_event_outbox_due
      ON tiktok_event_outbox (next_attempt_at)
      WHERE status IN ('pending', 'retry', 'sending')
  `);
};

const insertOutboxEvent = async (client, { tenantId, orderId, event }) => {
  const result = await client.query(
    `INSERT INTO tiktok_event_outbox (tenant_id, order_id, event_name, event_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (tenant_id, event_name, order_id) DO NOTHING
     RETURNING id`,
    [tenantId, orderId, event.event, event.event_id, JSON.stringify(event)]
  );
  return result.rows[0]?.id || null;
};

/* ------------------------------------------------------------------ sending */

// Only what helps a person fix it: never the payload (customer data) or the token.
const safeError = (value = "") => text(value).replace(/[0-9a-f]{64}/gi, "<hash>").slice(0, 300);

/*
 * { ok } on TikTok's code 0. Otherwise { ok:false, retryable } — throttling (40100 /
 * HTTP 429), TikTok-side 5xx and network or timeout failures come back; a payload or
 * permission error (40001, 40002, 4010x) will fail the same way every time.
 */
export const postTikTokEvent = async (body, { config = tiktokEventsConfig(), fetchImpl = globalThis.fetch } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(TRACK_URL, {
      method: "POST",
      headers: { "Access-Token": config.accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    const code = Number(payload?.code);
    if (response.ok && code === 0) return { ok: true, requestId: text(payload?.request_id) };
    const retryable = response.status >= 500 || response.status === 429 || code === 40100 || (code >= 50000 && code < 60000);
    return { ok: false, retryable, error: safeError(`http ${response.status} code ${Number.isFinite(code) ? code : "?"}: ${payload?.message || ""}`) };
  } catch (error) {
    return { ok: false, retryable: true, error: safeError(error?.name === "AbortError" ? "timeout" : error?.message || String(error)) };
  } finally {
    clearTimeout(timer);
  }
};

/*
 * Claims due rows with a lease (status 'sending', next try in 5 minutes) so two
 * processes never post the same row at once, and a process that dies mid-send
 * leaves the row to be picked up again when the lease runs out. A repeat that
 * does reach TikTok carries the same event_id and is dropped there.
 */
export const drainTikTokOutbox = async ({ client = db, config = tiktokEventsConfig(), fetchImpl = globalThis.fetch, limit = 25 } = {}) => {
  if (!config.enabled) return { sent: 0, failed: 0, retried: 0, skipped: "disabled" };
  const claimed = await client.query(
    `UPDATE tiktok_event_outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = NOW() + INTERVAL '5 minutes'
     WHERE id IN (
       SELECT id FROM tiktok_event_outbox
       WHERE status IN ('pending', 'retry', 'sending') AND next_attempt_at <= NOW()
         AND created_at > NOW() - ($2::int * INTERVAL '1 day')
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, order_id, event_name, payload, attempts`,
    [limit, MAX_EVENT_AGE_DAYS]
  );
  const summary = { sent: 0, failed: 0, retried: 0 };
  for (const row of claimed.rows) {
    const event = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    const result = await postTikTokEvent(buildTrackRequestBody(event, config), { config, fetchImpl });
    if (result.ok) {
      await client.query(`UPDATE tiktok_event_outbox SET status = 'sent', sent_at = NOW(), last_error = NULL WHERE id = $1`, [row.id]);
      summary.sent += 1;
      continue;
    }
    const attempts = Number(row.attempts || 1);
    const giveUp = !result.retryable || attempts >= MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MINUTES[Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)];
    await client.query(
      `UPDATE tiktok_event_outbox SET status = $2, last_error = $3, next_attempt_at = NOW() + ($4::int * INTERVAL '1 minute') WHERE id = $1`,
      [row.id, giveUp ? "failed" : "retry", result.error, delay]
    );
    console.warn("[tiktok-events] send failed", { event: row.event_name, orderId: row.order_id, attempts, giveUp, error: result.error });
    if (giveUp) summary.failed += 1;
    else summary.retried += 1;
  }
  return summary;
};

/* ------------------------------------------------------------------ the two events */

export const recordTikTokPlaceAnOrder = async ({
  req = null,
  tenantId,
  order = {},
  items = [],
  value = 0,
  checkout = {},
  customer = {},
  identity = {},
  client = db,
  config = tiktokEventsConfig(),
  fetchImpl = globalThis.fetch,
  // false inside the order's own transaction: the row commits with the order, and the
  // caller drains after COMMIT (a row it cannot see yet would not be claimed anyway).
  send = true,
} = {}) => {
  if (!config.enabled) return { queued: false, reason: "disabled" };
  const browser = cleanIdentity(identity);
  if (!browser.consent) return { queued: false, reason: "no_consent" };
  if (!isTikTokOrderPlaced(order) || !order.id) return { queued: false, reason: "order_not_eligible" };
  const event = buildTikTokOrderEvent({
    eventName: TIKTOK_EVENTS.placeAnOrder,
    order,
    items,
    value,
    user: buildTikTokUser({ req, checkout, customer, order, identity: browser }),
    page: { url: browser.page_url, referrer: browser.referrer },
  });
  if (!event) return { queued: false, reason: "missing_content_ids" };
  const id = await insertOutboxEvent(client, { tenantId, orderId: order.id, event });
  // Sent now rather than on the next sweep: TikTok asks for real time. Awaitable, never thrown.
  const delivery = id && send ? drainTikTokOutbox({ client, config, fetchImpl, limit: 5 }).catch(() => null) : null;
  return { queued: Boolean(id), eventId: event.event_id, delivery };
};

/*
 * Purchase rows for orders that became paid. The PlaceAnOrder row is the order's
 * TikTok record: its matching data and contents carry over, the value is read from
 * the order now (an edit after checkout changes what was paid), and event_time is
 * when the payment was seen.
 */
export const queuePaidTikTokPurchases = async ({ client = db, config = tiktokEventsConfig(), limit = 100 } = {}) => {
  if (!config.enabled) return { queued: 0 };
  const result = await client.query(
    `SELECT p.tenant_id, p.order_id, p.payload, o.id, o.status, o.payment_status, o.paid_amount, o.total_amount, o.total, o.total_price
     FROM tiktok_event_outbox p
     JOIN orders o ON o.id = p.order_id AND o.tenant_id = p.tenant_id
     WHERE p.event_name = $1
       AND p.created_at > NOW() - ($3::int * INTERVAL '1 day')
       AND LOWER(COALESCE(o.payment_status, '')) = 'paid'
       AND COALESCE(o.paid_amount, 0) >= COALESCE(NULLIF(o.total_amount, 0), NULLIF(o.total, 0), o.total_price, 0) - 0.01
       AND NOT EXISTS (
         SELECT 1 FROM tiktok_event_outbox x
         WHERE x.tenant_id = p.tenant_id AND x.order_id = p.order_id AND x.event_name = $2
       )
     ORDER BY p.id
     LIMIT $4`,
    [TIKTOK_EVENTS.placeAnOrder, TIKTOK_EVENTS.purchase, PAYMENT_WATCH_DAYS, limit]
  );
  let queued = 0;
  for (const row of result.rows) {
    const order = { id: row.id, status: row.status, payment_status: row.payment_status, paid_amount: row.paid_amount, total_amount: row.total_amount, total: row.total, total_price: row.total_price };
    if (!isTikTokPaymentComplete(order)) continue;
    const placed = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    const contents = placed?.properties?.contents || [];
    const event = buildTikTokOrderEvent({
      eventName: TIKTOK_EVENTS.purchase,
      order,
      items: contents.map((line) => ({ meta_content_id: line.content_id, product_name: line.content_name, price: line.price, quantity: line.quantity })),
      user: placed?.user || {},
      page: placed?.page || {},
    });
    if (!event) continue;
    if (await insertOutboxEvent(client, { tenantId: row.tenant_id, orderId: row.order_id, event })) queued += 1;
  }
  return { queued };
};

export const runTikTokEventsSweep = async (options = {}) => {
  const client = options.client || db;
  await client.query(
    `UPDATE tiktok_event_outbox SET status = 'expired'
     WHERE status IN ('pending', 'retry', 'sending') AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [MAX_EVENT_AGE_DAYS]
  );
  const purchases = await queuePaidTikTokPurchases(options);
  const drained = await drainTikTokOutbox(options);
  // Matching data (ip, user agent, hashes) is not kept longer than it is useful.
  await client.query(`DELETE FROM tiktok_event_outbox WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`, [RETENTION_DAYS]);
  return { ...purchases, ...drained };
};

export const startTikTokEventsWorker = ({ intervalMs = 60_000 } = {}) => {
  if (!tiktokEventsConfig().enabled) return null;
  const tick = () => {
    void runTikTokEventsSweep()
      .then((result) => {
        if (result.queued || result.sent || result.failed || result.retried) console.log("[tiktok-events] sweep", result);
      })
      .catch((error) => console.error("[tiktok-events] sweep error", { message: safeError(error?.message || String(error)) }));
  };
  setTimeout(tick, 20_000).unref?.();
  return setInterval(tick, Math.max(30_000, intervalMs));
};
