import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { formatMoney, formatPercentValue } from "../lib/metricFormat";
import { dimensionLabel } from "../lib/dimensionLabels";
import { formatNumber } from "../../../shared/lib/currency";
import { INVENTORY_DIMENSIONS } from "../hooks/useInventoryFilters";

/**
 * Where inventory capital sits, and whether demand agrees.
 *
 * Value and 30-day demand share every row on purpose: a type holding a quarter of the
 * capital and a twentieth of the sales is the finding, and it only shows when the two
 * numbers sit together.
 */
export default function InventoryBreakdown({ data, dimension, showValue, quality, onDimensionChange, onDrill }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rows = data?.rows || [];
  const unusable = quality && quality.usable === false;

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {INVENTORY_DIMENSIONS.map((key) => {
          const disabled = key === dimension ? false : false;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDimensionChange(key)}
              aria-pressed={dimension === key}
              disabled={disabled}
              className={`rounded-[var(--radius-control)] px-3 py-1.5 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] 2xl:text-[13px] ${ dimension === key ? "bg-[var(--primary)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]" }`}
            >
              {t(`inventory.breakdown.${key}`)}
            </button>
          );
        })}
      </div>

      {unusable ? (
        <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
          {t("inventory.breakdown.unusableHint")}
        </p>
      ) : null}

      {quality?.unknownContributionPercent > 0.2 ? (
        <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
          {t("inventory.breakdown.unknownWarning", {
            percent: formatPercentValue(quality.unknownContributionPercent, language),
          })}
        </p>
      ) : null}

      {!rows.length ? (
        <div className="flex h-[160px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-[13px] text-[var(--text-tertiary)]">
          {t("inventory.breakdown.empty")}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const width = Math.max(((showValue ? row.valueShare : row.unitShare) || 0) * 100, 1.5);
            return (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => onDrill?.(dimension, row.key)}
                  title={t("inventory.breakdown.filterHint")}
                  className="group w-full rounded-[var(--radius-control)] px-2 py-2 text-start transition hover:bg-[var(--surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[14px] font-semibold text-[var(--text)] group-hover:text-[var(--primary)] 2xl:text-[15px]">
                      {dimensionLabel(dimension, row.key, language)}
                    </span>
                    <span className="shrink-0 text-[14px] font-bold tabular-nums text-[var(--text)] 2xl:text-[15px]">
                      {showValue && row.inventoryValue !== null
                        ? formatMoney(row.inventoryValue, language)
                        : `${formatNumber(row.unitsInStock, language)} ${t("inventory.units")}`}
                    </span>
                  </span>

                  <span className="mt-2 flex items-center gap-2.5">
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                      <span className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-300" style={{ width: `${width}%` }} />
                    </span>
                    <span className="w-11 shrink-0 text-end text-[12px] font-bold tabular-nums text-[var(--text-secondary)]">
                      {formatPercentValue(showValue ? row.valueShare : row.unitShare, language) || "—"}
                    </span>
                  </span>

                  <span className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">
                    <span>{t("inventory.breakdown.stock")}: <span className="tabular-nums">{formatNumber(row.unitsInStock, language)}</span></span>
                    <span>{t("inventory.breakdown.products")}: <span className="tabular-nums">{formatNumber(row.stockedProducts, language)}</span></span>
                    <span>{t("inventory.breakdown.sold")}: <span className="tabular-nums">{formatNumber(row.unitsSoldPeriod, language)}</span></span>
                    <span>{t("inventory.breakdown.netSales")}: <span className="tabular-nums">{formatMoney(row.netSalesPeriod, language)}</span></span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
