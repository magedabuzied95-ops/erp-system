import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { io as createSocket } from "socket.io-client";
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  Bot,
  Building2,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  ClipboardList,
  Loader2,
  MessageSquare,
  Megaphone,
  Package,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShoppingCart,
  SquarePen,
  Store,
  SunMedium,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { formatCurrency } from "../../../shared/lib/currency";
import { SOCKET_URL } from "../../../shared/constants/app";
import { playRealtimeSound, requestBrowserNotificationPermission, unlockRealtimeFeedbackAudio } from "../../../services/realtimeFeedbackService";
import { managerPortalApi } from "../services/managerPortalApi";

const TABS = ["today", "staff", "tasks", "sales", "chat", "more"];
const STORAGE_KEY = "manager.portal.active.tab";
const DEFAULT_NOTIFICATION_SETTINGS = {
  messages: { sound: true, toast: true },
  tasks: { sound: true, toast: true },
  attendance: { sound: true, toast: true },
  sales: { sound: true, toast: true },
  stock: { sound: true, toast: true },
  ai_leads: { sound: true, toast: true },
};

const isBrowser = () => typeof window !== "undefined";
const safeJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
const mergeSettings = (stored = {}) => {
  const next = { ...DEFAULT_NOTIFICATION_SETTINGS };
  const source = stored?.notifications && typeof stored.notifications === "object" ? stored.notifications : stored;
  for (const key of Object.keys(DEFAULT_NOTIFICATION_SETTINGS)) {
    const current = source?.[key] || {};
    next[key] = {
      sound: current.sound !== undefined ? Boolean(current.sound) : true,
      toast: current.toast !== undefined ? Boolean(current.toast) : true,
    };
  }
  return next;
};
const categoryFromNotification = (notification = {}) => {
  const category = String(notification.category || "").toLowerCase();
  if (category) return category;
  const type = String(notification.type || "").toLowerCase();
  if (type.includes("attendance")) return "attendance";
  if (type.includes("task")) return "tasks";
  if (type.includes("stock") || type.includes("refill")) return "stock";
  if (type.includes("lead") || type.includes("ai")) return "ai_leads";
  if (type.includes("order") || type.includes("sale") || type.includes("payment")) return "sales";
  return "messages";
};
const soundForCategory = (category) => {
  if (category === "tasks") return "notification";
  if (category === "attendance") return "attendance";
  if (category === "sales") return "orderNew";
  if (category === "stock") return "warning";
  if (category === "ai_leads") return "aiMessage";
  return "notification";
};
const formatTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(date);
};
const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};
const formatNumber = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));

const Badge = ({ children, className = "" }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${className}`}>{children}</span>
);

const Card = ({ title, subtitle, icon: Icon, children, action, className = "" }) => (
  <section className={`rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/80 ${className}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{subtitle}</div>
        <h2 className="mt-1 text-base font-black text-slate-950 dark:text-white">{title}</h2>
      </div>
      {Icon ? <div className="rounded-2xl bg-slate-950/5 p-2 text-slate-700 dark:bg-white/10 dark:text-white"><Icon className="h-4 w-4" /></div> : null}
    </div>
    {action ? <div className="mt-3">{action}</div> : null}
    <div className="mt-3">{children}</div>
  </section>
);

const Toggle = ({ label, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-right transition ${
      checked
        ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
        : "border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200"
    }`}
  >
    <span className="text-sm font-black">{label}</span>
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${checked ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200"}`}>
      {checked ? "On" : "Off"}
    </span>
  </button>
);

