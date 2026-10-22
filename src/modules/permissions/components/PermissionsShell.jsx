import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "../../employees/peoplePhone.css";

export default function PermissionsShell({ title, subtitle, actions, tabs = [], children }) {
  const { t } = useTranslation();
  return (
    <div className="people-phone-inputs space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--primary)]/70">{t("access.shell.title")}</div>
          <h1 className="m1-display mt-2 text-[var(--text)]">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">{actions}</div> : null}
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl shadow-[var(--shadow)] max-md:[&>a]:shrink-0 max-md:[&>a]:whitespace-nowrap md:flex-wrap">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              [
                "inline-flex min-h-10 items-center rounded-2xl px-4 py-2 text-sm font-semibold transition",
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
