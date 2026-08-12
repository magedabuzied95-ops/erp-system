import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Inbox, Lock, RotateCcw, TriangleAlert } from "lucide-react";

/**
 * Loading / empty / error / forbidden / partial are five distinct states.
 * None of them is ever rendered as "EGP 0".
 */

/** Skeleton mirrors the real layout so nothing shifts when data lands. */
export function OverviewSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-[132px] animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)]" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-[104px] animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="h-[340px] animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)]" />
        <div className="h-[340px] animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)]" />
      </div>
    </div>
  );
}

export function OverviewEmpty() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] px-6 py-14 text-center">
      <Inbox className="h-8 w-8 text-[var(--text-tertiary)]" aria-hidden="true" />
      <h2 className="m1-section-title mt-3 text-[15px] text-[var(--text)]">{t("overview.states.emptyTitle")}</h2>
      <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-[var(--text-secondary)]">{t("overview.states.emptyBody")}</p>
    </div>
  );
}

export function OverviewError({ error, onRetry }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-6 py-12 text-center"
    >
      <TriangleAlert className="h-8 w-8 text-[var(--danger)]" aria-hidden="true" />
      <h2 className="m1-section-title mt-3 text-[15px] text-[var(--text)]">{t("overview.states.errorTitle")}</h2>
      <p className="mt-1.5 max-w-md text-[13px] leading-5 text-[var(--text-secondary)]">{t("overview.states.errorBody")}</p>
      {error?.message ? (
        <p className="mt-2 max-w-md truncate text-[11px] text-[var(--text-tertiary)]" title={error.message}>
          {error.code ? `${error.code}: ` : ""}
          {error.message}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[13px] font-bold text-white transition hover:brightness-110"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        {t("overview.states.retry")}
      </button>
    </div>
  );
}

export function OverviewForbidden() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-14 text-center">
      <Lock className="h-8 w-8 text-[var(--text-tertiary)]" aria-hidden="true" />
      <h2 className="m1-section-title mt-3 text-[15px] text-[var(--text)]">{t("overview.states.restricted")}</h2>
    </div>
  );
}

/**
 * Codes that describe a number as untrustworthy, rather than merely annotating it.
 * These stay expanded, because a manager who misses them may act on a wrong figure.
 */
const CRITICAL_WARNINGS = new Set(["COGS_COVERAGE_CRITICAL", "RETURNS_FALLBACK_USED", "NAN_VALUES_IGNORED"]);

/**
 * Data-quality notes. Present alongside real numbers — this is partial, not failed.
 *
 * Collapsed to a single strip by default. The previous always-expanded panel took
 * 125px at the top of the page and pulled the eye before the KPIs, which is the wrong
 * order for notes that are usually informational. A critical note still opens on its
 * own, and nothing is ever hidden — the count is always visible and one click away
 * from the detail.
 */
export function OverviewWarnings({ warnings = [] }) {
  const { t, i18n } = useTranslation();
  const critical = warnings.filter((warning) => CRITICAL_WARNINGS.has(warning.code));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Re-open when a critical note appears after a filter change.
    if (critical.length) setOpen(true);
  }, [critical.length]);

  if (!warnings.length) return null;

  const severe = critical.length > 0;
  const message = (warning) =>
    t(`overview.warnings.${warning.code}`, {
      defaultValue: warning.message || warning.code,
      ...buildWarningValues(warning, i18n.language),
    });

  return (
    <section
      aria-label={t("overview.warnings.title")}
      className={`rounded-xl border ${ severe ? "border-[var(--warning)]/35 bg-[var(--warning-soft)]" : "border-[var(--border)] bg-[var(--surface-soft)]" }`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-start transition hover:brightness-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <TriangleAlert
          className={`h-3.5 w-3.5 shrink-0 ${severe ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]"}`}
          aria-hidden="true"
        />
        <span className={`text-[12px] font-bold ${severe ? "text-[var(--text)]" : "text-[var(--text-secondary)]"}`}>
          {t("overview.warnings.count", { count: warnings.length })}
        </span>
        <span className="ms-auto flex items-center gap-1 text-[11px] font-semibold text-[var(--text-tertiary)]">
          {open ? t("overview.warnings.hide") : t("overview.warnings.show")}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>

      {open ? (
        <ul className="space-y-1 border-t border-[var(--border)] px-3 py-2">
          {warnings.map((warning) => (
            <li
              key={warning.code}
              className={`flex gap-2 text-[12px] leading-5 ${ CRITICAL_WARNINGS.has(warning.code) ? "text-[var(--text)]" : "text-[var(--text-secondary)]" }`}
            >
              <span aria-hidden="true" className="text-[var(--text-tertiary)]">•</span>
              <span className="min-w-0">{message(warning)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const buildWarningValues = (warning, language) => {
  const values = {};
  if (typeof warning.coverage === "number") values.coverage = `${(warning.coverage * 100).toFixed(1)}%`;
  if (typeof warning.creditRetained === "number") {
    values.creditRetained = new Intl.NumberFormat(String(language).startsWith("ar") ? "ar-EG" : "en-US", {
      maximumFractionDigits: 0,
    }).format(warning.creditRetained);
  }
  if (typeof warning.rows === "number") values.rows = warning.rows;
  if (typeof warning.orders === "number") values.orders = warning.orders;
  return values;
};