const StatusPill = ({ value, tone = "slate" }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200",
    amber: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200",
    red: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200",
    blue: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200",
  };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${tones[tone] || tones.slate}`}>{value}</span>;
};

const EmptyState = ({ title, body }) => (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-right text-sm font-semibold leading-6 text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
    <div className="font-black text-slate-800 dark:text-white">{title}</div>
    <div className="mt-1">{body}</div>
  </div>
);

export default function ManagerPortal() {
  const { token } = useParams();
  const [activeTab, setActiveTab] = useState(() => (isBrowser() ? window.localStorage.getItem(STORAGE_KEY) || "today" : "today"));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [staff, setStaff] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [sales, setSales] = useState(null);
  const [stockAlerts, setStockAlerts] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatThreads, setChatThreads] = useState([]);
  const [chatThread, setChatThread] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskDraft, setTaskDraft] = useState({ title: "", description: "", assigned_employee_id: "", priority: "medium" });
  const [taskNotes, setTaskNotes] = useState({});
  const [chatBody, setChatBody] = useState("");
  const [settings, setSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() => (isBrowser() && "Notification" in window ? window.Notification.permission : "unsupported"));
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const socketRef = useRef(null);
  const selectedThreadRef = useRef("");
  const selectedTabRef = useRef(activeTab);

  useEffect(() => {
    selectedThreadRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    selectedTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (!isBrowser()) return;
    window.localStorage.setItem(STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    setSettings((current) => mergeSettings(me?.notification_settings || current));
  }, [me]);

  const canEditTasks = true;
  const notificationsUnread = useMemo(() => notifications.filter((item) => !item.is_read).length, [notifications]);
  const canViewProfit = useMemo(() => {
    const permissions = Array.isArray(me?.permissions) ? me.permissions : [];
    return permissions.some((permission) => [
      "treasury.dashboard.view",
      "accounting.view",
      "accounting.reports",
      "reports.view",
      "money_accounts.view",
    ].includes(permission));
  }, [me]);
  const staffList = staff?.staff || [];
  const taskList = tasks?.tasks || [];
  const paymentBreakdown = dashboard?.payment_breakdown || [];
  const lowStock = dashboard?.low_stock || stockAlerts?.low_stock || [];
  const refillAlerts = dashboard?.refill_alerts || stockAlerts?.refill_alerts || [];
  const aiInsights = dashboard?.ai_insights || sales?.ai_insights || [];
  const topProducts = sales?.top_products || [];

  const categoryEnabled = (category, key) => Boolean(settings?.[category]?.[key]);

  const notifyClient = async (notification) => {
    const category = categoryFromNotification(notification);
    const enabled = settings?.[category] || DEFAULT_NOTIFICATION_SETTINGS[category] || DEFAULT_NOTIFICATION_SETTINGS.messages;
    const title = notification.title || "تنبيه";
    const message = notification.message || notification.body || "";
    const priority = String(notification.priority || "medium");
    const tone = priority === "critical" || priority === "high" ? "high" : "normal";
    if (enabled.toast !== false) {
      const body = message ? `${title} · ${message}` : title;
      if (priority === "critical" || priority === "high") toast.success(body, { id: `manager-${notification.id}` });
      else toast(body, { id: `manager-${notification.id}` });
    }
    if (enabled.sound !== false) {
      try {
        await playRealtimeSound(soundForCategory(category), { priority: tone, key: notification.id || `${notification.type}-${Date.now()}` });
      } catch {
        // Sound is optional.
      }
    }
    if (browserNotificationPermission === "granted" && "Notification" in window) {
      try {
        new window.Notification(title, { body: message || "" });
      } catch {
        // Browser notification is optional.
      }
    }
  };

  const upsertNotification = (next) => {
    if (!next?.id) return;
    setNotifications((current) => {
      const exists = current.some((item) => String(item.id) === String(next.id));
      if (!exists && !next.is_read) setUnreadCount((count) => count + 1);
      return [next, ...current.filter((item) => String(item.id) !== String(next.id))].slice(0, 50);
    });
  };

  const loadAll = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setRefreshing(Boolean(silent));
      setError("");
      const [meRes, dashboardRes, staffRes, tasksRes, salesRes, stockRes, notificationsRes, chatRes] = await Promise.all([
        managerPortalApi.me(token),
        managerPortalApi.dashboard(token),
        managerPortalApi.staff(token),
        managerPortalApi.tasks(token),
        managerPortalApi.sales(token),
        managerPortalApi.stockAlerts(token),
        managerPortalApi.notifications(token, { limit: 40 }),
        managerPortalApi.chat(token),
      ]);
      setMe(meRes?.manager || meRes?.data?.manager || null);
      setDashboard(dashboardRes?.dashboard || null);
      setStaff(staffRes?.staff || null);
      setTasks(tasksRes?.tasks || null);
      setSales(salesRes?.sales || null);
      setStockAlerts(stockRes?.stockAlerts || null);
      setNotifications(Array.isArray(notificationsRes?.notifications) ? notificationsRes.notifications : []);
      setUnreadCount(Number(notificationsRes?.unread_count || 0));
      setSettings(mergeSettings(notificationsRes?.settings || meRes?.notification_settings || {}));
      setChatThreads(Array.isArray(chatRes?.threads) ? chatRes.threads : []);
      if (!selectedThreadRef.current && Array.isArray(chatRes?.threads) && chatRes.threads[0]?.id) {
        setSelectedThreadId(String(chatRes.threads[0].id));
      }
      if (!selectedThreadRef.current && chatRes?.thread?.id) {
        setSelectedThreadId(String(chatRes.thread.id));
        setChatThread(chatRes.thread);
        setChatMessages(Array.isArray(chatRes.messages) ? chatRes.messages : []);
      }
    } catch (loadError) {
      setError(loadError?.responseBody?.message || loadError?.message || "تعذر تحميل بوابة المدير.");
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    void loadAll();
  }, [token]);

  useEffect(() => {
    if (!isBrowser()) return undefined;
    if (!("serviceWorker" in navigator)) return undefined;
    navigator.serviceWorker.register("/employee-portal-sw.js").catch(() => null);
    return undefined;
  }, []);

  useEffect(() => {
    if (!isBrowser()) return undefined;
    const socket = createSocket(SOCKET_URL, {
      transports: ["websocket"],
      auth: { managerPortalToken: token },
    });
    socketRef.current = socket;

    socket.on("connect", () => {});
    socket.on("notification:new", (payload) => {
      const next = payload || {};
      upsertNotification(next);
      void notifyClient(next);
    });
    socket.on("notification:count:refresh", () => {
      managerPortalApi.notifications(token, { limit: 40 }).then((response) => {
        setNotifications(Array.isArray(response?.notifications) ? response.notifications : []);
        setUnreadCount(Number(response?.unread_count || 0));
      }).catch(() => null);
    });
    socket.on("employee-chat:new-message", (payload) => {
      const threadId = String(payload?.thread?.id || payload?.thread_id || "");
      if (!threadId) return;
      setChatThreads((current) => [payload.thread, ...current.filter((item) => String(item.id) !== threadId)].filter(Boolean));
      if (selectedThreadRef.current && String(selectedThreadRef.current) === threadId) {
        setChatThread(payload.thread || null);
        managerPortalApi.chatThread(token, threadId).then((response) => {
          setChatThread(response?.thread || null);
          setChatMessages(Array.isArray(response?.messages) ? response.messages : []);
        }).catch(() => null);
      }
    });
    socket.on("employee-chat:thread-updated", (payload) => {
      const nextThread = payload?.thread;
      if (!nextThread?.id) return;
      setChatThreads((current) => [nextThread, ...current.filter((item) => String(item.id) !== String(nextThread.id))]);
      if (selectedThreadRef.current && String(selectedThreadRef.current) === String(nextThread.id)) {
        setChatThread(nextThread);
      }
    });
    socket.on("employee-chat:read", (payload) => {
      const threadId = String(payload?.thread_id || "");
      if (!threadId) return;
      if (selectedThreadRef.current && String(selectedThreadRef.current) === threadId) {
        managerPortalApi.chatThread(token, threadId).then((response) => {
          setChatThread(response?.thread || null);
          setChatMessages(Array.isArray(response?.messages) ? response.messages : []);
        }).catch(() => null);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, browserNotificationPermission, settings]);

  const reloadTabData = async (tab = activeTab) => {
    try {
      if (tab === "today") {
        const [dashboardRes, notificationsRes, stockRes] = await Promise.all([
          managerPortalApi.dashboard(token),
          managerPortalApi.notifications(token, { limit: 40 }),
          managerPortalApi.stockAlerts(token),
        ]);
        setDashboard(dashboardRes?.dashboard || null);
        setNotifications(Array.isArray(notificationsRes?.notifications) ? notificationsRes.notifications : []);
        setUnreadCount(Number(notificationsRes?.unread_count || 0));
        setSettings(mergeSettings(notificationsRes?.settings || me?.notification_settings || {}));
        setStockAlerts(stockRes?.stockAlerts || null);
      }
      if (tab === "staff") {
        const response = await managerPortalApi.staff(token);
        setStaff(response?.staff || null);
      }
      if (tab === "tasks") {
        const response = await managerPortalApi.tasks(token);
        setTasks(response?.tasks || null);
      }
      if (tab === "sales") {
        const response = await managerPortalApi.sales(token);
        setSales(response?.sales || null);
      }
      if (tab === "chat") {
        const response = await managerPortalApi.chat(token, selectedThreadId || null);
        setChatThreads(Array.isArray(response?.threads) ? response.threads : chatThreads);
        if (response?.thread) {
          setChatThread(response.thread);
          setChatMessages(Array.isArray(response.messages) ? response.messages : []);
        }
      }
    } catch (reloadError) {
      toast.error(reloadError?.responseBody?.message || reloadError?.message || "تعذر تحديث البيانات");
    }
  };

  useEffect(() => {
    if (!token || loading) return;
    void reloadTabData(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, token]);

  const markNotificationRead = async (id) => {
    const previous = notifications;
    setNotifications((current) => current.map((item) => String(item.id) === String(id) ? { ...item, is_read: true, read_at: new Date().toISOString() } : item));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      const response = await managerPortalApi.markNotificationRead(token, id);
      if (response?.notification) {
        setNotifications((current) => current.map((item) => String(item.id) === String(id) ? response.notification : item));
      }
    } catch (readError) {
      setNotifications(previous);
      toast.error(readError?.responseBody?.message || readError?.message || "تعذر تحديث الإشعار");
    }
  };

  const saveSettings = async (nextSettings) => {
    setSettings(nextSettings);
    try {
      const response = await managerPortalApi.updateSettings(token, { notification_settings: nextSettings });
      if (response?.notification_settings) setSettings(response.notification_settings.notifications || nextSettings);
      toast.success("تم حفظ الإعدادات");
    } catch (saveError) {
      toast.error(saveError?.responseBody?.message || saveError?.message || "تعذر حفظ الإعدادات");
    }
  };

  const onCategoryToggle = (category, key, value) => {
    const next = { ...settings, [category]: { ...(settings?.[category] || DEFAULT_NOTIFICATION_SETTINGS[category]), [key]: value } };
    void saveSettings(next);
  };

  const enableSound = async () => {
    setSoundUnlocked(true);
    void unlockRealtimeFeedbackAudio().catch(() => {
      // The browser may block audio bootstrap in some environments.
    });
    toast.success("تم تفعيل الصوت");
  };

  const enableBrowserNotifications = async () => {
    const permission = await requestBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);
    if (permission === "granted") toast.success("تم تفعيل إشعارات المتصفح");
    else toast.error("لم يتم تفعيل إشعارات المتصفح");
  };

  const selectThread = async (threadId) => {
    setSelectedThreadId(String(threadId));
    try {
      const response = await managerPortalApi.chatThread(token, threadId);
      setChatThread(response?.thread || null);
      setChatMessages(Array.isArray(response?.messages) ? response.messages : []);
      setChatThreads((current) => [response?.thread || current.find((item) => String(item.id) === String(threadId)), ...current.filter((item) => String(item.id) !== String(threadId))].filter(Boolean));
      await managerPortalApi.markChatRead(token, threadId);
    } catch (chatError) {
      toast.error(chatError?.responseBody?.message || chatError?.message || "تعذر فتح المحادثة");
    }
  };

  const sendChat = async () => {
    if (!selectedThreadId) return;
    const body = chatBody.trim();
    if (!body) return;
    const formData = new FormData();
    formData.append("body", body);
    try {
      setChatBody("");
      const response = await managerPortalApi.sendChatMessage(token, selectedThreadId, formData);
      if (response?.thread) setChatThread(response.thread);
      if (response?.message) setChatMessages((current) => [...current, response.message]);
      await reloadTabData("chat");
    } catch (sendError) {
      toast.error(sendError?.responseBody?.message || sendError?.message || "تعذر إرسال الرسالة");
    }
  };

  const sendTaskAction = async (id, action, payload = {}) => {
    try {
      if (action === "approve") await managerPortalApi.approveTask(token, id, payload);
      else if (action === "reject") await managerPortalApi.rejectTask(token, id, payload);
      else if (action === "reopen") await managerPortalApi.reopenTask(token, id, payload);
      else if (action === "note") await managerPortalApi.noteTask(token, id, payload);
      await reloadTabData("tasks");
      toast.success("تم تحديث المهمة");
    } catch (taskError) {
      toast.error(taskError?.responseBody?.message || taskError?.message || "تعذر تحديث المهمة");
    }
  };

  const createTask = async () => {
    if (!taskDraft.title.trim()) {
      toast.error("أدخل عنوان المهمة");
      return;
    }
    try {
      await managerPortalApi.createTask(token, {
        title: taskDraft.title,
        description: taskDraft.description,
        current_assignee_id: taskDraft.assigned_employee_id || null,
        priority: taskDraft.priority,
      });
      setTaskDraft({ title: "", description: "", assigned_employee_id: "", priority: "medium" });
      await reloadTabData("tasks");
      toast.success("تم إنشاء المهمة");
    } catch (taskError) {
      toast.error(taskError?.responseBody?.message || taskError?.message || "تعذر إنشاء المهمة");
    }
  };

  const visibleTasks = taskList;

  if (loading) {
    return (
      <main dir="rtl" className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_28%),linear-gradient(180deg,#eff6ff_0%,#f8fafc_42%,#ffffff_100%)] px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-white">
        <div className="mx-auto flex min-h-[70vh] max-w-7xl items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main dir="rtl" className="min-h-[100dvh] bg-slate-100 px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-white">
        <div className="mx-auto max-w-2xl rounded-3xl border border-amber-200 bg-white p-5 shadow-sm dark:border-amber-500/20 dark:bg-white/[0.04]">
          <AlertTriangle className="h-8 w-8 text-amber-600" />
          <h1 className="mt-4 text-2xl font-black">بوابة المدير غير متاحة</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{error}</p>
          <button type="button" onClick={() => loadAll()} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-950">
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </button>
        </div>
      </main>
    );
  }

  return (
    <main data-testid="manager-portal-root" dir="rtl" className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_24%),radial-gradient(circle_at_80%_10%,_rgba(16,185,129,0.14),_transparent_28%),linear-gradient(180deg,#eff6ff_0%,#f8fafc_44%,#ffffff_100%)] px-3 py-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-slate-950 dark:bg-slate-950 dark:text-white md:px-4 md:py-4">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[260px_minmax(0,1fr)_360px]">
        <aside className="hidden min-h-[calc(100dvh-2rem)] rounded-[2rem] border border-white/60 bg-white/80 p-4 shadow-xl shadow-slate-200/70 backdrop-blur dark:border-white/10 dark:bg-slate-900/80 lg:block">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-950 p-3 text-white">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Manager Command Center</div>
              <div className="text-lg font-black">{me?.full_name || me?.name || "مدير"}</div>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-3xl bg-slate-950 p-4 text-white">
              <div className="text-xs font-black text-white/60">اليوم</div>
              <div className="mt-2 text-3xl font-black">{formatCurrency(dashboard?.today_sales_total || 0)}</div>
              <div className="mt-2 text-sm font-semibold text-white/70">{formatNumber(dashboard?.invoice_count || 0)} فاتورة اليوم</div>
            </div>
            <button type="button" data-testid="refresh-button-mobile" onClick={() => void loadAll({ silent: true })} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
              <span>تحديث مباشر</span>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                data-testid={`sidebar-tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                className={`flex w-full items-center justify-between rounded-2xl px-3 py-3 text-sm font-black transition ${
                  activeTab === tab ? "bg-slate-950 text-white" : "bg-white text-slate-700 dark:bg-white/[0.03] dark:text-slate-200"
                }`}
              >
                <span>{tab === "today" ? "Today" : tab === "staff" ? "Staff" : tab === "tasks" ? "Tasks" : tab === "sales" ? "Sales" : tab === "chat" ? "Chat" : "More"}</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          <header className="rounded-[2rem] border border-white/60 bg-white/90 p-4 shadow-xl shadow-slate-200/60 backdrop-blur dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-600/70">بوابة المدير</div>
                <h1 className="mt-1 text-2xl font-black leading-8 text-slate-950 dark:text-white">{me?.full_name || me?.name || "Manager"}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" /> {me?.branch_name || "All branches"}</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {me?.role || "manager"}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100">Live</Badge>
                <button type="button" data-testid="refresh-button" onClick={() => void loadAll({ silent: true })} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-3 py-2 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                  <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                  تحديث
                </button>
              </div>
            </div>
          </header>

          {activeTab === "today" ? (
            <div data-testid="more-panel" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: "إجمالي مبيعات اليوم", value: formatCurrency(dashboard?.today_sales_total || 0), icon: ShoppingCart, tone: "green" },
                  { label: "عدد الفواتير", value: formatNumber(dashboard?.invoice_count || 0), icon: ClipboardList, tone: "blue" },
                  { label: "الموجودون الآن", value: formatNumber(dashboard?.active_employees_now || 0), icon: Users, tone: "green" },
                  { label: "متأخر / غائب", value: `${formatNumber(dashboard?.late_employees || 0)} / ${formatNumber(dashboard?.absent_employees || 0)}`, icon: Clock3, tone: "amber" },
                  { label: "المهام المفتوحة", value: formatNumber(dashboard?.pending_tasks || 0), icon: ClipboardList, tone: "blue" },
                  { label: "المهام المتأخرة", value: formatNumber(dashboard?.overdue_tasks || 0), icon: AlertTriangle, tone: "red" },
                ].map((card) => (
                  <Card key={card.label} subtitle={card.label} title={card.value} icon={card.icon} className={`border-white/80 ${card.tone === "green" ? "shadow-emerald-100/60" : ""}`} />
                ))}
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                <Card title="توزيع الدفع" subtitle="Payment breakdown" icon={ArrowLeftRight}>
                  {paymentBreakdown.length ? (
                    <div className="space-y-2">
                      {paymentBreakdown.map((row) => (
                        <div key={row.method} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 dark:bg-white/[0.03] dark:text-slate-200">
                          <span>{row.method}</span>
                          <span>{formatCurrency(row.total || 0)} · {formatNumber(row.count || 0)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="لا توجد بيانات دفع" body="لن نعرض أرقامًا وهمية إذا لم يكن هناك مصدر بيانات متاح." />
                  )}
                </Card>
                <Card title="تنبيهات السحب / العرض" subtitle="Stock alerts" icon={Package}>
                  {lowStock.length || refillAlerts.length ? (
                    <div className="space-y-2">
                      {refillAlerts.slice(0, 3).map((alert) => (
                        <div key={`refill-${alert.id}`} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
                          <div className="font-black">{alert.product_name || "Display refill"}</div>
                          <div className="mt-1 text-xs font-bold opacity-80">{alert.color_name || alert.color || ""} {alert.replacement_size ? `· ${alert.replacement_size}` : ""}</div>
                        </div>
                      ))}
                      {lowStock.slice(0, 3).map((item) => (
                        <div key={`low-${item.id}-${item.name}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                          <div className="font-black">{item.name || "Unknown item"}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">{formatNumber(item.stock || 0)} متبقي</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="لا توجد تنبيهات مخزون" body="لن يتم اختلاق تنبيهات في حالة عدم توفر بيانات فعلية." />
                  )}
                </Card>
              </div>

              <Card title="AI insights" subtitle="Simple intelligence" icon={Bot}>
                {aiInsights.length ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {aiInsights.map((item, index) => (
                      <div key={`${item.title || item.body || index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-sky-600/70">{item.type || "insight"}</div>
                        <div className="mt-1 font-black text-slate-950 dark:text-white">{item.title || "Insight"}</div>
                        <div className="mt-1">{item.body || "-"}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="لا توجد رؤى حالية" body="إذا لم توجد بيانات حقيقية، سنعرض حالة فارغة بدل أرقام وهمية." />
                )}
              </Card>
            </div>
          ) : null}

          {activeTab === "staff" ? (
            <div className="space-y-3">
              {staffList.length ? staffList.map((employee) => (
                <Card key={employee.employee_id} title={employee.employee_name || "Employee"} subtitle={employee.department || employee.job_title || "Staff"} icon={Users}>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={employee.attendance_status === "checked_in" ? "green" : employee.attendance_status === "online" ? "blue" : "slate"} value={employee.attendance_status || "absent"} />
                    <StatusPill tone="blue" value={`Tasks ${formatNumber(employee.open_tasks || 0)}/${formatNumber(employee.completed_tasks || 0)}`} />
                    <StatusPill tone="amber" value={`Sales ${formatCurrency(employee.sales_today || 0)}`} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                    <div>الحضور: {formatTime(employee.check_in_time)} - {formatTime(employee.check_out_time)}</div>
                    <div>الوردية: {Number(employee.shift_duration_hours || 0).toFixed(2)} ساعة</div>
                    <div>الفواتير: {formatNumber(employee.invoices_count || 0)}</div>
                    <div>آخر نشاط: {formatDateTime(employee.last_activity)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">عمولة متوقعة {employee.expected_commission == null ? "غير متاح" : formatCurrency(employee.expected_commission || 0)}</Badge>
                    <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">مهام مفتوحة {formatNumber(employee.open_tasks || 0)}</Badge>
                  </div>
                </Card>
              )) : (
                <EmptyState title="لا يوجد موظفون لهذا النطاق" body="إذا لم يكن هناك مصدر بيانات أو لم تكن هناك صلاحية، سنعرض حالة فارغة." />
              )}
            </div>
          ) : null}

          {activeTab === "tasks" ? (
            <div className="space-y-4">
              <Card title="إنشاء مهمة" subtitle="Create task" icon={Plus}>
                <div className="grid gap-2 md:grid-cols-2">
                  <input value={taskDraft.title} onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))} placeholder="عنوان المهمة" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
                  <select value={taskDraft.assigned_employee_id} onChange={(event) => setTaskDraft((current) => ({ ...current, assigned_employee_id: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]">
                    <option value="">إسناد اختياري</option>
                    {staffList.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{employee.employee_name}</option>)}
                  </select>
                  <select value={taskDraft.priority} onChange={(event) => setTaskDraft((current) => ({ ...current, priority: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]">
                    <option value="low">منخفضة</option>
                    <option value="medium">متوسطة</option>
                    <option value="high">عالية</option>
                    <option value="critical">حرجة</option>
                  </select>
                  <button type="button" data-testid="create-task-button" onClick={createTask} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                    <Plus className="h-4 w-4" />
                    إنشاء
                  </button>
                </div>
                <textarea value={taskDraft.description} onChange={(event) => setTaskDraft((current) => ({ ...current, description: event.target.value }))} placeholder="الوصف" rows={3} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
              </Card>

              {visibleTasks.length ? visibleTasks.map((task) => {
                const note = taskNotes[task.id] || "";
                return (
                  <Card key={task.id} title={task.title_ar || task.title || "Task"} subtitle={task.status || "task"} icon={ClipboardList}>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone={task.status === "completed" ? "green" : task.status === "overdue" ? "red" : task.status === "in_progress" ? "blue" : "slate"} value={task.status || "pending"} />
                      <StatusPill tone="amber" value={task.priority || "medium"} />
                      {task.branch_name ? <StatusPill tone="slate" value={task.branch_name} /> : null}
                    </div>
                    <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                      <div>الموظف: {task.employee_name || task.assignee_name || "-"}</div>
                      <div>الفرع: {task.branch_name || "-"}</div>
                      <div>التاريخ: {formatDateTime(task.created_at)}</div>
                      <div>البدء/الإنهاء: {formatDateTime(task.started_at)} / {formatDateTime(task.completed_at)}</div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <button type="button" data-testid={`task-approve-${task.id}`} onClick={() => void sendTaskAction(task.id, "approve", { note })} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">
                        <CheckCircle2 className="h-4 w-4" />
                        اعتماد
                      </button>
                      <button type="button" data-testid={`task-reject-${task.id}`} onClick={() => void sendTaskAction(task.id, "reject", { note })} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                        <X className="h-4 w-4" />
                        رفض / إعادة
                      </button>
                      <button type="button" data-testid={`task-reopen-${task.id}`} onClick={() => void sendTaskAction(task.id, "reopen", { note })} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                        <ArrowLeftRight className="h-4 w-4" />
                        إعادة فتح
                      </button>
                      <button type="button" data-testid={`task-note-${task.id}`} onClick={() => void sendTaskAction(task.id, "note", { note })} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                        <SquarePen className="h-4 w-4" />
                        إضافة ملاحظة
                      </button>
                    </div>
                    <textarea value={note} onChange={(event) => setTaskNotes((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="ملاحظة المدير" rows={2} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
                  </Card>
                );
              }) : (
                <EmptyState title="لا توجد مهام" body="المصدر الحقيقي فارغ حاليا، لذلك لن نعرض بيانات وهمية." />
              )}
            </div>
          ) : null}

          {activeTab === "sales" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card title={formatCurrency(sales?.overview?.today?.sales || dashboard?.today_sales_total || 0)} subtitle="Today sales" icon={ShoppingCart} />
                <Card title={formatNumber(sales?.overview?.today?.orders || dashboard?.invoice_count || 0)} subtitle="Invoices" icon={ClipboardList} />
                {canViewProfit ? <Card title={formatCurrency(sales?.overview?.today?.profit || 0)} subtitle="Profit" icon={SunMedium} /> : <Card title="—" subtitle="Profit hidden" icon={SunMedium} />}
                <Card title={formatCurrency(sales?.overview?.today?.averageOrderValue || 0)} subtitle="Average order" icon={ArrowLeftRight} />
              </div>
              <Card title="أعلى المنتجات" subtitle="Top products" icon={Package}>
                {topProducts.length ? topProducts.map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 dark:bg-white/[0.03] dark:text-slate-200">
                    <span>{item.name}</span>
                    <span>{formatNumber(item.quantity || 0)} · {formatCurrency(item.revenue || 0)}</span>
                  </div>
                )) : <EmptyState title="لا توجد منتجات مبيعة" body="سيظهر هنا أفضل البائعين عند توفر بيانات فعلية." />}
              </Card>
              <Card title="إيرادات اليوم" subtitle="Hourly trend" icon={Clock3}>
                {Array.isArray(sales?.hourly) && sales.hourly.length ? (
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
                    {sales.hourly.map((item) => (
                      <div key={item.hour} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                        <div className="text-xs font-black text-slate-400">{String(item.hour).padStart(2, "0")}:00</div>
                        <div className="mt-1 font-black">{formatCurrency(item.sales || 0)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="لا توجد بيانات ساعية" body="إذا لم تتوفر فواتير اليوم، سنبقي اللوحة فارغة." />
                )}
              </Card>
            </div>
          ) : null}

          {activeTab === "chat" ? (
            <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <Card title="المحادثات" subtitle="Staff chat" icon={MessageSquare} className="min-h-[36rem]">
                <div className="space-y-2">
                  {chatThreads.length ? chatThreads.map((thread) => (
                    <button key={thread.id} type="button" data-testid={`chat-thread-${thread.id}`} onClick={() => void selectThread(thread.id)} className={`w-full rounded-2xl border px-3 py-3 text-right transition ${String(thread.id) === String(selectedThreadId) ? "border-sky-300 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10" : "border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.03]"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-950 dark:text-white">{thread.employee_name || thread.employee_code || "Employee"}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{thread.branch_name || "-"}</div>
                        </div>
                        <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{formatNumber(thread.unread_count || 0)}</Badge>
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{thread.last_message || "-"}</div>
                    </button>
                  )) : <EmptyState title="لا توجد محادثات" body="سنظهر المحادثات الحقيقية هنا عند وجودها." />}
                </div>
              </Card>

              <Card title={chatThread?.employee_name || "اختر محادثة"} subtitle="Conversation" icon={Phone} className="min-h-[36rem]">
                {chatThread ? (
                  <div className="flex min-h-[32rem] flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-black text-slate-500 dark:text-slate-300">
                      <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{chatThread.branch_name || "-"}</Badge>
                      <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{formatNumber(chatThread.unread_count || 0)} unread</Badge>
                    </div>
                    <div className="flex-1 space-y-2 overflow-auto rounded-3xl bg-slate-50 p-3 dark:bg-white/[0.03]">
                      {(chatMessages || []).length ? chatMessages.map((message) => (
                        <div key={message.id} className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm font-semibold leading-6 ${String(message.sender_type) === "admin" ? "mr-auto bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "ml-auto bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-100"}`}>
                          <div className="text-[11px] font-black uppercase tracking-[0.12em] opacity-70">{message.sender_type === "admin" ? "الإدارة" : chatThread.employee_name || "Employee"}</div>
                          <div className="mt-1 whitespace-pre-wrap">{message.body || message.attachment_name || "Attachment"}</div>
                          <div className="mt-1 text-[10px] opacity-60">{formatDateTime(message.created_at)}</div>
                        </div>
                      )) : <EmptyState title="لا توجد رسائل" body="افتح أي محادثة لعرض الرسائل الحقيقية." />}
                    </div>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <textarea data-testid="chat-message-input" value={chatBody} onChange={(event) => setChatBody(event.target.value)} rows={3} placeholder="اكتب رسالة..." className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
                      <button type="button" data-testid="chat-send-button" onClick={() => void sendChat()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                        <SendIconFallback />
                        إرسال
                      </button>
                    </div>
                  </div>
                ) : (
                  <EmptyState title="اختر محادثة" body="سيظهر هنا الحوار مع الموظف المحدد." />
                )}
              </Card>
            </div>
          ) : null}

          {activeTab === "more" ? (
            <div className="space-y-4">
              <Card title="إعدادات التنبيه" subtitle="Notifications settings" icon={Bell}>
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(settings).map(([category, config]) => (
                    <div key={category} className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-black text-slate-900 dark:text-white">{category}</div>
                        <StatusPill tone="slate" value={category} />
                      </div>
                      <Toggle label="صوت" checked={Boolean(config.sound)} onChange={(value) => onCategoryToggle(category, "sound", value)} />
                      <Toggle label="Toast" checked={Boolean(config.toast)} onChange={(value) => onCategoryToggle(category, "toast", value)} />
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="الصوت والإشعارات" subtitle="Browser control" icon={Volume2}>
                <div className="grid gap-2 md:grid-cols-2">
                  <button type="button" data-testid="sound-unlock-button" data-state={soundUnlocked ? "enabled" : "disabled"} onClick={enableSound} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                    {soundUnlocked ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                    {soundUnlocked ? "الصوت مفعل" : "تفعيل الصوت"}
                  </button>
                  <button type="button" data-testid="browser-notification-button" data-state={browserNotificationPermission} onClick={enableBrowserNotifications} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    <Bell className="h-4 w-4" />
                    {browserNotificationPermission === "granted" ? "إشعارات المتصفح مفعلة" : "تفعيل إشعارات المتصفح"}
                  </button>
                </div>
              </Card>

              <Card title="ملخص سريع" subtitle="Quick stats" icon={Megaphone}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-950 p-4 text-white">
                    <div className="text-xs font-black text-white/60">إشعارات غير مقروءة</div>
                    <div className="mt-1 text-3xl font-black">{formatNumber(unreadCount || notificationsUnread)}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 text-slate-900 dark:bg-white/[0.03] dark:text-white">
                    <div className="text-xs font-black text-slate-400">صلاحيات</div>
                    <div className="mt-1 text-sm font-semibold leading-6">{(me?.permissions || []).length ? `${formatNumber(me.permissions.length)} permission(s)` : "لا توجد صلاحيات ظاهرة"}</div>
                  </div>
                </div>
              </Card>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <Card title="الإشعارات" subtitle="Live feed" icon={Bell} className="min-h-[18rem]">
            <div data-testid="notifications-panel" />
            <div className="space-y-2">
              {notifications.length ? notifications.slice(0, 8).map((item) => (
                <button key={item.id} type="button" data-testid={`notification-${item.id}`} onClick={() => void markNotificationRead(item.id)} className={`w-full rounded-2xl border px-3 py-3 text-right transition ${item.is_read ? "border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300" : "border-sky-200 bg-sky-50 text-slate-950 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black">{item.title || item.type || "Notification"}</div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold opacity-80">{item.message || item.body || ""}</div>
                    </div>
                    <StatusPill tone={item.is_read ? "slate" : "blue"} value={item.category || "system"} />
                  </div>
                </button>
              )) : <EmptyState title="لا توجد إشعارات" body="ستظهر هنا الإشعارات الحية عند وصولها." />}
            </div>
          </Card>

          <Card title="AI + alerts" subtitle="Right rail" icon={Bot}>
            <div className="space-y-2">
              {aiInsights.slice(0, 4).map((insight, index) => (
                <div key={`${insight.title || index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-sky-600/70">{insight.type || "insight"}</div>
                  <div className="mt-1 font-black text-slate-950 dark:text-white">{insight.title || "-"}</div>
                  <div className="mt-1">{insight.body || "-"}</div>
                </div>
              ))}
              {!aiInsights.length ? <EmptyState title="لا توجد رؤى" body="إذا لم توجد بيانات حقيقية فلن نضيف افتراضات." /> : null}
            </div>
          </Card>

          <Card title="AI leads" subtitle="Hot leads" icon={Store}>
            <div className="space-y-2">
              {dashboard?.new_leads?.length ? dashboard.new_leads.map((lead) => (
                <div key={lead.session_id} className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold leading-6 text-rose-900 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100">
                  <div className="font-black">{lead.ai_insight || lead.session_id}</div>
                  <div className="mt-1 text-xs font-bold opacity-80">Score {formatNumber(lead.lead_score || 0)}</div>
                </div>
              )) : <EmptyState title="لا توجد leads ساخنة" body="سيظهر هنا المصدر الحقيقي عند توفره." />}
            </div>
          </Card>

          <Card title="المخزون السريع" subtitle="Low stock" icon={Package}>
            <div className="space-y-2">
              {lowStock.length ? lowStock.slice(0, 5).map((item) => (
                <div key={`${item.id}-${item.name}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                  <div className="font-black">{item.name || "-"}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">{item.color || item.size || ""} · {formatNumber(item.stock || 0)}</div>
                </div>
              )) : <EmptyState title="لا توجد عناصر منخفضة" body="لن نعرض مخزونًا منخفضًا غير موجود في المصدر." />}
            </div>
          </Card>
        </aside>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl rounded-[1.6rem] border border-white/60 bg-white/95 p-2 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/90 lg:hidden">
        <div className="grid grid-cols-6 gap-1">
          {TABS.map((tab) => {
            const active = activeTab === tab;
            const label = tab === "today" ? "اليوم" : tab === "staff" ? "الطاقم" : tab === "tasks" ? "المهام" : tab === "sales" ? "المبيعات" : tab === "chat" ? "الشات" : "المزيد";
            const icon = tab === "today" ? Store : tab === "staff" ? Users : tab === "tasks" ? ClipboardList : tab === "sales" ? ShoppingCart : tab === "chat" ? MessageSquare : Bell;
            const Icon = icon;
            return (
              <button key={tab} type="button" data-testid={`tab-${tab}`} onClick={() => setActiveTab(tab)} className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-black ${active ? "bg-slate-950 text-white" : "text-slate-500 dark:text-slate-300"}`}>
                <Icon className="h-4 w-4" />
                <span className="inline-flex items-center gap-1">
                  {label}
                  {tab === "more" && unreadCount > 0 ? <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">{formatNumber(unreadCount)}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </main>
  );
}

function SendIconFallback() {
  return <ChevronLeftIcon />;
}

function ChevronLeftIcon() {
  return <ChevronRight className="h-4 w-4 rotate-180" />;
}
