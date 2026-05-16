import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { Bell, CircleDollarSign, LogOut, Menu, Paintbrush, ShoppingBag, Store, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { clearAuth, getCurrentTenant, getCurrentUser, getToken } from "../auth/authStorage";
import { getVisibleSidebarSections } from "../../modules/permissions/lib/rbacStore";
import { useTheme } from "../../theme/useTheme";
import { translateSidebarSections } from "../../i18n/navigation";
import { NotificationBoundary, NotificationsProvider, useNotifications } from "../notifications/index.js";
import { useRealtimeConnection } from "../realtime/socketStore";

const NotificationBell = lazy(() => import("../notifications/NotificationBell.jsx"));

function NotificationBellFallback() {
  return (
    <button
      type="button"
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] opacity-70 shadow-sm"
      aria-label="Notifications unavailable"
      disabled
    >
      <Bell className="h-5 w-5" />
    </button>
  );
}

function SidebarNotificationBadge({ item }) {
  const { unreadCount } = useNotifications();
  if (item.to !== "/notifications" || unreadCount <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  );
}

function RealtimePill({ label }) {
  const realtime = useRealtimeConnection();
  const connected = realtime.connected;
  return (
    <div className="hidden h-11 items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-zinc-950/75 px-3 text-sm font-black text-cyan-100 shadow-[0_10px_30px_rgba(0,0,0,0.18),0_0_22px_rgba(34,211,238,0.12)] backdrop-blur sm:flex sm:px-4">
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.85)]" : "bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.75)]"}`} />
      <span className="hidden md:inline">{connected ? label : "Realtime reconnecting"}</span>
    </div>
  );
}

