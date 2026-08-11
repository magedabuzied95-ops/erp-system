import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Filter, X } from "lucide-react";

import useSalesFilters from "../hooks/useSalesFilters";
import useAnalyticsResource from "../hooks/useAnalyticsResource";
import { fetchSalesBreakdown, fetchSalesProducts, fetchSalesSizes, fetchSalesSummary } from "../services/salesApi";

import PeriodSelector from "../components/PeriodSelector";
import KpiTile from "../components/KpiTile";
import CoverageBadge from "../components/CoverageBadge";
import OverviewTrendChart from "../components/OverviewTrendChart";
import ManagementHighlights from "../components/ManagementHighlights";
import SectionCard from "../components/SectionCard";
import SalesBreakdown from "../components/SalesBreakdown";
import ProductMatrix from "../components/ProductMatrix";
import ProductRankings from "../components/ProductRankings";
import SizeIntelligence from "../components/SizeIntelligence";
import ProductTable from "../components/ProductTable";
import { OverviewEmpty, OverviewForbidden, OverviewSkeleton, OverviewWarnings } from "../components/OverviewStates";
import { PeriodFootnote, ReportsHeader, ReportsPage } from "../components/ReportsLayout";
import { dimensionLabel } from "../lib/dimensionLabels";

/**
 * Sales & Profit Intelligence — R3.
 *
 * Four independent resources so one failing section cannot blank the page. The lead
 * band (KPIs + trend) carries the visual weight; everything below it is analysis and
 * the heavier sections collapse.
 */

const PRIMARY_KPIS = ["netSales", "grossProfit", "grossMargin", "itemsSold"];
const SECONDARY_KPIS = ["orders", "averageOrderValue", "discountRate", "returnRate"];

