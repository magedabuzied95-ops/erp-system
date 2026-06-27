import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { Bell, ChevronDown, CircleDollarSign, LogOut, Menu, Paintbrush, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Search, Settings2, ShoppingBag, Store, User, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { clearAuth, getCurrentTenant, getCurrentUser, getToken } from "../auth/authStorage";
import { getVisibleSidebarSections } from "../../modules/permissions/lib/rbacStore";
import { translateSidebarSections } from "../../i18n/navigation";
import NotificationSoundProvider from "../../components/feedback/NotificationSoundProvider";
import AnimatedBadgeCounter from "../../components/feedback/AnimatedBadgeCounter";
import SidebarPulseIndicator from "../../components/feedback/SidebarPulseIndicator";
import usePageTitle from "../hooks/usePageTitle";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { NotificationBoundary, NotificationsProvider, useNotifications } from "../notifications/index.js";
import { useRealtimeConnection } from "../realtime/socketStore";

const NotificationBell = lazy(() => import("../notifications/NotificationBell.jsx"));
const SIDEBAR_GROUPS_STORAGE_KEY = "erp.sidebar.openGroups.v2";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "erp.sidebar.collapsed";

const ENTERPRISE_GROUPS = [
  "Main",
  "Sales",
  "Operations",
  "Products & Inventory",
  "Purchasing",
  "Employees",
  "Finance",
  "AI & Marketing",
  "System Settings",
];

const GROUP_TITLE_KEYS = {
  Main: "الرئيسية",
  Sales: "المبيعات",
  Operations: "العمليات",
  "Products & Inventory": "المنتجات والمخزون",
  Purchasing: "المشتريات",
  Employees: "الموظفون",
  Finance: "المالية",
  "AI & Marketing": "الذكاء والتسويق",
  "System Settings": "إعدادات النظام",
};

const HEADER_QUICK_ACTION_ROUTES = ["/orders", "/products/add", "/products", "/marketing/ai-center"];
const QUICK_ACCESS_LABELS = {
  "/orders": "الطلبات",
  "/products/add": "إضافة منتج",
  "/marketing/ai-center": "مركز التسويق الذكي",
  "/products": "المنتجات",
};
const SIDEBAR_SUBGROUP_TITLE_KEYS = {
  "AI Marketing": "التسويق الذكي",
  "AI Support": "دعم الذكاء",
  "System Settings": "إعدادات النظام",
};

const SYSTEM_PREFERENCE_ROUTES = new Set(["/settings", "/settings/appearance", "/settings/company", "/settings/storefront", "/settings/shipping", "/settings/payments"]);
const SETTINGS_CENTER_SIDEBAR_HIDE_ROUTES = new Set([
  "/settings/company",
  "/settings/currencies",
  "/settings/appearance",
  "/settings/storefront",
  "/settings/shipping",
  "/settings/payments",
]);
const SETTINGS_CENTER_ACTIVE_ROUTES = new Set([
  "/settings",
  "/settings/company",
  "/settings/currencies",
  "/settings/appearance",
  "/settings/storefront",
  "/settings/shipping",
  "/settings/payments",
]);
const AI_MARKETING_ROUTES = new Set(["/marketing/ai-center", "/marketing/ai-center/leads", "/marketing/ai-center/videos", "/admin/ai-inbox", "/admin/ai-followups", "/admin/ai-channels", "/admin/ai-agent-analytics"]);
const AI_SUPPORT_ROUTES = new Set(["/admin/ai-support-console", "/admin/ai-support-knowledge-base", "/admin/ai-agent-settings"]);
const ARABIC_GROUP_LABELS = {
  Main: "الرئيسية",
  Sales: "المبيعات",
  Operations: "العمليات",
  "Products & Inventory": "المنتجات والمخزون",
  Purchasing: "المشتريات",
  Employees: "الموظفون",
  Finance: "المالية",
  "AI & Marketing": "الذكاء والتسويق",
  "System Settings": "إعدادات النظام",
};
const ARABIC_SUBGROUP_LABELS = {
  "AI Marketing": "التسويق الذكي",
  "AI Support": "دعم الذكاء",
  "System Settings": "إعدادات النظام",
};

const sidebarSubgroupForItem = (groupTitle, item) => {
  const to = String(item.to || "");
  if (groupTitle === "Marketing" && AI_MARKETING_ROUTES.has(to)) return "AI Marketing";
  if (groupTitle === "System") {
    if (AI_SUPPORT_ROUTES.has(to)) return "AI Support";
    if (SYSTEM_PREFERENCE_ROUTES.has(to) || to === "/settings/currencies" || to === "__profile") return "System Settings";
  }
  return "";
};

const readSidebarJson = (key, fallback) => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeSidebarJson = (key, value) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota/access issues; navigation should keep working.
  }
};

