import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

import useEmployeeFilters from "../hooks/useEmployeeFilters";
import useAnalyticsResource from "../hooks/useAnalyticsResource";
import { fetchEmployeesBreakdown, fetchEmployeesList, fetchEmployeesSummary } from "../services/employeesApi";
import PeriodSelector from "../components/PeriodSelector";
import KpiTile from "../components/KpiTile";
import SectionCard from "../components/SectionCard";
import SectionNav from "../components/SectionNav";
import ManagementHighlights from "../components/ManagementHighlights";
import BreakdownBars from "../components/BreakdownBars";
import SeriesChart from "../components/SeriesChart";
import AnalyticsTable, { Blank } from "../components/AnalyticsTable";
import ReportExportMenu from "../components/ReportExportMenu";
import { Card, PeriodFootnote, ReportsHeader, ReportsPage, Subtle } from "../components/ReportsLayout";
import { OverviewForbidden, OverviewWarnings } from "../components/OverviewStates";
import { formatDeltaPercent, formatMoney, formatPercentValue, resolveSentiment, SENTIMENT_CLASS } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * R9 — Employee & Channel Intelligence.
 *
 * The page states, on screen and above the numbers, WHICH column it attributed sales
 * from and what that column covers. That is not a footnote here: `orders` carries six
 * candidate seller columns and the frozen contract's declared first choice is empty on
 * production, so a reader who does not know which one was used cannot judge the figures.
 *
 * Orders with no seller are their own row, always visible, never shared out.
 */

const SECTIONS = [
  { id: "employees-overview", key: "overview" },
  { id: "employees-breakdown", key: "breakdown" },
  { id: "employees-sellers", key: "sellers" },
];

const PRIMARY = ["sellerNetSales", "sellerOrders", "activeSellers", "averageOrderValue"];
const OPERATING = ["sellerUnits", "salesPerSeller", "activeCashiers", "activeChannels"];
const HEALTH = ["attributionCoverage", "unattributedNetSales"];

