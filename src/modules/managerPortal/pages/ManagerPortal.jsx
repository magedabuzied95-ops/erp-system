import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { io as createSocket } from "socket.io-client";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  Bot,
  Building2,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MessageSquare,
  Megaphone,
  Medal,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Shield,
  ShoppingCart,
  Smartphone,
  Send,
  SquarePen,
  Store,
  SunMedium,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import SharedPortalChat from "../../../shared/chat/SharedPortalChat";
import { formatCurrency } from "../../../shared/lib/currency";
import { SOCKET_URL } from "../../../shared/constants/app";
import { playRealtimeSound, requestBrowserNotificationPermission, unlockRealtimeFeedbackAudio } from "../../../services/realtimeFeedbackService";
import { managerPortalApi } from "../services/managerPortalApi";

const TABS = ["today", "staff", "tasks", "sales", "chat", "more"];
const STORAGE_KEY = "manager.portal.active.tab";
const DEFAULT_NOTIFICATION_SETTINGS = {
  messages: { sound: true, toast: true, push: true },
  tasks: { sound: true, toast: true, push: true },
  attendance: { sound: true, toast: true, push: true },
  sales: { sound: true, toast: true, push: true },
  stock: { sound: true, toast: true, push: true },
  ai_leads: { sound: true, toast: true, push: true },
};
const MANAGER_PORTAL_PWA_VERSION = "20260607";

const isBrowser = () => typeof window !== "undefined";
const isStandaloneApp = () => {
  if (!isBrowser()) return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator?.standalone === true;
};
const isIosDevice = () => {
  if (!isBrowser()) return false;
  return /iphone|ipad|ipod/i.test(window.navigator?.userAgent || "");
};
const pushSupported = () => isBrowser() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const urlBase64ToUint8Array = (base64String = "") => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
};
const uint8ArrayToUrlBase64 = (value) => {
  if (!value) return "";
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const pushSubscriptionUsesKey = (subscription, publicKey = "") => {
  if (!subscription || !publicKey) return false;
  try {
    return uint8ArrayToUrlBase64(subscription.options?.applicationServerKey || null) === String(publicKey).trim();
  } catch {
    return false;
  }
};
const endpointHost = (endpoint = "") => {
  try {
    return new URL(String(endpoint || "")).host;
  } catch {
    return "";
  }
};
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
      push: current.push !== undefined ? Boolean(current.push) : true,
    };
  }
  return next;
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
const formatShortDay = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-EG", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
};
const formatNumber = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));
const normalizeManagerPortalValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => normalizeManagerPortalValue(item));
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeManagerPortalValue(item)]));
  }
  return value;
};
const collectSuspiciousManagerPortalStrings = (value, path = "", results = [], seen = new WeakSet()) => {
  if (typeof value === "string") {
    if (/[\u00D8\u00D9\u00C3\u00C2\u00D0\uFFFD]/.test(value) || /(?:\u0637[\u0621-\u064A]|\u0638[\u0621-\u064A]){2,}/.test(value)) results.push({ path, value });
    return results;
  }
  if (!value || typeof value !== "object") return results;
  if (value instanceof Date) return results;
  if (seen.has(value)) return results;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSuspiciousManagerPortalStrings(item, `${path}[${index}]`, results, seen));
    return results;
  }
  Object.entries(value).forEach(([childKey, item]) => {
    const nextPath = path ? `${path}.${childKey}` : childKey;
    collectSuspiciousManagerPortalStrings(item, nextPath, results, seen);
  });
  return results;
};
const warnSuspiciousManagerPortalPayload = (label, value) => {
  if (!import.meta.env.DEV) return;
  const suspicious = collectSuspiciousManagerPortalStrings(value).slice(0, 20);
  if (!suspicious.length) return;
  console.warn("[manager-portal:mojibake]", {
    label,
    count: suspicious.length,
    samples: suspicious,
  });
};
const portalText = (value, fallback = "-") => {
  const safe = value === undefined || value === null || value === "" ? fallback : value;
  return safe;
};
const normalizeManagerPortalPayload = (label, value) => {
  const normalized = normalizeManagerPortalValue(value);
  warnSuspiciousManagerPortalPayload(label, normalized);
  return normalized;
};
const MANAGER_NOTIFICATION_CATEGORIES = [
  { key: "all", label: "الكل", icon: Bell },
  { key: "employee_chat", label: "رسائل الموظفين", icon: MessageSquare },
  { key: "task_completed", label: "مهام مكتملة", icon: CheckCircle2 },
  { key: "task_overdue", label: "مهام متأخرة", icon: AlertTriangle },
  { key: "attendance", label: "الحضور", icon: Clock3 },
  { key: "sales", label: "المبيعات", icon: ShoppingCart },
  { key: "stock", label: "المخزون", icon: Package },
  { key: "ai_leads", label: "العملاء الساخنون", icon: Bot },
];
const MANAGER_NOTIFICATION_CATEGORY_KEYS = new Set(MANAGER_NOTIFICATION_CATEGORIES.map((item) => item.key));
const normalizeNotificationText = (value = "") => String(value ?? "").toLowerCase().replace(/[\s_-]+/g, "_");
const categoryFromNotification = (notification = {}) => {
  const category = normalizeNotificationText(notification.category || "");
  const type = normalizeNotificationText(notification.type || "");
  const source = `${category} ${type}`;
  if (MANAGER_NOTIFICATION_CATEGORY_KEYS.has(category)) return category;
  if (source.includes("employee_chat") || source.includes("chat") || source.includes("message")) return "employee_chat";
  if (source.includes("task_overdue") || source.includes("overdue")) return "task_overdue";
  if (source.includes("task_completed") || source.includes("task") || source.includes("staff_tasks")) return "task_completed";
  if (source.includes("attendance")) return "attendance";
  if (source.includes("sale") || source.includes("order") || source.includes("payment")) return "sales";
  if (source.includes("stock") || source.includes("inventory") || source.includes("refill") || source.includes("low_stock")) return "stock";
  if (source.includes("lead") || source.includes("ai")) return "ai_leads";
  return "sales";
};
const categoryMeta = (category) => MANAGER_NOTIFICATION_CATEGORIES.find((item) => item.key === category) || MANAGER_NOTIFICATION_CATEGORIES[0];
const notificationTypeLabel = (notification = {}) => {
  const type = normalizeNotificationText(notification.type || "");
  if (type.includes("task_overdue")) return "مهمة متأخرة";
  if (type.includes("task_completed")) return "تم إكمال مهمة";
  if (type.includes("employee") || type.includes("chat") || type.includes("message")) return "رسالة موظف";
  if (type.includes("attendance")) return "الحضور";
  if (type.includes("lead") || type.includes("ai")) return "عميل ساخن";
  if (type.includes("stock") || type.includes("inventory") || type.includes("refill") || type.includes("low_stock")) return "تنبيه مخزون";
  if (type.includes("sale") || type.includes("order") || type.includes("payment")) return "مبيعات";
  return portalText(notification.category || notification.type || "إشعار");
};
const soundForCategory = (category) => {
  if (category === "employee_chat" || category === "task_completed") return "notification";
  if (category === "task_overdue" || category === "stock") return "warning";
  if (category === "attendance") return "attendance";
  if (category === "sales") return "orderNew";
  if (category === "ai_leads") return "aiMessage";
  return "notification";
};
const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;
const normalizeText = (value = "") => String(value ?? "").trim().toLowerCase();
const taskStatusMeta = (task = {}) => {
  const status = normalizeText(task.status || "pending");
  if (status === "completed") return { label: "مكتملة", tone: "green" };
  if (status === "overdue") return { label: "متأخرة", tone: "red" };
  if (status === "manager_review") return { label: "تحتاج مراجعة", tone: "amber" };
  if (status === "in_progress") return { label: "قيد التنفيذ", tone: "blue" };
  if (status === "pending") return { label: "قيد الانتظار", tone: "slate" };
  if (status === "rejected" || status === "cancelled") return { label: status, tone: "red" };
  return { label: status || "قيد الانتظار", tone: "slate" };
};
const taskProofUrl = (task = {}) => task.latest_attachment_url || task.proof_url || task.proof_image_url || task.attachment_url || "";
const taskProofLabel = (task = {}) => task.latest_attachment_name || task.latest_attachment_type || (task.attachments_count ? "مرفق إثبات" : "");

const isLatinText = (value = "") => /[A-Za-z]/.test(String(value || "")) && !/[\u0600-\u06FF]/.test(String(value || ""));
const InlineName = ({ children, className = "" }) => (
  <span dir={isLatinText(children) ? "ltr" : "rtl"} style={{ unicodeBidi: "isolate" }} className={`inline-block ${className}`}>{children}</span>
);
const paymentMethodLabel = (value = "") => {
  const key = normalizeNotificationText(value || "unknown");
  const labels = {
    cash: "كاش",
    card: "بطاقة",
    visa: "فيزا",
    wallet: "محفظة",
    vodafone_cash: "فودافون كاش",
    instapay: "إنستاباي",
    split: "دفع مقسم",
    cod: "الدفع عند الاستلام",
    cash_on_delivery: "الدفع عند الاستلام",
    unknown: "غير محدد",
  };
  return labels[key] || portalText(value || "غير محدد");
};
const insightTitleLabel = (type = "", fallback = "") => {
  const key = normalizeNotificationText(type || fallback);
  if (key.includes("sales") || key.includes("best")) return "الأكثر مبيعاً";
  if (key.includes("inventory") || key.includes("reorder")) return "مطلوب إعادة طلب";
  if (key.includes("branch")) return "أفضل فرع";
  if (key.includes("timing") || key.includes("hour")) return "أكثر ساعة مبيعاً";
  return "رؤية تشغيلية";
};
const renderInsightBody = (item = {}) => {
  const type = normalizeNotificationText(item.type || item.title || "");
  const productName = item.productName || item.product_name || item.name || item.product || "";
  const branchName = item.branchName || item.branch_name || item.branch || "";
  const units = item.units || item.quantity || item.sold_units || "";
  const stock = item.stock || item.current_stock || "";
  const hour = item.hour || item.peak_hour || "";
  if (type.includes("sales") || type.includes("best")) {
    const name = productName || String(item.body || "").split(" leads with ")[0] || "منتج";
    const count = units || String(item.body || "").match(/(\d+)\s+units/)?.[1] || 0;
    return <>الأكثر مبيعاً: <InlineName>{name}</InlineName> باع {formatNumber(count)} قطعة خلال آخر ٣٠ يوم.</>;
  }
  if (type.includes("inventory") || type.includes("reorder")) {
    const name = productName || String(item.body || "").split(" is at ")[0] || "منتج";
    const count = stock || String(item.body || "").match(/(\d+)\s+units/)?.[1] || 0;
    return <>مطلوب إعادة طلب: <InlineName>{name}</InlineName> وصل إلى {formatNumber(count)} قطعة.</>;
  }
  if (type.includes("branch")) {
    const name = branchName || String(item.body || "").split(" is the ")[0] || "الفرع";
    return <><InlineName>{name}</InlineName> هو الأعلى مبيعاً.</>;
  }
  if (type.includes("timing") || type.includes("hour")) {
    const peak = hour || String(item.body || "").match(/(\d{1,2}:00)/)?.[1] || "-";
    return <>أكثر ساعة مبيعاً حالياً: <span dir="ltr" className="inline-block">{peak}</span>.</>;
  }
  return portalText(item.body || "-");
};
const leadIdentity = (lead = {}) =>
  [
    lead.customer_id,
    lead.customer_phone,
    lead.customer_name,
    lead.session_id,
    lead.conversation_id,
    lead.id,
    lead.lead_score,
  ].filter(Boolean).join(":") || JSON.stringify(lead);
const leadName = (lead = {}) => portalText(lead.customer_name || lead.name || lead.contact_name || "عميل محتمل");
const leadChannel = (lead = {}) => portalText(lead.channel || lead.platform || lead.source || "قناة غير محددة");
const leadPreview = (lead = {}) => portalText(lead.last_message || lead.last_message_preview || lead.ai_insight || "لا توجد رسالة أخيرة");

const Badge = ({ children, className = "" }) => (
  <span className={`inline-flex items-center rounded-full border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] px-2.5 py-1 text-[11px] font-black text-slate-700 ${className}`}>{children}</span>
);

