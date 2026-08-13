import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { ClipboardList } from "lucide-react";

function OrdersShell({ title, subtitle, actions, header, children }) {
  const { t } = useTranslation();
  const embeddedWorkspace = header === null;
  return (
    <div className={`${embeddedWorkspace ? "min-h-0" : "min-h-screen"} bg-background text-[var(--text)]`}>
      <div className={`mx-auto flex w-full flex-col ${embeddedWorkspace ? "max-w-none gap-3 p-0" : "gap-4 px-4 py-4 lg:px-6"}`}>
        {header !== undefined ? header : (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[var(--primary)]">
                <ClipboardList className="h-5 w-5" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">{t("orders.moduleEyebrow")}</span>
              </div>
              <h1 className="m1-page-title mt-2 text-[var(--text)]">{title}</h1>
              <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <NavButton to="/orders" label={t("sidebar.dashboard")} />
              <NavButton to="/orders/returns" label={t("orders.actions.createReturn")} />
              {actions}
            </div>
          </div>
        </div>
        )}
        {children}
      </div>
    </div>
  );
}

function NavButton({ to, label }) {
  return (
    <NavLink
      to={to}
      end={to === "/orders"}
      className={({ isActive }) =>
        `rounded-2xl px-4 py-2 text-sm font-semibold transition ${
          isActive ? "bg-[var(--primary)] text-[var(--primary-contrast)]" : "border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface)]"
        }`
      }
    >
      {label}
    </NavLink>
  );
}

export default OrdersShell;