const splitRoute = (to = "") => {
  const [pathname, search = ""] = String(to || "").split("?");
  return { pathname, search };
};

const CONCRETE_SIDEBAR_PATHS = new Set([
  "/products/add",
  "/orders/returns",
  "/employees/attendance",
  "/employees/payroll",
  "/employees/advances",
  "/settings/users",
  "/settings/permissions",
  "/settings/company",
  "/settings/storefront",
  "/settings/shipping",
  "/settings/payments",
  "/settings/appearance",
]);

const sidebarItemActive = (item, location) => {
  const { pathname, search } = splitRoute(item.to);
  if (item.to === "/settings" && SETTINGS_CENTER_ACTIVE_ROUTES.has(location.pathname)) return true;
  if (search) return location.pathname === pathname && location.search === `?${search}`;
  if (location.pathname === pathname && !location.search) return true;
  if (CONCRETE_SIDEBAR_PATHS.has(location.pathname)) return false;
  return location.pathname.startsWith(`${pathname}/`);
};

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const normalizeSearchText = (value = "") =>
  String(value || "")
    .normalize("NFKD")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim()
    .toLowerCase();

const levenshteinDistance = (a = "", b = "") => {
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = previous[j];
      previous[j] = a[i - 1] === b[j - 1]
        ? diagonal
        : Math.min(previous[j - 1] + 1, previous[j] + 1, diagonal + 1);
      diagonal = temp;
    }
  }
  return previous[b.length];
};

const isSubsequenceMatch = (needle = "", hay = "") => {
  if (!needle) return true;
  let index = 0;
  for (const char of hay) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
};

const sidebarSearchHaystack = (item, groupTitle = "") =>
  normalizeSearchText([
    item.title,
    item.arabicTitle,
    item.label,
    item.sidebarLabel,
    item.sourceLabel,
    item.to,
    item.route,
    item.category,
    item.permission,
    ...(Array.isArray(item.keywords) ? item.keywords : [item.keywords]),
    ...(Array.isArray(item.aliases) ? item.aliases : [item.aliases]),
    groupTitle,
  ].filter(Boolean).join(" "));

const sidebarSearchTokens = (item, groupTitle = "") =>
  sidebarSearchHaystack(item, groupTitle).split(/[\s/.,|:;?()[\]{}_-]+/).filter(Boolean);

const sidebarItemMatchesSearch = (item, groupTitle, query) => {
  if (!query) return true;
  const haystack = sidebarSearchHaystack(item, groupTitle);
  if (haystack.includes(query)) return true;
  const tokens = sidebarSearchTokens(item, groupTitle);
  if (tokens.some((token) => token.startsWith(query) || query.startsWith(token))) return true;
  if (query.length >= 3 && tokens.some((token) => isSubsequenceMatch(query, token))) return true;
  if (query.length >= 3 && tokens.some((token) => Math.max(query.length, token.length) <= 24 && levenshteinDistance(query, token) <= 1)) return true;
  return false;
};

