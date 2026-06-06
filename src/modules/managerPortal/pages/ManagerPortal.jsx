import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  Loader2,
  MessageSquare,
  Megaphone,
  Medal,
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
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { formatCurrency } from "../../../shared/lib/currency";
import { dedupeChatMessages, dedupeChatThreads, mergeChatMessages, mergeChatThreads } from "../../../shared/lib/chatState";
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
const ARABIC_LETTER_RE = /[\u0600-\u06FF]/g;
const HAS_ARABIC_LETTER_RE = /[\u0600-\u06FF]/;
const MOJIBAKE_HINT_RE = /[ØÙÃÂÐ�]|Ã|Â|Ø|Ù/;
const MOJIBAKE_SEQUENCE_RE = /(ط[اأإآء-ي]|ظ[اأإآء-ي]|Ø.|Ù.|Ã.|Â.|Ð.){2,}/;
const BACKEND_TEXT_FIELD_KEYS = new Set([
  "title",
  "message",
  "body",
  "text",
  "description",
  "note",
  "name",
  "full_name",
  "employee_name",
  "branch_name",
  "customer_name",
  "product_name",
  "ai_insight",
  "seller_name",
  "department",
  "job_title",
  "label",
  "display_name",
  "summary",
  "reason",
  "content",
  "last_message",
  "attachment_name",
  "latest_attachment_name",
  "color_name",
  "replacement_size",
]);
const BACKEND_TEXT_FIELD_HINT_RE = /(?:_?(?:title|message|body|text|description|note|name|label|summary|reason|content))$/i;
const BACKEND_TEXT_FIELD_EXCLUDE_RE = /(?:^|_)(?:category|type|status|route|url|action_url|branch_scope|permission|tag|code|id|token)$/i;
const latin1BytesToText = (value, encoding = "utf-8") => {
  if (typeof TextDecoder === "undefined") return value;
  try {
    const bytes = Uint8Array.from(String(value), (char) => char.charCodeAt(0) & 0xff);
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return value;
  }
};
const escapeDecodeText = (value) => {
  try {
    return decodeURIComponent(escape(String(value)));
  } catch {
    return value;
  }
};
const scoreMojibakeCandidate = (value) => {
  const text = String(value || "");
  const arabic = (text.match(ARABIC_LETTER_RE) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const mojibake = (text.match(MOJIBAKE_HINT_RE) || []).length;
  const replacement = (text.match(/�/g) || []).length;
  const mixedSequence = (text.match(MOJIBAKE_SEQUENCE_RE) || []).length;
  return arabic * 5 - latin * 3 - mojibake * 7 - replacement * 8 - mixedSequence * 5;
};
const safeDecodeMojibake = (value) => {
  if (typeof value !== "string" || !value) return value;
  const hasHint = MOJIBAKE_HINT_RE.test(value);
  const hasSequence = MOJIBAKE_SEQUENCE_RE.test(value);
  if (!hasHint && !hasSequence) return value;

  const candidates = new Set([value]);
  const queue = [value];
  const transforms = [
    (input) => latin1BytesToText(input, "utf-8"),
    (input) => latin1BytesToText(input, "windows-1256"),
    (input) => escapeDecodeText(input),
  ];

  for (let depth = 0; depth < 2; depth += 1) {
    const frontier = queue.splice(0, queue.length);
    for (const current of frontier) {
      for (const transform of transforms) {
        const next = transform(current);
        if (typeof next !== "string" || !next || next === current || candidates.has(next)) continue;
        candidates.add(next);
        queue.push(next);
      }
    }
  }

  let best = value;
  let bestScore = scoreMojibakeCandidate(value);
  for (const candidate of candidates) {
    const nextScore = scoreMojibakeCandidate(candidate);
    const candidateArabic = (candidate.match(ARABIC_LETTER_RE) || []).length;
    const currentArabic = (best.match(ARABIC_LETTER_RE) || []).length;
    const clearlyBetter = nextScore >= bestScore + 4 && candidateArabic >= currentArabic && !MOJIBAKE_HINT_RE.test(candidate) && !MOJIBAKE_SEQUENCE_RE.test(candidate);
    if (clearlyBetter) {
      best = candidate;
      bestScore = nextScore;
    }
  }

  return best;
};
const shouldDecodeBackendField = (key) => {
  if (!key || typeof key !== "string") return false;
  if (BACKEND_TEXT_FIELD_EXCLUDE_RE.test(key)) return false;
  if (BACKEND_TEXT_FIELD_KEYS.has(key)) return true;
  return BACKEND_TEXT_FIELD_HINT_RE.test(key) || key.endsWith("_name") || key.endsWith("_title") || key.endsWith("_message");
};
const normalizeManagerPortalValue = (value, key = "") => {
  if (typeof value === "string") return shouldDecodeBackendField(String(key)) ? safeDecodeMojibake(value) : value;
  if (Array.isArray(value)) return value.map((item) => normalizeManagerPortalValue(item, key));
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, normalizeManagerPortalValue(item, childKey)]));
  }
  return value;
};
const collectSuspiciousManagerPortalStrings = (value, path = "", results = [], seen = new WeakSet()) => {
  if (typeof value === "string") {
    if (MOJIBAKE_HINT_RE.test(value) || MOJIBAKE_SEQUENCE_RE.test(value)) {
      const decoded = safeDecodeMojibake(value);
      results.push({ path, value, decoded, fixed: decoded !== value });
    }
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
if (import.meta.env.DEV) {
  const decoderCases = [
    ["مرحباً بك", "مرحباً بك"],
    ["مبيعات اليوم", "مبيعات اليوم"],
    ["إعدادات التنبيه", "إعدادات التنبيه"],
    ["Ø§Ù„Ù…Ø¨ÙŠØ¹Ø§Øª", "المبيعات"],
    ["ط§ظ„ظ…ط¨ظٹط¹ط§طھ", "المبيعات"],
  ];
  for (const [input, expected] of decoderCases) {
    const actual = safeDecodeMojibake(input);
    console.assert(actual === expected, "[manager-portal:decoder]", { input, expected, actual });
  }
}
const MANAGER_NOTIFICATION_CATEGORIES = [
  { key: "all", label: "All", icon: Bell },
  { key: "employee_chat", label: "Employee chat", icon: MessageSquare },
  { key: "task_completed", label: "Task completed", icon: CheckCircle2 },
  { key: "task_overdue", label: "Task overdue", icon: AlertTriangle },
  { key: "attendance", label: "Attendance", icon: Clock3 },
  { key: "sales", label: "Sales", icon: ShoppingCart },
  { key: "stock", label: "Stock", icon: Package },
  { key: "ai_leads", label: "AI leads", icon: Bot },
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
  if (type.includes("task_overdue")) return "Task overdue";
  if (type.includes("task_completed")) return "Task completed";
  if (type.includes("employee") || type.includes("chat") || type.includes("message")) return "Employee message";
  if (type.includes("attendance")) return "Attendance";
  if (type.includes("lead") || type.includes("ai")) return "AI lead";
  if (type.includes("stock") || type.includes("inventory") || type.includes("refill") || type.includes("low_stock")) return "Stock alert";
  if (type.includes("sale") || type.includes("order") || type.includes("payment")) return "Sales";
  return portalText(notification.category || notification.type || "Notification");
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
  if (status === "completed") return { label: "Completed", tone: "green" };
  if (status === "overdue") return { label: "Overdue", tone: "red" };
  if (status === "manager_review") return { label: "Needs review", tone: "amber" };
  if (status === "in_progress") return { label: "In progress", tone: "blue" };
  if (status === "rejected" || status === "cancelled") return { label: status, tone: "red" };
  return { label: status || "pending", tone: "slate" };
};
const taskProofUrl = (task = {}) => task.latest_attachment_url || task.proof_url || task.proof_image_url || task.attachment_url || "";
const taskProofLabel = (task = {}) => task.latest_attachment_name || task.latest_attachment_type || (task.attachments_count ? "Proof attachment" : "");

const Badge = ({ children, className = "" }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${className}`}>{children}</span>
);

const Card = ({ title, subtitle, icon: Icon, children, action, className = "", bodyClassName = "", compact = false }) => (
  <section className={`rounded-3xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/80 ${compact ? "p-3" : "p-4"} ${className}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{subtitle}</div>
        <h2 className="mt-1 text-base font-black text-slate-950 dark:text-white">{title}</h2>
      </div>
      {Icon ? <div className="rounded-2xl bg-slate-950/5 p-2 text-slate-700 dark:bg-white/10 dark:text-white"><Icon className="h-4 w-4" /></div> : null}
    </div>
    {action ? <div className="mt-3">{action}</div> : null}
    <div className={`mt-3 ${bodyClassName}`}>{children}</div>
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

const EmptyState = ({ title, body, compact = false }) => (
  <div className={`rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-right font-semibold leading-6 text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 ${compact ? "px-3 py-3 text-xs" : "px-4 py-5 text-sm"}`}>
    <div className="font-black text-slate-800 dark:text-white">{title}</div>
    <div className="mt-1">{body}</div>
  </div>
);

export default function ManagerPortal() {
  const navigate = useNavigate();
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
  const [taskFilters, setTaskFilters] = useState({ status: "all", employee: "", query: "" });
  const [chatBody, setChatBody] = useState("");
  const [settings, setSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() => (isBrowser() && "Notification" in window ? window.Notification.permission : "unsupported"));
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
  const selectedThreadRef = useRef("");
  const selectedTabRef = useRef(activeTab);
  const chatThreadRef = useRef(null);
  const settingsRef = useRef(settings);
  const browserNotificationPermissionRef = useRef(browserNotificationPermission);

  useEffect(() => {
    selectedThreadRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    selectedTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    chatThreadRef.current = chatThread;
  }, [chatThread]);

  useEffect(() => {
    if (!isBrowser()) return;
    window.localStorage.setItem(STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    setSettings((current) => mergeSettings(me?.notification_settings || current));
  }, [me]);

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
        action.includes("assign") ? "Task assigned" :
        action.includes("reassign") ? "Task reassigned" :
        action.includes("complete") || toStatus === "completed" ? "Task completed" :
        action.includes("approve") ? "Task approved" :
        toStatus === "overdue" || fromStatus === "overdue" || action.includes("overdue") ? "Task overdue" :
        "Task updated";
      pushEvent({
        key: `task-${row.id || `${row.task_id || "task"}-${row.created_at || ""}`}`,
        timestamp: row.created_at || row.updated_at || null,
        title: portalText(title),
        detail: [portalText(row.actor_name || "System"), portalText(row.employee_name || row.to_employee_name || ""), portalText(row.note || "")].filter(Boolean).join(" · "),
        tone: toStatus === "completed" || action.includes("complete") ? "green" : toStatus === "overdue" || action.includes("overdue") ? "red" : "blue",
      });
    }
    for (const row of Array.isArray(dashboard?.overview?.recentInvoices) ? dashboard.overview.recentInvoices : []) {
      pushEvent({
        key: `invoice-${row.id || row.invoice_number || row.created_at || ""}`,
        timestamp: row.created_at || null,
        title: portalText(`Invoice ${row.invoice_number || row.id || ""}`.trim()),
        detail: [portalText(row.customer_name || "Walk-in"), formatCurrency(row.total || 0)].filter(Boolean).join(" · "),
        tone: "green",
      });
    }
    for (const row of Array.isArray(refillAlerts) ? refillAlerts : []) {
      pushEvent({
        key: `refill-${row.id || row.created_at || ""}`,
        timestamp: row.created_at || null,
        title: portalText("Display refill"),
        detail: [portalText(row.product_name || "Refill alert"), [portalText(row.color_name || row.color || ""), portalText(row.replacement_size || "")].filter(Boolean).join(" · ")].filter(Boolean).join(" · "),
        tone: "amber",
      });
    }
    for (const row of Array.isArray(dashboard?.new_leads) ? dashboard.new_leads : []) {
      pushEvent({
        key: `lead-${row.session_id || row.id || row.updated_at || ""}`,
        timestamp: row.updated_at || row.created_at || null,
        title: portalText("AI lead"),
        detail: [portalText(row.ai_insight || row.session_id || "Lead"), `Score ${formatNumber(row.lead_score || 0)}`].filter(Boolean).join(" · "),
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
  const visibleNotifications = showMoreNotifications ? filteredManagerNotifications : filteredManagerNotifications.slice(0, 5);
  const hasMoreNotifications = filteredManagerNotifications.length > visibleNotifications.length;
  const visibleAiInsights = showMoreAiInsights ? aiInsights : aiInsights.slice(0, 3);
  const hasMoreAiInsights = aiInsights.length > visibleAiInsights.length;
  const visibleLeads = showMoreLeads ? (dashboard?.new_leads || []) : (dashboard?.new_leads || []).slice(0, 3);
  const hasMoreLeads = (dashboard?.new_leads || []).length > visibleLeads.length;
  const visibleLowStock = showMoreLowStock ? lowStock : lowStock.slice(0, 3);
  const hasMoreLowStock = lowStock.length > visibleLowStock.length;
  const selectedChatThread = useMemo(() => {
    if (chatThread?.id) return chatThread;
    return chatThreads.find((thread) => String(thread.id) === String(selectedThreadId)) || null;
  }, [chatThread, chatThreads, selectedThreadId]);
  const selectedChatEmployee = useMemo(() => {
    const threadEmployeeId = selectedChatThread?.employee_id ? String(selectedChatThread.employee_id) : "";
    if (!threadEmployeeId) return null;
    const staffEmployee = staffList.find((employee) => String(employee.employee_id) === threadEmployeeId) || null;
    return staffEmployee
      ? {
        ...selectedChatThread,
        ...staffEmployee,
        employee_name: portalText(selectedChatThread?.employee_name || staffEmployee.employee_name || staffEmployee.full_name || "Employee"),
        employee_code: portalText(selectedChatThread?.employee_code || staffEmployee.employee_code || ""),
        branch_name: portalText(selectedChatThread?.branch_name || staffEmployee.branch_name || ""),
      }
      : selectedChatThread;
  }, [selectedChatThread, staffList]);
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
    const title = safeDecodeMojibake(notification.title || "Notification");
    const message = safeDecodeMojibake(notification.message || notification.body || "");
    const priority = String(notification.priority || "medium");
    const tone = priority === "critical" || priority === "high" ? "high" : "normal";
    if (enabled.toast !== false) {
      const body = message ? `${title} آ· ${message}` : title;
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
      setMe(normalizeManagerPortalPayload("me", meRes?.manager || meRes?.data?.manager || null));
      setDashboard(normalizeManagerPortalPayload("dashboard", dashboardRes?.dashboard || null));
      setStaff(normalizeManagerPortalPayload("staff", staffRes?.staff || null));
      setTasks(normalizeManagerPortalPayload("tasks", tasksRes?.tasks || null));
      setSales(normalizeManagerPortalPayload("sales", salesRes?.sales || null));
      setStockAlerts(normalizeManagerPortalPayload("stockAlerts", stockRes?.stockAlerts || null));
      setNotifications(normalizeManagerPortalPayload("notifications", Array.isArray(notificationsRes?.notifications) ? notificationsRes.notifications : []));
      setUnreadCount(Number(notificationsRes?.unread_count || 0));
      setSettings(mergeSettings(normalizeManagerPortalPayload("settings", notificationsRes?.settings || meRes?.notification_settings || {})));
      setChatThreads(normalizeManagerPortalPayload("chatThreads", dedupeChatThreads(Array.isArray(chatRes?.threads) ? chatRes.threads : [])));
      if (!selectedThreadRef.current && Array.isArray(chatRes?.threads) && chatRes.threads[0]?.id) {
        setSelectedThreadId(String(chatRes.threads[0].id));
      }
      if (!selectedThreadRef.current && chatRes?.thread?.id) {
        setSelectedThreadId(String(chatRes.thread.id));
        setChatThread(normalizeManagerPortalPayload("chatThread", chatRes.thread));
        setChatMessages(normalizeManagerPortalPayload("chatMessages", dedupeChatMessages(Array.isArray(chatRes.messages) ? chatRes.messages : [], chatRes.thread)));
      }
    } catch (loadError) {
      setError(loadError?.responseBody?.message || loadError?.message || "طھط¹ط°ط± طھط­ظ…ظٹظ„ ط¨ظˆط§ط¨ط© ط§ظ„ظ…ط¯ظٹط±.");
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

    const refreshChat = () => {
      if (selectedTabRef.current !== "chat") return;
      const threadId = String(selectedThreadRef.current || "");
      if (!threadId) {
        managerPortalApi.chat(token).then((response) => {
          setChatThreads(dedupeChatThreads(Array.isArray(response?.threads) ? response.threads : []));
        }).catch(() => null);
        return;
      }
      managerPortalApi.chatThread(token, threadId).then((response) => {
        setChatThread(response?.thread || null);
        setChatMessages(dedupeChatMessages(Array.isArray(response?.messages) ? response.messages : [], response?.thread || chatThreadRef.current));
        setChatThreads((current) => mergeChatThreads(current, [response?.thread].filter(Boolean)));
      }).catch(() => null);
    };

    socket.on("connect", refreshChat);
    socket.io.on("reconnect", refreshChat);
    socket.on("notification:new", (payload) => {
      const next = payload || {};
      upsertNotification(next);
      void notifyClient(next);
    });
    socket.on("notification:count:refresh", () => {
      managerPortalApi.notifications(token, { limit: 40 }).then((response) => {
        setNotifications(normalizeManagerPortalPayload("socketNotifications", Array.isArray(response?.notifications) ? response.notifications : []));
        setUnreadCount(Number(response?.unread_count || 0));
      }).catch(() => null);
    });
    socket.on("employee-chat:new-message", (payload) => {
      const threadId = String(payload?.thread?.id || payload?.thread_id || "");
      if (!threadId) return;
      setChatThreads((current) => normalizeManagerPortalPayload("socketChatThreads", mergeChatThreads(current, payload.thread ? [payload.thread] : [])));
      if (payload?.message) {
        setChatMessages((current) => normalizeManagerPortalPayload("socketChatMessages", mergeChatMessages(current, [payload.message], payload.thread || chatThreadRef.current || null)));
      }
      if (selectedThreadRef.current && String(selectedThreadRef.current) === threadId) {
        if (payload.thread) setChatThread((current) => normalizeManagerPortalPayload("socketChatThread", current ? { ...current, ...payload.thread } : payload.thread));
        managerPortalApi.chatThread(token, threadId).then((response) => {
          if (response?.thread) {
            setChatThread((current) => normalizeManagerPortalPayload("socketChatThreadReload", current ? { ...current, ...response.thread } : response.thread));
          }
          setChatMessages((current) => normalizeManagerPortalPayload("socketChatMessagesReload", mergeChatMessages(current, Array.isArray(response?.messages) ? response.messages : [], response?.thread || payload?.thread || chatThreadRef.current || null)));
        }).catch(() => null);
      }
    });
    socket.on("employee-chat:thread-updated", (payload) => {
      const nextThread = payload?.thread;
      if (!nextThread?.id) return;
      setChatThreads((current) => normalizeManagerPortalPayload("socketThreadUpdated", mergeChatThreads(current, [nextThread])));
      if (selectedThreadRef.current && String(selectedThreadRef.current) === String(nextThread.id)) {
        setChatThread((current) => normalizeManagerPortalPayload("socketThreadUpdatedCurrent", current ? { ...current, ...nextThread } : nextThread));
      }
    });
    socket.on("employee-chat:read", (payload) => {
      const threadId = String(payload?.thread_id || "");
      if (!threadId) return;
      if (selectedThreadRef.current && String(selectedThreadRef.current) === threadId) {
        managerPortalApi.chatThread(token, threadId).then((response) => {
          if (response?.thread) {
            setChatThread((current) => normalizeManagerPortalPayload("socketThreadRead", current ? { ...current, ...response.thread } : response.thread));
          }
          setChatMessages((current) => normalizeManagerPortalPayload("socketThreadReadMessages", mergeChatMessages(current, Array.isArray(response?.messages) ? response.messages : [], response?.thread || chatThreadRef.current || null)));
        }).catch(() => null);
      }
    });

    return () => {
      socket.off("connect", refreshChat);
      socket.io.off("reconnect", refreshChat);
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
      if (tab === "chat") {
        const response = await managerPortalApi.chat(token, selectedThreadId || null);
        setChatThreads((current) => normalizeManagerPortalPayload("chatThreadsReload", mergeChatThreads(current, Array.isArray(response?.threads) ? response.threads : [])));
        if (response?.thread) {
          setChatThread((current) => normalizeManagerPortalPayload("chatThreadReload", current ? { ...current, ...response.thread } : response.thread));
          setChatMessages((current) => normalizeManagerPortalPayload("chatMessagesReload", mergeChatMessages(current, Array.isArray(response.messages) ? response.messages : [], response.thread || chatThreadRef.current || null)));
        }
      }
    } catch (reloadError) {
      toast.error(reloadError?.responseBody?.message || reloadError?.message || "طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ");
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
      toast.error(readError?.responseBody?.message || readError?.message || "طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ط¥ط´ط¹ط§ط±");
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
      toast.error(readError?.responseBody?.message || readError?.message || "طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ");
    }
  };

  const openNotification = async (notification) => {
    if (!notification?.id) return;
    await markNotificationRead(notification.id);
    setNotificationsOpen(false);
    if (notification.action_url) navigate(notification.action_url);
  };

  const saveSettings = async (nextSettings) => {
    setSettings(nextSettings);
    try {
      const response = await managerPortalApi.updateSettings(token, { notification_settings: nextSettings });
      if (response?.notification_settings) setSettings(response.notification_settings.notifications || nextSettings);
      toast.success("طھظ… ط­ظپط¸ ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ");
    } catch (saveError) {
      toast.error(saveError?.responseBody?.message || saveError?.message || "طھط¹ط°ط± ط­ظپط¸ ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ");
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
    toast.success("طھظ… طھظپط¹ظٹظ„ ط§ظ„طµظˆطھ");
  };

  const enableBrowserNotifications = async () => {
    const permission = await requestBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);
    if (permission === "granted") toast.success("طھظ… طھظپط¹ظٹظ„ ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…طھطµظپط­");
    else toast.error("ظ„ظ… ظٹطھظ… طھظپط¹ظٹظ„ ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…طھطµظپط­");
  };

  const selectThread = async (threadId) => {
    setSelectedThreadId(String(threadId));
    try {
      const response = await managerPortalApi.chatThread(token, threadId);
      setChatThread(normalizeManagerPortalPayload("chatThreadSelect", response?.thread || null));
      setChatMessages(normalizeManagerPortalPayload("chatMessagesSelect", dedupeChatMessages(Array.isArray(response?.messages) ? response.messages : [], response?.thread)));
      setChatThreads((current) => normalizeManagerPortalPayload("chatThreadsSelect", mergeChatThreads(current, [response?.thread || current.find((item) => String(item.id) === String(threadId))].filter(Boolean))));
      await managerPortalApi.markChatRead(token, threadId);
    } catch (chatError) {
      toast.error(chatError?.responseBody?.message || chatError?.message || "طھط¹ط°ط± ظپطھط­ ط§ظ„ظ…ط­ط§ط¯ط«ط©");
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
      if (response?.thread) setChatThread((current) => (current ? { ...current, ...response.thread } : response.thread));
      if (response?.message) setChatMessages((current) => mergeChatMessages(current, [response.message], response?.thread || chatThreadRef.current || null));
      await reloadTabData("chat");
    } catch (sendError) {
      toast.error(sendError?.responseBody?.message || sendError?.message || "طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط§ظ„ط±ط³ط§ظ„ط©");
    }
  };

  const sendTaskAction = async (id, action, payload = {}) => {
    try {
      if (action === "approve") await managerPortalApi.approveTask(token, id, payload);
      else if (action === "reject") await managerPortalApi.rejectTask(token, id, payload);
      else if (action === "reopen") await managerPortalApi.reopenTask(token, id, payload);
      else if (action === "note") await managerPortalApi.noteTask(token, id, payload);
      await reloadTabData("tasks");
      toast.success("طھظ… طھط­ط¯ظٹط« ط§ظ„ظ…ظ‡ظ…ط©");
    } catch (taskError) {
      toast.error(taskError?.responseBody?.message || taskError?.message || "طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ظ…ظ‡ظ…ط©");
    }
  };

  const createTask = async () => {
    if (!taskDraft.title.trim()) {
      toast.error("ط£ط¯ط®ظ„ ط¹ظ†ظˆط§ظ† ط§ظ„ظ…ظ‡ظ…ط©");
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
      toast.success("طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ظ…ظ‡ظ…ط©");
    } catch (taskError) {
      toast.error(taskError?.responseBody?.message || taskError?.message || "طھط¹ط°ط± ط¥ظ†ط´ط§ط، ط§ظ„ظ…ظ‡ظ…ط©");
    }
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
          <div>ط§ظ„ظ…ظˆط¸ظپ: {task.assignee_name || task.employee_name || "-"}</div>
          <div>ط§ظ„ظپط±ط¹: {task.branch_name || "-"}</div>
          <div>ط§ظ„ط¥ظ†ط´ط§ط،: {formatDateTime(task.created_at)}</div>
          <div>ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚: {formatDateTime(task.due_at)}</div>
          <div>ط§ظ„ط¨ط¯ط،/ط§ظ„ط¥ظ†ظ‡ط§ط،: {formatDateTime(task.started_at)} / {formatDateTime(task.completed_at)}</div>
          <div>ط§ظ„ظ…ط±ظپظ‚ط§طھ: {formatNumber(task.attachments_count || 0)}</div>
        </div>
        {proofUrl ? (
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]">
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
            ط§ط¹طھظ…ط§ط¯
          </button>
          <button type="button" data-testid={`task-reject-${task.id}`} onClick={() => void sendTaskAction(task.id, "reject", { note })} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            <X className="h-4 w-4" />
            ط±ظپط¶ / ط¥ط¹ط§ط¯ط©
          </button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button type="button" data-testid={`task-reopen-${task.id}`} onClick={() => void sendTaskAction(task.id, "reopen", { note })} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
            <ArrowLeftRight className="h-4 w-4" />
            ط¥ط¹ط§ط¯ط© ظپطھط­
          </button>
          <button type="button" data-testid={`task-note-${task.id}`} onClick={() => void sendTaskAction(task.id, "note", { note })} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
            <SquarePen className="h-4 w-4" />
            ط¥ط¶ط§ظپط© ظ…ظ„ط§ط­ط¸ط©
          </button>
        </div>
        <textarea value={note} onChange={(event) => setTaskNotes((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="ظ…ظ„ط§ط­ط¸ط© ط§ظ„ظ…ط¯ظٹط±" rows={2} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
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
          <h1 className="mt-4 text-2xl font-black">ط¨ظˆط§ط¨ط© ط§ظ„ظ…ط¯ظٹط± ط؛ظٹط± ظ…طھط§ط­ط©</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{error}</p>
          <button type="button" onClick={() => loadAll()} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-950">
            <RefreshCw className="h-4 w-4" />
            ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©
          </button>
        </div>
      </main>
    );
  }

  return (
    <main data-testid="manager-portal-root" dir="rtl" className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_24%),radial-gradient(circle_at_80%_10%,_rgba(16,185,129,0.14),_transparent_28%),linear-gradient(180deg,#eff6ff_0%,#f8fafc_44%,#ffffff_100%)] px-3 py-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-slate-950 dark:bg-slate-950 dark:text-white md:px-4 md:py-4">
      <div className="mx-auto grid max-w-[96rem] gap-4 lg:grid-cols-[240px_minmax(0,1.55fr)_320px]">
        <aside className="hidden min-h-[calc(100dvh-2rem)] rounded-[2rem] border border-white/60 bg-white/80 p-4 shadow-xl shadow-slate-200/70 backdrop-blur dark:border-white/10 dark:bg-slate-900/80 lg:block">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-950 p-3 text-white">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Manager Command Center</div>
              <div className="text-lg font-black">{portalText(me?.full_name || me?.name || "Manager")}</div>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-3xl bg-slate-950 p-4 text-white">
              <div className="text-xs font-black text-white/60">ط§ظ„ظٹظˆظ…</div>
              <div className="mt-2 text-3xl font-black">{formatCurrency(dashboard?.today_sales_total || 0)}</div>
              <div className="mt-2 text-sm font-semibold text-white/70">{formatNumber(dashboard?.invoice_count || 0)} ظپط§طھظˆط±ط© ط§ظ„ظٹظˆظ…</div>
            </div>
            <button type="button" data-testid="refresh-button-mobile" onClick={() => void loadAll({ silent: true })} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
              <span>طھط­ط¯ظٹط« ظ…ط¨ط§ط´ط±</span>
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
                <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-600/70">ط¨ظˆط§ط¨ط© ط§ظ„ظ…ط¯ظٹط±</div>
                <h1 className="mt-1 text-2xl font-black leading-8 text-slate-950 dark:text-white">{portalText(me?.full_name || me?.name || "Manager")}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" /> {portalText(me?.branch_name || "All branches")}</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {portalText(me?.role || "manager")}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100">Live</Badge>
                <div className="flex items-center gap-2">
                  <button
                    ref={notificationButtonRef}
                    type="button"
                    data-testid="manager-notifications-button"
                    aria-label="Open notifications"
                    aria-expanded={notificationsOpen}
                    onClick={() => setNotificationsOpen((current) => !current)}
                    className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:border-sky-300 hover:text-sky-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-white dark:hover:border-cyan-300/35 dark:hover:text-cyan-100"
                  >
                    <Bell className="h-4 w-4" />
                    {(unreadCount || notificationsUnread) ? (
                      <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black leading-4 text-white">
                        {formatNumber(unreadCount || notificationsUnread)}
                      </span>
                    ) : null}
                  </button>
                  <button type="button" data-testid="refresh-button" onClick={() => void loadAll({ silent: true })} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-3 py-2 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                    <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    طھط­ط¯ظٹط«
                  </button>
                </div>
              </div>
            </div>
          </header>

          {notificationsOpen ? (
            <div className="fixed inset-0 z-[70]">
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setNotificationsOpen(false)}
                className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
              />
              <aside
                ref={notificationPanelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="manager-notifications-title"
                className="absolute inset-x-0 bottom-0 top-0 ml-auto flex h-dvh w-full max-w-[40rem] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-[0_24px_90px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-[#07111f] sm:inset-y-0 sm:right-0 sm:w-[min(100vw,38rem)] sm:rounded-l-[2rem]"
              >
                <div className="shrink-0 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/90 sm:px-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-sky-700 dark:border-cyan-300/20 dark:bg-cyan-300/10 dark:text-cyan-100">
                        <Bell className="h-3.5 w-3.5" />
                        Realtime
                      </div>
                      <h2 id="manager-notifications-title" className="mt-3 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
                        Notification Center
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Track employee chats, tasks, attendance, sales, stock, and AI leads in one place.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-cyan-300/35"
                      aria-label="Close notifications"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Unread</div>
                      <div className="mt-1 text-xl font-black text-slate-950 dark:text-white">{formatNumber(unreadCount || notificationsUnread)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Total</div>
                      <div className="mt-1 text-xl font-black text-slate-950 dark:text-white">{formatNumber(managerNotifications.length || 0)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void markAllNotificationsRead()}
                      disabled={!notifications.some((item) => !item.is_read)}
                      className="inline-flex min-h-[4.5rem] flex-col items-start justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-left text-slate-700 transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100 dark:hover:border-cyan-300/35 dark:hover:text-cyan-100"
                    >
                      <CheckCheck className="h-4 w-4" />
                      <span className="mt-1 text-xs font-black">Mark all read</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadAll({ silent: true })}
                      className="inline-flex min-h-[4.5rem] flex-col items-start justify-center rounded-2xl bg-slate-950 px-3 py-2.5 text-left text-white transition hover:bg-slate-800 dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-cyan-200"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                      <span className="mt-1 text-xs font-black">Refresh</span>
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
                              ? "border-slate-950 bg-slate-950 text-white dark:border-cyan-300 dark:bg-cyan-300 dark:text-slate-950"
                              : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{item.label}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${active ? "bg-white/20 text-inherit" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"}`}>
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
                                ? "border-sky-200 bg-white ring-1 ring-sky-100 dark:border-cyan-300/25 dark:bg-white/[0.03] dark:ring-cyan-300/10"
                                : "border-slate-200 bg-white/80 dark:border-white/10 dark:bg-white/[0.02]"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => void openNotification(item)}
                              className="flex w-full items-start gap-3 text-right"
                            >
                              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ${unread ? "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-cyan-300/10 dark:text-cyan-100 dark:ring-cyan-300/20" : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10"}`}>
                                <Icon className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h3 className="truncate text-sm font-black text-slate-950 dark:text-white">{item.title || "Notification"}</h3>
                                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                      {item.message || item.body || "No extra details were provided."}
                                    </p>
                                  </div>
                                  {unread ? <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500 shadow-[0_0_12px_rgba(14,165,233,0.65)] dark:bg-cyan-300" /> : null}
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
                                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-black text-white transition hover:bg-slate-800 dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-cyan-200"
                                >
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                  Open
                                </button>
                              ) : null}
                              {unread ? (
                                <button
                                  type="button"
                                  onClick={() => void markNotificationRead(item.id)}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-sky-300 hover:text-sky-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-cyan-300/35 dark:hover:text-cyan-100"
                                >
                                  <CheckCheck className="h-3.5 w-3.5" />
                                  Mark read
                                </button>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex min-h-[28rem] flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-300 bg-white p-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10">
                        <Bell className="h-8 w-8" />
                      </div>
                      <h3 className="mt-5 text-lg font-black text-slate-950 dark:text-white">No notifications</h3>
                      <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500 dark:text-slate-400">
                        New chat messages, task updates, sales events, and stock alerts will appear here as they arrive.
                      </p>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          ) : null}

          {activeTab === "today" ? (
            <div data-testid="more-panel" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  { label: "Present now", value: formatNumber(dashboard?.active_employees_now || 0), icon: Users, tone: "green" },
                  { label: "Absent", value: formatNumber(dashboard?.absent_employees || 0), icon: X, tone: "slate" },
                  { label: "Late", value: formatNumber(dashboard?.late_employees || 0), icon: Clock3, tone: "amber" },
                  { label: "Open tasks", value: formatNumber(dashboard?.pending_tasks || 0), icon: ClipboardList, tone: "blue" },
                  { label: "Overdue tasks", value: formatNumber(dashboard?.overdue_tasks || 0), icon: AlertTriangle, tone: "red" },
                ].map((card) => (
                  <Card key={card.label} subtitle={card.label} title={card.value} icon={card.icon} className={`border-white/80 ${card.tone === "green" ? "shadow-emerald-100/60" : ""}`} />
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Card title={formatCurrency(dashboard?.today_sales_total || 0)} subtitle="Today sales" icon={ShoppingCart} />
                <Card title={formatNumber(dashboard?.invoice_count || 0)} subtitle="Invoices" icon={ClipboardList} />
                <Card title={formatCurrency(dashboard?.overview?.today?.averageOrderValue || 0)} subtitle="Average order value" icon={ArrowLeftRight} />
              </div>

              <Card title="Operational events" subtitle="Latest 5 actions" icon={Bell}>
                {operationalEvents.length ? (
                  <div className="space-y-2">
                    {operationalEvents.map((event) => (
                      <div key={event.key} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="min-w-0">
                          <div className="text-sm font-black text-slate-950 dark:text-white">{event.title}</div>
                          <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-300">{event.detail || "No additional details"}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <StatusPill tone={event.tone || "slate"} value={formatDateTime(event.timestamp)} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact title="No events yet" body="Task changes, invoices, leads, and refill alerts will appear here as they happen." />
                )}
              </Card>

              <div className="grid gap-3 xl:grid-cols-2">
                <Card title="طھظˆط²ظٹط¹ ط§ظ„ط¯ظپط¹" subtitle="Payment breakdown" icon={ArrowLeftRight}>
                {paymentBreakdown.length ? (
                    <div className="space-y-2">
                      {paymentBreakdown.map((row) => (
                        <div key={row.method} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 dark:bg-white/[0.03] dark:text-slate-200">
                          <span>{portalText(row.method)}</span>
                          <span>{formatCurrency(row.total || 0)} آ· {formatNumber(row.count || 0)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState compact title="No payment data" body="Payments will appear once today has completed invoices." />
                  )}
                </Card>
                <Card title="طھظ†ط¨ظٹظ‡ط§طھ ط§ظ„ط³ط­ط¨ / ط§ظ„ط¹ط±ط¶" subtitle="Stock alerts" icon={Package}>
                  {lowStock.length || refillAlerts.length ? (
                    <div className="space-y-2">
                      {refillAlerts.slice(0, 3).map((alert) => (
                        <div key={`refill-${alert.id}`} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
                          <div className="font-black">{portalText(alert.product_name || "Display refill")}</div>
                          <div className="mt-1 text-xs font-bold opacity-80">{portalText(alert.color_name || alert.color || "")} {alert.replacement_size ? `· ${portalText(alert.replacement_size)}` : ""}</div>
                        </div>
                      ))}
                      {lowStock.slice(0, 3).map((item) => (
                        <div key={`low-${item.id}-${item.name}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                          <div className="font-black">{portalText(item.name || "Unknown item")}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">{formatNumber(item.stock || 0)} ظ…طھط¨ظ‚ظٹ</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState compact title="No stock alerts" body="Low stock and refill alerts will show up when the system detects them." />
                  )}
                </Card>
              </div>

              <Card title="AI insights" subtitle="Simple intelligence" icon={Bot}>
                {aiInsights.length ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {aiInsights.map((item, index) => (
                        <div key={`${item.title || item.body || index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-sky-600/70">{portalText(item.type || "insight")}</div>
                        <div className="mt-1 font-black text-slate-950 dark:text-white">{portalText(item.title || "Insight")}</div>
                        <div className="mt-1">{portalText(item.body || "-")}</div>
                      </div>
                    ))}
                </div>
                ) : (
                  <EmptyState compact title="No live insights" body="Useful signals will appear here once there is enough operational data." />
                )}
              </Card>
            </div>
          ) : null}

          {activeTab === "staff" ? (
            <div className="space-y-3">
              {staffList.length ? staffList.map((employee) => (
                <Card key={employee.employee_id} title={portalText(employee.employee_name || "Employee")} subtitle={portalText(employee.department || employee.job_title || "Staff")} icon={Users}>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={employee.attendance_status === "checked_in" ? "green" : employee.attendance_status === "online" ? "blue" : "slate"} value={portalText(employee.attendance_status || "absent")} />
                    <StatusPill tone="blue" value={portalText(`Tasks ${formatNumber(employee.open_tasks || 0)}/${formatNumber(employee.completed_tasks || 0)}`)} />
                    <StatusPill tone="amber" value={portalText(`Sales ${formatCurrency(employee.sales_today || 0)}`)} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                    <div>{portalText("Attendance")}: {formatTime(employee.check_in_time)} - {formatTime(employee.check_out_time)}</div>
                    <div>{portalText("Shift")}: {Number(employee.shift_duration_hours || 0).toFixed(2)} {portalText("hours")}</div>
                    <div>{portalText("Invoices")}: {formatNumber(employee.invoices_count || 0)}</div>
                    <div>{portalText("Last activity")}: {formatDateTime(employee.last_activity)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{portalText("Expected commission")} {employee.expected_commission == null ? portalText("Unavailable") : formatCurrency(employee.expected_commission || 0)}</Badge>
                    <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{portalText("Open tasks")} {formatNumber(employee.open_tasks || 0)}</Badge>
                  </div>
                </Card>
              )) : (
                <EmptyState title="ظ„ط§ ظٹظˆط¬ط¯ ظ…ظˆط¸ظپظˆظ† ظ„ظ‡ط°ط§ ط§ظ„ظ†ط·ط§ظ‚" body="ط¥ط°ط§ ظ„ظ… ظٹظƒظ† ظ‡ظ†ط§ظƒ ظ…طµط¯ط± ط¨ظٹط§ظ†ط§طھ ط£ظˆ ظ„ظ… طھظƒظ† ظ‡ظ†ط§ظƒ طµظ„ط§ط­ظٹط©طŒ ط³ظ†ط¹ط±ط¶ ط­ط§ظ„ط© ظپط§ط±ط؛ط©." />
              )}
            </div>
          ) : null}

          {activeTab === "tasks" ? (
            <div className="space-y-4">
              <Card title="ط¥ظ†ط´ط§ط، ظ…ظ‡ظ…ط©" subtitle="Create task" icon={Plus}>
                <div className="grid gap-2 md:grid-cols-2">
                  <input value={taskDraft.title} onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))} placeholder="ط¹ظ†ظˆط§ظ† ط§ظ„ظ…ظ‡ظ…ط©" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
                  <select value={taskDraft.assigned_employee_id} onChange={(event) => setTaskDraft((current) => ({ ...current, assigned_employee_id: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]">
                    <option value="">ط¥ط³ظ†ط§ط¯ ط§ط®طھظٹط§ط±ظٹ</option>
                    {staffList.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{portalText(employee.employee_name)}</option>)}
                  </select>
                  <select value={taskDraft.priority} onChange={(event) => setTaskDraft((current) => ({ ...current, priority: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]">
                    <option value="low">ظ…ظ†ط®ظپط¶ط©</option>
                    <option value="medium">ظ…طھظˆط³ط·ط©</option>
                    <option value="high">ط¹ط§ظ„ظٹط©</option>
                    <option value="critical">ط­ط±ط¬ط©</option>
                  </select>
                  <button type="button" data-testid="create-task-button" onClick={createTask} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                    <Plus className="h-4 w-4" />
                    ط¥ظ†ط´ط§ط،
                  </button>
                </div>
                <textarea value={taskDraft.description} onChange={(event) => setTaskDraft((current) => ({ ...current, description: event.target.value }))} placeholder="ط§ظ„ظˆطµظپ" rows={3} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
              </Card>

              <Card title="ط§ظ„ظ…ط±ط´ط­ط§طھ" subtitle="Filters" icon={Search}>
                <div className="grid gap-2 md:grid-cols-4">
                  <input
                    value={taskFilters.query}
                    onChange={(event) => setTaskFilters((current) => ({ ...current, query: event.target.value }))}
                    placeholder="ط§ط¨ط­ط« ظپظٹ ط§ظ„ط¹ظ†ظˆط§ظ† ط£ظˆ ط§ظ„ظ…ظˆط¸ظپ"
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]"
                  />
                  <select
                    value={taskFilters.status}
                    onChange={(event) => setTaskFilters((current) => ({ ...current, status: event.target.value }))}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <option value="all">All statuses</option>
                    <option value="open">Open tasks</option>
                    <option value="completed">Completed tasks</option>
                    <option value="overdue">Overdue tasks</option>
                    <option value="pending">Pending</option>
                    <option value="in_progress">In progress</option>
                    <option value="manager_review">Manager review</option>
                    <option value="reassigned">Reassigned</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <select
                    value={taskFilters.employee}
                    onChange={(event) => setTaskFilters((current) => ({ ...current, employee: event.target.value }))}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <option value="">All employees</option>
                    {employeeFilterOptions.map((employee) => (
                      <option key={employee.value || employee.label} value={employee.value || employee.label}>{employee.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setTaskFilters({ status: "all", employee: "", query: "" })} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    Reset filters
                  </button>
                </div>
              </Card>

              <div className="grid gap-3 sm:grid-cols-3">
                <Card title={formatNumber(taskCounts.open)} subtitle="Open tasks" icon={ClipboardList} />
                <Card title={formatNumber(taskCounts.completed)} subtitle="Completed tasks" icon={CheckCheck} />
                <Card title={formatNumber(taskCounts.overdue)} subtitle="Overdue tasks" icon={AlertTriangle} />
              </div>

              <Card title="Open tasks list" subtitle="Operational queue" icon={ClipboardList}>
                {openTasks.length ? <div className="space-y-3">{openTasks.map((task) => renderTaskCard(task))}</div> : <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ط§ظ… ظ…ظپطھظˆط­ط©" body="ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ط§ظ… ظ…ط·ط§ط¨ظ‚ط© ظ„ظ„ظ…ط±ط´ط­ط§طھ ط§ظ„ط­ط§ظ„ظٹط©." />}
              </Card>

              <Card title="Completed tasks list" subtitle="Proof ready" icon={CheckCheck}>
                {completedTasks.length ? <div className="space-y-3">{completedTasks.map((task) => renderTaskCard(task))}</div> : <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ط§ظ… ظ…ظƒطھظ…ظ„ط©" body="ط§ظ„ظ…ظ‡ط§ظ… ط§ظ„ظ…ظƒطھظ…ظ„ط© ط³طھط¸ظ‡ط± ظ‡ظ†ط§ ظ…ط¹ ظ…ط¹ط§ظٹظ†ط© ط§ظ„ط¥ط«ط¨ط§طھ." />}
              </Card>

              <Card title="Overdue tasks list" subtitle="Needs attention" icon={AlertTriangle}>
                {overdueTasks.length ? <div className="space-y-3">{overdueTasks.map((task) => renderTaskCard(task))}</div> : <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ط§ظ… ظ…طھط£ط®ط±ط©" body="ط§ظ„ظ…ظ‡ط§ظ… ط§ظ„ظ…طھط£ط®ط±ط© ط£ظˆ ط§ظ„ظ…ط³طھط­ظ‚ط© ط³طھط¸ظ‡ط± ظ‡ظ†ط§." />}
              </Card>
            </div>
          ) : null}

          {activeTab === "sales" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card title={formatCurrency(sales?.overview?.today?.sales || dashboard?.today_sales_total || 0)} subtitle="Today sales" icon={ShoppingCart} />
                <Card title={formatNumber(sales?.overview?.today?.orders || dashboard?.invoice_count || 0)} subtitle="Invoices" icon={ClipboardList} />
                {canViewProfit ? <Card title={formatCurrency(sales?.overview?.today?.profit || 0)} subtitle="Profit" icon={SunMedium} /> : <Card title="â€”" subtitle="Profit hidden" icon={SunMedium} />}
                <Card title={formatCurrency(sales?.overview?.today?.averageOrderValue || 0)} subtitle="Average order" icon={ArrowLeftRight} />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title="Top seller" subtitle="30-day leader" icon={Trophy}>
                  {salesLeaders.top_seller ? (
                    <div className="space-y-2 rounded-2xl bg-emerald-50 px-4 py-4 text-slate-900 dark:bg-emerald-500/10 dark:text-white">
                      <div className="text-lg font-black">{portalText(salesLeaders.top_seller.seller_name || "Unknown seller")}</div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>Revenue: {formatCurrency(salesLeaders.top_seller.revenue || 0)}</div>
                        <div>Orders: {formatNumber(salesLeaders.top_seller.orders_count || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="No seller data" body="Sales by seller will appear once orders are linked to employees." />
                  )}
                </Card>
                <Card title="Worst seller" subtitle="30-day laggard" icon={Medal}>
                  {salesLeaders.worst_seller ? (
                    <div className="space-y-2 rounded-2xl bg-amber-50 px-4 py-4 text-slate-900 dark:bg-amber-500/10 dark:text-white">
                      <div className="text-lg font-black">{portalText(salesLeaders.worst_seller.seller_name || "Unknown seller")}</div>
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
                <Card title="Best category" subtitle="30-day category leader" icon={Package}>
                  {bestCategory ? (
                    <div className="space-y-2 rounded-2xl bg-sky-50 px-4 py-4 text-slate-900 dark:bg-sky-500/10 dark:text-white">
                      <div className="text-lg font-black">{portalText(bestCategory.name || "Uncategorized")}</div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>Revenue: {formatCurrency(bestCategory.revenue || 0)}</div>
                        <div>Units: {formatNumber(bestCategory.quantity || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="No category data" body="Category performance appears once sold items can be linked to products." />
                  )}
                </Card>
                <Card title="Best brand" subtitle="30-day brand leader" icon={Store}>
                  {bestBrand ? (
                    <div className="space-y-2 rounded-2xl bg-violet-50 px-4 py-4 text-slate-900 dark:bg-violet-500/10 dark:text-white">
                      <div className="text-lg font-black">{portalText(bestBrand.name || "Unbranded")}</div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>Revenue: {formatCurrency(bestBrand.revenue || 0)}</div>
                        <div>Units: {formatNumber(bestBrand.quantity || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="No brand data" body="Brand performance appears once sold items can be linked to products." />
                  )}
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <Card title="Yesterday vs today" subtitle="Day comparison" icon={ArrowUpRight}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      {
                        label: "Sales",
                        today: formatCurrency(salesComparison.today_sales || sales?.overview?.today?.sales || 0),
                        yesterday: formatCurrency(salesComparison.yesterday_sales || 0),
                        delta: salesComparison.sales_growth || 0,
                      },
                      {
                        label: "Invoices",
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
                        <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{item.label}</div>
                          <div className="mt-2 text-lg font-black text-slate-950 dark:text-white">{item.today}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">Yesterday: {item.yesterday}</div>
                          <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${positive ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-rose-500/10 text-rose-700 dark:text-rose-200"}`}>
                            {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                            {delta >= 0 ? "+" : ""}
                            {formatPercent(delta)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <Card title="Average invoice" subtitle="Ticket size" icon={ClipboardList}>
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-amber-50 px-4 py-4 text-slate-900 dark:bg-amber-500/10 dark:text-white">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Today</div>
                      <div className="mt-2 text-3xl font-black">{formatCurrency(salesComparison.today_average_invoice || sales?.overview?.today?.averageOrderValue || 0)}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                        Yesterday: {formatCurrency(salesComparison.yesterday_average_invoice || 0)}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Today's invoices</div>
                        <div className="mt-1 text-lg font-black text-slate-950 dark:text-white">{formatNumber(salesComparison.today_orders || sales?.overview?.today?.orders || 0)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Growth</div>
                        <div className={`mt-1 inline-flex items-center gap-1 text-lg font-black ${Number(salesComparison.average_invoice_growth || 0) >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
                          {Number(salesComparison.average_invoice_growth || 0) >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                          {Number(salesComparison.average_invoice_growth || 0) >= 0 ? "+" : ""}
                          {formatPercent(salesComparison.average_invoice_growth || 0)}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              <Card title="Last 7 days trend" subtitle="Revenue and invoices" icon={Clock3}>
                {trend7d.length ? (
                  <div className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl bg-slate-50 px-3 py-3 dark:bg-white/[0.03]">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">7-day revenue</div>
                        <div className="mt-1 text-xl font-black text-slate-950 dark:text-white">{formatCurrency(trend7d.reduce((sum, item) => sum + Number(item.revenue || 0), 0))}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-3 dark:bg-white/[0.03]">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">7-day invoices</div>
                        <div className="mt-1 text-xl font-black text-slate-950 dark:text-white">{formatNumber(trend7d.reduce((sum, item) => sum + Number(item.orders || 0), 0))}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-3 dark:bg-white/[0.03]">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Best day</div>
                        <div className="mt-1 text-xl font-black text-slate-950 dark:text-white">
                          {formatShortDay(trend7d.reduce((best, item) => (Number(item.revenue || 0) > Number(best?.revenue || 0) ? item : best), trend7d[0] || {}).day)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-3 dark:bg-white/[0.03]">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Peak revenue</div>
                        <div className="mt-1 text-xl font-black text-slate-950 dark:text-white">{formatCurrency(Math.max(...trend7d.map((item) => Number(item.revenue || 0)), 0))}</div>
                      </div>
                    </div>
                    <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-7">
                      {trend7d.map((item) => {
                        const maxRevenue = Math.max(...trend7d.map((row) => Number(row.revenue || 0)), 1);
                        const height = Math.max(12, Math.round((Number(item.revenue || 0) / maxRevenue) * 100));
                        return (
                          <div key={item.day} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                            <div className="flex h-28 items-end">
                              <div className="w-full rounded-t-xl bg-gradient-to-t from-slate-950 to-sky-500" style={{ height: `${height}%` }} />
                            </div>
                            <div className="mt-3 text-xs font-black text-slate-500 dark:text-slate-300">{formatShortDay(item.day)}</div>
                            <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{formatCurrency(item.revenue || 0)}</div>
                            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{formatNumber(item.orders || 0)} invoices</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <EmptyState title="No 7-day trend" body="Daily trend data will appear after recent orders exist." />
                )}
              </Card>

              <Card title="Conversion indicators" subtitle="Shown only when data exists" icon={Megaphone}>
                {hasConversionIndicators ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Customer-linked orders</div>
                      <div className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{formatNumber(conversionIndicators.customer_linked_orders || 0)}</div>
                      <div className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">{formatPercent(conversionIndicators.customer_link_rate || 0)} of orders</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Online orders</div>
                      <div className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{formatNumber(conversionIndicators.online_orders || 0)}</div>
                      <div className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">{formatPercent(conversionIndicators.online_order_share || 0)} of orders</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">AI chat conversions</div>
                      <div className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{formatNumber(conversionIndicators.ai_confirmed_orders || 0)}</div>
                      <div className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">
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
                  <div key={item.name} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 dark:bg-white/[0.03] dark:text-slate-200">
                    <span>{portalText(item.name)}</span>
                    <span>{formatNumber(item.quantity || 0)} آ· {formatCurrency(item.revenue || 0)}</span>
                  </div>
                )) : <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ظ…ظ†طھط¬ط§طھ ظ…ط¨ظٹط¹ط©" body="ط³ظٹط¸ظ‡ط± ظ‡ظ†ط§ ط£ظپط¶ظ„ ط§ظ„ط¨ط§ط¦ط¹ظٹظ† ط¹ظ†ط¯ طھظˆظپط± ط¨ظٹط§ظ†ط§طھ ظپط¹ظ„ظٹط©." />}
              </Card>
              <Card title={portalText("Hourly trend")} subtitle="Hourly trend" icon={Clock3}>
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
                  <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ط¨ظٹط§ظ†ط§طھ ط³ط§ط¹ظٹط©" body="ط¥ط°ط§ ظ„ظ… طھطھظˆظپط± ظپظˆط§طھظٹط± ط§ظ„ظٹظˆظ…طŒ ط³ظ†ط¨ظ‚ظٹ ط§ظ„ظ„ظˆط­ط© ظپط§ط±ط؛ط©." />
                )}
              </Card>
            </div>
          ) : null}

          {activeTab === "chat" ? (
            <div className="grid min-h-0 gap-4 xl:h-[calc(100dvh-13rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
              <Card
                title={portalText("Conversations")}
                subtitle="Conversations"
                icon={MessageSquare}
                className="flex min-h-0 flex-col overflow-hidden xl:h-full"
                bodyClassName="flex-1 min-h-0"
              >
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
                    WhatsApp style inbox
                  </div>
                  <div className="flex-1 min-h-0 space-y-2 overflow-auto pr-1">
                    {chatThreads.length ? chatThreads.map((thread) => {
                      const active = String(thread.id) === String(selectedThreadId);
                      const lastMessageTime = thread.last_message_created_at || thread.last_message_at || thread.updated_at || thread.created_at;
                      return (
                        <button
                          key={thread.id || thread.employee_id || thread.employee_code}
                          type="button"
                          data-testid={`chat-thread-${thread.id || thread.employee_id || thread.employee_code}`}
                          onClick={() => void selectThread(thread.id)}
                          className={`w-full rounded-[1.4rem] border px-3 py-3 text-right transition ${active ? "border-emerald-300 bg-emerald-50 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/60 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-sky-500/30 dark:hover:bg-sky-500/10"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-950 dark:text-white">{portalText(thread.employee_name || thread.employee_code || "Employee")}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        <span className="truncate">{portalText(thread.branch_name || "No branch")}</span>
                                <span>•</span>
                                <span dir="ltr">{formatDateTime(lastMessageTime)}</span>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-2">
                              <Badge className={`border ${active ? "border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-100" : "border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200"}`}>
                                {formatNumber(thread.unread_count || 0)}
                              </Badge>
                              {thread.last_sender_type ? <StatusPill tone={thread.last_sender_type === "admin" ? "blue" : "green"} value={thread.last_sender_type === "admin" ? "Admin" : "Employee"} /> : null}
                            </div>
                          </div>
                          <div className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">{portalText(thread.last_message || "No message yet.")}</div>
                        </button>
                      );
                    }) : (
                      <EmptyState title="لا توجد محادثات" body="ستظهر المحادثات الحقيقية هنا عند وجودها." />
                    )}
                  </div>
                </div>
              </Card>

              <Card
                title={portalText(selectedChatThread?.employee_name || "اختر محادثة")}
                subtitle="Messages"
                icon={Phone}
                className="flex min-h-0 flex-col overflow-hidden xl:h-full"
                bodyClassName="flex-1 min-h-0"
                action={
                  selectedChatThread ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs font-black text-slate-500 dark:text-slate-300">
                      <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{portalText(selectedChatThread.branch_name || "No branch")}</Badge>
                      <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{selectedChatUnread} unread</Badge>
                      <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{portalText(selectedChatEmployee?.department || selectedChatEmployee?.job_title || "Staff")}</Badge>
                    </div>
                  ) : null
                }
              >
                {selectedChatThread ? (
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    <div className="rounded-[1.5rem] border border-emerald-200/70 bg-[linear-gradient(180deg,rgba(236,253,245,0.96),rgba(255,255,255,0.92))] p-3 dark:border-emerald-500/20 dark:bg-[linear-gradient(180deg,rgba(6,78,59,0.28),rgba(2,6,23,0.6))]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700/80 dark:text-emerald-200/80">Conversation window</div>
                          <div className="mt-1 truncate text-sm font-black text-slate-950 dark:text-white">{portalText(selectedChatEmployee?.employee_name || selectedChatThread.employee_name || "Employee")}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-300">{portalText(selectedChatEmployee?.employee_code || selectedChatThread.employee_code || "-")}</div>
                        </div>
                        <div className="shrink-0">
                          <StatusPill tone={selectedChatAttendanceTone} value={selectedChatAttendanceStatus} />
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 space-y-2 overflow-auto rounded-[1.7rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.98))] p-3 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(2,6,23,0.92))]">
                      {(chatMessages || []).length ? chatMessages.map((message) => {
                        const outgoing = String(message.sender_type) === "admin";
                        return (
                          <div
                            key={message.id || `${message.sender_type || "sender"}-${message.body || message.attachment_name || ""}-${message.created_at || ""}-${selectedChatThread?.employee_id || ""}`}
                            className={`flex ${outgoing ? "justify-start" : "justify-end"}`}
                          >
                            <div className={`max-w-[92%] rounded-[1.4rem] px-3 py-2 text-sm font-semibold leading-6 shadow-sm ${outgoing ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950" : "bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-100"}`}>
                              <div className="flex items-center justify-between gap-3 text-[11px] font-black uppercase tracking-[0.12em] opacity-75">
                                <span>{outgoing ? "الإدارة" : portalText(selectedChatEmployee?.employee_name || "Employee")}</span>
                                <span dir="ltr">{formatDateTime(message.created_at)}</span>
                              </div>
                              <div className="mt-1 whitespace-pre-wrap">{portalText(message.body || message.attachment_name || "Attachment")}</div>
                            </div>
                          </div>
                        );
                      }) : <EmptyState title="لا توجد رسائل" body="افتح أي محادثة لعرض الرسائل الحقيقية." />}
                    </div>

                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <textarea data-testid="chat-message-input" value={chatBody} onChange={(event) => setChatBody(event.target.value)} rows={3} placeholder="اكتب رسالة..." className="w-full rounded-[1.2rem] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
                      <button type="button" data-testid="chat-send-button" onClick={() => void sendChat()} className="inline-flex items-center justify-center gap-2 rounded-[1.2rem] bg-emerald-600 px-4 py-3 text-sm font-black text-white dark:bg-emerald-500 dark:text-slate-950">
                        <SendIconFallback />
                        إرسال
                      </button>
                    </div>
                  </div>
                ) : (
                  <EmptyState title="اختر محادثة" body="ستظهر هنا المحادثة الحالية مع الموظف المحدد." />
                )}
              </Card>

              <Card
                title="ملف الموظف"
                subtitle="Profile summary"
                icon={Building2}
                className="flex min-h-0 flex-col overflow-hidden xl:h-full"
                bodyClassName="flex-1 min-h-0"
              >
                {selectedChatEmployee ? (
                  <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto pr-1">
                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Employee</div>
                      <div className="mt-1 text-lg font-black text-slate-950 dark:text-white">{portalText(selectedChatEmployee.employee_name || selectedChatThread.employee_name || "Employee")}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusPill tone={selectedChatAttendanceTone} value={selectedChatAttendanceStatus} />
                        <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{portalText(selectedChatEmployee.branch_name || selectedChatThread.branch_name || "No branch")}</Badge>
                        <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{portalText(selectedChatEmployee.employee_code || "No code")}</Badge>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Last activity</div>
                        <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{formatDateTime(selectedChatLastActivity)}</div>
                      </div>
                      <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Open tasks</div>
                        <div className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{formatNumber(selectedChatOpenTasks)}</div>
                      </div>
                    </div>

                    <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Attendance snapshot</div>
                      <div className="mt-3 grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>Status</span>
                          <span className="font-black text-slate-950 dark:text-white">{portalText(selectedChatAttendanceStatus)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>Check-in</span>
                          <span dir="ltr" className="font-black text-slate-950 dark:text-white">{formatDateTime(selectedChatCheckIn)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>Check-out</span>
                          <span dir="ltr" className="font-black text-slate-950 dark:text-white">{formatDateTime(selectedChatCheckOut)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>Shift hours</span>
                          <span className="font-black text-slate-950 dark:text-white">{selectedChatShiftHours.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>Late minutes</span>
                          <span className="font-black text-slate-950 dark:text-white">{formatNumber(selectedChatLateMinutes)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Sales snapshot</div>
                      <div className="mt-3 grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>Sales today</span>
                          <span className="font-black text-slate-950 dark:text-white">{formatCurrency(selectedChatSalesTotal)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>Invoices</span>
                          <span className="font-black text-slate-950 dark:text-white">{formatNumber(selectedChatInvoices)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.3rem] border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold leading-6 text-emerald-950 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700/80 dark:text-emerald-200/80">Quick summary</div>
                      <div className="mt-2">آخر نشاط: {formatDateTime(selectedChatLastActivity)}</div>
                      <div>المحادثة غير المقروءة: {formatNumber(selectedChatUnread)}</div>
                    </div>
                  </div>
                ) : (
                  <EmptyState title="لا يوجد ملف موظف" body="اختر محادثة لعرض ملخص الموظف هنا." />
                )}
              </Card>
            </div>
          ) : null}

          {activeTab === "more" ? (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title="ط§ظ„ظ…ظ„ظپ ط§ظ„ط´ط®طµظٹ" subtitle="Manager profile" icon={Building2}>
                  <div className="space-y-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    <div className="font-black text-slate-950 dark:text-white">{portalText(me?.full_name || me?.name || "Manager")}</div>
                    <div>{portalText(me?.role || "manager")} · {portalText(me?.department || "—")}</div>
                    <div>{portalText(me?.user_email || "No email")}</div>
                    <div>{formatNumber(me?.permissions?.length || 0)} permissions</div>
                  </div>
                </Card>
                <Card title="ط¨ظٹط§ظ†ط§طھ ط§ظ„ظپط±ط¹" subtitle="Branch info" icon={Store}>
                  <div className="space-y-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    <div className="font-black text-slate-950 dark:text-white">{portalText(me?.branch_name || "All branches")}</div>
                    <div>Scope: {portalText(me?.branch_scope || "all")}</div>
                    <div>Live alerts: {formatNumber(notifications.length || 0)}</div>
                    <div>Unread: {formatNumber(unreadCount || notificationsUnread)}</div>
                  </div>
                </Card>
                <Card title="ط±ظˆط§ط¨ط· ط³ط±ظٹط¹ط©" subtitle="Quick links" icon={ChevronRight}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["Today", "today"],
                      ["Staff", "staff"],
                      ["Tasks", "tasks"],
                      ["Sales", "sales"],
                      ["Chat", "chat"],
                    ].map(([label, tab]) => (
                      <button key={tab} type="button" onClick={() => setActiveTab(tab)} className="inline-flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3 text-right text-sm font-black text-slate-800 transition hover:border-sky-300 hover:bg-sky-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-white dark:hover:border-sky-500/30 dark:hover:bg-sky-500/10">
                        <span>{label}</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </Card>
                <Card title="ط³ط¬ظ„ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ" subtitle="Notification history" icon={Bell}>
                  <div className="space-y-2">
                    {notifications.slice(0, 3).length ? notifications.slice(0, 3).map((item) => (
                      <div key={`history-${item.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                        <div className="font-black text-slate-950 dark:text-white">{portalText(item.title || item.type || "Notification")}</div>
                        <div className="mt-1 line-clamp-2 text-xs opacity-80">{portalText(item.message || item.body || "")}</div>
                        <div className="mt-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{formatDateTime(item.created_at)}</div>
                      </div>
                    )) : <EmptyState title="ظ„ط§ ظٹظˆط¬ط¯ ط³ط¬ظ„ ط­ط¯ظٹط«" body="ط³طھط¸ظ‡ط± ط¢ط®ط± ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ظ‡ظ†ط§ ط¹ظ†ط¯ظ…ط§ طھطھظˆظپط±." />}
                  </div>
                </Card>
              </div>

              <Card title="ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„طھظ†ط¨ظٹظ‡" subtitle="Notifications settings" icon={Bell}>
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(settings).map(([category, config]) => (
                    <div key={category} className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="flex items-center justify-between">
                      <div className="text-sm font-black text-slate-900 dark:text-white">{portalText(category)}</div>
                        <StatusPill tone="slate" value={portalText(category)} />
                      </div>
                      <Toggle label="طµظˆطھ" checked={Boolean(config.sound)} onChange={(value) => onCategoryToggle(category, "sound", value)} />
                      <Toggle label="Toast" checked={Boolean(config.toast)} onChange={(value) => onCategoryToggle(category, "toast", value)} />
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="ط§ظ„طµظˆطھ ظˆط§ظ„ط¥ط´ط¹ط§ط±ط§طھ" subtitle="Browser control" icon={Volume2}>
                <div className="grid gap-2 md:grid-cols-2">
                  <button type="button" data-testid="sound-unlock-button" data-state={soundUnlocked ? "enabled" : "disabled"} onClick={enableSound} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                    {soundUnlocked ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                    {soundUnlocked ? "ط§ظ„طµظˆطھ ظ…ظپط¹ظ„" : "طھظپط¹ظٹظ„ ط§ظ„طµظˆطھ"}
                  </button>
                  <button type="button" data-testid="browser-notification-button" data-state={browserNotificationPermission} onClick={enableBrowserNotifications} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    <Bell className="h-4 w-4" />
                    {browserNotificationPermission === "granted" ? "ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…طھطµظپط­ ظ…ظپط¹ظ„ط©" : "طھظپط¹ظٹظ„ ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…طھطµظپط­"}
                  </button>
                </div>
              </Card>

              <Card title="ظ…ظ„ط®طµ ط³ط±ظٹط¹" subtitle="Quick stats" icon={Megaphone}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-950 p-4 text-white">
                    <div className="text-xs font-black text-white/60">ط¥ط´ط¹ط§ط±ط§طھ ط؛ظٹط± ظ…ظ‚ط±ظˆط،ط©</div>
                    <div className="mt-1 text-3xl font-black">{formatNumber(unreadCount || notificationsUnread)}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 text-slate-900 dark:bg-white/[0.03] dark:text-white">
                    <div className="text-xs font-black text-slate-400">طµظ„ط§ط­ظٹط§طھ</div>
                    <div className="mt-1 text-sm font-semibold leading-6">{(me?.permissions || []).length ? `${formatNumber(me.permissions.length)} permission(s)` : "ظ„ط§ طھظˆط¬ط¯ طµظ„ط§ط­ظٹط§طھ ط¸ط§ظ‡ط±ط©"}</div>
                  </div>
                </div>
              </Card>
            </div>
          ) : null}
        </section>

        <aside className="space-y-3">
              <Card title="ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ" subtitle="Live feed" icon={Bell} className="min-h-0" compact bodyClassName="space-y-2">
            <div data-testid="notifications-panel" />
            <div className="space-y-1.5">
              {visibleNotifications.length ? visibleNotifications.map((item) => (
                <button key={item.id} type="button" data-testid={`notification-${item.id}`} onClick={() => void markNotificationRead(item.id)} className={`w-full rounded-2xl border px-3 py-2.5 text-right transition ${item.is_read ? "border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300" : "border-sky-200 bg-sky-50 text-slate-950 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black">{portalText(item.title || item.type || "Notification")}</div>
                      <div className="mt-1 line-clamp-1 text-xs font-semibold opacity-80">{portalText(item.message || item.body || "")}</div>
                    </div>
                    <StatusPill tone={item.is_read ? "slate" : "blue"} value={portalText(item.category || "system")} />
                  </div>
                </button>
              )) : <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ط¥ط´ط¹ط§ط±ط§طھ" body="ط³طھط¸ظ‡ط± ظ‡ظ†ط§ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ط­ظٹط© ط¹ظ†ط¯ ظˆطµظˆظ„ظ‡ط§." />}
            </div>
            {hasMoreNotifications ? (
              <button type="button" onClick={() => setShowMoreNotifications((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                {showMoreNotifications ? "Show less" : "Show more"}
              </button>
            ) : null}
          </Card>

          <Card title="AI + alerts" subtitle="Right rail" icon={Bot} compact bodyClassName="space-y-2">
            <div className="space-y-1.5">
              {visibleAiInsights.map((insight, index) => (
                <div key={`${insight.title || index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-sm font-semibold leading-5 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-sky-600/70">{portalText(insight.type || "insight")}</div>
                  <div className="mt-1 truncate font-black text-slate-950 dark:text-white">{portalText(insight.title || "-")}</div>
                  <div className="mt-1 line-clamp-2">{portalText(insight.body || "-")}</div>
                </div>
              ))}
              {!aiInsights.length ? <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ط±ط¤ظ‰" body="ط¥ط°ط§ ظ„ظ… طھظˆط¬ط¯ ط¨ظٹط§ظ†ط§طھ ط­ظ‚ظٹظ‚ظٹط© ظپظ„ظ† ظ†ط¶ظٹظپ ط§ظپطھط±ط§ط¶ط§طھ." /> : null}
            </div>
            {hasMoreAiInsights ? (
              <button type="button" onClick={() => setShowMoreAiInsights((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                {showMoreAiInsights ? "Show less" : "Show more"}
              </button>
            ) : null}
          </Card>

          <Card title="AI leads" subtitle="Hot leads" icon={Store} compact bodyClassName="space-y-2">
            <div className="space-y-1.5">
              {visibleLeads.length ? visibleLeads.map((lead) => (
                <div key={lead.session_id} className="rounded-2xl border border-rose-200 bg-rose-50 p-2.5 text-sm font-semibold leading-5 text-rose-900 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100">
                  <div className="font-black">{portalText(lead.ai_insight || lead.session_id)}</div>
                  <div className="mt-1 text-xs font-bold opacity-80">Score {formatNumber(lead.lead_score || 0)}</div>
                </div>
              )) : <EmptyState title="ظ„ط§ طھظˆط¬ط¯ leads ط³ط§ط®ظ†ط©" body="ط³ظٹط¸ظ‡ط± ظ‡ظ†ط§ ط§ظ„ظ…طµط¯ط± ط§ظ„ط­ظ‚ظٹظ‚ظٹ ط¹ظ†ط¯ طھظˆظپط±ظ‡." />}
            </div>
            {hasMoreLeads ? (
              <button type="button" onClick={() => setShowMoreLeads((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                {showMoreLeads ? "Show less" : "Show more"}
              </button>
            ) : null}
          </Card>

          <Card title="ط§ظ„ظ…ط®ط²ظˆظ† ط§ظ„ط³ط±ظٹط¹" subtitle="Low stock" icon={Package} compact bodyClassName="space-y-2">
            <div className="space-y-1.5">
              {visibleLowStock.length ? visibleLowStock.map((item) => (
                <div key={`${item.id}-${item.name}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                  <div className="font-black">{portalText(item.name || "-")}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">{portalText(item.color || item.size || "")} · {formatNumber(item.stock || 0)}</div>
                </div>
              )) : <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ط¹ظ†ط§طµط± ظ…ظ†ط®ظپط¶ط©" body="ظ„ظ† ظ†ط¹ط±ط¶ ظ…ط®ط²ظˆظ†ظ‹ط§ ظ…ظ†ط®ظپظ¶ظ‹ط§ ط؛ظٹط± ظ…ظˆط¬ظˆط¯ ظپظٹ ط§ظ„ظ…طµط¯ط±." />}
            </div>
            {hasMoreLowStock ? (
              <button type="button" onClick={() => setShowMoreLowStock((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                {showMoreLowStock ? "Show less" : "Show more"}
              </button>
            ) : null}
          </Card>
        </aside>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl rounded-[1.6rem] border border-white/60 bg-white/95 p-2 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/90 lg:hidden">
        <div className="grid grid-cols-6 gap-1">
          {TABS.map((tab) => {
            const active = activeTab === tab;
            const label = tab === "today" ? "ط§ظ„ظٹظˆظ…" : tab === "staff" ? "ط§ظ„ط·ط§ظ‚ظ…" : tab === "tasks" ? "ط§ظ„ظ…ظ‡ط§ظ…" : tab === "sales" ? "ط§ظ„ظ…ط¨ظٹط¹ط§طھ" : tab === "chat" ? "ط§ظ„ط´ط§طھ" : "ط§ظ„ظ…ط²ظٹط¯";
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



