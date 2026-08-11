import { useTranslation } from "react-i18next";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { formatPercentValue } from "../lib/metricFormat";

/**
 * Cost-coverage confidence, attached to profit rather than presented as its own KPI.
 *
 * >= 95%  high confidence
 * 50-95%  visible warning, value still shown
 * < 50%   profit is not presented as trustworthy at all
 */
export default function CoverageBadge({ coverage, compact = false }) {
  const { t, i18n } = useTranslation();
  if (typeof coverage !== "number" || !Number.isFinite(coverage)) return null;

  const percent = formatPercentValue(coverage, i18n.language);
  const level = coverage >= 0.95 ? "high" : coverage >= 0.5 ? "partial" : "critical";

  const tone = {
    high: "text-[var(--success)]",
    partial: "text-[var(--warning)]",
    critical: "text-[var(--danger)]",
  }[level];

  const Icon = level === "high" ? CheckCircle2 : TriangleAlert;

  return (
    <div
      className="mt-3 flex items-start gap-1.5 border-t border-[var(--border)] pt-2.5 text-[11px] leading-4"
      title={t("overview.coverage.explain")}
    >
      <Icon className={`mt-px h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className="text-[var(--text-tertiary)]">{t("overview.coverage.label")}: </span>
        <span className={`font-bold tabular-nums ${tone}`}>{percent}</span>
        {compact ? null : <span className={`ms-1.5 ${tone}`}>· {t(`overview.coverage.${level}`)}</span>}
      </span>
    </div>
  );
}
