import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getToken } from "../auth/authStorage";
import { socket } from "../../socket";
import {
  deleteNotificationById,
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  normalizeNotification,
} from "./notificationsApi";
import { NotificationsContext } from "./useNotifications";

const POLLING_MS = 30000;

const playSoftTone = () => {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 660;
    gain.gain.value = 0.025;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    window.setTimeout(() => context.close().catch(() => {}), 220);
  } catch {
    // optional sound can fail silently
  }
};

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadedRef = useRef(false);

  const refreshCount = useCallback(async () => {
    try {
      const count = await fetchUnreadCount();
      setUnreadCount(count);
      return count;
    } catch {
      return unreadCount;
    }
  }, [unreadCount]);

  const refresh = useCallback(async (params = {}) => {
    try {
      setError("");
      if (!loadedRef.current) setLoading(true);
      const [rows, count] = await Promise.all([fetchNotifications({ limit: 30, ...params }), fetchUnreadCount()]);
      const safeRows = Array.isArray(rows) ? rows : [];
      const safeUnreadCount = safeRows.some((item) => !item?.is_read) ? Number(count || 0) : 0;
      setNotifications(safeRows);
      setUnreadCount(safeUnreadCount);
      loadedRef.current = true;
      return safeRows;
    } catch (refreshError) {
      setError(refreshError?.message || "Failed to load notifications");
      if (!loadedRef.current) {
        setNotifications([]);
        setUnreadCount(0);
      }
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => {
      refresh();
    }, POLLING_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const token = getToken();
    if (!socket || !token) return undefined;
    socket.auth = { ...(socket.auth || {}), token };
    if (!socket.connected) socket.connect();

    const handleNew = (payload) => {
      const next = normalizeNotification(payload);
      setNotifications((current) => [next, ...current.filter((item) => String(item.id) !== String(next.id))].slice(0, 50));
      setUnreadCount((current) => current + (next.is_read ? 0 : 1));
      if (next.priority === "critical" || next.type === "website_order_created") playSoftTone();
    };
    const handleCount = (payload) => {
      if (typeof payload?.count === "number") {
        setUnreadCount(payload.count);
      } else {
        refreshCount();
      }
    };

    socket.on("notification:new", handleNew);
    socket.on("notification:count", handleCount);
    socket.on("notification:count:refresh", handleCount);
    return () => {
      socket.off("notification:new", handleNew);
      socket.off("notification:count", handleCount);
      socket.off("notification:count:refresh", handleCount);
    };
  }, [refreshCount]);

  const markRead = useCallback(async (id) => {
    const previous = notifications;
    setNotifications((current) => current.map((item) => String(item.id) === String(id) ? { ...item, is_read: true, read_at: new Date().toISOString() } : item));
    setUnreadCount((current) => Math.max(0, current - 1));
    try {
      const updated = await markNotificationRead(id);
      setNotifications((current) => current.map((item) => String(item.id) === String(id) ? updated : item));
      refreshCount();
    } catch (markError) {
      setNotifications(previous);
      setError(markError?.message || "Failed to mark notification as read");
    }
  }, [notifications, refreshCount]);

  const markAllRead = useCallback(async () => {
    const previous = notifications;
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true, read_at: item.read_at || new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
      refreshCount();
    } catch (markError) {
      setNotifications(previous);
      setError(markError?.message || "Failed to mark notifications as read");
    }
  }, [notifications, refreshCount]);

  const remove = useCallback(async (id) => {
    const previous = notifications;
    setNotifications((current) => current.filter((item) => String(item.id) !== String(id)));
    try {
      await deleteNotificationById(id);
      refreshCount();
    } catch (deleteError) {
      setNotifications(previous);
      setError(deleteError?.message || "Failed to delete notification");
    }
  }, [notifications, refreshCount]);

  const value = useMemo(() => ({
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    refreshCount,
    markRead,
    markAllRead,
    remove,
  }), [error, loading, markAllRead, markRead, notifications, refresh, refreshCount, remove, unreadCount]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export default NotificationsProvider;