const resolveMainLayoutTitle = (pathname = "") => {
  const path = String(pathname || "");
  if (path === "/dashboard" || path === "/") return "Dashboard";
  if (path.startsWith("/orders")) return "Orders";
  if (path.startsWith("/products")) return "Products";
  if (path.startsWith("/inventory")) return "Inventory";
  if (path.startsWith("/customers")) return "Customers";
  if (path.startsWith("/purchases")) return "Purchases";
  if (path.startsWith("/accounting")) return "Accounting";
  if (path.startsWith("/settings")) return "Settings";
  if (path === "/notifications") return "Notifications";
  if (path === "/workspace") return "Workspace";
  if (path === "/billing") return "Billing";
  if (path === "/admin/ai-inbox") return "AI Inbox";
  if (path === "/admin/ai-followups") return "AI Follow-ups";
  if (path === "/admin/ai-channels") return "AI Channels";
  if (path === "/admin/ai-agent-analytics") return "AI Analytics";
  if (path === "/admin/ai-agent-settings") return "AI Agent Settings";
  if (path === "/admin/ai-support-console") return "AI Support Console";
  if (path === "/admin/ai-support-knowledge-base") return "AI Knowledge Base";
  if (path === "/admin/tenants") return "Tenants";
  if (path === "/marketing/ai-center") return "AI Marketing";
  if (path === "/marketing/ai-center/leads") return "AI Lead Center";
  return "";
};

const groupForSidebarItem = (sectionTitle, item) => {
  const to = String(item.to || "");

  if (sectionTitle === "Employees" && to === "/reports") return "Employees";
  if (to === "/dashboard" || to === "/workspace" || to === "/notifications") return "Main";
  if (to === "/pos" || to === "/orders" || to === "/orders?channel=website" || to === "/orders/returns" || to === "/customers") return "Sales";
  if (to === "/operations/shipping") return "Operations";
  if (to === "/products" || to === "/products/add" || to === "/inventory" || to === "/inventory/count" || to === "/warehouses" || to === "/stock-transfers") return "Products & Inventory";
  if (to === "/purchases" || to === "/suppliers") return "Purchasing";
  if (to === "/employees" || to.startsWith("/employees/")) return "Employees";
  if (to === "/accounting" || to === "/expenses" || to === "/reports") return "Finance";
  if (to === "/marketing/ai-center" || to === "/admin/ai-inbox" || to === "/admin/ai-followups" || to === "/admin/ai-channels" || to === "/admin/ai-agent-analytics" || to === "/admin/ai-support-knowledge-base" || to === "/admin/ai-agent-settings") return "AI & Marketing";
  if (to === "/branches" || to === "/settings/users" || to === "/admin/tenants" || to === "/settings/permissions" || to === "/settings/company" || to === "/settings/storefront" || to === "/settings/shipping" || to === "/settings/payments" || to === "/settings") return "System Settings";

  if (sectionTitle === "Main") return "Main";
  if (sectionTitle === "Products" || sectionTitle === "Inventory") return "Products & Inventory";
  if (sectionTitle === "Marketing") return "AI & Marketing";
  if (sectionTitle === "Settings") return "System Settings";
  if (sectionTitle === "Employees" || sectionTitle === "HR / Attendance") return "Employees";
  if (sectionTitle === "Purchasing") return "Purchasing";
  if (sectionTitle === "Finance") return "Finance";
  if (sectionTitle === "Sales") return "Sales";
  if (sectionTitle === "Operations") return "Operations";

  return "System Settings";
};