export default function SalesIntelligence() {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const navigate = useNavigate();
  const filters = useSalesFilters();
  const [showFilters, setShowFilters] = useState(false);

  const summary = useAnalyticsResource(fetchSalesSummary, filters.analyticalParams);
  const breakdown = useAnalyticsResource(fetchSalesBreakdown, filters.breakdownParams);
  const products = useAnalyticsResource(fetchSalesProducts, filters.productParams);
  const sizes = useAnalyticsResource(fetchSalesSizes, filters.sizeParams, { enabled: Boolean(filters.productType) });

  const showProfit = Boolean(summary.meta?.permissions?.profit);
  const showCost = Boolean(summary.meta?.permissions?.cost);
  const coverage = summary.meta?.cogsCoverage ?? null;
  const hasComparison = Boolean(summary.data?.comparison);

  // Product types come from whichever breakdown is on product_type; falling back to
  // the matrix keeps the size picker usable under any dimension.
  const productTypes = useMemo(() => {
    const fromBreakdown = filters.dimension === "product_type" ? (breakdown.data?.rows || []).map((row) => row.key) : [];
    const fromMatrix = (products.data?.matrix?.points || []).map((point) => point.productType);
    // The unknown bucket is not a product type, so it must not become a size scope.
    return [...new Set([...fromBreakdown, ...fromMatrix])]
      .filter((type) => type && type !== "غير محدد")
      .slice(0, 8);
  }, [filters.dimension, breakdown.data, products.data]);

  // Per-dimension quality, so the selector can disable a dimension that does not
  // segment this period. Only the active dimension is known; others stay enabled
  // until visited, which keeps this to one request per dimension change.
  const dimensionQuality = useMemo(
    () => (breakdown.data?.quality ? { [breakdown.data.quality.dimension]: breakdown.data.quality } : {}),
    [breakdown.data]
  );

  const drill = useCallback(
    (dimension, value) => {
      if (dimension === "product_type") filters.setProductType(filters.productType === value ? "" : value);
      else if (dimension === "category") filters.setCategory(filters.category === value ? "" : value);
      else if (dimension === "brand") filters.setBrand(filters.brandId === value ? "" : value);
    },
    [filters]
  );

  const openProduct = useCallback((row) => {
    if (row?.productId) navigate(`/products/${row.productId}`);
  }, [navigate]);

  const hasAnySales = Boolean(summary.data?.kpis?.orders?.current) || Boolean(summary.data?.kpis?.netSales?.current);

  return (
    <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
      <div className="space-y-4">
        <ReportsHeader title={t("salesAnalytics.title")} subtitle={t("salesAnalytics.subtitle")}>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector
              filters={filters.filters}
              allowedComparisons={filters.allowedComparisons}
              onPresetChange={filters.setPreset}
              onCompareChange={filters.setCompare}
              onRefresh={() => { summary.refresh(); breakdown.refresh(); products.refresh(); sizes.refresh(); }}
              busy={summary.status === "loading" || summary.status === "refreshing"}
            />
            <button
              type="button"
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
              className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold transition ${
                filters.activeFilterCount
                  ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--text)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
              }`}
            >
              <Filter className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">{showFilters ? t("salesAnalytics.filters.less") : t("salesAnalytics.filters.more")}</span>
              {filters.activeFilterCount ? (
                <span className="rounded-full bg-[var(--primary)] px-1.5 text-[10px] font-bold text-white">{filters.activeFilterCount}</span>
              ) : null}
            </button>
          </div>
        </ReportsHeader>

        {showFilters || filters.activeFilterCount ? (
          <ActiveFilters filters={filters} t={t} language={i18n.language} />
        ) : null}

        {summary.status === "forbidden" ? (
          <OverviewForbidden />
        ) : summary.status === "loading" ? (
          <OverviewSkeleton />
        ) : summary.status === "error" ? (
          <SectionCard title={t("salesAnalytics.title")} status="error" error={summary.error} onRetry={summary.refresh} />
        ) : !summary.data ? (
          <OverviewSkeleton />
        ) : (
          <div className="space-y-4">
            <OverviewWarnings warnings={summary.warnings} />

            {!hasAnySales ? (
              <OverviewEmpty />
            ) : (
              <>
                {/* Lead band: the four numbers that answer "how did we do", then the trend. */}
                <section aria-label={t("overview.groups.primary")}>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {PRIMARY_KPIS.map((metric) => (
                      <KpiTile
                        key={metric}
                        metric={metric}
                        kpi={summary.data.kpis[metric]}
                        level={1}
                        coverage={showProfit && (metric === "grossProfit" || metric === "grossMargin")
                          ? <CoverageBadge coverage={coverage} compact={metric === "grossMargin"} /> : null}
                      />
                    ))}
                  </div>
                </section>

                {/* Trend anchors the page; highlights and the operating KPIs share the
                    side column so neither leaves a tall empty card beside the chart. */}
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] 2xl:gap-5">
                  <SectionCard title={t("overview.trend.title")} skeletonHeight={340}>
                    <OverviewTrendChart
                      trend={summary.data.trend}
                      granularity={summary.data.period?.granularity}
                      showProfit={showProfit}
                    />
                  </SectionCard>

                  <div className="flex min-w-0 flex-col gap-4">
                    <SectionCard title={t("overview.highlights.title")} skeletonHeight={200}>
                      <ManagementHighlights highlights={summary.data.highlights} />
                    </SectionCard>
                    <div className="grid grid-cols-2 gap-3">
                      {SECONDARY_KPIS.map((metric) => (
                        <KpiTile key={metric} metric={metric} kpi={summary.data.kpis[metric]} level={3} />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:gap-5">
                  <SectionCard
                    title={t("salesAnalytics.sections.breakdown")}
                    status={breakdown.status === "idle" ? "success" : breakdown.status}
                    error={breakdown.error}
                    onRetry={breakdown.refresh}
                    note={t("salesAnalytics.breakdown.beforeReturns")}
                    skeletonHeight={240}
                  >
                    <SalesBreakdown
                      data={breakdown.data}
                      quality={breakdown.data?.quality}
                      dimensionQuality={dimensionQuality}
                      dimension={filters.dimension}
                      showProfit={showProfit}
                      onDimensionChange={filters.setDimension}
                      onDrill={drill}
                    />
                  </SectionCard>

                  <SectionCard
                    title={t("salesAnalytics.sections.rankings")}
                    status={products.status === "idle" ? "success" : products.status}
                    error={products.error}
                    onRetry={products.refresh}
                    skeletonHeight={240}
                  >
                    <ProductRankings
                      rankings={products.data?.rankings}
                      active={filters.ranking}
                      onChange={filters.setRanking}
                      showProfit={showProfit}
                      hasComparison={hasComparison}
                      onSelectProduct={openProduct}
                    />
                  </SectionCard>
                </div>

                <SectionCard
                  title={t("salesAnalytics.sections.matrix")}
                  status={products.status === "idle" ? "success" : products.status}
                  error={products.error}
                  onRetry={products.refresh}
                  collapsible
                  openOnDesktop
                  skeletonHeight={280}
                >
                  <ProductMatrix matrix={products.data?.matrix} showProfit={showProfit} onSelectProduct={openProduct} />
                </SectionCard>

                <SectionCard
                  title={t("salesAnalytics.sections.sizes")}
                  status={sizes.status === "idle" || sizes.status === "success" ? "success" : sizes.status}
                  error={sizes.error}
                  onRetry={sizes.refresh}
                  collapsible
                  openOnDesktop
                  skeletonHeight={240}
                >
                  <SizeIntelligence
                    data={sizes.data}
                    productTypes={productTypes}
                    selectedType={filters.productType}
                    onSelectType={filters.setProductType}
                  />
                </SectionCard>

                <SectionCard
                  title={t("salesAnalytics.sections.table")}
                  subtitle={products.data?.pagination ? t("salesAnalytics.table.count", { count: products.data.pagination.total }) : null}
                  status={products.status === "idle" ? "success" : products.status}
                  error={products.error}
                  onRetry={products.refresh}
                  collapsible
                  openOnDesktop
                  skeletonHeight={320}
                  note={products.warnings?.some((w) => w.code === "PRODUCT_LIST_TRUNCATED")
                    ? t("salesAnalytics.table.truncated", { limit: 300 }) : null}
                >
                  <ProductTable
                    data={products.data?.table}
                    pagination={products.data?.pagination}
                    sort={products.data?.sort || { key: filters.sort, direction: filters.sortDir }}
                    showProfit={showProfit}
                    showCost={showCost}
                    search={filters.search}
                    onSearch={filters.setSearch}
                    onSort={filters.setSort}
                    onPage={filters.setPage}
                    onSelectProduct={openProduct}
                  />
                </SectionCard>

                <PeriodFootnote period={summary.data.period} comparison={summary.data.comparison} />
              </>
            )}
          </div>
        )}
      </div>
    </ReportsPage>
  );
}

function ActiveFilters({ filters, t, language }) {
  // Chips display a translated label; `filters.*` still holds the stored value, so
  // clearing and re-sending a filter uses the original string either way.
  const chips = [
    filters.productType ? { key: "productType", label: t("salesAnalytics.filters.productType"), value: dimensionLabel("product_type", filters.productType, language), clear: () => filters.setProductType("") } : null,
    filters.category ? { key: "category", label: t("salesAnalytics.filters.category"), value: filters.category, clear: () => filters.setCategory("") } : null,
    filters.brandId ? { key: "brandId", label: t("salesAnalytics.filters.brand"), value: filters.brandId, clear: () => filters.setBrand("") } : null,
    filters.gender ? { key: "gender", label: t("salesAnalytics.filters.gender"), value: dimensionLabel("gender", filters.gender, language), clear: () => filters.setGender("") } : null,
  ].filter(Boolean);

  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[12px]">
          <span className="text-[var(--text-tertiary)]">{chip.label}:</span>
          <span className="font-semibold text-[var(--text)]">{chip.value}</span>
          <button type="button" onClick={chip.clear} aria-label={t("salesAnalytics.filters.clear")} className="text-[var(--text-tertiary)] transition hover:text-[var(--danger)]">
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" onClick={filters.clearFilters} className="text-[12px] font-semibold text-[var(--text-tertiary)] underline transition hover:text-[var(--text)]">
        {t("salesAnalytics.filters.clear")}
      </button>
    </div>
  );
}
