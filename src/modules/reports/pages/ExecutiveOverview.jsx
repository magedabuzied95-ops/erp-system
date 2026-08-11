import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import useAnalyticsFilters from "../hooks/useAnalyticsFilters";
import useOverviewQuery from "../hooks/useOverviewQuery";
import PeriodSelector from "../components/PeriodSelector";
import KpiTile from "../components/KpiTile";
import CoverageBadge from "../components/CoverageBadge";
import OverviewTrendChart from "../components/OverviewTrendChart";
import CategoryContribution from "../components/CategoryContribution";
import ManagementHighlights from "../components/ManagementHighlights";
import {
  OverviewEmpty,
  OverviewError,
  OverviewForbidden,
  OverviewSkeleton,
  OverviewWarnings,
} from "../components/OverviewStates";

/**
 * Executive Overview — the reference screen for the Reporting Center.
 *
 * Three levels of visual weight rather than a uniform grid of twelve cards:
 *   1 primary financial   — the four numbers a manager reads first
 *   2 operating           — how those numbers were produced
 *   3 health              — what needs watching
 *
 * Cost coverage is attached to profit as confidence metadata, not shown as a KPI.
 */

const PRIMARY = ["netSales", "grossProfit", "grossMargin", "orders"];
const OPERATING = ["averageOrderValue", "itemsSold", "itemsPerOrder", "discountRate"];
const HEALTH = ["returns", "returnRate", "newCustomers", "inventoryValue"];

export default function ExecutiveOverview() {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");

  const { filters, requestParams, allowedComparisons, setPreset, setCompare } = useAnalyticsFilters();
  const { status, data, meta, warnings, error, refresh } = useOverviewQuery(requestParams);

  const busy = status === "loading" || status === "refreshing";
  const coverage = meta?.cogsCoverage ?? null;
  const showProfit = Boolean(meta?.permissions?.profit);

  const hasAnySales = useMemo(() => {
    if (!data) return false;
    return Boolean(data.kpis?.orders?.current) || Boolean(data.kpis?.netSales?.current) || data.trend?.length > 0;
  }, [data]);

  return (
    <div dir={isArabic ? "rtl" : "ltr"} className="min-h-full bg-[var(--bg)] px-[var(--page-inline)] py-5">
      <div className="mx-auto w-full max-w-[var(--content-max)] space-y-5">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[19px] font-extrabold tracking-tight text-[var(--text)] sm:text-[22px]">
              {t("overview.title")}
            </h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{t("overview.subtitle")}</p>
          </div>
          <PeriodSelector
            filters={filters}
            allowedComparisons={allowedComparisons}
            onPresetChange={setPreset}
            onCompareChange={setCompare}
            onRefresh={refresh}
            busy={busy}
          />
        </header>

        {status === "forbidden" ? (
          <OverviewForbidden />
        ) : status === "error" ? (
          <OverviewError error={error} onRetry={refresh} />
        ) : status === "loading" ? (
          <OverviewSkeleton />
        ) : !data ? (
          <OverviewSkeleton />
        ) : !hasAnySales ? (
          <>
            <OverviewWarnings warnings={warnings} />
            <OverviewEmpty />
          </>
        ) : (
          <div className={`space-y-5 transition-opacity ${status === "refreshing" ? "opacity-60" : "opacity-100"}`}>
            <OverviewWarnings warnings={warnings} />

            {/* Level 1 — the four figures that answer "how did we do?" */}
            <section aria-label={t("overview.groups.primary")}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {PRIMARY.map((metric) => (
                  <KpiTile
                    key={metric}
                    metric={metric}
                    kpi={data.kpis[metric]}
                    level={1}
                    coverage={
                      showProfit && (metric === "grossProfit" || metric === "grossMargin") ? (
                        <CoverageBadge coverage={coverage} compact={metric === "grossMargin"} />
                      ) : null
                    }
                  />
                ))}
              </div>
            </section>

            {/* Level 2 — operating detail */}
            <section aria-label={t("overview.groups.operating")}>
              <SectionHeading>{t("overview.groups.operating")}</SectionHeading>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {OPERATING.map((metric) => (
                  <KpiTile key={metric} metric={metric} kpi={data.kpis[metric]} level={2} />
                ))}
              </div>
            </section>

            {/* Trend + highlights side by side on wide screens */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Panel title={t("overview.trend.title")}>
                <OverviewTrendChart
                  trend={data.trend}
                  granularity={data.period?.granularity}
                  showProfit={showProfit}
                />
              </Panel>

              <Panel title={t("overview.highlights.title")}>
                <ManagementHighlights highlights={data.highlights} />
              </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Panel title={t("overview.categories.title")}>
                <CategoryContribution categories={data.categories} showProfit={showProfit} />
              </Panel>

              {/* Level 3 — health indicators, compact */}
              <section aria-label={t("overview.groups.health")}>
                <SectionHeading>{t("overview.groups.health")}</SectionHeading>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  {HEALTH.map((metric) => (
                    <KpiTile key={metric} metric={metric} kpi={data.kpis[metric]} level={3} compact />
                  ))}
                </div>
              </section>
            </div>

            <p className="pt-1 text-[11px] text-[var(--text-tertiary)]">
              {data.period.from} → {data.period.to}
              {data.comparison ? ` · ${t("overview.compare.vs")} ${data.comparison.from} → ${data.comparison.to}` : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{children}</h2>
  );
}

function Panel({ title, children }) {
  // min-w-0 is required: a grid item defaults to min-width:auto, which lets a wide
  // child (recharts' ResponsiveContainer) pin the column open and never shrink back
  // down on narrow viewports.
  return (
    <section className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-3.5 text-[13px] font-bold text-[var(--text)]">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
