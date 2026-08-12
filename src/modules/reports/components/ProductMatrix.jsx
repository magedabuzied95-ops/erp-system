import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import MetricTooltip from "./MetricTooltip";
import { formatMoney, formatPercentValue } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * The four-quadrant product view, as grouped cards rather than a scatter plot.
 *
 * A scatter is unreadable at 375px and needs an axis explanation a store manager
 * should not have to decode; four labelled groups answer the same question — what is
 * a star, what sells well but earns little — and stay legible at every width.
 */

const QUADRANTS = [
  { key: "star", tone: "text-[var(--success)]", bar: "bg-[var(--success)]", edge: "border-s-[var(--success)]" },
  { key: "volume_low_margin", tone: "text-[var(--warning)]", bar: "bg-[var(--warning)]", edge: "border-s-[var(--warning)]" },
  { key: "margin_opportunity", tone: "text-[var(--info)]", bar: "bg-[var(--info)]", edge: "border-s-[var(--info)]" },
  { key: "underperformer", tone: "text-[var(--text-tertiary)]", bar: "bg-[var(--border-strong)]", edge: "border-s-[var(--border-strong)]" },
];

export default function ProductMatrix({ matrix, showProfit, onSelectProduct }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const points = matrix?.points;

  const grouped = useMemo(() => {
    const buckets = Object.fromEntries(QUADRANTS.map((q) => [q.key, []]));
    (points || []).forEach((point) => {
      if (point.quadrant && buckets[point.quadrant]) buckets[point.quadrant].push(point);
    });
    Object.values(buckets).forEach((list) => list.sort((a, b) => (b.netSales || 0) - (a.netSales || 0)));
    return buckets;
  }, [points]);

  if (!showProfit) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        {t("salesAnalytics.matrix.needsProfit")}
      </p>
    );
  }

  if (!points?.length || matrix?.medianMargin === null || matrix?.medianMargin === undefined) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        {t("salesAnalytics.matrix.empty")}
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
        <MetricTooltip
          title={t("salesAnalytics.matrix.title")}
          definition={t("salesAnalytics.matrix.method")}
          formula={`${t("salesAnalytics.matrix.medianSales")}: ${formatMoney(matrix.medianNetSales, language)} · ${t("salesAnalytics.matrix.medianMargin")}: ${formatPercentValue(matrix.medianMargin, language)}`}
        />
        <span>
          {t("salesAnalytics.matrix.medianSales")}:{" "}
          <span className="font-bold tabular-nums text-[var(--text-secondary)]">{formatMoney(matrix.medianNetSales, language)}</span>
        </span>
        <span>
          {t("salesAnalytics.matrix.medianMargin")}:{" "}
          <span className="font-bold tabular-nums text-[var(--text-secondary)]">{formatPercentValue(matrix.medianMargin, language)}</span>
        </span>
      </div>

      {/* A true 2x2 on desktop so the quadrants read as a matrix rather than a list. */}
      <div className="grid gap-3 sm:grid-cols-2 2xl:gap-4">
        {QUADRANTS.map((quadrant) => {
          const list = grouped[quadrant.key];
          return (
            <div
              key={quadrant.key}
              className={`flex min-w-0 flex-col rounded-[var(--radius-card)] border border-s-[3px] border-[var(--border)] ${quadrant.edge} bg-[var(--surface-soft)] p-3.5 2xl:p-4`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className={`m1-section-title text-[13px] 2xl:text-[14px] ${quadrant.tone}`}>
                    {t(`salesAnalytics.matrix.${quadrant.key}`)}
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-tertiary)] 2xl:text-[12px]">
                    {t(`salesAnalytics.matrix.${quadrant.key}Hint`)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-lg bg-[var(--card)] px-2 py-0.5 text-[13px] font-extrabold tabular-nums 2xl:text-[15px] ${quadrant.tone}`}>
                  {list.length}
                </span>
              </div>

              {list.length ? (
                <ul className="mt-2.5 space-y-1.5">
                  {list.slice(0, 6).map((point) => (
                    <li key={point.productId}>
                      <button
                        type="button"
                        onClick={() => onSelectProduct?.(point)}
                        className="w-full rounded-[var(--radius-control)] border border-transparent bg-[var(--card)] px-3 py-2.5 text-start transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                      >
                        <span className="block truncate text-[14px] font-semibold text-[var(--text)] 2xl:text-[15px]" title={point.productName}>
                          {point.productName}
                        </span>
                        <span className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">
                          <span className="text-[13px] font-bold tabular-nums text-[var(--text-secondary)] 2xl:text-[14px]">
                            {formatMoney(point.netSales, language)}
                          </span>
                          <span className="tabular-nums">{formatNumber(point.units, language)} {t("salesAnalytics.breakdown.units")}</span>
                          <span className="tabular-nums">{formatPercentValue(point.grossMargin, language)}</span>
                          {point.currentStock !== null && point.currentStock !== undefined ? (
                            <span className="tabular-nums">{t("salesAnalytics.matrix.stock")} {formatNumber(point.currentStock, language)}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2.5 text-[11px] text-[var(--text-tertiary)]">{t("salesAnalytics.matrix.noneHere")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
