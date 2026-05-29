import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  COMMAND_CENTER_EVENT_LIMIT,
  COMMAND_CENTER_HIGHLIGHT_MS,
  COMMAND_CENTER_TICKER_LIMIT,
  commandCenterPriorityOrder,
  commandCenterSocketEvents,
} from "../config/commandCenterConfig";
import { mapActivityEvent } from "../components/activity/activityEventMapper";
import { subscribeRealtime } from "../shared/realtime/socketStore";
import { subscribeRealtimeFeedbackEvents } from "../services/realtimeFeedbackService";

const numberValue = (value) => Number(value || 0);
const arrayValue = (value) => (Array.isArray(value) ? value : []);

const first = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");

const createSaleFromEvent = (event) => {
  if (!event || !["orders", "pos"].includes(event.category)) return null;
  if (!/order|payment|sale/i.test(event.rawType || "")) return null;
  const payload = event.payload || {};
  const amount = numberValue(first(payload.total_amount, payload.total, payload.amount, payload.grand_total));
  return {
    id: first(payload.order_id, payload.orderId, payload.id, event.id),
    invoice: first(payload.invoice_number, payload.invoiceNumber, event.details?.order, event.id),
    customer: first(payload.customer_name, payload.customerName, event.details?.customer, "Walk-in"),
    branch: first(payload.branch_name, payload.branchName, event.details?.branch, "Main"),
    amount,
    paymentStatus: first(payload.payment_status, payload.paymentStatus, payload.status, "live"),
    timestamp: event.timestamp,
    href: event.href || (first(payload.order_id, payload.orderId, payload.id) ? `/orders/${encodeURIComponent(first(payload.order_id, payload.orderId, payload.id))}` : "/orders"),
    highlightUntil: Date.now() + COMMAND_CENTER_HIGHLIGHT_MS,
  };
};

const saleFromInvoice = (invoice = {}) => ({
  id: first(invoice.id, invoice.order_id, invoice.orderId, invoice.invoice_number),
  invoice: first(invoice.invoice_number, invoice.invoiceNumber, invoice.order_number, invoice.id),
  customer: first(invoice.customer_name, invoice.customerName, invoice.customer, "Customer"),
  branch: first(invoice.branch_name, invoice.branchName, invoice.branch, "Main"),
  amount: numberValue(first(invoice.total, invoice.total_amount, invoice.amount)),
  paymentStatus: first(invoice.payment_status, invoice.paymentStatus, invoice.status, "paid"),
  timestamp: first(invoice.created_at, invoice.createdAt, invoice.timestamp, new Date().toISOString()),
  href: first(invoice.id, invoice.order_id, invoice.orderId) ? `/orders/${encodeURIComponent(first(invoice.id, invoice.order_id, invoice.orderId))}` : "/orders",
  highlightUntil: 0,
});

const mergeByKey = (items, nextItem, limit) => {
  if (!nextItem) return items;
  const key = `${nextItem.id || nextItem.invoice || ""}:${nextItem.timestamp || ""}`;
  return [nextItem, ...items.filter((item) => `${item.id || item.invoice || ""}:${item.timestamp || ""}` !== key)].slice(0, limit);
};

