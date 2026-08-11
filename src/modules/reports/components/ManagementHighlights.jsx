import { useTranslation } from "react-i18next";
import { CircleAlert, Info, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";

import { formatPercentValue } from "../lib/metricFormat";

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

export default function ManagementHighlights({ highlights = [] }) {
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
            className="relative flex items-start gap-2.5 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
          >
            <span className={`absolute inset-y-0 start-0 w-[3px] ${severity.bar}`} aria-hidden="true" />
            <Icon className={`mt-px h-4 w-4 shrink-0 ${severity.tone}`} aria-hidden="true" />
            <p className="min-w-0 text-[13px] leading-5 text-[var(--text)]">
              {t(`overview.${highlight.messageKey}`, buildValues(highlight, language))}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

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
});