function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const user = useMemo(
    () => getCurrentUser() || { name: "Admin", role: "Admin", permissions: ["*"] },
    []
  );
  const { theme } = useTheme();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const currentTenant = getCurrentTenant();
  const workspaceName = currentTenant?.companyName || currentTenant?.name || currentTenant?.slug || t("common.enterpriseDashboard");

  useEffect(() => {
    if (!getToken()) {
      navigate("/login");
    }
  }, [navigate]);

  useEffect(() => {
    const handleAuthExpired = () => {
      if (window.location.pathname === "/login") return;
      window.setTimeout(() => {
        if (window.location.pathname !== "/login") {
          navigate("/login");
        }
      }, 800);
    };

    window.addEventListener("erp:auth-expired", handleAuthExpired);
    return () => window.removeEventListener("erp:auth-expired", handleAuthExpired);
  }, [navigate]);

  const sections = useMemo(() => translateSidebarSections(getVisibleSidebarSections(user), t), [user, t]);
  const resolvedDir = typeof i18n.dir === "function" ? i18n.dir(i18n.language) : "";
  const documentDir = typeof document !== "undefined" ? document.documentElement.dir : "";
  const dir = (resolvedDir || documentDir) === "rtl" ? "rtl" : "ltr";
  const isRtl = dir === "rtl";
  const isPosActive = location.pathname === "/pos" || location.pathname.startsWith("/pos/");
  const isStoreActive = location.pathname === "/shop" || location.pathname.startsWith("/shop/");
  const posLabel = t("sidebar.posPro");

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMobileDrawerOpen(false);
        return;
      }
      if (event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (String(event.key || "").toLowerCase() !== "p") return;

      event.preventDefault();
      navigate("/pos");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  if (isPosActive) {
    return (
      <div
        dir={dir}
        className="h-screen w-screen overflow-hidden bg-slate-950 text-[var(--text)]"
      >
        <Outlet />
      </div>
    );
  }

  return (
    <NotificationsProvider>
    <div
      dir={dir}
      className="min-h-screen w-screen max-w-[100vw] overflow-x-hidden bg-[var(--bg)] text-[var(--text)] transition-all duration-300"
    >
      {mobileDrawerOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setMobileDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      ) : null}

      <aside
        className={[
          "sidebar-scroll fixed bottom-0 top-0 z-50 flex w-72 flex-col overflow-y-auto overflow-x-hidden bg-[var(--surface)] p-5 shadow-2xl transition-transform duration-300 lg:translate-x-0",
          mobileDrawerOpen ? "translate-x-0" : isRtl ? "translate-x-full" : "-translate-x-full",
          "lg:block",
          isRtl
            ? "left-auto right-0 border-l border-[var(--border)]"
            : "left-0 right-auto border-r border-[var(--border)]",
        ].join(" ")}
      >
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Workspace</div>
            <div className="truncate text-sm font-bold text-[var(--text)]">{workspaceName}</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(false)}
            className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text)]"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <div className="mb-6 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h1 className="text-3xl font-black tracking-tight text-[var(--text)]">ERP PRO</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">{t("common.enterpriseDashboard")}</p>
          </div>

          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.title}>
                <p className="mb-3 px-2 text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">{section.title}</p>
                <div className="space-y-2">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const [itemPath, itemSearch] = String(item.to || "").split("?");
                    const active = itemSearch
                      ? location.pathname === itemPath && location.search === `?${itemSearch}`
                      : (location.pathname === itemPath && !location.search) || location.pathname.startsWith(`${itemPath}/`);
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileDrawerOpen(false)}
                        className={[
                          "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                          active
                            ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)] shadow-lg"
                            : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--card)] hover:text-[var(--text)]",
                        ].join(" ")}
                      >
                        {Icon ? <Icon className="h-4 w-4" /> : null}
                        <span>{item.label}</span>
                        <SidebarNotificationBadge item={item} />
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{user?.name}</p>
            <p className="mt-1 text-xs text-[var(--muted)] capitalize">{String(user?.role || "admin")}</p>
          </div>

          <button
            type="button"
            onClick={() => navigate("/settings/appearance")}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-soft)]"
          >
            <Paintbrush className="h-4 w-4" />
            {theme?.name || t("common.appearance")}
          </button>

          <button
            type="button"
            onClick={() => navigate("/settings/currencies")}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-soft)]"
          >
            <CircleDollarSign className="h-4 w-4" />
            {t("common.currency")}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--danger)] px-4 py-3 text-sm font-black text-white shadow-lg"
          >
            <LogOut className="h-4 w-4" />
            {t("common.logout")}
          </button>
        </div>
      </aside>

      <main
        className={[
          "min-h-screen w-screen max-w-[100vw] min-w-0 overflow-x-hidden",
          "lg:w-[calc(100%-18rem)]",
          isRtl ? "lg:mr-72" : "lg:ml-72",
        ].join(" ")}
      >
        <div className="flex min-h-screen w-full min-w-0 max-w-none flex-col overflow-x-hidden">
          <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-2xl lg:top-0" style={{ "--topbar-height": "72px" }}>
            <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4 lg:px-6 xl:px-8 lg:py-5">
              <div className="flex min-w-0 items-center gap-3 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-[var(--text)]"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-[var(--text)]">{workspaceName}</div>
                  <div className="truncate text-xs text-[var(--muted)]">{user?.name}</div>
                </div>
              </div>

              <div className="hidden min-w-0 lg:block">
                <h2 className="text-2xl font-bold tracking-tight text-[var(--text)]">{t("common.enterpriseDashboard")}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {t("common.welcomeBack")}, {user?.name}
                </p>
              </div>

              <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-2.5 lg:gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/shop")}
                  title="Store"
                  aria-label="Open Store"
                  className={[
                    "group inline-flex h-11 items-center justify-center gap-2 rounded-full border px-3 text-sm font-black transition duration-200 sm:px-4",
                    "bg-zinc-950/75 text-[var(--text)] shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur",
                    isStoreActive
                      ? "border-emerald-400/55 bg-emerald-500/15 text-emerald-100 shadow-[0_0_28px_rgba(16,185,129,0.24)]"
                      : "border-emerald-400/25 hover:-translate-y-0.5 hover:border-emerald-300/50 hover:bg-emerald-500/10 hover:text-emerald-100 hover:shadow-[0_0_26px_rgba(16,185,129,0.2)]",
                  ].join(" ")}
                >
                  <ShoppingBag className="h-4 w-4 text-emerald-300 transition group-hover:text-emerald-200" />
                  <span className="hidden sm:inline">Store</span>
                </button>
                <NotificationBoundary fallback={<NotificationBellFallback />}>
                  <Suspense fallback={<NotificationBellFallback />}>
                    <NotificationBell />
                  </Suspense>
                </NotificationBoundary>
                <button
                  type="button"
                  onClick={() => navigate("/pos")}
                  title={`${posLabel} (Alt+P)`}
                  aria-label={`${posLabel} (Alt+P)`}
                  className={[
                    "group inline-flex h-11 items-center justify-center gap-2 rounded-full border px-3 text-sm font-black transition duration-200 sm:px-4",
                    "bg-zinc-950/75 text-[var(--text)] shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur",
                    isPosActive
                      ? "border-violet-300/55 bg-violet-500/15 text-violet-100 shadow-[0_0_28px_rgba(139,92,246,0.24)]"
                      : "border-violet-400/25 hover:-translate-y-0.5 hover:border-violet-300/50 hover:bg-violet-500/10 hover:text-violet-100 hover:shadow-[0_0_26px_rgba(139,92,246,0.2)]",
                  ].join(" ")}
                >
                  <Store className="h-4 w-4 text-violet-300 transition group-hover:text-violet-200" />
                  <span className="hidden sm:inline">{posLabel}</span>
                  <span className="sm:hidden">POS</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-semibold text-[var(--text)] lg:hidden"
                  aria-label="Logout"
                >
                  <LogOut className="h-4 w-4" />
                </button>
                <RealtimePill label={t("common.systemOnline")} />
              </div>
            </div>
          </div>

          <div className="w-full max-w-none flex-1 overflow-x-hidden p-3 sm:p-4 lg:p-6 xl:p-8 2xl:p-10">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
    </NotificationsProvider>
  );
}

export default MainLayout;
