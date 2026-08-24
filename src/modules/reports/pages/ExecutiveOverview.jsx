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
import ReportExportMenu from "../components/ReportExportMenu";
import { Card, PeriodFootnote, ReportsHeader, ReportsPage, Subtle } from "../components/ReportsLayout";
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
    <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
      <div className="space-y-5">
        <ReportsHeader title={t("overview.title")} subtitle={t("overview.subtitle")}>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector
              filters={filters}
              allowedComparisons={allowedComparisons}
              onPresetChange={setPreset}
              onCompareChange={setCompare}
              onRefresh={refresh}
              busy={busy}
            />
            <ReportExportMenu
              reportKey="overview"
              title={t("overview.title")}
              filters={filters}
              language={i18n.language}
              sheets={() => buildOverviewSheets({ t, language: i18n.language, data, showProfit })}
            />
          </div>
        </ReportsHeader>

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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:gap-4">
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

            {/*
              Trend leads, highlights sit beside it, and the operating KPIs tuck under
              the highlights rather than claiming a full row of their own. That removes
              the tall empty column the old 2fr/1fr split left whenever highlights were
              short, and keeps the chart as the visual anchor.
            */}
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] 2xl:gap-5">
              <Card
                title={t("overview.trend.title")}
                className="min-h-0"
                bodyClassName="flex min-h-0 flex-col"
              >
                <OverviewTrendChart
                  trend={data.trend}
                  granularity={data.period?.granularity}
                  showProfit={showProfit}
                />
              </Card>

              <div className="flex min-w-0 flex-col gap-4">
                <Card title={t("overview.highlights.title")} className="min-h-0">
                  <ManagementHighlights highlights={data.highlights} />
                </Card>
                <Subtle title={t("overview.groups.operating")}>
                  <div className="grid gap-3 grid-cols-2">
                    {OPERATING.map((metric) => (
                      <KpiTile key={metric} metric={metric} kpi={data.kpis[metric]} level={2} />
                    ))}
                  </div>
                </Subtle>
              </div>
            </div>

            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] 2xl:gap-5">
              <Card title={t("overview.categories.title")}>
                <CategoryContribution categories={data.categories} showProfit={showProfit} />
              </Card>

              {/* Level 3 — health indicators, compact rows rather than four cards. */}
              <Subtle title={t("overview.groups.health")}>
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
                  {HEALTH.map((metric) => (
                    <KpiTile key={metric} metric={metric} kpi={data.kpis[metric]} level={3} />
                  ))}
                </div>
              </Subtle>
            </div>

            <PeriodFootnote period={data.period} comparison={data.comparison} />
          </div>
        )}
      </div>
    </ReportsPage>
  );
}

/**
 * The export carries exactly what the page rendered: the same KPI set, the same
 * permission gating, the same period. Profit columns are absent rather than blank when
 * the caller may not see them, so a file cannot become a way around the mask.
 */
const buildOverviewSheets = ({ t, language, data, showProfit }) => {
  const sheets = [];
  const kpis = data?.kpis || {};
  const metrics = [...PRIMARY, ...OPERATING, ...HEALTH].filter(
    (metric) => kpis[metric] && !kpis[metric].restricted && (showProfit || !PROFIT_METRICS.includes(metric))
  );

  sheets.push({
    name: t("overview.groups.primary"),
    columns: [
      { key: "metric", label: t("overview.kpi.netSales") },
      { key: "value", label: t("overview.period.label", { defaultValue: "Value" }), align: "end" },
      { key: "previous", label: t("overview.compare.label"), align: "end" },
    ],
    rows: metrics.map((metric) => ({
      metric: t(`overview.kpi.${metric}`),
      value: kpis[metric].current,
      previous: kpis[metric].previous ?? null,
    })),
  });

  if (data?.categories?.length) {
    sheets.push({
      name: t("overview.categories.title"),
      columns: [
        { key: "key", label: t("overview.categories.title") },
        { key: "netSales", label: t("overview.kpi.netSales"), align: "end" },
        ...(showProfit ? [{ key: "grossProfit", label: t("overview.kpi.grossProfit"), align: "end" }] : []),
        { key: "share", label: t("overview.kpi.discountRate"), align: "end", kind: "percent" },
      ],
      rows: data.categories,
    });
  }

  if (data?.trend?.length) {
    sheets.push({
      name: t("overview.trend.title"),
      columns: [
        { key: "bucket", label: t("overview.trend.title"), kind: "text" },
        { key: "netSales", label: t("overview.trend.netSales"), align: "end" },
        ...(showProfit ? [{ key: "grossProfit", label: t("overview.trend.grossProfit"), align: "end" }] : []),
        { key: "orders", label: t("overview.trend.orders"), align: "end" },
      ],
      rows: data.trend,
    });
  }

  return { sheets, language };
};

/** Metrics that carry margin, and therefore follow the profit permission. */
const PROFIT_METRICS = ["grossProfit", "grossMargin"];
