import crypto from "node:crypto";
import db from "../../database/db.js";
import { normalizeMetaEgyptPhone, normalizeMetaEmail } from "../../../shared/metaEventMatching.js";
import { metaOrderReference } from "../../../shared/metaPurchaseEvent.js";
import {
  TIKTOK_CURRENCY,
  TIKTOK_EVENTS,
  buildTikTokEventProperties,
  isTikTokOrderPlaced,
  isTikTokPaymentComplete,
  tiktokContentId,
  tiktokOrderEventId,
  tiktokRefundEventId,
} from "../../../shared/tiktokPixelEvent.js";
import { resolveTrustedClientIp } from "../../utils/trustedClientIp.js";

/*
 * TikTok Events API 2.0 (POST /open_api/v1.3/event/track/) for storefront orders.
 *
 * Keyed on the order, so the browser Pixel and this sender agree on `event` +
 * `event_id` and TikTok keeps one of each:
 *   - PlaceAnOrder when the checkout commits the order;
 *   - Purchase once the order's payment_status is "paid" and paid_amount covers the
 *     total (never its shipping status);
 *   - Refund for each return that gives money back, after a Purchase went out.
 *
 * Every event goes through tiktok_event_outbox first. UNIQUE (tenant_id, event_name,
 * order_id, ref_id) is what makes a re-saved order, a replayed webhook or a second
 * worker unable to send a second Purchase; ref_id is '' for the order events and the
 * return id for a Refund, so two partial returns are two Refunds. The sweep finds paid
 * orders and new returns on its own, so no payment or return path has to call in here.
 *
 * Only orders whose checkout carried TikTok consent get a PlaceAnOrder row, and every
 * later event is derived from that row — an opted-out or till-raised order never
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
/*
 * A PlaceAnOrder watches for its payment this long. An order paid later still gets a
 * Purchase row, marked 'late' and never sent: TikTok's click window is at most 28 days,
 * so it could not be credited to an ad, and the row is the durable count of how many
 * real sales arrived that late (tiktokOutboxStats).
 */
export const PAYMENT_WATCH_DAYS = 60;
const RETENTION_DAYS = 90;
// Unsent after this long (the API was off, TikTok was down for days): stale attribution,
// closed as expired instead of being sent late.
const MAX_EVENT_AGE_DAYS = 7;

