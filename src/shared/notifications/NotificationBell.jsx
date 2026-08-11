import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  ClipboardList,
  CreditCard,
  ExternalLink,
  Inbox,
  Package,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";

import { useNotifications } from "./useNotifications.js";
import useDismissableLayer from "../hooks/useDismissableLayer";
import AnimatedBadgeCounter from "../../components/feedback/AnimatedBadgeCounter";
import RealtimeGlowWrapper from "../../components/feedback/RealtimeGlowWrapper";

const groupOrder = ["اليوم", "الأمس", "الأقدم"];

const moduleLabels = {
  staff_tasks: "مهام الفريق",
  orders: "الطلبات",
  payments: "المدفوعات",
  inventory: "المخزون",
  purchases: "المشتريات",
  employees: "الموظفون",
  security: "الأمان",
  system: "النظام",
};

const typeIcon = {
  task_assigned: ClipboardList,
  task_reassigned: ClipboardList,
  task_completed: CheckCheck,
  staff_task_task_updated: ClipboardList,
  staff_tasks_available: ClipboardList,
  low_stock: Package,
  website_order_created: ShoppingCart,
  payment_proof_uploaded: CreditCard,
  purchase_confirmed: ReceiptText,
  employee_portal_request: Inbox,
  security_sensitive_action: ShieldAlert,
};

const categoryIcon = {
  staff_tasks: ClipboardList,
  orders: ShoppingCart,
  payments: CreditCard,
  inventory: Package,
  purchases: ReceiptText,
  employees: Inbox,
  security: ShieldAlert,
  system: Bell,
};

const priorityClass = {
  low: "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
  medium: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200",
  high: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
  critical: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-200",
};

const iconClass = {
  staff_tasks: "bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-400/10 dark:text-violet-200 dark:ring-violet-300/15",
  orders: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-300/15",
  payments: "bg-cyan-50 text-cyan-700 ring-cyan-100 dark:bg-cyan-400/10 dark:text-cyan-200 dark:ring-cyan-300/15",
  inventory: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-300/15",
  purchases: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-400/10 dark:text-blue-200 dark:ring-blue-300/15",
  employees: "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-300/15",
  security: "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-300/15",
  system: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10",
};

export const relativeTime = (value) => {
  const time = new Date(value || Date.now()).getTime();
  if (!Number.isFinite(time)) return "الآن";
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "الآن";
  if (diff < hour) return `منذ ${Math.floor(diff / minute)} د`;
  if (diff < day) return `منذ ${Math.floor(diff / hour)} س`;
  if (diff < 7 * day) return `منذ ${Math.floor(diff / day)} ي`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(time));
};

const dayGroup = (value) => {
  const date = new Date(value || Date.now());
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (startOfDate === startOfToday) return "اليوم";
  if (startOfDate === startOfToday - 86400000) return "الأمس";
  return "الأقدم";
};

const dedupeNotifications = (rows = []) => {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    if (!row?.id) continue;
    const key = String(row.id);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
};

