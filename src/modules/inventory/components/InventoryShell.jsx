import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Warehouse } from "lucide-react";

function InventoryShell({ title, subtitle, actions, tabs = [], children }) {
  const { t } = useTranslation();

  return (
    <div dir="rtl" className="min-h-screen bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_10%,transparent),transparent_32%),linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)] text-right text-[var(--text)]">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-4 py-4 lg:px-6">
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[var(--primary)]">
                <Warehouse className="h-5 w-5" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">{t("inventory.title", "المخزون")}</span>
              </div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--text)]">{title}</h1>
              <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
          {tabs.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    `rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "bg-[var(--primary)] text-white"
                        : "border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface)]"
                    }`
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export default InventoryShell;