export function useCommandCenter({ dashboardData, overview, onlineUsers = 0, socketConnected = false } = {}) {
  const [events, setEvents] = useState([]);
  const [sales, setSales] = useState([]);
  const [fullscreen, setFullscreen] = useState(false);
  const seenRef = useRef(new Map());

  const addEvent = useCallback((eventName, payload, source) => {
    const mapped = mapActivityEvent(eventName, payload, source);
    const key = mapped.dedupeKey || `${mapped.rawType}:${mapped.id}`;
    const now = Date.now();
    if (now - Number(seenRef.current.get(key) || 0) < 1800) return;
    seenRef.current.set(key, now);
    if (seenRef.current.size > 160) {
      Array.from(seenRef.current.keys()).slice(0, 40).forEach((item) => seenRef.current.delete(item));
    }
    const enriched = { ...mapped, highlightUntil: now + COMMAND_CENTER_HIGHLIGHT_MS };
    setEvents((current) => [enriched, ...current.filter((item) => item.dedupeKey !== enriched.dedupeKey)].slice(0, COMMAND_CENTER_EVENT_LIMIT));
    const sale = createSaleFromEvent(enriched);
    if (sale) setSales((current) => mergeByKey(current, sale, COMMAND_CENTER_TICKER_LIMIT));
  }, []);

  useEffect(() => {
    const unsubscribers = commandCenterSocketEvents.map((eventName) =>
      subscribeRealtime(eventName, (payload = {}) => addEvent(eventName, payload, "socket"))
    );
    const unsubscribeFeedback = subscribeRealtimeFeedbackEvents((event) => {
      addEvent(event?.eventName || "feedback", event?.payload || event, "feedback");
    });
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribeFeedback();
    };
  }, [addEvent]);

  const seededSales = useMemo(() => arrayValue(overview?.recentInvoices).map(saleFromInvoice).slice(0, COMMAND_CENTER_TICKER_LIMIT), [overview?.recentInvoices]);
  const allSales = useMemo(() => {
    const merged = seededSales;
    return sales.reduce((current, sale) => mergeByKey(current, sale, COMMAND_CENTER_TICKER_LIMIT), merged);
  }, [sales, seededSales]);

  const lowStock = useMemo(() => arrayValue(dashboardData?.lowStock), [dashboardData?.lowStock]);
  const inventory = useMemo(() => dashboardData?.inventory || {}, [dashboardData?.inventory]);
  const posLive = useMemo(() => dashboardData?.posLive || {}, [dashboardData?.posLive]);
  const aiInsights = useMemo(() => arrayValue(dashboardData?.aiInsights), [dashboardData?.aiInsights]);
  const branchPerformance = useMemo(() => arrayValue(dashboardData?.branchPerformance), [dashboardData?.branchPerformance]);
  const topProducts = useMemo(() => arrayValue(dashboardData?.topProducts), [dashboardData?.topProducts]);
  const openShifts = useMemo(() => arrayValue(posLive.openShifts), [posLive.openShifts]);
  const dashboardActivity = useMemo(
    () => arrayValue(dashboardData?.liveActivity).map((item) => mapActivityEvent(item?.type || "dashboard:activity", item, "dashboard")),
    [dashboardData?.liveActivity]
  );
  const activity = useMemo(() => [...events, ...dashboardActivity], [dashboardActivity, events]);

  const metrics = useMemo(() => {
    const todaySales = numberValue(overview?.kpis?.todaySales?.value ?? overview?.today?.sales);
    const todayOrders = numberValue(overview?.kpis?.todayOrders?.value ?? overview?.today?.orders);
    const averageOrderValue = numberValue(overview?.kpis?.averageOrderValue?.value || (todayOrders ? todaySales / todayOrders : 0));
    const activeCarts = numberValue(posLive.currentCartCounts || posLive.activeCarts);
    const activeCheckouts = numberValue(posLive.activeCheckouts);
    const abandonedCarts = numberValue(posLive.abandonedCarts);
    const visitorsOnline = Math.max(numberValue(onlineUsers), numberValue(posLive.onlineVisitors), activeCarts + activeCheckouts);
    const activeAiEvents = activity.filter((item) => item.category === "ai");
    const aiEscalations = activeAiEvents.filter((item) => /escalation|handoff/i.test(item.rawType || "")).length;
    const conversionRate = visitorsOnline ? Math.min(100, (todayOrders / visitorsOnline) * 100) : 0;
    return {
      todaySales,
      todayOrders,
      averageOrderValue,
      activeCustomers: visitorsOnline,
      activeAiConversations: numberValue(posLive.activeAiConversations) || activeAiEvents.length,
      lowStockProducts: numberValue(overview?.kpis?.lowStockProducts?.value) || lowStock.length,
      checkedInStaff: numberValue(posLive.activeCashiers) || openShifts.length,
      abandonedCarts,
      conversionRate,
      activeCarts,
      activeCheckouts,
      aiEscalations,
    };
  }, [activity, lowStock.length, onlineUsers, openShifts.length, overview, posLive]);

  const alerts = useMemo(() => {
    const lowStockAlerts = lowStock.slice(0, 5).map((item) => ({
      id: `stock-${item.id || item.sku || item.name}`,
      title: item.name || "Low stock product",
      description: `${numberValue(item.stock)} / ${numberValue(item.threshold || item.low_stock_alert)}`,
      priority: numberValue(item.stock) <= 0 ? "critical" : "high",
      href: item.id ? `/products/${encodeURIComponent(item.id)}` : "/inventory",
    }));
    const eventAlerts = activity
      .filter((item) => ["critical", "high"].includes(item.priority) || /failed|escalation|overdue|anomaly/i.test(`${item.rawType} ${item.title}`))
      .map((item) => ({
        id: item.dedupeKey,
        title: item.title,
        description: item.description,
        priority: item.priority,
        href: item.href,
      }));
    return [...lowStockAlerts, ...eventAlerts]
      .sort((left, right) => (commandCenterPriorityOrder[left.priority] ?? 2) - (commandCenterPriorityOrder[right.priority] ?? 2))
      .slice(0, 8);
  }, [activity, lowStock]);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch {
      // Fullscreen is optional and browser-controlled.
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handleChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  return {
    metrics,
    sales: allSales,
    events: activity.slice(0, COMMAND_CENTER_EVENT_LIMIT),
    alerts,
    lowStock,
    inventory,
    posLive,
    aiInsights,
    branchPerformance,
    topProducts,
    socketConnected,
    fullscreen,
    toggleFullscreen,
  };
}

export default useCommandCenter;
