import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";

import { formatDeltaPercent, formatPercentValue, resolveSentiment, SENTIMENT_CLASS } from "../lib/metricFormat";
import { formatCurrency, formatNumber } from "../../../shared/lib/currency";
import { RANKING_KEYS } from "../hooks/useSalesFilters";

/**
 * One compact ranking module with a selector, rather than five stacked tables.
 * Thumbnails come from the product row already in the response — no per-row request.
 */
export default function ProductRankings({ rankings, active, onChange, showProfit, hasComparison, onSelectProduct }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  const available = RANKING_KEYS.filter((key) => {
    if (key === "topByProfit") return showProfit;
    if (key === "fastestGrowth" || key === "largestDecline") return hasComparison;
    return true;
  });

  const current = available.includes(active) ? active : available[0];
  const rows = rankings?.[current] || [];

  const metricFor = (row) => {
    if (current === "topByUnits") return `${formatNumber(row.units, language)} ${t("salesAnalytics.breakdown.units")}`;
    if (current === "topByProfit") return formatCurrency(row.grossProfit, language);
    return formatCurrency(row.netSales, language);
  };

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {available.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition ${
              current === key
                ? "bg-[var(--primary)] text-white"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
            }`}
          >
            {t(`salesAnalytics.rankings.${key}`)}
          </button>
        ))}
      </div>

      {!hasComparison && (current === "fastestGrowth" || current === "largestDecline") ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
          {t("salesAnalytics.rankings.needsComparison")}
        </p>
      ) : !rows.length ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
          {t("salesAnalytics.rankings.empty")}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((row, index) => {
            const sentiment = resolveSentiment("higher", row.growth);
            return (
              <li key={row.productId}>
                <button
                  type="button"
                  onClick={() => onSelectProduct?.(row)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition hover:bg-[var(--surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  <span className="w-4 shrink-0 text-[11px] font-bold tabular-nums text-[var(--text-tertiary)]">{index + 1}</span>
                  <Thumbnail url={row.imageUrl} name={row.productName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[var(--text)]" title={row.productName}>
                      {row.productName}
                    </span>
                    <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
                      {[row.brand, row.productType].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-[12px] font-bold tabular-nums text-[var(--text)]">{metricFor(row)}</span>
                    {row.growth !== null && row.growth !== undefined ? (
                      <span className={`block text-[10px] font-semibold tabular-nums ${SENTIMENT_CLASS[sentiment]}`}>
                        {formatDeltaPercent(row.growth, language)}
                      </span>
                    ) : showProfit && row.grossMargin !== null && row.grossMargin !== undefined ? (
                      <span className="block text-[10px] tabular-nums text-[var(--text-tertiary)]">
                        {formatPercentValue(row.grossMargin, language)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Thumbnail({ url, name }) {
  if (!url) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)]">
        <Package className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      width={32}
      height={32}
      className="h-8 w-8 shrink-0 rounded-lg border border-[var(--border)] object-cover"
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
      title={name}
    />
  );
}
