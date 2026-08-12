import { useTranslation } from "react-i18next";
import { ArrowDownRight, ArrowUpRight, Info, Lock, Minus, ShieldAlert } from "lucide-react";

import MetricTooltip from "./MetricTooltip";
import {
  METRIC_KIND,
  SENTIMENT_CLASS,
  formatDeltaPercent,
  formatMetricExact,
  formatMetricValue,
  isBaselineThin,
  resolveSentiment,
} from "../lib/metricFormat";

/**
 * One KPI.
 *
 * `level` drives visual weight rather than colour, so hierarchy survives in both
 * themes and does not rely on decoration:
 *   1 primary   — large figure, own card
 *   2 operating — medium figure
 *   3 health    — compact row
 *
 * Distinguishes four non-value states, which are NOT the same thing:
 *   restricted  — caller lacks the permission
 *   unavailable — computable in principle, but not trustworthy (cost coverage)
 *   null        — no denominator (e.g. AOV with zero orders)
 *   0           — a verified zero
 */
export default function KpiTile({ metric, kpi, level = 2, coverage = null }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  const label = t(`overview.kpi.${metric}`);
  const value = kpi?.current;
  const restricted = Boolean(kpi?.restricted);
  const unavailable = Boolean(kpi?.unavailableReason);

  const display = formatMetricValue(metric, value, language);
  const exact = formatMetricExact(metric, value, language);
  const isPercentMetric = METRIC_KIND[metric] === "percent";

  const sentiment = resolveSentiment(kpi?.favourable, kpi?.delta);
  const deltaPercent = formatDeltaPercent(kpi?.deltaPercent, language);
  const hasComparison = kpi?.previous !== null && kpi?.previous !== undefined;
  // previous === 0 with a positive current is "new", not "+100%".
  const isNewFromZero = hasComparison && kpi.previous === 0 && typeof value === "number" && value > 0;

  // The gap between levels is deliberately wide. On a large monitor a four-point
  // difference reads as an accident; primary has to win the page at a glance.
  const sizeClass =
    level === 1
      ? "text-[28px] leading-[1.1] sm:text-[34px] xl:text-[34px] 2xl:text-[34px]"
      : level === 2
        ? "text-[20px] leading-[1.2] sm:text-[24px] 2xl:text-[24px]"
        : "text-[16px] leading-[1.2] 2xl:text-[20px]";

  const paddingClass = level === 1 ? "p-4 sm:p-5 2xl:p-6" : level === 3 ? "px-3.5 py-3" : "p-4";

  const DeltaIcon = sentiment === "neutral" ? Minus : kpi?.delta > 0 ? ArrowUpRight : ArrowDownRight;

  // A percentage against a near-empty baseline is arithmetically right and visually
  // misleading: +3,412% is what one full month against five days looks like, and as a
  // large green number it reads as a triumph. Flag it instead of restyling the truth.
  //
  // The threshold is +200%: a period that tripled did not usually triple, it was
  // measured against a partial one. Declines are bounded at -100% and never trip this —
  // deliberately, because "sales stopped" is real information rather than an artefact
  // of a thin base. This lives here, so every KPI on every screen inherits it.
  const baselineThin = hasComparison && isBaselineThin(value, kpi?.previous);

  return (
    <div
      className={`flex min-w-0 flex-col justify-between rounded-[var(--radius-card)] border bg-[var(--card)] ${paddingClass} ${ level === 1 ? "border-[var(--border-strong)] shadow-[var(--shadow-card)]" : "border-[var(--border)]" }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`min-w-0 truncate font-semibold ${ level === 1 ? "text-[13px] text-[var(--text-secondary)] 2xl:text-[14px]" : "text-[12px] text-[var(--text-tertiary)] 2xl:text-[13px]" }`}
          title={label}
        >
          {label}
        </span>
        <MetricTooltip
          title={label}
          definition={t(`overview.definition.${metric}`, { defaultValue: "" })}
          formula={t(`overview.formula.${metric}`, { defaultValue: "" })}
          extra={exact && display !== exact ? exact : null}
          align="end"
        />
      </div>

      <div className="mt-2.5 min-w-0">
        {restricted ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-tertiary)]">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("overview.states.restrictedShort")}
          </span>
        ) : unavailable ? (
          <span
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--warning)]"
            title={t("overview.coverage.unavailableReason")}
          >
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("overview.coverage.unavailable")}
          </span>
        ) : display === null ? (
          <span className="text-[15px] font-semibold text-[var(--text-tertiary)]">
            {t("overview.states.noComparison")}
          </span>
        ) : (
          <span
            className={`block truncate font-extrabold tabular-nums text-[var(--text)] ${sizeClass}`}
            title={exact || undefined}
          >
            {display}
          </span>
        )}
      </div>

      <div className="mt-2 flex min-h-[18px] flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] font-semibold 2xl:text-[12px]">
        {restricted || unavailable ? (
          <span className="text-[var(--text-tertiary)]">
            {restricted ? t("overview.states.restricted") : t("overview.coverage.critical")}
          </span>
        ) : !hasComparison ? (
          <span className="text-[var(--text-tertiary)]">{t("overview.compare.noBase")}</span>
        ) : isNewFromZero ? (
          <span className="text-[var(--success)]">{t("overview.compare.new")}</span>
        ) : deltaPercent === null ? (
          <span className="text-[var(--text-tertiary)]">{t("overview.states.noComparison")}</span>
        ) : (
          <>
            <DeltaIcon
              className={`h-3.5 w-3.5 shrink-0 ${baselineThin ? "text-[var(--text-tertiary)]" : SENTIMENT_CLASS[sentiment]}`}
              aria-hidden="true"
            />
            <span className={baselineThin ? "text-[var(--text-secondary)]" : SENTIMENT_CLASS[sentiment]}>
              {isPercentMetric && typeof kpi?.delta === "number"
                ? `${kpi.delta > 0 ? "+" : ""}${(kpi.delta * 100).toFixed(1)}`
                : deltaPercent}
            </span>
            <span className="truncate text-[var(--text-tertiary)]">{t("overview.compare.vs")}</span>
            {baselineThin ? (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-tertiary)] 2xl:text-[11px]"
                title={t("overview.compare.thinBaselineHint")}
              >
                <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t("overview.compare.thinBaseline")}
              </span>
            ) : null}
          </>
        )}
      </div>

      {coverage}
    </div>
  );
}
