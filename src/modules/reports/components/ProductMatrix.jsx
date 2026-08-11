import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import MetricTooltip from "./MetricTooltip";
import { formatPercentValue } from "../lib/metricFormat";
import { formatCurrency, formatNumber } from "../../../shared/lib/currency";

/**
 * The four-quadrant product view, as grouped cards rather than a scatter plot.
 *
 * A scatter is unreadable at 375px and needs an axis explanation a store manager
 * should not have to decode; four labelled groups answer the same question — what is
 * a star, what sells well but earns little — and stay legible at every width.
 */

const QUADRANTS = [
  { key: "star", tone: "text-[var(--success)]", bar: "bg-[var(--success)]" },
  { key: "volume_low_margin", tone: "text-[var(--warning)]", bar: "bg-[var(--warning)]" },
  { key: "margin_opportunity", tone: "text-[var(--info)]", bar: "bg-[var(--info)]" },
  { key: "underperformer", tone: "text-[var(--text-tertiary)]", bar: "bg-[var(--border-strong)]" },
];

export default function ProductMatrix({ matrix, showProfit, onSelectProduct }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const points = matrix?.points || [];

  const grouped = useMemo(() => {
    const buckets = Object.fromEntries(QUADRANTS.map((q) => [q.key, []]));
    points.forEach((point) => {
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

  if (!points.length || matrix?.medianMargin === null || matrix?.medianMargin === undefined) {
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
          formula={`${t("salesAnalytics.matrix.medianSales")}: ${formatCurrency(matrix.medianNetSales, language)} · ${t("salesAnalytics.matrix.medianMargin")}: ${formatPercentValue(matrix.medianMargin, language)}`}
        />
        <span>
          {t("salesAnalytics.matrix.medianSales")}:{" "}
          <span className="font-bold tabular-nums text-[var(--text-secondary)]">{formatCurrency(matrix.medianNetSales, language)}</span>
        </span>
        <span>
          {t("salesAnalytics.matrix.medianMargin")}:{" "}
          <span className="font-bold tabular-nums text-[var(--text-secondary)]">{formatPercentValue(matrix.medianMargin, language)}</span>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {QUADRANTS.map((quadrant) => {
          const list = grouped[quadrant.key];
          return (
            <div key={quadrant.key} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className={`flex items-center gap-1.5 text-[12px] font-bold ${quadrant.tone}`}>
                    <span className={`inline-block h-2.5 w-1 rounded-full ${quadrant.bar}`} aria-hidden="true" />
                    {t(`salesAnalytics.matrix.${quadrant.key}`)}
                  </h3>
                  <p className="mt-0.5 text-[10px] leading-3 text-[var(--text-tertiary)]">
                    {t(`salesAnalytics.matrix.${quadrant.key}Hint`)}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-[var(--text-secondary)]">
                  {t("salesAnalytics.matrix.productsCount", { count: list.length })}
                </span>
              </div>

              {list.length ? (
                <ul className="mt-2.5 space-y-1.5">
                  {list.slice(0, 5).map((point) => (
                    <li key={point.productId}>
                      <button
                        type="button"
                        onClick={() => onSelectProduct?.(point)}
                        className="w-full rounded-lg bg-[var(--card)] px-2.5 py-2 text-start transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                      >
                        <span className="block truncate text-[12px] font-semibold text-[var(--text)]" title={point.productName}>
                          {point.productName}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-[var(--text-tertiary)]">
                          <span className="tabular-nums">{formatCurrency(point.netSales, language)}</span>
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
                <p className="mt-2.5 text-[11px] text-[var(--text-tertiary)]">—</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
