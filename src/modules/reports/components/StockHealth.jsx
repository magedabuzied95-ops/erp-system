import { useTranslation } from "react-i18next";

import MetricTooltip from "./MetricTooltip";
import { formatMoney } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * Movement classes as a single proportional bar plus a legend.
 *
 * One bar rather than five cards: the question is what share of capital sits in each
 * class, and a bar answers that at a glance where five equal cards do not.
 *
 * "Too new" and "unknown age" are deliberately neutral. Neither is bad inventory — one
 * has not had time to prove itself, the other has no receipt history to judge by — and
 * colouring them like a problem would be a verdict the data does not support.
 */
const CLASSES = [
  { key: "fast", bar: "bg-[var(--success)]", tone: "text-[var(--success)]" },
  { key: "steady", bar: "bg-[var(--primary)]", tone: "text-[var(--primary)]" },
  { key: "slow", bar: "bg-[var(--warning)]", tone: "text-[var(--warning)]" },
  { key: "dead_candidate", bar: "bg-[var(--danger)]", tone: "text-[var(--danger)]" },
  { key: "too_new", bar: "bg-[var(--border-strong)]", tone: "text-[var(--text-tertiary)]" },
  { key: "unknown_age", bar: "bg-[var(--border)]", tone: "text-[var(--text-tertiary)]" },
];

export default function StockHealth({ health, showValue, onSelectClass, selected }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const buckets = health?.buckets || {};

  // Products that match no rule are shown, not hidden: without them the bar would sum
  // to fewer products than the KPI above it and the two would visibly disagree.
  const unclassified = health?.unclassified || 0;
  const classified = CLASSES.reduce((sum, item) => sum + (buckets[item.key]?.products || 0), 0);
  const totalProducts = classified + unclassified;
  if (!totalProducts) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        {t("inventory.health.empty")}
      </p>
    );
  }

  const rules = health?.rules || {};

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">
        <MetricTooltip
          title={t("inventory.health.title")}
          definition={t("inventory.health.method", {
            tooNew: rules.tooNewDays,
            recent: rules.recentSaleDays,
            window: rules.demandWindowDays,
            units: rules.fastMinUnits,
            established: rules.establishedDays,
          })}
        />
        <span>{t("inventory.health.productsCount", { count: totalProducts })}</span>
      </div>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-soft)]">
        {CLASSES.map((item) => {
          const share = (buckets[item.key]?.products || 0) / totalProducts;
          if (!share) return null;
          return (
            <span
              key={item.key}
              className={item.bar}
              style={{ width: `${share * 100}%` }}
              title={`${t(`inventory.health.${item.key}`)}: ${buckets[item.key].products}`}
            />
          );
        })}
        {unclassified ? (
          <span
            className="bg-[var(--surface-soft)]"
            style={{ width: `${(unclassified / totalProducts) * 100}%` }}
            title={t("inventory.health.unclassified")}
          />
        ) : null}
      </div>

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {CLASSES.map((item) => {
          const bucket = buckets[item.key] || { products: 0, units: 0, value: 0 };
          const active = selected === item.key;
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onSelectClass?.(active ? null : item.key)}
                aria-pressed={active}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                  active ? "bg-[var(--surface-soft)]" : "hover:bg-[var(--surface-soft)]"
                }`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.bar}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[12px] font-semibold 2xl:text-[13px] ${item.tone}`}>
                    {t(`inventory.health.${item.key}`)}
                  </span>
                  <span className="block truncate text-[10px] text-[var(--text-tertiary)] 2xl:text-[11px]">
                    {t(`inventory.health.${item.key}Hint`)}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className="block text-[13px] font-bold tabular-nums text-[var(--text)]">{bucket.products}</span>
                  <span className="block text-[10px] tabular-nums text-[var(--text-tertiary)]">
                    {showValue && bucket.value
                      ? formatMoney(bucket.value, language)
                      : `${formatNumber(bucket.units, language)} ${t("inventory.units")}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {unclassified ? (
          <li>
            <span className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--surface-soft)] ring-1 ring-[var(--border)]" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-[var(--text-tertiary)] 2xl:text-[13px]">
                  {t("inventory.health.unclassified")}
                </span>
                <span className="block truncate text-[10px] text-[var(--text-tertiary)] 2xl:text-[11px]">
                  {t("inventory.health.unclassifiedHint")}
                </span>
              </span>
              <span className="shrink-0 text-end">
                <span className="block text-[13px] font-bold tabular-nums text-[var(--text-secondary)]">{unclassified}</span>
              </span>
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
