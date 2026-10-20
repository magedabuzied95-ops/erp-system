/*
 * Presence log (inbox top bar → Config → Presence log): when each operator was online in the
 * inbox, persisted.
 *
 * Live presence stays where it was — in memory, in aiInboxStaffPresenceService.js, fed by the
 * `ai_inbox:viewing` heartbeat the inbox sends every 30s (src/modules/aiSupport/lib/useStaffPresence.js).
 * That service calls the two hooks below, fire-and-forget:
 *   - recordPresenceHeartbeat: opens a session row if the user has none open, otherwise bumps
 *     last_seen_at (throttled, so a heartbeat is at most one UPDATE a minute per user);
 *   - recordPresenceOffline: closes the open row when the user's last inbox socket leaves or its
 *     heartbeat goes quiet.
 * A process restart drops the in-memory side without calling either; such rows are closed lazily on
 * read at their last_seen_at (STALE_MS without a heartbeat = offline), never at "now".
 * Nothing here can throw into a socket handler: every write swallows and logs its own error.
 */
import db from "../database/db.js";

const STALE_MS = 3 * 60 * 1000;
const TOUCH_THROTTLE_MS = 60 * 1000;
const TIMEZONE = "Africa/Cairo";

const text = (value = "") => String(value ?? "").trim();

