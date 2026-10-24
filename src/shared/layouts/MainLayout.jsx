import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { Bell, Boxes, ChevronDown, CircleDollarSign, LogOut, Menu, Moon, MoreVertical, Paintbrush, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Search, Settings2, ShieldCheck, ShoppingBag, Store, Sun, User, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { clearAuth, getCurrentTenant, getCurrentUser, getToken, isMetaReviewerUser } from "../auth/authStorage";
import { getVisibleSidebarSections } from "../../modules/permissions/lib/rbacStore";
import { translateSidebarSections } from "../../i18n/navigation";
import NotificationSoundProvider from "../../components/feedback/NotificationSoundProvider";
import AnimatedBadgeCounter from "../../components/feedback/AnimatedBadgeCounter";
import SidebarPulseIndicator from "../../components/feedback/SidebarPulseIndicator";
import usePageTitle from "../hooks/usePageTitle";
import useInboxPrefetch from "../hooks/useInboxPrefetch";
import useDismissableLayer from "../hooks/useDismissableLayer";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { NotificationBoundary, NotificationsProvider, useNotifications } from "../notifications/index.js";
import { useRealtimeConnection } from "../realtime/socketStore";
import { publicStorefrontUrl } from "../lib/publicStorefront";
import { resolveErpRoutePageTitle } from "../navigation/routePageTitles";
import { useTheme } from "../../theme/useTheme";
import CommandPalette, { CommandPaletteTrigger, openCommandPalette, publishCommandPaletteState } from "../components/CommandPalette";
import { matchSidebarPath, recordPageVisit } from "../navigation/recentPages";
import MessageNotificationsBell from "../sideChat/MessageNotificationsBell";
import SideChatPanel from "../sideChat/SideChatPanel";
import { useSideChat } from "../sideChat/sideChatStore";
import "./MainLayout.m1.css";
import "./AiMarketing.m1.css";

const NotificationBell = lazy(() => import("../notifications/NotificationBell.jsx"));
const SIDEBAR_GROUPS_STORAGE_KEY = "erp.sidebar.openGroups.v2";
const SIDEBAR_AUTO_HIDE_STORAGE_KEY = "erp.sidebar.autoHide";

const ENTERPRISE_GROUPS = [
  "Main",
  "Sales",
  "Operations",
  "Products & Inventory",
  "Purchasing",
  "Employees",
  "Reports",
  "Finance",
  "AI & Marketing",
  "System Settings",
];

const GROUP_TITLE_KEYS = {
  Main: "sidebar.groups.main",
  Sales: "sidebar.groups.sales",
  Operations: "sidebar.groups.operations",
  "Products & Inventory": "sidebar.groups.productsInventory",
  Purchasing: "sidebar.groups.purchasing",
  Employees: "sidebar.groups.employees",
  Reports: "sidebar.groups.reports",
  Finance: "sidebar.groups.finance",
  "AI & Marketing": "sidebar.groups.aiMarketing",
  "System Settings": "sidebar.groups.systemSettings",
};

const HEADER_QUICK_ACTION_ROUTES = ["/orders", "/products/add", "/products", "/marketing/ai-center"];
const QUICK_ACCESS_LABELS = {
  "/orders": "sidebar.quickAccess.orders",
  "/products/add": "sidebar.quickAccess.product",
  "/marketing/ai-center": "sidebar.quickAccess.aiCenter",
  "/products": "sidebar.quickAccess.products",
};
const SIDEBAR_SUBGROUP_TITLE_KEYS = {
  "AI Marketing": "sidebar.subgroups.aiMarketing",
  "AI Support": "sidebar.subgroups.aiSupport",
  "System Settings": "sidebar.subgroups.systemSettings",
};

const SYSTEM_PREFERENCE_ROUTES = new Set(["/settings", "/settings/appearance", "/settings/site-studio", "/settings/company", "/settings/storefront", "/settings/shipping", "/settings/payments"]);
const SETTINGS_CENTER_SIDEBAR_HIDE_ROUTES = new Set([
  "/settings/company",
  "/settings/currencies",
  "/settings/storefront",
  "/settings/shipping",
  "/settings/payments",
]);
const SETTINGS_CENTER_ACTIVE_ROUTES = new Set([
  "/settings",
  "/settings/company",
  "/settings/currencies",
  "/settings/storefront",
  "/settings/shipping",
  "/settings/payments",
]);
const AI_MARKETING_ROUTES = new Set(["/marketing/ai-center", "/marketing/ai-center/leads", "/marketing/ai-center/videos", "/admin/ai-inbox", "/admin/ai-followups", "/admin/ai-agent-analytics"]);
const AI_SUPPORT_ROUTES = new Set(["/admin/ai-support-console", "/admin/ai-support-knowledge-base", "/admin/ai-agent-settings"]);
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
  "/settings/site-studio",
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

const groupForSidebarItem = (sectionTitle, item) => {
  const to = String(item.to || "");

  // Everything under /reports belongs to the Reporting Center group, wherever the
  // permission matrix happens to have declared it.
  if (to === "/reports" || to.startsWith("/reports/")) return "Reports";
  if (to === "/dashboard" || to === "/workspace" || to === "/notifications") return "Main";
  if (to === "/pos" || to === "/orders" || to === "/orders?channel=website" || to === "/orders/returns" || to === "/customers") return "Sales";
  if (to === "/operations/shipping") return "Operations";
  if (to === "/products" || to === "/products/add" || to === "/inventory" || to === "/inventory/count" || to === "/warehouses" || to === "/stock-transfers") return "Products & Inventory";
  if (to === "/purchases" || to === "/suppliers") return "Purchasing";
  if (to === "/employees" || to.startsWith("/employees/")) return "Employees";
  if (to === "/accounting" || to === "/expenses") return "Finance";
  if (to === "/marketing/ai-center" || to === "/admin/ai-inbox" || to === "/admin/ai-followups" || to === "/admin/ai-agent-analytics" || to === "/admin/ai-support-knowledge-base" || to === "/admin/ai-agent-settings") return "AI & Marketing";
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
      if (item.to === "/settings" || item.to === "/settings/appearance" || item.to === "/settings/site-studio" || item.to === "/settings/company" || item.to === "/settings/storefront" || item.to === "/settings/shipping" || item.to === "/settings/payments") canAccessSettings = true;
      if (SETTINGS_CENTER_SIDEBAR_HIDE_ROUTES.has(String(item.to || ""))) return;
      const key = item.to || `${section.title}:${item.label}`;
      if (seen.has(key)) return;
      seen.add(key);
      const groupTitle = groupForSidebarItem(section.sourceTitle || section.title, item);
      const sidebarLabelKey = item.to === "/settings/appearance"
        ? "sidebar.appearance"
        : item.to === "/settings/site-studio"
          ? "sidebar.siteStudio"
        : item.to === "/settings"
          ? "sidebar.settingsCenter"
        : item.to === "/settings/company"
          ? "sidebar.general"
        : item.to === "/settings/storefront"
          ? "sidebar.storefrontSettings"
        : item.to === "/settings/shipping"
          ? "sidebar.shipping"
        : item.to === "/settings/payments"
          ? "sidebar.payments"
          : undefined;
      const sidebarIcon = item.to === "/settings/appearance"
        ? Paintbrush
        : item.to === "/settings/site-studio"
          ? Store
        : item.to === "/settings"
          ? Settings2
        : item.to === "/settings/company"
          ? Settings2
          : item.icon;
      byTitle.get(groupTitle)?.items.push({ ...item, icon: sidebarIcon, sidebarLabelKey, sourceSection: section.sourceTitle || section.title });
    });
  });

  const routeOrders = {
    Main: ["/dashboard", "/workspace", "/notifications"],
    Sales: ["/pos", "/orders", "/orders?channel=website", "/orders/returns", "/customers"],
    Operations: ["/operations/shipping"],
    "Products & Inventory": ["/products", "/products/add", "/inventory", "/inventory/count", "/warehouses", "/stock-transfers"],
    Purchasing: ["/purchases", "/suppliers"],
    Employees: ["/employees", "/employees/attendance"],
    // Current Reporting Center first, in the order a manager reads them; the legacy page
    // stays reachable but sits last so it never reads as the primary report.
    Reports: [
      "/reports/overview",
      "/reports/sales",
      "/reports/inventory",
      "/reports/purchasing",
      "/reports/customers",
      "/reports/employees",
      "/reports/reconciliation",
      "/reports/channels",
      "/reports/coupons",
      "/reports",
    ],
    Finance: ["/accounting", "/expenses"],
    "AI & Marketing": ["/admin/ai-inbox", "/marketing/ai-center", "/admin/ai-followups", "/admin/ai-agent-analytics", "/admin/ai-support-knowledge-base", "/admin/ai-agent-settings"],
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

function SidebarNavItem({ item, location, onNavigate }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const active = sidebarItemActive(item, location);
  const displayLabel = item.sidebarLabelKey ? t(item.sidebarLabelKey) : item.label;
  const className = [
    "group/nav relative flex min-h-9 items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-semibold transition duration-200",
    active
      ? "border-[var(--primary)]/45 bg-[var(--primary-soft)] text-[var(--primary)] shadow-sm"
      : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--card)] hover:text-[var(--text)]",
  ].join(" ");
  if (item.external) {
    return (
      <a
        key={item.to}
        href={item.to}
        target="_blank"
        rel="noreferrer"
        aria-label={displayLabel}
        onClick={onNavigate}
        className={className}
      >
        {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
        <span className="min-w-0 flex-1 truncate text-start">{displayLabel}</span>
        <span className="ms-auto flex items-center gap-1.5">
          <SidebarNotificationBadge item={item} />
          <SidebarPulseIndicator item={item} />
        </span>
      </a>
    );
  }
  return (
    <NavLink
      key={item.to}
      to={item.to}
      aria-current={active ? "page" : "false"}
      aria-label={displayLabel}
      onClick={onNavigate}
      className={className}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate text-start">{displayLabel}</span>
      <span className="ms-auto flex items-center gap-1.5">
        <SidebarNotificationBadge item={item} />
        <SidebarPulseIndicator item={item} />
      </span>
    </NavLink>
  );
}

