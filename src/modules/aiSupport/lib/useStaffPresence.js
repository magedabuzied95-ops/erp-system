import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { emitRealtime, subscribeRealtime, useRealtimeStatus } from "../../../shared/realtime/socketStore";
import { getCurrentUser } from "../../../shared/auth/authStorage";

/*
 * "فلان بيرد دلوقتي": which colleagues are on which conversation.
 *
 * The page tells the server what it is looking at (`ai_inbox:viewing`) whenever
 * the selection changes, again every 30s as a heartbeat, and again on every
 * reconnect — a socket that reconnects is a new socket to the server, with no
 * memory of what it was viewing. The server answers with the viewers of each
 * session (`ai_inbox:staff_presence`) and, on request, a snapshot of every
 * session that has someone on it, so a freshly opened inbox is not blind to
 * the colleagues who were already there.
 *
 * Shared by the desktop workspace and the PWA; a fix here reaches both.
 */
const HEARTBEAT_MS = 30 * 1000;
const STALE_MS = 2 * 60 * 1000;

const text = (value = "") => String(value ?? "").trim();
const NO_VIEWERS = Object.freeze([]);

export const useStaffPresence = ({ sessionId = "", enabled = true } = {}) => {
  const realtime = useRealtimeStatus();
  const connected = realtime.connected && !realtime.connecting;
  const me = useMemo(() => getCurrentUser?.() || {}, []);
  const myId = String(me.id || me.user_id || "");
  const myName = text(me.name || me.full_name || me.username || me.email || "");
  const [viewersBySession, setViewersBySession] = useState({});
  const sessionRef = useRef("");

  const announce = useCallback((nextSessionId, { snapshot = false } = {}) => {
    if (!enabled) return;
    if (import.meta.env?.DEV) console.debug("[staff-presence] viewing", { session_id: text(nextSessionId), snapshot });
    emitRealtime("ai_inbox:viewing", { session_id: text(nextSessionId), name: myName, snapshot });
  }, [enabled, myName]);

  // Selection changes + heartbeat.
  useEffect(() => {
    if (!enabled) return undefined;
    sessionRef.current = text(sessionId);
    announce(sessionRef.current);
    const timer = window.setInterval(() => announce(sessionRef.current), HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [announce, enabled, sessionId]);

  // Every (re)connect: say it again and ask for the snapshot.
  useEffect(() => {
    if (!enabled || !connected) return;
    announce(sessionRef.current, { snapshot: true });
  }, [announce, connected, enabled]);

  // Leaving the page is a "viewing nothing".
  useEffect(() => {
    if (!enabled) return undefined;
    return () => emitRealtime("ai_inbox:viewing", { session_id: "", name: myName });
  }, [enabled, myName]);

  useEffect(() => {
    if (!enabled) return undefined;
    const normalize = (list = []) =>
      (Array.isArray(list) ? list : [])
        .map((viewer) => ({ user_id: String(viewer.user_id || ""), name: text(viewer.name) || `#${viewer.user_id}`, at: Date.parse(viewer.at) || Date.now() }))
        .filter((viewer) => viewer.user_id);
    const onPresence = (payload = {}) => {
      const key = text(payload.session_id);
      if (import.meta.env?.DEV) console.debug("[staff-presence] event", { session_id: key, viewers: (payload.viewers || []).length });
      if (!key) return;
      const viewers = normalize(payload.viewers);
      setViewersBySession((current) => {
        if (!viewers.length) {
          if (!current[key]) return current;
          const next = { ...current };
          delete next[key];
          return next;
        }
        return { ...current, [key]: viewers };
      });
    };
    const onSnapshot = (payload = {}) => {
      const sessions = payload?.sessions && typeof payload.sessions === "object" ? payload.sessions : {};
      const next = {};
      for (const [key, list] of Object.entries(sessions)) {
        const viewers = normalize(list);
        if (viewers.length) next[key] = viewers;
      }
      setViewersBySession(next);
    };
    const offPresence = subscribeRealtime("ai_inbox:staff_presence", onPresence);
    const offSnapshot = subscribeRealtime("ai_inbox:staff_presence_snapshot", onSnapshot);
    return () => {
      offPresence();
      offSnapshot();
    };
  }, [enabled]);

  // Rows the server stopped refreshing (its own sweep is 2 minutes) die here too.
  useEffect(() => {
    if (!Object.keys(viewersBySession).length) return undefined;
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      setViewersBySession((current) => {
        let changed = false;
        const next = {};
        for (const [key, list] of Object.entries(current)) {
          const alive = list.filter((viewer) => viewer.at > cutoff);
          if (alive.length !== list.length) changed = true;
          if (alive.length) next[key] = alive;
        }
        return changed ? next : current;
      });
    }, 30 * 1000);
    return () => window.clearInterval(timer);
  }, [viewersBySession]);

  // Colleagues only: the viewer's own row is noise. Filtered once per presence update and
  // handed out by reference: the inbox list passes this to every memoised row, and a fresh
  // array per call re-rendered all of them on every page render.
  const othersBySession = useMemo(() => {
    const out = {};
    for (const [key, viewers] of Object.entries(viewersBySession)) {
      const others = (viewers || []).filter((viewer) => viewer.user_id !== myId);
      if (others.length) out[key] = others;
    }
    return out;
  }, [myId, viewersBySession]);
  const othersOn = useCallback((key) => othersBySession[text(key)] || NO_VIEWERS, [othersBySession]);

  return { viewersBySession, othersOn, myId, myName };
};
