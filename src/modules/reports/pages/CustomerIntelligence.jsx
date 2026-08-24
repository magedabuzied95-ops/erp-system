import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import useCustomerFilters from "../hooks/useCustomerFilters";
import useAnalyticsResource from "../hooks/useAnalyticsResource";
import { fetchCustomersBreakdown, fetchCustomersList, fetchCustomersSummary } from "../services/customersApi";
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
 * R6 — Customer Intelligence.
 *
 * The two segmentations sit side by side on purpose. Behaviour is what the orders say;
 * the loyalty tier is what the programme decided. A Gold customer who has not bought in
 * five months is invisible to either view on its own, and that row is the entire reason
 * a manager opens this page.
 *
 * This page never renders a phone number or an email address, because the API never
 * returns one. Names are present only when the account holds the customers permission;
 * without it the rows keep every figure and lose only the identity, so the totals on
 * screen stay correct rather than quietly shrinking.
 */

const SECTIONS = [
  { id: "customers-overview", key: "overview" },
  { id: "customers-segments", key: "segments" },
  { id: "customers-breakdown", key: "breakdown" },
  { id: "customers-list", key: "customers" },
];

const PRIMARY = ["activeCustomers", "newCustomers", "customerRevenue", "repeatPurchaseRate"];
const OPERATING = ["customerOrders", "averageCustomerValue", "averageOrderValue", "ordersPerCustomer"];
const HEALTH = ["totalCustomers", "returningCustomers", "lapsedCustomers", "registeredInWindow"];