const buildEnterpriseSidebarGroups = (sections) => {
  const groups = ENTERPRISE_GROUPS.map((title) => ({ title, items: [] }));
  const byTitle = new Map(groups.map((group) => [group.title, group]));
  const seen = new Set();

  let canAccessSettings = false;
  sections.forEach((section) => {
    section.items.forEach((item) => {
      if (item.to === "/settings" || item.to === "/settings/appearance" || item.to === "/settings/company" || item.to === "/settings/storefront" || item.to === "/settings/shipping" || item.to === "/settings/payments") canAccessSettings = true;
      if (SETTINGS_CENTER_SIDEBAR_HIDE_ROUTES.has(String(item.to || ""))) return;
      const key = item.to || `${section.title}:${item.label}`;
      if (seen.has(key)) return;
      seen.add(key);
      const groupTitle = groupForSidebarItem(section.sourceTitle || section.title, item);
      const sidebarLabel = item.to === "/settings/appearance"
        ? "المظهر"
        : item.to === "/settings"
          ? "مركز الإعدادات"
        : item.to === "/settings/company"
          ? "عام"
        : item.to === "/settings/storefront"
          ? "المتجر الإلكتروني"
        : item.to === "/settings/shipping"
          ? "الشحن"
        : item.to === "/settings/payments"
          ? "المدفوعات"
          : undefined;
      const sidebarIcon = item.to === "/settings/appearance"
        ? Paintbrush
        : item.to === "/settings"
          ? Settings2
        : item.to === "/settings/company"
          ? Settings2
          : item.icon;
      byTitle.get(groupTitle)?.items.push({ ...item, icon: sidebarIcon, sidebarLabel, sourceSection: section.sourceTitle || section.title });
    });
  });

  const routeOrders = {
    Main: ["/dashboard", "/workspace", "/notifications"],
    Sales: ["/pos", "/orders", "/orders?channel=website", "/orders/returns", "/customers"],
    Operations: ["/operations/shipping"],
    "Products & Inventory": ["/products", "/products/add", "/inventory", "/inventory/count", "/warehouses", "/stock-transfers"],
    Purchasing: ["/purchases", "/suppliers"],
    Employees: ["/employees", "/employees/attendance", "/reports"],
    Finance: ["/accounting", "/expenses"],
    "AI & Marketing": ["/admin/ai-inbox", "/marketing/ai-center", "/admin/ai-followups", "/admin/ai-channels", "/admin/ai-agent-analytics", "/admin/ai-support-knowledge-base", "/admin/ai-agent-settings"],
    "System Settings": ["/settings", "/settings/company", "/settings/storefront", "/settings/shipping", "/settings/payments", "/branches", "/settings/users", "/admin/tenants", "/settings/permissions"],
  };
  groups.forEach((group) => {
    const routeOrder = routeOrders[group.title] || [];
    group.items.sort((a, b) => {
      const aIndex = routeOrder.indexOf(a.to);
      const bIndex = routeOrder.indexOf(b.to);
      if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
      return 0;
    });
  });

  return groups.filter((group) => group.items.length > 0);
};

function SidebarNavItem({ item, location, collapsed = false, onNavigate }) {
  const Icon = item.icon;
  const active = sidebarItemActive(item, location);
  const displayLabel = item.sidebarLabel || item.label;
  return (
    <NavLink
      key={item.to}
      to={item.to}
      title={collapsed ? displayLabel : undefined}
      aria-label={displayLabel}
      onClick={onNavigate}
      className={[
        "group/nav relative flex min-h-9 items-center rounded-xl border text-sm font-semibold transition duration-200",
        collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2",
        active
          ? "border-[var(--primary)]/45 bg-[var(--primary-soft)] text-[var(--primary)] shadow-sm"
          : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--card)] hover:text-[var(--text)]",
      ].join(" ")}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      {collapsed ? null : <span className="min-w-0 flex-1 truncate text-start">{displayLabel}</span>}
      <span className={collapsed ? "absolute end-1 top-1" : "ms-auto flex items-center gap-1.5"}>
        <SidebarNotificationBadge item={item} />
        <SidebarPulseIndicator item={item} />
      </span>
    </NavLink>
  );
}

function HeaderQuickActionButton({ item, location, onNavigate }) {
  const Icon = item.icon;
  const active = sidebarItemActive(item, location);
  const labelKey = QUICK_ACCESS_LABELS[item.to];
  const label = labelKey || item.sidebarLabel || item.label;
  return (
    <NavLink
      to={item.to}
      title={label}
      aria-label={label}
      onClick={onNavigate}
      className={[
        "group/header-quick inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border px-3 text-sm font-black transition duration-200",
        "bg-zinc-950/65 text-[var(--text)] shadow-[0_10px_24px_rgba(0,0,0,0.14)] backdrop-blur",
        active
          ? "border-[var(--primary)]/50 bg-[var(--primary-soft)] text-[var(--primary)] shadow-[0_0_24px_rgba(16,185,129,0.16)]"
          : "border-white/10 hover:-translate-y-0.5 hover:border-[var(--primary)]/35 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]",
      ].join(" ")}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-[var(--primary)] transition group-hover/header-quick:text-[var(--text)]" /> : null}
      <span className="hidden xl:inline">{label}</span>
    </NavLink>
  );
}

function NotificationBellFallback() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] opacity-70 shadow-sm"
      aria-label="الإشعارات"
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
    <AnimatedBadgeCounter value={unreadCount} className="ms-auto" />
  );
}

