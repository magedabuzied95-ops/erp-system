import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, RotateCcw, TriangleAlert } from "lucide-react";

/**
 * A page section with its own loading / error state.
 *
 * Secondary sections can collapse so the page leads with sales, profit and trend
 * rather than presenting ten equally-weighted cards.
 */
export default function SectionCard({
  title,
  subtitle,
  actions,
  children,
  status = "success",
  error,
  onRetry,
  collapsible = false,
  defaultOpen = true,
  skeletonHeight = 220,
  note,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--card)]">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
              aria-label={open ? t("salesAnalytics.sections.collapse") : t("salesAnalytics.sections.expand")}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90 rtl:rotate-90"}`} aria-hidden="true" />
            </button>
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-bold text-[var(--text)]">{title}</h2>
            {subtitle ? <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]">{subtitle}</p> : null}
          </div>
        </div>
        {open ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
      </header>

      {open ? (
        <div className="min-w-0 border-t border-[var(--border)] p-4">
          {note ? (
            <p className="mb-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
              {note}
            </p>
          ) : null}

          {status === "loading" ? (
            <div className="animate-pulse rounded-xl bg-[var(--surface-soft)]" style={{ height: skeletonHeight }} aria-busy="true" />
          ) : status === "error" ? (
            <div role="alert" className="flex flex-col items-center justify-center rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-8 text-center">
              <TriangleAlert className="h-6 w-6 text-[var(--danger)]" aria-hidden="true" />
              <p className="mt-2 text-[13px] font-bold text-[var(--text)]">{t("salesAnalytics.states.sectionError")}</p>
              {error?.message ? (
                <p className="mt-1 max-w-md truncate text-[11px] text-[var(--text-tertiary)]" title={error.message}>{error.message}</p>
              ) : null}
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-[12px] font-bold text-white transition hover:brightness-110"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  {t("salesAnalytics.states.sectionRetry")}
                </button>
              ) : null}
            </div>
          ) : (
            <div className={`min-w-0 transition-opacity ${status === "refreshing" ? "opacity-60" : "opacity-100"}`}>{children}</div>
          )}
        </div>
      ) : null}
    </section>
  );
}
