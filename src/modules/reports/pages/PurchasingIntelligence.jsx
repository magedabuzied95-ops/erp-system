import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import usePurchasingFilters from "../hooks/usePurchasingFilters";
import useAnalyticsResource from "../hooks/useAnalyticsResource";
import {
  fetchPurchasingBreakdown,
  fetchPurchasingProducts,
  fetchPurchasingSummary,
  fetchPurchasingSuppliers,
} from "../services/purchasingApi";
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
import {
  formatDeltaPercent,
  formatMoney,
  formatPercentValue,
  resolveSentiment,
  SENTIMENT_CLASS,
} from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * R5 — Purchasing & Supplier Intelligence.
 *
 * Reuses the frozen design system unchanged: the shared page shell, the three-level KPI
 * hierarchy, SectionCard for per-section loading and retry, and the URL-backed period
 * selector. Nothing here invents a new pattern.
 *
 * The one thing this page says out loud that the others do not: spend comes from the
 * purchase header and every per-product figure comes from the purchase lines. Those two
 * do not have to agree, and a manager who assumes they do will read the breakdown as
 * broken. The basis note is on the page, not only in the API meta.
 */

const SECTIONS = [
  { id: "purchasing-overview", key: "overview" },
  { id: "purchasing-relationship", key: "relationship" },
  { id: "purchasing-breakdown", key: "breakdown" },
  { id: "purchasing-suppliers", key: "suppliers" },
  { id: "purchasing-products", key: "products" },
];

const PRIMARY = ["purchaseSpend", "purchaseUnits", "purchaseOrders", "averagePurchaseValue"];
const OPERATING = ["averageUnitCost", "activeSuppliers", "purchasedProducts", "supplierReturnUnits"];
const HEALTH = ["unpaidPurchaseValue"];

