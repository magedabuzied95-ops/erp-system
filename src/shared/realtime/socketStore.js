import { useEffect, useSyncExternalStore } from "react";

import { socket } from "../../socket";
import { getToken } from "../auth/authStorage";

const state = {
  connected: false,
  connecting: false,
  reconnectAttempt: 0,
  lastEventAt: null,
  error: "",
};

let snapshot = { ...state };
const subscribers = new Set();

const emit = () => {
  subscribers.forEach((listener) => listener());
};

const setState = (patch) => {
  const changed = Object.entries(patch || {}).some(([key, value]) => state[key] !== value);
  if (!changed) return;
  Object.assign(state, patch);
  snapshot = { ...state };
  emit();
};

export const connectRealtime = () => {
  const token = getToken();
  if (!token || !socket) return socket;
  socket.auth = { ...(socket.auth || {}), token };
  if (!socket.connected && !socket.active) {
    setState({ connecting: true, error: "" });
    socket.connect();
  }
  return socket;
};

export const disconnectRealtime = () => {
  if (socket?.connected || socket?.active) socket.disconnect();
};

export const subscribeRealtime = (eventName, handler) => {
  if (!socket || !eventName || typeof handler !== "function") return () => {};
  connectRealtime();
  socket.off(eventName, handler);
  socket.on(eventName, handler);
  return () => socket.off(eventName, handler);
};

export const emitRealtime = (eventName, payload = {}, acknowledge) => {
  if (!socket || !eventName) return;
  connectRealtime();
  socket.emit(eventName, payload, typeof acknowledge === "function" ? acknowledge : undefined);
};

socket.on("connect", () => {
  setState({ connected: true, connecting: false, reconnectAttempt: 0, error: "", lastEventAt: new Date().toISOString() });
});

socket.on("disconnect", (reason) => {
  setState({ connected: false, connecting: socket.active, error: reason || "" });
});

socket.io.on("reconnect_attempt", (attempt) => {
  setState({ connecting: true, reconnectAttempt: attempt, error: "" });
});

socket.io.on("reconnect_error", (error) => {
  setState({ connecting: true, error: error?.message || "Realtime reconnect failed" });
});

socket.onAny(() => {
  setState({ lastEventAt: new Date().toISOString() });
});

export const useRealtimeStatus = () =>
  useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );

export const useRealtimeConnection = () => {
  useEffect(() => {
    connectRealtime();
  }, []);
  return useRealtimeStatus();
};