function HeaderQuickActionButton({ item, location, onNavigate }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const active = sidebarItemActive(item, location);
  const labelKey = QUICK_ACCESS_LABELS[item.to];
  const label = labelKey ? t(labelKey) : item.sidebarLabelKey ? t(item.sidebarLabelKey) : item.label;
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

// Phone (<768px) page-bar overflow: the bar keeps the menu button, the page
// title, search and the message bell; theme, language and logout live in this
// sheet. Portaled to <body>: iOS clips position:fixed descendants of a scroller.
function PhoneTopbarMenu({ items = [], onLogout }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const location = useLocation();
  useDismissableLayer({ enabled: open, onDismiss: () => setOpen(false), refs: [buttonRef, panelRef] });
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  const rowClass = "flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-start text-sm font-bold text-[var(--text)] hover:bg-[var(--surface-soft)]";
  return (
    <div className="relative flex-none md:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("common.actions")}
        title={t("common.actions")}
        className="m1-shell-theme-toggle inline-flex h-[var(--control-height-md)] w-10 items-center justify-center border border-[var(--border)] text-[var(--topbar-text)]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={panelRef}
          role="menu"
          dir={document.documentElement.dir === "rtl" ? "rtl" : "ltr"}
          className="m1-phone-topbar-menu fixed z-[9999] flex flex-col gap-0.5 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-1.5 text-[var(--text)] shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
        >
          {items.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                {Icon ? <Icon className="h-4 w-4 shrink-0 text-[var(--primary)]" /> : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </>
            );
            if (item.href) {
              return (
                <a key={item.key} role="menuitem" href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={rowClass}>
                  {content}
                </a>
              );
            }
            if (item.to) {
              return (
                <NavLink key={item.key} role="menuitem" to={item.to} onClick={() => setOpen(false)} className={rowClass}>
                  {content}
                </NavLink>
              );
            }
            return (
              <button key={item.key} role="menuitem" type="button" onClick={() => { setOpen(false); item.onSelect?.(); }} className={rowClass}>
                {content}
              </button>
            );
          })}
          <div className="my-1 border-t border-[var(--border)]" />
          <div className="px-1 py-1">
            <LanguageSwitcher className="w-full justify-between" />
          </div>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout?.(); }} className={`${rowClass} text-[var(--danger)]`}>
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("common.logout")}</span>
          </button>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function NotificationBellFallback() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="relative inline-flex h-[var(--control-height-lg)] w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] opacity-70 shadow-sm"
      aria-label={t("notifications.bell.title")}
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
    <div className="hidden h-11 items-center justify-center gap-2 rounded-full border border-primary/25 bg-zinc-950/75 px-3 text-sm font-black text-primary shadow-[0_10px_30px_rgba(0,0,0,0.18),0_0_22px_rgba(34,211,238,0.12)] backdrop-blur sm:flex sm:px-4">
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.85)]" : "bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.75)]"}`} />
      <span className="hidden md:inline">{connected ? label : t("common.reconnecting")}</span>
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
  const normalizedName = String(name || "").trim();
  const normalizedLogoUrl = String(logoUrl || "").trim();
  const isMOneBrand =
    /(?:^|\s)m\s*(?:1|one)(?:\s|$)/i.test(normalizedName) ||
    /\bmone\b/i.test(normalizedName.replace(/\s+/g, "")) ||
    /\/branding\/m-one-(?:logo|wordmark)-/i.test(normalizedLogoUrl);

  return (
    <div className={["flex shrink-0 items-center justify-center overflow-hidden border border-[var(--border)] bg-[var(--card)] text-sm font-black text-[var(--text)]", isMOneBrand ? "m1-workspace-logo" : "", className].join(" ")}>
      {isMOneBrand ? (
        <span className="relative block h-full w-full" aria-label={name || "M1 Store"} role="img">
          <img
            src="/branding/m-one-logo-white-fixed.png?v=20260716"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-contain p-1.5"
            draggable="false"
          />
          <img
            src="/branding/m-one-logo-white-m.png?v=20260716"
            alt=""
            aria-hidden="true"
            className="m1-workspace-logo__moving-m absolute inset-0 h-full w-full object-contain p-1.5"
            draggable="false"
          />
        </span>
      ) : logoUrl && !failed ? (
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
  const { theme, setTheme } = useTheme();
  usePageTitle(resolveErpRoutePageTitle(location.pathname));
  const [user, setUser] = useState(() => getCurrentUser() || { name: "Admin", role: "Admin", permissions: ["*"] });
  const reviewerShell = isMetaReviewerUser(user);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // Desktop only: the sidebar folds into a thin edge strip and slides over the
  // page while the pointer rests on it. Pinning brings back the fixed column.
  const [sidebarAutoHide, setSidebarAutoHide] = useState(() => Boolean(readSidebarJson(SIDEBAR_AUTO_HIDE_STORAGE_KEY, true)));
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const sidebarPeekTimerRef = useRef(0);
  const sidebarRef = useRef(null);
  const [openGroups, setOpenGroups] = useState(() => readSidebarJson(SIDEBAR_GROUPS_STORAGE_KEY, {}));
  const [sidebarSearch, setSidebarSearch] = useState("");
  const sidebarSearchInputRef = useRef(null);
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

  // The inbox hides this topbar on every width and carries its own menu button.
  useEffect(() => {
    const openDrawer = () => setMobileDrawerOpen(true);
    window.addEventListener("erp:open-nav-drawer", openDrawer);
    return () => window.removeEventListener("erp:open-nav-drawer", openDrawer);
  }, []);

  useEffect(() => {
    const refreshUser = () => setUser(getCurrentUser() || { name: "Admin", role: "Admin", permissions: ["*"] });
    window.addEventListener("erp:auth-user-updated", refreshUser);
    return () => window.removeEventListener("erp:auth-user-updated", refreshUser);
  }, []);

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
  // Quick search (Ctrl K) + the last two pages: every page this user's sidebar shows.
  const paletteItems = useMemo(() => {
    const seen = new Set();
    return sections.flatMap((section) => section.items.map((item) => ({ to: item.to, label: item.label, section: section.title, icon: item.icon })))
      .filter((item) => item.to && !seen.has(item.to) && seen.add(item.to));
  }, [sections]);
  const paletteUserId = String(user?.id || user?.email || "");
  const currentSidebarPath = useMemo(() => matchSidebarPath(location.pathname, paletteItems.map((item) => item.to)), [location.pathname, paletteItems]);
  // The page bar's title: the sidebar entry this page belongs to (translated), else
  // the route's own title, else the workspace.
  const pageTitle = paletteItems.find((item) => item.to === currentSidebarPath)?.label
    || resolveErpRoutePageTitle(location.pathname)
    || workspaceName;
  useEffect(() => {
    if (currentSidebarPath) recordPageVisit(paletteUserId, currentSidebarPath);
  }, [currentSidebarPath, paletteUserId]);
  useEffect(() => {
    publishCommandPaletteState({ items: paletteItems, userId: paletteUserId, currentPath: currentSidebarPath });
  }, [currentSidebarPath, paletteItems, paletteUserId]);
  const resolvedDir = typeof i18n.dir === "function" ? i18n.dir(i18n.language) : "";
  const documentDir = typeof document !== "undefined" ? document.documentElement.dir : "";
  const dir = (resolvedDir || documentDir) === "rtl" ? "rtl" : "ltr";
  const isRtl = dir === "rtl";
  const isPosActive = location.pathname === "/pos" || location.pathname.startsWith("/pos/");
  const isAiMarketingWorkspace = location.pathname.startsWith("/marketing") || location.pathname.startsWith("/admin/ai-");
  const isAiInboxWorkspace = location.pathname === "/admin/ai-inbox";
  // Genie's chat-from-a-notification: the open conversation docks as a third
  // shell column and the page narrows to make room (MainLayout.m1.css).
  const sideChat = useSideChat();
  const sideChatOpen = Boolean(sideChat.open);
  // The bell belongs to whoever can open the inbox at all.
  const canSeeInbox = reviewerShell || paletteItems.some((item) => item.to === "/admin/ai-inbox");
  const workspacePreloadRoutes = reviewerShell ? '' : ['/pos', '/dashboard', '/orders', '/products', '/purchases', '/google-ads', '/meta-ads', '/tiktok-ads'].filter((to) => paletteItems.some((item) => item.to === to)).join(',');
  useInboxPrefetch({
    enabled: !reviewerShell && (canSeeInbox || Boolean(workspacePreloadRoutes)),
    inboxEnabled: canSeeInbox && !reviewerShell,
    workspaceRoutes: workspacePreloadRoutes,
    pathname: location.pathname,
    identityKey: `${user?.id || ''}:${currentTenant?.id || currentTenant?.tenant_id || user?.tenant_id || user?.tenantId || ''}`,
  });
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
  const sidebarHidden = sidebarAutoHide && !sidebarPeek;
  // The resting rail shows every module icon, whichever groups are folded.
  const railSidebarItems = useMemo(() => {
    if (!sidebarHidden) return [];
    const seen = new Set();
    return visibleGroupedSections
      .flatMap((group) => group.items)
      .filter((item) => {
        const key = String(item?.to || item?.label || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [sidebarHidden, visibleGroupedSections]);
  const PinIcon = isRtl
    ? sidebarAutoHide ? PanelRightOpen : PanelRightClose
    : sidebarAutoHide ? PanelLeftOpen : PanelLeftClose;

  useEffect(() => {
    writeSidebarJson(SIDEBAR_AUTO_HIDE_STORAGE_KEY, sidebarAutoHide);
  }, [sidebarAutoHide]);

  useEffect(() => () => window.clearTimeout(sidebarPeekTimerRef.current), []);

  const scheduleSidebarPeek = (open, delay) => {
    window.clearTimeout(sidebarPeekTimerRef.current);
    sidebarPeekTimerRef.current = window.setTimeout(() => setSidebarPeek(open), delay);
  };

  const closeSidebarPeek = () => {
    if (!sidebarAutoHide) return;
    // Typing in the module search must not fold the panel away under the cursor.
    const focused = typeof document !== "undefined" ? document.activeElement : null;
    if (focused && focused === sidebarSearchInputRef.current) return;
    scheduleSidebarPeek(false, 280);
  };

  const toggleSidebarAutoHide = () => {
    window.clearTimeout(sidebarPeekTimerRef.current);
    setSidebarPeek(false);
    setSidebarAutoHide((value) => !value);
  };

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
        setSidebarPeek(false);
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

  // While the ERP shell is on screen: (1) viewport-fit=cover, so WebKit reports
  // env(safe-area-inset-*) and the topbar / drawer / gutter can clear the notch
  // and home bar of an installed PWA (index.html sets it before first paint for
  // a cold start; this covers arriving from /login in-app); (2) html.m1-erp-shell,
  // which scopes the phone-only 16px field rule (MainLayout.m1.css) to the ERP —
  // portaled dialogs and menus included — and keeps it off the storefront.
  useEffect(() => {
    if (isPosActive || typeof document === "undefined") return undefined;
    const root = document.documentElement;
    root.classList.add("m1-erp-shell");
    const viewport = document.querySelector('meta[name="viewport"]');
    const content = viewport ? String(viewport.getAttribute("content") || "") : "";
    const added = Boolean(viewport) && content.indexOf("viewport-fit") === -1;
    if (added) viewport.setAttribute("content", `${content}, viewport-fit=cover`);
    return () => {
      root.classList.remove("m1-erp-shell");
      if (added) viewport.setAttribute("content", content);
    };
  }, [isPosActive]);

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  // Set at sign-in when the password is weak or close to its 365-day expiry.
  const [passwordNotice, setPasswordNotice] = useState(() => {
    try {
      return sessionStorage.getItem("m1-password-notice") || "";
    } catch {
      return "";
    }
  });
  const dismissPasswordNotice = () => {
    try {
      sessionStorage.removeItem("m1-password-notice");
    } catch {
      // Banner only.
    }
    setPasswordNotice("");
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
        "m1-shell-root min-h-screen w-full max-w-none overflow-x-hidden bg-[var(--bg)] text-[var(--text)] transition-all duration-300",
        sidebarAutoHide ? "m1-shell-root--sidebar-autohide" : "",
        isAiMarketingWorkspace ? "m1-ai-marketing-scope" : "",
        sideChatOpen ? "m1-shell-root--side-chat" : "",
        sideChatOpen && sideChat.collapsed ? "m1-shell-root--side-chat-collapsed" : "",
        sideChatOpen && sideChat.resizing ? "m1-shell-root--side-chat-resizing" : "",
        "lg:grid",
      ].join(" ")}
      // The dragged width; the folded rail keeps its own width from the class.
      style={sideChatOpen && !sideChat.collapsed ? { "--side-chat-width": `${sideChat.width}px` } : undefined}
    >
      {mobileDrawerOpen ? (
        <button
          type="button"
          aria-label={t("common.close", "إغلاق")}
          onClick={() => setMobileDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      ) : null}

      {/* The auto-hide sidebar is fixed, so this holds its rail's grid column. */}
      {sidebarAutoHide ? <div className="hidden lg:block" aria-hidden="true" /> : null}

      <aside
        ref={sidebarRef}
        data-sidebar-rail={sidebarHidden ? "true" : undefined}
        onMouseEnter={sidebarAutoHide ? () => scheduleSidebarPeek(true, 120) : undefined}
        onMouseLeave={sidebarAutoHide ? closeSidebarPeek : undefined}
        onFocus={sidebarAutoHide ? () => scheduleSidebarPeek(true, 0) : undefined}
        onBlur={sidebarAutoHide ? (event) => {
          if (!sidebarRef.current?.contains(event.relatedTarget) && !sidebarRef.current?.matches(":hover")) scheduleSidebarPeek(false, 0);
        } : undefined}
        className={[
          "m1-shell-sidebar sidebar-scroll fixed bottom-0 top-0 z-50 flex w-[min(85vw,340px)] flex-col overflow-hidden bg-[var(--surface)] p-4 shadow-2xl transition-all duration-300",
          sidebarAutoHide
            ? ["m1-shell-sidebar--autohide lg:fixed lg:z-50 lg:h-screen lg:translate-x-0", sidebarHidden ? "m1-shell-sidebar--rail" : "m1-shell-sidebar--peek"].join(" ")
            : "lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:w-full lg:translate-x-0",
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
            className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text)]"
            aria-label={t("common.close", "إغلاق")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="m1-sidebar-brand mb-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <WorkspaceBrandMark name={workspaceName} logoUrl={workspaceLogoUrl} className="h-11 w-11 rounded-2xl bg-[var(--surface-soft)]" />
                <div className="m1-sidebar-fade min-w-0">
                  <h1 className="truncate text-2xl font-black tracking-tight text-[var(--text)]">{workspaceName}</h1>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{t("sidebar.workspace")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleSidebarAutoHide}
                aria-pressed={!sidebarAutoHide}
                className="m1-sidebar-fade hidden h-[var(--control-height-sm)] w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text)] lg:grid"
                title={sidebarAutoHide ? t("sidebar.pin") : t("sidebar.autoHide")}
                aria-label={sidebarAutoHide ? t("sidebar.pin") : t("sidebar.autoHide")}
              >
                <PinIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <label className="relative mb-3 block">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              ref={sidebarSearchInputRef}
              value={sidebarSearch}
              onChange={(event) => setSidebarSearch(event.target.value)}
              placeholder={t("sidebar.searchModules")}
              className="h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] ps-9 pe-3 text-sm font-semibold text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:bg-[var(--surface-soft)]"
            />
          </label>

          <nav
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pe-1"
            aria-label={t("common.mainNavigation", "التنقل الرئيسي")}
          >
            {railSidebarItems.length ? (
              <div className="m1-sidebar-rail-list hidden">
                {railSidebarItems.map((item) => (
                  <SidebarNavItem key={item.to} item={item} location={location} onNavigate={() => setMobileDrawerOpen(false)} />
                ))}
              </div>
            ) : null}
            {visibleGroupedSections.length ? visibleGroupedSections.map((group) => {
              const isOpen = Boolean(searchQuery || openGroups[group.title] || activeGroupTitle === group.title);
              const groupLabel = t(GROUP_TITLE_KEYS[group.title] || group.title, { defaultValue: group.title });
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
                      "flex w-full items-center rounded-[var(--radius-control)] text-xs font-black uppercase tracking-[0.16em] transition",
                      "gap-2 px-2 py-2",
                      activeInGroup ? "text-[var(--primary)]" : "text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--text)]",
                    ].join(" ")}
                    aria-expanded={isOpen}
                  >
                    <span className="min-w-0 flex-1 truncate text-start">{groupLabel}</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                    <div className="min-h-0 overflow-hidden">
                      <div className="space-y-1 py-0.5">
                        {rootItems.map((item) => (
                          <SidebarNavItem key={item.to} item={item} location={location} onNavigate={() => setMobileDrawerOpen(false)} />
                        ))}
                        {nestedSections.map((nestedSection) => {
                          const nestedKey = `nested:${group.title}:${nestedSection.title}`;
                          const nestedTitle = t(SIDEBAR_SUBGROUP_TITLE_KEYS[nestedSection.title] || nestedSection.title, { defaultValue: nestedSection.title });
                          const nestedOpen = Boolean(searchQuery || (openGroups[nestedKey] ?? true));
                          const nestedActive = nestedSection.items.some((item) => sidebarItemActive(item, location));
                          return (
                            <div key={nestedKey} className="rounded-xl border border-[var(--border)]/70 bg-[var(--card)]/45 p-1">
                              <button
                                type="button"
                                onClick={() => setOpenGroups((current) => ({ ...current, [nestedKey]: !nestedOpen }))}
                                className={[
                                  "flex w-full items-center rounded-[var(--radius-control)] text-[11px] font-black uppercase tracking-[0.14em] transition",
                                  "gap-2 px-2 py-1.5",
                                  nestedActive ? "text-[var(--primary)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]",
                                ].join(" ")}
                                aria-expanded={nestedOpen}
                              >
                                <span className="min-w-0 flex-1 truncate text-start">{nestedTitle}</span>
                                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${nestedOpen ? "rotate-180" : ""}`} />
                              </button>
                              <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${nestedOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                                <div className="min-h-0 overflow-hidden">
                                  {nestedSection.title === "System Settings" ? (
                                    <div className="m1-sidebar-fade mx-1 mb-1 rounded-[var(--radius-card)] border border-[var(--border)]/70 bg-[var(--surface)]/70 px-2 py-1.5">
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
                                      <SidebarNavItem key={item.to} item={item} location={location} onNavigate={() => setMobileDrawerOpen(false)} />
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
              <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3 text-sm font-semibold text-[var(--muted)]">
                {t("sidebar.noMatchingModules", isRtl ? "لا توجد نتائج مطابقة" : "No matching modules found")}
              </div>
            )}
          </nav>
        </div>

        <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
          <NavLink
            to="/settings/account-security"
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-bold text-[var(--text)]"
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span className="m1-sidebar-fade truncate">{t("access.security.navLink")}</span>
          </NavLink>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--danger)] px-3 py-2 text-sm font-black text-white shadow-lg"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="m1-sidebar-fade truncate">{t("common.logout")}</span>
          </button>
        </div>
      </aside>

      <main
        className="min-h-screen w-full min-w-0 overflow-x-hidden"
      >
        <div className="flex min-h-screen w-full min-w-0 max-w-none flex-col overflow-x-hidden">
          {/* One slim bar, the inbox's look: the page's title, quick search with the
              last pages, language, theme and the message bell. Getting around is the
              search's job now (and the sidebar's), so the old quick links are gone.
              The inbox keeps its own top bar and hides this one. */}
          <header className={`m1-page-bar ${isAiInboxWorkspace ? "hidden" : ""}`}>
            <div className="m1-page-bar__inner">
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(true)}
                className="m1-page-bar__btn m1-page-bar__nav"
                aria-label={t("common.openMenu", "فتح القائمة")}
                title={t("common.openMenu", "فتح القائمة")}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="m1-page-bar__title" title={pageTitle}>{pageTitle}</div>
              <div className="m1-page-bar__tools">
                <CommandPaletteTrigger items={paletteItems} userId={paletteUserId} currentPath={currentSidebarPath} className="hidden md:flex" />
                <button
                  type="button"
                  onClick={openCommandPalette}
                  className="m1-page-bar__btn m1-page-bar__search"
                  aria-label={t("common.commandPalette.open")}
                  title={t("common.commandPalette.open")}
                >
                  <Search className="h-[18px] w-[18px]" />
                </button>
                {/* The storefront, as its icon only. */}
                <a
                  href={publicStorefrontUrl("/")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="m1-page-bar__btn m1-page-bar__store"
                  aria-label={t("sidebar.openStore")}
                  title={t("sidebar.openStore")}
                >
                  <ShoppingBag className="h-[18px] w-[18px]" />
                </a>
                <LanguageSwitcher compact className="m1-page-bar__wide shrink-0" />
                <button
                  type="button"
                  onClick={() => setTheme(theme.mode === "dark" ? "light" : "dark")}
                  className="m1-page-bar__btn m1-page-bar__wide"
                  aria-label={theme.mode === "dark" ? t("appearance.lightMode") : t("appearance.darkMode")}
                  title={theme.mode === "dark" ? t("appearance.lightMode") : t("appearance.darkMode")}
                >
                  {theme.mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
                {canSeeInbox ? <MessageNotificationsBell /> : null}
                <PhoneTopbarMenu
                  onLogout={handleLogout}
                  items={[
                    {
                      key: "theme",
                      label: theme.mode === "dark" ? t("appearance.lightMode") : t("appearance.darkMode"),
                      icon: theme.mode === "dark" ? Sun : Moon,
                      onSelect: () => setTheme(theme.mode === "dark" ? "light" : "dark"),
                    },
                  ]}
                />
              </div>
            </div>
          </header>

          <div className={isAiInboxWorkspace
            ? "m1-shell-content m1-shell-content--flush w-full max-w-none flex-1 overflow-hidden p-0"
            : "m1-shell-content w-full max-w-none flex-1 overflow-x-hidden p-3 sm:p-4 lg:p-6 xl:p-8 2xl:p-10"}>
            {passwordNotice && !isAiInboxWorkspace && location.pathname !== "/settings/account-security" ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-[var(--text)]">
                <span>{passwordNotice === "weak" ? t("access.security.weakPasswordBanner") : t("access.security.expirySoonBanner")}</span>
                <span className="flex items-center gap-2">
                  <NavLink to="/settings/account-security" className="rounded-[var(--radius-control)] bg-[var(--primary)] px-3 py-1.5 text-xs font-black text-white">
                    {t("access.security.changePassword")}
                  </NavLink>
                  <button type="button" onClick={dismissPasswordNotice} aria-label="dismiss" className="rounded-[var(--radius-control)] px-2 py-1 text-[var(--muted)]">
                    <X className="h-4 w-4" />
                  </button>
                </span>
              </div>
            ) : null}
            <Outlet />
          </div>
        </div>
      </main>
      {/* The panel is fixed to the viewport; this slot is the grid column that
          keeps the page narrowed to make room for it. */}
      {sideChatOpen ? <div className="m1-side-chat-slot hidden lg:block" aria-hidden="true" /> : null}
      <SideChatPanel />
      <CommandPalette items={paletteItems} userId={paletteUserId} currentPath={currentSidebarPath} />
    </div>
    </NotificationsProvider>
    </NotificationSoundProvider>
  );
}

export default MainLayout;
