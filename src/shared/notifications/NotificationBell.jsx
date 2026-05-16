import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CreditCard,
  Package,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";

import { useNotifications } from "./useNotifications";
import { hasPermission } from "../../modules/permissions/lib/rbacStore";
import { isAdminUser } from "../auth/authStorage";

const categories = ["all", "orders", "payments", "inventory", "purchases", "security", "system"];

const tabs = [
  { key: "all", label: "الكل" },
  { key: "unread", label: "غير مقروء" },
  { key: "important", label: "مهم" },
];

const categoryLabels = {
  all: "كل الفئات",
  orders: "الطلبات",
  payments: "المدفوعات",
  inventory: "المخزون",
  purchases: "المشتريات",
  security: "الأمان",
  system: "النظام",
};

const priorityLabels = {
  low: "منخفض",
  medium: "متوسط",
  high: "مرتفع",
  critical: "حرج",
};

const categoryIcon = {
  orders: ShoppingCart,
  payments: CreditCard,
  inventory: Package,
  purchases: ReceiptText,
  security: ShieldAlert,
  system: Bell,
};

const priorityClass = {
  low: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  medium: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  high: "border-amber-400/25 bg-amber-400/10 text-amber-100",
  critical: "border-red-400/30 bg-red-500/15 text-red-100",
};

const resolveImageUrl = (value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith("/")) return imageUrl;
  return `/uploads/products/${imageUrl}`;
};

export const relativeTime = (value) => {
  const time = new Date(value || Date.now()).getTime();
  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
};