export default function EmployeeIntelligence() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const isArabic = String(language || "").toLowerCase().startsWith("ar");

  const filters = useEmployeeFilters();
  const summary = useAnalyticsResource(fetchEmployeesSummary, filters.analyticalParams);
  const breakdown = useAnalyticsResource(fetchEmployeesBreakdown, filters.breakdownParams);
  const list = useAnalyticsResource(fetchEmployeesList, filters.listParams);

  const busy = summary.status === "loading" || summary.status === "refreshing";
  const attribution = summary.meta?.attribution || null;

  const refreshAll = () => {
    summary.refresh();
    breakdown.refresh();
    list.refresh();
  };

  const warnings = useMemo(() => {
    const seen = new Set();
    return [...(summary.warnings || []), ...(breakdown.warnings || []), ...(list.warnings || [])].filter((warning) => {
      if (seen.has(warning.code)) return false;
      seen.add(warning.code);
      return true;
    });
  }, [summary.warnings, breakdown.warnings, list.warnings]);

  if (summary.status === "forbidden") {
    return (
      <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
        <ReportsHeader title={t("employeeAnalytics.title")} subtitle={t("employeeAnalytics.subtitle")} />
        <OverviewForbidden />
      </ReportsPage>
    );
  }

  const kpis = summary.data?.kpis || {};
  const unattributedLabel = t("employeeAnalytics.sellers.unattributed");
  const label = (key) => (key === "__unattributed__" ? unattributedLabel : key);

  return (
    <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
      <div className="space-y-5">
        <ReportsHeader title={t("employeeAnalytics.title")} subtitle={t("employeeAnalytics.subtitle")}>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector
              filters={filters.filters}
              allowedComparisons={filters.allowedComparisons}
              onPresetChange={filters.setPreset}
              onCompareChange={filters.setCompare}
              onRefresh={refreshAll}
              busy={busy}
            />
            <ReportExportMenu
              reportKey="employees"
              title={t("employeeAnalytics.title")}
              filters={filters.filters}
              language={language}
              sheets={buildExportSheets({ t, language, summary, breakdown, list, label })}
            />
          </div>
        </ReportsHeader>

        <SectionNav sections={SECTIONS} namespace="employeeAnalytics" />

        <OverviewWarnings warnings={warnings} />

        <AttributionBanner attribution={attribution} language={language} />

        <section id="employees-overview" aria-label={t("employeeAnalytics.groups.primary")} className="scroll-mt-28 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:gap-4">
            {PRIMARY.map((metric) => (
              <KpiTile key={metric} metric={metric} kpi={kpis[metric]} level={1} />
            ))}
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] 2xl:gap-5">
            <Card title={t("employeeAnalytics.sections.trend")} subtitle={t("employeeAnalytics.trend.subtitle")}>
              <SeriesChart
                points={summary.data?.trend || []}
                granularity={summary.meta?.granularity || "day"}
                emptyLabel={t("employeeAnalytics.trend.empty")}
                formatTooltipValue={(value, key) =>
                  (key === "revenue" ? formatMoney(value, language) : formatNumber(value, language)) ?? "—"
                }
                series={[
                  { key: "revenue", label: t("employeeAnalytics.trend.revenue"), type: "area" },
                  { key: "sellers", label: t("employeeAnalytics.trend.sellers"), type: "line", color: "var(--info)" },
                ]}
              />
            </Card>

            <div className="flex min-w-0 flex-col gap-4">
              <Card title={t("employeeAnalytics.sections.highlights")}>
                <ManagementHighlights highlights={summary.data?.highlights || []} namespace="employeeAnalytics" />
              </Card>
              <Subtle title={t("employeeAnalytics.groups.operating")}>
                <div className="grid grid-cols-2 gap-3">
                  {OPERATING.map((metric) => (
                    <KpiTile key={metric} metric={metric} kpi={kpis[metric]} level={2} />
                  ))}
                </div>
              </Subtle>
            </div>
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:gap-5">
            <Subtle title={t("employeeAnalytics.groups.health")}>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {HEALTH.map((metric) => (
                  <KpiTile key={metric} metric={metric} kpi={kpis[metric]} level={3} />
                ))}
              </div>
            </Subtle>
            <Card title={t("employeeAnalytics.concentration.title")} subtitle={t("employeeAnalytics.concentration.subtitle")}>
              <Concentration concentration={summary.data?.concentration} language={language} />
            </Card>
          </div>
        </section>

        <SectionCard
          id="employees-breakdown"
          title={t("employeeAnalytics.sections.breakdown")}
          subtitle={t("employeeAnalytics.breakdown.subtitle")}
          status={breakdown.status}
          error={breakdown.error}
          onRetry={breakdown.refresh}
          note={filters.dimension === "cashier" ? t("employeeAnalytics.breakdown.cashierNote") : undefined}
          actions={
            <DimensionPicker
              value={filters.dimension}
              options={breakdown.meta?.availableDimensions || ["seller", "cashier", "channel", "branch"]}
              onChange={filters.setDimension}
              label={t("employeeAnalytics.breakdown.dimension.label")}
            />
          }
          skeletonHeight={280}
        >
          {breakdown.data?.withheld ? (
            <p className="rounded-xl border border-dashed border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-6 text-center text-[13px] text-[var(--text-secondary)]">
              {t("employeeAnalytics.breakdown.withheld")}
            </p>
          ) : (
            <BreakdownBars
              rows={(breakdown.data?.rows || []).map((row) => ({ ...row, key: label(row.key) }))}
              valueKey="revenue"
              shareKey="revenueShare"
              formatValue={(value) => formatMoney(value, language) || "—"}
              secondary={(row) => `${formatNumber(row.orders, language)} · ${formatNumber(row.units, language)}`}
              emptyLabel={t("employeeAnalytics.breakdown.empty")}
            />
          )}
        </SectionCard>

        <SectionCard
          id="employees-sellers"
          title={t("employeeAnalytics.sections.sellers")}
          subtitle={t("employeeAnalytics.sellers.subtitle")}
          status={list.status}
          error={list.error}
          onRetry={list.refresh}
          collapsible
          openOnDesktop
          skeletonHeight={320}
        >
          {list.data?.withheld ? (
            <p className="rounded-xl border border-dashed border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-6 text-center text-[13px] text-[var(--text-secondary)]">
              {t("employeeAnalytics.breakdown.withheld")}
            </p>
          ) : (
            <AnalyticsTable
              columns={sellerColumns({ t, language, unattributedLabel })}
              rows={list.data?.rows || []}
              pagination={list.data?.pagination}
              sort={list.meta?.sort || { key: filters.sort, direction: filters.sortDir }}
              onSort={filters.setSort}
              onPage={filters.setPage}
              emptyLabel={t("employeeAnalytics.sellers.empty")}
              rowKey={(row) => row.seller}
              minWidth={860}
              labels={{ showing: "employeeAnalytics.table.showing", prev: "employeeAnalytics.table.prev", next: "employeeAnalytics.table.next" }}
            />
          )}
        </SectionCard>

        <Card>
          <h3 className="m1-section-title mb-1.5 text-[12px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            {t("employeeAnalytics.basis.title")}
          </h3>
          <p className="text-[12px] leading-5 text-[var(--text-secondary)]">{t("employeeAnalytics.basis.revenue")}</p>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{t("employeeAnalytics.basis.noProfit")}</p>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{t("employeeAnalytics.basis.notCommission")}</p>
        </Card>

        <PeriodFootnote period={{ from: filters.filters.from, to: filters.filters.to }} comparison={summary.meta?.comparison} />
      </div>
    </ReportsPage>
  );
}