export default function CustomerIntelligence() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const isArabic = String(language || "").toLowerCase().startsWith("ar");

  const filters = useCustomerFilters();

  const summary = useAnalyticsResource(fetchCustomersSummary, filters.analyticalParams);
  const breakdown = useAnalyticsResource(fetchCustomersBreakdown, filters.breakdownParams);
  const list = useAnalyticsResource(fetchCustomersList, filters.listParams);

  const busy = summary.status === "loading" || summary.status === "refreshing";
  const showNames = list.meta?.permissions?.customers !== false;
  const segmentRules = summary.meta?.segmentRules || { atRiskAfterDays: 60, dormantAfterDays: 180 };

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
        <ReportsHeader title={t("customerAnalytics.title")} subtitle={t("customerAnalytics.subtitle")} />
        <OverviewForbidden />
      </ReportsPage>
    );
  }

  const kpis = summary.data?.kpis || {};
  const segments = summary.data?.segments || [];
  const tiers = summary.data?.tiers || [];

  const segmentRows = segments
    .map((entry) => ({
      key: t(`customerAnalytics.segment.${entry.segment}`, { defaultValue: entry.segment }),
      code: entry.segment,
      customers: entry.customers,
      revenue: entry.revenue,
      orders: entry.orders,
      share: null,
    }))
    .sort((a, b) => b.customers - a.customers);

  const totalSegmentCustomers = segmentRows.reduce((sum, row) => sum + row.customers, 0);
  segmentRows.forEach((row) => {
    row.share = totalSegmentCustomers > 0 ? row.customers / totalSegmentCustomers : null;
  });

  return (
    <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
      <div className="space-y-5">
        <ReportsHeader title={t("customerAnalytics.title")} subtitle={t("customerAnalytics.subtitle")}>
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
              reportKey="customers"
              title={t("customerAnalytics.title")}
              filters={filters.filters}
              language={language}
              sheets={buildExportSheets({ t, language, showNames, summary, breakdown, list, segmentRows })}
            />
          </div>
        </ReportsHeader>

        <SectionNav sections={SECTIONS} namespace="customerAnalytics" />

        <OverviewWarnings warnings={warnings} />

        <section id="customers-overview" aria-label={t("customerAnalytics.groups.primary")} className="scroll-mt-28 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:gap-4">
            {PRIMARY.map((metric) => (
              <KpiTile key={metric} metric={metric} kpi={kpis[metric]} level={1} />
            ))}
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] 2xl:gap-5">
            <Card title={t("customerAnalytics.sections.trend")} subtitle={t("customerAnalytics.trend.subtitle")}>
              <SeriesChart
                points={summary.data?.trend || []}
                granularity={summary.meta?.granularity || "day"}
                emptyLabel={t("customerAnalytics.trend.empty")}
                series={[
                  { key: "activeCustomers", label: t("customerAnalytics.trend.active"), type: "area" },
                  { key: "newCustomers", label: t("customerAnalytics.trend.new"), type: "line", color: "var(--info)" },
                ]}
              />
            </Card>

            <div className="flex min-w-0 flex-col gap-4">
              <Card title={t("customerAnalytics.sections.highlights")}>
                <ManagementHighlights highlights={summary.data?.highlights || []} namespace="customerAnalytics" />
              </Card>
              <Subtle title={t("customerAnalytics.groups.operating")}>
                <div className="grid grid-cols-2 gap-3">
                  {OPERATING.map((metric) => (
                    <KpiTile key={metric} metric={metric} kpi={kpis[metric]} level={2} />
                  ))}
                </div>
              </Subtle>
            </div>
          </div>

          <Subtle title={t("customerAnalytics.groups.health")}>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {HEALTH.map((metric) => (
                <KpiTile key={metric} metric={metric} kpi={kpis[metric]} level={3} />
              ))}
            </div>
          </Subtle>
        </section>

        <SectionCard
          id="customers-segments"
          title={t("customerAnalytics.sections.segments")}
          subtitle={t("customerAnalytics.segments.subtitle")}
          status={summary.status}
          error={summary.error}
          onRetry={summary.refresh}
          skeletonHeight={280}
        >
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <div className="min-w-0">
              <h3 className="m1-section-title mb-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {t("customerAnalytics.segments.behaviour")}
              </h3>
              <BreakdownBars
                rows={segmentRows}
                valueKey="customers"
                shareKey="share"
                showGrowth={false}
                formatValue={(value) => formatNumber(value, language)}
                secondary={(row) => formatMoney(row.revenue, language) || "—"}
                emptyLabel={t("customerAnalytics.segments.empty")}
                maxRows={CUSTOMER_SEGMENT_ORDER.length}
              />
              <ul className="mt-2 space-y-0.5">
                {segmentRows.map((row) => (
                  <li key={row.code} className="text-[11px] text-[var(--text-tertiary)]">
                    <b className="font-semibold text-[var(--text-secondary)]">{row.key}</b>
                    {" — "}
                    {t(`customerAnalytics.segmentHint.${row.code}`, {
                      defaultValue: "",
                      atRisk: segmentRules.atRiskAfterDays,
                      dormant: segmentRules.dormantAfterDays,
                    })}
                  </li>
                ))}
              </ul>
            </div>

            <div className="min-w-0">
              <h3 className="m1-section-title mb-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {t("customerAnalytics.segments.tier")}
              </h3>
              {!tiers.length ? (
                <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
                  {t("customerAnalytics.segments.empty")}
                </p>
              ) : (
                <div className="-mx-1 overflow-x-auto rounded-xl border border-[var(--border)]">
                  <table className="m1-table m1-table--compact w-full min-w-[380px] text-[13px]">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th scope="col" className="px-3 py-2 text-start text-[12px] font-bold text-[var(--text-tertiary)]">
                          {t("customerAnalytics.breakdown.dimension.tier")}
                        </th>
                        <th scope="col" className="px-3 py-2 text-end text-[12px] font-bold text-[var(--text-tertiary)]">
                          {t("customerAnalytics.segments.customers")}
                        </th>
                        <th scope="col" className="px-3 py-2 text-end text-[12px] font-bold text-[var(--text-tertiary)]">
                          {t("customerAnalytics.segments.revenue")}
                        </th>
                        <th scope="col" className="px-3 py-2 text-end text-[12px] font-bold text-[var(--text-tertiary)]" title={t("customerAnalytics.segments.lapsedHint")}>
                          {t("customerAnalytics.segments.lapsed")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tiers.map((tier) => (
                        <tr key={tier.tier} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-3 py-2 font-semibold text-[var(--text)]">{tier.tier}</td>
                          <td className="px-3 py-2 text-end tabular-nums text-[var(--text-secondary)]">{formatNumber(tier.customers, language)}</td>
                          <td className="px-3 py-2 text-end tabular-nums text-[var(--text-secondary)]">{formatMoney(tier.revenue, language) || "—"}</td>
                          <td className={`px-3 py-2 text-end font-semibold tabular-nums ${tier.lapsed > 0 ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]"}`}>
                            {formatNumber(tier.lapsed, language)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          id="customers-breakdown"
          title={t("customerAnalytics.sections.breakdown")}
          subtitle={t("customerAnalytics.breakdown.subtitle")}
          status={breakdown.status}
          error={breakdown.error}
          onRetry={breakdown.refresh}
          actions={
            <DimensionPicker
              value={filters.dimension}
              options={breakdown.meta?.availableDimensions || ["segment", "tier", "channel", "branch"]}
              onChange={filters.setDimension}
              label={t("customerAnalytics.breakdown.dimension.label")}
            />
          }
          skeletonHeight={280}
        >
          <BreakdownBars
            rows={(breakdown.data?.rows || []).map((row) => ({
              ...row,
              key: filters.dimension === "segment" ? t(`customerAnalytics.segment.${row.key}`, { defaultValue: row.key }) : row.key,
            }))}
            valueKey="revenue"
            shareKey="revenueShare"
            formatValue={(value) => formatMoney(value, language) || "—"}
            secondary={(row) => `${formatNumber(row.customers, language)} · ${formatNumber(row.orders, language)}`}
            emptyLabel={t("customerAnalytics.breakdown.empty")}
          />
        </SectionCard>

        <SectionCard
          id="customers-list"
          title={t("customerAnalytics.sections.customers")}
          subtitle={t("customerAnalytics.customers.subtitle")}
          status={list.status}
          error={list.error}
          onRetry={list.refresh}
          collapsible
          openOnDesktop
          skeletonHeight={320}
          note={showNames ? t("customerAnalytics.privacy.namesVisible") : t("customerAnalytics.privacy.namesHidden")}
        >
          <AnalyticsTable
            columns={customerColumns({ t, language, showNames })}
            rows={list.data?.rows || []}
            pagination={list.data?.pagination}
            sort={list.meta?.sort || { key: filters.sort, direction: filters.sortDir }}
            onSort={filters.setSort}
            onPage={filters.setPage}
            onSearch={showNames ? filters.setSearch : undefined}
            search={filters.search}
            searchPlaceholder={t("customerAnalytics.table.search")}
            emptyLabel={t("customerAnalytics.customers.empty")}
            rowKey={(row) => row.customerId}
            minWidth={880}
            labels={{ showing: "customerAnalytics.table.showing", prev: "customerAnalytics.table.prev", next: "customerAnalytics.table.next" }}
          />
        </SectionCard>

        <Card>
          <h3 className="m1-section-title mb-1.5 text-[12px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            {t("customerAnalytics.privacy.title")}
          </h3>
          <p className="text-[12px] leading-5 text-[var(--text-secondary)]">{t("customerAnalytics.privacy.contact")}</p>
        </Card>

        <PeriodFootnote period={{ from: filters.filters.from, to: filters.filters.to }} comparison={summary.meta?.comparison} />
      </div>
    </ReportsPage>
  );
}

/** Display order for the behaviour segments: won, retained, then lapsing. */
const CUSTOMER_SEGMENT_ORDER = ["new", "new_repeat", "active_repeat", "recent", "at_risk", "dormant", "never_ordered"];

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
            {t(`customerAnalytics.breakdown.dimension.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

const customerColumns = ({ t, language, showNames }) => [
  {
    key: "customer",
    label: t("customerAnalytics.customers.columns.customer"),
    cellClassName: "font-semibold text-[var(--text)]",
    render: (row) => (
      <span className="block max-w-[220px] truncate" title={row.customerName || undefined}>
        {/* An anonymised row keeps its rank so the list still reads as a ranking, rather
            than as a table of blanks. */}
        {showNames && row.customerName ? row.customerName : t("customerAnalytics.customers.anonymised", { rank: row.rank })}
      </span>
    ),
  },
  {
    key: "segment",
    label: t("customerAnalytics.customers.columns.segment"),
    render: (row) => (
      <span className="rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
        {t(`customerAnalytics.segment.${row.segment}`, { defaultValue: row.segment })}
      </span>
    ),
  },
  { key: "tier", label: t("customerAnalytics.customers.columns.tier"), render: (row) => row.tier || <Blank /> },
  {
    key: "orders", label: t("customerAnalytics.customers.columns.orders"), sortable: true, align: "end",
    render: (row) => formatNumber(row.orders, language),
  },
  {
    key: "units", label: t("customerAnalytics.customers.columns.units"), sortable: true, align: "end",
    render: (row) => formatNumber(row.units, language),
  },
  {
    key: "net_sales", label: t("customerAnalytics.customers.columns.netSales"), sortable: true, align: "end",
    cellClassName: "font-bold text-[var(--text)]",
    render: (row) => formatMoney(row.netSales, language) || <Blank />,
  },
  {
    key: "share", label: t("customerAnalytics.customers.columns.share"), align: "end",
    render: (row) => formatPercentValue(row.salesShare, language) || <Blank />,
  },
  {
    key: "average_order", label: t("customerAnalytics.customers.columns.averageOrder"), sortable: true, align: "end",
    render: (row) => formatMoney(row.averageOrderValue, language) || <Blank />,
  },
  {
    key: "lifetime", label: t("customerAnalytics.customers.columns.lifetime"), align: "end",
    render: (row) => (
      <span className="inline-flex flex-col items-end leading-tight">
        <span>{formatMoney(row.lifetimeRevenue, language) || "—"}</span>
        <span className="text-[11px] text-[var(--text-tertiary)]">{formatNumber(row.lifetimeOrders, language)}</span>
      </span>
    ),
  },
  {
    key: "last_order", label: t("customerAnalytics.customers.columns.sinceLast"), sortable: true, align: "end",
    render: (row) => {
      if (row.daysSinceLastOrder === null || row.daysSinceLastOrder === undefined) return <Blank />;
      const sentiment = resolveSentiment("lower", row.daysSinceLastOrder >= 60 ? 1 : -1);
      return <span className={row.daysSinceLastOrder >= 60 ? SENTIMENT_CLASS[sentiment] : ""}>{formatNumber(row.daysSinceLastOrder, language)}</span>;
    },
  },
];

/* --------------------------------------------------------------------- export */

const buildExportSheets = ({ t, language, showNames, summary, breakdown, list, segmentRows }) => () => {
  const sheets = [];
  const kpis = summary.data?.kpis || {};

  sheets.push({
    name: t("customerAnalytics.groups.primary"),
    columns: [
      { key: "metric", label: t("customerAnalytics.breakdown.columns.key") },
      { key: "value", label: t("customerAnalytics.breakdown.columns.revenue"), align: "end" },
    ],
    rows: [...PRIMARY, ...OPERATING, ...HEALTH]
      .filter((metric) => kpis[metric] && !kpis[metric].restricted)
      .map((metric) => ({ metric: t(`overview.kpi.${metric}`), value: kpis[metric].current })),
  });

  if (segmentRows?.length) {
    sheets.push({
      name: t("customerAnalytics.segments.behaviour"),
      columns: [
        { key: "key", label: t("customerAnalytics.breakdown.columns.key") },
        { key: "customers", label: t("customerAnalytics.segments.customers"), align: "end" },
        { key: "orders", label: t("customerAnalytics.segments.orders"), align: "end" },
        { key: "revenue", label: t("customerAnalytics.segments.revenue"), align: "end" },
      ],
      rows: segmentRows,
    });
  }

  if (summary.data?.tiers?.length) {
    sheets.push({
      name: t("customerAnalytics.segments.tier"),
      columns: [
        { key: "tier", label: t("customerAnalytics.breakdown.dimension.tier") },
        { key: "customers", label: t("customerAnalytics.segments.customers"), align: "end" },
        { key: "revenue", label: t("customerAnalytics.segments.revenue"), align: "end" },
        { key: "lapsed", label: t("customerAnalytics.segments.lapsed"), align: "end" },
      ],
      rows: summary.data.tiers,
    });
  }

  if (breakdown.data?.rows?.length) {
    sheets.push({
      name: t("customerAnalytics.sections.breakdown"),
      columns: [
        { key: "key", label: t("customerAnalytics.breakdown.columns.key") },
        { key: "customers", label: t("customerAnalytics.breakdown.columns.customers"), align: "end" },
        { key: "activeCustomers", label: t("customerAnalytics.breakdown.columns.active"), align: "end" },
        { key: "orders", label: t("customerAnalytics.breakdown.columns.orders"), align: "end" },
        { key: "units", label: t("customerAnalytics.breakdown.columns.units"), align: "end" },
        { key: "revenue", label: t("customerAnalytics.breakdown.columns.revenue"), align: "end" },
      ],
      rows: breakdown.data.rows,
    });
  }

  if (list.data?.rows?.length) {
    sheets.push({
      name: t("customerAnalytics.sections.customers"),
      columns: [
        // The identity column follows the same rule as the screen: a name only when the
        // account may see one, and a rank otherwise. An export must not be a way around
        // a permission the page enforces.
        {
          key: showNames ? "customerName" : "rank",
          label: showNames ? t("customerAnalytics.customers.columns.customer") : "#",
        },
        { key: "segment", label: t("customerAnalytics.customers.columns.segment") },
        { key: "tier", label: t("customerAnalytics.customers.columns.tier") },
        { key: "orders", label: t("customerAnalytics.customers.columns.orders"), align: "end" },
        { key: "units", label: t("customerAnalytics.customers.columns.units"), align: "end" },
        { key: "netSales", label: t("customerAnalytics.customers.columns.netSales"), align: "end" },
        { key: "averageOrderValue", label: t("customerAnalytics.customers.columns.averageOrder"), align: "end" },
        { key: "lifetimeRevenue", label: t("customerAnalytics.customers.columns.lifetime"), align: "end" },
        { key: "daysSinceLastOrder", label: t("customerAnalytics.customers.columns.sinceLast"), align: "end" },
      ],
      rows: list.data.rows,
    });
  }

  return { sheets, language };
};
