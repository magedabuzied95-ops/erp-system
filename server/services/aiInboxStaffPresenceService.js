import { emitToRooms } from "../utils/socket.js";
import { recordPresenceHeartbeat, recordPresenceOffline } from "./staffPresenceLogService.js";

/*
 * Who is looking at which conversation right now.
 *
 * The customer-typing presence (`ai_inbox:presence`) tells the operator what the
 * customer is doing. This is the other half: it tells the operator what their
 * COLLEAGUES are doing, so two people never answer the same customer at once.
 *
 * In-process only, like the employee chat presence: one backend serves the
 * sockets, nothing here is worth a table. A socket says "I am viewing session X"
 * (or none), repeats it as a heartbeat, and is forgotten on disconnect or after
 * the heartbeat goes quiet.
 */
const EVENT = "ai_inbox:staff_presence";
const SNAPSHOT_EVENT = "ai_inbox:staff_presence_snapshot";
const STALE_MS = 2 * 60 * 1000;

// socketId -> { tenantId, userId, name, sessionId, at }
const viewers = new Map();

const text = (value = "") => String(value ?? "").trim();
const roomFor = (tenantId) => `tenant:${tenantId}`;
// Another tab/socket of the same person still announcing: they are not offline yet.
const stillPresent = (gone) => [...viewers.values()].some((entry) => entry.tenantId === gone.tenantId && entry.userId === gone.userId);

const viewersOf = (tenantId, sessionId) => {
  const seen = new Map();
  for (const entry of viewers.values()) {
    if (entry.tenantId !== tenantId || entry.sessionId !== sessionId) continue;
    // One row per person, whatever the number of tabs.
    const previous = seen.get(entry.userId);
    if (!previous || previous.at < entry.at) seen.set(entry.userId, { user_id: entry.userId, name: entry.name, at: entry.at });
  }
  return [...seen.values()].sort((a, b) => a.at - b.at);
};

const broadcast = (tenantId, sessionId) => {
  if (!tenantId || !sessionId) return;
  emitToRooms([roomFor(tenantId)], EVENT, {
    tenant_id: tenantId,
    session_id: sessionId,
    viewers: viewersOf(tenantId, sessionId).map((viewer) => ({ ...viewer, at: new Date(viewer.at).toISOString() })),
    at: new Date().toISOString(),
  });
};

export const snapshotFor = (tenantId) => {
  const sessions = {};
  for (const entry of viewers.values()) {
    if (entry.tenantId !== tenantId || !entry.sessionId) continue;
    if (!sessions[entry.sessionId]) sessions[entry.sessionId] = viewersOf(tenantId, entry.sessionId).map((viewer) => ({ ...viewer, at: new Date(viewer.at).toISOString() }));
  }
  return sessions;
};

export const staffPresenceViewing = ({ socket, tenantId, userId, name = "", sessionId = "", busy = false } = {}) => {
  if (!socket?.id || !tenantId || !userId) return;
  const key = socket.id;
  const previous = viewers.get(key);
  const nextSession = text(sessionId);
  const entry = { tenantId, userId, name: text(name) || `#${userId}`, sessionId: nextSession, at: Date.now() };
  viewers.set(key, entry);
  recordPresenceHeartbeat({ tenantId, userId, name: entry.name, busy }); // Presence log (staffPresenceLogService.js), fire-and-forget.
  if (previous?.sessionId && previous.sessionId !== nextSession) broadcast(tenantId, previous.sessionId);
  if (nextSession) broadcast(tenantId, nextSession);
};

export const staffPresenceLeave = (socket) => {
  const entry = viewers.get(socket?.id);
  if (!entry) return;
  viewers.delete(socket.id);
  if (entry.sessionId) broadcast(entry.tenantId, entry.sessionId);
  if (!stillPresent(entry)) recordPresenceOffline({ tenantId: entry.tenantId, userId: entry.userId });
};

export const sendStaffPresenceSnapshot = ({ socket, tenantId } = {}) => {
  if (!socket || !tenantId) return;
  socket.emit(SNAPSHOT_EVENT, { tenant_id: tenantId, sessions: snapshotFor(tenantId), at: new Date().toISOString() });
};

// A tab that went to sleep without disconnecting keeps its row until the
// heartbeat is older than this; then it is dropped as if it had left.
export const sweepStaleStaffPresence = () => {
  const cutoff = Date.now() - STALE_MS;
  for (const [key, entry] of viewers) {
    if (entry.at >= cutoff) continue;
    viewers.delete(key);
    if (entry.sessionId) broadcast(entry.tenantId, entry.sessionId);
    if (!stillPresent(entry)) recordPresenceOffline({ tenantId: entry.tenantId, userId: entry.userId, at: entry.at });
  }
};

export const attachStaffPresenceHandlers = ({ socket, tenantId, userId, name = "" } = {}) => {
  if (!socket || !tenantId || !userId) return;
  socket.on("ai_inbox:viewing", (payload = {}) => {
    staffPresenceViewing({ socket, tenantId, userId, name: payload?.name || name, sessionId: payload?.session_id || payload?.sessionId || "", busy: payload?.busy === true });
    if (payload?.snapshot === true) sendStaffPresenceSnapshot({ socket, tenantId });
  });
  socket.on("disconnect", () => staffPresenceLeave(socket));
};