export function NotificationCard({ notification, onOpen, onAction }) {
  const { markRead } = useNotifications();
  const safeNotification = notification || {};
  const category = safeNotification.category || "system";
  const Icon = typeIcon[safeNotification.type] || categoryIcon[category] || AlertTriangle;
  const isUnread = !safeNotification.is_read;
  const moduleLabel = moduleLabels[category] || category || "النظام";
  const priority = safeNotification.priority || "medium";
  const hasAction = Boolean(safeNotification.action_url);
  const handleAction = onOpen || onAction;

  return (
    <RealtimeGlowWrapper channel={category} className="rounded-2xl">
    <article
      className={[
        "group relative overflow-hidden rounded-2xl border p-4 shadow-sm transition duration-200",
        "bg-white text-slate-950 dark:bg-slate-950/76 dark:text-slate-50",
        isUnread
          ? "border-primary ring-1 ring-primary dark:border-primary/25 dark:ring-primary/10"
          : "border-slate-200 dark:border-white/10",
        "hover:-translate-y-0.5 hover:border-primary hover:shadow-lg dark:hover:border-primary/35",
      ].join(" ")}
    >
      {isUnread ? (
        <span className="absolute left-0 top-5 h-10 w-1 rounded-r-full bg-primary shadow-[0_0_18px_rgba(14,165,233,0.45)] dark:bg-primary" />
      ) : null}
      <div className="flex min-w-0 gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ${iconClass[category] || iconClass.system}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black tracking-tight">{safeNotification.title || "إشعار"}</h3>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {safeNotification.message || "لا توجد تفاصيل إضافية متاحة."}
              </p>
            </div>
            {isUnread ? (
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_12px_rgba(14,165,233,0.65)] dark:bg-primary" title="غير مقروء" />
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            <span>{relativeTime(safeNotification.created_at)}</span>
            <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            <span>{moduleLabel}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${priorityClass[priority] || priorityClass.medium}`}>
              {priority}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {hasAction ? (
              <button
                type="button"
                onClick={() => handleAction?.(safeNotification)}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-slate-950 px-3 text-xs font-black text-[var(--primary-contrast)] transition hover:bg-slate-800 dark:bg-primary dark:text-slate-950 dark:hover:bg-primary"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {safeNotification.action_label || "فتح"}
              </button>
            ) : null}
            {isUnread ? (
              <button
                type="button"
                onClick={() => markRead(safeNotification.id)}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 transition hover:border-primary hover:text-primary dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-primary/40 dark:hover:text-primary"
              >
                <Check className="h-3.5 w-3.5" />
                وضع كمقروء
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
    </RealtimeGlowWrapper>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <div className="flex gap-3">
            <div className="h-11 w-11 animate-pulse rounded-2xl bg-slate-200 dark:bg-white/10" />
            <div className="flex-1 space-y-3">
              <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
              <div className="h-3 w-full animate-pulse rounded bg-slate-100 dark:bg-white/10" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100 dark:bg-white/10" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, error, markAllRead, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useDismissableLayer({
    enabled: open,
    refs: [panelRef, triggerRef],
    onDismiss: () => setOpen(false),
  });

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const rows = useMemo(() => dedupeNotifications(notifications), [notifications]);
  const grouped = useMemo(() => {
    const groups = { اليوم: [], الأمس: [], الأقدم: [] };
    rows.forEach((item) => {
      groups[dayGroup(item.created_at)].push(item);
    });
    return groups;
  }, [rows]);

  const handleOpenNotification = (notification) => {
    if (!notification?.action_url) return;
    setOpen(false);
    navigate(notification.action_url);
  };

  const hasRows = rows.length > 0;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={[
          "relative inline-flex h-11 w-11 items-center justify-center rounded-full border text-[var(--text)] shadow-sm transition duration-200",
          "border-[var(--border)] bg-[var(--card)] hover:-translate-y-0.5 hover:border-primary hover:shadow-lg dark:hover:border-primary/35",
        ].join(" ")}
        aria-label="فتح الإشعارات"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        <AnimatedBadgeCounter value={unreadCount} className="absolute -right-1 -top-1" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[9998]">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-[2px] transition-opacity"
            onClick={() => setOpen(false)}
            aria-label="إغلاق الإشعارات"
          />
          <aside
            ref={panelRef}
            className={[
              "absolute right-0 top-0 flex h-dvh w-full max-w-[29rem] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 text-slate-950 shadow-[0_24px_90px_rgba(15,23,42,0.28)]",
              "animate-[notification-slide-in_220ms_ease-out] dark:border-white/10 dark:bg-[#07111f] dark:text-slate-50",
              "max-sm:max-w-none",
            ].join(" ")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="notifications-drawer-title"
          >
            <div className="shrink-0 border-b border-slate-200 bg-white/90 px-5 py-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/88">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-subtle px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-primary dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    مباشر
                  </div>
                  <h2 id="notifications-drawer-title" className="mt-3 text-2xl font-black tracking-tight">
                    الإشعارات
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    آخر التحديثات التشغيلية والتنبيهات الأمنية الخاصة بحسابك.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-primary/35"
                  aria-label="إغلاق الإشعارات"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={!unreadCount}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-primary/35 dark:hover:text-primary"
                >
                  <CheckCheck className="h-4 w-4" />
                  تحديد الكل كمقروء
                </button>
                <button
                  type="button"
                  onClick={() => refresh()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-black text-[var(--primary-contrast)] transition hover:bg-slate-800 dark:bg-primary dark:text-slate-950 dark:hover:bg-primary"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  تحديث
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center dark:border-rose-400/25 dark:bg-rose-500/10">
                  <AlertTriangle className="mx-auto h-8 w-8 text-rose-600 dark:text-rose-200" />
                  <h3 className="mt-3 text-sm font-black">تعذر تحميل الإشعارات</h3>
                  <p className="mt-2 text-sm text-rose-700 dark:text-rose-100">{error}</p>
                  <button
                    type="button"
                    onClick={() => refresh()}
                    className="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-sm font-black text-white transition hover:bg-rose-500"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              ) : loading && !hasRows ? (
                <SkeletonList />
              ) : hasRows ? (
                <div className="space-y-6">
                  {groupOrder.map((group) => {
                    const items = grouped[group] || [];
                    if (!items.length) return null;
                    return (
                      <section key={group} className="space-y-3">
                        <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between bg-slate-50/92 px-1 py-1 backdrop-blur dark:bg-[#07111f]/92">
                          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{group}</h3>
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-black text-slate-600 dark:bg-white/10 dark:text-slate-300">
                            {items.length}
                          </span>
                        </div>
                        {items.map((item) => (
                          <NotificationCard key={item.id} notification={item} onOpen={handleOpenNotification} />
                        ))}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-white/10 dark:bg-slate-950/60">
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10">
                    <Inbox className="h-8 w-8" />
                  </div>
                  <h3 className="mt-5 text-lg font-black">لا توجد إشعارات</h3>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500 dark:text-slate-400">
                    ستظهر هنا مهام الفريق والتنبيهات التشغيلية فور وصولها.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
