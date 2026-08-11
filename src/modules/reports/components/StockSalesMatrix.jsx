import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import MetricTooltip from "./MetricTooltip";
import { formatMoney } from "../lib/metricFormat";
import { dimensionLabel } from "../lib/dimensionLabels";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * Where stock and demand disagree.
 *
 * Same four-card treatment as the R3 product matrix — the design system is frozen, and
 * a manager who has learned to read one should not have to learn another. Only the axes
 * change: demand over the period against stock right now.
 *
 * Thresholds are the period's own medians, never fixed unit or EGP numbers: a 3,000 EGP
 * boot and a 200 EGP slipper share this screen, and any absolute cutoff would be wrong
 * for one of them and would drift as the catalogue grows.
 */
const QUADRANTS = [
  { key: "replenish", tone: "text-[var(--danger)]", edge: "border-s-[var(--danger)]" },
  { key: "healthy_core", tone: "text-[var(--success)]", edge: "border-s-[var(--success)]" },
  { key: "overstock", tone: "text-[var(--warning)]", edge: "border-s-[var(--warning)]" },
  { key: "low_priority", tone: "text-[var(--text-tertiary)]", edge: "border-s-[var(--border-strong)]" },
];

export default function StockSalesMatrix({ matrix, showValue, onSelectProduct }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const points = matrix?.points;

  const grouped = useMemo(() => {
    const buckets = Object.fromEntries(QUADRANTS.map((q) => [q.key, []]));
    (points || []).forEach((point) => {
      if (point.quadrant && buckets[point.quadrant]) buckets[point.quadrant].push(point);
    });
    // Replenishment is ordered by demand; everything else by the capital it holds.
    Object.entries(buckets).forEach(([key, list]) =>
      list.sort((a, b) =>
        key === "replenish"
          ? b.unitsSoldPeriod - a.unitsSoldPeriod
          : (b.inventoryValue ?? b.unitsInStock) - (a.inventoryValue ?? a.unitsInStock)
      )
    );
    return buckets;
  }, [points]);

  if (!points?.length || matrix?.medianStock === null || matrix?.medianStock === undefined) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        {t("inventory.matrix.empty")}
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">
        <MetricTooltip title={t("inventory.matrix.title")} definition={t("inventory.matrix.method")} />
        <span>
          {t("inventory.matrix.medianSold")}:{" "}
          <span className="font-bold tabular-nums text-[var(--text-secondary)]">
            {formatNumber(matrix.medianUnitsSold, language)}
          </span>
        </span>
        <span>
          {t("inventory.matrix.medianStock")}:{" "}
          <span className="font-bold tabular-nums text-[var(--text-secondary)]">
            {formatNumber(matrix.medianStock, language)}
          </span>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 2xl:gap-4">
        {QUADRANTS.map((quadrant) => {
          const list = grouped[quadrant.key];
          return (
            <div
              key={quadrant.key}
              className={`flex min-w-0 flex-col rounded-xl border border-s-[3px] border-[var(--border)] ${quadrant.edge} bg-[var(--surface-soft)] p-3.5 2xl:p-4`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className={`text-[13px] font-bold 2xl:text-[14px] ${quadrant.tone}`}>
                    {t(`inventory.matrix.${quadrant.key}`)}
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-tertiary)] 2xl:text-[12px]">
                    {t(`inventory.matrix.${quadrant.key}Hint`)}
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
                        className="w-full rounded-lg border border-transparent bg-[var(--card)] px-3 py-2.5 text-start transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                      >
                        <span className="block truncate text-[14px] font-semibold text-[var(--text)] 2xl:text-[15px]" title={point.productName}>
                          {point.productName}
                        </span>
                        <span className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">
                          <span className="tabular-nums">
                            {t("inventory.matrix.stock")} <span className="font-bold text-[var(--text-secondary)]">{formatNumber(point.unitsInStock, language)}</span>
                          </span>
                          <span className="tabular-nums">
                            {t("inventory.matrix.sold")} <span className="font-bold text-[var(--text-secondary)]">{formatNumber(point.unitsSoldPeriod, language)}</span>
                          </span>
                          {showValue && point.inventoryValue !== null ? (
                            <span className="tabular-nums">{formatMoney(point.inventoryValue, language)}</span>
                          ) : null}
                          {point.brand || point.productType ? (
                            <span className="truncate">
                              {[point.brand, dimensionLabel("product_type", point.productType, language)].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2.5 text-[11px] text-[var(--text-tertiary)]">{t("inventory.matrix.noneHere")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
