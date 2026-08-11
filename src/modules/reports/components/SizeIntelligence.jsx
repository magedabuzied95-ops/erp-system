import { useTranslation } from "react-i18next";
import { Ruler, TriangleAlert } from "lucide-react";

import { formatCurrency, formatNumber } from "../../../shared/lib/currency";

/**
 * Size-level demand against remaining stock, for one product type.
 *
 * Deliberately NOT a forecast: the bar shows units sold in the selected period and the
 * figure beside it is what is left on the shelf. No days-to-stockout is derived, since
 * five weeks of history cannot support one.
 */
export default function SizeIntelligence({ data, productTypes, selectedType, onSelectType }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  const rows = data?.rows || [];
  const totals = data?.totals;

  if (!selectedType) {
    return (
      <div className="min-w-0">
        <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} />
        <p className="mt-3 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
          {t("salesAnalytics.sizes.pickType")}
        </p>
      </div>
    );
  }

  if (data && data.applicable === false) {
    return (
      <div className="min-w-0">
        <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} />
        <p className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
          <Ruler className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t("salesAnalytics.sizes.notApplicable")}
        </p>
      </div>
    );
  }

  const maxUnits = Math.max(...rows.map((row) => row.units || 0), 1);
  const soldOut = rows.filter((row) => row.units > 0 && row.currentStock === 0);

  return (
    <div className="min-w-0">
      <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} />

      <p className="mt-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
        {t("salesAnalytics.sizes.scopeNote", { productType: selectedType })}
      </p>

      {soldOut.length ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
          {t("salesAnalytics.sizes.soldOutWarning", { count: soldOut.length })}
        </p>
      ) : null}

      {!rows.length ? (
        <p className="mt-3 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
          {t("salesAnalytics.sizes.empty")}
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {rows.map((row) => {
              const width = Math.max(((row.units || 0) / maxUnits) * 100, row.units > 0 ? 2 : 0);
              const outOfStock = row.currentStock === 0;
              return (
                <li key={row.size} className="flex items-center gap-2.5">
                  <span className="w-12 shrink-0 text-[12px] font-bold tabular-nums text-[var(--text)]">{row.size}</span>

                  <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                    <span
                      className={`block h-full rounded-full ${outOfStock && row.units > 0 ? "bg-[var(--danger)]" : "bg-[var(--primary)]"}`}
                      style={{ width: `${width}%` }}
                    />
                  </span>

                  <span className="w-14 shrink-0 text-end text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
                    {formatNumber(row.units, language)}
                  </span>

                  <span
                    className={`w-20 shrink-0 text-end text-[11px] tabular-nums ${outOfStock ? "font-bold text-[var(--danger)]" : "text-[var(--text-tertiary)]"}`}
                    title={t("salesAnalytics.sizes.stock")}
                  >
                    {outOfStock
                      ? row.units > 0 ? t("salesAnalytics.sizes.soldOut") : t("salesAnalytics.sizes.noStock")
                      : `${t("salesAnalytics.sizes.stock")} ${formatNumber(row.currentStock, language)}`}
                  </span>

                  <span className="hidden w-24 shrink-0 text-end text-[11px] tabular-nums text-[var(--text-tertiary)] sm:block">
                    {formatCurrency(row.netSales, language)}
                  </span>
                </li>
              );
            })}
          </ul>

          {totals ? (
            <p className="mt-3 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-tertiary)]">
              {t("salesAnalytics.sizes.summary", { sold: totals.sizesWithSales, stock: totals.sizesWithStock })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function TypePicker({ types = [], selected, onSelect }) {
  if (!types.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onSelect(type === selected ? "" : type)}
          className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition ${
            selected === type
              ? "bg-[var(--primary)] text-white"
              : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          }`}
        >
          {type}
        </button>
      ))}
    </div>
  );
}
