import { useTranslation } from "react-i18next";
import { Inbox, Lock, RotateCcw, TriangleAlert } from "lucide-react";

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
      <h2 className="mt-3 text-[15px] font-bold text-[var(--text)]">{t("overview.states.emptyTitle")}</h2>
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
      <h2 className="mt-3 text-[15px] font-bold text-[var(--text)]">{t("overview.states.errorTitle")}</h2>
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
        className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[13px] font-bold text-white transition hover:brightness-110"
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
      <h2 className="mt-3 text-[15px] font-bold text-[var(--text)]">{t("overview.states.restricted")}</h2>
    </div>
  );
}

/** Data-quality notes. Present alongside real numbers — this is partial, not failed. */
export function OverviewWarnings({ warnings = [] }) {
  const { t, i18n } = useTranslation();
  if (!warnings.length) return null;

  return (
    <section
      aria-label={t("overview.warnings.title")}
      className="rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] p-3.5"
    >
      <h2 className="flex items-center gap-2 text-[12px] font-bold text-[var(--text)]">
        <TriangleAlert className="h-3.5 w-3.5 text-[var(--warning)]" aria-hidden="true" />
        {t("overview.warnings.title")}
      </h2>
      <ul className="mt-2 space-y-1">
        {warnings.map((warning) => {
          const message = t(`overview.warnings.${warning.code}`, {
            defaultValue: warning.message || warning.code,
            ...buildWarningValues(warning, i18n.language),
          });
          return (
            <li key={warning.code} className="text-[12px] leading-5 text-[var(--text-secondary)]">
              • {message}
            </li>
          );
        })}
      </ul>
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