const Card = ({ title, subtitle, icon: Icon, children, action, className = "", bodyClassName = "", compact = false }) => (
  <section className={`overflow-hidden rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] shadow-[0_14px_36px_rgba(15,23,42,0.08)] ${compact ? "p-3" : "p-4"} ${className}`}>
    <div className="h-1 w-full bg-gradient-to-r from-slate-900 via-indigo-700 to-amber-400" />
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{subtitle}</div>
        <h2 className="mt-1 text-base font-black text-slate-950">{title}</h2>
      </div>
      {Icon ? <div className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-700 shadow-sm"><Icon className="h-4 w-4" /></div> : null}
    </div>
    {action ? <div className="mt-3">{action}</div> : null}
    <div className={`mt-3 ${bodyClassName}`}>{children}</div>
  </section>
);

const MiniMetric = ({ label, value, icon: Icon, tone = "slate", sub = "" }) => {
  const tones = {
    slate: "border-t-slate-400",
    green: "border-t-emerald-500",
    cyan: "border-t-sky-500",
    amber: "border-t-amber-500",
    red: "border-t-rose-500",
    blue: "border-t-blue-500",
  };
  return (
    <div className={`kpi-card-readable min-h-[6.25rem] rounded-3xl border border-slate-200 border-t-4 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-3 shadow-[0_12px_28px_rgba(15,23,42,0.08)] ${tones[tone] || tones.slate}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-black leading-5 text-slate-500">{label}</div>
          <div className="mt-1 text-[1.9rem] font-black leading-none tracking-tight text-slate-950 sm:text-[2.05rem]">{value || formatNumber(0)}</div>
          {sub ? <div className="mt-0.5 truncate text-[11px] font-bold text-slate-500">{sub}</div> : null}
        </div>
        {Icon ? <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm"><Icon className="h-4 w-4" /></div> : null}
      </div>
    </div>
  );
};

const Toggle = ({ label, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-right transition ${
      checked
        ? "border-emerald-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] text-emerald-900 shadow-sm dark:border-emerald-400/20 dark:bg-white/[0.03] dark:text-emerald-100"
        : "border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200"
    }`}
  >
    <span className="text-sm font-black">{label}</span>
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${checked ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-700 dark:bg-white dark:text-slate-950"}`}>
      {checked ? "On" : "Off"}
    </span>
  </button>
);

const StatusPill = ({ value, tone = "slate" }) => {
  const tones = {
    slate: "border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100",
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100",
    red: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-100",
    blue: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-100",
  };
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${tones[tone] || tones.slate}`}>{value}</span>;
};

const EmptyState = ({ title, body, compact = false }) => (
  <div className={`rounded-2xl border border-dashed border-slate-300 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] text-right font-semibold leading-6 text-slate-500 shadow-sm ${compact ? "px-3 py-3 text-xs" : "px-4 py-5 text-sm"}`}>
    <div className="font-black text-slate-800">{title}</div>
    <div className="mt-1">{body}</div>
  </div>
);

export default function ManagerPortal() {
  const navigate = useNavigate();
  const { token } = useParams();
  const [searchParams] = useSearchParams();
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
  const [inventoryApprovals, setInventoryApprovals] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [managerChatState, setManagerChatState] = useState({ employee: null, thread: null, messages: [] });
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskDraft, setTaskDraft] = useState({ title: "", description: "", assigned_employee_id: "", priority: "medium" });
  const [taskNotes, setTaskNotes] = useState({});
  const [taskFilters, setTaskFilters] = useState({ status: "all", employee: "", query: "" });
  const [settings, setSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() => (isBrowser() && "Notification" in window ? window.Notification.permission : "unsupported"));
  const [pushState, setPushState] = useState(() => ({
    supported: pushSupported(),
    permission: isBrowser() && "Notification" in window ? window.Notification.permission : "unsupported",
    subscribed: false,
    endpointHost: "",
    saving: false,
    message: "",
  }));
  const [standalone, setStandalone] = useState(() => isStandaloneApp());
  const [installPrompt, setInstallPrompt] = useState(null);
  const [invoiceSheet, setInvoiceSheet] = useState({ open: false, loading: false, invoice: null, error: "" });
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const [showMoreNotifications, setShowMoreNotifications] = useState(false);
  const [showMoreAiInsights, setShowMoreAiInsights] = useState(false);
  const [showMoreLeads, setShowMoreLeads] = useState(false);
  const [showMoreLowStock, setShowMoreLowStock] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationCategory, setNotificationCategory] = useState("all");
  const socketRef = useRef(null);
  const notificationPanelRef = useRef(null);
  const notificationButtonRef = useRef(null);
  const selectedTabRef = useRef(activeTab);
  const settingsRef = useRef(settings);
  const browserNotificationPermissionRef = useRef(browserNotificationPermission);
  const openedInvoiceQueryRef = useRef("");

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

  useEffect(() => {
    const queryTab = searchParams.get("tab");
    if (queryTab && TABS.includes(queryTab) && queryTab !== activeTab) {
      setActiveTab(queryTab);
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    browserNotificationPermissionRef.current = browserNotificationPermission;
  }, [browserNotificationPermission]);

  useEffect(() => {
    if (!notificationsOpen || !isBrowser()) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [notificationsOpen]);

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
  const queryEmployeeId = searchParams.get("employee_id") || searchParams.get("employeeId") || "";
  const managerChatApiAdapter = useMemo(() => ({
    listThreads: () => managerPortalApi.chat(token),
    getThread: (threadId) => managerPortalApi.chatThread(token, threadId),
    sendMessage: (threadId, formData) => managerPortalApi.sendChatMessage(token, threadId, formData),
    markRead: (threadId) => managerPortalApi.markChatRead(token, threadId),
    emitTyping: (payload) => socketRef.current?.emit?.("employee-chat:typing", payload),
    emitStopTyping: (payload) => socketRef.current?.emit?.("employee-chat:stop-typing", payload),
  }), [token]);
  const taskList = tasks?.tasks || [];
  const taskCounts = useMemo(() => ({
    open: taskList.filter((task) => ["pending", "in_progress", "manager_review", "reassigned"].includes(normalizeText(task.status)) || Boolean(task.is_overdue && normalizeText(task.status) !== "completed")).length,
    completed: taskList.filter((task) => normalizeText(task.status) === "completed").length,
    overdue: taskList.filter((task) => normalizeText(task.status) === "overdue" || Boolean(task.is_overdue)).length,
  }), [taskList]);
  const employeeFilterOptions = useMemo(() => {
    const seen = new Map();
    for (const task of taskList) {
      const key = String(task.current_assignee_id || task.assigned_employee_id || task.employee_id || "");
      const label = portalText(task.assignee_name || task.employee_name || task.employee_code || "Employee");
      if (!key && !label) continue;
      if (!seen.has(key || label)) seen.set(key || label, label);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [taskList]);
  const filteredTasks = useMemo(() => taskList.filter((task) => {
    const status = normalizeText(task.status);
    const employeeId = String(task.current_assignee_id || task.assigned_employee_id || task.employee_id || "");
    const employeeName = normalizeText(portalText(task.assignee_name || task.employee_name || task.employee_code || ""));
    const query = normalizeText(taskFilters.query);
    const matchesQuery = !query || [task.title, task.title_ar, task.description, task.description_ar, task.branch_name, task.assignee_name, task.employee_name].some((value) => normalizeText(portalText(value)).includes(query));
    const matchesEmployee = !taskFilters.employee || employeeId === taskFilters.employee || employeeName.includes(normalizeText(taskFilters.employee));
    const matchesStatus = taskFilters.status === "all" || (taskFilters.status === "open" ? ["pending", "in_progress", "manager_review", "reassigned"].includes(status) || Boolean(task.is_overdue && status !== "completed") : taskFilters.status === "completed" ? status === "completed" : taskFilters.status === "overdue" ? status === "overdue" || Boolean(task.is_overdue) : status === taskFilters.status);
    return matchesQuery && matchesEmployee && matchesStatus;
  }), [taskList, taskFilters]);
  const openTasks = useMemo(() => filteredTasks.filter((task) => ["pending", "in_progress", "manager_review", "reassigned"].includes(normalizeText(task.status)) || Boolean(task.is_overdue && normalizeText(task.status) !== "completed")), [filteredTasks]);
  const completedTasks = useMemo(() => filteredTasks.filter((task) => normalizeText(task.status) === "completed"), [filteredTasks]);
  const overdueTasks = useMemo(() => filteredTasks.filter((task) => normalizeText(task.status) === "overdue" || Boolean(task.is_overdue)), [filteredTasks]);
  const paymentBreakdown = dashboard?.payment_breakdown || [];
  const lowStock = dashboard?.low_stock || stockAlerts?.low_stock || [];
  const refillAlerts = dashboard?.refill_alerts || stockAlerts?.refill_alerts || [];
  const inventoryApprovalsSummary = inventoryApprovals?.summary || {};
  const pendingInventoryApprovalsCount = Number(inventoryApprovalsSummary.pending_review_count || 0);
  const aiInsights = dashboard?.ai_insights || sales?.ai_insights || [];
  const topProducts = sales?.top_products || [];
  const salesComparison = sales?.comparison || {};
  const salesLeaders = sales?.leaders || {};
  const trend7d = Array.isArray(sales?.trend_7d) ? sales.trend_7d : Array.isArray(sales?.trend) ? sales.trend : [];
  const bestCategory = sales?.best_category || null;
  const bestBrand = sales?.best_brand || null;
  const conversionIndicators = sales?.conversion_indicators || {};
  const hasConversionIndicators =
    Number(conversionIndicators.customer_linked_orders || 0) > 0 ||
    Number(conversionIndicators.online_orders || 0) > 0 ||
    Number(conversionIndicators.ai_sessions || 0) > 0 ||
    Number(conversionIndicators.ai_confirmed_orders || 0) > 0;
  const operationalEvents = useMemo(() => {
    const events = [];
    const pushEvent = (event) => {
      if (!event?.timestamp) return;
      events.push(event);
    };
    for (const row of Array.isArray(dashboard?.task_history) ? dashboard.task_history : []) {
      const action = normalizeText(row.action || "");
      const toStatus = normalizeText(row.to_status || "");
      const fromStatus = normalizeText(row.from_status || "");
      const title =
        action.includes("assign") ? "تم إسناد مهمة" :
        action.includes("reassign") ? "تمت إعادة إسناد مهمة" :
        action.includes("complete") || toStatus === "completed" ? "تم إكمال مهمة" :
        action.includes("approve") ? "تم اعتماد مهمة" :
        toStatus === "overdue" || fromStatus === "overdue" || action.includes("overdue") ? "مهمة متأخرة" :
        "تم تحديث مهمة";
      pushEvent({
        key: `task-${row.id || `${row.task_id || "task"}-${row.created_at || ""}`}`,
        kind: "task",
        timestamp: row.created_at || row.updated_at || null,
        title: portalText(title),
        detail: [portalText(row.actor_name || "النظام"), portalText(row.employee_name || row.to_employee_name || ""), portalText(row.note || "")].filter(Boolean).join(" · "),
        tone: toStatus === "completed" || action.includes("complete") ? "green" : toStatus === "overdue" || action.includes("overdue") ? "red" : "blue",
      });
    }
    for (const row of Array.isArray(dashboard?.overview?.recentInvoices) ? dashboard.overview.recentInvoices : []) {
      pushEvent({
        key: `invoice-${row.id || row.invoice_number || row.created_at || ""}`,
        kind: "invoice",
        invoiceId: row.id,
        invoice: row,
        timestamp: row.created_at || null,
        title: portalText(`فاتورة ${row.invoice_number || row.id || ""}`.trim()),
        detail: [portalText(row.customer_name || "Walk-in"), formatCurrency(row.total || 0)].filter(Boolean).join(" · "),
        tone: "green",
      });
    }
    for (const row of Array.isArray(refillAlerts) ? refillAlerts : []) {
      pushEvent({
        key: `refill-${row.id || row.created_at || ""}`,
        kind: "stock",
        timestamp: row.created_at || null,
        title: portalText("إعادة عرض منتج"),
        detail: [portalText(row.product_name || "Refill alert"), [portalText(row.color_name || row.color || ""), portalText(row.replacement_size || "")].filter(Boolean).join(" · ")].filter(Boolean).join(" · "),
        tone: "amber",
      });
    }
    for (const row of Array.isArray(dashboard?.new_leads) ? dashboard.new_leads : []) {
      pushEvent({
        key: `lead-${row.session_id || row.id || row.updated_at || ""}`,
        kind: "lead",
        timestamp: row.updated_at || row.created_at || null,
        title: portalText("عميل ساخن"),
        detail: [portalText(row.ai_insight || row.session_id || "عميل محتمل"), `الدرجة ${formatNumber(row.lead_score || 0)}`].filter(Boolean).join(" · "),
        tone: "red",
      });
    }
    return events
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  }, [dashboard, refillAlerts]);
  const managerNotifications = useMemo(() => notifications.map((item) => ({ ...item, manager_category: categoryFromNotification(item) })), [notifications]);
  const filteredManagerNotifications = useMemo(() => (
    notificationCategory === "all"
      ? managerNotifications
      : managerNotifications.filter((item) => item.manager_category === notificationCategory)
  ), [managerNotifications, notificationCategory]);
  const notificationCategoryCounts = useMemo(() => {
    const counts = Object.fromEntries(MANAGER_NOTIFICATION_CATEGORIES.map((item) => [item.key, 0]));
    for (const item of managerNotifications) {
      if (counts[item.manager_category] !== undefined) counts[item.manager_category] += 1;
    }
    return counts;
  }, [managerNotifications]);
  const employeeMessageNotifications = useMemo(() => managerNotifications.filter((item) => item.manager_category === "employee_chat"), [managerNotifications]);
  const dedupedLeads = useMemo(() => {
    const seen = new Set();
    return (dashboard?.new_leads || []).filter((lead) => {
      const key = leadIdentity(lead);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [dashboard?.new_leads]);
  const visibleNotifications = showMoreNotifications ? filteredManagerNotifications : filteredManagerNotifications.slice(0, 5);
  const visibleLiveFeed = managerNotifications.slice(0, 5);
  const hasMoreNotifications = filteredManagerNotifications.length > visibleNotifications.length;
  const showInstallCard = !standalone && (Boolean(installPrompt) || isIosDevice());
  const visibleAiInsights = showMoreAiInsights ? aiInsights : aiInsights.slice(0, 3);
  const hasMoreAiInsights = aiInsights.length > visibleAiInsights.length;
  const visibleLeads = showMoreLeads ? dedupedLeads : dedupedLeads.slice(0, 3);
  const hasMoreLeads = dedupedLeads.length > visibleLeads.length;
  const visibleLowStock = showMoreLowStock ? lowStock : lowStock.slice(0, 3);
  const hasMoreLowStock = lowStock.length > visibleLowStock.length;
  const selectedChatThread = managerChatState.thread || null;
  const selectedChatEmployee = useMemo(() => {
    if (managerChatState.employee) return managerChatState.employee;
    const chatEmployeeId = selectedChatThread?.employee_id ? String(selectedChatThread.employee_id) : "";
    if (!chatEmployeeId) return null;
    const staffEmployee = staffList.find((employee) => String(employee.employee_id || employee.id) === chatEmployeeId) || null;
    return staffEmployee
      ? {
        ...selectedChatThread,
        ...staffEmployee,
        employee_name: portalText(selectedChatThread?.employee_name || staffEmployee.employee_name || staffEmployee.full_name || "Employee"),
        employee_code: portalText(selectedChatThread?.employee_code || staffEmployee.employee_code || ""),
        branch_name: portalText(selectedChatThread?.branch_name || staffEmployee.branch_name || ""),
      }
      : selectedChatThread;
  }, [managerChatState.employee, selectedChatThread, staffList]);
  const selectedChatLastActivity = selectedChatEmployee?.last_activity || selectedChatThread?.last_message_created_at || selectedChatThread?.updated_at || selectedChatThread?.last_message_at || null;
  const selectedChatAttendanceStatus = selectedChatEmployee?.attendance_status || "absent";
  const selectedChatAttendanceTone = selectedChatAttendanceStatus === "checked_in" ? "green" : selectedChatAttendanceStatus === "online" ? "blue" : selectedChatAttendanceStatus === "late" ? "amber" : "slate";
  const selectedChatSalesTotal = Number(selectedChatEmployee?.sales_today || 0);
  const selectedChatOpenTasks = Number(selectedChatEmployee?.open_tasks || 0);
  const selectedChatInvoices = Number(selectedChatEmployee?.invoices_count || 0);
  const selectedChatLateMinutes = Number(selectedChatEmployee?.late_minutes || 0);
  const selectedChatShiftHours = Number(selectedChatEmployee?.shift_duration_hours || 0);
  const selectedChatCheckIn = selectedChatEmployee?.check_in_time || null;
  const selectedChatCheckOut = selectedChatEmployee?.check_out_time || null;
  const selectedChatUnread = Number(selectedChatThread?.unread_count || 0);

  const categoryEnabled = (category, key) => Boolean(settings?.[category]?.[key]);

  const notifyClient = async (notification) => {
    const category = categoryFromNotification(notification);
    const enabled = settingsRef.current?.[category] || DEFAULT_NOTIFICATION_SETTINGS[category] || DEFAULT_NOTIFICATION_SETTINGS.messages;
    const title = notification.title || "Notification";
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
    if (browserNotificationPermissionRef.current === "granted" && "Notification" in window) {
      try {
        new window.Notification(title, { body: message || "" });
      } catch {
        // Browser notification is optional.
      }
    }
  };

  const upsertNotification = (next) => {
    if (!next?.id) return;
    const normalizedNext = normalizeManagerPortalValue(next);
    setNotifications((current) => {
      const exists = current.some((item) => String(item.id) === String(normalizedNext.id));
      if (!exists && !normalizedNext.is_read) setUnreadCount((count) => count + 1);
      return [normalizedNext, ...current.filter((item) => String(item.id) !== String(normalizedNext.id))].slice(0, 50);
    });
  };

  const loadAll = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setRefreshing(Boolean(silent));
      setError("");
      const [meRes, dashboardRes, staffRes, tasksRes, salesRes, stockRes, notificationsRes, approvalsRes] = await Promise.all([
        managerPortalApi.me(token),
        managerPortalApi.dashboard(token),
        managerPortalApi.staff(token),
        managerPortalApi.tasks(token),
        managerPortalApi.sales(token),
        managerPortalApi.stockAlerts(token),
        managerPortalApi.notifications(token, { limit: 40 }),
        managerPortalApi.inventoryApprovals(token, { limit: 5 }),
      ]);
      setMe(normalizeManagerPortalPayload("me", meRes?.manager || meRes?.data?.manager || null));
      setDashboard(normalizeManagerPortalPayload("dashboard", dashboardRes?.dashboard || null));
      setStaff(normalizeManagerPortalPayload("staff", staffRes?.staff || null));
      setTasks(normalizeManagerPortalPayload("tasks", tasksRes?.tasks || null));
      setSales(normalizeManagerPortalPayload("sales", salesRes?.sales || null));
      setStockAlerts(normalizeManagerPortalPayload("stockAlerts", stockRes?.stockAlerts || null));
      setNotifications(normalizeManagerPortalPayload("notifications", Array.isArray(notificationsRes?.notifications) ? notificationsRes.notifications : []));
      setUnreadCount(Number(notificationsRes?.unread_count || 0));
      setSettings(mergeSettings(normalizeManagerPortalPayload("settings", notificationsRes?.settings || meRes?.notification_settings || {})));
      setInventoryApprovals(normalizeManagerPortalPayload("inventoryApprovals", approvalsRes?.inventoryApprovals || null));
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
    navigator.serviceWorker.register(`/employee-portal-sw.js?v=${MANAGER_PORTAL_PWA_VERSION}`).catch(() => null);
    return undefined;
  }, []);

  useEffect(() => {
    if (!isBrowser() || !token) return undefined;
    const previousManifests = Array.from(document.querySelectorAll('link[rel="manifest"]')).map((item) => ({
      href: item.getAttribute("href") || "",
    }));
    document.querySelectorAll('link[rel="manifest"]').forEach((item) => item.remove());
    const link = document.createElement("link");
    link.setAttribute("rel", "manifest");
    link.setAttribute("href", `/api/manager-portal/${encodeURIComponent(token)}/manifest.webmanifest?v=${encodeURIComponent(token)}`);
    link.setAttribute("data-manager-portal-manifest", "true");
    document.head.appendChild(link);
    window.localStorage?.setItem("manager_portal_last_url", `/manager-portal/${encodeURIComponent(token)}${window.location.search || ""}`);

    const previousTitle = document.title;
    const previousAppleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") || "";
    let appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!appleTitle) {
      appleTitle = document.createElement("meta");
      appleTitle.setAttribute("name", "apple-mobile-web-app-title");
      document.head.appendChild(appleTitle);
    }
    appleTitle.setAttribute("content", "Manager");
    document.title = "M1 Manager Portal";

    return () => {
      link.remove();
      if (!window.location.pathname.startsWith("/manager-portal/")) {
        previousManifests.forEach((item) => {
          if (!item.href) return;
          const restored = document.createElement("link");
          restored.setAttribute("rel", "manifest");
          restored.setAttribute("href", item.href);
          document.head.appendChild(restored);
        });
      }
      document.title = previousTitle || "M1 Manager Portal";
      appleTitle?.setAttribute("content", previousAppleTitle || "Manager");
    };
  }, [token]);

  useEffect(() => {
    if (!isBrowser()) return undefined;
    const media = window.matchMedia?.("(display-mode: standalone)");
    const updateStandalone = () => setStandalone(isStandaloneApp());
    updateStandalone();
    media?.addEventListener?.("change", updateStandalone);
    window.addEventListener("appinstalled", updateStandalone);
    return () => {
      media?.removeEventListener?.("change", updateStandalone);
      window.removeEventListener("appinstalled", updateStandalone);
    };
  }, []);

  useEffect(() => {
    if (!isBrowser()) return undefined;
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  useEffect(() => {
    if (!isBrowser()) return undefined;
    const socket = createSocket(SOCKET_URL, {
      transports: ["websocket"],
      auth: { managerPortalToken: token },
    });
    socketRef.current = socket;

    socket.on("notification:new", (payload) => {
      const next = payload || {};
      upsertNotification(next);
      void notifyClient(next);
    });
    socket.on("notification:count:refresh", () => {
      Promise.all([
        managerPortalApi.notifications(token, { limit: 40 }),
        managerPortalApi.inventoryApprovals(token, { limit: 5 }),
      ]).then(([response, approvalsResponse]) => {
        setNotifications(normalizeManagerPortalPayload("socketNotifications", Array.isArray(response?.notifications) ? response.notifications : []));
        setUnreadCount(Number(response?.unread_count || 0));
        setInventoryApprovals(normalizeManagerPortalPayload("socketApprovals", approvalsResponse?.inventoryApprovals || null));
      }).catch(() => null);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const reloadTabData = async (tab = activeTab) => {
    try {
      if (tab === "today") {
        const [dashboardRes, notificationsRes, stockRes] = await Promise.all([
          managerPortalApi.dashboard(token),
          managerPortalApi.notifications(token, { limit: 40 }),
          managerPortalApi.stockAlerts(token),
        ]);
        setDashboard(normalizeManagerPortalPayload("dashboardReload", dashboardRes?.dashboard || null));
        setNotifications(normalizeManagerPortalPayload("notificationsReload", Array.isArray(notificationsRes?.notifications) ? notificationsRes.notifications : []));
        setUnreadCount(Number(notificationsRes?.unread_count || 0));
        setSettings(mergeSettings(normalizeManagerPortalPayload("settingsReload", notificationsRes?.settings || me?.notification_settings || {})));
        setStockAlerts(normalizeManagerPortalPayload("stockAlertsReload", stockRes?.stockAlerts || null));
      }
      if (tab === "staff") {
        const response = await managerPortalApi.staff(token);
        setStaff(normalizeManagerPortalPayload("staffReload", response?.staff || null));
      }
      if (tab === "tasks") {
        const response = await managerPortalApi.tasks(token);
        setTasks(normalizeManagerPortalPayload("tasksReload", response?.tasks || null));
      }
      if (tab === "sales") {
        const response = await managerPortalApi.sales(token);
        setSales(normalizeManagerPortalPayload("salesReload", response?.sales || null));
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

  const markAllNotificationsRead = async () => {
    if (!notifications.some((item) => !item.is_read)) return;
    const previous = notifications;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => (item.is_read ? item : { ...item, is_read: true, read_at: item.read_at || readAt })));
    setUnreadCount(0);
    try {
      await managerPortalApi.markAllNotificationsRead(token);
      await reloadTabData("today");
    } catch (readError) {
      setNotifications(previous);
      toast.error(readError?.responseBody?.message || readError?.message || "تعذر تحديث الإشعارات");
    }
  };

  const openNotification = async (notification) => {
    if (!notification?.id) return;
    await markNotificationRead(notification.id);
    setNotificationsOpen(false);
    const invoiceId = notification.metadata?.order_id || notification.metadata?.invoice_id || notification.entity_id;
    if (categoryFromNotification(notification) === "sales" && invoiceId) {
      await openInvoiceDetail(invoiceId);
      return;
    }
    if (categoryFromNotification(notification) === "employee_chat") {
      setActiveTab("chat");
      return;
    }
    if (notification.action_url) navigate(notification.action_url);
  };

  const openInvoiceDetail = async (invoiceId) => {
    if (!invoiceId) return;
    setInvoiceSheet({ open: true, loading: true, invoice: null, error: "" });
    try {
      const response = await managerPortalApi.invoice(token, invoiceId);
      setInvoiceSheet({ open: true, loading: false, invoice: normalizeManagerPortalPayload("invoice", response?.invoice || null), error: "" });
    } catch (invoiceError) {
      setInvoiceSheet({ open: true, loading: false, invoice: null, error: invoiceError?.responseBody?.message || invoiceError?.message || "تعذر تحميل الفاتورة" });
    }
  };

  useEffect(() => {
    const invoiceId = searchParams.get("invoice_id") || searchParams.get("invoiceId") || "";
    const shouldOpen = searchParams.get("open_invoice") === "1" || searchParams.get("openInvoice") === "1";
    const key = `${token}:${invoiceId}`;
    if (!token || !invoiceId || !shouldOpen || openedInvoiceQueryRef.current === key) return;
    openedInvoiceQueryRef.current = key;
    setActiveTab("sales");
    void openInvoiceDetail(invoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, token]);

  const copyText = async (value, successMessage = "تم النسخ") => {
    if (!value) return;
    try {
      await window.navigator?.clipboard?.writeText(String(value));
      toast.success(successMessage);
    } catch {
      toast.error("تعذر النسخ");
    }
  };

  const openWhatsappShare = (invoice = {}) => {
    const phone = String(invoice.customer_phone || "").replace(/[^\d+]/g, "");
    if (!phone) return;
    const message = encodeURIComponent(`فاتورتك من M1: ${invoice.public_invoice_url || invoice.invoice_number || ""}`);
    window.open(`https://wa.me/${phone.replace(/^\+/, "")}?text=${message}`, "_blank", "noopener,noreferrer");
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

  const refreshPushState = async () => {
    const supported = pushSupported();
    const permission = isBrowser() && "Notification" in window ? window.Notification.permission : "unsupported";
    console.info("[manager-push:permission]", {
      token,
      permission,
      supported,
      standalone,
    });
    if (!supported) {
      setPushState((current) => ({ ...current, supported: false, permission, subscribed: false, endpointHost: "" }));
      return null;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setPushState((current) => ({
        ...current,
        supported: true,
        permission,
        subscribed: Boolean(subscription),
        endpointHost: endpointHost(subscription?.endpoint || ""),
      }));
      return subscription;
    } catch {
      setPushState((current) => ({ ...current, supported, permission, subscribed: false, endpointHost: "" }));
      return null;
    }
  };

  const enablePushNotifications = async () => {
    if (!pushSupported()) {
      setPushState((current) => ({ ...current, supported: false, message: "هذا المتصفح لا يدعم Web Push." }));
      toast.error("هذا المتصفح لا يدعم Web Push");
      return;
    }
    setPushState((current) => ({ ...current, saving: true, message: "" }));
    try {
      const permission = await window.Notification.requestPermission();
      setBrowserNotificationPermission(permission);
      console.info("[manager-push:permission]", {
        token,
        permission,
        supported: true,
        standalone,
      });
      if (permission !== "granted") {
        setPushState((current) => ({ ...current, permission, saving: false, message: "تم رفض إذن الإشعارات." }));
        toast.error("لم يتم منح إذن الإشعارات");
        return;
      }
      const keyResponse = await managerPortalApi.pushPublicKey(token);
      const publicKey = keyResponse?.publicKey || "";
      if (!publicKey || keyResponse?.enabled === false) throw new Error("Web Push is not configured on the server");
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !pushSubscriptionUsesKey(subscription, publicKey)) {
        await subscription.unsubscribe().catch(() => null);
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      console.info("[manager-push:subscription-created]", {
        token,
        endpoint_start: String(subscription.endpoint || "").slice(0, 64),
        endpoint_host: endpointHost(subscription.endpoint),
        permission,
        application_server_key_length: publicKey.length,
      });
      const saveResponse = await managerPortalApi.subscribePush(token, {
        subscription: subscription.toJSON(),
        application_server_key_length: publicKey.length,
        portal_url: window.location.href,
      });
      console.info("[manager-push:subscription-saved]", {
        token,
        endpoint_start: String(subscription.endpoint || "").slice(0, 64),
        endpoint_host: endpointHost(subscription.endpoint),
        response_status: saveResponse?.__status || 201,
        subscription_id: saveResponse?.subscription?.id || null,
      });
      setPushState({
        supported: true,
        permission: "granted",
        subscribed: true,
        endpointHost: endpointHost(subscription.endpoint),
        saving: false,
        message: "تم تفعيل Push Notifications.",
      });
      toast.success("تم تفعيل Push Notifications");
    } catch (pushError) {
      setPushState((current) => ({ ...current, saving: false, message: pushError?.responseBody?.message || pushError?.message || "تعذر تفعيل Push Notifications" }));
      toast.error(pushError?.responseBody?.message || pushError?.message || "تعذر تفعيل Push Notifications");
    }
  };

  const sendTestPushNotification = async () => {
    if (!pushSupported()) {
      setPushState((current) => ({ ...current, message: "هذا المتصفح لا يدعم Web Push." }));
      return;
    }
    try {
      setPushState((current) => ({ ...current, saving: true, message: "" }));
      const response = await managerPortalApi.testPush(token, {});
      const subscriptionCount = Number(response?.subscription_debug?.active_count ?? response?.result?.active_count ?? 0);
      setPushState((current) => ({
        ...current,
        saving: false,
        permission: isBrowser() && "Notification" in window ? window.Notification.permission : current.permission,
        subscribed: subscriptionCount > 0 || current.subscribed,
        endpointHost: current.endpointHost,
        message: response?.result?.skipped
          ? "تعذر إرسال الاختبار لأن إعدادات VAPID غير مفعلة."
          : subscriptionCount > 0
            ? `تم إرسال الاختبار إلى ${subscriptionCount} اشتراك.`
            : "لا توجد اشتراكات نشطة مرتبطة بالرمز الحالي.",
      }));
      toast.success(response?.result?.skipped ? "إعدادات Push غير جاهزة" : subscriptionCount > 0 ? "تم إرسال إشعار الاختبار" : "لا توجد اشتراكات نشطة");
    } catch (pushError) {
      setPushState((current) => ({ ...current, saving: false, message: pushError?.responseBody?.message || pushError?.message || "تعذر إرسال إشعار الاختبار" }));
      toast.error(pushError?.responseBody?.message || pushError?.message || "تعذر إرسال إشعار الاختبار");
    }
  };

  const disablePushNotifications = async () => {
    if (!pushSupported()) return;
    setPushState((current) => ({ ...current, saving: true, message: "" }));
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await managerPortalApi.unsubscribePush(token, { endpoint: subscription?.endpoint || "", subscription: subscription?.toJSON?.() || null });
      await subscription?.unsubscribe?.();
      setPushState((current) => ({ ...current, saving: false, subscribed: false, endpointHost: "", message: "تم إيقاف Push Notifications." }));
      toast.success("تم إيقاف Push Notifications");
    } catch (pushError) {
      setPushState((current) => ({ ...current, saving: false, message: pushError?.responseBody?.message || pushError?.message || "تعذر إيقاف Push Notifications" }));
      toast.error(pushError?.responseBody?.message || pushError?.message || "تعذر إيقاف Push Notifications");
    }
  };

  useEffect(() => {
    if (!token) return;
    void refreshPushState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, standalone]);

  const installApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
    setStandalone(isStandaloneApp());
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

  const openInventoryApprovals = () => {
    if (!token) return;
    navigate(`/manager/inventory-approvals?token=${encodeURIComponent(token)}`);
  };

  const renderTaskCard = (task) => {
    const note = taskNotes[task.id] || "";
    const statusMeta = taskStatusMeta(task);
    const proofUrl = taskProofUrl(task);
    return (
      <Card key={task.id} title={portalText(task.title_ar || task.title || "Task")} subtitle={portalText(task.branch_name || task.task_type || "task")} icon={ClipboardList}>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={statusMeta.tone} value={statusMeta.label} />
          <StatusPill tone="amber" value={task.priority || "medium"} />
          <StatusPill tone="slate" value={task.assignee_name || task.employee_name || "Unassigned"} />
          {task.branch_name ? <StatusPill tone="slate" value={portalText(task.branch_name)} /> : null}
        </div>
        <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:grid-cols-2">
          <div>الموظف: {task.assignee_name || task.employee_name || "-"}</div>
          <div>الفرع: {task.branch_name || "-"}</div>
          <div>الإنشاء: {formatDateTime(task.created_at)}</div>
          <div>الاستحقاق: {formatDateTime(task.due_at)}</div>
          <div>البدء/الإنهاء: {formatDateTime(task.started_at)} / {formatDateTime(task.completed_at)}</div>
          <div>المرفقات: {formatNumber(task.attachments_count || 0)}</div>
        </div>
        {proofUrl ? (
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
            {["image", "photo", "img"].some((type) => String(task.latest_attachment_type || "").toLowerCase().includes(type)) ? (
              <a href={proofUrl} target="_blank" rel="noreferrer" className="block">
                <img src={proofUrl} alt={portalText(taskProofLabel(task) || task.title || "Task proof")} className="h-44 w-full object-cover" />
              </a>
            ) : (
              <a href={proofUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-200">
                <span className="min-w-0 truncate">{portalText(taskProofLabel(task) || "Proof attachment")}</span>
                <ChevronRight className="h-4 w-4" />
              </a>
            )}
          </div>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button type="button" data-testid={`task-approve-${task.id}`} onClick={() => void sendTaskAction(task.id, "approve", { note })} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">
            <CheckCircle2 className="h-4 w-4" />
            اعتماد
          </button>
          <button type="button" data-testid={`task-reject-${task.id}`} onClick={() => void sendTaskAction(task.id, "reject", { note })} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-black text-amber-800 shadow-sm">
            <X className="h-4 w-4" />
            رفض / إعادة
          </button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
  };

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
    <main data-testid="manager-portal-root" dir="rtl" className="manager-portal-readable-v2 min-h-[100dvh] bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.12),_transparent_26%),radial-gradient(circle_at_80%_0%,_rgba(245,158,11,0.10),_transparent_18%),radial-gradient(circle_at_15%_20%,_rgba(99,102,241,0.08),_transparent_20%),linear-gradient(180deg,#f8fafc_0%,#eef2f7_52%,#e2e8f0_100%)] px-3 py-3 pb-[calc(8rem+env(safe-area-inset-bottom))] text-right text-slate-950 dark:bg-slate-950 dark:text-white md:px-4 md:py-4">
      <div className="mx-auto grid max-w-[96rem] gap-4 lg:grid-cols-[240px_minmax(0,1.55fr)_320px]">
        <aside className="hidden min-h-[calc(100dvh-2rem)] rounded-[2rem] border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/50 lg:block">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-950 p-3 text-white">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-black tracking-[0.16em] text-slate-500">مركز قيادة المدير</div>
              <div className="text-lg font-black">{portalText(me?.full_name || me?.name || "المدير")}</div>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-3xl bg-slate-950 p-4 text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
              <div className="text-xs font-black text-slate-300">اليوم</div>
              <div className="mt-2 text-3xl font-black text-white">{formatCurrency(dashboard?.today_sales_total || 0)}</div>
              <div className="mt-2 text-sm font-semibold text-slate-300">{formatNumber(dashboard?.invoice_count || 0)} فاتورة اليوم</div>
            </div>
            <button type="button" data-testid="refresh-button-mobile" onClick={() => void loadAll({ silent: true })} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-800">
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
                  activeTab === tab ? "bg-[linear-gradient(180deg,#ffffff,#e2e8f0)] text-slate-950 shadow-sm" : "bg-white text-slate-700"
                }`}
              >
                <span>{tab === "today" ? "اليوم" : tab === "staff" ? "الفريق" : tab === "tasks" ? "المهام" : tab === "sales" ? "المبيعات" : tab === "chat" ? "الشات" : "المزيد"}</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          <header className="rounded-[2rem] border border-slate-200 bg-slate-950 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-300">بوابة المدير</div>
                <h1 className="mt-1 text-2xl font-black leading-8 text-white">{portalText(me?.full_name || me?.name || "المدير")}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-300">
                  <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" /> {portalText(me?.branch_name || "كل الفروع")}</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {portalText(me?.role || "مدير")}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge className="border-slate-700 bg-slate-800 text-slate-100">مباشر</Badge>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openInventoryApprovals}
                    className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-amber-400 px-3 py-2 text-sm font-black text-black shadow-sm transition hover:bg-amber-300"
                  >
                    <ClipboardList className="h-4 w-4" />
                    <span>جردات بانتظار الاعتماد</span>
                    {pendingInventoryApprovalsCount ? (
                      <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-black">{formatNumber(pendingInventoryApprovalsCount)}</span>
                    ) : null}
                  </button>
                  <button
                    ref={notificationButtonRef}
                    type="button"
                    data-testid="manager-notifications-button"
                    aria-label="Open notifications"
                    aria-expanded={notificationsOpen}
                    onClick={() => setNotificationsOpen((current) => !current)}
                    className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-[linear-gradient(180deg,#0f172a,#111827)] text-white transition hover:border-slate-500 hover:bg-[linear-gradient(180deg,#111827,#1e293b)]"
                  >
                    <Bell className="h-4 w-4" />
                    {(unreadCount || notificationsUnread) ? (
                      <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black leading-4 text-white shadow-sm">
                        {formatNumber(unreadCount || notificationsUnread)}
                      </span>
                    ) : null}
                  </button>
                  <button type="button" data-testid="refresh-button" onClick={() => void loadAll({ silent: true })} className="inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-black text-slate-950 shadow-sm">
                    <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    تحديث
                  </button>
                </div>
              </div>
            </div>
          </header>

          {showInstallCard ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-4 text-slate-950 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-black">بوابة المدير كتطبيق</h3>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-600">
                    {isIosDevice()
                      ? "على iPhone: اضغط مشاركة ثم Add to Home Screen ثم افتح بوابة المدير من الأيقونة."
                      : "أضف بوابة المدير إلى الشاشة الرئيسية لتفتح كتطبيق مستقل."}
                  </p>
                  {installPrompt ? (
                    <button type="button" onClick={installApp} className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-xs font-black text-white">
                      <Download className="h-4 w-4" />
                      إضافة إلى الشاشة الرئيسية
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {notificationsOpen ? (
            <div className="fixed inset-0 z-[70]">
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setNotificationsOpen(false)}
                className="absolute inset-0 bg-slate-950/55"
              />
              <aside
                ref={notificationPanelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="manager-notifications-title"
                className="absolute inset-x-0 bottom-0 top-0 ml-auto flex h-dvh w-full max-w-[40rem] flex-col overflow-hidden border-l border-slate-200 bg-[#f8fafc] shadow-[0_24px_90px_rgba(15,23,42,0.24)] sm:inset-y-0 sm:right-0 sm:w-[min(100vw,38rem)] sm:rounded-l-[2rem]"
              >
                <div className="shrink-0 border-b border-slate-200 bg-slate-950 px-4 py-4 sm:px-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-slate-100">
                        <Bell className="h-3.5 w-3.5" />
                        مباشر
                      </div>
                      <h2 id="manager-notifications-title" className="mt-3 text-2xl font-black tracking-tight text-white">
                        مركز الإشعارات
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        تابع رسائل الموظفين والمهام والحضور والمبيعات والمخزون والعملاء الساخنين في مكان واحد.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-white transition hover:border-slate-500 hover:bg-slate-800"
                      aria-label="إغلاق الإشعارات"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                      <div className="text-[11px] font-black text-slate-500">غير مقروء</div>
                      <div className="mt-1 text-xl font-black text-slate-950">{formatNumber(unreadCount || notificationsUnread)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                      <div className="text-[11px] font-black text-slate-500">الإجمالي</div>
                      <div className="mt-1 text-xl font-black text-slate-950">{formatNumber(managerNotifications.length || 0)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void markAllNotificationsRead()}
                      disabled={!notifications.some((item) => !item.is_read)}
                      className="inline-flex min-h-[4.5rem] flex-col items-start justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-left text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <CheckCheck className="h-4 w-4" />
                      <span className="mt-1 text-xs font-black">تحديد الكل كمقروء</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadAll({ silent: true })}
                      className="inline-flex min-h-[4.5rem] flex-col items-start justify-center rounded-2xl bg-slate-950 px-3 py-2.5 text-left text-white transition hover:bg-slate-800"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                      <span className="mt-1 text-xs font-black">تحديث</span>
                    </button>
                  </div>

                  <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                    {MANAGER_NOTIFICATION_CATEGORIES.map((item) => {
                      const active = notificationCategory === item.key;
                      const Icon = item.icon;
                      const count = item.key === "all" ? managerNotifications.length : notificationCategoryCounts[item.key] || 0;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setNotificationCategory(item.key)}
                          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition ${
                            active
                              ? "border-slate-950 bg-slate-950 text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-950"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{item.label}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${active ? "bg-white/20 text-inherit" : "bg-slate-100 text-slate-600"}`}>
                            {formatNumber(count)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
                  {filteredManagerNotifications.length ? (
                    <div className="space-y-3">
                      {filteredManagerNotifications.map((item) => {
                        const category = item.manager_category || categoryFromNotification(item);
                        const meta = categoryMeta(category);
                        const Icon = meta.icon;
                        const unread = !item.is_read;
                        return (
                          <article
                            key={item.id}
                            className={`overflow-hidden rounded-3xl border p-4 shadow-sm transition ${
                              unread
                              ? "border-sky-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] ring-1 ring-sky-100 dark:border-sky-400/20 dark:bg-white/[0.03] dark:ring-sky-400/10"
                                : "border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] dark:border-white/10 dark:bg-white/[0.02]"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => void openNotification(item)}
                              className="flex w-full items-start gap-3 text-right"
                            >
                              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ${unread ? "bg-white text-sky-700 ring-sky-100 dark:bg-white/[0.03] dark:text-sky-200 dark:ring-sky-400/20" : "bg-white text-slate-600 ring-slate-200 dark:bg-white/[0.03] dark:text-slate-200 dark:ring-white/10"}`}>
                                <Icon className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h3 className="truncate text-sm font-black text-slate-950 dark:text-white">{item.title || "إشعار"}</h3>
                                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                      {item.message || item.body || "لا توجد تفاصيل إضافية."}
                                    </p>
                                  </div>
                                  {unread ? <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500 shadow-[0_0_12px_rgba(14,165,233,0.65)] dark:bg-sky-300" /> : null}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                  <span>{notificationTypeLabel(item)}</span>
                                  <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                                  <span>{formatDateTime(item.created_at)}</span>
                                  <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                                  <span className="rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-600 dark:border-white/10 dark:text-slate-300">
                                    {category}
                                  </span>
                                </div>
                              </div>
                            </button>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {item.action_url ? (
                                <button
                                  type="button"
                                  onClick={() => void openNotification(item)}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-black text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                                >
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                  فتح
                                </button>
                              ) : null}
                              {unread ? (
                                <button
                                  type="button"
                                  onClick={() => void markNotificationRead(item.id)}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-sky-300 hover:text-sky-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-cyan-300/35 dark:hover:text-cyan-100"
                                >
                                  <CheckCheck className="h-3.5 w-3.5" />
                                  تحديد كمقروء
                                </button>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex min-h-[28rem] flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-300 bg-white p-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white text-slate-500 ring-1 ring-slate-200 dark:bg-white/[0.03] dark:text-slate-300 dark:ring-white/10">
                        <Bell className="h-8 w-8" />
                      </div>
                      <h3 className="mt-5 text-lg font-black text-slate-950 dark:text-white">لا توجد إشعارات</h3>
                      <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500 dark:text-slate-400">
                        ستظهر رسائل الشات وتحديثات المهام والمبيعات وتنبيهات المخزون فور وصولها.
                      </p>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          ) : null}

          {activeTab === "today" ? (
            <div data-testid="manager-dashboard-panel" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <MiniMetric label="مبيعات اليوم" value={formatCurrency(dashboard?.today_sales_total || 0)} icon={ShoppingCart} tone="green" />
                <MiniMetric label="عدد الفواتير" value={formatNumber(dashboard?.invoice_count || 0)} icon={ClipboardList} tone="cyan" />
                <MiniMetric label="العملاء الساخنون" value={formatNumber(dedupedLeads.length || 0)} icon={Bot} tone="red" />
                <MiniMetric label="رسائل الموظفين" value={formatNumber(employeeMessageNotifications.length || 0)} icon={MessageSquare} tone="blue" />
              </div>

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                <MiniMetric label="الحاضرون الآن" value={formatNumber(dashboard?.active_employees_now || 0)} icon={Users} tone="green" />
                <MiniMetric label="الغائبون" value={formatNumber(dashboard?.absent_employees || 0)} icon={X} tone="slate" />
                <MiniMetric label="المتأخرون" value={formatNumber(dashboard?.late_employees || 0)} icon={Clock3} tone="amber" />
                <MiniMetric label="المهام المفتوحة" value={formatNumber(dashboard?.pending_tasks || 0)} icon={ClipboardList} tone="blue" />
                <MiniMetric label="المهام المتأخرة" value={formatNumber(dashboard?.overdue_tasks || 0)} icon={AlertTriangle} tone="red" />
              </div>

              <Card title="الأحداث التشغيلية" subtitle="آخر ٥ أحداث" icon={Bell}>
                {operationalEvents.length ? (
                  <div className="space-y-2">
                    {operationalEvents.map((event) => (
                      <button
                        key={event.key}
                        type="button"
                        onClick={() => event.kind === "invoice" && event.invoiceId ? void openInvoiceDetail(event.invoiceId) : undefined}
                        className="flex w-full items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-right transition hover:border-slate-300 hover:shadow-sm"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-black text-slate-950 dark:text-white">{event.title}</div>
                          <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">{event.detail || "لا توجد تفاصيل إضافية"}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          {event.kind ? <div className="mb-1 flex justify-end"><span className={`rounded-full border px-2 py-1 text-[10px] font-black ${event.kind === "invoice" ? "border-emerald-200 bg-white text-emerald-700" : event.tone === "amber" ? "border-amber-200 bg-white text-amber-800" : event.tone === "red" ? "border-rose-200 bg-white text-rose-700" : "border-slate-200 bg-white text-slate-700"}`}>{event.kind === "invoice" ? "فاتورة" : event.kind === "lead" ? "عميل" : event.kind === "task" ? "مهمة" : "حدث"}</span></div> : null}
                          <StatusPill tone={event.tone || "slate"} value={formatDateTime(event.timestamp)} />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact title="لا توجد أحداث بعد" body="ستظهر هنا الفواتير والمهام والعملاء الساخنون وتنبيهات إعادة العرض." />
                )}
              </Card>

              <Card title="توزيع الدفع" subtitle="توزيع الدفع" icon={ArrowLeftRight}>
                {paymentBreakdown.length ? (
                  <div className="space-y-2">
                    {paymentBreakdown.map((row) => (
                      <div key={row.method} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800">
                        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />{paymentMethodLabel(row.method)}</span>
                        <span className="text-slate-950">{formatCurrency(row.total || 0)} · {formatNumber(row.count || 0)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact title="لا توجد بيانات دفع" body="ستظهر طرق الدفع بعد تسجيل فواتير اليوم." />
                )}
              </Card>

              <Card title="تنبيهات المخزون" subtitle="تنبيهات المخزون" icon={Package}>
                {lowStock.length || refillAlerts.length ? (
                  <div className="space-y-2">
                    {refillAlerts.slice(0, 3).map((alert) => (
                      <div key={`refill-${alert.id}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800">
                        <div className="font-black text-slate-950">إعادة عرض منتج: <InlineName>{portalText(alert.product_name || "منتج")}</InlineName></div>
                        <div className="mt-1 text-xs font-bold text-slate-500">{portalText(alert.color_name || alert.color || "")} {alert.replacement_size ? `· ${portalText(alert.replacement_size)}` : ""}</div>
                      </div>
                    ))}
                    {lowStock.slice(0, 3).map((item) => (
                      <div key={`low-${item.id}-${item.name}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800">
                        <div className="font-black text-slate-950">مطلوب إعادة طلب: <InlineName>{portalText(item.name || "منتج")}</InlineName></div>
                        <div className="mt-1 text-xs font-bold text-slate-500">{formatNumber(item.stock || 0)} قطعة متبقية</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact title="لا توجد تنبيهات مخزون" body="سيظهر المخزون المنخفض وإعادة العرض عند اكتشافهما." />
                )}
              </Card>

              <Card title="رؤى الذكاء الاصطناعي" subtitle="التحليلات الذكية" icon={Bot}>
                {aiInsights.length ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {aiInsights.map((item, index) => (
                      <div key={`${item.title || item.body || index}`} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold leading-6 text-slate-800">
                        <div className="text-xs font-black text-slate-600">{insightTitleLabel(item.type, item.title)}</div>
                        <div className="mt-1">{renderInsightBody(item)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact title="لا توجد رؤى مباشرة" body="ستظهر الإشارات المهمة عند توفر بيانات تشغيل كافية." />
                )}
              </Card>

              <Card title="الإشعارات المباشرة" subtitle="الإشعارات المباشرة" icon={Bell}>
                {visibleLiveFeed.length ? (
                  <div className="space-y-2">
                    {visibleLiveFeed.map((item) => (
                      <div key={`feed-${item.id}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-black text-slate-950">{portalText(item.title || notificationTypeLabel(item))}</div>
                            <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">{portalText(item.message || item.body || "لا توجد تفاصيل")}</div>
                          </div>
                          <StatusPill tone={item.is_read ? "slate" : "blue"} value={formatDateTime(item.created_at)} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact title="لا توجد إشعارات مباشرة" body="ستظهر رسائل الموظفين والمهام والمبيعات هنا فور وصولها." />
                )}
              </Card>

              <Card title="المخزون المنخفض" subtitle="المخزون المنخفض" icon={Package}>
                {visibleLowStock.length ? (
                  <div className="space-y-2">
                    {visibleLowStock.map((item) => (
                      <div key={`low-only-${item.id}-${item.name}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800">
                        <div className="font-black text-slate-950"><InlineName>{portalText(item.name || "منتج")}</InlineName></div>
                        <div className="mt-1 text-xs font-bold text-slate-500">{portalText(item.color || "")} {item.size ? `· ${portalText(item.size)}` : ""} · {formatNumber(item.stock || 0)} قطعة</div>
                      </div>
                    ))}
                    {hasMoreLowStock ? (
                      <button type="button" onClick={() => setShowMoreLowStock((current) => !current)} className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800">
                        {showMoreLowStock ? "عرض أقل" : "عرض المزيد"}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState compact title="لا يوجد مخزون منخفض" body="لا توجد عناصر منخفضة حالياً." />
                )}
              </Card>
            </div>
          ) : null}

          {activeTab === "staff" ? (
            <div className="space-y-3">
              {staffList.length ? staffList.map((employee) => (
                <Card key={employee.employee_id} title={portalText(employee.employee_name || "موظف")} subtitle={portalText(employee.department || employee.job_title || "الفريق")} icon={Users}>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={employee.attendance_status === "checked_in" ? "green" : employee.attendance_status === "online" ? "blue" : "slate"} value={portalText(employee.attendance_status || "absent")} />
                    <StatusPill tone="blue" value={`المهام ${formatNumber(employee.open_tasks || 0)}/${formatNumber(employee.completed_tasks || 0)}`} />
                    <StatusPill tone="amber" value={`المبيعات ${formatCurrency(employee.sales_today || 0)}`} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                    <div>الحضور: {formatTime(employee.check_in_time)} - {formatTime(employee.check_out_time)}</div>
                    <div>الوردية: {Number(employee.shift_duration_hours || 0).toFixed(2)} ساعة</div>
                    <div>الفواتير: {formatNumber(employee.invoices_count || 0)}</div>
                    <div>آخر نشاط: {formatDateTime(employee.last_activity)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">العمولة المتوقعة {employee.expected_commission == null ? "غير متاحة" : formatCurrency(employee.expected_commission || 0)}</Badge>
                    <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">المهام المفتوحة {formatNumber(employee.open_tasks || 0)}</Badge>
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
                    {staffList.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{portalText(employee.employee_name)}</option>)}
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

              <Card title="المرشحات" subtitle="المرشحات" icon={Search}>
                <div className="grid gap-2 md:grid-cols-4">
                  <input
                    value={taskFilters.query}
                    onChange={(event) => setTaskFilters((current) => ({ ...current, query: event.target.value }))}
                    placeholder="ابحث في العنوان أو الموظف"
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]"
                  />
                  <select
                    value={taskFilters.status}
                    onChange={(event) => setTaskFilters((current) => ({ ...current, status: event.target.value }))}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <option value="all">كل الحالات</option>
                    <option value="open">المهام المفتوحة</option>
                    <option value="completed">المهام المكتملة</option>
                    <option value="overdue">المهام المتأخرة</option>
                    <option value="pending">قيد الانتظار</option>
                    <option value="in_progress">قيد التنفيذ</option>
                    <option value="manager_review">مراجعة المدير</option>
                    <option value="reassigned">معاد إسنادها</option>
                    <option value="rejected">مرفوضة</option>
                  </select>
                  <select
                    value={taskFilters.employee}
                    onChange={(event) => setTaskFilters((current) => ({ ...current, employee: event.target.value }))}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <option value="">كل الموظفين</option>
                    {employeeFilterOptions.map((employee) => (
                      <option key={employee.value || employee.label} value={employee.value || employee.label}>{employee.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setTaskFilters({ status: "all", employee: "", query: "" })} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    مسح المرشحات
                  </button>
                </div>
              </Card>

              <div className="grid gap-3 sm:grid-cols-3">
                <Card title={formatNumber(taskCounts.open)} subtitle="المهام المفتوحة" icon={ClipboardList} />
                <Card title={formatNumber(taskCounts.completed)} subtitle="المهام المكتملة" icon={CheckCheck} />
                <Card title={formatNumber(taskCounts.overdue)} subtitle="المهام المتأخرة" icon={AlertTriangle} />
              </div>

              <Card title="قائمة المهام المفتوحة" subtitle="قائمة التشغيل" icon={ClipboardList}>
                {openTasks.length ? <div className="space-y-3">{openTasks.map((task) => renderTaskCard(task))}</div> : <EmptyState title="لا توجد مهام مفتوحة" body="لا توجد مهام مطابقة للمرشحات الحالية." />}
              </Card>

              <Card title="قائمة المهام المكتملة" subtitle="الإثبات جاهز" icon={CheckCheck}>
                {completedTasks.length ? <div className="space-y-3">{completedTasks.map((task) => renderTaskCard(task))}</div> : <EmptyState title="لا توجد مهام مكتملة" body="المهام المكتملة ستظهر هنا مع معاينة الإثبات." />}
              </Card>

              <Card title="قائمة المهام المتأخرة" subtitle="تحتاج انتباه" icon={AlertTriangle}>
                {overdueTasks.length ? <div className="space-y-3">{overdueTasks.map((task) => renderTaskCard(task))}</div> : <EmptyState title="لا توجد مهام متأخرة" body="المهام المتأخرة أو المستحقة ستظهر هنا." />}
              </Card>
            </div>
          ) : null}

          {activeTab === "sales" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card title={formatCurrency(sales?.overview?.today?.sales || dashboard?.today_sales_total || 0)} subtitle="مبيعات اليوم" icon={ShoppingCart} />
                <Card title={formatNumber(sales?.overview?.today?.orders || dashboard?.invoice_count || 0)} subtitle="الفواتير" icon={ClipboardList} />
                {canViewProfit ? <Card title={formatCurrency(sales?.overview?.today?.profit || 0)} subtitle="الربح" icon={SunMedium} /> : <Card title="—" subtitle="الربح مخفي" icon={SunMedium} />}
                <Card title={formatCurrency(sales?.overview?.today?.averageOrderValue || 0)} subtitle="متوسط الفاتورة" icon={ArrowLeftRight} />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title="أفضل بائع" subtitle="آخر ٣٠ يوم" icon={Trophy}>
                  {salesLeaders.top_seller ? (
                    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                        <div className="text-lg font-black"><InlineName>{portalText(salesLeaders.top_seller.seller_name || "بائع غير محدد")}</InlineName></div>
                      </div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>الإيراد: {formatCurrency(salesLeaders.top_seller.revenue || 0)}</div>
                        <div>الفواتير: {formatNumber(salesLeaders.top_seller.orders_count || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="لا توجد بيانات بائع" body="ستظهر مبيعات البائعين بعد ربط الفواتير بالموظفين." />
                  )}
                </Card>
                <Card title="Worst seller" subtitle="30-day laggard" icon={Medal}>
                  {salesLeaders.worst_seller ? (
                    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                        <div className="text-lg font-black"><InlineName>{portalText(salesLeaders.worst_seller.seller_name || "Unknown seller")}</InlineName></div>
                      </div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>Revenue: {formatCurrency(salesLeaders.worst_seller.revenue || 0)}</div>
                        <div>Orders: {formatNumber(salesLeaders.worst_seller.orders_count || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="No seller data" body="Add linked seller data to surface the lowest performer." />
                  )}
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card title="أفضل تصنيف" subtitle="آخر ٣٠ يوم" icon={Package}>
                  {bestCategory ? (
                    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                        <div className="text-lg font-black"><InlineName>{portalText(bestCategory.name || "Uncategorized")}</InlineName></div>
                      </div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>الإيراد: {formatCurrency(bestCategory.revenue || 0)}</div>
                        <div>Units: {formatNumber(bestCategory.quantity || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="لا توجد بيانات تصنيفات" body="ستظهر التصنيفات بعد ربط بنود البيع بالمنتجات." />
                  )}
                </Card>
                <Card title="أفضل علامة" subtitle="آخر ٣٠ يوم" icon={Store}>
                  {bestBrand ? (
                    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                        <div className="text-lg font-black"><InlineName>{portalText(bestBrand.name || "Unbranded")}</InlineName></div>
                      </div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>الإيراد: {formatCurrency(bestBrand.revenue || 0)}</div>
                        <div>Units: {formatNumber(bestBrand.quantity || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="لا توجد بيانات علامات" body="ستظهر العلامات بعد ربط بنود البيع بالمنتجات." />
                  )}
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <Card title="Yesterday vs today" subtitle="Day comparison" icon={ArrowUpRight}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      {
                        label: "المبيعات",
                        today: formatCurrency(salesComparison.today_sales || sales?.overview?.today?.sales || 0),
                        yesterday: formatCurrency(salesComparison.yesterday_sales || 0),
                        delta: salesComparison.sales_growth || 0,
                      },
                      {
                        label: "الفواتير",
                        today: formatNumber(salesComparison.today_orders || sales?.overview?.today?.orders || 0),
                        yesterday: formatNumber(salesComparison.yesterday_orders || 0),
                        delta: salesComparison.orders_growth || 0,
                      },
                      {
                        label: "Avg invoice",
                        today: formatCurrency(salesComparison.today_average_invoice || sales?.overview?.today?.averageOrderValue || 0),
                        yesterday: formatCurrency(salesComparison.yesterday_average_invoice || 0),
                        delta: salesComparison.average_invoice_growth || 0,
                      },
                    ].map((item) => {
                      const delta = Number(item.delta || 0);
                      const positive = delta >= 0;
                      return (
                        <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
                          <div className="mt-2 text-lg font-black text-slate-950">{item.today}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">أمس: {item.yesterday}</div>
                          <div className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black ${positive ? "border-emerald-200 bg-white text-emerald-700" : "border-rose-200 bg-white text-rose-700"}`}>
                            {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                            {delta >= 0 ? "+" : ""}
                            {formatPercent(delta)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <Card title="متوسط الفاتورة" subtitle="قيمة الفاتورة" icon={ClipboardList}>
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="text-xs font-black text-slate-500">اليوم</div>
                      <div className="mt-2 text-3xl font-black text-slate-950">{formatCurrency(salesComparison.today_average_invoice || sales?.overview?.today?.averageOrderValue || 0)}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-600">
                        أمس: {formatCurrency(salesComparison.yesterday_average_invoice || 0)}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">فواتير اليوم</div>
                        <div className="mt-1 text-lg font-black text-slate-950">{formatNumber(salesComparison.today_orders || sales?.overview?.today?.orders || 0)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">النمو</div>
                        <div className={`mt-1 inline-flex items-center gap-1 text-lg font-black ${Number(salesComparison.average_invoice_growth || 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {Number(salesComparison.average_invoice_growth || 0) >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                          {Number(salesComparison.average_invoice_growth || 0) >= 0 ? "+" : ""}
                          {formatPercent(salesComparison.average_invoice_growth || 0)}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              <Card title="اتجاه آخر ٧ أيام" subtitle="الإيراد والفواتير" icon={Clock3}>
                {trend7d.length ? (
                  <div className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">إيراد ٧ أيام</div>
                        <div className="mt-1 text-xl font-black text-slate-950">{formatCurrency(trend7d.reduce((sum, item) => sum + Number(item.revenue || 0), 0))}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">فواتير ٧ أيام</div>
                        <div className="mt-1 text-xl font-black text-slate-950">{formatNumber(trend7d.reduce((sum, item) => sum + Number(item.orders || 0), 0))}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">أفضل يوم</div>
                        <div className="mt-1 text-xl font-black text-slate-950">
                          {formatShortDay(trend7d.reduce((best, item) => (Number(item.revenue || 0) > Number(best?.revenue || 0) ? item : best), trend7d[0] || {}).day)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">أعلى إيراد</div>
                        <div className="mt-1 text-xl font-black text-slate-950">{formatCurrency(Math.max(...trend7d.map((item) => Number(item.revenue || 0)), 0))}</div>
                      </div>
                    </div>
                    <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-7">
                      {trend7d.map((item) => {
                        const maxRevenue = Math.max(...trend7d.map((row) => Number(row.revenue || 0)), 1);
                        const height = Math.max(12, Math.round((Number(item.revenue || 0) / maxRevenue) * 100));
                        return (
                          <div key={item.day} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="flex h-28 items-end">
                              <div className="w-full rounded-t-xl bg-gradient-to-t from-slate-950 to-sky-500" style={{ height: `${height}%` }} />
                            </div>
                            <div className="mt-3 text-xs font-black text-slate-500">{formatShortDay(item.day)}</div>
                            <div className="mt-1 text-sm font-black text-slate-950">{formatCurrency(item.revenue || 0)}</div>
                            <div className="text-[11px] font-bold text-slate-500">{formatNumber(item.orders || 0)} فاتورة</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <EmptyState title="لا يوجد اتجاه ٧ أيام" body="سيظهر الاتجاه اليومي بعد توفر فواتير حديثة." />
                )}
              </Card>

              <Card title="Conversion indicators" subtitle="Shown only when data exists" icon={Megaphone}>
                {hasConversionIndicators ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Customer-linked orders</div>
                      <div className="mt-2 text-2xl font-black text-slate-950">{formatNumber(conversionIndicators.customer_linked_orders || 0)}</div>
                      <div className="mt-1 text-sm font-bold text-slate-500">{formatPercent(conversionIndicators.customer_link_rate || 0)} of orders</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Online orders</div>
                      <div className="mt-2 text-2xl font-black text-slate-950">{formatNumber(conversionIndicators.online_orders || 0)}</div>
                      <div className="mt-1 text-sm font-bold text-slate-500">{formatPercent(conversionIndicators.online_order_share || 0)} of orders</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">AI chat conversions</div>
                      <div className="mt-2 text-2xl font-black text-slate-950">{formatNumber(conversionIndicators.ai_confirmed_orders || 0)}</div>
                      <div className="mt-1 text-sm font-bold text-slate-500">
                        {formatNumber(conversionIndicators.ai_sessions || 0)} sessions · {formatPercent(conversionIndicators.ai_conversion_rate || 0)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState title="No conversion data" body="Conversion metrics will appear when the system has enough order and conversation data." />
                )}
              </Card>

              <Card title={portalText("Top products")} subtitle="Top products" icon={Package}>
                {topProducts.length ? topProducts.map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700">
                    <span><InlineName>{portalText(item.name)}</InlineName></span>
                    <span className="font-black text-slate-950">{formatNumber(item.quantity || 0)} · {formatCurrency(item.revenue || 0)}</span>
                  </div>
                )) : <EmptyState title="لا توجد منتجات مبيعة" body="سيظهر هنا أفضل البائعين عند توفر بيانات فعلية." />}
              </Card>
              <Card title={portalText("Hourly trend")} subtitle="Hourly trend" icon={Clock3}>
                {Array.isArray(sales?.hourly) && sales.hourly.length ? (
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
                    {sales.hourly.map((item) => (
                      <div key={item.hour} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700">
                        <div className="text-xs font-black text-slate-500">{String(item.hour).padStart(2, "0")}:00</div>
                        <div className="mt-1 font-black text-slate-950">{formatCurrency(item.sales || 0)}</div>
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
            <SharedPortalChat
              apiAdapter={managerChatApiAdapter}
              employees={staffList}
              selectedEmployeeId={queryEmployeeId}
              onThreadChange={setManagerChatState}
              headerTitle="محادثات الموظفين"
              headerKicker="بوابة المدير / الشات"
              secureNotice="هذه المحادثة خاصة بين الموظف والإدارة"
              className="xl:h-[calc(100dvh-13rem)]"
              managerPanel={() => (
                selectedChatEmployee ? (
                  <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto pr-1" dir="rtl">
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-black tracking-[0.16em] text-slate-500">الموظف</div>
                      <div className="mt-1 text-lg font-black text-slate-950">{portalText(selectedChatEmployee.employee_name || selectedChatEmployee.full_name || selectedChatThread?.employee_name || "موظف")}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusPill tone={selectedChatAttendanceTone} value={selectedChatAttendanceStatus} />
                        <Badge className="border-slate-200 bg-white text-slate-700">{portalText(selectedChatEmployee.branch_name || selectedChatThread?.branch_name || "لا يوجد فرع")}</Badge>
                        <Badge className="border-slate-200 bg-white text-slate-700">{portalText(selectedChatEmployee.employee_code || "لا يوجد كود")}</Badge>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="text-[11px] font-black text-slate-400">آخر نشاط</div>
                        <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{formatDateTime(selectedChatLastActivity)}</div>
                      </div>
                      <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="text-[11px] font-black text-slate-400">المهام المفتوحة</div>
                        <div className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{formatNumber(selectedChatOpenTasks)}</div>
                      </div>
                    </div>

                    <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black text-slate-400">ملخص الحضور</div>
                      <div className="mt-3 grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>الحالة</span>
                          <span className="font-black text-slate-950 dark:text-white">{portalText(selectedChatAttendanceStatus)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>الحضور</span>
                          <span dir="ltr" className="font-black text-slate-950 dark:text-white">{formatDateTime(selectedChatCheckIn)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>الانصراف</span>
                          <span dir="ltr" className="font-black text-slate-950 dark:text-white">{formatDateTime(selectedChatCheckOut)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>ساعات الوردية</span>
                          <span className="font-black text-slate-950 dark:text-white">{selectedChatShiftHours.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>دقائق التأخير</span>
                          <span className="font-black text-slate-950 dark:text-white">{formatNumber(selectedChatLateMinutes)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black text-slate-400">ملخص المبيعات</div>
                      <div className="mt-3 grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>مبيعات اليوم</span>
                          <span className="font-black text-slate-950 dark:text-white">{formatCurrency(selectedChatSalesTotal)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>الفواتير</span>
                          <span className="font-black text-slate-950 dark:text-white">{formatNumber(selectedChatInvoices)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 text-sm font-semibold leading-6 text-slate-800 shadow-sm">
                      <div className="text-xs font-black text-slate-600">ملخص سريع</div>
                      <div className="mt-2 text-slate-700">آخر نشاط: {formatDateTime(selectedChatLastActivity)}</div>
                      <div className="text-slate-700">المحادثة غير المقروءة: {formatNumber(selectedChatUnread)}</div>
                    </div>
                  </div>
                ) : (
                  <EmptyState title="لا يوجد ملف موظف" body="اختر محادثة لعرض ملخص الموظف هنا." />
                )
              )}
              useTextareaComposer
            />
          ) : null}

          {activeTab === "more" ? (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title="الملف الشخصي" subtitle="ملف المدير" icon={Building2}>
                  <div className="space-y-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    <div className="font-black text-slate-950 dark:text-white">{portalText(me?.full_name || me?.name || "المدير")}</div>
                    <div>{portalText(me?.role || "manager")} · {portalText(me?.department || "—")}</div>
                    <div>{portalText(me?.user_email || "لا يوجد بريد")}</div>
                    <div>{formatNumber(me?.permissions?.length || 0)} صلاحية</div>
                  </div>
                </Card>
                <Card title="بيانات الفرع" subtitle="Branch info" icon={Store}>
                  <div className="space-y-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    <div className="font-black text-slate-950 dark:text-white">{portalText(me?.branch_name || "All branches")}</div>
                    <div>Scope: {portalText(me?.branch_scope || "all")}</div>
                    <div>Live alerts: {formatNumber(notifications.length || 0)}</div>
                    <div>Unread: {formatNumber(unreadCount || notificationsUnread)}</div>
                  </div>
                </Card>
                <Card title="روابط سريعة" subtitle="روابط سريعة" icon={ChevronRight}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["اليوم", "today"],
                      ["الفريق", "staff"],
                      ["المهام", "tasks"],
                      ["المبيعات", "sales"],
                      ["Chat", "chat"],
                    ].map(([label, tab]) => (
                      <button key={tab} type="button" onClick={() => setActiveTab(tab)} className="inline-flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3 text-right text-sm font-black text-slate-800 transition hover:border-slate-300 hover:bg-slate-100">
                        <span>{label}</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </Card>
                <Card title="سجل الإشعارات" subtitle="سجل الإشعارات" icon={Bell}>
                  <div className="space-y-2">
                    {notifications.slice(0, 3).length ? notifications.slice(0, 3).map((item) => (
                      <div key={`history-${item.id}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm">
                        <div className="font-black text-slate-950">{portalText(item.title || item.type || "إشعار")}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-slate-500">{portalText(item.message || item.body || "")}</div>
                        <div className="mt-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{formatDateTime(item.created_at)}</div>
                      </div>
                    )) : <EmptyState title="لا يوجد سجل حديث" body="ستظهر آخر الإشعارات هنا عندما تتوفر." />}
                  </div>
                </Card>
              </div>

              <Card title="إعدادات التنبيه" subtitle="إعدادات الإشعارات" icon={Bell}>
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(settings).map(([category, config]) => (
                    <div key={category} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-black text-slate-900">{portalText(category)}</div>
                        <StatusPill tone="slate" value={portalText(category)} />
                      </div>
                      <Toggle label="صوت" checked={Boolean(config.sound)} onChange={(value) => onCategoryToggle(category, "sound", value)} />
                      <Toggle label="Toast" checked={Boolean(config.toast)} onChange={(value) => onCategoryToggle(category, "toast", value)} />
                      <Toggle label="Push" checked={Boolean(config.push)} onChange={(value) => onCategoryToggle(category, "push", value)} />
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

              <Card title="إشعارات Push" subtitle="Real mobile web push" icon={Smartphone}>
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Badge className={`${pushState.supported ? "border-emerald-200 text-emerald-700" : "border-rose-200 text-rose-700"} dark:border-white/10 dark:bg-white/[0.03] dark:text-white`}>
                      {pushState.supported ? "Supported" : "Not supported"}
                    </Badge>
                    <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                      Permission: {portalText(pushState.permission)}
                    </Badge>
                    <Badge className={`${pushState.subscribed ? "border-emerald-200 text-emerald-700" : "border-slate-200 text-slate-700"} dark:border-white/10 dark:bg-white/[0.03] dark:text-white`}>
                      Subscription: {pushState.subscribed ? "active" : "inactive"}
                    </Badge>
                    <Badge className={`${standalone ? "border-sky-200 text-sky-700" : "border-amber-200 text-amber-800"} dark:border-white/10 dark:bg-white/[0.03] dark:text-white`}>
                      {standalone ? "Installed PWA" : "Browser tab"}
                    </Badge>
                  </div>
                  {pushState.endpointHost ? (
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 shadow-sm" dir="ltr">{pushState.endpointHost}</div>
                  ) : null}
                  {isIosDevice() && !standalone ? (
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold leading-6 text-slate-700 shadow-sm">
                      على iPhone يجب فتح بوابة المدير من التطبيق المثبت بعد Add to Home Screen لتفعيل Push Notifications.
                    </div>
                  ) : null}
                  {pushState.message ? <div className="text-xs font-bold text-slate-500 dark:text-slate-300">{pushState.message}</div> : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" disabled={pushState.saving || !pushState.supported || pushState.permission === "denied"} onClick={enablePushNotifications} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-45 dark:bg-white dark:text-slate-950">
                      {pushState.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                      {pushState.subscribed ? "تحديث Push Notifications" : "Enable Push Notifications"}
                    </button>
                    <button type="button" disabled={pushState.saving || !pushState.subscribed} onClick={disablePushNotifications} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                      <X className="h-4 w-4" />
                      إيقاف Push
                    </button>
                  </div>
                  <button type="button" disabled={pushState.saving || !pushState.supported || pushState.permission === "denied"} onClick={sendTestPushNotification} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    <Send className="h-4 w-4" />
                    Send Test Notification
                  </button>
                </div>
              </Card>

              <Card title="ملخص سريع" subtitle="ملخص سريع" icon={Megaphone}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white shadow-sm">
                    <div className="text-xs font-black text-slate-300">إشعارات غير مقروءة</div>
                    <div className="mt-1 text-3xl font-black text-white">{formatNumber(unreadCount || notificationsUnread)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm">
                    <div className="text-xs font-black text-slate-500">صلاحيات</div>
                    <div className="mt-1 text-sm font-semibold leading-6 text-slate-700">{(me?.permissions || []).length ? `${formatNumber(me.permissions.length)} صلاحية` : "لا توجد صلاحيات ظاهرة"}</div>
                  </div>
                </div>
              </Card>
            </div>
          ) : null}
        </section>

        <aside className="space-y-3">
          <Card title="الإشعارات المباشرة" subtitle="الإشعارات المباشرة" icon={Bell} className="min-h-0" compact bodyClassName="space-y-2">
            <div data-testid="notifications-panel" />
            <div className="space-y-1.5">
              {visibleLiveFeed.length ? visibleLiveFeed.map((item) => {
                const isEmployeeMessage = categoryFromNotification(item) === "employee_chat";
                const isInvoiceNotification = categoryFromNotification(item) === "sales" && (item.metadata?.invoice_id || item.metadata?.order_id || item.entity_id);
                return (
                <div key={item.id} data-testid={`notification-${item.id}`} className={`w-full rounded-2xl border px-3 py-2.5 text-right transition ${item.is_read ? "border-slate-200 bg-white text-slate-600" : "border-slate-300 bg-white text-slate-950 shadow-sm ring-1 ring-sky-100"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-950">{portalText(isEmployeeMessage ? item.metadata?.employee_name || item.title || "رسالة موظف" : item.title || notificationTypeLabel(item))}</div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">{portalText(item.message || item.body || "لا توجد تفاصيل")}</div>
                      <div className="mt-1 text-[11px] font-bold text-slate-500">{formatDateTime(item.created_at)}</div>
                    </div>
                    <StatusPill tone={item.is_read ? "slate" : "blue"} value={notificationTypeLabel(item)} />
                  </div>
                  {isEmployeeMessage ? (
                    <button type="button" onClick={() => void openNotification(item)} className="mt-2 inline-flex h-9 items-center justify-center rounded-xl bg-slate-950 px-3 text-xs font-black text-white">
                      فتح المحادثة
                    </button>
                  ) : null}
                  {isInvoiceNotification ? (
                    <button type="button" onClick={() => void openNotification(item)} className="mt-2 inline-flex h-9 items-center justify-center rounded-xl bg-slate-950 px-3 text-xs font-black text-white">
                      عرض الفاتورة
                    </button>
                  ) : null}
                </div>
              );}) : <EmptyState title="لا توجد إشعارات" body="ستظهر هنا الإشعارات الحية عند وصولها." />}
            </div>
            {hasMoreNotifications ? (
              <button type="button" onClick={() => setShowMoreNotifications((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800">
                {showMoreNotifications ? "عرض أقل" : "عرض المزيد"}
              </button>
            ) : null}
          </Card>

          <Card title="التنبيهات الذكية" subtitle="التنبيهات الذكية" icon={Bot} compact bodyClassName="space-y-2">
            <div className="space-y-1.5">
              {visibleAiInsights.map((insight, index) => (
                <div key={`${insight.title || index}`} className="rounded-2xl border border-slate-200 bg-white p-2.5 text-sm font-semibold leading-5 text-slate-800 shadow-sm">
                  <div className="text-xs font-black text-slate-600">{insightTitleLabel(insight.type, insight.title)}</div>
                  <div className="mt-1 line-clamp-3">{renderInsightBody(insight)}</div>
                </div>
              ))}
              {!aiInsights.length ? <EmptyState title="لا توجد رؤى" body="إذا لم توجد بيانات حقيقية فلن نضيف افتراضات." /> : null}
            </div>
            {hasMoreAiInsights ? (
              <button type="button" onClick={() => setShowMoreAiInsights((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                {showMoreAiInsights ? "عرض أقل" : "عرض المزيد"}
              </button>
            ) : null}
          </Card>

          <Card title="العملاء الساخنون" subtitle="العملاء الساخنون" icon={Store} compact bodyClassName="space-y-2">
            <div className="space-y-1.5">
              {visibleLeads.length ? visibleLeads.map((lead) => (
                <div key={leadIdentity(lead)} className="rounded-2xl border border-slate-200 bg-white p-2.5 text-sm font-semibold leading-5 text-slate-800 shadow-sm">
                  <div className="font-black text-slate-950">{leadName(lead)}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{leadChannel(lead)} · الدرجة {formatNumber(lead.lead_score || 0)}</div>
                  <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-600">{leadPreview(lead)}</div>
                  <button type="button" onClick={() => setActiveTab("chat")} className="mt-2 inline-flex h-9 items-center justify-center rounded-xl bg-slate-950 px-3 text-xs font-black text-white">
                    فتح المحادثة
                  </button>
                </div>
              )) : <EmptyState title="لا توجد عملاء محتملون ساخنون" body="سيظهر هنا المصدر الحقيقي عند توفره." />}
            </div>
            {hasMoreLeads ? (
              <button type="button" onClick={() => setShowMoreLeads((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                {showMoreLeads ? "عرض أقل" : "عرض المزيد"}
              </button>
            ) : null}
          </Card>

          <Card title="المخزون المنخفض" subtitle="المخزون المنخفض" icon={Package} compact bodyClassName="space-y-2">
            <div className="space-y-1.5">
              {visibleLowStock.length ? visibleLowStock.map((item) => (
                <div key={`${item.id}-${item.name}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm">
                  <div className="font-black text-slate-950"><InlineName>{portalText(item.name || "-")}</InlineName></div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{portalText(item.color || item.size || "")} · {formatNumber(item.stock || 0)}</div>
                </div>
              )) : <EmptyState title="لا توجد عناصر منخفضة" body="لن نعرض مخزونًا منخفضًا غير موجود في المصدر." />}
            </div>
            {hasMoreLowStock ? (
              <button type="button" onClick={() => setShowMoreLowStock((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800">
                {showMoreLowStock ? "عرض أقل" : "عرض المزيد"}
              </button>
            ) : null}
          </Card>
        </aside>
      </div>

      <nav className="manager-bottom-nav-safe-padding fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl rounded-[1.6rem] border border-slate-800 bg-[linear-gradient(180deg,#020617,#0f172a)] p-2 shadow-2xl shadow-slate-900/30 lg:hidden">
        <div className="grid grid-cols-6 gap-1">
          {TABS.map((tab) => {
            const active = activeTab === tab;
            const label = tab === "today" ? "اليوم" : tab === "staff" ? "الفريق" : tab === "tasks" ? "المهام" : tab === "sales" ? "المبيعات" : tab === "chat" ? "الشات" : "المزيد";
            const icon = tab === "today" ? Store : tab === "staff" ? Users : tab === "tasks" ? ClipboardList : tab === "sales" ? ShoppingCart : tab === "chat" ? MessageSquare : Bell;
            const Icon = icon;
            return (
              <button key={tab} type="button" data-testid={`tab-${tab}`} onClick={() => setActiveTab(tab)} className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-black transition ${active ? "bg-[linear-gradient(180deg,#ffffff,#e2e8f0)] text-slate-950 shadow-sm" : "text-slate-300"}`}>
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

      {invoiceSheet.open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 sm:items-center">
          <button type="button" aria-label="إغلاق تفاصيل الفاتورة" onClick={() => setInvoiceSheet({ open: false, loading: false, invoice: null, error: "" })} className="absolute inset-0" />
          <section className="relative max-h-[92dvh] w-full max-w-3xl overflow-hidden rounded-t-[2rem] border border-slate-200 bg-white shadow-2xl sm:rounded-[2rem]" dir="rtl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-950 px-4 py-4 text-white">
              <div>
                <div className="text-xs font-black text-slate-300">تفاصيل الفاتورة</div>
                <h2 className="mt-1 text-xl font-black text-white">{invoiceSheet.invoice?.invoice_number || "فاتورة"}</h2>
              </div>
              <button type="button" onClick={() => setInvoiceSheet({ open: false, loading: false, invoice: null, error: "" })} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(92dvh-5rem)] overflow-y-auto px-4 py-4">
              {invoiceSheet.loading ? (
                <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>
              ) : invoiceSheet.error ? (
                <EmptyState title="تعذر تحميل الفاتورة" body={invoiceSheet.error} />
              ) : invoiceSheet.invoice ? (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["رقم الفاتورة", invoiceSheet.invoice.invoice_number],
                      ["رقم الطلب", invoiceSheet.invoice.public_order_number || invoiceSheet.invoice.order_id || invoiceSheet.invoice.id || "-"],
                      ["الحالة", invoiceSheet.invoice.status || "-"],
                      ["التاريخ", formatDateTime(invoiceSheet.invoice.created_at)],
                      ["العميل", invoiceSheet.invoice.customer_name || "عميل نقدي"],
                      ["الهاتف", invoiceSheet.invoice.customer_phone || "-"],
                      ["العنوان", invoiceSheet.invoice.customer_address || "-"],
                      ["نوع العميل", invoiceSheet.invoice.customer_type || "-"],
                      ["البائع", invoiceSheet.invoice.seller_name || "-"],
                      ["الكاشير", invoiceSheet.invoice.cashier_name || invoiceSheet.invoice.seller_name || "-"],
                      ["الفرع", invoiceSheet.invoice.branch_name || "-"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm">
                        <div className="text-xs font-black text-slate-500">{label}</div>
                        <div className="mt-1 font-black text-slate-950">{value}</div>
                      </div>
                    ))}
                  </div>

                  <Card title="الدفع" subtitle="طريقة الدفع / التقسيم" icon={ArrowLeftRight} compact>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 shadow-sm">
                        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />{paymentMethodLabel(invoiceSheet.invoice.payment_method)}</span>
                        <span className="text-slate-950">{portalText(invoiceSheet.invoice.payment_status || "")}</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {[
                          ["المدفوع", formatCurrency(invoiceSheet.invoice.paid_amount || 0)],
                          ["المتبقي", formatCurrency(invoiceSheet.invoice.remaining_amount || 0)],
                          ["COD", invoiceSheet.invoice.cod_amount ? formatCurrency(invoiceSheet.invoice.cod_amount) : "-"],
                          ["إثبات الدفع", invoiceSheet.invoice.transfer_proof_status || "-"],
                          ["الخزينة / الحساب", invoiceSheet.invoice.treasury_name || "-"],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold shadow-sm">
                            <div className="text-slate-500">{label}</div>
                            <div className="mt-1 text-slate-950">{value}</div>
                          </div>
                        ))}
                      </div>
                      {Array.isArray(invoiceSheet.invoice.payment_breakdown) && invoiceSheet.invoice.payment_breakdown.length ? invoiceSheet.invoice.payment_breakdown.map((row, index) => (
                        <div key={`${row.method || row.payment_method || index}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold shadow-sm">
                          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-slate-900" />{paymentMethodLabel(row.method || row.payment_method)}</span>
                          <span className="text-slate-950">{formatCurrency(row.amount || row.total || 0)}</span>
                        </div>
                      )) : null}
                    </div>
                  </Card>

                  <Card title="المنتجات" subtitle="قائمة المنتجات" icon={Package} compact>
                    <div className="space-y-2">
                      {(invoiceSheet.invoice.items || []).length ? invoiceSheet.invoice.items.map((item) => (
                        <div key={item.id || `${item.product_name}-${item.variant_id}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            {item.image_url ? (
                              <img src={item.image_url} alt="" className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 object-cover" loading="lazy" />
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <div className="font-black text-slate-950"><InlineName>{portalText(item.product_name || "منتج")}</InlineName></div>
                              <div className="mt-1 text-xs font-bold text-slate-500">{portalText(item.color || "-")} · {portalText(item.size || "-")} · {formatNumber(item.quantity || 0)} قطعة</div>
                              <div className="mt-1 text-[11px] font-bold text-slate-500">{[item.sku ? `SKU ${item.sku}` : "", item.barcode ? `Barcode ${item.barcode}` : ""].filter(Boolean).join(" · ") || "-"}</div>
                            </div>
                            <div className="shrink-0 text-left">
                              <div className="font-black text-slate-950">{formatCurrency(item.line_total || 0)}</div>
                              <div className="text-xs font-bold text-slate-500">{formatCurrency(item.price || 0)}</div>
                              {Number(item.discount_amount || 0) ? <div className="text-[11px] font-bold text-rose-500">-{formatCurrency(item.discount_amount)}</div> : null}
                            </div>
                          </div>
                        </div>
                      )) : <EmptyState compact title="لا توجد منتجات" body="لم ترجع الفاتورة أي بنود." />}
                    </div>
                  </Card>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["الإجمالي قبل الخصم", formatCurrency(invoiceSheet.invoice.subtotal || 0)],
                      ["الخصم", formatCurrency(invoiceSheet.invoice.discount || 0)],
                      ["الشحن", formatCurrency(invoiceSheet.invoice.shipping || 0)],
                      ["الضريبة", formatCurrency(invoiceSheet.invoice.tax || 0)],
                      ["الإجمالي", formatCurrency(invoiceSheet.invoice.total || 0)],
                      ["المدفوع", formatCurrency(invoiceSheet.invoice.paid_amount || 0)],
                      ["المتبقي", formatCurrency(invoiceSheet.invoice.remaining_amount || 0)],
                      ...(invoiceSheet.invoice.permissions?.can_view_profit ? [
                        ["التكلفة", formatCurrency(invoiceSheet.invoice.cost || 0)],
                        ["الربح", formatCurrency(invoiceSheet.invoice.profit || 0)],
                      ] : []),
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold shadow-sm">
                        <span className="text-slate-500">{label}</span>
                        <span className="text-slate-950">{value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-5">
                    <button type="button" disabled={!invoiceSheet.invoice.public_invoice_url} onClick={() => window.open(invoiceSheet.invoice.public_invoice_url, "_blank", "noopener,noreferrer")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#0f172a,#111827)] px-3 text-sm font-black text-white shadow-sm disabled:opacity-45 dark:bg-white dark:text-slate-950">
                      <ExternalLink className="h-4 w-4" />
                      عرض الفاتورة العامة
                    </button>
                    <button type="button" disabled={!invoiceSheet.invoice.public_invoice_url} onClick={() => copyText(invoiceSheet.invoice.public_invoice_url, "تم نسخ رابط الفاتورة")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] px-3 text-sm font-black text-slate-800 shadow-sm disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                      <Copy className="h-4 w-4" />
                      نسخ الرابط
                    </button>
                    <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] px-3 text-sm font-black text-slate-800 shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                      <Printer className="h-4 w-4" />
                      طباعة
                    </button>
                    <button type="button" disabled={!invoiceSheet.invoice.customer_phone} onClick={() => openWhatsappShare(invoiceSheet.invoice)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-black text-emerald-800 shadow-sm disabled:opacity-45 dark:bg-emerald-400/10 dark:text-emerald-100">
                      <MessageSquare className="h-4 w-4" />
                      مشاركة واتساب
                    </button>
                    <button type="button" onClick={() => setInvoiceSheet({ open: false, loading: false, invoice: null, error: "" })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] px-3 text-sm font-black text-slate-800 shadow-sm">
                      <X className="h-4 w-4" />
                      إغلاق
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