const text = (value = "") => String(value ?? "").trim();
const enabledFlag = (value) => !["0", "false", "no", "off"].includes(text(value).toLowerCase());
const parseJson = (value, fallback = null) => {
  if (value && typeof value === "object") return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const TEST_WINDOW_MAX_MS = 24 * 60 * 60 * 1000;
let warnedStaleTestCode = false;

/*
 * A test code sends an event to Events Manager → Test Events, where it never counts.
 * It only applies together with TIKTOK_EVENTS_TEST_UNTIL — a time at most 24h ahead —
 * so it cannot be left on by mistake, and only to orders placed in a test session from
 * a phone in TIKTOK_EVENTS_TEST_PHONES (see isTestOrder). Every other order stays live
 * while a test runs.
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

const testPhones = (value = "") =>
  new Set(text(value).split(/[\s,;]+/).map((phone) => normalizeMetaEgyptPhone(phone)).filter(Boolean));

const truthyFlag = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());

/*
 * TIKTOK_EVENTS_TEST_ONLY: the switch for an end-to-end test on the live shop. While it is
 * on, only test orders (isTestOrder) are recorded, derived and sent — every other order is
 * left alone entirely, so turning the API on for a test cannot report a real sale. With it
 * on and no open test window, nothing at all is sent. Off (the default) = normal operation.
 */
export const tiktokEventsConfig = (env = process.env, now = Date.now()) => {
  const accessToken = text(env.TIKTOK_EVENTS_ACCESS_TOKEN);
  return {
    accessToken,
    pixelId: text(env.TIKTOK_PIXEL_ID) || DEFAULT_PIXEL_ID,
    testEventCode: activeTestEventCode(env, now),
    testPhones: testPhones(env.TIKTOK_EVENTS_TEST_PHONES),
    testOnly: truthyFlag(env.TIKTOK_EVENTS_TEST_ONLY),
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
  // The browser of a test session sends no TikTok events of its own and says so here.
  test: identity?.test === true || identity?.test === "true",
  ttp: text(identity?.ttp).slice(0, 200),
  ttclid: text(identity?.ttclid).slice(0, 500),
  page_url: text(identity?.page_url).slice(0, 1000),
  referrer: text(identity?.referrer).slice(0, 1000),
});

/*
 * Test traffic needs all three: a test session in the browser, a phone the owner listed,
 * and an open test window. A customer who adds ?m1_tt_test=1 only switches off their own
 * browser events; their order still reports live.
 */
export const isTestOrder = ({ identity = {}, checkout = {}, customer = {}, order = {}, config = tiktokEventsConfig() } = {}) =>
  Boolean(identity.test) &&
  Boolean(config.testEventCode) &&
  config.testPhones.has(normalizeMetaEgyptPhone(checkout.primary_phone || customer.phone || order.customer_phone));

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

/*
 * Kept beside the event, never sent: which catalogue id each ordered size went out as,
 * so a later return line (which only knows its variant) maps to the id TikTok saw.
 */
export const buildTikTokOrderContext = (items = []) => ({
  lines: (Array.isArray(items) ? items : [])
    .map((item) => ({
      variant_id: text(item?.variant_id),
      content_id: tiktokContentId(item || {}, item || {}),
      content_name: text(item?.product_name || item?.name),
    }))
    .filter((line) => line.variant_id && line.content_id),
});

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

/*
 * A return that gave money back. Its lines map through the order's context to the ids
 * the Purchase carried; a line that cannot be mapped is left out, the value still is the
 * whole refund.
 */
export const buildTikTokRefundEvent = ({ returnId, orderId, refundAmount = 0, returnItems = [], context = null, user = {}, page = {}, eventTime = null } = {}) => {
  const value = Math.round((Number(refundAmount) || 0) * 100) / 100;
  if (!text(returnId) || !text(orderId) || value <= 0) return null;
  const byVariant = new Map((context?.lines || []).map((line) => [text(line.variant_id), line]));
  const contents = (Array.isArray(returnItems) ? returnItems : [])
    .map((item) => {
      const line = byVariant.get(text(item?.variant_id));
      if (!line) return null;
      const quantity = Math.max(1, Math.floor(Number(item?.quantity) || 1));
      const price = Math.round(((Number(item?.refund_amount) || 0) / quantity) * 100) / 100;
      return { content_id: line.content_id, content_name: line.content_name, price, quantity };
    })
    .filter(Boolean);
  const lineProperties = contents.length ? buildTikTokEventProperties({ contents, value }) : null;
  return {
    event: TIKTOK_EVENTS.refund,
    event_time: Number.isFinite(eventTime) ? eventTime : Math.floor(Date.now() / 1000),
    event_id: tiktokRefundEventId(returnId),
    user,
    page: compact({ url: page.url || "https://m1store-egy.com/checkout", referrer: page.referrer }),
    properties: { ...(lineProperties || { value, currency: TIKTOK_CURRENCY }), order_id: text(orderId) },
  };
};

// testEventCode is passed only for a row that was placed as test traffic.
export const buildTrackRequestBody = (event, { pixelId = DEFAULT_PIXEL_ID, testEventCode = "" } = {}) => ({
  event_source: "web",
  event_source_id: pixelId,
  ...(testEventCode ? { test_event_code: testEventCode } : {}),
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
      ref_id TEXT NOT NULL DEFAULT '',
      event_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      context JSONB,
      is_test BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // A table made by the first version of this file (three-column key, no ref_id) is
  // brought to the current shape; on a new table these are no-ops.
  await client.query(`ALTER TABLE tiktok_event_outbox ADD COLUMN IF NOT EXISTS ref_id TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE tiktok_event_outbox ADD COLUMN IF NOT EXISTS context JSONB`);
  await client.query(`ALTER TABLE tiktok_event_outbox ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE tiktok_event_outbox DROP CONSTRAINT IF EXISTS tiktok_event_outbox_tenant_id_event_name_order_id_key`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tiktok_event_outbox_event
      ON tiktok_event_outbox (tenant_id, event_name, order_id, ref_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_tiktok_event_outbox_due
      ON tiktok_event_outbox (next_attempt_at)
      WHERE status IN ('pending', 'retry', 'sending')
  `);
};

const insertOutboxEvent = async (client, { tenantId, orderId, event, refId = "", context = null, isTest = false, status = "pending" }) => {
  const result = await client.query(
    `INSERT INTO tiktok_event_outbox (tenant_id, order_id, event_name, ref_id, event_id, payload, context, is_test, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
     ON CONFLICT (tenant_id, event_name, order_id, ref_id) DO NOTHING
     RETURNING id`,
    [tenantId, orderId, event.event, text(refId), event.event_id, JSON.stringify(event), context ? JSON.stringify(context) : null, Boolean(isTest), status]
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
 *
 * A test row goes out with the test code, or — once the window has closed — not at
 * all: test traffic must never land in the live data. In test-only mode a live row is
 * not even claimed: it waits, untouched, for normal operation (or expires at 7 days).
 */
export const drainTikTokOutbox = async ({ client = db, config = tiktokEventsConfig(), fetchImpl = globalThis.fetch, limit = 25 } = {}) => {
  if (!config.enabled) return { sent: 0, failed: 0, retried: 0, skipped: "disabled" };
  const claimed = await client.query(
    `UPDATE tiktok_event_outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = NOW() + INTERVAL '5 minutes'
     WHERE id IN (
       SELECT id FROM tiktok_event_outbox
       WHERE status IN ('pending', 'retry', 'sending') AND next_attempt_at <= NOW()
         AND created_at > NOW() - ($2::int * INTERVAL '1 day')
         AND (NOT $3::boolean OR is_test)
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, order_id, event_name, payload, attempts, is_test`,
    [limit, MAX_EVENT_AGE_DAYS, Boolean(config.testOnly)]
  );
  const summary = { sent: 0, failed: 0, retried: 0 };
  for (const row of claimed.rows) {
    if (row.is_test && !config.testEventCode) {
      await client.query(`UPDATE tiktok_event_outbox SET status = 'expired', last_error = 'test window closed' WHERE id = $1`, [row.id]);
      continue;
    }
    const event = parseJson(row.payload, {});
    const body = buildTrackRequestBody(event, { pixelId: config.pixelId, testEventCode: row.is_test ? config.testEventCode : "" });
    const result = await postTikTokEvent(body, { config, fetchImpl });
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

/* ------------------------------------------------------------------ the events */

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
  const isTest = isTestOrder({ identity: browser, checkout, customer, order, config });
  // Test-only mode: a real customer's order leaves no TikTok trace at all, so nothing
  // about it can be sent later either.
  if (config.testOnly && !isTest) return { queued: false, reason: "test_only" };
  const id = await insertOutboxEvent(client, { tenantId, orderId: order.id, event, context: buildTikTokOrderContext(items), isTest });
  // Sent now rather than on the next sweep: TikTok asks for real time. Awaitable, never thrown.
  const delivery = id && send ? drainTikTokOutbox({ client, config, fetchImpl, limit: 5 }).catch(() => null) : null;
  return { queued: Boolean(id), eventId: event.event_id, isTest, delivery };
};

/*
 * Purchase rows for orders that became paid. The PlaceAnOrder row is the order's
 * TikTok record: its matching data, contents, context and test flag carry over, the
 * value is read from the order now (an edit after checkout changes what was paid),
 * and event_time is when the payment was seen. Paid after PAYMENT_WATCH_DAYS: the row
 * is written as 'late' and never sent.
 */
export const queuePaidTikTokPurchases = async ({ client = db, config = tiktokEventsConfig(), limit = 100 } = {}) => {
  if (!config.enabled) return { queued: 0, late: 0 };
  const result = await client.query(
    `SELECT p.tenant_id, p.order_id, p.payload, p.context, p.is_test,
            p.created_at <= NOW() - ($3::int * INTERVAL '1 day') AS late,
            o.id, o.status, o.payment_status, o.paid_amount, o.total_amount, o.total, o.total_price
     FROM tiktok_event_outbox p
     JOIN orders o ON o.id = p.order_id AND o.tenant_id = p.tenant_id
     WHERE p.event_name = $1 AND p.ref_id = ''
       AND p.created_at > NOW() - ($4::int * INTERVAL '1 day')
       AND (NOT $6::boolean OR p.is_test)
       AND LOWER(COALESCE(o.payment_status, '')) = 'paid'
       AND COALESCE(o.paid_amount, 0) >= COALESCE(NULLIF(o.total_amount, 0), NULLIF(o.total, 0), o.total_price, 0) - 0.01
       AND NOT EXISTS (
         SELECT 1 FROM tiktok_event_outbox x
         WHERE x.tenant_id = p.tenant_id AND x.order_id = p.order_id AND x.event_name = $2 AND x.ref_id = ''
       )
     ORDER BY p.id
     LIMIT $5`,
    [TIKTOK_EVENTS.placeAnOrder, TIKTOK_EVENTS.purchase, PAYMENT_WATCH_DAYS, RETENTION_DAYS, limit, Boolean(config.testOnly)]
  );
  let queued = 0;
  let late = 0;
  for (const row of result.rows) {
    const order = { id: row.id, status: row.status, payment_status: row.payment_status, paid_amount: row.paid_amount, total_amount: row.total_amount, total: row.total, total_price: row.total_price };
    if (!isTikTokPaymentComplete(order)) continue;
    const placed = parseJson(row.payload, {});
    const contents = placed?.properties?.contents || [];
    const event = buildTikTokOrderEvent({
      eventName: TIKTOK_EVENTS.purchase,
      order,
      items: contents.map((line) => ({ meta_content_id: line.content_id, product_name: line.content_name, price: line.price, quantity: line.quantity })),
      user: placed?.user || {},
      page: placed?.page || {},
    });
    if (!event) continue;
    const id = await insertOutboxEvent(client, {
      tenantId: row.tenant_id,
      orderId: row.order_id,
      event,
      context: parseJson(row.context),
      isTest: row.is_test,
      status: row.late ? "late" : "pending",
    });
    if (!id) continue;
    if (row.late) late += 1;
    else queued += 1;
  }
  return { queued, late };
};

/*
 * Refund rows for returns that gave money back on an order whose Purchase was sent.
 * One per return (ref_id = return id), however often the return is saved again.
 */
export const queueTikTokRefunds = async ({ client = db, config = tiktokEventsConfig(), limit = 100 } = {}) => {
  if (!config.enabled) return { refunds: 0 };
  const exists = await client.query(`SELECT to_regclass('returns') IS NOT NULL AS returns, to_regclass('return_items') IS NOT NULL AS items`);
  if (!exists.rows[0]?.returns) return { refunds: 0 };
  const result = await client.query(
    `SELECT r.id AS return_id, r.order_id, r.refund_amount, pu.tenant_id, pu.payload, pu.context, pu.is_test
     FROM returns r
     JOIN tiktok_event_outbox pu
       ON pu.order_id = r.order_id AND pu.event_name = $1 AND pu.ref_id = '' AND pu.status = 'sent'
      AND (r.tenant_id IS NULL OR r.tenant_id = pu.tenant_id)
     WHERE COALESCE(r.refund_amount, 0) > 0
       AND (NOT $5::boolean OR pu.is_test)
       AND LOWER(COALESCE(r.status, '')) NOT IN ('pending', 'draft', 'rejected', 'cancelled', 'canceled')
       AND r.created_at > NOW() - ($3::int * INTERVAL '1 day')
       AND NOT EXISTS (
         SELECT 1 FROM tiktok_event_outbox x
         WHERE x.tenant_id = pu.tenant_id AND x.order_id = r.order_id AND x.event_name = $2 AND x.ref_id = r.id::text
       )
     ORDER BY r.id
     LIMIT $4`,
    [TIKTOK_EVENTS.purchase, TIKTOK_EVENTS.refund, MAX_EVENT_AGE_DAYS, limit, Boolean(config.testOnly)]
  );
  if (!result.rows.length) return { refunds: 0 };
  const itemsByReturn = new Map();
  if (exists.rows[0]?.items) {
    const items = await client.query(
      `SELECT return_id, variant_id, quantity, refund_amount FROM return_items WHERE return_id = ANY($1::bigint[])`,
      [result.rows.map((row) => row.return_id)]
    );
    for (const item of items.rows) {
      const key = text(item.return_id);
      itemsByReturn.set(key, [...(itemsByReturn.get(key) || []), item]);
    }
  }
  let refunds = 0;
  for (const row of result.rows) {
    const purchase = parseJson(row.payload, {});
    const event = buildTikTokRefundEvent({
      returnId: row.return_id,
      orderId: row.order_id,
      refundAmount: row.refund_amount,
      returnItems: itemsByReturn.get(text(row.return_id)) || [],
      context: parseJson(row.context),
      user: purchase?.user || {},
      page: purchase?.page || {},
    });
    if (!event) continue;
    if (await insertOutboxEvent(client, { tenantId: row.tenant_id, orderId: row.order_id, event, refId: text(row.return_id), isTest: row.is_test })) refunds += 1;
  }
  return { refunds };
};

/* Counts per event and status — 'late' is the number of sales paid after the window. */
export const tiktokOutboxStats = async ({ client = db } = {}) => {
  const result = await client.query(
    `SELECT event_name, status, COUNT(*)::int AS count FROM tiktok_event_outbox GROUP BY 1, 2 ORDER BY 1, 2`
  );
  return result.rows;
};

export const runTikTokEventsSweep = async (options = {}) => {
  const client = options.client || db;
  await client.query(
    `UPDATE tiktok_event_outbox SET status = 'expired'
     WHERE status IN ('pending', 'retry', 'sending') AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [MAX_EVENT_AGE_DAYS]
  );
  const purchases = await queuePaidTikTokPurchases(options);
  // A refund problem (an unexpected returns shape) must never hold up Purchase delivery.
  const refunds = await queueTikTokRefunds(options).catch((error) => {
    console.warn("[tiktok-events] refunds skipped", { message: safeError(error?.message || String(error)) });
    return { refunds: 0 };
  });
  const drained = await drainTikTokOutbox(options);
  // Matching data (ip, user agent, hashes) is not kept longer than it is useful.
  await client.query(`DELETE FROM tiktok_event_outbox WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`, [RETENTION_DAYS]);
  return { ...purchases, ...refunds, ...drained };
};

export const startTikTokEventsWorker = ({ intervalMs = 60_000 } = {}) => {
  if (!tiktokEventsConfig().enabled) return null;
  const tick = () => {
    void runTikTokEventsSweep()
      .then((result) => {
        if (result.queued || result.refunds || result.sent || result.failed || result.retried) console.log("[tiktok-events] sweep", result);
        if (result.late) console.warn("[tiktok-events] paid after the 60-day window: recorded as late, not sent", { count: result.late });
      })
      .catch((error) => console.error("[tiktok-events] sweep error", { message: safeError(error?.message || String(error)) }));
  };
  setTimeout(tick, 20_000).unref?.();
  return setInterval(tick, Math.max(30_000, intervalMs));
};