export function NotificationCard({ notification, onAction, compact = false }) {
  const { markRead, remove } = useNotifications();
  const canManage = isAdminUser() || hasPermission("notifications.manage");
  const safeNotification = notification || {};
  const Icon = categoryIcon[safeNotification.category] || AlertTriangle;
  const isUnread = !safeNotification.is_read;
  const isLowStock = safeNotification.type === "low_stock";
  const imageUrl = resolveImageUrl(safeNotification.metadata?.image_url || safeNotification.metadata?.image);
  const priorityLabel = isLowStock ? "عاجل" : (priorityLabels[safeNotification.priority] || safeNotification.priority || "متوسط");

  return (
    <article
      className={[
        "relative overflow-hidden rounded-2xl border p-3.5 text-right shadow-[0_14px_38px_rgba(0,0,0,0.24)] transition",
        isUnread
          ? "border-emerald-300/25 bg-[linear-gradient(135deg,rgba(6,78,59,0.34),rgba(15,23,42,0.98))]"
          : "border-slate-700/70 bg-slate-900/86",
      ].join(" ")}
      dir="rtl"
    >
      {isUnread ? <span className="absolute right-0 top-5 h-10 w-1 rounded-l-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.8)]" /> : null}
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white text-emerald-700 shadow-inner">
          {imageUrl ? (
            <img src={imageUrl} alt={safeNotification.title || "Notification"} className="h-full w-full object-contain p-1.5" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black text-slate-50">{safeNotification.title || "إشعار"}</h3>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-300">{safeNotification.message || "لا توجد تفاصيل لهذا الإشعار."}</p>
            </div>
            {isUnread ? (
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.9)]" aria-label="غير مقروء" />
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
            <span>{relativeTime(safeNotification.created_at)}</span>
            <span className="h-1 w-1 rounded-full bg-slate-600" />
            <span>{categoryLabels[safeNotification.category] || safeNotification.category || "النظام"}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${priorityClass[safeNotification.priority] || priorityClass.medium}`}>
              {priorityLabel}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {safeNotification.action_url ? (
              <button
                type="button"
                onClick={() => onAction?.(safeNotification)}
                className="rounded-xl bg-emerald-400 px-3 py-1.5 text-xs font-black text-slate-950 transition hover:bg-emerald-300"
              >
                {safeNotification.action_label || "فتح"}
              </button>
            ) : null}
            {isUnread ? (
              <button
                type="button"
                onClick={() => markRead(safeNotification.id)}
                className="rounded-xl border border-slate-600/80 bg-slate-950/40 px-3 py-1.5 text-xs font-bold text-slate-100 transition hover:border-emerald-300/50 hover:text-emerald-100"
              >
                تمت القراءة
              </button>
            ) : null}
            {!compact && canManage ? (
              <button
                type="button"
                onClick={() => remove(safeNotification.id)}
                className="rounded-xl border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-red-200 transition hover:bg-red-500/20"
                aria-label="حذف الإشعار"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, markAllRead, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("all");
  const [category, setCategory] = useState("all");
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const handlePointerDown = (event) => {
      const target = event.target;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  const filtered = useMemo(() => notifications.filter((item) => {
    if (tab === "unread" && item.is_read) return false;
    if (tab === "important" && !["high", "critical"].includes(item.priority)) return false;
    if (category !== "all" && item.category !== category) return false;
    return true;
  }), [category, notifications, tab]);

  const handleAction = (notification) => {
    setOpen(false);
    navigate(notification.action_url);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          refresh();
        }}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] shadow-sm"
        aria-label="الإشعارات"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div>
          <button
            type="button"
            className="hidden"
            onClick={() => setOpen(false)}
            aria-label="إغلاق الإشعارات"
          />
          <aside ref={panelRef} className="fixed right-6 top-[calc(var(--topbar-height,72px)+12px)] z-[9999] flex w-[420px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-[#07111f] shadow-[0_24px_90px_rgba(0,0,0,0.55)] max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:pt-[env(safe-area-inset-top)]" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="notifications-drawer-title">
            <div className="shrink-0 border-b border-slate-700/70 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(7,17,31,0.98))] p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <h2 id="notifications-drawer-title" className="text-xl font-black text-slate-50">الإشعارات</h2>
                    {unreadCount > 0 ? (
                      <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-black text-emerald-100">
                        {unreadCount > 99 ? "99+" : unreadCount} غير مقروء
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">مركز متابعة أحداث النظام في الوقت الحقيقي</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-600/80 bg-slate-950/70 text-slate-100 transition hover:border-emerald-300/50 hover:text-emerald-100"
                  aria-label="إغلاق"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
                {tabs.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    className={`shrink-0 rounded-full border px-4 py-2 text-xs font-black transition ${tab === item.key ? "border-emerald-300/60 bg-emerald-400 text-slate-950" : "border-slate-700 bg-slate-950/55 text-slate-300 hover:border-slate-500"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {categories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCategory(item)}
                    className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold transition ${category === item ? "border-cyan-300/45 bg-cyan-400/12 text-cyan-100" : "border-slate-700 bg-slate-900/65 text-slate-400 hover:border-slate-500 hover:text-slate-200"}`}
                  >
                    {categoryLabels[item] || item}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-700/70 bg-slate-950/30 px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={markAllRead}
                disabled={!unreadCount}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-600/80 bg-slate-900/80 px-3 py-2 text-xs font-black text-slate-100 transition hover:border-emerald-300/50 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <CheckCheck className="h-4 w-4" />
                تعليم الكل كمقروء
              </button>
              <button
                type="button"
                onClick={() => refresh()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                تحديث
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#07111f] p-3 sm:p-4">
              {loading ? (
                Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-700/50 bg-slate-900/80" />)
              ) : filtered.length ? (
                filtered.map((item) => <NotificationCard key={item.id} notification={item} onAction={handleAction} compact />)
              ) : (
                <div className="flex min-h-[17rem] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-700 bg-slate-900/70 p-8 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/80 text-slate-300">
                    <CheckCheck className="h-7 w-7" />
                  </div>
                  <h3 className="mt-4 text-lg font-black text-slate-50">لا توجد إشعارات</h3>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-slate-400">لا توجد عناصر مطابقة للفلاتر الحالية. يمكنك التحديث أو تغيير الفئة.</p>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-700/70 bg-slate-950/40 p-3 sm:p-4">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate("/notifications");
                }}
                className="w-full rounded-xl border border-slate-600/80 bg-slate-900/80 px-4 py-2.5 text-sm font-black text-slate-100 transition hover:border-emerald-300/50 hover:text-emerald-100"
              >
                فتح مركز الإشعارات الكامل
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