let schemaReady = null;
export const ensureStaffPresenceSchema = () => {
  schemaReady ||= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS staff_presence_sessions (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        user_name TEXT NOT NULL DEFAULT '',
        online_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        offline_at TIMESTAMPTZ NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        busy BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_staff_presence_sessions_tenant_from ON staff_presence_sessions (tenant_id, online_from DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_staff_presence_sessions_open ON staff_presence_sessions (tenant_id, user_id) WHERE offline_at IS NULL`);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

// Per-user write chain: two tabs heartbeating at once must not open two rows.
const chains = new Map();
const lastTouch = new Map(); // `${tenant}:${user}` -> { at, busy }
const serial = (key, task) => {
  const next = (chains.get(key) || Promise.resolve()).then(task, task);
  const settled = next.catch(() => {});
  chains.set(key, settled);
  settled.then(() => { if (chains.get(key) === settled) chains.delete(key); });
  return next;
};

const closeStale = (tenantId, userId = null) =>
  db.query(
    `UPDATE staff_presence_sessions
     SET offline_at = last_seen_at
     WHERE tenant_id = $1
       AND offline_at IS NULL
       AND last_seen_at < NOW() - ($2::int * INTERVAL '1 millisecond')
       AND ($3::bigint IS NULL OR user_id = $3::bigint)`,
    [tenantId, STALE_MS, userId]
  );

export const recordPresenceHeartbeat = ({ tenantId, userId, name = "", busy = false } = {}) => {
  const tenant = Number(tenantId);
  const user = Number(userId);
  if (!Number.isFinite(tenant) || tenant <= 0 || !Number.isFinite(user) || user <= 0) return;
  const key = `${tenant}:${user}`;
  const now = Date.now();
  const previous = lastTouch.get(key);
  const isBusy = busy === true;
  if (previous && now - previous.at < TOUCH_THROTTLE_MS && previous.busy === isBusy) return;
  lastTouch.set(key, { at: now, busy: isBusy });
  void serial(key, async () => {
    await ensureStaffPresenceSchema();
    await closeStale(tenant, user);
    const touched = await db.query(
      `UPDATE staff_presence_sessions
       SET last_seen_at = NOW(), busy = $3, user_name = COALESCE(NULLIF($4, ''), user_name)
       WHERE tenant_id = $1 AND user_id = $2 AND offline_at IS NULL`,
      [tenant, user, isBusy, text(name)]
    );
    if (touched.rowCount) return;
    await db.query(
      `INSERT INTO staff_presence_sessions (tenant_id, user_id, user_name, busy) VALUES ($1, $2, $3, $4)`,
      [tenant, user, text(name), isBusy]
    );
  }).catch((error) => {
    lastTouch.delete(key);
    console.warn("[presence-log] heartbeat not recorded", error?.message || error);
  });
};

// `at` = the moment the user was last seen (a swept tab went quiet earlier than "now").
export const recordPresenceOffline = ({ tenantId, userId, at = null } = {}) => {
  const tenant = Number(tenantId);
  const user = Number(userId);
  if (!Number.isFinite(tenant) || tenant <= 0 || !Number.isFinite(user) || user <= 0) return;
  const key = `${tenant}:${user}`;
  lastTouch.delete(key);
  const offlineAt = at ? new Date(at) : new Date();
  void serial(key, async () => {
    await ensureStaffPresenceSchema();
    await db.query(
      `UPDATE staff_presence_sessions
       SET offline_at = GREATEST(online_from, $3::timestamptz),
           last_seen_at = GREATEST(last_seen_at, $3::timestamptz)
       WHERE tenant_id = $1 AND user_id = $2 AND offline_at IS NULL`,
      [tenant, user, offlineAt]
    );
  }).catch((error) => console.warn("[presence-log] offline not recorded", error?.message || error));
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Range bounds as Cairo calendar days: today, the last 7 days (today included), or from..to inclusive.
const rangeSql = ({ preset = "today", from = "", to = "" } = {}) => {
  if (preset === "custom" && DATE_RE.test(from) && DATE_RE.test(to)) {
    const [start, end] = from <= to ? [from, to] : [to, from];
    return { start: `($2::date)::timestamp AT TIME ZONE '${TIMEZONE}'`, end: `(($3::date) + 1)::timestamp AT TIME ZONE '${TIMEZONE}'`, params: [start, end] };
  }
  const days = preset === "7d" ? 6 : 0;
  return {
    start: `(date_trunc('day', NOW() AT TIME ZONE '${TIMEZONE}') - ($2::int * INTERVAL '1 day')) AT TIME ZONE '${TIMEZONE}'`,
    end: `(date_trunc('day', NOW() AT TIME ZONE '${TIMEZONE}') + INTERVAL '1 day') AT TIME ZONE '${TIMEZONE}'`,
    params: [days],
  };
};

export const listPresenceLog = async ({ tenantId, preset = "today", from = "", to = "", userId = null, limit = 1000 } = {}) => {
  const tenant = Number(tenantId);
  if (!Number.isFinite(tenant) || tenant <= 0) throw Object.assign(new Error("A valid tenant id is required"), { status: 400, code: "PRESENCE_TENANT_REQUIRED" });
  await ensureStaffPresenceSchema();
  await closeStale(tenant);
  const range = rangeSql({ preset, from, to });
  const userParam = Number(userId) > 0 ? Number(userId) : null;
  const userIndex = range.params.length + 2;
  const params = [tenant, ...range.params, userParam];
  const window = `
    WITH bounds AS (SELECT ${range.start} AS range_start, ${range.end} AS range_end)
  `;
  const where = `
    s.tenant_id = $1
    AND s.online_from < b.range_end
    AND COALESCE(s.offline_at, NOW()) >= b.range_start
    AND ($${userIndex}::bigint IS NULL OR s.user_id = $${userIndex}::bigint)
  `;
  const sessions = await db.query(
    `${window}
     SELECT s.id, s.user_id, s.user_name, s.online_from, s.offline_at, s.last_seen_at, s.busy,
            (s.offline_at IS NULL) AS online,
            EXTRACT(EPOCH FROM (COALESCE(s.offline_at, NOW()) - s.online_from))::bigint AS duration_seconds,
            b.range_start, b.range_end
     FROM staff_presence_sessions s CROSS JOIN bounds b
     WHERE ${where}
     ORDER BY s.online_from DESC
     LIMIT ${Math.min(Math.max(Number(limit) || 1000, 1), 5000)}`,
    params
  );
  // Totals are clipped to the range: a session that started yesterday counts only today's part.
  const totals = await db.query(
    `${window}
     SELECT s.user_id,
            MAX(s.user_name) AS user_name,
            COUNT(*)::int AS sessions,
            BOOL_OR(s.offline_at IS NULL) AS online,
            BOOL_OR(s.offline_at IS NULL AND s.busy) AS busy,
            SUM(GREATEST(0, EXTRACT(EPOCH FROM (LEAST(COALESCE(s.offline_at, NOW()), b.range_end) - GREATEST(s.online_from, b.range_start)))))::bigint AS online_seconds
     FROM staff_presence_sessions s CROSS JOIN bounds b
     WHERE ${where}
     GROUP BY s.user_id
     ORDER BY online_seconds DESC`,
    params
  );
  const first = sessions.rows[0];
  return {
    range: first ? { start: first.range_start, end: first.range_end } : null,
    sessions: sessions.rows.map((row) => ({
      id: Number(row.id),
      user_id: Number(row.user_id),
      user_name: row.user_name || `#${row.user_id}`,
      online_from: row.online_from,
      offline_at: row.offline_at,
      last_seen_at: row.last_seen_at,
      duration_seconds: Number(row.duration_seconds) || 0,
      online: Boolean(row.online),
      busy: Boolean(row.online && row.busy),
    })),
    users: totals.rows.map((row) => ({
      user_id: Number(row.user_id),
      user_name: row.user_name || `#${row.user_id}`,
      sessions: Number(row.sessions) || 0,
      online: Boolean(row.online),
      busy: Boolean(row.busy),
      online_seconds: Number(row.online_seconds) || 0,
    })),
  };
};
