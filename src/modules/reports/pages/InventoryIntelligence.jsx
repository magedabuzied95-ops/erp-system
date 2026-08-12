import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Filter, Info, X } from "lucide-react";

import useInventoryFilters from "../hooks/useInventoryFilters";
import useAnalyticsResource from "../hooks/useAnalyticsResource";
import {
  fetchInventoryBreakdown,
  fetchInventoryProducts,
  fetchInventorySizes,
  fetchInventorySummary,
} from "../services/inventoryApi";

import PeriodSelector from "../components/PeriodSelector";
import KpiTile from "../components/KpiTile";
import SectionCard from "../components/SectionCard";
import SectionNav from "../components/SectionNav";
import StockHealth from "../components/StockHealth";
import StockSalesMatrix from "../components/StockSalesMatrix";
import InventoryBreakdown from "../components/InventoryBreakdown";
import InventorySizes from "../components/InventorySizes";
import InventoryTable from "../components/InventoryTable";
import ManagementHighlights from "../components/ManagementHighlights";
import { OverviewEmpty, OverviewForbidden, OverviewSkeleton, OverviewWarnings } from "../components/OverviewStates";
import { PeriodFootnote, ReportsHeader, ReportsPage, Subtle } from "../components/ReportsLayout";
import { dimensionLabel } from "../lib/dimensionLabels";
import { formatMoney } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * R4 — Inventory Intelligence.
 *
 * Two clocks share this page and the header says so, because getting them confused is
 * the fastest way to misread every ratio on screen: stock is where things stand right
 * now, demand covers the selected period. No date filter can rewind stock.
 */

const PRIMARY_KPIS = ["inventoryValue", "unitsInStock", "stockedProducts", "stockedVariants"];

const NAV_SECTIONS = [
  { id: "inventory-overview", key: "overview" },
  { id: "inventory-health", key: "health" },
  { id: "inventory-breakdown", key: "breakdown" },
  { id: "inventory-matrix", key: "matrix" },
  { id: "inventory-sizes", key: "sizes" },
  { id: "inventory-table", key: "table" },
];

