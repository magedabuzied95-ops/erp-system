import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function AccountingShell({ title, subtitle, actions, tabs = [], children }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const effectiveTabs = tabs.some((tab) => tab.to === "/accounting/analytics")
    ? tabs
    : [...tabs, { to: "/accounting/analytics", label: isArabic ? "التحليلات المتقدمة" : "Advanced analytics" }];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--primary)]/70">{t("accounting.shell.eyebrow")}</div>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{subtitle}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <div className="flex flex-wrap gap-2 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl shadow-[var(--shadow)]">
        {effectiveTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              [
                "rounded-2xl px-4 py-2 text-sm font-semibold transition",
                isActive ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--text)]",
              ].join(" ")
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {children}
    </div>
  );
}
