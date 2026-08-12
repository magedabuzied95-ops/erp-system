import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PackageSearch } from "lucide-react";

function FlowShell({ title, subtitle, actions, tabs = [], children, compact = false, shellRef = null, wide = false }) {
  const { t } = useTranslation();
  return (
    <div ref={shellRef} className={compact ? "min-h-screen bg-[#050609] text-white" : "min-h-screen bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_10%,transparent),transparent_32%),linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)] text-[var(--text)]"}>
      <div className={`mx-auto flex w-full ${wide ? "max-w-none" : "max-w-[1800px]"} flex-col px-3 sm:px-4 lg:px-5 ${compact ? "gap-2 py-2" : "gap-4 py-4"}`}>
        <div className={`border shadow-2xl ${compact ? "rounded-2xl border-white/10 bg-zinc-950/90 p-2.5 shadow-black/20" : "rounded-3xl border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]"}`}>
          <div className={`flex flex-col xl:flex-row xl:items-center xl:justify-between ${compact ? "gap-2" : "gap-4"}`}>
            <div>
              <div className="flex items-center gap-2 text-[var(--primary)]">
                <PackageSearch className={compact ? "h-4 w-4" : "h-5 w-5"} />
                <span className={`font-semibold uppercase tracking-[0.18em] ${compact ? "text-[10px] text-emerald-300" : "text-xs"}`}>{t("purchases.moduleEyebrow")}</span>
              </div>
              <h1 className={`m1-page-title ${compact ? "mt-1 text-white" : "mt-2 text-[var(--text)]"}`}>{title}</h1>
              {subtitle ? <p className={`max-w-3xl ${compact ? "mt-0.5 text-xs text-zinc-400" : "mt-1 text-sm text-[var(--muted)]"}`}>{subtitle}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
          {tabs.length ? (
            <div className={`flex flex-wrap gap-2 ${compact ? "mt-2" : "mt-4"}`}>
              {tabs.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    `${compact ? "rounded-xl px-3 py-1.5 text-xs" : "rounded-2xl px-4 py-2 text-sm"} font-semibold transition ${
                      isActive
                        ? "bg-[var(--primary)] text-white"
                        : compact
                          ? "border border-white/10 bg-white/5 text-white hover:bg-white/10"
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

export default FlowShell;
