import { useTranslation } from "react-i18next";

import { formatMoney, formatPercentValue } from "../lib/metricFormat";
import { dimensionLabel } from "../lib/dimensionLabels";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * Top categories by net sales, as proportional bars rather than a chart library call —
 * a horizontal magnitude comparison needs no axes, and this stays crisp in RTL.
 *
 * The "other" bucket always shows its own value: a residual must never hide a dominant
 * amount behind a label.
 */
export default function CategoryContribution({ categories, showProfit = true }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rows = categories?.rows || [];
  const other = categories?.other || null;

  if (!rows.length && !other) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-[13px] text-[var(--text-tertiary)]">
        {t("overview.categories.empty")}
      </div>
    );
  }

  const max = Math.max(...rows.map((row) => row.netSales || 0), other?.netSales || 0, 1);

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <CategoryRow
          key={row.category}
          name={dimensionLabel("category", row.category, language)}
          row={row}
          max={max}
          language={language}
          showProfit={showProfit}
          t={t}
        />
      ))}

      {other ? (
        <CategoryRow
          name={t("overview.categories.other")}
          detail={
            other.includesUncategorised && other.categoryCount <= 1
              ? t("overview.categories.uncategorised")
              : t("overview.categories.otherDetail", { count: other.categoryCount })
          }
          row={{ netSales: other.netSales, contribution: other.contribution, units: null, grossProfit: null, grossMargin: null }}
          max={max}
          language={language}
          showProfit={false}
          muted
          t={t}
        />
      ) : null}
    </ul>
  );
}

function CategoryRow({ name, detail, row, max, language, showProfit, muted = false, t }) {
  const width = Math.max(((row.netSales || 0) / max) * 100, 1.5);

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={`truncate text-[14px] font-semibold 2xl:text-[15px] ${muted ? "text-[var(--text-tertiary)]" : "text-[var(--text)]"}`}>
            {name}
          </span>
          {detail ? <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">· {detail}</span> : null}
        </span>
        <span className="shrink-0 text-[14px] font-bold tabular-nums text-[var(--text)] 2xl:text-[15px]">
          {formatMoney(row.netSales, language)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2.5">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-soft)]">
          <div
            className={`h-full rounded-full ${muted ? "bg-[var(--border-strong)]" : "bg-[var(--primary)]"}`}
            style={{ width: `${width}%` }}
          />
        </div>
        <span className="w-10 shrink-0 text-end text-[11px] font-semibold tabular-nums text-[var(--text-tertiary)]">
          {formatPercentValue(row.contribution, language) || "—"}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-tertiary)]">
        {row.units !== null && row.units !== undefined ? (
          <span>
            {t("overview.categories.units")}: <span className="tabular-nums">{formatNumber(row.units, language)}</span>
          </span>
        ) : null}
        {showProfit && row.grossProfit !== null && row.grossProfit !== undefined ? (
          <span>
            {t("overview.categories.grossProfit")}:{" "}
            <span className="tabular-nums">{formatMoney(row.grossProfit, language)}</span>
          </span>
        ) : null}
        {showProfit && row.grossMargin !== null && row.grossMargin !== undefined ? (
          <span>
            {t("overview.categories.margin")}:{" "}
            <span className="tabular-nums">{formatPercentValue(row.grossMargin, language)}</span>
          </span>
        ) : null}
      </div>
    </li>
  );
}
