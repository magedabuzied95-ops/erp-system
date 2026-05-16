import { useMemo, useState } from "react";
import { Bell, CheckCheck, RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { NotificationCard, useNotifications } from "../../../shared/notifications/index.js";

const categories = ["all", "staff_tasks", "orders", "payments", "inventory", "purchases", "security", "system"];
const priorities = ["all", "low", "medium", "high", "critical"];
const readStates = ["all", "unread", "read"];

const labels = {
  staff_tasks: "Staff tasks",
  all: "الكل",
  orders: "الطلبات",
  payments: "المدفوعات",
  inventory: "المخزون",
  purchases: "المشتريات",
  security: "الأمان",
  system: "النظام",
  low: "منخفض",
  medium: "متوسط",
  high: "مرتفع",
  critical: "حرج",
  unread: "غير مقروء",
  read: "مقروء",
};

function NotificationsCenter() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, error, refresh, markAllRead } = useNotifications();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [priority, setPriority] = useState("all");
  const [readState, setReadState] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notifications.filter((item) => {
      if (q && !`${item.title} ${item.message} ${item.category} ${item.type}`.toLowerCase().includes(q)) return false;
      if (category !== "all" && item.category !== category) return false;
      if (priority !== "all" && item.priority !== priority) return false;
      if (readState === "unread" && item.is_read) return false;
      if (readState === "read" && !item.is_read) return false;
      if (dateFrom && new Date(item.created_at) < new Date(dateFrom)) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (new Date(item.created_at) > end) return false;
      }
      return true;
    });
  }, [category, dateFrom, dateTo, notifications, priority, query, readState]);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="overflow-hidden rounded-3xl border border-slate-700/70 bg-[#07111f] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="border-b border-slate-700/70 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(7,17,31,0.98))] p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Notifications Center</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-300 shadow-[0_14px_34px_rgba(16,185,129,0.12)]">
                  <Bell className="h-5 w-5" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-black text-slate-50 sm:text-3xl">الإشعارات</h1>
                {unreadCount > 0 ? (
                  <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-100">
                    {unreadCount > 99 ? "99+" : unreadCount} غير مقروء
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">مركز متابعة أحداث ERP والويب سايت في الوقت الحقيقي.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <button
                type="button"
                onClick={markAllRead}
                disabled={!unreadCount}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600/80 bg-slate-900/80 px-4 py-2 text-sm font-black text-slate-100 transition hover:border-emerald-300/50 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <CheckCheck className="h-4 w-4" />
                تعليم الكل كمقروء
              </button>
              <button
                type="button"
                onClick={() => refresh()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-emerald-300"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                تحديث
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(14rem,1.5fr)_repeat(5,minmax(0,1fr))]">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/55 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="بحث"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
            </label>
            <Select value={category} onChange={setCategory} rows={categories} />
            <Select value={priority} onChange={setPriority} rows={priorities} />
            <Select value={readState} onChange={setReadState} rows={readStates} />
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950/55 px-3 py-2 text-sm text-slate-100 outline-none" />
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950/55 px-3 py-2 text-sm text-slate-100 outline-none" />
          </div>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm font-bold text-red-100">{error}</div> : null}

      <div className="grid gap-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-700/50 bg-slate-900/80" />)
        ) : filtered.length ? (
          filtered.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onAction={(item) => navigate(item.action_url)}
            />
          ))
        ) : (
          <div className="flex min-h-[20rem] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-700 bg-[#07111f] p-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/80 text-slate-300">
              <Bell className="h-8 w-8" />
            </div>
            <h2 className="mt-4 text-xl font-black text-slate-50">لا توجد إشعارات</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">لا توجد نتائج مطابقة للفلاتر الحالية. غيّر الفلاتر أو جرّب التحديث لاحقا.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Select({ value, onChange, rows }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950/55 px-3 py-2 text-sm font-bold text-slate-100 outline-none">
      {rows.map((item) => (
        <option key={item} value={item}>{labels[item] || item}</option>
      ))}
    </select>
  );
}

export default NotificationsCenter;
