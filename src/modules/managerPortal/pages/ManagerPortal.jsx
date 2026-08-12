import { useEffect, useMemo, useRef, useState } from "react";
import { useCallback } from "react";
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
  ClipboardCheck,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MessageSquare,
  Megaphone,
  Medal,
  Moon,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
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
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { SOCKET_URL } from "../../../shared/constants/app";
import { playRealtimeSound, requestBrowserNotificationPermission, unlockRealtimeFeedbackAudio } from "../../../services/realtimeFeedbackService";
import { managerPortalApi } from "../services/managerPortalApi";
import { buildPageTitle } from "../../../shared/hooks/usePageTitle";
import { safeSetLocalStorage } from "../../../utils/safeStorage";
import { useTheme } from "../../../theme/useTheme";
import "./ManagerPortal.m1.css";

import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);

const TABS = ["today", "staff", "tasks", "sales", "chat", "inventory", "more"];
const STORAGE_KEY = "manager.portal.active.tab";
const DEFAULT_NOTIFICATION_SETTINGS = {
  messages: { sound: true, toast: true, push: true },
  tasks: { sound: true, toast: true, push: true },
  attendance: { sound: true, toast: true, push: true },
  sales: { sound: true, toast: true, push: true },
  stock: { sound: true, toast: true, push: true },
  ai_leads: { sound: true, toast: true, push: true },
};
const MANAGER_PORTAL_PWA_VERSION = "20260808-inventory-approvals";
const MANAGER_PORTAL_CRITICAL_TIMEOUT_MS = 9000;
const MANAGER_PORTAL_DEFERRED_TIMEOUT_MS = 12000;
// The initial load eagerly fetches every tab's data (critical + deferred). Switching
// to a tab within this window reuses that already-loaded data instead of firing a
// redundant refetch; genuine revisits after the window still revalidate. Mutations and
// manual refresh bypass this via force.
const MANAGER_PORTAL_TAB_FRESH_TTL_MS = 45000;
const settledValue = (result) => (result?.status === "fulfilled" ? result.value : null);

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
// This array is evaluated once at import time, so it stores translation KEYS and
// resolves them at render. Storing resolved strings here would freeze the labels
// in whichever language was active when the module first loaded.
const MANAGER_NOTIFICATION_CATEGORIES = [
  { key: "all", labelKey: "managerPortal.filters.all", icon: Bell },
  { key: "employee_chat", labelKey: "managerPortal.notifications.categories.employeeChat", icon: MessageSquare },
  { key: "task_completed", labelKey: "managerPortal.notifications.categories.taskCompleted", icon: CheckCircle2 },
  { key: "task_overdue", labelKey: "managerPortal.notifications.categories.taskOverdue", icon: AlertTriangle },
  { key: "attendance", labelKey: "managerPortal.sections.attendance", icon: Clock3 },
  { key: "sales", labelKey: "managerPortal.sections.sales", icon: ShoppingCart },
  { key: "stock", labelKey: "managerPortal.sections.stock", icon: Package },
  { key: "ai_leads", labelKey: "managerPortal.sections.hotLeads", icon: Bot },
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
  if (type.includes("task_overdue")) return tt("managerPortal.notifications.types.taskOverdue");
  if (type.includes("task_completed")) return tt("managerPortal.notifications.types.taskCompleted");
  if (type.includes("employee") || type.includes("chat") || type.includes("message")) return tt("managerPortal.notifications.types.employeeMessage");
  if (type.includes("attendance")) return tt("managerPortal.sections.attendance");
  if (type.includes("lead") || type.includes("ai")) return tt("managerPortal.notifications.types.hotLead");
  if (type.includes("stock") || type.includes("inventory") || type.includes("refill") || type.includes("low_stock")) return tt("managerPortal.notifications.types.stockAlert");
  if (type.includes("sale") || type.includes("order") || type.includes("payment")) return tt("managerPortal.notifications.types.sales");
  return portalText(notification.category || notification.type || tt("managerPortal.notifications.types.generic"));
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
  if (status === "completed") return { label: tt("managerPortal.taskStatus.completed"), tone: "green" };
  if (status === "overdue") return { label: tt("managerPortal.taskStatus.overdue"), tone: "red" };
  if (status === "manager_review") return { label: tt("managerPortal.taskStatus.managerReview"), tone: "amber" };
  if (status === "in_progress") return { label: tt("managerPortal.taskStatus.inProgress"), tone: "blue" };
  if (status === "pending") return { label: tt("managerPortal.taskStatus.pending"), tone: "slate" };
  if (status === "rejected" || status === "cancelled") return { label: status, tone: "red" };
  return { label: status || tt("managerPortal.taskStatus.pending"), tone: "slate" };
};
const taskProofUrl = (task = {}) => task.latest_attachment_url || task.proof_url || task.proof_image_url || task.attachment_url || "";
const taskProofLabel = (task = {}) => task.latest_attachment_name || task.latest_attachment_type || (task.attachments_count ? tt("managerPortal.tasks.proofAttached") : "");