/* ------------------------------------------------------------------ panels */

/**
 * The attribution statement, above the numbers rather than beneath them.
 *
 * A reader cannot judge a per-seller figure without knowing which column produced it and
 * how much of the period that column covers, so both are on screen — along with the
 * columns that were considered and rejected, and why an unattributed row exists.
 */
function AttributionBanner({ attribution, language }) {
  const { t } = useTranslation();
  if (!attribution) return null;

  if (!attribution.field) {
    return (
      <section className="rounded-[var(--radius-card)] border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-4 py-3">
        <p className="text-[13px] text-[var(--text)]">{t("employeeAnalytics.attribution.unavailable")}</p>
      </section>
    );
  }

  return (
    <Card title={t("employeeAnalytics.sections.attribution")} subtitle={t("employeeAnalytics.attribution.subtitle")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label={t("employeeAnalytics.attribution.using")} value={<code className="text-[13px]">{attribution.label}</code>} />
        <Figure label={t("employeeAnalytics.attribution.coverage")} value={formatPercentValue(attribution.coverage, language) || "—"} />
        <Figure
          label={t("employeeAnalytics.attribution.attributed")}
          value={`${formatNumber(attribution.attributedOrders, language)} / ${formatNumber(attribution.totalOrders, language)}`}
        />
      </div>

      {attribution.candidates?.length ? (
        <div className="mt-3">
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
            {t("employeeAnalytics.attribution.candidates")}
          </h4>
          <ul className="flex flex-col gap-1">
            {attribution.candidates.map((candidate) => (
              <li key={candidate.field} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                <code className={candidate.field === attribution.field ? "font-bold text-[var(--text)]" : "text-[var(--text-tertiary)]"}>
                  {candidate.label}
                </code>
                <span className="tabular-nums text-[var(--text-secondary)]">
                  {t("employeeAnalytics.attribution.candidateCoverage", {
                    covered: formatNumber(candidate.covered, language),
                    total: formatNumber(attribution.totalOrders, language),
                  })}
                </span>
                {candidate.field === attribution.field ? (
                  <span className="rounded-[var(--radius-control)] bg-[var(--primary-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                    {t("employeeAnalytics.attribution.chosen")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-[var(--text-tertiary)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {t("employeeAnalytics.attribution.note")} {t("employeeAnalytics.attribution.unattributedNote")}
        </span>
      </p>
    </Card>
  );
}

function Concentration({ concentration, language }) {
  const { t } = useTranslation();
  if (!concentration) return null;
  if (concentration.topShare === null) {
    return (
      <div className="space-y-2">
        <Figure label={t("employeeAnalytics.concentration.sellers")} value={formatNumber(concentration.sellerCount, language)} />
        <p className="text-[13px] text-[var(--text-tertiary)]">{t("employeeAnalytics.concentration.unavailable")}</p>
      </div>
    );
  }
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <Figure label={t("employeeAnalytics.concentration.topShare")} value={formatPercentValue(concentration.topShare, language)} />
      <Figure label={t("employeeAnalytics.concentration.topThreeShare")} value={formatPercentValue(concentration.topThreeShare, language)} />
      <Figure label={t("employeeAnalytics.concentration.sellers")} value={formatNumber(concentration.sellerCount, language)} />
      <Figure
        label={t("employeeAnalytics.concentration.hhi")}
        value={concentration.hhi === null ? "—" : formatNumber(Number(concentration.hhi.toFixed(2)), language)}
      />
    </dl>
  );
}

function Figure({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] font-semibold text-[var(--text-tertiary)] 2xl:text-[12px]">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-bold tabular-nums text-[var(--text)] 2xl:text-[18px]">{value ?? "—"}</dd>
    </div>
  );
}

function DimensionPicker({ value, options, onChange, label }) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-[var(--control-height-sm)] rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-soft)] px-2 text-[12px] font-semibold text-[var(--text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {t(`employeeAnalytics.breakdown.dimension.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

const sellerColumns = ({ t, language, unattributedLabel }) => [
  {
    key: "seller",
    label: t("employeeAnalytics.sellers.columns.seller"),
    sortable: true,
    cellClassName: "font-semibold text-[var(--text)]",
    render: (row) => (
      <span className={`block max-w-[220px] truncate ${row.unattributed ? "italic text-[var(--text-tertiary)]" : ""}`}>
        {row.unattributed ? unattributedLabel : row.seller}
      </span>
    ),
  },
  { key: "orders", label: t("employeeAnalytics.sellers.columns.orders"), sortable: true, align: "end", render: (row) => formatNumber(row.orders, language) },
  { key: "units", label: t("employeeAnalytics.sellers.columns.units"), sortable: true, align: "end", render: (row) => formatNumber(row.units, language) },
  {
    key: "net_sales", label: t("employeeAnalytics.sellers.columns.netSales"), sortable: true, align: "end",
    cellClassName: "font-bold text-[var(--text)]",
    render: (row) => formatMoney(row.netSales, language) || <Blank />,
  },
  { key: "share", label: t("employeeAnalytics.sellers.columns.share"), align: "end", render: (row) => formatPercentValue(row.salesShare, language) || <Blank /> },
  {
    key: "average_order", label: t("employeeAnalytics.sellers.columns.averageOrder"), sortable: true, align: "end",
    render: (row) => formatMoney(row.averageOrderValue, language) || <Blank />,
  },
  { key: "refunded", label: t("employeeAnalytics.sellers.columns.refunded"), align: "end", render: (row) => formatMoney(row.refunded, language) || <Blank /> },
  { key: "channels", label: t("employeeAnalytics.sellers.columns.channels"), align: "end", render: (row) => formatNumber(row.channels, language) },
  {
    key: "growth", label: t("employeeAnalytics.sellers.columns.growth"), align: "end",
    render: (row) => {
      if (row.growth === null || row.growth === undefined) return <Blank />;
      const sentiment = resolveSentiment("higher", row.growth);
      return <span className={`font-semibold ${SENTIMENT_CLASS[sentiment]}`}>{formatDeltaPercent(row.growth, language)}</span>;
    },
  },
];

/* --------------------------------------------------------------------- export */

const buildExportSheets = ({ t, language, summary, breakdown, list, label }) => () => {
  const sheets = [];
  const kpis = summary.data?.kpis || {};
  const attribution = summary.meta?.attribution;

  sheets.push({
    name: t("employeeAnalytics.groups.primary"),
    columns: [
      { key: "metric", label: t("employeeAnalytics.breakdown.columns.key") },
      { key: "value", label: t("employeeAnalytics.breakdown.columns.revenue"), align: "end" },
    ],
    rows: [
      // The attribution statement travels with the file. A per-seller export read a week
      // later is unreadable without knowing which column produced it.
      ...(attribution?.field
        ? [
            { metric: t("employeeAnalytics.attribution.using"), value: attribution.label },
            { metric: t("employeeAnalytics.attribution.coverage"), value: attribution.coverage },
          ]
        : []),
      ...[...PRIMARY, ...OPERATING, ...HEALTH]
        .filter((metric) => kpis[metric] && !kpis[metric].restricted)
        .map((metric) => ({ metric: t(`overview.kpi.${metric}`), value: kpis[metric].current })),
    ],
  });

  if (breakdown.data?.rows?.length && !breakdown.data.withheld) {
    sheets.push({
      name: t("employeeAnalytics.sections.breakdown"),
      columns: [
        { key: "key", label: t("employeeAnalytics.breakdown.columns.key") },
        { key: "orders", label: t("employeeAnalytics.breakdown.columns.orders"), align: "end" },
        { key: "units", label: t("employeeAnalytics.breakdown.columns.units"), align: "end" },
        { key: "revenue", label: t("employeeAnalytics.breakdown.columns.revenue"), align: "end" },
        { key: "averageOrderValue", label: t("employeeAnalytics.breakdown.columns.averageOrder"), align: "end" },
      ],
      rows: breakdown.data.rows.map((row) => ({ ...row, key: label(row.key) })),
    });
  }

  if (list.data?.rows?.length && !list.data.withheld) {
    sheets.push({
      name: t("employeeAnalytics.sections.sellers"),
      columns: [
        { key: "seller", label: t("employeeAnalytics.sellers.columns.seller") },
        { key: "orders", label: t("employeeAnalytics.sellers.columns.orders"), align: "end" },
        { key: "units", label: t("employeeAnalytics.sellers.columns.units"), align: "end" },
        { key: "netSales", label: t("employeeAnalytics.sellers.columns.netSales"), align: "end" },
        { key: "averageOrderValue", label: t("employeeAnalytics.sellers.columns.averageOrder"), align: "end" },
        { key: "refunded", label: t("employeeAnalytics.sellers.columns.refunded"), align: "end" },
      ],
      rows: list.data.rows.map((row) => ({ ...row, seller: label(row.seller) })),
    });
  }

  return { sheets, language };
};
