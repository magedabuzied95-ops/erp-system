import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { formatPercentValue, formatDeltaPercent, formatMoney, SENTIMENT_CLASS, resolveSentiment } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";
import { dimensionLabel } from "../lib/dimensionLabels";
import { BREAKDOWN_DIMENSIONS } from "../hooks/useSalesFilters";

/**
 * Sales by one dimension, as proportional bars.
 *
 * A dimension that does not segment the selected period is disabled rather than
 * rendered as a single giant "unknown" bar. That judgement comes from the backend's
 * per-request quality metadata, so a dimension that is useless for one period becomes
 * available again for another.
 */
export default function SalesBreakdown({ data, quality, showProfit, dimension, onDimensionChange, onDrill, dimensionQuality = {} }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rows = data?.rows || [];
  const total = data?.total || 0;

  const uncategorisedShare = quality?.dimension === "category" ? quality?.unknownContributionPercent : null;

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="me-1 text-[11px] font-semibold text-[var(--text-tertiary)]">
          {t("salesAnalytics.breakdown.dimension")}
        </span>
        {BREAKDOWN_DIMENSIONS.map((key) => {
          const info = dimensionQuality[key];
          // Only a dimension with zero real buckets is unusable; one bucket is thin
          // but still truthful, so it stays selectable.
          const unusable = info && info.distinctMeaningfulValues === 0;
          const active = dimension === key;
          return (
            <button
              key={key}
              type="button"
              disabled={unusable && !active}
              onClick={() => onDimensionChange(key)}
              title={unusable ? t("salesAnalytics.breakdown.unusableHint") : undefined}
              className={`inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-[12px] font-semibold transition ${ active ? "bg-[var(--primary)] text-white" : unusable ? "cursor-not-allowed text-[var(--text-tertiary)] opacity-50" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]" }`}
            >
              {t(`salesAnalytics.breakdown.${key}`)}
              {unusable ? <span className="text-[10px]">· {t("salesAnalytics.breakdown.unusable")}</span> : null}
            </button>
          );
        })}
      </div>

      {uncategorisedShare !== null && uncategorisedShare !== undefined && uncategorisedShare > 0.2 ? (
        <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
          {t("salesAnalytics.breakdown.uncategorisedWarning", { percent: formatPercentValue(uncategorisedShare, language) })}
        </p>
      ) : null}

      {!rows.length ? (
        <div className="flex h-[160px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-[13px] text-[var(--text-tertiary)]">
          {t("salesAnalytics.breakdown.empty")}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const width = Math.max(((row.netSales || 0) / Math.max(rows[0].netSales || 1, 1)) * 100, 1.5);
            const sentiment = resolveSentiment("higher", row.delta);
            return (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => onDrill?.(dimension, row.key)}
                  title={t("salesAnalytics.breakdown.filterHint")}
                  className="group w-full rounded-[var(--radius-control)] px-2 py-2 text-start transition hover:bg-[var(--surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[14px] font-semibold text-[var(--text)] group-hover:text-[var(--primary)] 2xl:text-[15px]">
                      {dimensionLabel(dimension, row.key, language)}
                    </span>
                    <span className="shrink-0 text-[14px] font-bold tabular-nums text-[var(--text)] 2xl:text-[15px]">
                      {formatMoney(row.netSales, language)}
                    </span>
                  </span>

                  <span className="mt-2 flex items-center gap-2.5">
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                      <span className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-300" style={{ width: `${width}%` }} />
                    </span>
                    <span className="w-11 shrink-0 text-end text-[12px] font-bold tabular-nums text-[var(--text-secondary)]">
                      {formatPercentValue(row.contribution, language) || "—"}
                    </span>
                  </span>

                  <span className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">
                    <span>{t("salesAnalytics.breakdown.units")}: <span className="tabular-nums">{formatNumber(row.units, language)}</span></span>
                    {showProfit && row.grossProfit !== null ? (
                      <span>{t("salesAnalytics.breakdown.profit")}: <span className="tabular-nums">{formatMoney(row.grossProfit, language)}</span></span>
                    ) : null}
                    {showProfit && row.grossMargin !== null ? (
                      <span>{t("salesAnalytics.breakdown.margin")}: <span className="tabular-nums">{formatPercentValue(row.grossMargin, language)}</span></span>
                    ) : null}
                    {row.deltaPercent !== null && row.deltaPercent !== undefined ? (
                      <span className={SENTIMENT_CLASS[sentiment]}>{formatDeltaPercent(row.deltaPercent, language)}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length ? (
        <p className="mt-3 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-tertiary)]">
          {t("salesAnalytics.breakdown.netSales")}: <span className="font-bold tabular-nums text-[var(--text-secondary)]">{formatMoney(total, language)}</span>
        </p>
      ) : null}
    </div>
  );
}
