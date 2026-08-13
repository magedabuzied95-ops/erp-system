import { useTranslation } from "react-i18next";

/**
 * Shared shell for the Reporting Center pages.
 *
 * Two things live here rather than in each page:
 *
 * 1. Width. The ERP's global --content-max is 1480px, which suits form-and-list
 *    screens but leaves a 1920px monitor with a wide empty margin and squeezes the
 *    trend chart into ~940px. Analytics reads better wide: charts, tables and the
 *    quadrant matrix all gain from it. These pages used to step up to 1600/1680px;
 *    under the fluid-workspace ruling they now take the full workspace the shell
 *    offers, since every Reporting Center surface is operational rather than a
 *    reading view. The shell's own --page-inline still provides the page gutters.
 *    Text blocks are never stretched — only the analytical grids.
 *
 * 2. One card definition. Previously each section brought its own border, radius and
 *    padding, so a dozen containers competed at equal visual weight. Card renders the
 *    single elevated surface; Subtle renders a grouped area that reads as part of the
 *    page rather than another floating panel.
 */

export function ReportsPage({ dir, children }) {
  return (
    // No horizontal padding here: the app shell's .m1-shell-content already applies
    // --page-inline, and adding it again cost 60px of chart width on a 1920 monitor
    // for no visual gain.
    <div dir={dir} className="min-h-full bg-[var(--bg)] py-5">
      {/* Fluid: the analytics grids use the room a large monitor actually has. */}
      <div className="mx-auto w-full">
        {children}
      </div>
    </div>
  );
}

/** Page title + subtitle + toolbar. */
export function ReportsHeader({ title, subtitle, children }) {
  return (
    <header className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <h1 className="m1-page-title text-[20px] text-[var(--text)] sm:text-[24px] 2xl:text-[28px]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-[62ch] text-[13px] text-[var(--text-secondary)] 2xl:text-[14px]">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </header>
  );
}

/**
 * The elevated surface. `flush` drops the body padding for edge-to-edge tables.
 */
export function Card({ title, subtitle, actions, children, className = "", bodyClassName = "", flush = false }) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] ${className}`}
    >
      {title ? (
        <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-[var(--border)] px-4 py-3 2xl:px-5">
          <div className="min-w-0">
            <h2 className="m1-section-title truncate text-[14px] text-[var(--text)] 2xl:text-[15px]">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={`min-w-0 flex-1 ${flush ? "" : "p-4 2xl:p-5"} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** A grouped area that does not float: no border, no elevation, just a heading. */
export function Subtle({ title, children, className = "" }) {
  return (
    <section className={`min-w-0 ${className}`}>
      {title ? (
        <h2 className="m1-section-title mb-2.5 text-[11px] uppercase tracking-[0.09em] text-[var(--text-tertiary)] 2xl:text-[12px]">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Footer line stating exactly which window produced the numbers above.
 */
export function PeriodFootnote({ period, comparison }) {
  const { t } = useTranslation();
  if (!period) return null;
  return (
    <p className="pt-1 text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">
      <span dir="ltr" className="inline-block tabular-nums">{period.from} → {period.to}</span>
      {comparison ? (
        <>
          {" · "}
          {t("overview.compare.vs")}{" "}
          <span dir="ltr" className="inline-block tabular-nums">{comparison.from} → {comparison.to}</span>
        </>
      ) : null}
    </p>
  );
}
