import { useMemo, useState } from "react";
import { Bell, CheckCheck, RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { NotificationCard, useNotifications } from "../../../shared/notifications/index.js";
import ThemedSelect from "../../../shared/ui/ThemedSelect";
import "./NotificationsCenter.m1.css";

const categories = ["all", "sales", "orders", "stock", "inventory", "payments", "purchases", "staff_tasks", "security", "system"];
const priorities = ["all", "low", "medium", "high", "critical"];
const readStates = ["all", "unread", "read"];

const categoryOrder = ["sales", "orders", "stock", "inventory", "payments", "purchases", "staff_tasks", "security", "system"];
const categoryTitleKeys = {
  all: "notifications.categories.all",
  sales: "notifications.categories.sales",
  orders: "notifications.categories.orders",
  stock: "notifications.categories.stock",
  inventory: "notifications.categories.inventory",
  payments: "notifications.categories.payments",
  purchases: "notifications.categories.purchases",
  staff_tasks: "notifications.categories.staff_tasks",
  security: "notifications.categories.security",
  system: "notifications.categories.system",
};

const labelKeys = {
  staff_tasks: "notifications.filters.staff_tasks",
  sales: "notifications.filters.sales",
  stock: "notifications.filters.stock",
  all: "notifications.filters.all",
  orders: "notifications.filters.orders",
  payments: "notifications.filters.payments",
  inventory: "notifications.filters.inventory",
  purchases: "notifications.filters.purchases",
  security: "notifications.filters.security",
  system: "notifications.filters.system",
  low: "notifications.filters.low",
  medium: "notifications.filters.medium",
  high: "notifications.filters.high",
  critical: "notifications.filters.critical",
  unread: "notifications.filters.unread",
  read: "notifications.filters.read",
};

function NotificationsCenter() {
  const { t, i18n } = useTranslation();
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

  const categoryCounts = useMemo(() => notifications.reduce((accumulator, item) => {
    const key = item.category || "system";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {}), [notifications]);

  const groupedNotifications = useMemo(() => {
    const groups = new Map();
    filtered.forEach((item) => {
      const key = item.category || "system";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    const knownGroups = categoryOrder
      .filter((key) => groups.has(key))
      .map((key) => ({ key, title: categoryTitleKeys[key] ? t(categoryTitleKeys[key]) : key, items: groups.get(key) }));
    const unknownGroups = Array.from(groups.entries())
      .filter(([key]) => !categoryOrder.includes(key))
      .map(([key, items]) => ({ key, title: categoryTitleKeys[key] ? t(categoryTitleKeys[key]) : key, items }));
    return [...knownGroups, ...unknownGroups];
  }, [filtered]);

  return (
    <div className="m1-notifications-center space-y-4" dir={i18n.dir()}>
      <section className="notification-hero overflow-hidden rounded-3xl border shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="notification-hero__body border-b p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">{t("notifications.center.eyebrow")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="notification-hero__icon inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border">
                  <Bell className="h-5 w-5" aria-hidden="true" />
                </span>
                <h1 className="m1-page-title text-slate-50">{t("notifications.center.title")}</h1>
                {unreadCount > 0 ? (
                  <span className="notification-unread-badge rounded-full border px-3 py-1 text-xs font-black">
                    {t("notifications.center.unreadBadge", { count: unreadCount > 99 ? "99+" : unreadCount })}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">{t("notifications.center.subtitle")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <button
                type="button"
                onClick={markAllRead}
                disabled={!unreadCount}
                className="notification-action notification-action--secondary inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-45"
              >
                <CheckCheck className="h-4 w-4" />
                {t("notifications.center.markAllRead")}
              </button>
              <button
                type="button"
                onClick={() => refresh()}
                className="notification-action notification-action--primary inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2 text-sm font-black transition"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("notifications.center.refresh")}
              </button>
            </div>
          </div>

          <div className="notification-filter-grid mt-5 grid gap-3 xl:grid-cols-[minmax(14rem,1.5fr)_repeat(5,minmax(0,1fr))]">
            <label className="notification-search flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2">
              <Search className="notification-search__icon h-4 w-4 shrink-0" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("notifications.center.search")}
                className="notification-search__input min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <Select value={category} onChange={setCategory} rows={categories} />
            <Select value={priority} onChange={setPriority} rows={priorities} />
            <Select value={readState} onChange={setReadState} rows={readStates} />
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="notification-filter-control min-h-[var(--control-height-lg)] rounded-[var(--radius-control)] border px-3 py-2 text-sm outline-none" />
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="notification-filter-control min-h-[var(--control-height-lg)] rounded-[var(--radius-control)] border px-3 py-2 text-sm outline-none" />
          </div>
        </div>
      </section>

      <nav className="notification-category-nav" aria-label={t("notifications.center.categoryNav")}>
        {["all", ...categoryOrder, ...Object.keys(categoryCounts).filter((key) => !categoryOrder.includes(key))].map((key) => {
          const count = key === "all" ? notifications.length : categoryCounts[key] || 0;
          if (key !== "all" && !count) return null;
          return (
            <button key={key} type="button" onClick={() => setCategory(key)} className={category === key ? "active" : ""}>
              <span>{categoryTitleKeys[key] ? t(categoryTitleKeys[key]) : key}</span>
              <b>{count > 99 ? "99+" : count}</b>
            </button>
          );
        })}
      </nav>

      {error ? <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm font-bold text-red-100">{error}</div> : null}

      <div className="notification-feed">
        {loading ? (
          <div className="notification-card-grid">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-700/50 bg-slate-900/80" />)}</div>
        ) : filtered.length ? (
          groupedNotifications.map((group) => (
            <section key={group.key} className="notification-group">
              <header>
                <div>
                  <h2>{group.title}</h2>
                  <p>{t("notifications.center.unreadOfTotal", { unread: group.items.filter((item) => !item.is_read).length, total: group.items.length })}</p>
                </div>
                {category === "all" ? <button type="button" onClick={() => setCategory(group.key)}>{t("notifications.center.viewSection")}</button> : null}
              </header>
              <div className="notification-card-grid">
                {group.items.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onAction={(item) => navigate(item.action_url)}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="flex min-h-[20rem] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-700 bg-[#07111f] p-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/80 text-slate-300">
              <Bell className="h-8 w-8" />
            </div>
            <h2 className="m1-section-title mt-4 text-slate-50">{t("notifications.center.empty")}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">{t("notifications.center.emptyHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Select({ value, onChange, rows }) {
  const { t } = useTranslation();
  return (
    <ThemedSelect
      value={value}
      onChange={onChange}
      options={rows.map((item) => ({ value: item, label: labelKeys[item] ? t(labelKeys[item]) : item }))}
      triggerClassName="notification-filter-control min-h-[var(--control-height-lg)] rounded-[var(--radius-control)] border px-3 py-2 text-sm font-bold outline-none"
    />
  );
}

export default NotificationsCenter;
