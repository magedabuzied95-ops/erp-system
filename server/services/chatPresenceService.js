import db from "../database/db.js";
import { emitToRooms } from "../utils/socket.js";

/*
 * Chat presence ("متصل" / "آخر ظهور"): who is on the employee chat right now.
 *
 * Identity is the same key the thread list uses for `employee_id`: a numeric
 * employee id for the Employee App / a linked POS user, or `pos-branch-<id>`
 * for the branch cashier channel. Online state is an in-process socket
 * refcount (one backend process serves the sockets); last-seen is persisted
 * for employees so it survives a restart and shows after a long absence.
 */
const presence = new Map(); // identity -> { count, tenantId, lastSeenAt }
let schemaReady = false;

const ensurePresenceSchema = async () => {
  if (schemaReady) return;
  await db.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS chat_last_seen_at TIMESTAMPTZ NULL`);
  schemaReady = true;
};

const adminRoom = (tenantId) => `employee-chat:tenant:${tenantId || "global"}`;

const broadcast = (identity, entry) => {
  emitToRooms([adminRoom(entry.tenantId)], "employee-chat:presence", {
    employee_id: identity,
    online: entry.count > 0,
    last_seen_at: entry.lastSeenAt ? new Date(entry.lastSeenAt).toISOString() : null,
    at: new Date().toISOString(),
  });
};

const persistLastSeen = async (identity, at) => {
  const employeeId = Number(identity);
  if (!Number.isFinite(employeeId) || employeeId <= 0) return;
  try {
    await ensurePresenceSchema();
    await db.query(`UPDATE employees SET chat_last_seen_at = $2 WHERE id = $1`, [employeeId, new Date(at)]);
  } catch (error) {
    console.warn("[chat-presence] last seen not persisted", error?.message || error);
  }
};

export const presenceConnect = (identity, tenantId = null) => {
  const key = String(identity || "");
  if (!key) return;
  const entry = presence.get(key) || { count: 0, tenantId: tenantId || null, lastSeenAt: null };
  entry.count += 1;
  entry.tenantId = tenantId || entry.tenantId;
  entry.lastSeenAt = Date.now();
  presence.set(key, entry);
  if (entry.count === 1) broadcast(key, entry);
};

export const presenceDisconnect = (identity) => {
  const key = String(identity || "");
  const entry = presence.get(key);
  if (!entry) return;
  entry.count = Math.max(0, entry.count - 1);
  entry.lastSeenAt = Date.now();
  if (entry.count === 0) {
    broadcast(key, entry);
    void persistLastSeen(key, entry.lastSeenAt);
  }
};

export const presenceSnapshot = (identity) => {
  const entry = presence.get(String(identity || ""));
  return {
    online: Boolean(entry && entry.count > 0),
    last_seen_at: entry?.lastSeenAt ? new Date(entry.lastSeenAt).toISOString() : null,
  };
};

// Decorates thread rows: in-memory presence wins, the persisted column fills the gaps.
export const decorateThreadsWithPresence = (threads = []) =>
  threads.map((thread) => {
    const snapshot = presenceSnapshot(thread.employee_id);
    return {
      ...thread,
      online: snapshot.online,
      last_seen_at: snapshot.last_seen_at || thread.chat_last_seen_at || null,
    };
  });
