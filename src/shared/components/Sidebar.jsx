import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { CircleDollarSign, LogOut, Palette } from "lucide-react";

import { clearAuth, getCurrentUser } from "../auth/authStorage";
import { getVisibleSidebarSections } from "../../modules/permissions/lib/rbacStore";
import { useTheme } from "../../theme/useTheme";
import { translateSidebarSections } from "../../i18n/navigation";

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = getCurrentUser() || { name: "Admin", role: "Admin", permissions: ["*"] };
  const sections = translateSidebarSections(getVisibleSidebarSections(user), t);
  const { theme } = useTheme();

  const logout = () => {
    clearAuth();
    window.location.href = "/login";
  };

  return (
    <aside className="flex h-screen w-[clamp(260px,18vw,340px)] flex-col border-r border-[var(--border)] bg-[var(--bg)] p-5 shadow-2xl shadow-[var(--shadow)]">
      <div>
        <div className="theme-card mb-6 bg-[var(--surface)] p-5">
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
                      className={[
                        "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                        active
                          ? "border-[var(--border)] bg-[var(--primary-soft)] text-[var(--text)] shadow-lg shadow-[var(--shadow)]"
                          : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--card)] hover:text-[var(--text)]",
                      ].join(" ")}
                    >
                      {Icon ? <Icon className="h-4 w-4" /> : null}
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <div className="theme-card p-4">
          <p className="text-sm font-semibold text-[var(--text)]">{user?.name}</p>
          <p className="mt-1 text-xs capitalize text-[var(--muted)]">{String(user?.role || "admin")}</p>
        </div>

        <button
          type="button"
          onClick={() => navigate("/settings/appearance")}
          className="theme-button-soft w-full px-4 py-3 text-sm"
        >
          <Palette className="h-4 w-4" />
            {theme?.name || t("common.appearance")}
          </button>

        <button
          type="button"
          onClick={() => navigate("/settings/currencies")}
          className="theme-button-soft w-full px-4 py-3 text-sm"
        >
          <CircleDollarSign className="h-4 w-4" />
          {t("common.currency")}
        </button>

        <button
          type="button"
          onClick={logout}
          className="theme-button-primary w-full bg-[var(--danger)] px-4 py-3 text-sm font-black"
        >
          <LogOut className="h-4 w-4" />
          {t("common.logout")}
        </button>
      </div>
    </aside>
  );
}
