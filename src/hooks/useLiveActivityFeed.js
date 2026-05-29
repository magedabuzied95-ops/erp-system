import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ACTIVITY_DEDUPE_WINDOW_MS,
  ACTIVITY_FEED_LIMIT,
  ACTIVITY_FEED_STORAGE_KEY,
  ACTIVITY_HIGHLIGHT_MS,
} from "../config/activityFeedConfig";
import { mapActivityEvent, mapNotificationToActivity } from "../components/activity/activityEventMapper";
import { fetchNotifications } from "../shared/notifications/notificationsApi";
import { subscribeRealtime } from "../shared/realtime/socketStore";
import { subscribeRealtimeFeedbackEvents } from "../services/realtimeFeedbackService";

const SOCKET_EVENTS = [
  "new_order",
  "payment_success",
  "payment_confirmed",
  "low_stock",
  "dashboard:activity",
  "dashboard:stock-alert",
  "notification:new",
  "attendance:check-in",
  "attendance:check-out",
  "staff_tasks:event",
  "staff_tasks:created",
  "staff_tasks:completed",
  "ai:new-message",
  "ai:recommendation",
  "ai:exact-product-found",
  "ai:no-results",
  "order:cancelled",
  "order:refund",
  "product:updated",
];

const isBrowser = () => typeof window !== "undefined";

const debug = (...args) => {
  if (import.meta.env.DEV) console.debug("[live-activity-feed]", ...args);
};

const readStoredItems = () => {
  if (!isBrowser()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVITY_FEED_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, ACTIVITY_FEED_LIMIT) : [];
  } catch {
    return [];
  }
};

const persistItems = (items = []) => {
  if (!isBrowser()) return;
  try {
    const bounded = items.slice(0, ACTIVITY_FEED_LIMIT).map((item) => {
      const { payload: _payload, ...persistedItem } = item;
      void _payload;
      return persistedItem;
    });
    window.localStorage.setItem(ACTIVITY_FEED_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    debug("storage persist skipped");
  }
};

const mergeItems = (currentItems, incomingItems, now = Date.now()) => {
  const next = [...currentItems];
  incomingItems.forEach((incoming) => {
    if (!incoming?.dedupeKey) return;
    const existingIndex = next.findIndex((item) => {
      if (item.dedupeKey !== incoming.dedupeKey) return false;
      const incomingTime = new Date(incoming.timestamp).getTime();
      const itemTime = new Date(item.timestamp).getTime();
      return Math.abs(incomingTime - itemTime) <= ACTIVITY_DEDUPE_WINDOW_MS || item.id === incoming.id;
    });
    const item = {
      ...incoming,
      receivedAt: incoming.receivedAt || now,
      highlightUntil: incoming.highlightUntil || now + ACTIVITY_HIGHLIGHT_MS,
    };
    if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], ...item };
    else next.unshift(item);
  });
  return next
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, ACTIVITY_FEED_LIMIT);
};

export function useLiveActivityFeed({ initialEvents = [], seedNotifications = true } = {}) {
  const [items, setItems] = useState(() => readStoredItems());
  const [loading, setLoading] = useState(Boolean(seedNotifications));
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const addMappedItems = useCallback((incomingItems) => {
    const safeItems = (Array.isArray(incomingItems) ? incomingItems : [incomingItems]).filter(Boolean);
    if (!safeItems.length || pausedRef.current) return;
    setItems((current) => {
      const next = mergeItems(current, safeItems);
      persistItems(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const mapped = (Array.isArray(initialEvents) ? initialEvents : [])
      .map((event) => mapActivityEvent(event?.type || event?.event || "dashboard:activity", event, "dashboard"))
      .map((event) => ({ ...event, highlightUntil: 0 }));
    if (mapped.length) addMappedItems(mapped);
  }, [addMappedItems, initialEvents]);

  useEffect(() => {
    if (!seedNotifications) return undefined;
    let active = true;
    fetchNotifications({ limit: 30 })
      .then((rows) => {
        if (!active) return;
        addMappedItems(rows.map((row) => ({ ...mapNotificationToActivity(row), highlightUntil: 0 })));
        setError("");
      })
      .catch((seedError) => {
        if (!active) return;
        setError(seedError?.message || "Failed to seed recent activity");
        debug("notification seed failed", seedError?.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [addMappedItems, seedNotifications]);

  useEffect(() => {
    const unsubscribers = SOCKET_EVENTS.map((eventName) =>
      subscribeRealtime(eventName, (payload = {}) => {
        addMappedItems(mapActivityEvent(eventName, payload, "socket"));
      })
    );
    const unsubscribeFeedback = subscribeRealtimeFeedbackEvents((event) => {
      addMappedItems(mapActivityEvent(event?.eventName || "feedback", event?.payload || event, "feedback"));
    });
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribeFeedback();
    };
  }, [addMappedItems]);

  const clear = useCallback(() => {
    setItems([]);
    if (isBrowser()) window.localStorage.removeItem(ACTIVITY_FEED_STORAGE_KEY);
  }, []);

  const value = useMemo(() => ({
    items,
    loading,
    error,
    paused,
    setPaused,
    clear,
  }), [clear, error, items, loading, paused]);

  return value;
}

export default useLiveActivityFeed;