const isLatinText = (value = "") => /[A-Za-z]/.test(String(value || "")) && !/[\u0600-\u06FF]/.test(String(value || ""));
const InlineName = ({ children, className = "" }) => (
  <span dir={isLatinText(children) ? "ltr" : "rtl"} style={{ unicodeBidi: "isolate" }} className={`inline-block ${className}`}>{children}</span>
);
const paymentMethodLabel = (value = "") => {
  const key = normalizeNotificationText(value || "unknown");
  const labels = {
    cash: tt("managerPortal.payment.cash"),
    card: tt("managerPortal.payment.card"),
    visa: tt("managerPortal.payment.visa"),
    wallet: tt("managerPortal.payment.wallet"),
    vodafone_cash: tt("managerPortal.payment.vodafoneCash"),
    instapay: tt("managerPortal.payment.instapay"),
    credit_sale: tt("managerPortal.payment.credit"),
    cod: tt("managerPortal.payment.cashOnDelivery"),
    cash_on_delivery: tt("managerPortal.payment.cashOnDelivery"),
    unknown: tt("managerPortal.common.unspecified"),
  };
  return labels[key] || portalText(value || tt("managerPortal.common.unspecified"));
};
const insightTitleLabel = (type = "", fallback = "") => {
  const key = normalizeNotificationText(type || fallback);
  if (key.includes("sales") || key.includes("best")) return tt("managerPortal.insights.bestSeller");
  if (key.includes("inventory") || key.includes("reorder")) return tt("managerPortal.insights.reorderNeeded");
  if (key.includes("branch")) return tt("managerPortal.insights.topBranch");
  if (key.includes("timing") || key.includes("hour")) return tt("managerPortal.insights.peakHour");
  return tt("managerPortal.insights.operational");
};
const renderInsightBody = (item = {}) => {
  const type = normalizeNotificationText(item.type || item.title || "");
  const productName = item.productName || item.product_name || item.name || item.product || "";
  const branchName = item.branchName || item.branch_name || item.branch || "";
  const units = item.units || item.quantity || item.sold_units || "";
  const stock = item.stock || item.current_stock || "";
  const hour = item.hour || item.peak_hour || "";
  if (type.includes("sales") || type.includes("best")) {
    const name = productName || String(item.body || "").split(" leads with ")[0] || tt("managerPortal.common.product");
    const count = units || String(item.body || "").match(/(\d+)\s+units/)?.[1] || 0;
    return <>{tt("managerPortal.insights.bestSellerLabel")} <InlineName>{name}</InlineName> {tt("managerPortal.chrome.soldUnits30d", { count: formatNumber(count) })}</>;
  }
  if (type.includes("inventory") || type.includes("reorder")) {
    const name = productName || String(item.body || "").split(" is at ")[0] || tt("managerPortal.common.product");
    const count = stock || String(item.body || "").match(/(\d+)\s+units/)?.[1] || 0;
    return <>{tt("managerPortal.insights.reorderNeededLabel")} <InlineName>{name}</InlineName> {tt("managerPortal.chrome.reachedUnits", { count: formatNumber(count) })}</>;
  }
  if (type.includes("branch")) {
    const name = branchName || String(item.body || "").split(" is the ")[0] || tt("managerPortal.common.branch");
    return <><InlineName>{name}</InlineName> {tt("managerPortal.insights.topBranchSuffix")}</>;
  }
  if (type.includes("timing") || type.includes("hour")) {
    const peak = hour || String(item.body || "").match(/(\d{1,2}:00)/)?.[1] || "-";
    return <>{tt("managerPortal.insights.peakHourLabel")} <span dir="ltr" className="inline-block">{peak}</span>.</>;
  }
  return portalText(item.body || "-");
};
const insightActionabilityScore = (item = {}) => {
  const text = normalizeText([item.type, item.title, item.body, item.message].filter(Boolean).join(" "));
  if (!text) return 0;

  const noiseOnly = /(summary|overview|report|snapshot|insight|metrics?|statistics?|daily|general|informational|info)/i.test(text);
  const hasActionSignal = /(stock|inventory|reorder|refill|low stock|low_stock|out of stock|shortage|urgent|critical|warning|risk|lead|conversion|sales|revenue|drop|decline|review|follow up|follow-up|branch|peak|hour|trend|action)/i.test(text);

  if (!hasActionSignal) return 0;

  let score = 0;
  if (/(stock|inventory|reorder|refill|low stock|low_stock|out of stock|shortage|urgent|critical|warning|risk)/i.test(text)) score += 5;
  if (/(lead|conversion|sales|revenue|drop|decline|branch|peak|hour|trend|follow up|follow-up)/i.test(text)) score += 3;
  if (/\b\d+/.test(text)) score += 1;
  if (/(review|watch|monitor|action|needs|need to|should|must|improve|fix)/i.test(text)) score += 2;
  if (noiseOnly && score < 5) return 0;
  return score;
};
const isActionableInsight = (item = {}) => insightActionabilityScore(item) > 0;
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
const leadName = (lead = {}) => portalText(lead.customer_name || lead.name || lead.contact_name || tt("managerPortal.leads.fallbackName"));
const leadChannel = (lead = {}) => portalText(lead.channel || lead.platform || lead.source || tt("managerPortal.leads.unknownChannel"));
const leadPreview = (lead = {}) => portalText(lead.last_message || lead.last_message_preview || lead.ai_insight || tt("managerPortal.leads.noLastMessage"));
const leadPrimaryProduct = (lead = {}) => {
  const direct = [
    lead.primary_product_name,
    lead.product_name,
    lead.product,
    lead.product_title,
    lead.product_label,
    lead.matched_product_name,
    lead.interest_product_name,
    lead.favorite_product_name,
    lead.primary_product,
    lead.recommended_product,
  ].find((value) => String(value || "").trim());
  if (direct) return portalText(direct);

  const insightText = String(lead.ai_insight || lead.last_message || lead.last_message_preview || "").trim();
  if (!insightText) return "";

  const match = insightText.match(/(?:منتج|product|item|الصنف|السلعة)\s*[:：-]?\s*([^\n|·•]{2,40})/i);
  return match?.[1] ? portalText(match[1].trim()) : "";
};
const leadLastInteractionAt = (lead = {}) => lead.last_message_at || lead.last_activity_at || lead.updated_at || lead.created_at || null;
const isMeaningfulLead = (lead = {}) => {
  const name = normalizeText(lead.customer_name || lead.name || lead.contact_name || "");
  const score = Number(lead.lead_score || 0);
  return Boolean(
    // Compares against the literal placeholder the BACKEND sends, so it must stay
    // untranslated - localizing it would make the check locale-dependent.
    (name && name !== "عميل محتمل") ||
    score > 0 ||
    leadPrimaryProduct(lead) ||
    leadLastInteractionAt(lead) ||
    lead.last_message ||
    lead.last_message_preview ||
    lead.ai_insight,
  );
};
const formatCompactDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-EG", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};
const sparklinePoints = (values = [], width = 120, height = 36) => {
  const points = Array.isArray(values) ? values.map((value) => Number(value || 0)) : [];
  if (!points.length) return "";
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(max - min, 1);
  return points.map((value, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const normalized = (value - min) / range;
    const y = height - normalized * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
};
const compactDayNumber = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ar-EG", { day: "numeric" }).format(date);
};
const MobileSalesChart = ({ points = [], valueKey = "revenue", formatValue = formatNumber, label = tt("managerPortal.common.value"), tone = "amber" }) => {
  const rows = Array.isArray(points) ? points : [];
  const values = rows.map((item) => Math.max(0, Number(item?.[valueKey] || 0)));
  const max = Math.max(...values, 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  const topIndex = values.indexOf(Math.max(...values));
  const average = rows.length ? total / rows.length : 0;
  const accent = tone === "cyan" ? "bg-primary" : "bg-amber-400";
  const accentSoft = tone === "cyan" ? "bg-primary/25" : "bg-amber-300/25";
  const first = rows[0]?.day;
  const middle = rows[Math.floor(rows.length / 2)]?.day;
  const last = rows[rows.length - 1]?.day;
  return (
    <div className="mt-4 rounded-2xl border border-slate-800 bg-black/20 px-3 pb-2.5 pt-3" dir="rtl">
      <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-bold text-slate-400">
        <span>{tt("managerPortal.leads.highestValue")} <b className="text-slate-100">{formatValue(max)}</b></span>
        <span>{tt("managerPortal.leads.dailyAverage")} <b className="text-slate-100">{formatValue(average)}</b></span>
      </div>
      <div className="relative h-24" role="img" aria-label={`شارت ${label} اليومي`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-slate-700/80" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-700/70" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-slate-700/80" />
        <div className="relative flex h-full items-end gap-px" dir="ltr">
          {rows.map((item, index) => {
            const value = values[index];
            const height = value ? Math.max(8, Math.round((value / max) * 100)) : 3;
            const isTop = index === topIndex && value > 0;
            return (
              <div key={`${item?.day || index}`} className="group flex h-full min-w-0 flex-1 items-end" title={`${formatShortDay(item?.day)}: ${formatValue(value)}`}>
                <div className={`w-full rounded-t-sm transition ${isTop ? accent : value ? accentSoft : "bg-slate-700/70"}`} style={{ height: `${height}%` }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-slate-500">
        <span>{tt("managerPortal.labels.day")} {compactDayNumber(first)}</span>
        <span>{tt("managerPortal.labels.day")} {compactDayNumber(middle)}</span>
        <span>{tt("managerPortal.labels.day")} {compactDayNumber(last)}</span>
      </div>
    </div>
  );
};
const normalizeAlertKey = (value = "") => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const uniqueBySignature = (items = [], getSignature, seen = new Set()) => {
  const nextSeen = seen;
  return (Array.isArray(items) ? items : []).filter((item) => {
    const signature = getSignature?.(item);
    if (!signature) return true;
    if (nextSeen.has(signature)) return false;
    nextSeen.add(signature);
    return true;
  });
};
const notificationAlertSignature = (notification = {}) => {
  const category = categoryFromNotification(notification);
  const entityId =
    notification.metadata?.task_id ||
    notification.metadata?.invoice_id ||
    notification.metadata?.order_id ||
    notification.metadata?.lead_id ||
    notification.metadata?.product_id ||
    notification.entity_id ||
    notification.id ||
    "";
  const title = normalizeAlertKey(notification.title || notificationTypeLabel(notification));
  const body = normalizeAlertKey(notification.message || notification.body || "");
  return [category, entityId, title, body].filter(Boolean).join("|");
};
const taskAlertSignature = (task = {}) => [
  "task",
  normalizeAlertKey(task.id || task.task_id || task.title || task.title_ar || ""),
  normalizeAlertKey(task.status || ""),
  normalizeAlertKey(task.assignee_name || task.employee_name || ""),
].filter(Boolean).join("|");
const insightAlertSignature = (item = {}) => [
  "insight",
  normalizeAlertKey(item.type || item.title || ""),
  normalizeAlertKey(item.title || ""),
  normalizeAlertKey(item.body || item.message || ""),
].filter(Boolean).join("|");
const leadAlertSignature = (lead = {}) => [
  "lead",
  normalizeAlertKey(lead.customer_id || lead.customer_phone || lead.customer_name || lead.session_id || lead.conversation_id || lead.id || ""),
  normalizeAlertKey(lead.lead_score || ""),
  normalizeAlertKey(lead.last_message || lead.last_message_preview || lead.ai_insight || ""),
].filter(Boolean).join("|");
const stockAlertSignature = (item = {}) => [
  "stock",
  normalizeAlertKey(item.id || item.product_id || item.product_name || item.name || ""),
  normalizeAlertKey(item.color_name || item.color || ""),
  normalizeAlertKey(item.replacement_size || item.size || ""),
  normalizeAlertKey(item.stock ?? item.current_stock ?? ""),
].filter(Boolean).join("|");

/* ============================================================================
   SHARED SURFACE SOURCE — Global Surface Normalization
   ----------------------------------------------------------------------------
   These local primitives are the surface source for the whole Manager Portal.
   They hardcoded two surface models, neither of which followed the app theme:
   fixed-LIGHT (`bg-[linear-gradient(180deg,#ffffff,#f8fafc)]`, `border-slate-200`,
   `text-slate-700/950`) on Badge/Card/MiniMetric/EmptyState, and fixed-DARK
   (`bg-[#0f172a]` / `bg-[#0b1120]`, `text-white`) on CompactStatCard.

   ManagerPortal.m1.css was already repainting both back to semantic tokens with
   `!important`, so the JSX described a surface nobody ever saw. These now name
   the token the shim resolves them to. The shim stays — it still covers the
   legacy utilities at individual call sites across this 3,456-line file.

   SCOPE — surfaces and neutrals only:
     white / slate / navy   -> surface & text tokens
     blue / cyan / sky      -> --primary. This app's accent is gold; the shim
                               already forces exactly that on these same
                               elements, so it is a surface fix, not a restyle.
     emerald / amber / rose -> untouched. Those are genuine STATUS hues, not a
                               surface model; converging them is a later phase.

   PRESERVED DELIBERATELY: MiniMetric's 1.9rem/2.05rem headline KPI typography,
   Badge's dot-free composition, and every `data-tone` attribute (index.css
   targets them for the mobile-dark tone tinting). */
const Badge = ({ children, className = "" }) => (
  <span className={`manager-portal-badge inline-flex items-center rounded-full border border-border bg-surface px-2.5 py-1.5 text-[11px] font-black leading-5 text-text ${className}`}>{children}</span>
);

const Card = ({ title, subtitle, icon: Icon, children, action, className = "", bodyClassName = "", compact = false, tone = "gold" }) => (
  <section data-tone={tone} className={`manager-portal-card overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-card)] ${compact ? "p-3" : "p-4"} ${className}`}>
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="text-[11px] font-black leading-5 tracking-normal text-text-muted">{subtitle}</div>
        <h2 className="m1-section-title mt-1 text-text">{title}</h2>
      </div>
      {Icon ? <div className="manager-portal-card-icon rounded-[var(--radius-card)] border border-border bg-surface-soft p-2 text-[var(--text-secondary)] shadow-[var(--shadow-card)]"><Icon className="h-4 w-4" /></div> : null}
    </div>
    {action ? <div className="mt-3">{action}</div> : null}
    <div className={`manager-portal-card-body mt-3 ${bodyClassName}`}>{children}</div>
  </section>
);

const MiniMetric = ({ label, value, icon: Icon, tone = "slate", sub = "" }) => {
  // Top-accent rail. slate/cyan/blue were neutral-or-wrong-accent and become
  // tokens; emerald/amber/rose are status hues and stay (see the scope note).
  const tones = {
    slate: "border-t-border-strong",
    green: "border-t-emerald-500",
    cyan: "border-t-primary",
    amber: "border-t-amber-500",
    red: "border-t-rose-500",
    blue: "border-t-primary",
  };
  return (
    <div data-tone={tone} className={`manager-portal-mini-metric kpi-card-readable h-full min-h-[112px] rounded-[var(--radius-card)] border border-border border-t-4 bg-surface p-3 shadow-[var(--shadow-card)] ${tones[tone] || tones.slate}`}>
      <div className="flex h-full items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black leading-5 text-text-muted">{label}</div>
          {/* 1.9rem / 2.05rem is the Manager headline KPI size. It is LARGER than
              any MetricCard density and must not be swapped for one. */}
          <div className="manager-portal-mini-metric-value mt-1 text-[1.9rem] font-black leading-none tracking-tight text-text sm:text-[2.05rem]">{value || formatNumber(0)}</div>
          {sub ? <div className="mt-0.5 truncate text-[11px] font-bold text-text-muted">{sub}</div> : null}
        </div>
        {Icon ? <div className="manager-portal-mini-metric-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface-soft text-[var(--text-secondary)] shadow-[var(--shadow-card)]"><Icon className="h-4 w-4" /></div> : null}
      </div>
    </div>
  );
};

const CompactStatCard = ({ label, value, icon: Icon, tone = "slate", emphasis = false }) => {
  // This used to be a six-entry tone map in which all six entries were byte-for-byte
  // the SAME fixed-dark navy (`border-slate-800 bg-[#0f172a] text-white`) — the
  // `tone` prop selected nothing. Per-tone differentiation lives in index.css,
  // keyed off `data-tone`, which is why that attribute is still emitted below.
  const shell = "border-border bg-surface text-text";
  const iconChip = "bg-[var(--primary-soft)] text-primary";
  const labelText = "text-text-muted";
  const valueText = "text-text";
  if (emphasis) {
    return (
      <div data-tone={tone} className="manager-portal-compact-stat manager-portal-compact-stat--emphasis h-full min-h-[112px] rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--primary)_48%,var(--border))] bg-surface p-3 text-text shadow-[var(--shadow-card)]">
        <div className="flex h-full items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className={`text-[10px] font-black leading-5 tracking-normal ${labelText}`}>{label}</div>
            <div className={`manager-portal-compact-stat-value mt-1 text-2xl font-black leading-none sm:text-[1.25rem] ${valueText}`}>{value || formatNumber(0)}</div>
          </div>
          {Icon ? <div className={`manager-portal-compact-stat-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconChip}`}><Icon className="h-4 w-4" /></div> : null}
        </div>
      </div>
    );
  }
  return (
    <div data-tone={tone} className={`manager-portal-compact-stat h-full min-h-[112px] rounded-2xl border p-3 shadow-[var(--shadow-card)] ${shell}`}>
      <div className="flex h-full items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] font-black leading-5 tracking-normal ${labelText}`}>{label}</div>
          <div className={`manager-portal-compact-stat-value mt-1 text-2xl font-black leading-none sm:text-[1.15rem] ${valueText}`}>{value || formatNumber(0)}</div>
        </div>
        {Icon ? <div className={`manager-portal-compact-stat-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconChip}`}><Icon className="h-4 w-4" /></div> : null}
      </div>
    </div>
  );
};

const Toggle = ({ label, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`manager-portal-toggle flex w-full items-center justify-between rounded-[var(--radius-control)] border px-3 py-3 text-right transition ${ checked ? "border-emerald-200 bg-surface text-emerald-900 shadow-[var(--shadow-card)] dark:border-emerald-400/20 dark:text-emerald-100" : "border-border bg-surface text-text" }`}
  >
    <span className="text-sm font-black leading-6">{label}</span>
    {/* The ON pill keeps its solid emerald status fill; only the OFF pill was a
        surface (slate/white) and becomes one. */}
    <span className={`rounded-full px-2.5 py-1.5 text-[11px] font-black leading-5 ${checked ? "bg-emerald-500 text-white" : "bg-surface-soft text-text-muted"}`}>
      {checked ? "On" : "Off"}
    </span>
  </button>
);

const StatusPill = ({ value, tone = "slate" }) => {
  const tones = {
    // `slate` is the neutral (surface) tone; the rest are status hues and stay.
    slate: "border-border bg-surface-soft text-[var(--text-secondary)]",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100",
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100",
    red: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-100",
    blue: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  };
  const style = tone === "blue"
    ? { background: "var(--primary-soft)", borderColor: "color-mix(in srgb, var(--primary) 36%, var(--border))", color: "var(--primary)" }
    : undefined;
  return <span style={style} className={`manager-portal-status-pill rounded-full border px-2.5 py-1.5 text-[11px] font-black leading-5 ${tones[tone] || tones.slate}`}>{value}</span>;
};

const EmptyState = ({ title, body, compact = false }) => (
  <div className={`manager-portal-empty rounded-[var(--radius-card)] border border-dashed border-border bg-surface text-right font-semibold leading-6 text-text-muted shadow-[var(--shadow-card)] ${compact ? "px-3 py-3 text-xs" : "px-4 py-5 text-sm"}`}>
    <div className="font-black leading-6 text-text">{title}</div>
    <div className="mt-1 leading-6">{body}</div>
  </div>
);

const DailyProfitCard = ({ token, salesData, canView, className = "" }) => {
  const [state, setState] = useState({ status: "locked", data: null, token: "" });
  const [modalOpen, setModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const relockTimerRef = useRef(null);

  const relock = useCallback(() => {
    if (relockTimerRef.current) { clearTimeout(relockTimerRef.current); relockTimerRef.current = null; }
    setState({ status: "locked", data: null, token: "" });
    setPassword("");
    setError("");
  }, []);

  useEffect(() => () => { if (relockTimerRef.current) clearTimeout(relockTimerRef.current); }, []);

  useEffect(() => {
    const profitToken = state?.token;
    if (state?.status !== "unlocked" || !profitToken) return undefined;

    let active = true;
    let refreshing = false;
    const refreshProfit = async () => {
      if (!active || refreshing) return;
      refreshing = true;
      try {
        const salesRes = await managerPortalApi.salesWithProfit(token, profitToken, {
          params: { _fresh: Date.now() },
          headers: { "Cache-Control": "no-cache" },
        });
        const block = salesRes?.sales?.daily_profit || null;
        if (active && block?.profit_locked === false) {
          setState((current) => current.token === profitToken ? { ...current, data: block } : current);
        }
      } catch {
        // Keep the last authorized value until the next refresh or token expiry.
      } finally {
        refreshing = false;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshProfit();
    };

    refreshProfit();
    const timer = window.setInterval(refreshProfit, 30_000);
    window.addEventListener("focus", refreshProfit);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshProfit);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [state?.status, state?.token, token, salesData]);

  const handleUnlock = useCallback(async () => {
    if (!password || submitting) return;
    setSubmitting(true); setError("");
    try {
      const res = await managerPortalApi.unlockProfit(token, password);
      const profitToken = res?.profit_token;
      const expiresIn = Number(res?.expires_in || 900);
      if (!profitToken) throw new Error("unlock_failed");
      const salesRes = await managerPortalApi.salesWithProfit(token, profitToken);
      const block = salesRes?.sales?.daily_profit || null;
      setState({ status: "unlocked", token: profitToken, data: block });
      setModalOpen(false); setPassword("");
      if (relockTimerRef.current) clearTimeout(relockTimerRef.current);
      relockTimerRef.current = setTimeout(relock, Math.max(1, expiresIn) * 1000);
    } catch (e) {
      const status = Number(e?.status || 0);
      setError(status === 429 ? tt("managerPortal.profit.tooManyAttempts") : tt("managerPortal.profit.wrongPassword"));
    } finally {
      setSubmitting(false);
    }
  }, [password, submitting, token, relock]);

  const handleHide = useCallback(async () => {
    const t = state?.token;
    relock();
    if (t) { try { await managerPortalApi.lockProfit(token, t); } catch { /* ignore */ } }
  }, [state, token, relock]);

  if (!canView) {
    return (
      <div className={`manager-daily-profit-card rounded-2xl border px-4 py-4 text-right ${className}`}>
        <div className="flex items-center gap-2 text-[11px] font-black text-slate-500">
          <TrendingUp className="h-4 w-4" />
          <span>{tt("managerPortal.profit.daily")}</span>
        </div>
        <div className="mt-2 text-sm font-black text-slate-500">{tt("managerPortal.profit.hiddenByPermissions")}</div>
      </div>
    );
  }

  if (state.status === "unlocked" && state.data && state.data.profit_locked === false) {
    const d = state.data;
    const change = d.profit_change_percent;
    return (
      <div className={`manager-daily-profit-card rounded-[1.35rem] border p-4 text-right ${className}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-black text-amber-300">
            <span className="manager-daily-profit-icon grid h-9 w-9 place-items-center rounded-xl border"><TrendingUp className="h-4 w-4" /></span>
            <span>{tt("managerPortal.profit.daily")}</span>
          </div>
          <button type="button" onClick={handleHide} className="manager-daily-profit-hide rounded-full border px-3 py-1.5 text-[10px] font-black transition">{tt("managerPortal.common.hide")}</button>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black text-slate-400">{tt("managerPortal.profit.netToday")}</div>
            <div dir="ltr" className="mt-1 truncate text-[1.65rem] font-black leading-none tracking-tight text-white">{formatCurrency(d.profit || 0)}</div>
          </div>
          <div className="manager-daily-profit-margin shrink-0 rounded-xl border px-3 py-2 text-center">
            <div className="text-[9px] font-black text-slate-400">{tt("managerPortal.profit.margin")}</div>
            <div dir="ltr" className="mt-0.5 text-base font-black text-amber-300">{Number(d.profit_margin || 0)}%</div>
          </div>
        </div>
        {change !== null && change !== undefined ? (
          <div className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${Number(change) >= 0 ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-400" : "border-rose-400/25 bg-rose-400/10 text-rose-400"}`}>
            {Number(change) >= 0 ? "↑" : "↓"} {Math.abs(Number(change))}% عن أمس
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={() => { setError(""); setModalOpen(true); }} className={`manager-daily-profit-card w-full rounded-[1.35rem] border p-4 text-right transition ${className}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black text-slate-400">{tt("managerPortal.profit.daily")}</div>
            <div className="mt-1 text-sm font-black text-amber-300">{tt("managerPortal.profit.tapForDetails")}</div>
          </div>
          <span className="manager-daily-profit-icon grid h-10 w-10 place-items-center rounded-xl border text-lg">🔒</span>
        </div>
      </button>
      {modalOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" onClick={() => { if (!submitting) { setModalOpen(false); setError(""); } }}>
          <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-[#0b1220] p-5 text-right shadow-2xl" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-black text-white">{tt("managerPortal.profit.enterPassword")}</div>
            <input type="password" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleUnlock(); }} className="mt-3 w-full rounded-[var(--radius-control)] border border-slate-700 bg-[#0f172a] px-3 py-2 text-sm font-bold text-white outline-none transition focus:border-amber-500" placeholder="••••••" />
            {error ? <div className="mt-2 text-xs font-bold text-rose-400">{error}</div> : null}
            <div className="mt-4 flex items-center justify-between gap-2">
              <button type="button" onClick={() => { setModalOpen(false); setPassword(""); setError(""); }} className="rounded-[var(--radius-control)] border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300">{tt("managerPortal.common.cancel")}</button>
              <button type="button" disabled={submitting || !password} onClick={handleUnlock} className="rounded-[var(--radius-control)] bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 transition disabled:opacity-50">{submitting ? tt("managerPortal.profit.verifying") : tt("managerPortal.profit.show")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default function ManagerPortal() {
  // Subscribes the whole portal to language changes; the strings themselves are
  // resolved through the module-scope tt() helper.
  useTranslation();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => (isBrowser() ? window.localStorage.getItem(STORAGE_KEY) || "today" : "today"));
  const managerPortalTitles = {
    today: "Manager Dashboard",
    staff: "Manager Team",
    tasks: "Task Management",
    sales: "Manager Sales",
    chat: "Employee Chat",
    notifications: tt("managerPortal.alerts.settings"),
    more: "Manager Portal",
  };
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [staff, setStaff] = useState(null);
  const [advanceRequestReviewingId, setAdvanceRequestReviewingId] = useState("");
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
  const [expandedTaskIds, setExpandedTaskIds] = useState({});
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationCategory, setNotificationCategory] = useState("all");
  const socketRef = useRef(null);
  const notificationPanelRef = useRef(null);
  const notificationButtonRef = useRef(null);
  const liveFeedSectionRef = useRef(null);
  const stockAlertsSectionRef = useRef(null);
  const selectedTabRef = useRef(activeTab);
  const settingsRef = useRef(settings);
  const browserNotificationPermissionRef = useRef(browserNotificationPermission);
  const openedInvoiceQueryRef = useRef("");
  const tabFetchedAtRef = useRef({});

  const scrollToManagerSection = (ref) => {
    if (!isBrowser()) return;
    ref?.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    selectedTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (!isBrowser()) return;
    safeSetLocalStorage(STORAGE_KEY, activeTab, { raw: true, debug: true });
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
  const advanceRequests = Array.isArray(staff?.advance_requests) ? staff.advance_requests : [];
  const queryEmployeeId = searchParams.get("employee_id") || searchParams.get("employeeId") || "";
  const managerChatApiAdapter = useMemo(() => ({
    listThreads: () => managerPortalApi.chat(token),
    getThread: (threadId) => managerPortalApi.chatThread(token, threadId),
    sendMessage: (threadId, formData) => managerPortalApi.sendChatMessage(token, threadId, formData),
    markRead: (threadId) => managerPortalApi.markChatRead(token, threadId),
    emitTyping: (payload) => socketRef.current?.emit?.("employee-chat:typing", payload),
    emitStopTyping: (payload) => socketRef.current?.emit?.("employee-chat:stop-typing", payload),
    subscribe: (handlers = {}) => {
      const activeSocket = socketRef.current;
      if (!activeSocket?.on) return () => {};
      const bindings = [
        ["employee-chat:new-message", handlers.onMessage],
        ["employee-chat:thread-updated", handlers.onThread],
        ["employee-chat:read", handlers.onRead],
        ["employee-chat:typing", handlers.onTyping],
        ["employee-chat:stop-typing", handlers.onStopTyping],
      ].filter(([, handler]) => typeof handler === "function");
      bindings.forEach(([eventName, handler]) => activeSocket.on(eventName, handler));
      return () => bindings.forEach(([eventName, handler]) => activeSocket.off(eventName, handler));
    },
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
        action.includes("assign") ? tt("managerPortal.activity.taskAssigned") :
        action.includes("reassign") ? tt("managerPortal.activity.taskReassigned") :
        action.includes("complete") || toStatus === "completed" ? tt("managerPortal.notifications.types.taskCompleted") :
        action.includes("approve") ? tt("managerPortal.activity.taskApproved") :
        toStatus === "overdue" || fromStatus === "overdue" || action.includes("overdue") ? tt("managerPortal.notifications.types.taskOverdue") :
        tt("managerPortal.activity.taskUpdated");
      pushEvent({
        key: `task-${row.id || `${row.task_id || "task"}-${row.created_at || ""}`}`,
        kind: "task",
        timestamp: row.created_at || row.updated_at || null,
        title: portalText(title),
        detail: [portalText(row.actor_name || tt("managerPortal.common.system")), portalText(row.employee_name || row.to_employee_name || ""), portalText(row.note || "")].filter(Boolean).join(" · "),
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
        title: portalText(tt("managerPortal.activity.productRelisted")),
        detail: [portalText(row.product_name || "Refill alert"), [portalText(row.color_name || row.color || ""), portalText(row.replacement_size || "")].filter(Boolean).join(" · ")].filter(Boolean).join(" · "),
        tone: "amber",
      });
    }
    for (const row of Array.isArray(dashboard?.new_leads) ? dashboard.new_leads : []) {
      pushEvent({
        key: `lead-${row.session_id || row.id || row.updated_at || ""}`,
        kind: "lead",
        timestamp: row.updated_at || row.created_at || null,
        title: portalText(tt("managerPortal.notifications.types.hotLead")),
        detail: [portalText(row.ai_insight || row.session_id || tt("managerPortal.leads.fallbackName")), `الدرجة ${formatNumber(row.lead_score || 0)}`].filter(Boolean).join(" · "),
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
  const realLeads = useMemo(() => dedupedLeads.filter((lead) => isMeaningfulLead(lead)), [dedupedLeads]);
  const actionableAiInsights = useMemo(() => {
    const seen = new Set();
    return uniqueBySignature(aiInsights, insightAlertSignature, seen)
      .map((item) => ({
        ...item,
        __importance: insightActionabilityScore(item),
        __timestamp: new Date(item.created_at || item.updated_at || item.timestamp || 0).getTime() || 0,
      }))
      .filter((item) => isActionableInsight(item))
      .sort((a, b) => b.__importance - a.__importance || b.__timestamp - a.__timestamp)
      .map(({ __importance, __timestamp, ...item }) => item);
  }, [aiInsights]);
  const isMobilePortal = isBrowser() ? window.matchMedia("(max-width: 1023px)").matches : false;
  const managerNotificationAlertSignatures = useMemo(
    () => new Set(managerNotifications.map((item) => notificationAlertSignature(item))),
    [managerNotifications],
  );
  const mobileAlertBuckets = useMemo(() => {
    const seen = new Set(managerNotificationAlertSignatures);
    return {
      operationalEvents: isMobilePortal ? operationalEvents.filter((event) => event.kind === "invoice") : operationalEvents,
      aiInsights: isMobilePortal ? actionableAiInsights.slice(0, 3) : actionableAiInsights,
      leads: isMobilePortal ? realLeads.slice(0, 3) : realLeads,
      lowStock: isMobilePortal ? uniqueBySignature(lowStock, stockAlertSignature, seen) : lowStock,
      refillAlerts: isMobilePortal ? uniqueBySignature(refillAlerts, stockAlertSignature, seen) : refillAlerts,
      overdueTasks: isMobilePortal ? uniqueBySignature(overdueTasks, taskAlertSignature, seen) : overdueTasks,
    };
  }, [actionableAiInsights, isMobilePortal, lowStock, managerNotificationAlertSignatures, operationalEvents, overdueTasks, realLeads, refillAlerts]);
  const visibleNotifications = showMoreNotifications ? filteredManagerNotifications : filteredManagerNotifications.slice(0, 5);
  const visibleLiveFeed = managerNotifications.slice(0, 5);
  const hasMoreNotifications = filteredManagerNotifications.length > visibleNotifications.length;
  const showInstallCard = !standalone && (Boolean(installPrompt) || isIosDevice());
  const visibleAiInsights = showMoreAiInsights ? mobileAlertBuckets.aiInsights : mobileAlertBuckets.aiInsights.slice(0, 3);
  const hasMoreAiInsights = mobileAlertBuckets.aiInsights.length > visibleAiInsights.length;
  const visibleLeads = showMoreLeads ? mobileAlertBuckets.leads : mobileAlertBuckets.leads.slice(0, 3);
  const hasMoreLeads = mobileAlertBuckets.leads.length > visibleLeads.length;
  const visibleLowStock = showMoreLowStock ? [...mobileAlertBuckets.refillAlerts, ...mobileAlertBuckets.lowStock] : [...mobileAlertBuckets.refillAlerts, ...mobileAlertBuckets.lowStock].slice(0, 3);
  const hasMoreLowStock = [...mobileAlertBuckets.refillAlerts, ...mobileAlertBuckets.lowStock].length > visibleLowStock.length;
  const todayInvoices = Array.isArray(dashboard?.overview?.recentInvoices) ? dashboard.overview.recentInvoices : [];
  const setTaskExpanded = (taskId, expanded) => {
    setExpandedTaskIds((current) => ({ ...current, [taskId]: expanded }));
  };
  const isTaskCompleted = (task = {}) => ["completed", "approved"].includes(normalizeText(task.status));
  const isTaskExpanded = (task = {}) => Boolean(expandedTaskIds[task.id]) || !isMobilePortal;
  const salesTrendValues = trend7d.map((item) => Number(item.revenue || 0));
  const invoiceTrendValues = trend7d.map((item) => Number(item.orders || 0));
  const salesGrowthPercent = Number(salesComparison.sales_growth || 0);
  const mobileSalesSummary = useMemo(() => ({
    sales: formatCurrency(sales?.overview?.today?.sales || dashboard?.today_sales_total || 0),
    invoices: formatNumber(sales?.overview?.today?.orders || dashboard?.invoice_count || 0),
    growth: formatPercent(salesGrowthPercent),
    growthTone: salesGrowthPercent >= 0 ? "green" : "red",
  }), [dashboard?.today_sales_total, dashboard?.invoice_count, sales?.overview?.today?.orders, sales?.overview?.today?.sales, salesGrowthPercent]);
  const mobileDashboardStats = useMemo(() => (
    isMobilePortal
      ? [
          { label: tt("managerPortal.kpi.salesToday"), value: formatCurrency(dashboard?.today_sales_total || 0), icon: ShoppingCart, tone: "cyan", emphasis: true },
          { label: tt("managerPortal.kpi.invoicesToday"), value: formatNumber(dashboard?.invoice_count || 0), icon: ClipboardList, tone: "slate", emphasis: true },
          { label: tt("managerPortal.kpi.attendanceNow"), value: formatNumber(dashboard?.active_employees_now || 0), icon: Users, tone: "green" },
          { label: tt("managerPortal.kpi.pendingApprovals"), value: formatNumber(pendingInventoryApprovalsCount || 0), icon: CheckCircle2, tone: "amber" },
        ]
      : []
  ), [
    dashboard?.today_sales_total,
    dashboard?.invoice_count,
    dashboard?.active_employees_now,
    isMobilePortal,
    pendingInventoryApprovalsCount,
  ]);
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

  const loadDeferredData = useCallback(async () => {
    if (!token) return;
    const [staffRes, tasksRes, salesRes, stockRes] = await Promise.allSettled([
      managerPortalApi.staff(token, { timeoutMs: MANAGER_PORTAL_DEFERRED_TIMEOUT_MS }),
      managerPortalApi.tasks(token, { timeoutMs: MANAGER_PORTAL_DEFERRED_TIMEOUT_MS }),
      managerPortalApi.sales(token, { timeoutMs: MANAGER_PORTAL_DEFERRED_TIMEOUT_MS }),
      managerPortalApi.stockAlerts(token, { timeoutMs: MANAGER_PORTAL_DEFERRED_TIMEOUT_MS }),
    ]);

    const now = Date.now();
    const nextStaff = settledValue(staffRes);
    if (nextStaff) { setStaff(normalizeManagerPortalPayload("staff", nextStaff?.staff || null)); tabFetchedAtRef.current.staff = now; }

    const nextTasks = settledValue(tasksRes);
    if (nextTasks) { setTasks(normalizeManagerPortalPayload("tasks", nextTasks?.tasks || null)); tabFetchedAtRef.current.tasks = now; }

    const nextSales = settledValue(salesRes);
    if (nextSales) { setSales(normalizeManagerPortalPayload("sales", nextSales?.sales || null)); tabFetchedAtRef.current.sales = now; }

    const nextStock = settledValue(stockRes);
    if (nextStock) { setStockAlerts(normalizeManagerPortalPayload("stockAlerts", nextStock?.stockAlerts || null)); tabFetchedAtRef.current.today = now; }
  }, [token]);

  useEffect(() => {
    if (!isBrowser()) return;
    document.title = buildPageTitle(managerPortalTitles[activeTab] || "Manager Portal");
  }, [activeTab]);

  const loadAll = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setRefreshing(Boolean(silent));
      setError("");
      const criticalResults = await Promise.allSettled([
        managerPortalApi.me(token, { timeoutMs: MANAGER_PORTAL_CRITICAL_TIMEOUT_MS }),
        managerPortalApi.dashboard(token, {}, { timeoutMs: MANAGER_PORTAL_CRITICAL_TIMEOUT_MS }),
        managerPortalApi.notifications(token, { limit: 40 }, { timeoutMs: MANAGER_PORTAL_CRITICAL_TIMEOUT_MS }),
        managerPortalApi.inventoryApprovals(token, { limit: 5 }, { timeoutMs: MANAGER_PORTAL_CRITICAL_TIMEOUT_MS }),
      ]);
      const [meRes, dashboardRes, notificationsRes, approvalsRes] = criticalResults;
      const nextMe = settledValue(meRes);
      const nextDashboard = settledValue(dashboardRes);
      const nextNotifications = settledValue(notificationsRes);
      const nextApprovals = settledValue(approvalsRes);

      if (nextMe) {
        const managerPayload = nextMe?.manager || nextMe?.data?.manager || null;
        const permissions = nextMe?.permissions || nextMe?.data?.permissions || managerPayload?.permissions || [];
        setMe(normalizeManagerPortalPayload("me", managerPayload ? { ...managerPayload, permissions } : null));
      }
      if (nextDashboard) setDashboard(normalizeManagerPortalPayload("dashboard", nextDashboard?.dashboard || null));
      if (nextNotifications) {
        setNotifications(normalizeManagerPortalPayload("notifications", Array.isArray(nextNotifications?.notifications) ? nextNotifications.notifications : []));
        setUnreadCount(Number(nextNotifications?.unread_count || 0));
      }
      if (nextNotifications || nextMe) {
        setSettings(mergeSettings(normalizeManagerPortalPayload("settings", nextNotifications?.settings || nextMe?.notification_settings || {})));
      }
      if (nextApprovals) setInventoryApprovals(normalizeManagerPortalPayload("inventoryApprovals", nextApprovals?.inventoryApprovals || null));

      if ([meRes, dashboardRes, notificationsRes, approvalsRes].every((result) => result?.status === "rejected")) {
        const firstCriticalError = [meRes, dashboardRes, notificationsRes, approvalsRes].find((result) => result?.status === "rejected")?.reason;
        setError(firstCriticalError?.responseBody?.message || firstCriticalError?.message || tt("managerPortal.errors.loadPortal"));
      }

      if (isBrowser()) {
        window.setTimeout(() => {
          void loadDeferredData().catch((deferredError) => {
            if (import.meta.env.DEV) console.warn("[manager-portal] deferred load failed", deferredError);
          });
        }, 0);
      } else {
        void loadDeferredData().catch((deferredError) => {
          if (import.meta.env.DEV) console.warn("[manager-portal] deferred load failed", deferredError);
        });
      }
    } catch (loadError) {
      setError(loadError?.responseBody?.message || loadError?.message || tt("managerPortal.errors.loadPortal"));
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
    safeSetLocalStorage("manager_portal_last_url", `/manager-portal/${encodeURIComponent(token)}${window.location.search || ""}`, { raw: true, debug: true });

    const previousTitle = document.title;
    const previousAppleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") || "";
    let appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!appleTitle) {
      appleTitle = document.createElement("meta");
      appleTitle.setAttribute("name", "apple-mobile-web-app-title");
      document.head.appendChild(appleTitle);
    }
    appleTitle.setAttribute("content", "Manager");
      document.title = buildPageTitle(managerPortalTitles[activeTab] || "Manager Portal");

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
      document.title = previousTitle || buildPageTitle("Manager Portal");
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
      transports: ["websocket", "polling"],
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

  const reloadTabData = async (tab = activeTab, { force = false } = {}) => {
    // Skip a redundant refetch when this tab's data was loaded very recently (e.g. by the
    // eager initial load right before the first tab switch). Mutations and manual refresh
    // pass force to always revalidate.
    if (!force && ["today", "staff", "tasks", "sales"].includes(tab)) {
      const fetchedAt = tabFetchedAtRef.current[tab] || 0;
      if (Date.now() - fetchedAt < MANAGER_PORTAL_TAB_FRESH_TTL_MS) return;
    }
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
      tabFetchedAtRef.current[tab] = Date.now();
    } catch (reloadError) {
      toast.error(reloadError?.responseBody?.message || reloadError?.message || tt("managerPortal.errors.refreshData"));
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
      toast.error(readError?.responseBody?.message || readError?.message || tt("managerPortal.errors.updateNotification"));
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
      await reloadTabData("today", { force: true });
    } catch (readError) {
      setNotifications(previous);
      toast.error(readError?.responseBody?.message || readError?.message || tt("managerPortal.errors.updateNotifications"));
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
      setInvoiceSheet({ open: true, loading: false, invoice: null, error: invoiceError?.responseBody?.message || invoiceError?.message || tt("managerPortal.errors.loadInvoice") });
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

  const copyText = async (value, successMessage = tt("managerPortal.toasts.copied")) => {
    if (!value) return;
    try {
      await window.navigator?.clipboard?.writeText(String(value));
      toast.success(successMessage);
    } catch {
      toast.error(tt("managerPortal.errors.copy"));
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
      toast.success(tt("managerPortal.toasts.settingsSaved"));
    } catch (saveError) {
      toast.error(saveError?.responseBody?.message || saveError?.message || tt("managerPortal.errors.saveSettings"));
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
    toast.success(tt("managerPortal.toasts.soundEnabled"));
  };

  const enableBrowserNotifications = async () => {
    const permission = await requestBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);
    if (permission === "granted") toast.success(tt("managerPortal.toasts.browserNotificationsEnabled"));
    else toast.error(tt("managerPortal.errors.browserNotificationsNotEnabled"));
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
      setPushState((current) => ({ ...current, supported: false, message: tt("managerPortal.push.unsupportedDetail") }));
      toast.error(tt("managerPortal.push.unsupported"));
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
        setPushState((current) => ({ ...current, permission, saving: false, message: tt("managerPortal.push.permissionDeniedDetail") }));
        toast.error(tt("managerPortal.push.permissionNotGranted"));
        return;
      }
      const keyResponse = await managerPortalApi.pushPublicKey(token);
      const publicKey = keyResponse?.publicKey || "";
      if (!publicKey || keyResponse?.enabled === false) throw new Error(tt("managerPortal.push.notConfigured"));
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
        message: tt("managerPortal.push.enabledDetail"),
      });
      toast.success(tt("managerPortal.push.enabled"));
    } catch (pushError) {
      setPushState((current) => ({ ...current, saving: false, message: pushError?.responseBody?.message || pushError?.message || tt("managerPortal.push.enableFailed") }));
      toast.error(pushError?.responseBody?.message || pushError?.message || tt("managerPortal.push.enableFailed"));
    }
  };

  const sendTestPushNotification = async () => {
    if (!pushSupported()) {
      setPushState((current) => ({ ...current, message: tt("managerPortal.push.unsupportedDetail") }));
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
          ? tt("managerPortal.push.vapidMissing")
          : subscriptionCount > 0
            ? `تم إرسال الاختبار إلى ${subscriptionCount} اشتراك.`
            : tt("managerPortal.push.noActiveSubscriptionsDetail"),
      }));
      toast.success(response?.result?.skipped ? tt("managerPortal.push.settingsNotReady") : subscriptionCount > 0 ? tt("managerPortal.push.testSent") : tt("managerPortal.push.noActiveSubscriptions"));
    } catch (pushError) {
      setPushState((current) => ({ ...current, saving: false, message: pushError?.responseBody?.message || pushError?.message || tt("managerPortal.push.testFailed") }));
      toast.error(pushError?.responseBody?.message || pushError?.message || tt("managerPortal.push.testFailed"));
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
      setPushState((current) => ({ ...current, saving: false, subscribed: false, endpointHost: "", message: tt("managerPortal.push.disabledDetail") }));
      toast.success(tt("managerPortal.push.disabled"));
    } catch (pushError) {
      setPushState((current) => ({ ...current, saving: false, message: pushError?.responseBody?.message || pushError?.message || tt("managerPortal.push.disableFailed") }));
      toast.error(pushError?.responseBody?.message || pushError?.message || tt("managerPortal.push.disableFailed"));
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
      await reloadTabData("tasks", { force: true });
      toast.success(tt("managerPortal.toasts.taskUpdated"));
    } catch (taskError) {
      toast.error(taskError?.responseBody?.message || taskError?.message || tt("managerPortal.errors.updateTask"));
    }
  };

  const createTask = async () => {
    if (!taskDraft.title.trim()) {
      toast.error(tt("managerPortal.tasks.titleRequired"));
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
      await reloadTabData("tasks", { force: true });
      toast.success(tt("managerPortal.toasts.taskCreated"));
    } catch (taskError) {
      toast.error(taskError?.responseBody?.message || taskError?.message || tt("managerPortal.errors.createTask"));
    }
  };

  const openInventoryApprovals = () => {
    if (!token) return;
    navigate(`/manager-portal/${encodeURIComponent(token)}/inventory-approvals`);
  };

  const reviewAdvanceRequest = async (requestId, status) => {
    setAdvanceRequestReviewingId(String(requestId));
    try {
      await managerPortalApi.reviewAdvanceRequest(token, requestId, { status });
      await reloadTabData("staff", { force: true });
      toast.success(status === "approved" ? tt("managerPortal.toasts.advanceApproved") : tt("managerPortal.toasts.advanceRejected"));
    } catch (reviewError) {
      toast.error(reviewError?.responseBody?.message || reviewError?.message || tt("managerPortal.errors.updateAdvance"));
    } finally {
      setAdvanceRequestReviewingId("");
    }
  };

  const renderTaskCard = (task) => {
    const note = taskNotes[task.id] || "";
    const statusMeta = taskStatusMeta(task);
    const proofUrl = taskProofUrl(task);
    const completed = isTaskCompleted(task);
    const expanded = isTaskExpanded(task);
    const toggleExpanded = () => setTaskExpanded(task.id, !expandedTaskIds[task.id]);

    if (isMobilePortal) {
      return (
        <Card key={task.id} title={portalText(task.title_ar || task.title || "Task")} subtitle={portalText(task.branch_name || task.task_type || "task")} icon={ClipboardList} compact bodyClassName="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black leading-5 text-slate-950">{portalText(task.title_ar || task.title || "Task")}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <StatusPill tone={statusMeta.tone} value={statusMeta.label} />
                <StatusPill tone="slate" value={portalText(task.assignee_name || task.employee_name || "Unassigned")} />
                {task.branch_name ? <StatusPill tone="slate" value={portalText(task.branch_name)} /> : null}
                <StatusPill
                  tone="blue"
                  value={completed ? formatCompactDateTime(task.completed_at || task.updated_at || task.created_at) : formatCompactDateTime(task.due_at)}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={toggleExpanded} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-800">
              {expanded ? tt("managerPortal.tasks.hideDetails") : tt("managerPortal.tasks.showDetails")}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            <button
              type="button"
              data-testid={`task-reopen-${task.id}`}
              onClick={() => void sendTaskAction(task.id, "reopen", { note })}
              className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-800"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {tt("managerPortal.tasks.reopen")}
            </button>
            {!completed ? (
              <>
                <button
                  type="button"
                  data-testid={`task-approve-${task.id}`}
                  onClick={() => void sendTaskAction(task.id, "approve", { note })}
                  className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-xs font-black text-[var(--primary-contrast)]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {tt("managerPortal.actions.approve")}
                </button>
                <button
                  type="button"
                  data-testid={`task-reject-${task.id}`}
                  onClick={() => void sendTaskAction(task.id, "reject", { note })}
                  className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-amber-300 bg-white px-3 text-xs font-black text-amber-800 shadow-sm"
                >
                  <X className="h-3.5 w-3.5" />
                  {tt("managerPortal.actions.reject")}
                </button>
              </>
            ) : null}
          </div>

          {expanded ? (
            <div className="space-y-2 rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-700 shadow-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                  <div className="font-black text-slate-500">{tt("managerPortal.tasks.createdAt")}</div>
                  <div className="mt-0.5 font-black text-slate-950">{formatCompactDateTime(task.created_at)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                  <div className="font-black text-slate-500">{tt("managerPortal.tasks.dueAt")}</div>
                  <div className="mt-0.5 font-black text-slate-950">{formatCompactDateTime(task.due_at)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                  <div className="font-black text-slate-500">{tt("managerPortal.tasks.attachments")}</div>
                  <div className="mt-0.5 font-black text-slate-950">{formatNumber(task.attachments_count || 0)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                  <div className="font-black text-slate-500">{tt("managerPortal.tasks.startEnd")}</div>
                  <div className="mt-0.5 font-black text-slate-950">{formatCompactDateTime(task.started_at)} / {formatCompactDateTime(task.completed_at)}</div>
                </div>
              </div>
              {proofUrl ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {["image", "photo", "img"].some((type) => String(task.latest_attachment_type || "").toLowerCase().includes(type)) ? (
                    <a href={proofUrl} target="_blank" rel="noreferrer" className="block">
                      <img src={proofUrl} alt={portalText(taskProofLabel(task) || task.title || "Task proof")} className="h-36 w-full object-cover" />
                    </a>
                  ) : (
                    <a href={proofUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs font-black text-slate-700">
                      <span className="min-w-0 truncate">{portalText(taskProofLabel(task) || "Proof attachment")}</span>
                      <ChevronRight className="h-4 w-4" />
                    </a>
                  )}
                </div>
              ) : null}
              <textarea
                value={note}
                onChange={(event) => setTaskNotes((current) => ({ ...current, [task.id]: event.target.value }))}
                placeholder={tt("managerPortal.tasks.managerNote")}
                rows={2}
                className="w-full rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none"
              />
            </div>
          ) : null}
        </Card>
      );
    }

    return (
      <Card key={task.id} title={portalText(task.title_ar || task.title || "Task")} subtitle={portalText(task.branch_name || task.task_type || "task")} icon={ClipboardList}>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={statusMeta.tone} value={statusMeta.label} />
          <StatusPill tone="amber" value={task.priority || "medium"} />
          <StatusPill tone="slate" value={task.assignee_name || task.employee_name || "Unassigned"} />
          {task.branch_name ? <StatusPill tone="slate" value={portalText(task.branch_name)} /> : null}
        </div>
        <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:grid-cols-2">
          <div>{tt("managerPortal.labels.employee")}: {task.assignee_name || task.employee_name || "-"}</div>
          <div>{tt("managerPortal.labels.branch")}: {task.branch_name || "-"}</div>
          <div>{tt("managerPortal.labels.created")}: {formatDateTime(task.created_at)}</div>
          <div>{tt("managerPortal.labels.due")}: {formatDateTime(task.due_at)}</div>
          <div>{tt("managerPortal.labels.startEnd")}: {formatDateTime(task.started_at)} / {formatDateTime(task.completed_at)}</div>
          <div>{tt("managerPortal.labels.attachments")}: {formatNumber(task.attachments_count || 0)}</div>
        </div>
        {proofUrl ? (
          <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
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
          <button type="button" data-testid={`task-approve-${task.id}`} onClick={() => void sendTaskAction(task.id, "approve", { note })} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)]">
            <CheckCircle2 className="h-4 w-4" />
            {tt("managerPortal.actions.approve")}
          </button>
          <button type="button" data-testid={`task-reject-${task.id}`} onClick={() => void sendTaskAction(task.id, "reject", { note })} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-amber-300 bg-white px-4 py-3 text-sm font-black text-amber-800 shadow-sm">
            <X className="h-4 w-4" />
            {tt("managerPortal.tasks.rejectOrReturn")}
          </button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button type="button" data-testid={`task-reopen-${task.id}`} onClick={() => void sendTaskAction(task.id, "reopen", { note })} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
            <ArrowLeftRight className="h-4 w-4" />
            {tt("managerPortal.tasks.reopen")}
          </button>
          <button type="button" data-testid={`task-note-${task.id}`} onClick={() => void sendTaskAction(task.id, "note", { note })} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
            <SquarePen className="h-4 w-4" />
            {tt("managerPortal.tasks.addNote")}
          </button>
        </div>
        <textarea value={note} onChange={(event) => setTaskNotes((current) => ({ ...current, [task.id]: event.target.value }))} placeholder={tt("managerPortal.tasks.managerNote")} rows={2} className="mt-2 w-full rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
      </Card>
    );
  };

  // The page surface. This carried a four-layer fixed-light gradient (navy +
  // amber + indigo washes over a slate ramp) with a `dark:bg-slate-950`
  // counterpart; `.manager-portal-shell` in ManagerPortal.m1.css has been
  // overriding the whole thing with `background: var(--bg)` regardless.
  return (
    <main
      data-testid="manager-portal-root"
      dir="rtl"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)",
      }}
      className={`manager-portal-readable-v2 manager-portal-shell ${isMobilePortal ? "manager-portal-mobile-dark" : ""} min-h-[100dvh] bg-background px-3 text-right text-text md:px-4`}
    >
      <div className="mx-auto grid max-w-[96rem] gap-3 lg:grid-cols-[240px_minmax(0,1.55fr)_320px] lg:gap-4">
        <aside className="hidden min-h-[calc(100dvh-2rem)] rounded-[2rem] border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/50 lg:block">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-950 p-3 text-white">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-black tracking-[0.16em] text-slate-500">{tt("managerPortal.shell.commandCenter")}</div>
              <div className="text-lg font-black">{portalText(me?.full_name || me?.name || tt("managerPortal.shell.manager"))}</div>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-3xl bg-slate-950 p-4 text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
              <div className="text-xs font-black text-slate-300">{tt("managerPortal.common.today")}</div>
              <div className="mt-2 text-3xl font-black text-white">{formatCurrency(dashboard?.today_sales_total || 0)}</div>
              <div className="mt-2 text-sm font-semibold text-slate-300">{formatNumber(dashboard?.invoice_count || 0)} فاتورة اليوم</div>
            </div>
            <button type="button" data-testid="refresh-button-mobile" onClick={() => void loadAll({ silent: true })} className="flex w-full items-center justify-between rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-800">
              <span>{tt("managerPortal.shell.liveRefresh")}</span>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                data-testid={`sidebar-tab-${tab}`}
                onClick={() => tab === "inventory" ? openInventoryApprovals() : setActiveTab(tab)}
                className={`flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-3 text-sm font-black transition ${ activeTab === tab ? "bg-[linear-gradient(180deg,#ffffff,#e2e8f0)] text-slate-950 shadow-sm" : "bg-white text-slate-700" }`}
              >
                <span>{tab === "today" ? tt("managerPortal.common.today") : tab === "staff" ? tt("managerPortal.nav.team") : tab === "tasks" ? tt("managerPortal.nav.tasks") : tab === "sales" ? tt("managerPortal.sections.sales") : tab === "chat" ? tt("managerPortal.nav.chat") : tab === "inventory" ? tt("managerPortal.nav.stockCount") : tab === "notifications" ? tt("managerPortal.alerts.settings") : tt("managerPortal.nav.more")}</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            ))}
          </div>
        </aside>

        <section className="manager-portal-main-column space-y-2.5 sm:space-y-4">
          {error ? (
            <div className="rounded-[1.5rem] border border-amber-200 bg-white p-4 shadow-sm dark:border-amber-500/20 dark:bg-white/[0.04]">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-6 w-6 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <h2 className="m1-section-title text-slate-950 dark:text-white">{tt("managerPortal.errors.partialLoad")}</h2>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{error}</p>
                  <button type="button" onClick={() => void loadAll()} className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)] dark:bg-white dark:text-[var(--primary-contrast)]">
                    <RefreshCw className="h-4 w-4" />
                    {tt("managerPortal.actions.retry")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {loading && !me && !dashboard ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`manager-portal-skeleton-${index}`} className="animate-pulse rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="h-3 w-20 rounded-full bg-slate-200 dark:bg-white/10" />
                  <div className="mt-4 h-8 w-24 rounded-2xl bg-slate-200 dark:bg-white/10" />
                  <div className="mt-3 h-3 w-32 rounded-full bg-slate-200 dark:bg-white/10" />
                  <div className="mt-5 grid grid-cols-3 gap-2">
                    <div className="h-16 rounded-2xl bg-slate-100 dark:bg-white/5" />
                    <div className="h-16 rounded-2xl bg-slate-100 dark:bg-white/5" />
                    <div className="h-16 rounded-2xl bg-slate-100 dark:bg-white/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {activeTab === "today" ? (isMobilePortal ? (
            <header className="manager-portal-hero manager-portal-mobile-hero mt-2 rounded-[1.45rem] border border-slate-800 bg-[#050816] p-3 shadow-[0_14px_30px_rgba(2,6,23,0.22)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{tt("managerPortal.shell.title")}</div>
                  <h1 className="m1-page-title mt-1 truncate text-white">{portalText(me?.full_name || me?.name || tt("managerPortal.shell.manager"))}</h1>
                  <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{portalText(me?.branch_name || tt("managerPortal.filters.allBranches"))}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setTheme(theme.mode === "dark" ? "light" : "dark")} className="manager-theme-toggle inline-flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-slate-700 bg-primary text-slate-100" aria-label={theme.mode === "dark" ? tt("managerPortal.theme.light") : tt("managerPortal.theme.dark")}>
                    {theme.mode === "dark" ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    data-testid="refresh-button"
                    onClick={() => void loadAll({ silent: true })}
                    className="manager-refresh-button inline-flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-slate-700 bg-primary text-slate-100 shadow-sm transition hover:bg-[var(--primary-hover)]"
                    aria-label={tt("managerPortal.actions.refresh")}
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>
            </header>
          ) : (
            <header className="manager-portal-hero rounded-[2rem] border border-slate-200 bg-slate-950 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-300">{tt("managerPortal.shell.title")}</div>
                  <h1 className="m1-page-title mt-1 text-white">{portalText(me?.full_name || me?.name || tt("managerPortal.shell.manager"))}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-300">
                    <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" /> {portalText(me?.branch_name || tt("managerPortal.filters.allBranches"))}</span>
                    <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {portalText(me?.role || tt("managerPortal.roles.manager"))}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge className="border-slate-700 bg-slate-800 text-slate-100">{tt("managerPortal.shell.live")}</Badge>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setTheme(theme.mode === "dark" ? "light" : "dark")} className="manager-theme-toggle inline-flex h-[var(--control-height-lg)] w-11 items-center justify-center rounded-[var(--radius-control)] border border-slate-700 bg-primary text-[var(--primary-contrast)]" aria-label={theme.mode === "dark" ? tt("managerPortal.theme.light") : tt("managerPortal.theme.dark")} title={theme.mode === "dark" ? tt("managerPortal.theme.light") : tt("managerPortal.theme.dark")}>
                      {theme.mode === "dark" ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={openInventoryApprovals}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-amber-300/30 bg-amber-400 px-3 py-2 text-sm font-black text-black shadow-sm transition hover:bg-amber-300"
                    >
                      <ClipboardList className="h-4 w-4" />
                      <span>{tt("managerPortal.stockCount.pendingApproval")}</span>
                      {pendingInventoryApprovalsCount ? (
                        <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-black">{formatNumber(pendingInventoryApprovalsCount)}</span>
                      ) : null}
                    </button>
                    <button
                      ref={notificationButtonRef}
                      type="button"
                      data-testid="manager-notifications-button"
                      aria-label={tt("managerPortal.chrome.openNotifications")}
                      aria-expanded={notificationsOpen}
                      onClick={() => setNotificationsOpen((current) => !current)}
                      className="relative inline-flex h-[var(--control-height-lg)] w-11 items-center justify-center rounded-[var(--radius-control)] border border-slate-700 bg-[linear-gradient(180deg,#0f172a,#111827)] text-white transition hover:border-slate-500 hover:bg-[linear-gradient(180deg,#111827,#1e293b)]"
                    >
                      <Bell className="h-4 w-4" />
                      {(unreadCount || notificationsUnread) ? (
                        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black leading-4 text-white shadow-sm">
                          {formatNumber(unreadCount || notificationsUnread)}
                        </span>
                      ) : null}
                    </button>
                    <button type="button" data-testid="refresh-button" onClick={() => void loadAll({ silent: true })} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-white px-3 py-2 text-sm font-black text-slate-950 shadow-sm">
                      <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                      {tt("managerPortal.actions.refresh")}
                    </button>
                  </div>
                </div>
              </div>
            </header>
          )) : null}

          {showInstallCard ? (
            <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 text-slate-950 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-slate-200 bg-white text-slate-700 shadow-sm">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="m1-section-title">{tt("managerPortal.install.title")}</h3>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-600">
                    {isIosDevice()
                      ? tt("managerPortal.install.iosHint")
                      : tt("managerPortal.install.hint")}
                  </p>
                  {installPrompt ? (
                    <button type="button" onClick={installApp} className="mt-3 inline-flex min-h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-xs font-black text-[var(--primary-contrast)]">
                      <Download className="h-4 w-4" />
                      {tt("managerPortal.install.action")}
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
                aria-label={tt("managerPortal.chrome.closeNotifications")}
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
                        {tt("managerPortal.shell.live")}
                      </div>
                      <h2 id="manager-notifications-title" className="m1-section-title mt-3 text-white">
                        {tt("managerPortal.notifications.title")}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        {tt("managerPortal.notifications.subtitle")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      className="inline-flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-slate-700 bg-primary text-[var(--primary-contrast)] transition hover:border-slate-500 hover:bg-[var(--primary-hover)]"
                      aria-label={tt("managerPortal.notifications.close")}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2.5">
                      <div className="text-[11px] font-black text-slate-500">{tt("managerPortal.notifications.unread")}</div>
                      <div className="mt-1 text-xl font-black text-slate-950">{formatNumber(unreadCount || notificationsUnread)}</div>
                    </div>
                    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2.5">
                      <div className="text-[11px] font-black text-slate-500">{tt("managerPortal.common.total")}</div>
                      <div className="mt-1 text-xl font-black text-slate-950">{formatNumber(managerNotifications.length || 0)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void markAllNotificationsRead()}
                      disabled={!notifications.some((item) => !item.is_read)}
                      className="inline-flex min-h-[4.5rem] flex-col items-start justify-center rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-2.5 text-left text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <CheckCheck className="h-4 w-4" />
                      <span className="mt-1 text-xs font-black">{tt("managerPortal.notifications.markAllRead")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadAll({ silent: true })}
                      className="inline-flex min-h-[4.5rem] flex-col items-start justify-center rounded-[var(--radius-control)] bg-primary px-3 py-2.5 text-left text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)]"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                      <span className="mt-1 text-xs font-black">{tt("managerPortal.actions.refresh")}</span>
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
                          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition ${ active ? "border-slate-950 bg-primary text-[var(--primary-contrast)]" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-[var(--primary-contrast)]" }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{tt(item.labelKey)}</span>
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
                            className={`overflow-hidden rounded-[var(--radius-card)] border p-4 shadow-sm transition ${ unread ? "border-primary bg-[linear-gradient(180deg,#ffffff,#f8fafc)] ring-1 ring-primary dark:border-primary/20 dark:bg-white/[0.03] dark:ring-primary/10" : "border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] dark:border-white/10 dark:bg-white/[0.02]" }`}
                          >
                            <button
                              type="button"
                              onClick={() => void openNotification(item)}
                              className="flex w-full items-start gap-3 text-right"
                            >
                              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ${unread ? "bg-white text-primary ring-primary dark:bg-white/[0.03] dark:text-primary dark:ring-primary/20" : "bg-white text-slate-600 ring-slate-200 dark:bg-white/[0.03] dark:text-slate-200 dark:ring-white/10"}`}>
                                <Icon className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h3 className="m1-section-title truncate text-slate-950 dark:text-white">{item.title || tt("managerPortal.notifications.types.generic")}</h3>
                                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                      {item.message || item.body || tt("managerPortal.notifications.noDetails")}
                                    </p>
                                  </div>
                                  {unread ? <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_12px_rgba(14,165,233,0.65)] dark:bg-primary" /> : null}
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
                                  className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-xs font-black text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)] dark:bg-white dark:text-[var(--primary-contrast)] dark:hover:bg-slate-100"
                                >
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                  {tt("managerPortal.actions.open")}
                                </button>
                              ) : null}
                              {unread ? (
                                <button
                                  type="button"
                                  onClick={() => void markNotificationRead(item.id)}
                                  className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-primary hover:text-primary dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-primary/35 dark:hover:text-primary"
                                >
                                  <CheckCheck className="h-3.5 w-3.5" />
                                  {tt("managerPortal.notifications.markRead")}
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
                      <h3 className="m1-section-title mt-5 text-slate-950 dark:text-white">{tt("managerPortal.notifications.empty")}</h3>
                      <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500 dark:text-slate-400">
                        {tt("managerPortal.notifications.emptyHint")}
                      </p>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          ) : null}

          {activeTab === "today" ? (
            <div data-testid="manager-dashboard-panel" className="space-y-4">
              {isMobilePortal ? (
                <div className="manager-portal-mobile-stat-grid grid grid-cols-2 gap-2">
                  {mobileDashboardStats.map((item) => (
                    <CompactStatCard key={item.label} label={item.label} value={item.value} icon={item.icon} tone={item.tone} emphasis={item.emphasis} />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <MiniMetric label={tt("managerPortal.kpi.salesToday")} value={formatCurrency(dashboard?.today_sales_total || 0)} icon={ShoppingCart} tone="green" />
                    <MiniMetric label={tt("managerPortal.stats.invoiceCount")} value={formatNumber(dashboard?.invoice_count || 0)} icon={ClipboardList} tone="cyan" />
                    <MiniMetric label={tt("managerPortal.sections.hotLeads")} value={formatNumber(dedupedLeads.length || 0)} icon={Bot} tone="red" />
                    <MiniMetric label={tt("managerPortal.notifications.categories.employeeChat")} value={formatNumber(employeeMessageNotifications.length || 0)} icon={MessageSquare} tone="blue" />
                  </div>

                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                    <MiniMetric label={tt("managerPortal.stats.presentNow")} value={formatNumber(dashboard?.active_employees_now || 0)} icon={Users} tone="green" />
                    <MiniMetric label={tt("managerPortal.stats.absent")} value={formatNumber(dashboard?.absent_employees || 0)} icon={X} tone="slate" />
                    <MiniMetric label={tt("managerPortal.stats.late")} value={formatNumber(dashboard?.late_employees || 0)} icon={Clock3} tone="amber" />
                    <MiniMetric label={tt("managerPortal.stats.openTasks")} value={formatNumber(dashboard?.pending_tasks || 0)} icon={ClipboardList} tone="blue" />
                    <MiniMetric label={tt("managerPortal.stats.overdueTasks")} value={formatNumber(dashboard?.overdue_tasks || 0)} icon={AlertTriangle} tone="red" />
                  </div>
                </>
              )}

              {todayInvoices.length || !isMobilePortal ? (
                <section ref={liveFeedSectionRef} className="scroll-mt-28">
                  <Card title={tt("managerPortal.sections.todayInvoices")} subtitle={`${formatNumber(todayInvoices.length)} فاتورة اليوم`} icon={ClipboardList} compact bodyClassName="space-y-2">
                    {todayInvoices.length ? (
                      <div className="space-y-2">
                        {todayInvoices.map((invoice) => (
                          <article key={`today-invoice-${invoice.id}`} className="rounded-2xl border border-slate-800 bg-[#0f172a] px-3 py-3 text-right shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-black text-white">{tt("managerPortal.invoice.label")} {portalText(invoice.invoice_number || invoice.id || "")}</div>
                                <div className="mt-1 text-xs font-semibold text-slate-400">{portalText(invoice.customer_name || tt("managerPortal.invoices.walkInCustomer"))} · {formatDateTime(invoice.created_at)}</div>
                              </div>
                              <div className="shrink-0 text-left">
                                <div className="text-sm font-black text-emerald-300">{formatCurrency(invoice.total || 0)}</div>
                                <div className="mt-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] font-black text-amber-200">{paymentMethodLabel(invoice.payment_method || invoice.payment_type)}</div>
                              </div>
                            </div>
                            <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                              {(invoice.items || []).map((item) => (
                                <div key={item.id || `${invoice.id}-${item.product_id}-${item.variant_id}`} className="flex items-center gap-2">
                                  {item.image_url ? <img src={resolveProductImageUrl(item.image_url)} alt="" className="h-12 w-12 shrink-0 rounded-[var(--radius-card)] border border-slate-700 bg-white object-cover" loading="lazy" /> : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900"><Package className="h-5 w-5 text-slate-400" /></div>}
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs font-black text-white">{portalText(item.product_name || tt("managerPortal.common.product"))}</div>
                                    <div className="mt-0.5 truncate text-[11px] font-bold text-slate-400">{[portalText(item.color || ""), portalText(item.size || ""), `${formatNumber(item.quantity || 0)} قطعة`].filter(Boolean).join(" · ")}</div>
                                  </div>
                                  <div className="shrink-0 text-xs font-black text-white">{formatCurrency(item.line_total || item.price || 0)}</div>
                                </div>
                              ))}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState compact title={tt("managerPortal.invoices.empty")} body={tt("managerPortal.invoices.emptyHint")} />
                    )}
                  </Card>
                </section>
              ) : null}

              <Card title={tt("managerPortal.sections.paymentBreakdown")} subtitle={tt("managerPortal.sections.paymentBreakdown")} icon={ArrowLeftRight}>
                {paymentBreakdown.length ? (
                  <div className="space-y-2">
                    {paymentBreakdown.map((row) => (
                      <div key={row.method} className="flex items-center justify-between rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800">
                        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />{paymentMethodLabel(row.method)}</span>
                        <span className="inline-flex items-center gap-2 text-slate-950"><span className="font-black">{formatCurrency(row.total || 0)}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{formatNumber(row.count || 0)} عملية</span></span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact title={tt("managerPortal.payment.empty")} body={tt("managerPortal.payment.emptyHint")} />
                )}
              </Card>

              {false && mobileAlertBuckets.aiInsights.length ? (
                <Card title={tt("managerPortal.sections.aiInsights")} subtitle={tt("managerPortal.sections.smartAnalytics")} icon={Bot}>
                  <div className="grid gap-2 md:grid-cols-2">
                    {mobileAlertBuckets.aiInsights.map((item, index) => (
                      <div key={`${item.title || item.body || index}`} className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 text-sm font-semibold leading-6 text-slate-800">
                        <div className="text-xs font-black text-slate-600">{insightTitleLabel(item.type, item.title)}</div>
                        <div className="mt-1">{renderInsightBody(item)}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              {mobileAlertBuckets.aiInsights.length || mobileAlertBuckets.lowStock.length || mobileAlertBuckets.refillAlerts.length || mobileAlertBuckets.leads.length || mobileAlertBuckets.operationalEvents.length ? null : (
                <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-500 shadow-sm">
                  {tt("managerPortal.alerts.emptyExtra")}
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "staff" ? (
            <div className="manager-portal-tab manager-portal-tab--staff space-y-2 sm:space-y-3">
              <section className="manager-advance-panel rounded-2xl border p-3 text-right shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-black text-slate-950 dark:text-white">{tt("managerPortal.advances.title")}</div>
                    <div className="mt-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">{tt("managerPortal.advances.subtitle")}</div>
                  </div>
                  <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-amber-400 px-2.5 py-1 text-xs font-black text-slate-950">
                    {formatNumber(advanceRequests.length)}
                  </span>
                </div>

                {advanceRequests.length ? (
                  <div className="mt-3 space-y-2">
                    {advanceRequests.map((request) => {
                      const reviewing = advanceRequestReviewingId === String(request.id);
                      return (
                        <div key={request.id} className="manager-advance-request-card rounded-xl border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-slate-950 dark:text-white">{portalText(request.employee_name || tt("managerPortal.common.employee"))}</div>
                              <div className="mt-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">{formatDateTime(request.created_at)}</div>
                              <div className="mt-1 text-[11px] font-black text-amber-700 dark:text-amber-300">{request.payment_method === "vodafone_cash" ? tt("managerPortal.payment.vodafoneCash") : request.payment_method === "instapay" ? tt("managerPortal.payment.instapay") : tt("managerPortal.advances.cashFromShift")}</div>
                            </div>
                            <div className="shrink-0 text-base font-black text-amber-700 dark:text-amber-300">{formatCurrency(request.amount || 0)}</div>
                          </div>
                          {request.message ? <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-600 dark:bg-black/20 dark:text-slate-300">{portalText(request.message)}</div> : null}
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button type="button" disabled={reviewing} onClick={() => reviewAdvanceRequest(request.id, "rejected")} className="rounded-[var(--radius-control)] border border-rose-300 px-3 py-2.5 text-xs font-black text-rose-700 disabled:opacity-50 dark:border-rose-400/30 dark:text-rose-300">{tt("managerPortal.actions.reject")}</button>
                            <button type="button" disabled={reviewing} onClick={() => reviewAdvanceRequest(request.id, "approved")} className="rounded-[var(--radius-control)] bg-primary px-3 py-2.5 text-xs font-black text-[var(--primary-contrast)] disabled:opacity-50">{reviewing ? tt("managerPortal.common.processing") : tt("managerPortal.advances.approve")}</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="manager-advance-empty mt-3 rounded-xl border border-dashed px-3 py-4 text-center text-xs font-bold text-slate-500 dark:text-slate-400">{tt("managerPortal.advances.empty")}</div>
                )}
              </section>
              {staffList.length ? staffList.map((employee) => (
                isMobilePortal ? (
                  <div
                    key={employee.employee_id}
                    data-tone={employee.attendance_status === "checked_in" ? "green" : employee.attendance_status === "late" ? "amber" : "gold"}
                    className="manager-portal-employee-card rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-3 shadow-[0_10px_22px_rgba(15,23,42,0.06)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-black leading-5 text-slate-950">
                          {portalText(employee.employee_name || tt("managerPortal.common.employee"))}
                        </div>
                        <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-black text-slate-800">
                          <span
                            className={`h-2 w-2 rounded-full ${ employee.attendance_status === "checked_in" ? "bg-emerald-500" : employee.attendance_status === "online" ? "bg-primary" : employee.attendance_status === "late" ? "bg-amber-500" : "bg-slate-400" }`}
                          />
                          {portalText(employee.attendance_status || "absent")}
                        </div>
                      </div>
                      <div className="shrink-0 text-left">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{tt("managerPortal.kpi.salesToday")}</div>
                        <div className="mt-0.5 text-[16px] font-black leading-none text-slate-950">
                          {formatCurrency(employee.sales_today || 0)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-2 py-2 text-right">
                        <div className="text-[10px] font-black text-slate-500">{tt("managerPortal.common.invoices")}</div>
                        <div className="mt-0.5 text-sm font-black text-slate-950">{formatNumber(employee.invoices_count || 0)}</div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-2 py-2 text-right">
                        <div className="text-[10px] font-black text-slate-500">{tt("managerPortal.common.shift")}</div>
                        <div className="mt-0.5 text-sm font-black text-slate-950">{Number(employee.shift_duration_hours || 0).toFixed(1)} س</div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-2 py-2 text-right">
                        <div className="text-[10px] font-black text-slate-500">{tt("managerPortal.common.lastActivity")}</div>
                        <div className="mt-0.5 truncate text-sm font-black text-slate-950">{formatTime(employee.last_activity)}</div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-2 py-2 text-right">
                        <div className="text-[10px] font-black text-slate-500">{tt("managerPortal.advances.total")}</div>
                        <div className="mt-0.5 truncate text-sm font-black text-slate-950">{formatCurrency(employee.total_advances || 0)}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Card key={employee.employee_id} title={portalText(employee.employee_name || tt("managerPortal.common.employee"))} subtitle={portalText(employee.department || employee.job_title || tt("managerPortal.nav.team"))} icon={Users}>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone={employee.attendance_status === "checked_in" ? "green" : employee.attendance_status === "online" ? "blue" : "slate"} value={portalText(employee.attendance_status || "absent")} />
                      <StatusPill tone="blue" value={`المهام ${formatNumber(employee.open_tasks || 0)}/${formatNumber(employee.completed_tasks || 0)}`} />
                      <StatusPill tone="amber" value={`المبيعات ${formatCurrency(employee.sales_today || 0)}`} />
                    </div>
                    <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                      <div>{tt("managerPortal.labels.attendance")}: {formatTime(employee.check_in_time)} - {formatTime(employee.check_out_time)}</div>
                      <div>{tt("managerPortal.labels.shift")}: {Number(employee.shift_duration_hours || 0).toFixed(2)} ساعة</div>
                      <div>{tt("managerPortal.labels.invoices")}: {formatNumber(employee.invoices_count || 0)}</div>
                      <div>{tt("managerPortal.labels.lastActivity")}: {formatDateTime(employee.last_activity)}</div>
                      <div>{tt("managerPortal.labels.totalAdvances")}: {formatCurrency(employee.total_advances || 0)}</div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{tt("managerPortal.labels.expectedCommission")} {employee.expected_commission == null ? tt("managerPortal.common.unavailableFeminine") : formatCurrency(employee.expected_commission || 0)}</Badge>
                      <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{tt("managerPortal.stats.openTasks")} {formatNumber(employee.open_tasks || 0)}</Badge>
                    </div>
                  </Card>
                )
              )) : (
                <EmptyState title={tt("managerPortal.team.empty")} body={tt("managerPortal.team.emptyHint")} />
              )}
            </div>
          ) : null}

          {activeTab === "tasks" ? (
            <div className="manager-portal-tab manager-portal-tab--tasks space-y-4">
              <Card title={tt("managerPortal.tasks.create")} subtitle={tt("managerPortal.chrome.createTask")} icon={Plus} tone="gold">
                <div className="grid gap-2 md:grid-cols-2">
                  <input value={taskDraft.title} onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))} placeholder={tt("managerPortal.tasks.titleField")} className="rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
                  <select value={taskDraft.assigned_employee_id} onChange={(event) => setTaskDraft((current) => ({ ...current, assigned_employee_id: event.target.value }))} className="rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]">
                    <option value="">{tt("managerPortal.tasks.optionalAssignee")}</option>
                    {staffList.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{portalText(employee.employee_name)}</option>)}
                  </select>
                  <select value={taskDraft.priority} onChange={(event) => setTaskDraft((current) => ({ ...current, priority: event.target.value }))} className="rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]">
                    <option value="low">{tt("managerPortal.priority.low")}</option>
                    <option value="medium">{tt("managerPortal.priority.medium")}</option>
                    <option value="high">{tt("managerPortal.priority.high")}</option>
                    <option value="critical">{tt("managerPortal.priority.critical")}</option>
                  </select>
                  <button type="button" data-testid="create-task-button" onClick={createTask} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)] dark:bg-white dark:text-[var(--primary-contrast)]">
                    <Plus className="h-4 w-4" />
                    {tt("managerPortal.actions.create")}
                  </button>
                </div>
                <textarea value={taskDraft.description} onChange={(event) => setTaskDraft((current) => ({ ...current, description: event.target.value }))} placeholder={tt("managerPortal.common.description")} rows={3} className="mt-2 w-full rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]" />
              </Card>

              <Card title={tt("managerPortal.filters.title")} subtitle={tt("managerPortal.filters.title")} icon={Search} tone="slate">
                <div className="grid gap-2 md:grid-cols-4">
                  <input
                    value={taskFilters.query}
                    onChange={(event) => setTaskFilters((current) => ({ ...current, query: event.target.value }))}
                    placeholder={tt("managerPortal.filters.searchPlaceholder")}
                    className="rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]"
                  />
                  <select
                    value={taskFilters.status}
                    onChange={(event) => setTaskFilters((current) => ({ ...current, status: event.target.value }))}
                    className="rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <option value="all">{tt("managerPortal.filters.allStatuses")}</option>
                    <option value="open">{tt("managerPortal.stats.openTasks")}</option>
                    <option value="completed">{tt("managerPortal.tasks.completedList")}</option>
                    <option value="overdue">{tt("managerPortal.stats.overdueTasks")}</option>
                    <option value="pending">{tt("managerPortal.taskStatus.pending")}</option>
                    <option value="in_progress">{tt("managerPortal.taskStatus.inProgress")}</option>
                    <option value="manager_review">{tt("managerPortal.taskStatus.managerReviewFilter")}</option>
                    <option value="reassigned">{tt("managerPortal.taskStatus.reassigned")}</option>
                    <option value="rejected">{tt("managerPortal.taskStatus.rejected")}</option>
                  </select>
                  <select
                    value={taskFilters.employee}
                    onChange={(event) => setTaskFilters((current) => ({ ...current, employee: event.target.value }))}
                    className="rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <option value="">{tt("managerPortal.filters.allEmployees")}</option>
                    {employeeFilterOptions.map((employee) => (
                      <option key={employee.value || employee.label} value={employee.value || employee.label}>{employee.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setTaskFilters({ status: "all", employee: "", query: "" })} className="rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    {tt("managerPortal.filters.clear")}
                  </button>
                </div>
              </Card>

              <div className="grid gap-3 sm:grid-cols-3">
                <Card title={formatNumber(taskCounts.open)} subtitle={tt("managerPortal.stats.openTasks")} icon={ClipboardList} tone="gold" />
                <Card title={formatNumber(taskCounts.completed)} subtitle={tt("managerPortal.tasks.completedList")} icon={CheckCheck} tone="green" />
                <Card title={formatNumber(taskCounts.overdue)} subtitle={tt("managerPortal.stats.overdueTasks")} icon={AlertTriangle} tone="red" />
              </div>

              <Card title={tt("managerPortal.tasks.openListTitle")} subtitle={tt("managerPortal.tasks.runList")} icon={ClipboardList} tone="gold">
                {openTasks.length ? <div className="space-y-3">{openTasks.map((task) => renderTaskCard(task))}</div> : <EmptyState title={tt("managerPortal.tasks.openEmpty")} body={tt("managerPortal.tasks.noMatch")} />}
              </Card>

              <Card title={tt("managerPortal.tasks.completedListTitle")} subtitle={tt("managerPortal.tasks.proofReady")} icon={CheckCheck} tone="green">
                {completedTasks.length ? <div className="space-y-3">{completedTasks.map((task) => renderTaskCard(task))}</div> : <EmptyState title={tt("managerPortal.tasks.completedEmpty")} body={tt("managerPortal.tasks.completedEmptyHint")} />}
              </Card>

              {mobileAlertBuckets.overdueTasks.length ? (
                <Card title={tt("managerPortal.tasks.overdueListTitle")} subtitle={tt("managerPortal.tasks.needsAttention")} icon={AlertTriangle} tone="red">
                  <div className="space-y-3">{mobileAlertBuckets.overdueTasks.map((task) => renderTaskCard(task))}</div>
                </Card>
              ) : null}
            </div>
          ) : null}

          {activeTab === "sales" ? (
            isMobilePortal ? (
              <div className="manager-portal-tab manager-portal-tab--sales space-y-3">
                <div className="manager-portal-mobile-sales-hero rounded-[1.6rem] border border-slate-800 bg-[#08111f] p-4 shadow-[0_18px_32px_rgba(2,6,23,0.16)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{tt("managerPortal.sales.summary")}</div>
                      <div className="mt-1 text-lg font-black text-white">{tt("managerPortal.sales.summary")}</div>
                      <div className="mt-1 text-sm font-semibold leading-6 text-slate-300">{tt("managerPortal.sales.summaryHint")}</div>
                    </div>
                    <div className={`shrink-0 rounded-2xl border px-3 py-2 text-left ${salesGrowthPercent >= 0 ? "border-emerald-400/20 bg-emerald-400/10" : "border-rose-400/20 bg-rose-400/10"}`}>
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{tt("managerPortal.sales.growth")}</div>
                      <div className={`mt-0.5 text-lg font-black ${salesGrowthPercent >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{mobileSalesSummary.growth}</div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2.5 text-right">
                      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{tt("managerPortal.sales.monthSales")}</div>
                      <div className="mt-1 text-[16px] font-black leading-none text-white">{mobileSalesSummary.sales}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2.5 text-right">
                      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{tt("managerPortal.common.invoices")}</div>
                      <div className="mt-1 text-[16px] font-black leading-none text-white">{mobileSalesSummary.invoices}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2.5 text-right">
                      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{tt("managerPortal.sales.growth")}</div>
                      <div className={`mt-1 text-[16px] font-black leading-none ${salesGrowthPercent >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{mobileSalesSummary.growth}</div>
                    </div>
                  </div>
                </div>

                {trend7d.length ? (
                  <>
                    <div className="rounded-[1.4rem] border border-slate-800 bg-[#07111f] p-4 shadow-[0_16px_30px_rgba(2,6,23,0.14)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{tt("managerPortal.sales.currentMonth")}</div>
                          <div className="mt-1 text-lg font-black text-white">{tt("managerPortal.sales.revenue")}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-300">{formatCurrency(trend7d.reduce((sum, item) => sum + Number(item.revenue || 0), 0))}</div>
                        </div>
                        <div className="text-left">
                          <div className="text-[11px] font-bold text-slate-400">{tt("managerPortal.sales.bestDay")}</div>
                          <div className="mt-0.5 text-sm font-black text-white">
                            {formatShortDay(trend7d.reduce((best, item) => (Number(item.revenue || 0) > Number(best?.revenue || 0) ? item : best), trend7d[0] || {}).day)}
                          </div>
                        </div>
                      </div>
                      <MobileSalesChart points={trend7d} valueKey="revenue" formatValue={formatCurrency} label={tt("managerPortal.sales.revenue")} tone="amber" />
                    </div>

                    <div className="rounded-[1.4rem] border border-slate-800 bg-[#07111f] p-4 shadow-[0_16px_30px_rgba(2,6,23,0.14)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{tt("managerPortal.sales.currentMonth")}</div>
                          <div className="mt-1 text-lg font-black text-white">{tt("managerPortal.common.invoices")}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-300">{formatNumber(trend7d.reduce((sum, item) => sum + Number(item.orders || 0), 0))} فاتورة</div>
                        </div>
                        <div className="text-left">
                          <div className="text-[11px] font-bold text-slate-400">{tt("managerPortal.sales.highestCount")}</div>
                          <div className="mt-0.5 text-sm font-black text-white">{formatNumber(Math.max(...trend7d.map((item) => Number(item.orders || 0)), 0))}</div>
                        </div>
                      </div>
                      <MobileSalesChart points={trend7d} valueKey="orders" formatValue={formatNumber} label={tt("managerPortal.common.invoices")} tone="cyan" />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl border border-slate-800 bg-[#0b1220] px-3 py-3 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{tt("managerPortal.sales.totalRevenue")}</div>
                        <div className="mt-1 text-sm font-black text-slate-950">{formatCurrency(trend7d.reduce((sum, item) => sum + Number(item.revenue || 0), 0))}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-[#0b1220] px-3 py-3 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{tt("managerPortal.sales.totalInvoices")}</div>
                        <div className="mt-1 text-sm font-black text-slate-950">{formatNumber(trend7d.reduce((sum, item) => sum + Number(item.orders || 0), 0))}</div>
                      </div>
                      {canViewProfit ? (
                        <DailyProfitCard token={token} salesData={sales} canView={canViewProfit} className="col-span-2" />
                      ) : null}
                      <div className="rounded-2xl border border-slate-800 bg-[#0b1220] px-3 py-3 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{tt("managerPortal.sales.bestDay")}</div>
                        <div className="mt-1 text-sm font-black text-slate-950">
                          {formatShortDay(trend7d.reduce((best, item) => (Number(item.revenue || 0) > Number(best?.revenue || 0) ? item : best), trend7d[0] || {}).day)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-[#0b1220] px-3 py-3 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{tt("managerPortal.sales.topSeller")}</div>
                        <div className="mt-1 truncate text-sm font-black text-slate-950">
                          <InlineName>{portalText(salesLeaders.top_seller?.seller_name || tt("managerPortal.common.unavailable"))}</InlineName>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500 shadow-sm">{tt("managerPortal.sales.noRecentData")}</div>
                )}
              </div>
            ) : (
              <div className="manager-portal-tab manager-portal-tab--sales space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card title={formatCurrency(sales?.overview?.today?.sales || dashboard?.today_sales_total || 0)} subtitle={tt("managerPortal.kpi.salesToday")} icon={ShoppingCart} />
                <Card title={formatNumber(sales?.overview?.today?.orders || dashboard?.invoice_count || 0)} subtitle={tt("managerPortal.common.invoices")} icon={ClipboardList} />
                <DailyProfitCard token={token} salesData={sales} canView={canViewProfit} />
                <Card title={formatCurrency(sales?.overview?.today?.averageOrderValue || 0)} subtitle={tt("managerPortal.sales.averageInvoice")} icon={ArrowLeftRight} />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title={tt("managerPortal.sales.topSeller")} subtitle={tt("managerPortal.sales.last30Days")} icon={Trophy}>
                  {salesLeaders.top_seller ? (
                    <div className="space-y-2 rounded-[var(--radius-card)] border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                        <div className="text-lg font-black"><InlineName>{portalText(salesLeaders.top_seller.seller_name || tt("managerPortal.sales.unknownSeller"))}</InlineName></div>
                      </div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>{tt("managerPortal.labels.revenue")}: {formatCurrency(salesLeaders.top_seller.revenue || 0)}</div>
                        <div>{tt("managerPortal.labels.invoices")}: {formatNumber(salesLeaders.top_seller.orders_count || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title={tt("managerPortal.sales.noSellerData")} body={tt("managerPortal.sales.noSellerDataHint")} />
                  )}
                </Card>
                <Card title={tt("managerPortal.sales.lowestSeller")} subtitle={tt("managerPortal.sales.last30DaysAlt")} icon={Medal}>
                  {salesLeaders.worst_seller ? (
                    <div className="space-y-2 rounded-[var(--radius-card)] border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                        <div className="text-lg font-black"><InlineName>{portalText(salesLeaders.worst_seller.seller_name || tt("managerPortal.sales.unnamedSeller"))}</InlineName></div>
                      </div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>{tt("managerPortal.labels.revenue")}: {formatCurrency(salesLeaders.worst_seller.revenue || 0)}</div>
                        <div>{tt("managerPortal.labels.orders")}: {formatNumber(salesLeaders.worst_seller.orders_count || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title={tt("managerPortal.chrome.noSellerData")} body={tt("managerPortal.chrome.noSellerDataBody")} />
                  )}
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card title={tt("managerPortal.sales.topCategory")} subtitle={tt("managerPortal.sales.last30Days")} icon={Package}>
                  {bestCategory ? (
                    <div className="space-y-2 rounded-[var(--radius-card)] border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                        <div className="text-lg font-black"><InlineName>{portalText(bestCategory.name || "Uncategorized")}</InlineName></div>
                      </div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>{tt("managerPortal.labels.revenue")}: {formatCurrency(bestCategory.revenue || 0)}</div>
                        <div>{tt("managerPortal.labels.quantity")}: {formatNumber(bestCategory.quantity || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title={tt("managerPortal.sales.noCategoryData")} body={tt("managerPortal.sales.noCategoryDataHint")} />
                  )}
                </Card>
                <Card title={tt("managerPortal.sales.topBrand")} subtitle={tt("managerPortal.sales.last30Days")} icon={Store}>
                  {bestBrand ? (
                    <div className="space-y-2 rounded-[var(--radius-card)] border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                        <div className="text-lg font-black"><InlineName>{portalText(bestBrand.name || "Unbranded")}</InlineName></div>
                      </div>
                      <div className="grid gap-2 text-sm font-semibold sm:grid-cols-2">
                        <div>{tt("managerPortal.labels.revenue")}: {formatCurrency(bestBrand.revenue || 0)}</div>
                        <div>{tt("managerPortal.labels.quantity")}: {formatNumber(bestBrand.quantity || 0)}</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title={tt("managerPortal.sales.noBrandData")} body={tt("managerPortal.sales.noBrandDataHint")} />
                  )}
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <Card title={tt("managerPortal.sales.yesterdayVsToday")} subtitle={tt("managerPortal.sales.dailyComparison")} icon={ArrowUpRight}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      {
                        label: tt("managerPortal.sections.sales"),
                        today: formatCurrency(salesComparison.today_sales || sales?.overview?.today?.sales || 0),
                        yesterday: formatCurrency(salesComparison.yesterday_sales || 0),
                        delta: salesComparison.sales_growth || 0,
                      },
                      {
                        label: tt("managerPortal.common.invoices"),
                        today: formatNumber(salesComparison.today_orders || sales?.overview?.today?.orders || 0),
                        yesterday: formatNumber(salesComparison.yesterday_orders || 0),
                        delta: salesComparison.orders_growth || 0,
                      },
                      {
                        label: tt("managerPortal.sales.averageInvoice"),
                        today: formatCurrency(salesComparison.today_average_invoice || sales?.overview?.today?.averageOrderValue || 0),
                        yesterday: formatCurrency(salesComparison.yesterday_average_invoice || 0),
                        delta: salesComparison.average_invoice_growth || 0,
                      },
                    ].map((item) => {
                      const delta = Number(item.delta || 0);
                      const positive = delta >= 0;
                      return (
                        <div key={item.label} className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
                          <div className="mt-2 text-lg font-black text-slate-950">{item.today}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">{tt("managerPortal.labels.yesterday")}: {item.yesterday}</div>
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

                <Card title={tt("managerPortal.sales.averageInvoice")} subtitle={tt("managerPortal.sales.invoiceValue")} icon={ClipboardList}>
                  <div className="space-y-3">
                    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm">
                      <div className="text-xs font-black text-slate-500">{tt("managerPortal.common.today")}</div>
                      <div className="mt-2 text-3xl font-black text-slate-950">{formatCurrency(salesComparison.today_average_invoice || sales?.overview?.today?.averageOrderValue || 0)}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-600">
                        {tt("managerPortal.labels.yesterday")}: {formatCurrency(salesComparison.yesterday_average_invoice || 0)}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">{tt("managerPortal.sections.todayInvoices")}</div>
                        <div className="mt-1 text-lg font-black text-slate-950">{formatNumber(salesComparison.today_orders || sales?.overview?.today?.orders || 0)}</div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">{tt("managerPortal.sales.growth")}</div>
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

              <Card title={tt("managerPortal.sales.currentMonthTrend")} subtitle={tt("managerPortal.sales.revenueAndInvoices")} icon={Clock3}>
                {trend7d.length ? (
                  <div className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">{tt("managerPortal.sales.monthRevenue")}</div>
                        <div className="mt-1 text-xl font-black text-slate-950">{formatCurrency(trend7d.reduce((sum, item) => sum + Number(item.revenue || 0), 0))}</div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">{tt("managerPortal.sales.monthInvoices")}</div>
                        <div className="mt-1 text-xl font-black text-slate-950">{formatNumber(trend7d.reduce((sum, item) => sum + Number(item.orders || 0), 0))}</div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">{tt("managerPortal.sales.bestDay")}</div>
                        <div className="mt-1 text-xl font-black text-slate-950">
                          {formatShortDay(trend7d.reduce((best, item) => (Number(item.revenue || 0) > Number(best?.revenue || 0) ? item : best), trend7d[0] || {}).day)}
                        </div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-xs font-black text-slate-500">{tt("managerPortal.sales.highestRevenue")}</div>
                        <div className="mt-1 text-xl font-black text-slate-950">{formatCurrency(Math.max(...trend7d.map((item) => Number(item.revenue || 0)), 0))}</div>
                      </div>
                    </div>
                    <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-7">
                      {trend7d.map((item) => {
                        const maxRevenue = Math.max(...trend7d.map((row) => Number(row.revenue || 0)), 1);
                        const height = Math.max(12, Math.round((Number(item.revenue || 0) / maxRevenue) * 100));
                        return (
                          <div key={item.day} className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="flex h-28 items-end">
                              <div className="w-full rounded-t-xl bg-gradient-to-t from-slate-950 to-primary" style={{ height: `${height}%` }} />
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
                  <EmptyState title={tt("managerPortal.sales.noTrend")} body={tt("managerPortal.sales.noTrendHint")} />
                )}
              </Card>

              <Card title={tt("managerPortal.conversions.title")} subtitle={tt("managerPortal.conversions.subtitle")} icon={Megaphone}>
                {hasConversionIndicators ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{tt("managerPortal.conversions.customerLinkedOrders")}</div>
                      <div className="mt-2 text-2xl font-black text-slate-950">{formatNumber(conversionIndicators.customer_linked_orders || 0)}</div>
                      <div className="mt-1 text-sm font-bold text-slate-500">{formatPercent(conversionIndicators.customer_link_rate || 0)} of orders</div>
                    </div>
                    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{tt("managerPortal.conversions.onlineOrders")}</div>
                      <div className="mt-2 text-2xl font-black text-slate-950">{formatNumber(conversionIndicators.online_orders || 0)}</div>
                      <div className="mt-1 text-sm font-bold text-slate-500">{formatPercent(conversionIndicators.online_order_share || 0)} of orders</div>
                    </div>
                    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{tt("managerPortal.conversions.aiChatConversions")}</div>
                      <div className="mt-2 text-2xl font-black text-slate-950">{formatNumber(conversionIndicators.ai_confirmed_orders || 0)}</div>
                      <div className="mt-1 text-sm font-bold text-slate-500">
                        {formatNumber(conversionIndicators.ai_sessions || 0)} sessions · {formatPercent(conversionIndicators.ai_conversion_rate || 0)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState title={tt("managerPortal.conversions.empty")} body={tt("managerPortal.conversions.emptyBody")} />
                )}
              </Card>

              <Card title={tt("managerPortal.conversions.topProducts")} subtitle={tt("managerPortal.conversions.topProducts")} icon={Package}>
                {topProducts.length ? topProducts.map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700">
                    <span><InlineName>{portalText(item.name)}</InlineName></span>
                    <span className="font-black text-slate-950">{formatNumber(item.quantity || 0)} · {formatCurrency(item.revenue || 0)}</span>
                  </div>
                )) : <EmptyState title={tt("managerPortal.sales.noSoldProducts")} body={tt("managerPortal.sales.noSoldProductsHint")} />}
              </Card>
              <Card title={tt("managerPortal.conversions.hourlyTrend")} subtitle={tt("managerPortal.conversions.hourlyTrend")} icon={Clock3}>
                {Array.isArray(sales?.hourly) && sales.hourly.length ? (
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
                    {sales.hourly.map((item) => (
                      <div key={item.hour} className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700">
                        <div className="text-xs font-black text-slate-500">{String(item.hour).padStart(2, "0")}:00</div>
                        <div className="mt-1 font-black text-slate-950">{formatCurrency(item.sales || 0)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title={tt("managerPortal.sales.noHourlyData")} body={tt("managerPortal.sales.noHourlyDataHint")} />
                )}
              </Card>
            </div>
          )) : null}

          {activeTab === "chat" ? (
            <SharedPortalChat
              apiAdapter={managerChatApiAdapter}
              employees={staffList}
              selectedEmployeeId={queryEmployeeId}
              onThreadChange={setManagerChatState}
              headerTitle={tt("managerPortal.chat.title")}
              headerKicker={tt("managerPortal.chat.breadcrumb")}
              secureNotice={tt("managerPortal.chat.privacyNote")}
              className="manager-portal-tab manager-portal-tab--chat xl:h-[calc(100dvh-13rem)]"
              managerPanel={() => (
                selectedChatEmployee ? (
                  <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto pr-1" dir="rtl">
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-black tracking-[0.16em] text-slate-500">{tt("managerPortal.chat.employee")}</div>
                      <div className="mt-1 text-lg font-black text-slate-950">{portalText(selectedChatEmployee.employee_name || selectedChatEmployee.full_name || selectedChatThread?.employee_name || tt("managerPortal.common.employee"))}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusPill tone={selectedChatAttendanceTone} value={selectedChatAttendanceStatus} />
                        <Badge className="border-slate-200 bg-white text-slate-700">{portalText(selectedChatEmployee.branch_name || selectedChatThread?.branch_name || tt("managerPortal.common.noBranch"))}</Badge>
                        <Badge className="border-slate-200 bg-white text-slate-700">{portalText(selectedChatEmployee.employee_code || tt("managerPortal.common.noCode"))}</Badge>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="text-[11px] font-black text-slate-400">{tt("managerPortal.common.lastActivity")}</div>
                        <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{formatDateTime(selectedChatLastActivity)}</div>
                      </div>
                      <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="text-[11px] font-black text-slate-400">{tt("managerPortal.stats.openTasks")}</div>
                        <div className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{formatNumber(selectedChatOpenTasks)}</div>
                      </div>
                    </div>

                    <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black text-slate-400">{tt("managerPortal.chat.attendanceSummary")}</div>
                      <div className="mt-3 grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>{tt("managerPortal.common.status")}</span>
                          <span className="font-black text-slate-950 dark:text-white">{portalText(selectedChatAttendanceStatus)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>{tt("managerPortal.sections.attendance")}</span>
                          <span dir="ltr" className="font-black text-slate-950 dark:text-white">{formatDateTime(selectedChatCheckIn)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>{tt("managerPortal.attendance.checkOut")}</span>
                          <span dir="ltr" className="font-black text-slate-950 dark:text-white">{formatDateTime(selectedChatCheckOut)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>{tt("managerPortal.attendance.shiftHours")}</span>
                          <span className="font-black text-slate-950 dark:text-white">{selectedChatShiftHours.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>{tt("managerPortal.attendance.lateMinutes")}</span>
                          <span className="font-black text-slate-950 dark:text-white">{formatNumber(selectedChatLateMinutes)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-xs font-black text-slate-400">{tt("managerPortal.sales.summary")}</div>
                      <div className="mt-3 grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>{tt("managerPortal.kpi.salesToday")}</span>
                          <span className="font-black text-slate-950 dark:text-white">{formatCurrency(selectedChatSalesTotal)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <span>{tt("managerPortal.common.invoices")}</span>
                          <span className="font-black text-slate-950 dark:text-white">{formatNumber(selectedChatInvoices)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.3rem] border border-slate-200 bg-white p-3 text-sm font-semibold leading-6 text-slate-800 shadow-sm">
                      <div className="text-xs font-black text-slate-600">{tt("managerPortal.chat.quickSummary")}</div>
                      <div className="mt-2 text-slate-700">{tt("managerPortal.labels.lastActivity")}: {formatDateTime(selectedChatLastActivity)}</div>
                      <div className="text-slate-700">{tt("managerPortal.labels.unreadConversation")}: {formatNumber(selectedChatUnread)}</div>
                    </div>
                  </div>
                ) : (
                  <EmptyState title={tt("managerPortal.chat.noProfile")} body={tt("managerPortal.chat.noProfileHint")} />
                )
              )}
              useTextareaComposer
              mobileFullScreen
            />
          ) : null}

          {activeTab === "more" ? (
            <div className="manager-portal-tab manager-portal-tab--more space-y-4">
              <Card title={tt("managerPortal.settings.title")} subtitle={tt("managerPortal.nav.more")} icon={Settings} compact={isMobilePortal} className={isMobilePortal ? "manager-portal-mobile-panel" : ""} tone="gold">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <button type="button" onClick={() => setActiveTab("notifications")} className="relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white p-3 text-slate-900 shadow-sm transition hover:border-amber-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/15 text-amber-500"><Bell className="h-6 w-6" /></span>
                    <span className="text-sm font-black">{tt("managerPortal.settings.alerts")}</span>
                    {unreadCount > 0 ? <span className="absolute left-3 top-3 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black text-white">{formatNumber(unreadCount)}</span> : null}
                  </button>
                  <button type="button" onClick={() => setTheme(theme.mode === "dark" ? "light" : "dark")} className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white p-3 text-slate-900 shadow-sm transition hover:border-amber-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-500/15 text-slate-500">{theme.mode === "dark" ? <SunMedium className="h-6 w-6" /> : <Moon className="h-6 w-6" />}</span>
                    <span className="text-sm font-black">{tt("managerPortal.settings.appearance")}</span>
                  </button>
                  <button type="button" onClick={() => void loadAll({ silent: true })} className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white p-3 text-slate-900 shadow-sm transition hover:border-amber-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-500"><RefreshCw className={`h-6 w-6 ${refreshing ? "animate-spin" : ""}`} /></span>
                    <span className="text-sm font-black">{tt("managerPortal.settings.refreshData")}</span>
                  </button>
                </div>
              </Card>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title={tt("managerPortal.settings.profile")} subtitle={tt("managerPortal.settings.managerProfile")} icon={Building2} compact={isMobilePortal} className={isMobilePortal ? "manager-portal-mobile-panel" : ""} tone="green">
                  <div className="space-y-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    <div className="font-black text-slate-950 dark:text-white">{portalText(me?.full_name || me?.name || tt("managerPortal.shell.manager"))}</div>
                    <div>{portalText(me?.role || "manager")} · {portalText(me?.department || "—")}</div>
                    <div>{portalText(me?.user_email || tt("managerPortal.common.noEmail"))}</div>
                    <div>{formatNumber(me?.permissions?.length || 0)} صلاحية</div>
                  </div>
                </Card>
              <Card title={tt("managerPortal.settings.branchData")} subtitle={tt("managerPortal.settings.branchInfo")} icon={Store} compact={isMobilePortal} className={isMobilePortal ? "manager-portal-mobile-panel" : ""} tone="amber">
                <div className="space-y-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    <div className="font-black text-slate-950 dark:text-white">{portalText(me?.branch_name || "All branches")}</div>
                    <div>{tt("managerPortal.labels.scope")}: {portalText(me?.branch_scope || "all")}</div>
                    <div>{tt("managerPortal.labels.liveAlerts")}: {formatNumber(notifications.length || 0)}</div>
                    <div>{tt("managerPortal.labels.unread")}: {formatNumber(unreadCount || notificationsUnread)}</div>
                  </div>
                </Card>
              </div>
            </div>
          ) : null}

          {activeTab === "notifications" ? (
            <div className="space-y-4">
              <button type="button" onClick={() => setActiveTab("more")} className="inline-flex min-h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                <Settings className="h-4 w-4" />
                {tt("managerPortal.settings.back")}
              </button>
              <Card title={tt("managerPortal.alerts.settings")} subtitle={tt("managerPortal.settings.notifications")} icon={Bell}>
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(settings).map(([category, config]) => (
                    <div key={category} className="space-y-2 rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-black text-slate-900">{portalText(category)}</div>
                        <StatusPill tone="slate" value={portalText(category)} />
                      </div>
                      <Toggle label={tt("managerPortal.settings.sound")} checked={Boolean(config.sound)} onChange={(value) => onCategoryToggle(category, "sound", value)} />
                      <Toggle label={tt("managerPortal.settings.popupNotification")} checked={Boolean(config.toast)} onChange={(value) => onCategoryToggle(category, "toast", value)} />
                      <Toggle label={tt("managerPortal.settings.instantNotifications")} checked={Boolean(config.push)} onChange={(value) => onCategoryToggle(category, "push", value)} />
                    </div>
                  ))}
                </div>
              </Card>

              <Card title={tt("managerPortal.settings.soundAndNotifications")} subtitle={tt("managerPortal.settings.browserControlled")} icon={Volume2}>
                <div className="grid gap-2 md:grid-cols-2">
                  <button type="button" data-testid="sound-unlock-button" data-state={soundUnlocked ? "enabled" : "disabled"} onClick={enableSound} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)] dark:bg-white dark:text-[var(--primary-contrast)]">
                    {soundUnlocked ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                    {soundUnlocked ? tt("managerPortal.settings.soundOn") : tt("managerPortal.settings.enableSound")}
                  </button>
                  <button type="button" data-testid="browser-notification-button" data-state={browserNotificationPermission} onClick={enableBrowserNotifications} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    <Bell className="h-4 w-4" />
                    {browserNotificationPermission === "granted" ? tt("managerPortal.settings.browserNotificationsOn") : tt("managerPortal.settings.enableBrowserNotifications")}
                  </button>
                </div>
              </Card>

              <Card title={tt("managerPortal.push.title")} subtitle={tt("managerPortal.push.subtitle")} icon={Smartphone}>
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Badge className={`${pushState.supported ? "border-emerald-200 text-emerald-700" : "border-rose-200 text-rose-700"} dark:border-white/10 dark:bg-white/[0.03] dark:text-white`}>
                      {pushState.supported ? tt("managerPortal.push.supported") : tt("managerPortal.push.notSupported")}
                    </Badge>
                    <Badge className="border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                      الإذن: {portalText(pushState.permission)}
                    </Badge>
                    <Badge className={`${pushState.subscribed ? "border-emerald-200 text-emerald-700" : "border-slate-200 text-slate-700"} dark:border-white/10 dark:bg-white/[0.03] dark:text-white`}>
                      الاشتراك: {pushState.subscribed ? tt("managerPortal.common.active") : tt("managerPortal.common.inactive")}
                    </Badge>
                    <Badge className={`${standalone ? "border-primary text-primary" : "border-amber-200 text-amber-800"} dark:border-white/10 dark:bg-white/[0.03] dark:text-white`}>
                      {standalone ? tt("managerPortal.push.installedAsApp") : tt("managerPortal.push.browserTab")}
                    </Badge>
                  </div>
                  {pushState.endpointHost ? (
                    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 shadow-sm" dir="ltr">{pushState.endpointHost}</div>
                  ) : null}
                  {isIosDevice() && !standalone ? (
                    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-3 text-sm font-bold leading-6 text-slate-700 shadow-sm">
                      {tt("managerPortal.push.iosHint")}
                    </div>
                  ) : null}
                  {pushState.message ? <div className="text-xs font-bold text-slate-500 dark:text-slate-300">{pushState.message}</div> : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" disabled={pushState.saving || !pushState.supported || pushState.permission === "denied"} onClick={enablePushNotifications} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-45 dark:bg-white dark:text-[var(--primary-contrast)]">
                      {pushState.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                      {pushState.subscribed ? tt("managerPortal.push.update") : tt("managerPortal.push.enable")}
                    </button>
                    <button type="button" disabled={pushState.saving || !pushState.subscribed} onClick={disablePushNotifications} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                      <X className="h-4 w-4" />
                      {tt("managerPortal.push.disable")}
                    </button>
                  </div>
                  <button type="button" disabled={pushState.saving || !pushState.supported || pushState.permission === "denied"} onClick={sendTestPushNotification} className="inline-flex min-h-[var(--control-height-lg)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                    <Send className="h-4 w-4" />
                    {tt("managerPortal.push.sendTest")}
                  </button>
                </div>
              </Card>

              <Card title={tt("managerPortal.chat.quickSummary")} subtitle={tt("managerPortal.chat.quickSummary")} icon={Megaphone}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white shadow-sm">
                    <div className="text-xs font-black text-slate-300">{tt("managerPortal.notifications.unreadCount")}</div>
                    <div className="mt-1 text-3xl font-black text-white">{formatNumber(unreadCount || notificationsUnread)}</div>
                  </div>
                  <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 text-slate-900 shadow-sm">
                    <div className="text-xs font-black text-slate-500">{tt("managerPortal.settings.permissions")}</div>
                    <div className="mt-1 text-sm font-semibold leading-6 text-slate-700">{(me?.permissions || []).length ? `${formatNumber(me.permissions.length)} صلاحية` : tt("managerPortal.settings.noPermissions")}</div>
                  </div>
                </div>
              </Card>
            </div>
          ) : null}
        </section>

        <aside className="hidden space-y-3 lg:block">
          {visibleAiInsights.length ? (
            <Card title={tt("managerPortal.alerts.smart")} subtitle={tt("managerPortal.alerts.smart")} icon={Bot} compact bodyClassName="space-y-2">
              <div className="space-y-1.5">
                {visibleAiInsights.map((insight, index) => {
                  const importance = insightActionabilityScore(insight);
                  return (
                    <div key={`${insight.title || index}`} className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-2.5 text-sm font-semibold leading-5 text-slate-800 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-600">{insightTitleLabel(insight.type, insight.title)}</div>
                          <div className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-slate-900">{renderInsightBody(insight)}</div>
                        </div>
                        <StatusPill
                          tone={importance >= 8 ? "red" : importance >= 6 ? "amber" : "blue"}
                          value={importance >= 8 ? tt("managerPortal.alerts.priority") : importance >= 6 ? tt("managerPortal.alerts.important") : tt("managerPortal.alerts.notice")}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                        <span className="truncate">{portalText(insight.message || insight.body || insight.title || tt("managerPortal.alerts.actionable"))}</span>
                        <span dir="ltr" className="shrink-0">{formatCompactDateTime(insight.created_at || insight.updated_at || insight.timestamp)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {hasMoreAiInsights ? (
                <button type="button" onClick={() => setShowMoreAiInsights((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                  {showMoreAiInsights ? tt("managerPortal.actions.showLess") : tt("managerPortal.actions.showMore")}
                </button>
              ) : null}
            </Card>
          ) : null}

          {visibleLeads.length ? (
            <Card title={tt("managerPortal.sections.hotLeads")} subtitle={tt("managerPortal.sections.hotLeads")} icon={Store} compact bodyClassName="space-y-2">
              <div className="space-y-1.5">
                {visibleLeads.map((lead) => {
                  const product = leadPrimaryProduct(lead);
                  const lastInteraction = leadLastInteractionAt(lead);
                  return (
                    <div key={leadIdentity(lead)} className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-2.5 text-sm font-semibold leading-5 text-slate-800 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-black text-slate-950">{leadName(lead)}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-black text-slate-700">
                            <span className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">{leadChannel(lead)}</span>
                            {product ? (
                              <span className="inline-flex max-w-full items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                                <InlineName className="truncate">{product}</InlineName>
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-left">
                          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{tt("managerPortal.leads.score")}</div>
                          <div className="mt-0.5 text-lg font-black leading-none text-slate-950">{formatNumber(lead.lead_score || 0)}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                        <span className="truncate">{tt("managerPortal.leads.lastInteraction")}</span>
                        <span dir="ltr" className="shrink-0">{formatCompactDateTime(lastInteraction)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {hasMoreLeads ? (
                <button type="button" onClick={() => setShowMoreLeads((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                  {showMoreLeads ? tt("managerPortal.actions.showLess") : tt("managerPortal.actions.showMore")}
                </button>
              ) : null}
            </Card>
          ) : null}

          {visibleLowStock.length ? (
            <Card title={tt("managerPortal.sections.lowStock")} subtitle={tt("managerPortal.sections.lowStock")} icon={Package} compact bodyClassName="space-y-2">
              <div className="space-y-1.5">
                {visibleLowStock.map((item) => (
                  <div key={`${item.id}-${item.name}`} className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm">
                    <div className="line-clamp-2 font-black leading-5 text-slate-950"><InlineName className="line-clamp-2 align-bottom">{portalText(item.name || "-")}</InlineName></div>
                    <div className="mt-1 text-xs font-bold text-slate-500">{portalText(item.color || item.size || "")} · {formatNumber(item.stock || 0)}</div>
                  </div>
                ))}
              </div>
              {hasMoreLowStock ? (
                <button type="button" onClick={() => setShowMoreLowStock((current) => !current)} className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800">
                  {showMoreLowStock ? tt("managerPortal.actions.showLess") : tt("managerPortal.actions.showMore")}
                </button>
              ) : null}
            </Card>
          ) : null}
        </aside>
      </div>

      <nav className="manager-bottom-nav-safe-padding manager-bottom-nav-shell fixed inset-x-3 z-40 mx-auto max-w-2xl rounded-[1.4rem] border border-slate-800 bg-[linear-gradient(180deg,#020617,#0f172a)] shadow-2xl shadow-slate-900/30 lg:hidden">
        <div className="grid grid-cols-7 gap-0.5 px-1.5 py-1.5">
          {TABS.map((tab) => {
            const active = activeTab === tab;
            const label = tab === "today" ? tt("managerPortal.common.today") : tab === "staff" ? tt("managerPortal.nav.team") : tab === "tasks" ? tt("managerPortal.nav.tasks") : tab === "sales" ? tt("managerPortal.sections.sales") : tab === "chat" ? tt("managerPortal.nav.chat") : tab === "inventory" ? tt("managerPortal.nav.stockCount") : tt("managerPortal.nav.more");
            const icon = tab === "today" ? Store : tab === "staff" ? Users : tab === "tasks" ? ClipboardList : tab === "sales" ? ShoppingCart : tab === "chat" ? MessageSquare : tab === "inventory" ? ClipboardCheck : Settings;
            const Icon = icon;
            return (
              <button key={tab} type="button" data-testid={`tab-${tab}`} onClick={() => tab === "inventory" ? openInventoryApprovals() : setActiveTab(tab)} className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] px-1 py-1.5 text-[9px] font-black leading-[1.2] transition ${active ? "bg-[linear-gradient(180deg,#ffffff,#e2e8f0)] text-slate-950 shadow-sm" : "text-slate-300"}`}>
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap">
                  {label}
                  {tab === "more" && unreadCount > 0 ? <span className="rounded-full bg-rose-500 px-1 py-0.5 text-[9px] font-black leading-[1.2] text-white">{formatNumber(unreadCount)}</span> : null}
                </span>
                {tab === "inventory" && pendingInventoryApprovalsCount > 0 ? <span className="absolute -top-1 right-0 min-w-4 rounded-full bg-rose-500 px-1 text-[8px] font-black leading-4 text-white">{formatNumber(pendingInventoryApprovalsCount)}</span> : null}
              </button>
            );
          })}
        </div>
      </nav>

      {invoiceSheet.open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 sm:items-center">
          <button type="button" aria-label={tt("managerPortal.invoice.close")} onClick={() => setInvoiceSheet({ open: false, loading: false, invoice: null, error: "" })} className="absolute inset-0" />
          <section className="relative max-h-[92dvh] w-full max-w-3xl overflow-hidden rounded-t-[2rem] border border-slate-200 bg-white shadow-2xl sm:rounded-[2rem]" dir="rtl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-950 px-4 py-4 text-white">
              <div>
                <div className="text-xs font-black text-slate-300">{tt("managerPortal.invoice.title")}</div>
                <h2 className="m1-section-title mt-1 text-white">{invoiceSheet.invoice?.invoice_number || tt("managerPortal.invoice.label")}</h2>
              </div>
              <button type="button" onClick={() => setInvoiceSheet({ open: false, loading: false, invoice: null, error: "" })} className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-[var(--radius-control)] border border-slate-700 bg-primary text-[var(--primary-contrast)]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(92dvh-5rem)] overflow-y-auto px-4 py-4">
              {invoiceSheet.loading ? (
                <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>
              ) : invoiceSheet.error ? (
                <EmptyState title={tt("managerPortal.errors.loadInvoice")} body={invoiceSheet.error} />
              ) : invoiceSheet.invoice ? (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      [tt("managerPortal.invoice.number"), invoiceSheet.invoice.invoice_number],
                      [tt("managerPortal.invoice.orderNumber"), invoiceSheet.invoice.public_order_number || invoiceSheet.invoice.order_id || invoiceSheet.invoice.id || "-"],
                      [tt("managerPortal.common.status"), invoiceSheet.invoice.status || "-"],
                      [tt("managerPortal.common.date"), formatDateTime(invoiceSheet.invoice.created_at)],
                      [tt("managerPortal.common.customer"), invoiceSheet.invoice.customer_name || tt("managerPortal.invoices.walkInCustomer")],
                      [tt("managerPortal.common.phone"), invoiceSheet.invoice.customer_phone || "-"],
                      [tt("managerPortal.common.address"), invoiceSheet.invoice.customer_address || "-"],
                      [tt("managerPortal.invoice.customerType"), invoiceSheet.invoice.customer_type || "-"],
                      [tt("managerPortal.common.seller"), invoiceSheet.invoice.seller_name || "-"],
                      [tt("managerPortal.common.cashier"), invoiceSheet.invoice.cashier_name || invoiceSheet.invoice.seller_name || "-"],
                      [tt("managerPortal.common.branch"), invoiceSheet.invoice.branch_name || "-"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm">
                        <div className="text-xs font-black text-slate-500">{label}</div>
                        <div className="mt-1 font-black text-slate-950">{value}</div>
                      </div>
                    ))}
                  </div>

                  <Card title={tt("managerPortal.invoice.payment")} subtitle={tt("managerPortal.invoice.paymentMethodSplit")} icon={ArrowLeftRight} compact>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 shadow-sm">
                        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />{paymentMethodLabel(invoiceSheet.invoice.payment_method)}</span>
                        <span className="text-slate-950">{portalText(invoiceSheet.invoice.payment_status || "")}</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {[
                          [tt("managerPortal.invoice.paid"), formatCurrency(invoiceSheet.invoice.paid_amount || 0)],
                          [tt("managerPortal.invoice.remaining"), formatCurrency(invoiceSheet.invoice.remaining_amount || 0)],
                          ["COD", invoiceSheet.invoice.cod_amount ? formatCurrency(invoiceSheet.invoice.cod_amount) : "-"],
                          [tt("managerPortal.invoice.paymentProof"), invoiceSheet.invoice.transfer_proof_status || "-"],
                          [tt("managerPortal.invoice.treasuryAccount"), invoiceSheet.invoice.treasury_name || "-"],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2 text-xs font-bold shadow-sm">
                            <div className="text-slate-500">{label}</div>
                            <div className="mt-1 text-slate-950">{value}</div>
                          </div>
                        ))}
                      </div>
                      {Array.isArray(invoiceSheet.invoice.payment_breakdown) && invoiceSheet.invoice.payment_breakdown.length ? invoiceSheet.invoice.payment_breakdown.map((row, index) => (
                        <div key={`${row.method || row.payment_method || index}`} className="flex items-center justify-between rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2 text-sm font-bold shadow-sm">
                          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-slate-900" />{paymentMethodLabel(row.method || row.payment_method)}</span>
                          <span className="text-slate-950">{formatCurrency(row.amount || row.total || 0)}</span>
                        </div>
                      )) : null}
                    </div>
                  </Card>

                  <Card title={tt("managerPortal.common.products")} subtitle={tt("managerPortal.invoice.productList")} icon={Package} compact>
                    <div className="space-y-2">
                      {(invoiceSheet.invoice.items || []).length ? invoiceSheet.invoice.items.map((item) => (
                        <div key={item.id || `${item.product_name}-${item.variant_id}`} className="rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            {item.image_url ? (
                              <img src={resolveProductImageUrl(item.image_url)} alt="" className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 object-cover" loading="lazy" />
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <div className="line-clamp-2 font-black leading-5 text-slate-950"><InlineName className="line-clamp-2 align-bottom">{portalText(item.product_name || tt("managerPortal.common.product"))}</InlineName></div>
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
                      )) : <EmptyState compact title={tt("managerPortal.invoice.noProducts")} body={tt("managerPortal.invoice.noProductsHint")} />}
                    </div>
                  </Card>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      [tt("managerPortal.invoice.subtotal"), formatCurrency(invoiceSheet.invoice.subtotal || 0)],
                      [tt("managerPortal.invoice.discount"), formatCurrency(invoiceSheet.invoice.discount || 0)],
                      [tt("managerPortal.invoice.shipping"), formatCurrency(invoiceSheet.invoice.shipping || 0)],
                      [tt("managerPortal.invoice.tax"), formatCurrency(invoiceSheet.invoice.tax || 0)],
                      [tt("managerPortal.common.total"), formatCurrency(invoiceSheet.invoice.total || 0)],
                      [tt("managerPortal.invoice.paid"), formatCurrency(invoiceSheet.invoice.paid_amount || 0)],
                      [tt("managerPortal.invoice.remaining"), formatCurrency(invoiceSheet.invoice.remaining_amount || 0)],
                      ...(invoiceSheet.invoice.permissions?.can_view_profit ? [
                        [tt("managerPortal.invoice.cost"), formatCurrency(invoiceSheet.invoice.cost || 0)],
                        [tt("managerPortal.invoice.profit"), formatCurrency(invoiceSheet.invoice.profit || 0)],
                      ] : []),
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold shadow-sm">
                        <span className="text-slate-500">{label}</span>
                        <span className="text-slate-950">{value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-5">
                    <button type="button" disabled={!invoiceSheet.invoice.public_invoice_url} onClick={() => window.open(invoiceSheet.invoice.public_invoice_url, "_blank", "noopener,noreferrer")} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[linear-gradient(180deg,#0f172a,#111827)] px-3 text-sm font-black text-white shadow-sm disabled:opacity-45 dark:bg-white dark:text-slate-950">
                      <ExternalLink className="h-4 w-4" />
                      {tt("managerPortal.invoice.viewPublic")}
                    </button>
                    <button type="button" disabled={!invoiceSheet.invoice.public_invoice_url} onClick={() => copyText(invoiceSheet.invoice.public_invoice_url, tt("managerPortal.invoice.linkCopied"))} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] px-3 text-sm font-black text-slate-800 shadow-sm disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                      <Copy className="h-4 w-4" />
                      {tt("managerPortal.invoice.copyLink")}
                    </button>
                    <button type="button" onClick={() => window.print()} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] px-3 text-sm font-black text-slate-800 shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-white">
                      <Printer className="h-4 w-4" />
                      {tt("managerPortal.actions.print")}
                    </button>
                    <button type="button" disabled={!invoiceSheet.invoice.customer_phone} onClick={() => openWhatsappShare(invoiceSheet.invoice)} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-emerald-200 bg-emerald-50 px-3 text-sm font-black text-emerald-800 shadow-sm disabled:opacity-45 dark:bg-emerald-400/10 dark:text-emerald-100">
                      <MessageSquare className="h-4 w-4" />
                      {tt("managerPortal.invoice.shareWhatsapp")}
                    </button>
                    <button type="button" onClick={() => setInvoiceSheet({ open: false, loading: false, invoice: null, error: "" })} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] px-3 text-sm font-black text-slate-800 shadow-sm">
                      <X className="h-4 w-4" />
                      {tt("managerPortal.actions.close")}
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
