import { useTranslation } from "react-i18next";
import { Ruler, TriangleAlert } from "lucide-react";

import { formatNumber } from "../../../shared/lib/currency";
import { formatMoney } from "../lib/metricFormat";
import { dimensionLabel } from "../lib/dimensionLabels";

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
        <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} language={language} />
        <div className="mt-3 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] px-5 py-9 text-center">
          <Ruler className="h-5 w-5 text-[var(--text-tertiary)]" aria-hidden="true" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)]">{t("salesAnalytics.sizes.pickType")}</p>
          <p className="max-w-md text-[12px] leading-5 text-[var(--text-tertiary)]">
            {t("salesAnalytics.sizes.pickTypeWhy")}
          </p>
        </div>
      </div>
    );
  }

  if (data && data.applicable === false) {
    return (
      <div className="min-w-0">
        <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} language={language} />
        <div className="mt-3 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] px-5 py-9 text-center">
          <Ruler className="h-5 w-5 text-[var(--text-tertiary)]" aria-hidden="true" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)]">
            {t("salesAnalytics.sizes.notApplicableFor", { productType: dimensionLabel("product_type", selectedType, language) })}
          </p>
          <p className="max-w-md text-[12px] leading-5 text-[var(--text-tertiary)]">
            {t("salesAnalytics.sizes.notApplicableWhy")}
          </p>
        </div>
      </div>
    );
  }

  const maxUnits = Math.max(...rows.map((row) => row.units || 0), 1);
  const maxStock = Math.max(...rows.map((row) => row.currentStock || 0), 1);
  const soldOut = rows.filter((row) => row.units > 0 && row.currentStock === 0);

  // Sold against what is left, on the same row. A size selling well off a thin shelf
  // and a size sitting untouched on a deep one look completely different here, which
  // is the judgement a buyer actually has to make. Still no forecast: both numbers are
  // measured over the selected period, and nothing is projected forward.
  const ratioOf = (row) => {
    const stock = row.currentStock;
    if (typeof stock !== "number" || stock <= 0) return null;
    return (row.units || 0) / stock;
  };
  const STRONG_RATIO = 0.25;

  return (
    <div className="min-w-0">
      <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} language={language} />

      <p className="mt-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
        {t("salesAnalytics.sizes.scopeNote", { productType: dimensionLabel("product_type", selectedType, language) })}
      </p>

      {soldOut.length ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
          {t("salesAnalytics.sizes.soldOutWarning", { count: soldOut.length })}
        </p>
      ) : null}

      {!rows.length ? (
        <div className="mt-3 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] px-5 py-9 text-center">
          <Ruler className="h-5 w-5 text-[var(--text-tertiary)]" aria-hidden="true" />
          <p className="text-[14px] font-semibold text-[var(--text-secondary)]">{t("salesAnalytics.sizes.empty")}</p>
          <p className="max-w-md text-[12px] leading-5 text-[var(--text-tertiary)]">
            {t("salesAnalytics.sizes.emptyWhy")}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-3 px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)] 2xl:text-[11px]">
            <span className="w-12 shrink-0">{t("salesAnalytics.sizes.size")}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-full bg-[var(--primary)]" aria-hidden="true" />
              {t("salesAnalytics.sizes.units")}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-full bg-[var(--border-strong)]" aria-hidden="true" />
              {t("salesAnalytics.sizes.stock")}
            </span>
            <span className="hidden w-24 shrink-0 text-end sm:block">{t("salesAnalytics.sizes.netSales")}</span>
            <span className="w-16 shrink-0 text-end">{t("salesAnalytics.sizes.ratio")}</span>
          </div>

          <ul className="mt-1.5 divide-y divide-[var(--border)]">
            {rows.map((row) => {
              const unitsWidth = Math.max(((row.units || 0) / maxUnits) * 100, row.units > 0 ? 3 : 0);
              const stockWidth = Math.max(((row.currentStock || 0) / maxStock) * 100, row.currentStock > 0 ? 3 : 0);
              const outOfStock = row.currentStock === 0;
              const ratio = ratioOf(row);
              const strong = ratio !== null && ratio >= STRONG_RATIO;
              return (
                <li key={row.size} className="flex items-center gap-3 py-2">
                  <span className="w-12 shrink-0 text-[14px] font-bold tabular-nums text-[var(--text)] 2xl:text-[15px]">
                    {dimensionLabel("size", row.size, language)}
                  </span>

                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                      <span
                        className={`block h-full rounded-full ${outOfStock && row.units > 0 ? "bg-[var(--danger)]" : "bg-[var(--primary)]"}`}
                        style={{ width: `${unitsWidth}%` }}
                      />
                    </span>
                    <span className="w-9 shrink-0 text-end text-[12px] font-bold tabular-nums text-[var(--text)]">
                      {formatNumber(row.units, language)}
                    </span>
                  </span>

                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                      <span className="block h-full rounded-full bg-[var(--border-strong)]" style={{ width: `${stockWidth}%` }} />
                    </span>
                    <span
                      className={`w-11 shrink-0 text-end text-[12px] tabular-nums ${outOfStock ? "font-bold text-[var(--danger)]" : "text-[var(--text-secondary)]"}`}
                    >
                      {outOfStock
                        ? row.units > 0 ? t("salesAnalytics.sizes.soldOut") : t("salesAnalytics.sizes.noStock")
                        : formatNumber(row.currentStock, language)}
                    </span>
                  </span>

                  <span className="hidden w-24 shrink-0 text-end text-[11px] tabular-nums text-[var(--text-tertiary)] sm:block 2xl:text-[12px]">
                    {formatMoney(row.netSales, language)}
                  </span>

                  <span className="w-16 shrink-0 text-end">
                    {ratio === null ? (
                      <span className="text-[11px] text-[var(--text-tertiary)]">—</span>
                    ) : (
                      <span
                        className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums 2xl:text-[12px] ${
                          strong ? "bg-[var(--success-soft)] text-[var(--success)]" : "text-[var(--text-tertiary)]"
                        }`}
                        title={t("salesAnalytics.sizes.ratioHint")}
                      >
                        {`${Math.round(ratio * 100)}%`}
                      </span>
                    )}
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

function TypePicker({ types = [], selected, onSelect, language }) {
  if (!types.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((type) => (
        <button
          key={type}
          type="button"
          // The stored value drives the selection; only the caption is translated.
          onClick={() => onSelect(type === selected ? "" : type)}
          aria-pressed={selected === type}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] 2xl:text-[13px] ${
            selected === type
              ? "bg-[var(--primary)] text-white"
              : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          }`}
        >
          {dimensionLabel("product_type", type, language)}
        </button>
      ))}
    </div>
  );
}