export default function InventoryIntelligence() {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const language = i18n.language;
  const filters = useInventoryFilters();
  const [showFilters, setShowFilters] = useState(false);

  const summary = useAnalyticsResource(fetchInventorySummary, filters.analyticalParams);
  const breakdown = useAnalyticsResource(fetchInventoryBreakdown, filters.breakdownParams);
  const products = useAnalyticsResource(fetchInventoryProducts, filters.productParams);
  const sizes = useAnalyticsResource(fetchInventorySizes, filters.sizeParams);

  const showValue = Boolean(summary.meta?.permissions?.cost);

  const productTypes = useMemo(() => {
    const fromBreakdown = filters.dimension === "product_type" ? (breakdown.data?.rows || []).map((row) => row.key) : [];
    const fromMatrix = (products.data?.matrix?.points || []).map((point) => point.productType);
    return [...new Set([...fromBreakdown, ...fromMatrix].filter((value) => value && value !== "غير محدد"))].slice(0, 8);
  }, [filters.dimension, breakdown.data, products.data]);

  const hasStock = Boolean(summary.data?.kpis?.unitsInStock?.current);

  const refreshAll = useCallback(() => {
    summary.refresh();
    breakdown.refresh();
    products.refresh();
    sizes.refresh();
  }, [summary, breakdown, products, sizes]);

  const drill = useCallback(
    (dimension, key) => {
      if (dimension === "product_type") filters.setProductType(key);
      else if (dimension === "brand") filters.setBrand(key);
      else if (dimension === "category") filters.setCategory(key);
    },
    [filters]
  );

  return (
    <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
      <div className="space-y-4">
        <ReportsHeader title={t("inventoryAnalytics.title")} subtitle={t("inventoryAnalytics.subtitle")}>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector
              filters={filters.filters}
              allowedComparisons={filters.allowedComparisons}
              onPresetChange={filters.setPreset}
              onCompareChange={filters.setCompare}
              onRefresh={refreshAll}
              busy={summary.status === "loading" || summary.status === "refreshing"}
            />
            <button
              type="button"
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
              className={`inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border px-3 text-[13px] font-semibold transition ${ filters.activeFilterCount ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--text)]" : "border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]" }`}
            >
              <Filter className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">{showFilters ? t("inventory.filters.less") : t("inventory.filters.more")}</span>
              {filters.activeFilterCount ? (
                <span className="rounded-full bg-[var(--primary)] px-1.5 text-[10px] font-bold text-white">{filters.activeFilterCount}</span>
              ) : null}
            </button>
          </div>
        </ReportsHeader>

        {/* The one sentence that stops every ratio on this page being misread. */}
        <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)] 2xl:text-[13px]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
          <span>
            <strong className="font-bold text-[var(--text)]">{t("inventory.timeSemantics.stock")}</strong>
            {" · "}
            {t("inventory.timeSemantics.sales")}
          </span>
        </p>

        {showFilters || filters.activeFilterCount ? <ActiveFilters filters={filters} t={t} language={language} /> : null}

        {summary.status === "forbidden" ? (
          <OverviewForbidden />
        ) : summary.status === "loading" ? (
          <OverviewSkeleton />
        ) : summary.status === "error" ? (
          <SectionCard title={t("inventoryAnalytics.title")} status="error" error={summary.error} onRetry={summary.refresh} />
        ) : !summary.data ? (
          <OverviewSkeleton />
        ) : (
          <div className="space-y-4">
            <OverviewWarnings warnings={summary.warnings} />

            {!hasStock ? (
              <OverviewEmpty />
            ) : (
              <>
                <SectionNav sections={NAV_SECTIONS} />

                <section id="inventory-overview" aria-label={t("inventory.groups.primary")}>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:gap-4">
                    {PRIMARY_KPIS.map((metric) => (
                      <KpiTile key={metric} metric={metric} kpi={summary.data.kpis[metric]} level={1} />
                    ))}
                  </div>
                </section>

                <div id="inventory-health" className="grid scroll-mt-28 items-start gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] 2xl:gap-5">
                  <SectionCard title={t("inventory.sections.health")} skeletonHeight={220}>
                    <StockHealth
                      health={summary.data.health}
                      showValue={showValue}
                      selected={filters.velocity}
                      onSelectClass={filters.setVelocity}
                    />
                  </SectionCard>

                  <div className="flex min-w-0 flex-col gap-4">
                    <SectionCard title={t("inventory.sections.highlights")} skeletonHeight={180}>
                      <ManagementHighlights highlights={summary.data.highlights} namespace="inventory" />
                    </SectionCard>
                    <Subtle title={t("inventory.groups.period")}>
                      <div className="grid grid-cols-2 gap-3">
                        <KpiTile metric="unitsSoldPeriod" kpi={summary.data.kpis.unitsSoldPeriod} level={3} />
                        <KpiTile metric="netSalesPeriod" kpi={summary.data.kpis.netSalesPeriod} level={3} />
                      </div>
                    </Subtle>
                  </div>
                </div>

                <div id="inventory-breakdown" className="grid scroll-mt-28 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:gap-5">
                  <SectionCard
                    title={t("inventory.sections.breakdown")}
                    status={breakdown.status === "idle" ? "success" : breakdown.status}
                    error={breakdown.error}
                    onRetry={breakdown.refresh}
                    skeletonHeight={240}
                  >
                    <InventoryBreakdown
                      data={breakdown.data}
                      dimension={filters.dimension}
                      quality={breakdown.data?.quality}
                      showValue={showValue}
                      onDimensionChange={filters.setDimension}
                      onDrill={drill}
                    />
                  </SectionCard>

                  <SectionCard
                    id="inventory-dead"
                    title={t("inventory.sections.deadCandidates")}
                    subtitle={t("inventory.deadCandidates.subtitle")}
                    status={products.status === "idle" ? "success" : products.status}
                    error={products.error}
                    onRetry={products.refresh}
                    skeletonHeight={240}
                  >
                    <DeadCandidates rows={products.data?.deadCandidates} showValue={showValue} language={language} t={t} />
                  </SectionCard>
                </div>

                <SectionCard
                  id="inventory-matrix"
                  title={t("inventory.sections.matrix")}
                  status={products.status === "idle" ? "success" : products.status}
                  error={products.error}
                  onRetry={products.refresh}
                  collapsible
                  openOnDesktop
                  skeletonHeight={300}
                >
                  <StockSalesMatrix matrix={products.data?.matrix} showValue={showValue} onSelectProduct={() => {}} />
                </SectionCard>

                <SectionCard
                  id="inventory-sizes"
                  title={t("inventory.sections.sizes")}
                  status={sizes.status === "idle" || sizes.status === "success" ? "success" : sizes.status}
                  error={sizes.error}
                  onRetry={sizes.refresh}
                  collapsible
                  openOnDesktop
                  skeletonHeight={260}
                >
                  <InventorySizes
                    data={sizes.data}
                    productTypes={productTypes}
                    selectedType={filters.productType}
                    onSelectType={filters.setProductType}
                    showValue={showValue}
                  />
                </SectionCard>

                <SectionCard
                  id="inventory-table"
                  title={t("inventory.sections.table")}
                  subtitle={products.data?.pagination ? t("inventory.table.count", { count: products.data.pagination.total }) : null}
                  status={products.status === "idle" ? "success" : products.status}
                  error={products.error}
                  onRetry={products.refresh}
                  collapsible
                  openOnDesktop
                  skeletonHeight={340}
                >
                  <InventoryTable
                    data={products.data?.table}
                    pagination={products.data?.pagination}
                    sort={products.data?.sort || { key: filters.sort, direction: filters.sortDir }}
                    showValue={showValue}
                    search={filters.search}
                    onSearch={filters.setSearch}
                    onSort={filters.setSort}
                    onPage={filters.setPage}
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

/** Dead candidates: never labelled dead, always "candidate", with the evidence beside it. */
function DeadCandidates({ rows, showValue, language, t }) {
  if (!rows?.length) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        {t("inventory.deadCandidates.empty")}
      </p>
    );
  }
  const days = (value) => (value ? Math.floor((Date.now() - new Date(value).getTime()) / 86400000) : null);
  return (
    <ul className="space-y-1.5">
      {rows.slice(0, 8).map((row) => (
        <li key={row.productId} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] font-semibold text-[var(--text)] 2xl:text-[14px]" title={row.productName}>
              {row.productName}
            </span>
            <span className="shrink-0 text-[13px] font-bold tabular-nums text-[var(--text)]">
              {showValue && row.inventoryValue !== null
                ? formatMoney(row.inventoryValue, language)
                : `${formatNumber(row.unitsInStock, language)} ${t("inventory.units")}`}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">
            <span className="tabular-nums">{t("inventory.deadCandidates.stock")}: {formatNumber(row.unitsInStock, language)}</span>
            {row.firstReceivedAt ? (
              <span className="tabular-nums">
                {t("inventory.deadCandidates.sinceReceipt", { days: days(row.firstReceivedAt) })}
              </span>
            ) : null}
            <span className="tabular-nums">{t("inventory.deadCandidates.lifetimeSold", { count: row.lifetimeUnits })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ActiveFilters({ filters, t, language }) {
  const chips = [
    filters.productType ? { key: "productType", label: t("inventory.filters.productType"), value: dimensionLabel("product_type", filters.productType, language), clear: () => filters.setProductType("") } : null,
    filters.category ? { key: "category", label: t("inventory.filters.category"), value: dimensionLabel("category", filters.category, language), clear: () => filters.setCategory("") } : null,
    filters.brandId ? { key: "brandId", label: t("inventory.filters.brand"), value: filters.brandId, clear: () => filters.setBrand("") } : null,
    filters.gender ? { key: "gender", label: t("inventory.filters.gender"), value: dimensionLabel("gender", filters.gender, language), clear: () => filters.setGender("") } : null,
    filters.velocity ? { key: "velocity", label: t("inventory.filters.velocity"), value: t(`inventory.health.${filters.velocity}`), clear: () => filters.setVelocity("") } : null,
  ].filter(Boolean);

  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1.5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[12px]">
          <span className="text-[var(--text-tertiary)]">{chip.label}:</span>
          <span className="font-semibold text-[var(--text)]">{chip.value}</span>
          <button type="button" onClick={chip.clear} aria-label={t("inventory.filters.clear")} className="text-[var(--text-tertiary)] transition hover:text-[var(--danger)]">
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" onClick={filters.clearFilters} className="text-[12px] font-semibold text-[var(--text-tertiary)] underline transition hover:text-[var(--text)]">
        {t("inventory.filters.clear")}
      </button>
    </div>
  );
}
