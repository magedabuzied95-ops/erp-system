import { useTranslation } from "react-i18next";

import { formatDeltaPercent, formatPercentValue, resolveSentiment, SENTIMENT_CLASS } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * A one-dimension breakdown, drawn as proportional bars rather than a pie.
 *
 * A pie makes two adjacent slices genuinely hard to compare and needs a legend to say
 * which is which; a sorted bar list puts the label, the number and the proportion on the
 * same line and reads the same in Arabic as in English.
 *
 * The bar is a background fill on the row rather than a separate track, so the label
 * always sits over its own proportion and nothing needs a fixed pixel width.
 */
export default function BreakdownBars({
  rows = [],
  valueKey = "value",
  shareKey = "share",
  formatValue,
  secondary,
  growthKey = "growth",
  showGrowth = true,
  emptyLabel,
  onSelect,
  maxRows = 12,
}) {
  const { i18n } = useTranslation();
  const language = i18n.language;

  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        {emptyLabel}
      </p>
    );
  }

  const shown = rows.slice(0, maxRows);
  // Scale against the largest row, not the total: with a long tail every bar but the
  // first would otherwise be a sliver, and the point of the list is comparison.
  const peak = shown.reduce((max, row) => Math.max(max, Math.abs(Number(row[valueKey]) || 0)), 0);

  return (
    <ul className="flex min-w-0 flex-col gap-1.5">
      {shown.map((row) => {
        const value = Number(row[valueKey]) || 0;
        const width = peak > 0 ? Math.max((Math.abs(value) / peak) * 100, 1.5) : 0;
        const growth = row[growthKey];
        const sentiment = resolveSentiment("higher", growth);

        const Row = onSelect ? "button" : "div";
        return (
          <li key={row.key} className="min-w-0">
            <Row
              type={onSelect ? "button" : undefined}
              onClick={onSelect ? () => onSelect(row) : undefined}
              className={`relative flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-[var(--radius-control)] px-2.5 py-2 text-start transition ${onSelect ? "hover:bg-[var(--surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]" : ""}`}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 start-0 rounded-[var(--radius-control)] bg-[var(--primary-soft)]"
                style={{ width: `${width}%` }}
              />
              <span className="relative min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]" title={row.key}>
                {row.key}
              </span>
              {secondary ? (
                <span className="relative shrink-0 whitespace-nowrap text-[11px] tabular-nums text-[var(--text-tertiary)] 2xl:text-[12px]">
                  {secondary(row)}
                </span>
              ) : null}
              {showGrowth && growth !== null && growth !== undefined ? (
                <span className={`relative shrink-0 whitespace-nowrap text-[11px] font-semibold tabular-nums 2xl:text-[12px] ${SENTIMENT_CLASS[sentiment]}`}>
                  {formatDeltaPercent(growth, language)}
                </span>
              ) : null}
              <span className="relative shrink-0 whitespace-nowrap text-[13px] font-bold tabular-nums text-[var(--text)]">
                {formatValue ? formatValue(value, row) : formatNumber(value, language)}
              </span>
              <span className="relative w-11 shrink-0 whitespace-nowrap text-end text-[11px] tabular-nums text-[var(--text-tertiary)] 2xl:text-[12px]">
                {formatPercentValue(row[shareKey], language) || "—"}
              </span>
            </Row>
          </li>
        );
      })}
      {rows.length > maxRows ? (
        <li className="px-2.5 pt-1 text-[11px] text-[var(--text-tertiary)]">
          {/* Never silently truncate: say how many rows are not drawn. */}
          +{formatNumber(rows.length - maxRows, language)}
        </li>
      ) : null}
    </ul>
  );
}
