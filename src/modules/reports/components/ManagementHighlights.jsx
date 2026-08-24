import { useTranslation } from "react-i18next";
import { CircleAlert, Info, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";

import { formatMoney, formatPercentValue } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * Deterministic management highlights.
 *
 * The backend sends codes and raw values only — all wording is resolved here from the
 * i18n bundle, so no prose is generated in SQL and no LLM is involved.
 */

const SEVERITY = {
  critical: { Icon: CircleAlert, tone: "text-[var(--danger)]", bar: "bg-[var(--danger)]" },
  warning: { Icon: TriangleAlert, tone: "text-[var(--warning)]", bar: "bg-[var(--warning)]" },
  positive: { Icon: TrendingUp, tone: "text-[var(--success)]", bar: "bg-[var(--success)]" },
  info: { Icon: Info, tone: "text-[var(--info)]", bar: "bg-[var(--info)]" },
};

export default function ManagementHighlights({ highlights = [], namespace = "overview" }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  if (!highlights.length) {
    return <p className="text-[13px] text-[var(--text-tertiary)]">{t("overview.highlights.empty")}</p>;
  }

  return (
    <ul className="space-y-2">
      {highlights.map((highlight) => {
        const severity = SEVERITY[highlight.severity] || SEVERITY.info;
        const Icon = highlight.code === "SALES_DOWN" || highlight.code === "AOV_DOWN" ? TrendingDown : severity.Icon;

        return (
          <li
            key={highlight.code}
            className="relative flex items-start gap-2.5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3"
          >
            <span className={`absolute inset-y-0 start-0 w-[3px] ${severity.bar}`} aria-hidden="true" />
            <Icon className={`mt-px h-4 w-4 shrink-0 ${severity.tone}`} aria-hidden="true" />
            <p className="min-w-0 text-[13px] leading-5 text-[var(--text)]">
              {t(`${namespace}.${highlight.messageKey}`, buildValues(highlight, language))}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Interpolation values for one highlight.
 *
 * R2 highlights carry flat comparison fields; R4 carries a `values` object. Both are
 * handled here so the backend keeps returning codes and raw numbers, and every bit of
 * wording stays in the bundle.
 */
const buildValues = (highlight, language) => ({
  percent:
    typeof highlight.changePercent === "number"
      ? formatPercentValue(Math.abs(highlight.changePercent), language)
      : typeof highlight.currentValue === "number"
        ? formatPercentValue(highlight.currentValue, language)
        : "",
  points: typeof highlight.changePoints === "number" ? Math.abs(highlight.changePoints).toFixed(1) : "",
  current: typeof highlight.currentValue === "number" ? formatPercentValue(highlight.currentValue, language) : "",
  previous: typeof highlight.comparisonValue === "number" ? formatPercentValue(highlight.comparisonValue, language) : "",
  // Last, so an explicit values object always wins over the flat fallbacks above.
  ...formatHighlightValues(highlight.values, language),
});

/** Format a raw values object: ratios as percentages, money as money, counts as-is. */
const formatHighlightValues = (values, language) => {
  if (!values || typeof values !== "object") return {};
  const formatted = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "number") {
      formatted[key] = value;
    } else if (key === "percent" || key.endsWith("Percent")) {
      formatted[key] = formatPercentValue(value, language);
    } else if (key === "value" || key.endsWith("Value")) {
      formatted[key] = formatMoney(value, language);
    } else {
      formatted[key] = formatNumber(value, language);
    }
  }
  return formatted;
};
