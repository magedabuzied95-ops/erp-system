import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getAccountingNavigation } from "../lib/accountingNavigation";
import "./financeMobile.css";

export default function AccountingShell({ title, subtitle, actions, children }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const effectiveTabs = getAccountingNavigation(isArabic);
  const navRef = useRef(null);
  const { pathname } = useLocation();

  // The section bar is a horizontal scroller on phones; bring the current section into
  // view so the reader can see where they are without swiping for it.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.left >= navBox.left && box.right <= navBox.right) return;
    nav.scrollLeft += box.left - navBox.left - (navBox.width - box.width) / 2;
  }, [pathname]);

  return (
    <div className="m1-finance-root space-y-6 max-md:space-y-4">
      <div className="flex flex-col gap-4 max-md:gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--primary)]/70 max-md:hidden">{t("accounting.shell.eyebrow")}</div>
          <h1 className="m1-display mt-2 text-[var(--text)] max-md:mt-0">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] max-md:mt-1 max-md:line-clamp-2">{subtitle}</p> : null}
        </div>
        {/* Phones: one horizontally scrollable row of actions instead of a wrapping
            block of buttons that pushes the data off the first screen. */}
        {actions ? (
          <div className="flex flex-wrap gap-2 max-md:-mx-1 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-1 max-md:pb-1 max-md:[-webkit-overflow-scrolling:touch] max-md:[&>*]:min-h-10 max-md:[&>*]:shrink-0">
            {actions}
          </div>
        ) : null}
      </div>

      <nav ref={navRef} aria-label={isArabic ? "أقسام الحسابات" : "Accounting sections"} className="sticky top-2 z-20 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]/95 p-2 shadow-2xl shadow-[var(--shadow)] backdrop-blur max-md:p-1 max-md:shadow-none max-md:[-webkit-overflow-scrolling:touch]">
        <div className="flex min-w-max gap-2">
        {effectiveTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              [
                "rounded-2xl px-4 py-2 text-sm font-semibold transition max-md:px-3 max-md:py-2.5",
                isActive ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--text)]",
              ].join(" ")
            }
          >
            {tab.label}
          </NavLink>
        ))}
        </div>
      </nav>

      {children}
    </div>
  );
}
