import db from "../../database/db.js";
import {
  classifyTrafficSource,
  isBotUserAgent,
  readTrafficParams,
  TRAFFIC_MEDIUMS,
} from "../../../shared/trafficSource.js";

/**
 * Sales channel analytics: which source each storefront visit came from, whether it put
 * something in the cart, and which source the order it produced is credited to.
 *
 * Attribution is last-touch by session. The storefront opens a session on the first page
 * view, after 30 idle minutes, or when the visitor lands again from a different source,
 * and an order is credited to the session it was placed in. Sessions and carts come from
 * storefront_traffic_sessions; orders and revenue from orders.traffic_*, so a cancelled
 * order leaves the report the moment its status changes.
 *
 * Orders placed before this tracking shipped have no traffic_channel and stay out of the
 * report rather than being guessed into a channel.
 */

const SESSION_KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
const EXCLUDED_ORDER_STATUSES = ["cancelled", "canceled", "cancelled_by_customer", "void", "deleted", "draft", "rejected"];

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

let schemaReady = null;
export const ensureTrafficSchema = async (client = db) => {
  if (!schemaReady) {
    schemaReady = client.query(`
      CREATE TABLE IF NOT EXISTS storefront_traffic_sessions (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        session_key TEXT NOT NULL,
        visitor_key TEXT NOT NULL DEFAULT '',
        channel TEXT NOT NULL,
        medium TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        campaign TEXT NOT NULL DEFAULT '',
        utm_source TEXT NOT NULL DEFAULT '',
        utm_medium TEXT NOT NULL DEFAULT '',
        utm_campaign TEXT NOT NULL DEFAULT '',
        utm_content TEXT NOT NULL DEFAULT '',
        utm_term TEXT NOT NULL DEFAULT '',
        click_id_type TEXT NOT NULL DEFAULT '',
        referrer_host TEXT NOT NULL DEFAULT '',
        landing_path TEXT NOT NULL DEFAULT '',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cart_added_at TIMESTAMPTZ NULL,
        cart_adds INTEGER NOT NULL DEFAULT 0,
        UNIQUE (tenant_id, session_key)
      );
      CREATE INDEX IF NOT EXISTS idx_storefront_traffic_sessions_tenant_started
        ON storefront_traffic_sessions (tenant_id, started_at);
      ALTER TABLE IF EXISTS orders
        ADD COLUMN IF NOT EXISTS traffic_session_key TEXT NULL,
        ADD COLUMN IF NOT EXISTS traffic_channel TEXT NULL,
        ADD COLUMN IF NOT EXISTS traffic_medium TEXT NULL,
        ADD COLUMN IF NOT EXISTS traffic_source TEXT NULL,
        ADD COLUMN IF NOT EXISTS traffic_campaign TEXT NULL;
      CREATE INDEX IF NOT EXISTS idx_orders_tenant_traffic_created
        ON orders (tenant_id, created_at)
        WHERE traffic_channel IS NOT NULL;
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

const ownHostOf = (req) => {
  const origin = text(req?.headers?.origin, 500);
  if (origin) {
    try {
      return new URL(origin).hostname;
    } catch {
      // fall through to the Host header
    }
  }
  return text(req?.headers?.host, 200).split(":")[0];
};

/**
 * One storefront traffic event. `session_start` opens the row (a replay of the same key is
 * a no-op, so a retried request never counts twice); `add_to_cart` marks the session as a
 * carting one. Returns false for anything ignored — bots, malformed keys, unknown types.
 */
export const recordTrafficEvent = async ({ tenantId, req, body = {} } = {}) => {
  const type = text(body.type, 40);
  const sessionKey = text(body.session_key, 64);
  if (!tenantId || !SESSION_KEY_PATTERN.test(sessionKey)) return false;
  if (isBotUserAgent(req?.headers?.["user-agent"])) return false;
  await ensureTrafficSchema();

  if (type === "session_start") {
    const params = readTrafficParams(body.params || {});
    const referrer = text(body.referrer, 2000);
    const traffic = classifyTrafficSource({ params, referrer, ownHost: ownHostOf(req) });
    const visitorKey = SESSION_KEY_PATTERN.test(text(body.visitor_key, 64)) ? text(body.visitor_key, 64) : "";
    await db.query(
      `
      INSERT INTO storefront_traffic_sessions (
        tenant_id, session_key, visitor_key, channel, medium, source, campaign,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        click_id_type, referrer_host, landing_path
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (tenant_id, session_key) DO NOTHING
      `,
      [
        tenantId,
        sessionKey,
        visitorKey,
        traffic.channel,
        traffic.medium,
        text(traffic.source),
        text(traffic.campaign),
        params.utm_source,
        params.utm_medium,
        params.utm_campaign,
        params.utm_content,
        params.utm_term,
        traffic.click_id_type,
        traffic.referrer_host,
        text(body.landing_path, 500),
      ]
    );
    return true;
  }

  if (type === "add_to_cart") {
    const quantity = Math.min(Math.max(Math.trunc(Number(body.quantity) || 1), 1), 100);
    const result = await db.query(
      `
      UPDATE storefront_traffic_sessions
      SET cart_adds = cart_adds + $3,
          cart_added_at = COALESCE(cart_added_at, NOW()),
          last_seen_at = NOW()
      WHERE tenant_id = $1 AND session_key = $2
      `,
      [tenantId, sessionKey, quantity]
    );
    return result.rowCount > 0;
  }

  return false;
};

/**
 * The traffic_* columns for a new website order. The session row recorded when the visit
 * began is the authority; a checkout that arrives without one (tracking blocked, a page
 * cached from before this shipped) is credited to unknown/unknown rather than to direct,
 * which would flatter direct traffic with every order the shop could not trace.
 * Never throws: an attribution problem must not cost the shop an order.
 */
export const resolveOrderTraffic = async ({ tenantId, traffic = {} } = {}) => {
  const sessionKey = text(traffic?.session_key, 64);
  const fallback = {
    traffic_session_key: SESSION_KEY_PATTERN.test(sessionKey) ? sessionKey : null,
    traffic_channel: "unknown",
    traffic_medium: "unknown",
    traffic_source: null,
    traffic_campaign: null,
  };
  if (!tenantId || !fallback.traffic_session_key) return fallback;
  try {
    await ensureTrafficSchema();
    const result = await db.query(
      `
      SELECT channel, medium, source, campaign
      FROM storefront_traffic_sessions
      WHERE tenant_id = $1 AND session_key = $2
      LIMIT 1
      `,
      [tenantId, sessionKey]
    );
    const row = result.rows[0];
    if (!row) return fallback;
    return {
      traffic_session_key: sessionKey,
      traffic_channel: row.channel,
      traffic_medium: row.medium,
      traffic_source: row.source || null,
      traffic_campaign: row.campaign || null,
    };
  } catch (error) {
    console.warn("[channel-analytics] order attribution skipped", { message: error?.message || String(error) });
    return fallback;
  }
};

const percent = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 10000) / 100 : 0);

const tenantClause = (alias, param) => `(${param}::bigint IS NULL OR ${alias}.tenant_id = ${param}::bigint)`;

const loadWindow = async ({ tenantId, windowStart, windowEnd }) => {
  const args = [windowStart, windowEnd, tenantId ?? null];
  const [sessions, orders, untracked] = await Promise.all([
    db.query(
      `
      SELECT s.channel, s.medium,
             COUNT(*)::int AS sessions,
             COUNT(*) FILTER (WHERE s.cart_added_at IS NOT NULL)::int AS added_to_cart
      FROM storefront_traffic_sessions s
      WHERE s.started_at >= $1::timestamptz AND s.started_at < $2::timestamptz
        AND ${tenantClause("s", "$3")}
      GROUP BY s.channel, s.medium
      `,
      args
    ),
    db.query(
      `
      SELECT o.traffic_channel AS channel, o.traffic_medium AS medium,
             COUNT(*)::int AS orders,
             COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0)::numeric AS revenue
      FROM orders o
      WHERE o.traffic_channel IS NOT NULL
        AND o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz
        AND ${tenantClause("o", "$3")}
        AND LOWER(COALESCE(o.status, '')) <> ALL($4::text[])
      GROUP BY o.traffic_channel, o.traffic_medium
      `,
      [...args, EXCLUDED_ORDER_STATUSES]
    ),
    // Website orders in the window that carry no attribution at all, so the screen can say
    // how much of the shop's revenue it cannot explain yet instead of hiding it.
    db.query(
      `
      SELECT COUNT(*)::int AS orders,
             COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0)::numeric AS revenue
      FROM orders o
      WHERE o.traffic_channel IS NULL
        AND LOWER(COALESCE(o.channel, '')) = 'storefront'
        AND o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz
        AND ${tenantClause("o", "$3")}
        AND LOWER(COALESCE(o.status, '')) <> ALL($4::text[])
      `,
      [...args, EXCLUDED_ORDER_STATUSES]
    ),
  ]);

  const rows = new Map();
  const rowFor = (channel, medium) => {
    const key = `${channel}|${medium}`;
    if (!rows.has(key)) rows.set(key, { channel, medium, sessions: 0, added_to_cart: 0, orders: 0, revenue: 0 });
    return rows.get(key);
  };
  for (const row of sessions.rows) {
    const target = rowFor(row.channel, row.medium);
    target.sessions = Number(row.sessions || 0);
    target.added_to_cart = Number(row.added_to_cart || 0);
  }
  for (const row of orders.rows) {
    const target = rowFor(row.channel, row.medium);
    target.orders = Number(row.orders || 0);
    target.revenue = Number(row.revenue || 0);
  }

  const channels = [...rows.values()]
    .map((row) => ({
      ...row,
      cart_rate: percent(row.added_to_cart, row.sessions),
      conversion_rate: percent(row.orders, row.sessions),
      average_order_value: row.orders ? Math.round((row.revenue / row.orders) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions);

  const totals = channels.reduce(
    (sum, row) => ({
      sessions: sum.sessions + row.sessions,
      added_to_cart: sum.added_to_cart + row.added_to_cart,
      orders: sum.orders + row.orders,
      revenue: sum.revenue + row.revenue,
    }),
    { sessions: 0, added_to_cart: 0, orders: 0, revenue: 0 }
  );
  totals.cart_rate = percent(totals.added_to_cart, totals.sessions);
  totals.conversion_rate = percent(totals.orders, totals.sessions);
  totals.average_order_value = totals.orders ? Math.round((totals.revenue / totals.orders) * 100) / 100 : 0;

  return {
    channels,
    totals,
    untracked: {
      orders: Number(untracked.rows[0]?.orders || 0),
      revenue: Number(untracked.rows[0]?.revenue || 0),
    },
  };
};

/** The report, in the analytics v2 envelope: { data, meta }. */
export const getSalesChannelsReport = async ({ filters }) => {
  await ensureTrafficSchema();
  const current = await loadWindow({
    tenantId: filters.tenantId,
    windowStart: filters.windowStart,
    windowEnd: filters.windowEnd,
  });
  const previous = filters.comparison
    ? await loadWindow({
        tenantId: filters.tenantId,
        windowStart: filters.comparison.windowStart,
        windowEnd: filters.comparison.windowEnd,
      })
    : null;

  return {
    data: {
      ...current,
      comparison: previous ? { totals: previous.totals } : null,
    },
    meta: {
      from: filters.from,
      to: filters.to,
      comparison: filters.comparison ? { from: filters.comparison.from, to: filters.comparison.to } : null,
      attribution: "last_touch_session",
      mediums: TRAFFIC_MEDIUMS,
    },
  };
};
