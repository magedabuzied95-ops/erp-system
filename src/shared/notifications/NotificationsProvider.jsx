import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitRealtimeFeedback } from "../../services/realtimeFeedbackService";
import { subscribeRealtime } from "../realtime/socketStore";
import {
  deleteNotificationById,
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  normalizeNotification,
} from "./notificationsApi";
import { NotificationsContext } from "./useNotifications.js";

const POLLING_MS = 30000;

const safeString = (value) => {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "";
  }
};

const sameNotification = (left = {}, right = {}) =>
  String(left.id) === String(right.id) &&
  left.type === right.type &&
  left.category === right.category &&
  left.priority === right.priority &&
  left.title === right.title &&
  left.message === right.message &&
  left.action_url === right.action_url &&
  left.action_label === right.action_label &&
  Boolean(left.is_read) === Boolean(right.is_read) &&
  String(left.read_at || "") === String(right.read_at || "") &&
  String(left.created_at || "") === String(right.created_at || "") &&
  String(left.updated_at || "") === String(right.updated_at || "") &&
  safeString(left.metadata) === safeString(right.metadata);

const sameNotifications = (left = [], right = []) =>
  left.length === right.length && left.every((item, index) => sameNotification(item, right[index]));

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadedRef = useRef(false);
  const notificationsRef = useRef([]);
  const unreadCountRef = useRef(0);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  useEffect(() => {
    unreadCountRef.current = unreadCount;
  }, [unreadCount]);

  const refreshCount = useCallback(async () => {
    try {
      const count = await fetchUnreadCount();
      setUnreadCount((current) => (current === count ? current : count));
      return count;
    } catch {
      return unreadCountRef.current;
    }
  }, []);

  const refresh = useCallback(async (params = {}) => {
    try {
      setError((current) => (current ? "" : current));
      if (!loadedRef.current) setLoading((current) => (current ? current : true));
      const [rows, count] = await Promise.all([fetchNotifications({ limit: 30, ...params }), fetchUnreadCount()]);
      const safeRows = Array.isArray(rows) ? rows : [];
      const safeUnreadCount = safeRows.some((item) => !item?.is_read) ? Number(count || 0) : 0;
      setNotifications((current) => (sameNotifications(current, safeRows) ? current : safeRows));
      setUnreadCount((current) => (current === safeUnreadCount ? current : safeUnreadCount));
      loadedRef.current = true;
      return safeRows;
    } catch (refreshError) {
      setError(refreshError?.message || "Failed to load notifications");
      if (!loadedRef.current) {
        setNotifications((current) => (current.length ? [] : current));
        setUnreadCount((current) => (current === 0 ? current : 0));
      }
      return [];
    } finally {
      setLoading((current) => (current ? false : current));
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
    const handleNew = (payload) => {
      const next = normalizeNotification(payload);
      if (!next?.id) return;
      const existing = notificationsRef.current.find((item) => String(item.id) === String(next.id));
      if (existing && sameNotification(existing, next)) return;
      setNotifications((current) => {
        return [next, ...current.filter((item) => String(item.id) !== String(next.id))].slice(0, 50);
      });
      setUnreadCount((current) => {
        if (!existing && !next.is_read) return current + 1;
        if (existing?.is_read && !next.is_read) return current + 1;
        if (existing && !existing.is_read && next.is_read) return Math.max(0, current - 1);
        return current;
      });
      if (existing) return;
      emitRealtimeFeedback("notification:new", next);
    };
    const handleCount = (payload) => {
      if (typeof payload?.count === "number") {
        setUnreadCount((current) => (current === payload.count ? current : payload.count));
      } else {
        refreshCount();
      }
    };

    const unsubscribeNew = subscribeRealtime("notification:new", handleNew);
    const unsubscribeCount = subscribeRealtime("notification:count", handleCount);
    const unsubscribeRefresh = subscribeRealtime("notification:count:refresh", handleCount);
    return () => {
      unsubscribeNew();
      unsubscribeCount();
      unsubscribeRefresh();
    };
  }, [refreshCount]);

  const markRead = useCallback(async (id) => {
    const previous = notifications;
    const target = notifications.find((item) => String(item.id) === String(id));
    if (!target || target.is_read) return;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => String(item.id) === String(id) ? { ...item, is_read: true, read_at: readAt } : item));
    setUnreadCount((current) => Math.max(0, current - 1));
    try {
      const updated = await markNotificationRead(id);
      setNotifications((current) => current.map((item) => String(item.id) === String(id) ? (sameNotification(item, updated) ? item : updated) : item));
      refreshCount();
    } catch (markError) {
      setNotifications(previous);
      setError(markError?.message || "Failed to mark notification as read");
    }
  }, [notifications, refreshCount]);

  const markAllRead = useCallback(async () => {
    const previous = notifications;
    if (!notifications.some((item) => !item.is_read)) return;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => item.is_read ? item : { ...item, is_read: true, read_at: item.read_at || readAt }));
    setUnreadCount((current) => (current === 0 ? current : 0));
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
    const target = notifications.find((item) => String(item.id) === String(id));
    if (!target) return;
    setNotifications((current) => current.filter((item) => String(item.id) !== String(id)));
    if (!target.is_read) setUnreadCount((current) => Math.max(0, current - 1));
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