export default function PurchasingIntelligence() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const isArabic = String(language || "").toLowerCase().startsWith("ar");

  const filters = usePurchasingFilters();

  const summary = useAnalyticsResource(fetchPurchasingSummary, filters.analyticalParams);
  const breakdown = useAnalyticsResource(fetchPurchasingBreakdown, filters.breakdownParams);
  const suppliers = useAnalyticsResource(fetchPurchasingSuppliers, filters.supplierParams);
  const products = useAnalyticsResource(fetchPurchasingProducts, filters.productParams);

  const busy = summary.status === "loading" || summary.status === "refreshing";
  const showCost = summary.meta?.permissions?.cost !== false;

  const refreshAll = () => {
    summary.refresh();
    breakdown.refresh();
    suppliers.refresh();
    products.refresh();
  };

  // One warning strip for the page: a duplicate code from two sections is noise.
  const warnings = useMemo(() => {
    const seen = new Set();
    return [...(summary.warnings || []), ...(breakdown.warnings || []), ...(suppliers.warnings || []), ...(products.warnings || [])]
      .filter((warning) => {
        if (seen.has(warning.code)) return false;
        seen.add(warning.code);
        return true;
      });
  }, [summary.warnings, breakdown.warnings, suppliers.warnings, products.warnings]);

  if (summary.status === "forbidden") {
    return (
      <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
        <ReportsHeader title={t("purchasingAnalytics.title")} subtitle={t("purchasingAnalytics.subtitle")} />
        <OverviewForbidden />
      </ReportsPage>
    );
  }

  const kpis = summary.data?.kpis || {};
  const relationship = summary.data?.purchaseVsSales || null;
  const concentration = summary.data?.concentration || null;

  return (
    <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
      <div className="space-y-5">
        <ReportsHeader title={t("purchasingAnalytics.title")} subtitle={t("purchasingAnalytics.subtitle")}>
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
              reportKey="purchasing"
              title={t("purchasingAnalytics.title")}
              filters={filters.filters}
              language={language}
              sheets={buildExportSheets({ t, language, showCost, summary, breakdown, suppliers, products })}
            />
          </div>
        </ReportsHeader>

        <SectionNav sections={SECTIONS} namespace="purchasingAnalytics" />

        <OverviewWarnings warnings={warnings} />

        {!showCost ? (
          <p className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
            {t("purchasingAnalytics.restricted")}
          </p>
        ) : null}

        <section id="purchasing-overview" aria-label={t("purchasingAnalytics.groups.primary")} className="scroll-mt-28 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:gap-4">
            {PRIMARY.map((metric) => (
              <KpiTile key={metric} metric={metric} kpi={kpis[metric]} level={1} />
            ))}
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] 2xl:gap-5">
            <Card title={t("purchasingAnalytics.nav.overview")} subtitle={t("purchasingAnalytics.relationship.subtitle")}>
              <SeriesChart
                points={summary.data?.trend || []}
                granularity={summary.meta?.granularity || "day"}
                emptyLabel={t("purchasingAnalytics.states.empty")}
                formatTooltipValue={(value, key) =>
                  (key === "spend" ? formatMoney(value, language) : formatNumber(value, language)) ?? "—"
                }
                series={[
                  ...(showCost ? [{ key: "spend", label: t("purchasingAnalytics.relationship.spend"), type: "area" }] : []),
                  { key: "units", label: t("purchasingAnalytics.breakdown.columns.units"), type: "line", color: "var(--info)" },
                ]}
              />
            </Card>
            <Subtle title={t("purchasingAnalytics.groups.operating")}>
              <div className="grid grid-cols-2 gap-3">
                {OPERATING.map((metric) => (
                  <KpiTile key={metric} metric={metric} kpi={kpis[metric]} level={2} />
                ))}
              </div>
              <div className="mt-3 grid gap-2.5">
                {HEALTH.map((metric) => (
                  <KpiTile key={metric} metric={metric} kpi={kpis[metric]} level={3} />
                ))}
              </div>
            </Subtle>
          </div>
        </section>

        <div id="purchasing-relationship" className="grid scroll-mt-28 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:gap-5">
          <SectionCard
            title={t("purchasingAnalytics.sections.relationship")}
            subtitle={t("purchasingAnalytics.relationship.subtitle")}
            status={summary.status}
            error={summary.error}
            onRetry={summary.refresh}
            skeletonHeight={200}
          >
            <RelationshipPanel relationship={relationship} language={language} showCost={showCost} />
          </SectionCard>

          <SectionCard
            title={t("purchasingAnalytics.sections.concentration")}
            subtitle={t("purchasingAnalytics.concentration.subtitle")}
            status={summary.status}
            error={summary.error}
            onRetry={summary.refresh}
            skeletonHeight={200}
          >
            <ConcentrationPanel concentration={concentration} language={language} />
          </SectionCard>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] 2xl:gap-5">
          <SectionCard
            id="purchasing-breakdown"
            title={t("purchasingAnalytics.sections.breakdown")}
            subtitle={t("purchasingAnalytics.breakdown.subtitle")}
            status={breakdown.status}
            error={breakdown.error}
            onRetry={breakdown.refresh}
            actions={
              <DimensionPicker
                value={filters.dimension}
                options={breakdown.meta?.availableDimensions || ["supplier", "product_type", "brand", "category"]}
                onChange={filters.setDimension}
                label={t("purchasingAnalytics.breakdown.dimension.label")}
              />
            }
            skeletonHeight={300}
          >
            <BreakdownBars
              rows={breakdown.data?.rows || []}
              valueKey={showCost ? "spend" : "units"}
              shareKey={showCost ? "spendShare" : "unitShare"}
              formatValue={(value) => (showCost ? formatMoney(value, language) : formatNumber(value, language))}
              secondary={(row) => `${formatNumber(row.units, language)} · ${formatNumber(row.purchaseCount, language)}`}
              emptyLabel={t("purchasingAnalytics.breakdown.empty")}
            />
          </SectionCard>

          <SectionCard
            title={t("purchasingAnalytics.sections.highlights")}
            status={summary.status}
            error={summary.error}
            onRetry={summary.refresh}
            skeletonHeight={200}
          >
            <ManagementHighlights highlights={summary.data?.highlights || []} namespace="purchasingAnalytics" />
          </SectionCard>
        </div>

        <SectionCard
          id="purchasing-suppliers"
          title={t("purchasingAnalytics.sections.suppliers")}
          subtitle={t("purchasingAnalytics.suppliers.subtitle")}
          status={suppliers.status}
          error={suppliers.error}
          onRetry={suppliers.refresh}
          collapsible
          openOnDesktop
          skeletonHeight={320}
        >
          <AnalyticsTable
            columns={supplierColumns({ t, language, showCost })}
            rows={suppliers.data?.rows || []}
            pagination={suppliers.data?.pagination}
            sort={suppliers.meta?.sort || { key: filters.supplierSort, direction: filters.supplierSortDir }}
            onSort={filters.setSupplierSort}
            onPage={filters.setSupplierPage}
            emptyLabel={t("purchasingAnalytics.suppliers.empty")}
            rowKey={(row) => row.supplierId}
            minWidth={900}
            labels={{ showing: "purchasingAnalytics.table.showing", prev: "purchasingAnalytics.table.prev", next: "purchasingAnalytics.table.next" }}
          />
        </SectionCard>

        <SectionCard
          id="purchasing-products"
          title={t("purchasingAnalytics.sections.products")}
          subtitle={t("purchasingAnalytics.products.subtitle")}
          status={products.status}
          error={products.error}
          onRetry={products.refresh}
          collapsible
          openOnDesktop
          skeletonHeight={320}
        >
          <AnalyticsTable
            columns={productColumns({ t, language, showCost })}
            rows={products.data?.rows || []}
            pagination={products.data?.pagination}
            sort={products.meta?.sort || { key: filters.sort, direction: filters.sortDir }}
            onSort={filters.setSort}
            onPage={filters.setPage}
            onSearch={filters.setSearch}
            search={filters.search}
            searchPlaceholder={t("purchasingAnalytics.table.search")}
            emptyLabel={t("purchasingAnalytics.products.empty")}
            rowKey={(row) => row.productId}
            minWidth={900}
            labels={{ showing: "purchasingAnalytics.table.showing", prev: "purchasingAnalytics.table.prev", next: "purchasingAnalytics.table.next" }}
          />
        </SectionCard>

        <Card>
          <h3 className="m1-section-title mb-1.5 text-[12px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            {t("purchasingAnalytics.basis.title")}
          </h3>
          <p className="text-[12px] leading-5 text-[var(--text-secondary)]">{t("purchasingAnalytics.basis.spend")}</p>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{t("purchasingAnalytics.basis.attribution")}</p>
        </Card>

        <PeriodFootnote period={{ from: filters.filters.from, to: filters.filters.to }} comparison={summary.meta?.comparison} />
      </div>
    </ReportsPage>
  );
}

