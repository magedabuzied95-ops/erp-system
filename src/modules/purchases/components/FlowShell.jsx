import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PackageSearch } from "lucide-react";

function FlowShell({ title, subtitle, actions, tabs = [], children, compact = false, shellRef = null, hideHeader = false, floatingActions = null }) {
  const { t } = useTranslation();
  // `compact` is a DENSITY variant, not a colour scheme. It used to hardcode a
  // near-black shell — a raw hex page background, a near-black header card,
  // white-alpha borders and white/grey text — so the whole /purchases/create
  // page rendered as a black island in the Light theme whatever mode was
  // active. Both variants now share one semantic surface ladder and differ
  // only in spacing, radius and type scale.
  return (
    <div ref={shellRef} className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className={`mx-auto flex w-full flex-col px-3 sm:px-4 lg:px-5 ${compact ? "gap-2 py-2" : "gap-4 py-4"}`}>
        {hideHeader ? (
          floatingActions ? <div className="fixed end-3 top-3 z-40 flex items-center gap-2">{floatingActions}</div> : null
        ) : (
        <div className={`rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)] ${compact ? "p-2.5" : "p-4"}`}>
          <div className={`flex flex-col xl:flex-row xl:items-center xl:justify-between ${compact ? "gap-2" : "gap-4"}`}>
            <div>
              <div className="flex items-center gap-2 text-[var(--primary)]">
                <PackageSearch className={compact ? "h-4 w-4" : "h-5 w-5"} />
                <span className={`font-semibold uppercase tracking-[0.18em] ${compact ? "text-[10px]" : "text-xs"}`}>{t("purchases.moduleEyebrow")}</span>
              </div>
              <h1 className={`m1-page-title text-[var(--text)] ${compact ? "mt-1" : "mt-2"}`}>{title}</h1>
              {subtitle ? <p className={`max-w-3xl text-[var(--muted)] ${compact ? "mt-0.5 text-xs" : "mt-1 text-sm"}`}>{subtitle}</p> : null}
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
                    `rounded-[var(--radius-control)] ${compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"} font-semibold transition ${
                      isActive
                        ? "border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-contrast)]"
                        : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)]"
                    }`
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default FlowShell;