function RealtimePill({ label }) {
  const { t } = useTranslation();
  const realtime = useRealtimeConnection();
  const connected = realtime.connected;
  return (
    <div className="hidden h-11 items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-zinc-950/75 px-3 text-sm font-black text-cyan-100 shadow-[0_10px_30px_rgba(0,0,0,0.18),0_0_22px_rgba(34,211,238,0.12)] backdrop-blur sm:flex sm:px-4">
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.85)]" : "bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.75)]"}`} />
      <span className="hidden md:inline">{connected ? label : "جارٍ إعادة الاتصال"}</span>
    </div>
  );
}

function WorkspaceBrandMark({ name, logoUrl, className = "" }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  const initials = String(name || "MONE")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "MONE";

  return (
    <div className={["flex shrink-0 items-center justify-center overflow-hidden border border-[var(--border)] bg-[var(--card)] text-sm font-black text-[var(--text)]", className].join(" ")}>
      {logoUrl && !failed ? (
        <img
          src={logoUrl}
          alt={name}
          className="h-full w-full object-contain p-1.5"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  usePageTitle(resolveMainLayoutTitle(location.pathname));
  const user = useMemo(
    () => getCurrentUser() || { name: "Admin", role: "Admin", permissions: ["*"] },
    []
  );
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Boolean(readSidebarJson(SIDEBAR_COLLAPSED_STORAGE_KEY, false)));
  const [openGroups, setOpenGroups] = useState(() => readSidebarJson(SIDEBAR_GROUPS_STORAGE_KEY, {}));
  const [sidebarSearch, setSidebarSearch] = useState("");
  const currentTenant = getCurrentTenant();
  const workspaceName = currentTenant?.companyName || currentTenant?.company_name || currentTenant?.name || currentTenant?.slug || "MONE";
  const workspaceLogoUrl = currentTenant?.companyLogoUrl || currentTenant?.company_logo_url || currentTenant?.logoUrl || "";
  const workspaceInitials = String(workspaceName || "MONE")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "MONE";

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

  const sections = useMemo(() => {
    const rawSections = getVisibleSidebarSections(user);
    const translatedSections = translateSidebarSections(rawSections, t);
    return translatedSections.map((section, sectionIndex) => ({
      ...section,
      sourceTitle: rawSections[sectionIndex]?.title || section.title,
      items: section.items.map((item, itemIndex) => ({
        ...item,
        sourceLabel: rawSections[sectionIndex]?.items?.[itemIndex]?.label || item.label,
      })),
    }));
  }, [user, t]);
  const groupedSections = useMemo(() => buildEnterpriseSidebarGroups(sections), [sections]);
  const allSidebarItems = useMemo(() => groupedSections.flatMap((group) => group.items), [groupedSections]);
  const headerQuickActionItems = useMemo(() => {
    const byRoute = new Map(allSidebarItems.map((item) => [item.to, item]));
    return HEADER_QUICK_ACTION_ROUTES.map((route) => byRoute.get(route)).filter(Boolean);
  }, [allSidebarItems]);
  const resolvedDir = typeof i18n.dir === "function" ? i18n.dir(i18n.language) : "";
  const documentDir = typeof document !== "undefined" ? document.documentElement.dir : "";
  const dir = (resolvedDir || documentDir) === "rtl" ? "rtl" : "ltr";
  const isRtl = dir === "rtl";
  const isPosActive = location.pathname === "/pos" || location.pathname.startsWith("/pos/");
  const isStoreActive = location.pathname === "/shop" || location.pathname.startsWith("/shop/");
  const posLabel = "نقطة البيع";
  const searchQuery = normalizeSearchText(sidebarSearch);
  const activeGroupTitle = useMemo(() => {
    const activeGroup = groupedSections.find((group) => group.items.some((item) => sidebarItemActive(item, location)));
    return activeGroup?.title || "";
  }, [groupedSections, location]);
  const visibleGroupedSections = useMemo(() => {
    if (!searchQuery) return groupedSections;
    return groupedSections
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => sidebarItemMatchesSearch(item, group.title, searchQuery)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groupedSections, searchQuery]);
  const sidebarCompact = sidebarCollapsed && !mobileDrawerOpen;
  const CollapseIcon = isRtl
    ? sidebarCollapsed ? PanelRightOpen : PanelRightClose
    : sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  useEffect(() => {
    writeSidebarJson(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    writeSidebarJson(SIDEBAR_GROUPS_STORAGE_KEY, openGroups);
  }, [openGroups]);

  useEffect(() => {
    if (!activeGroupTitle) return;
    setOpenGroups((current) => (current?.[activeGroupTitle] ? current : { ...current, [activeGroupTitle]: true }));
  }, [activeGroupTitle]);

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
      <NotificationSoundProvider>
        <NotificationsProvider>
          <div
            dir={dir}
            className="h-screen w-screen overflow-hidden bg-slate-950 text-[var(--text)]"
          >
            <Outlet />
          </div>
        </NotificationsProvider>
      </NotificationSoundProvider>
    );
  }

  return (
    <NotificationSoundProvider>
    <NotificationsProvider>
    <div
      dir={dir}
      className={[
        "min-h-screen w-full max-w-none overflow-x-hidden bg-[var(--bg)] text-[var(--text)] transition-all duration-300",
        "lg:grid",
        sidebarCollapsed
          ? "lg:grid-cols-[clamp(80px,5vw,96px)_minmax(0,1fr)]"
          : "lg:grid-cols-[clamp(260px,18vw,340px)_minmax(0,1fr)]",
      ].join(" ")}
    >
      {mobileDrawerOpen ? (
        <button
          type="button"
          aria-label={t("common.close", "إغلاق")}
          onClick={() => setMobileDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      ) : null}

      <aside
        className={[
          "sidebar-scroll fixed bottom-0 top-0 z-50 flex w-[min(85vw,340px)] flex-col overflow-y-auto overflow-x-hidden bg-[var(--surface)] shadow-2xl transition-all duration-300 lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:w-full lg:translate-x-0",
          sidebarCollapsed ? "p-3 lg:p-3" : "p-4 lg:p-4",
          mobileDrawerOpen ? "translate-x-0" : isRtl ? "translate-x-full" : "-translate-x-full",
          isRtl
            ? "left-auto right-0 border-l border-[var(--border)]"
            : "left-0 right-auto border-r border-[var(--border)]",
        ].join(" ")}
      >
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <WorkspaceBrandMark name={workspaceName} logoUrl={workspaceLogoUrl} className="h-10 w-10 rounded-2xl text-xs" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">MONE</div>
              <div className="truncate text-sm font-bold text-[var(--text)]">{workspaceName}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(false)}
            className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text)]"
            aria-label={t("common.close", "إغلاق")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className={["mb-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm", sidebarCompact ? "hidden p-2 lg:block" : "p-3"].join(" ")}>
            <div className={["flex items-center gap-2", sidebarCompact ? "justify-center" : "justify-between"].join(" ")}>
              <div className={["flex min-w-0 items-center gap-3", sidebarCompact ? "justify-center" : ""].join(" ")}>
                <WorkspaceBrandMark name={workspaceName} logoUrl={workspaceLogoUrl} className="h-11 w-11 rounded-2xl bg-[var(--surface-soft)]" />
                <div className="min-w-0">
                  <h1 className={["truncate font-black tracking-tight text-[var(--text)]", sidebarCompact ? "text-center text-lg" : "text-2xl"].join(" ")}>{workspaceName}</h1>
                  {sidebarCompact ? null : <p className="mt-0.5 truncate text-xs text-[var(--muted)]">Workspace</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarCollapsed((value) => !value)}
                className="hidden h-8 w-8 shrink-0 place-items-center rounded-xl border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text)] lg:grid"
                title={sidebarCollapsed ? "توسيع الشريط الجانبي" : "طي الشريط الجانبي"}
                aria-label={sidebarCollapsed ? "توسيع الشريط الجانبي" : "طي الشريط الجانبي"}
              >
                <CollapseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className={sidebarCompact ? "hidden lg:block" : ""}>
            <label className="relative mb-3 block">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={sidebarSearch}
                onChange={(event) => setSidebarSearch(event.target.value)}
                placeholder="ابحث في الوحدات..."
                className="h-10 w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] ps-9 pe-3 text-sm font-semibold text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:bg-[var(--surface-soft)]"
              />
            </label>
          </div>

          <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pe-1" aria-label={t("common.mainNavigation", "التنقل الرئيسي")}>
            {visibleGroupedSections.length ? visibleGroupedSections.map((group) => {
              const isOpen = Boolean(searchQuery || openGroups[group.title] || activeGroupTitle === group.title);
              const groupLabel = ARABIC_GROUP_LABELS[group.title] || group.title;
              const activeInGroup = group.items.some((item) => sidebarItemActive(item, location));
              const rootItems = [];
              const nestedSections = [];
              group.items.forEach((item) => {
                const subgroupTitle = sidebarSubgroupForItem(group.title, item);
                if (!subgroupTitle) {
                  rootItems.push(item);
                  return;
                }
                let nestedSection = nestedSections.find((section) => section.title === subgroupTitle);
                if (!nestedSection) {
                  nestedSection = { title: subgroupTitle, items: [] };
                  nestedSections.push(nestedSection);
                }
                nestedSection.items.push(item);
              });
              return (
                <div key={group.title} className="rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setOpenGroups((current) => ({ ...current, [group.title]: !current?.[group.title] }))}
                    className={[
                      "flex w-full items-center rounded-xl text-xs font-black uppercase tracking-[0.16em] transition",
                      sidebarCompact ? "justify-center px-2 py-2" : "gap-2 px-2 py-2",
                      activeInGroup ? "text-[var(--primary)]" : "text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--text)]",
                    ].join(" ")}
                    title={sidebarCompact ? groupLabel : undefined}
                    aria-expanded={isOpen}
                  >
                    {sidebarCompact ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <span className="min-w-0 flex-1 truncate text-start">{groupLabel}</span>}
                    {sidebarCompact ? null : <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />}
                  </button>
                  <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                    <div className="min-h-0 overflow-hidden">
                      <div className="space-y-1 py-0.5">
                        {rootItems.map((item) => (
                          <SidebarNavItem key={item.to} item={item} location={location} collapsed={sidebarCompact} onNavigate={() => setMobileDrawerOpen(false)} />
                        ))}
                        {nestedSections.map((nestedSection) => {
                          const nestedKey = `nested:${group.title}:${nestedSection.title}`;
                          const nestedTitle = ARABIC_SUBGROUP_LABELS[nestedSection.title] || nestedSection.title;
                          const nestedOpen = Boolean(searchQuery || (openGroups[nestedKey] ?? true));
                          const nestedActive = nestedSection.items.some((item) => sidebarItemActive(item, location));
                          return (
                            <div key={nestedKey} className={sidebarCompact ? "space-y-1" : "rounded-xl border border-[var(--border)]/70 bg-[var(--card)]/45 p-1"}>
                              <button
                                type="button"
                                onClick={() => setOpenGroups((current) => ({ ...current, [nestedKey]: !nestedOpen }))}
                                className={[
                                  "flex w-full items-center rounded-lg text-[11px] font-black uppercase tracking-[0.14em] transition",
                                  sidebarCompact ? "justify-center px-2 py-2" : "gap-2 px-2 py-1.5",
                                  nestedActive ? "text-[var(--primary)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]",
                                ].join(" ")}
                                title={sidebarCompact ? nestedTitle : undefined}
                                aria-expanded={nestedOpen}
                              >
                                {sidebarCompact ? <span className="h-1 w-1 rounded-full bg-current" /> : <span className="min-w-0 flex-1 truncate text-start">{nestedTitle}</span>}
                                {sidebarCompact ? null : <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${nestedOpen ? "rotate-180" : ""}`} />}
                              </button>
                              <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${nestedOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                                <div className="min-h-0 overflow-hidden">
                                  {nestedSection.title === "System Settings" && !sidebarCompact ? (
                                    <div className="mx-1 mb-1 rounded-lg border border-[var(--border)]/70 bg-[var(--surface)]/70 px-2 py-1.5">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
                                          <User className="h-3.5 w-3.5" />
                                        </span>
                                        <div className="min-w-0">
                                          <div className="truncate text-xs font-black text-[var(--text)]">{user?.name}</div>
                                          <div className="truncate text-[10px] font-semibold capitalize text-[var(--muted)]">{String(user?.role || "admin")}</div>
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                  <div className="space-y-1 py-1">
                                    {nestedSection.items.map((item) => (
                                      <SidebarNavItem key={item.to} item={item} location={location} collapsed={sidebarCompact} onNavigate={() => setMobileDrawerOpen(false)} />
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm font-semibold text-[var(--muted)]">
                {t("sidebar.noMatchingModules", isRtl ? "لا توجد نتائج مطابقة" : "No matching modules found")}
              </div>
            )}
          </nav>
        </div>

        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <button
            type="button"
            onClick={handleLogout}
            title={sidebarCompact ? "تسجيل الخروج" : undefined}
            className={["flex w-full items-center justify-center rounded-xl bg-[var(--danger)] text-sm font-black text-white shadow-lg", sidebarCompact ? "h-10 px-2" : "gap-2 px-3 py-2"].join(" ")}
          >
            <LogOut className="h-4 w-4" />
            {sidebarCompact ? null : "تسجيل الخروج"}
          </button>
        </div>
      </aside>

      <main
        className="min-h-screen w-full min-w-0 overflow-x-hidden"
      >
        <div className="flex min-h-screen w-full min-w-0 max-w-none flex-col overflow-x-hidden">
          <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-2xl lg:top-0" style={{ "--topbar-height": "72px" }}>
            <div className="pointer-events-none absolute inset-0" aria-hidden="true" />
            <div className="relative z-10 flex items-center justify-between gap-3 px-3 py-3 sm:px-4 lg:px-6 xl:px-8 lg:py-5">
              <div className="flex min-w-0 items-center gap-3 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-[var(--text)]"
                  aria-label={t("common.openMenu", "فتح القائمة")}
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-[var(--text)]">{workspaceName}</div>
                  <div className="truncate text-xs text-[var(--muted)]">{user?.name}</div>
                </div>
              </div>

              <div className="hidden min-w-0 lg:block">
                <div className="flex items-center gap-3">
                  <WorkspaceBrandMark name={workspaceName} logoUrl={workspaceLogoUrl} className="h-12 w-12 rounded-2xl" />
                  <div className="min-w-0">
                    <h2 className="truncate text-2xl font-bold tracking-tight text-[var(--text)]">{workspaceName}</h2>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      عودة موفقة، {user?.name}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 max-w-[calc(100vw-5rem)] items-center justify-end gap-2 overflow-x-auto pointer-events-auto sm:gap-2.5 lg:max-w-none lg:gap-3 lg:overflow-visible">
                <button
                  type="button"
                  onClick={() => navigate("/shop")}
                  title="المتجر"
                  aria-label="فتح المتجر"
                  className={[
                    "group inline-flex h-11 items-center justify-center gap-2 rounded-full border px-3 text-sm font-black transition duration-200 sm:px-4",
                    "bg-zinc-950/75 text-[var(--text)] shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur",
                    isStoreActive
                      ? "border-emerald-400/55 bg-emerald-500/15 text-emerald-100 shadow-[0_0_28px_rgba(16,185,129,0.24)]"
                      : "border-emerald-400/25 hover:-translate-y-0.5 hover:border-emerald-300/50 hover:bg-emerald-500/10 hover:text-emerald-100 hover:shadow-[0_0_26px_rgba(16,185,129,0.2)]",
                  ].join(" ")}
                >
                  <ShoppingBag className="h-4 w-4 text-emerald-300 transition group-hover:text-emerald-200" />
                  <span className="hidden sm:inline">المتجر</span>
                </button>
                {headerQuickActionItems.length ? (
                  <div className="hidden min-w-0 max-w-[34vw] items-center gap-1.5 overflow-x-auto pe-1 lg:flex 2xl:max-w-none">
                    {headerQuickActionItems.map((item) => (
                      <HeaderQuickActionButton key={`header-quick-${item.to}`} item={item} location={location} />
                    ))}
                  </div>
                ) : null}
                <LanguageSwitcher compact className="shrink-0" />
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
                  aria-label="تسجيل الخروج"
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
    </NotificationSoundProvider>
  );
}

export default MainLayout;