/* --------------------------------------------------------------------- panels */

function RelationshipPanel({ relationship, language, showCost }) {
  const { t } = useTranslation();

  if (!showCost) {
    return <p className="text-[13px] text-[var(--text-tertiary)]">{t("purchasingAnalytics.restricted")}</p>;
  }
  if (!relationship) return null;

  const ratio = relationship.stockBuildRatio;
  const verdict =
    ratio === null ? "unavailable" : ratio >= 1.2 ? "buildingUp" : ratio <= 0.8 ? "drawingDown" : "balanced";

  return (
    <div className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure label={t("purchasingAnalytics.relationship.spend")} value={formatMoney(relationship.purchaseSpend, language)} />
        <Figure label={t("purchasingAnalytics.relationship.cogs")} value={formatMoney(relationship.cogs, language)} />
        <Figure label={t("purchasingAnalytics.relationship.netSales")} value={formatMoney(relationship.netSales, language)} />
      </dl>
      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5">
        <p className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
            {t("purchasingAnalytics.relationship.ratio")}
          </span>
          <span className="text-[20px] font-black tabular-nums text-[var(--text)] 2xl:text-[22px]">
            {/* null, not 0: nothing sold means there is no cost to divide by, which is a
                different fact from "spent nothing". */}
            {ratio === null ? "—" : formatNumber(Number(ratio.toFixed(2)), language)}
          </span>
        </p>
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
          {t(`purchasingAnalytics.relationship.${verdict}`)}
        </p>
        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{t("purchasingAnalytics.relationship.note")}</p>
      </div>
    </div>
  );
}

function ConcentrationPanel({ concentration, language }) {
  const { t } = useTranslation();
  if (!concentration) return null;

  if (concentration.restricted) {
    return <p className="text-[13px] text-[var(--text-tertiary)]">{t("purchasingAnalytics.restricted")}</p>;
  }
  if (concentration.topShare === null) {
    return (
      <div className="space-y-2">
        <Figure label={t("purchasingAnalytics.concentration.suppliers")} value={formatNumber(concentration.supplierCount, language)} />
        <p className="text-[13px] text-[var(--text-tertiary)]">{t("purchasingAnalytics.concentration.unavailable")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-2">
        <Figure label={t("purchasingAnalytics.concentration.topShare")} value={formatPercentValue(concentration.topShare, language)} />
        <Figure label={t("purchasingAnalytics.concentration.topThreeShare")} value={formatPercentValue(concentration.topThreeShare, language)} />
        <Figure label={t("purchasingAnalytics.concentration.suppliers")} value={formatNumber(concentration.supplierCount, language)} />
        <Figure
          label={t("purchasingAnalytics.concentration.hhi")}
          value={concentration.hhi === null ? "—" : formatNumber(Number(concentration.hhi.toFixed(2)), language)}
        />
      </dl>
      <p className="text-[11px] text-[var(--text-tertiary)]">{t("purchasingAnalytics.concentration.hhiHint")}</p>
    </div>
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
            {t(`purchasingAnalytics.breakdown.dimension.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

/* -------------------------------------------------------------------- columns */

const changeCell = (value, language) => {
  if (value === null || value === undefined) return <Blank />;
  // A cost RISE is bad for the buyer, so the sentiment is inverted against sales growth.
  const sentiment = resolveSentiment("lower", value);
  return <span className={`font-semibold ${SENTIMENT_CLASS[sentiment]}`}>{formatDeltaPercent(value, language)}</span>;
};

const supplierColumns = ({ t, language, showCost }) => [
  {
    key: "supplier",
    label: t("purchasingAnalytics.suppliers.columns.supplier"),
    sortable: true,
    cellClassName: "font-semibold text-[var(--text)]",
    render: (row) => (
      <span className="block max-w-[220px] truncate" title={row.supplierName}>{row.supplierName}</span>
    ),
  },
  {
    key: "spend", label: t("purchasingAnalytics.suppliers.columns.spend"), sortable: true, align: "end",
    visible: showCost, cellClassName: "font-bold text-[var(--text)]",
    render: (row) => (row.spend === null ? <Blank /> : formatMoney(row.spend, language)),
  },
  {
    key: "share", label: t("purchasingAnalytics.suppliers.columns.share"), align: "end", visible: showCost,
    render: (row) => formatPercentValue(row.spendShare, language) || <Blank />,
  },
  {
    key: "purchases", label: t("purchasingAnalytics.suppliers.columns.purchases"), sortable: true, align: "end",
    render: (row) => formatNumber(row.purchaseCount, language),
  },
  {
    key: "units", label: t("purchasingAnalytics.suppliers.columns.units"), sortable: true, align: "end",
    render: (row) => formatNumber(row.units, language),
  },
  {
    key: "products", label: t("purchasingAnalytics.suppliers.columns.products"), sortable: true, align: "end",
    render: (row) => formatNumber(row.productCount, language),
  },
  {
    key: "average_purchase", label: t("purchasingAnalytics.suppliers.columns.averagePurchase"), sortable: true, align: "end",
    visible: showCost,
    render: (row) => (row.averagePurchaseValue === null ? <Blank /> : formatMoney(row.averagePurchaseValue, language)),
  },
  {
    key: "unit_cost", label: t("purchasingAnalytics.suppliers.columns.unitCost"), align: "end", visible: showCost,
    render: (row) => (row.averageUnitCost === null ? <Blank /> : formatMoney(row.averageUnitCost, language)),
  },
  {
    key: "cost_change", label: t("purchasingAnalytics.suppliers.columns.costChange"), align: "end", visible: showCost,
    render: (row) => changeCell(row.unitCostDeltaPercent, language),
  },
  {
    key: "unpaid", label: t("purchasingAnalytics.suppliers.columns.unpaid"), sortable: true, align: "end", visible: showCost,
    render: (row) => (row.unpaidValue === null ? <Blank /> : formatMoney(row.unpaidValue, language)),
  },
  {
    key: "returns", label: t("purchasingAnalytics.suppliers.columns.returns"), sortable: true, align: "end",
    render: (row) => formatNumber(row.returnUnits, language),
  },
];

const productColumns = ({ t, language, showCost }) => [
  {
    key: "product",
    label: t("purchasingAnalytics.products.columns.product"),
    sortable: true,
    cellClassName: "font-semibold text-[var(--text)]",
    render: (row) => (
      <span className="min-w-0">
        <span className="block max-w-[240px] truncate" title={row.productName}>{row.productName}</span>
        <span className="block max-w-[240px] truncate text-[11px] font-normal text-[var(--text-tertiary)]">
          {[row.brand, row.productType].filter(Boolean).join(" · ")}
        </span>
      </span>
    ),
  },
  {
    key: "units", label: t("purchasingAnalytics.products.columns.units"), sortable: true, align: "end",
    render: (row) => formatNumber(row.units, language),
  },
  {
    key: "spend", label: t("purchasingAnalytics.products.columns.spend"), sortable: true, align: "end", visible: showCost,
    cellClassName: "font-bold text-[var(--text)]",
    render: (row) => (row.spend === null ? <Blank /> : formatMoney(row.spend, language)),
  },
  {
    key: "unit_cost", label: t("purchasingAnalytics.products.columns.unitCost"), sortable: true, align: "end", visible: showCost,
    render: (row) => (row.unitCost === null ? <Blank /> : formatMoney(row.unitCost, language)),
  },
  {
    key: "previous_cost", label: t("purchasingAnalytics.products.columns.previousCost"), align: "end", visible: showCost,
    render: (row) => (row.unitCostPrevious === null ? <Blank /> : formatMoney(row.unitCostPrevious, language)),
  },
  {
    key: "cost_change", label: t("purchasingAnalytics.products.columns.costChange"), sortable: true, align: "end", visible: showCost,
    render: (row) => (
      <span className="inline-flex items-center gap-1.5">
        {changeCell(row.unitCostDeltaPercent, language)}
        {row.priceMove ? (
          <span className="rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-tertiary)]">
            {t(`purchasingAnalytics.products.priceMove.${row.priceMove}`)}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    key: "purchases", label: t("purchasingAnalytics.products.columns.purchases"), sortable: true, align: "end",
    render: (row) => formatNumber(row.purchaseCount, language),
  },
  {
    key: "suppliers", label: t("purchasingAnalytics.products.columns.suppliers"), align: "end",
    render: (row) => formatNumber(row.supplierCount, language),
  },
];

/* --------------------------------------------------------------------- export */

/**
 * The export payload is built from exactly what is on screen — same rows, same
 * permission gating, same period. Building it from a second request would let the file
 * disagree with the page it was exported from.
 */
const buildExportSheets = ({ t, language, showCost, summary, breakdown, suppliers, products }) => () => {
  const sheets = [];
  const kpis = summary.data?.kpis || {};

  sheets.push({
    name: t("purchasingAnalytics.groups.primary"),
    columns: [
      { key: "metric", label: t("purchasingAnalytics.breakdown.columns.key") },
      { key: "value", label: t("purchasingAnalytics.breakdown.columns.spend"), align: "end" },
    ],
    rows: [...PRIMARY, ...OPERATING, ...HEALTH]
      .filter((metric) => kpis[metric] && !kpis[metric].restricted)
      .map((metric) => ({ metric: t(`overview.kpi.${metric}`), value: kpis[metric].current })),
  });

  if (breakdown.data?.rows?.length) {
    sheets.push({
      name: t("purchasingAnalytics.sections.breakdown"),
      columns: [
        { key: "key", label: t("purchasingAnalytics.breakdown.columns.key") },
        ...(showCost ? [{ key: "spend", label: t("purchasingAnalytics.breakdown.columns.spend"), align: "end" }] : []),
        { key: "units", label: t("purchasingAnalytics.breakdown.columns.units"), align: "end" },
        { key: "purchaseCount", label: t("purchasingAnalytics.breakdown.columns.purchases"), align: "end" },
        { key: "productCount", label: t("purchasingAnalytics.breakdown.columns.products"), align: "end" },
      ],
      rows: breakdown.data.rows,
    });
  }

  if (suppliers.data?.rows?.length) {
    sheets.push({
      name: t("purchasingAnalytics.sections.suppliers"),
      columns: [
        { key: "supplierName", label: t("purchasingAnalytics.suppliers.columns.supplier") },
        ...(showCost ? [{ key: "spend", label: t("purchasingAnalytics.suppliers.columns.spend"), align: "end" }] : []),
        { key: "purchaseCount", label: t("purchasingAnalytics.suppliers.columns.purchases"), align: "end" },
        { key: "units", label: t("purchasingAnalytics.suppliers.columns.units"), align: "end" },
        { key: "productCount", label: t("purchasingAnalytics.suppliers.columns.products"), align: "end" },
        ...(showCost ? [{ key: "averageUnitCost", label: t("purchasingAnalytics.suppliers.columns.unitCost"), align: "end" }] : []),
        ...(showCost ? [{ key: "unpaidValue", label: t("purchasingAnalytics.suppliers.columns.unpaid"), align: "end" }] : []),
        { key: "returnUnits", label: t("purchasingAnalytics.suppliers.columns.returns"), align: "end" },
      ],
      rows: suppliers.data.rows,
    });
  }

  if (products.data?.rows?.length) {
    sheets.push({
      name: t("purchasingAnalytics.sections.products"),
      columns: [
        { key: "productName", label: t("purchasingAnalytics.products.columns.product") },
        { key: "units", label: t("purchasingAnalytics.products.columns.units"), align: "end" },
        ...(showCost ? [{ key: "spend", label: t("purchasingAnalytics.products.columns.spend"), align: "end" }] : []),
        ...(showCost ? [{ key: "unitCost", label: t("purchasingAnalytics.products.columns.unitCost"), align: "end" }] : []),
        ...(showCost ? [{ key: "unitCostPrevious", label: t("purchasingAnalytics.products.columns.previousCost"), align: "end" }] : []),
        ...(showCost ? [{ key: "unitCostDeltaPercent", label: t("purchasingAnalytics.products.columns.costChange"), align: "end", kind: "percent" }] : []),
        { key: "purchaseCount", label: t("purchasingAnalytics.products.columns.purchases"), align: "end" },
      ],
      rows: products.data.rows,
    });
  }

  return { sheets, language };
};
