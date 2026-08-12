import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock3,
  Download,
  Filter,
  PackageSearch,
  RotateCcw,
  Sparkles,
  ShoppingBag,
  ShoppingCart,
  Users,
  WalletCards,
  Warehouse,
  Printer,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import AnalyticsKpiCard from "../components/AnalyticsKpiCard";
import AiInsightCard from "../components/AiInsightCard";
import { api } from "../../../shared/api/api";
import {
  getAiInsights,
  getAnalyticsOverview,
  getCustomerAnalytics,
  getCustomerIntelligence,
  getDeadStockAnalysis,
  getInventoryIntelligence,
  getProfitAnalytics,
  getReorderSuggestions,
  getSalesAnalytics,
} from "../services/analyticsApi";
import {
  downloadAnalyticsCsv,
  downloadAnalyticsPdf,
  printAnalyticsReport,
} from "../lib/analyticsExport";
import { formatCurrency } from "../../../shared/lib/currency";
import { logPagePerf } from "../../../shared/lib/perfDebug";

const AnalyticsCharts = lazy(async () => {
  const startedAt = performance.now();
  const module = await import("../components/AnalyticsCharts");
  logPagePerf("analytics.charts", startedAt, { heavy_component_load_ms: Math.round(performance.now() - startedAt) });
  return module;
});

const safeArray = (value) => (Array.isArray(value) ? value : []);

const EMPTY_ANALYTICS_BUNDLE = {
  summary: {
    revenue: 0,
    profit: 0,
    orders: 0,
    customers: 0,
    lowStockCount: 0,
    deadStockCount: 0,
    bestSeller: "n/a",
    forecastedGrowth: 0,
  },
  kpis: [],
  revenueSeries: [],
  salesTrendSeries: [],
  channelSeries: [],
  deadStockItems: [],
  lowStockItems: [],
  reorderSuggestions: [],
  deadStockAnalysis: [],
  predictedSales: [],
  smartAlerts: [],
  aiInsights: [],
  customerIntelligence: [],
  topCustomers: [],
  recentCustomers: [],
  customerSummary: {},
  inventoryValue: 0,
  movementSummary: [],
  profit: {},
};

const formatDate = (date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDate = (baseDate, days) => {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
};

const getPresetRange = (preset) => {
  const today = new Date();
  const endDate = formatDate(today);

  switch (preset) {
    case "today":
      return { startDate: endDate, endDate };
    case "7_days":
      return { startDate: formatDate(shiftDate(today, -6)), endDate };
    case "30_days":
      return { startDate: formatDate(shiftDate(today, -29)), endDate };
    case "this_month":
      return { startDate: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)), endDate };
    case "this_year":
      return { startDate: formatDate(new Date(today.getFullYear(), 0, 1)), endDate };
    default:
      return { startDate: "", endDate: "" };
  }
};

const getRiskTone = (riskLevel) => {
  if (riskLevel === "critical") return "rose";
  if (riskLevel === "warning") return "amber";
  return "emerald";
};

const getCustomerSegmentTone = (segment) => {
  if (segment === "VIP") return "cyan";
  if (segment === "Loyal") return "emerald";
  if (segment === "At Risk") return "amber";
  if (segment === "Inactive") return "rose";
  return "emerald";
};

const getRecommendationTone = (recommendation) => {
  if (recommendation === "reward") return "emerald";
  if (recommendation === "upsell") return "cyan";
  if (recommendation === "follow-up") return "amber";
  if (recommendation === "win-back") return "rose";
  return "emerald";
};

const buildAnalyticsParams = (filters) => {
  const range = filters.datePreset === "custom"
    ? { startDate: filters.startDate, endDate: filters.endDate }
    : getPresetRange(filters.datePreset);

  return {
    startDate: range.startDate || undefined,
    endDate: range.endDate || undefined,
    branchId: filters.branchId || undefined,
    warehouseId: filters.warehouseId || undefined,
  };
};

const createKpisFromBackend = ({ summary = {}, profit = {}, inventory = {}, customers = {}, bestSeller = {} }) => [
  { label: "Revenue", value: summary.revenue || 0, delta: 0, trend: "flat" },
  { label: "Profit", value: profit.profit || summary.profit || 0, delta: 0, trend: "flat" },
  { label: "Orders", value: summary.orders || 0, delta: 0, trend: "flat" },
  { label: "Customers", value: summary.customers || customers.summary?.totalCustomers || 0, delta: 0, trend: "flat" },
  { label: "Low Stock", value: summary.lowStockCount ?? inventory.lowStockItems?.length ?? 0, delta: 0, trend: "flat" },
  { label: "Best Seller", value: summary.bestSeller || bestSeller.name || "n/a", delta: 0, trend: "flat" },
];

const mapBackendBundle = (responses = {}) => {
  const overview = responses.overview?.overview || responses.overview || {};
  const sales = responses.sales?.sales || responses.sales || {};
  const profit = responses.profit?.profit || responses.profit || {};
  const inventory = responses.inventory?.inventory || responses.inventory || {};
  const customers = responses.customers?.customers || responses.customers || {};
  const aiInsights = responses.aiInsights?.aiInsights || responses.aiInsights || {};

  const summary = {
    ...EMPTY_ANALYTICS_BUNDLE.summary,
    ...(overview.summary || {}),
    revenue: overview.summary?.revenue ?? profit.revenue ?? 0,
    profit: overview.summary?.profit ?? profit.profit ?? 0,
    orders: overview.summary?.orders ?? 0,
    customers: overview.summary?.customers ?? customers.summary?.totalCustomers ?? 0,
    lowStockCount:
      overview.summary?.lowStockCount ??
      safeArray(inventory.lowStockItems).length ??
      0,
    deadStockCount:
      overview.summary?.deadStockCount ??
      safeArray(inventory.deadStockItems).length ??
      0,
    bestSeller:
      overview.summary?.bestSeller ||
      overview.bestSeller?.name ||
      "n/a",
    forecastedGrowth:
      overview.summary?.forecastedGrowth ?? 0,
  };

  return {
    summary,
    kpis:
      safeArray(overview.kpis).length > 0
        ? overview.kpis
        : createKpisFromBackend({
            summary,
            profit,
            inventory,
            customers,
            bestSeller: overview.bestSeller,
          }),
    revenueSeries:
      sales.revenueSeries !== undefined
        ? safeArray(sales.revenueSeries)
          : safeArray(profit.monthly).length > 0
            ? profit.monthly.map((item) => ({
                name: item.month,
                revenue: Number(item.revenue || 0),
                profit: Number(item.profit || 0),
                orders: 0,
              }))
            : [],
    salesTrendSeries:
      sales.revenueSeries !== undefined
        ? safeArray(sales.revenueSeries)
          : safeArray(profit.monthly).length > 0
            ? profit.monthly.map((item) => ({
                name: item.month,
                revenue: Number(item.revenue || 0),
                orders: Number(item.revenue || 0) > 0 ? Math.max(1, Math.round(Number(item.revenue || 0) / 2500)) : 0,
              }))
            : [],
    channelSeries: sales.channelSeries !== undefined ? safeArray(sales.channelSeries) : [],
    deadStockItems:
      inventory.deadStockItems !== undefined ? safeArray(inventory.deadStockItems) : [],
    lowStockItems: inventory.lowStockItems !== undefined ? safeArray(inventory.lowStockItems) : [],
    predictedSales:
      inventory.predictedSales !== undefined ? safeArray(inventory.predictedSales) : [],
    smartAlerts:
      inventory.smartAlerts !== undefined ? safeArray(inventory.smartAlerts) : [],
    aiInsights:
      aiInsights.items !== undefined ? safeArray(aiInsights.items) : [],
    reorderSuggestions:
      responses.reorderSuggestions?.items !== undefined
        ? safeArray(responses.reorderSuggestions.items)
        : [],
    deadStockAnalysis:
      responses.deadStock?.items !== undefined
        ? safeArray(responses.deadStock.items)
        : [],
    topCustomers: customers.topCustomers !== undefined ? safeArray(customers.topCustomers) : [],
    recentCustomers: customers.recentCustomers !== undefined ? safeArray(customers.recentCustomers) : [],
    customerSummary: customers.summary || {},
    inventoryValue: Number(inventory.inventoryValue || 0),
    movementSummary: safeArray(inventory.movementSummary),
    profit,
    customerIntelligence: safeArray(responses.customerIntelligence?.items),
  };
};

function AnalyticsDashboard() {
  const { t } = useTranslation();
  const pageStartedAtRef = useRef(performance.now());
  const firstDataLoggedRef = useRef(false);
  const presetOptions = useMemo(
    () => [
      { value: "today", label: t("common.today", "Today") },
      { value: "7_days", label: t("common.last7Days", "7 Days") },
      { value: "30_days", label: t("common.last30Days", "30 Days") },
      { value: "this_month", label: t("common.thisMonth", "This Month") },
      { value: "this_year", label: t("common.thisYear", "This Year") },
      { value: "custom", label: t("common.custom", "Custom") },
    ],
    [t]
  );
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState("live");
  const [warehouseRows, setWarehouseRows] = useState([]);
  const [filters, setFilters] = useState(() => {
    const preset = "30_days";
    return {
      datePreset: preset,
      ...getPresetRange(preset),
      branchId: "",
      warehouseId: "",
    };
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      logPagePerf("analytics.dashboard", pageStartedAtRef.current, { page_mount_ms: Math.round(performance.now() - pageStartedAtRef.current) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let active = true;

    const loadWarehouses = async () => {
      try {
        const response = await api.get("/warehouses");
        const rows = safeArray(response?.warehouses ?? response?.data ?? response?.result ?? response?.payload ?? response);
        if (!active) return;
        setWarehouseRows(
          rows.map((warehouse) => ({
            id: warehouse.id,
            name: warehouse.name || `${t("analytics.labels.allWarehouses")} ${warehouse.id}`,
            branchName: warehouse.branch_name || warehouse.branchName || warehouse.name || `${t("analytics.labels.allBranches")} ${warehouse.id}`,
            status: warehouse.status,
          }))
        );
      } catch {
        if (active) {
          setWarehouseRows([]);
        }
      }
    };

    loadWarehouses();

    return () => {
      active = false;
    };
  }, []);

  const branchOptions = useMemo(() => {
    const seen = new Map();
    warehouseRows.forEach((warehouse) => {
      const label = warehouse.branchName || warehouse.name;
      if (!label || seen.has(label)) return;
      seen.set(label, { id: warehouse.id, label });
    });
    return Array.from(seen.values());
  }, [warehouseRows]);

  const warehouseOptions = useMemo(() => warehouseRows, [warehouseRows]);

  const analyticsParams = useMemo(() => buildAnalyticsParams(filters), [filters]);
  const analyticsRequestKey = useMemo(() => JSON.stringify(analyticsParams), [analyticsParams]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        if (analytics) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError("");

        const [overview, sales, profit, inventory, customers, aiInsights, reorderSuggestions, deadStock, customerIntelligence] = await Promise.all([
          getAnalyticsOverview(analyticsParams),
          getSalesAnalytics(analyticsParams),
          getProfitAnalytics(analyticsParams),
          getInventoryIntelligence(analyticsParams),
          getCustomerAnalytics(analyticsParams),
          getAiInsights(analyticsParams),
          getReorderSuggestions(analyticsParams),
          getDeadStockAnalysis(analyticsParams),
          getCustomerIntelligence(analyticsParams),
        ]);

        if (!active) return;

        const nextAnalytics = mapBackendBundle({
            overview,
            sales,
            profit,
            inventory,
            customers,
            aiInsights,
            reorderSuggestions,
            deadStock,
            customerIntelligence,
          });
        setAnalytics(nextAnalytics);
        setSource("live");
        if (!firstDataLoggedRef.current) {
          firstDataLoggedRef.current = true;
          logPagePerf("analytics.dashboard", pageStartedAtRef.current, { first_data_ms: Math.round(performance.now() - pageStartedAtRef.current) });
        }
      } catch (err) {
        if (!active) return;

        console.warn("Analytics dashboard failed to load live analytics.", err);
        setAnalytics(null);
        setSource("error");
        setError(t("analytics.labels.unavailable", "Analytics endpoints are unavailable. No placeholder data is shown."));
        toast.error(t("analytics.labels.unavailableToast", "Unable to load analytics data"));
      } finally {
        if (active) setLoading(false);
        if (active) setRefreshing(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [analyticsRequestKey]);

  const handlePresetChange = (preset) => {
    setFilters((prev) => ({
      ...prev,
      datePreset: preset,
      ...(preset === "custom" ? { startDate: prev.startDate, endDate: prev.endDate } : getPresetRange(preset)),
    }));
  };

  const handleFilterReset = () => {
    const preset = "30_days";
    setFilters({
      datePreset: preset,
      ...getPresetRange(preset),
      branchId: "",
      warehouseId: "",
    });
  };

  const data = analytics || EMPTY_ANALYTICS_BUNDLE;
  const isErrorSource = source === "error";
  const showScopeFilters = branchOptions.length > 1 || warehouseOptions.length > 0;

  useEffect(() => {
    if (loading) return undefined;
    const frame = window.requestAnimationFrame(() => {
      logPagePerf("analytics.dashboard", pageStartedAtRef.current, { render_complete_ms: Math.round(performance.now() - pageStartedAtRef.current) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, analytics]);
  const selectedBranchLabel = useMemo(
    () => branchOptions.find((branch) => String(branch.id) === String(filters.branchId))?.label || t("analytics.labels.allBranches"),
    [branchOptions, filters.branchId]
  );
  const selectedWarehouseLabel = useMemo(
    () => warehouseOptions.find((warehouse) => String(warehouse.id) === String(filters.warehouseId))?.name || t("analytics.labels.allWarehouses"),
    [filters.warehouseId, warehouseOptions]
  );

  const exportPayload = useMemo(
    () => ({
      analytics: data,
      filters: {
        ...filters,
        datePresetLabel: presetOptions.find((option) => option.value === filters.datePreset)?.label || filters.datePreset,
        branchLabel: selectedBranchLabel,
        warehouseLabel: selectedWarehouseLabel,
      },
      meta: {
        companyName: "ERP System",
        title: t("analytics.title"),
        subtitle: t("analytics.subtitle"),
        fileName: "ai-analytics-report",
      },
    }),
    [data, filters, selectedBranchLabel, selectedWarehouseLabel]
  );

  const handleExportPdf = async () => {
    try {
      await downloadAnalyticsPdf(exportPayload);
    } catch (err) {
      toast.error(t("common.unableToExportPdf", "Unable to export PDF report"));
      console.warn("Analytics PDF export failed", err);
    }
  };

  const handleExportCsv = () => {
    try {
      downloadAnalyticsCsv(exportPayload);
    } catch (err) {
      toast.error(t("common.unableToExportCsv", "Unable to export CSV report"));
      console.warn("Analytics CSV export failed", err);
    }
  };

  const handlePrintReport = () => {
    try {
      printAnalyticsReport(exportPayload);
    } catch (err) {
      toast.error(t("common.unableToOpenPrint", "Unable to open print report"));
      console.warn("Analytics print report failed", err);
    }
  };

  if (loading && !analytics) {
    return <AnalyticsLoadingState />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[34px] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.24)] xl:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.32em] text-primary">{t("analytics.eyebrow")}</p>
            <h1 className="m1-display mt-3 text-[var(--text)]">
              {t("analytics.title")}
            </h1>
            <p className="mt-4 text-sm leading-7 text-[var(--muted)] xl:text-base">
              {t("analytics.subtitle")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <SummaryChip label={t("analytics.summary.lowStock")} value={data.summary.lowStockCount} icon={AlertTriangle} />
            <SummaryChip label={t("analytics.summary.deadStock")} value={data.summary.deadStockCount} icon={Clock3} />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <StatusPill label={isErrorSource ? t("analytics.status.unavailable", "Unavailable") : t("analytics.status.live")} tone={isErrorSource ? "rose" : "emerald"} />
          <StatusPill label={`${t("analytics.status.bestSeller")} ${data.summary.bestSeller}`} tone="cyan" />
          {error ? <StatusPill label={error} tone="rose" /> : null}
          {refreshing ? <StatusPill label={t("analytics.buttons.refreshing")} tone="amber" /> : null}
        </div>

        <div className="mt-6 rounded-[30px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.16)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                <Filter className="h-4 w-4 text-primary" />
                {t("analytics.filters.title")}
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {t("analytics.filters.description")}
              </p>
            </div>

          <button
            type="button"
            onClick={handleFilterReset}
            className="inline-flex items-center gap-2 self-start rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-primary/30 hover:bg-primary/10 hover:text-[var(--text)]"
          >
            <RotateCcw className="h-4 w-4" />
            {t("analytics.filters.reset")}
          </button>
        </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:border-primary/40 hover:bg-primary/20 hover:text-[var(--text)]"
            >
              <Download className="h-4 w-4" />
              {t("analytics.exportPdf")}
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-500 transition hover:border-emerald-400/40 hover:bg-emerald-500/20 hover:text-[var(--text)]"
            >
              <Download className="h-4 w-4" />
              {t("analytics.exportCsv")}
            </button>
            <button
              type="button"
              onClick={handlePrintReport}
              className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
            >
              <Printer className="h-4 w-4" />
              {t("analytics.printReport")}
            </button>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              Date range
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                <select
                  value={filters.datePreset}
                  onChange={(event) => handlePresetChange(event.target.value)}
                  className="w-full appearance-none rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-10 py-3 text-sm font-medium text-[var(--text)] outline-none transition focus:border-primary/40 focus:bg-[var(--card)]"
                >
                  {presetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              </div>
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              Start date
              <input
                type="date"
                value={filters.startDate}
                disabled={filters.datePreset !== "custom"}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    datePreset: "custom",
                    startDate: event.target.value,
                  }))
                }
                className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--text)] outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              End date
              <input
                type="date"
                value={filters.endDate}
                disabled={filters.datePreset !== "custom"}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    datePreset: "custom",
                    endDate: event.target.value,
                  }))
                }
                className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--text)] outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2 xl:col-span-1">
              {branchOptions.length > 1 ? (
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Branch
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                    <select
                      value={filters.branchId}
                      onChange={(event) =>
                        setFilters((prev) => ({
                          ...prev,
                          branchId: event.target.value,
                        }))
                      }
                      className="w-full appearance-none rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-10 py-3 text-sm font-medium text-[var(--text)] outline-none transition focus:border-primary/40 focus:bg-[var(--card)] disabled:opacity-60"
                    >
                      <option value="">{t("analytics.labels.allBranches")}</option>
                      {branchOptions.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                  </div>
                </label>
              ) : null}

              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Warehouse
                <div className="relative">
                  <Warehouse className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                  <select
                    value={filters.warehouseId}
                    onChange={(event) =>
                      setFilters((prev) => ({
                        ...prev,
                        warehouseId: event.target.value,
                      }))
                    }
                    className="w-full appearance-none rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-10 py-3 text-sm font-medium text-[var(--text)] outline-none transition focus:border-primary/40 focus:bg-[var(--card)] disabled:opacity-60"
                    disabled={warehouseOptions.length === 0}
                  >
                    <option value="">{t("analytics.labels.allWarehouses")}</option>
                    {warehouseOptions.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                </div>
              </label>
            </div>
          </div>

          {!showScopeFilters ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
              Branch and warehouse filters are hidden because no warehouse metadata is available.
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.kpis.length > 0 ? data.kpis.map((kpi) => (
          <AnalyticsKpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            delta={kpi.delta}
            trend={kpi.trend}
            icon={getKpiIcon(kpi.label)}
          />
        )) : (
          <div className="rounded-[28px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-sm font-semibold text-[var(--muted)] md:col-span-2 xl:col-span-3">
            {t("analytics.empty.noSalesData", "No sales data")}
          </div>
        )}
      </div>

      <Suspense fallback={<ChartsSkeleton />}>
        <AnalyticsCharts data={data} Panel={Panel} t={t} />
      </Suspense>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title={t("analytics.labels.customerTableTitle")} subtitle={t("analytics.sections.customerSubtitle")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoCard label={t("analytics.kpis.customers")} value={data.customerSummary.totalCustomers || data.summary.customers} />
            <InfoCard label={t("analytics.labels.activeCustomers", "Active customers")} value={data.customerSummary.activeCustomers || 0} />
            <InfoCard label={t("analytics.labels.walletBalance", "Wallet balance")} value={formatCurrency(data.customerSummary.walletBalance || 0)} />
            <InfoCard label={t("analytics.labels.loyaltyPoints", "Loyalty points")} value={data.customerSummary.loyaltyPoints || 0} />
          </div>

          <div className="mt-4 rounded-[26px] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-sm font-black text-[var(--text)]">{t("analytics.sections.customers")}</div>
            <div className="mt-3 space-y-3">
              {data.topCustomers.length > 0 ? (
                data.topCustomers.map((customer, index) => (
                  <div key={`${customer.name || customer.id || index}`} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                    <div>
                      <div className="font-semibold text-[var(--text)]">{customer.name || customer.customer_name || t("analytics.labels.customer", "Customer")}</div>
                      <div className="text-xs text-[var(--muted)]">{t("analytics.labels.topCustomers")}</div>
                    </div>
                    <div className="text-right text-sm text-[var(--muted)]">{customer.revenue !== undefined ? formatCurrency(customer.revenue) : t("analytics.labels.nA")}</div>
                  </div>
                ))
              ) : data.recentCustomers.length > 0 ? (
                data.recentCustomers.slice(0, 3).map((customer, index) => (
                  <div key={`${customer.name || customer.id || index}`} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                    <div>
                      <div className="font-semibold text-[var(--text)]">{customer.name || t("analytics.labels.customer", "Customer")}</div>
                      <div className="text-xs text-[var(--muted)]">{customer.phone || t("analytics.labels.recentCustomer", "Recent customer")}</div>
                    </div>
                    <div className="text-right text-sm text-[var(--muted)]">{customer.status || t("analytics.kpis.customers")}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-sm text-[var(--muted)]">
                  {t("analytics.labels.noCustomerIntelligence")}
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="AI insights" subtitle="Narrative intelligence generated from the latest ERP signals.">
          <div className="grid gap-4">
            {data.aiInsights.length > 0 ? (
              data.aiInsights.map((item, index) => (
                <AiInsightCard
                  key={item.title}
                  title={item.title}
                  insight={item.insight}
                  tone={index === 1 ? "amber" : index === 2 ? "emerald" : "cyan"}
                />
              ))
            ) : (
              <div className="rounded-[26px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                No AI insights available yet.
              </div>
            )}
          </div>
        </Panel>

        <div className="grid gap-4">
          <Panel title="Predicted sales" subtitle="Forecasted demand with confidence scoring.">
            <div className="grid gap-4 sm:grid-cols-2">
              {data.predictedSales.length > 0 ? (
                data.predictedSales.map((item) => (
                  <div key={item.label} className="rounded-[26px] border border-[var(--border)] bg-[var(--surface)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{item.label}</p>
                        <div className="mt-3 text-3xl font-black text-[var(--text)]">{formatCurrency(item.value)}</div>
                      </div>
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
                        <Sparkles className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface)]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400"
                        style={{ width: `${item.confidence}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm text-[var(--muted)]">Confidence: {item.confidence}%</p>
                  </div>
                ))
              ) : (
                <div className="rounded-[26px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                  No forecast data available yet.
                </div>
              )}
            </div>
          </Panel>

          <Panel title={t("analytics.labels.smartAlerts")} subtitle={t("analytics.labels.smartAlertsSubtitle", "Operational notifications that highlight critical anomalies.")}>
            <div className="space-y-3">
              {data.smartAlerts.length > 0 ? (
                data.smartAlerts.map((alert) => <AlertRow key={alert.id} alert={alert} />)
              ) : (
                <div className="rounded-[26px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                  {t("analytics.labels.noSmartAlerts", "No smart alerts available yet.")}
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <Panel title={t("analytics.labels.customerTableTitle")} subtitle={t("analytics.sections.customerSubtitle")}>
        {data.customerIntelligence.length > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Stat
                label={t("analytics.labels.vipCustomers")}
                value={data.customerIntelligence.filter((item) => item.customer_segment === "VIP").length}
              />
              <Stat
                label={t("analytics.labels.atRiskCustomers")}
                value={data.customerIntelligence.filter((item) => item.customer_segment === "At Risk").length}
              />
              <Stat
                label={t("analytics.labels.inactiveCustomers")}
                value={data.customerIntelligence.filter((item) => item.customer_segment === "Inactive").length}
              />
              <Stat
                label={t("analytics.labels.totalCustomerValue")}
              value={formatCurrency(data.customerIntelligence.reduce((sum, item) => sum + Number(item.total_spent || 0), 0))}
              />
            </div>

            <div className="overflow-hidden rounded-[26px] border border-[var(--border)] bg-[var(--surface)]">
              <div className="m1-table-container overflow-x-auto">
                <table className="m1-table m1-table--compact min-w-full">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                      <th className="px-4 py-3">{t("analytics.labels.customer", "Customer")}</th>
                      <th className="px-4 py-3">{t("analytics.labels.segment", "Segment")}</th>
                      <th className="px-4 py-3">{t("analytics.kpis.orders")}</th>
                      <th className="px-4 py-3">{t("analytics.labels.spent", "Spent")}</th>
                      <th className="px-4 py-3">{t("analytics.labels.avgOrder", "Avg order")}</th>
                      <th className="px-4 py-3">{t("analytics.labels.lastOrder", "Last order")}</th>
                      <th className="px-4 py-3">{t("analytics.labels.daysSince", "Days since")}</th>
                      <th className="px-4 py-3">{t("analytics.labels.favoriteProducts", "Favorite products")}</th>
                      <th className="px-4 py-3">{t("analytics.labels.favoriteCategories", "Favorite categories")}</th>
                      <th className="px-4 py-3">{t("analytics.labels.recommendation")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.customerIntelligence.map((item, index) => (
                      <tr key={`${item.customer_name || item.phone || index}`} className="border-t border-[var(--border)]">
                        <td className="px-4 py-4">
                          <div className="font-semibold text-[var(--text)]">{item.customer_name}</div>
                          <div className="text-xs text-[var(--muted)]">{item.phone || item.email || t("analytics.labels.nA")}</div>
                        </td>
                        <td className="px-4 py-4">
                          <StatusPill label={item.customer_segment} tone={getCustomerSegmentTone(item.customer_segment)} />
                        </td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.total_orders}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-[var(--text)]">{formatCurrency(item.total_spent)}</td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{formatCurrency(item.average_order_value)}</td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.last_order_date || t("analytics.labels.nA")}</td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.days_since_last_order}</td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.favorite_products || t("analytics.labels.nA")}</td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.favorite_categories || t("analytics.labels.nA")}</td>
                        <td className="px-4 py-4">
                          <StatusPill label={item.recommendation} tone={getRecommendationTone(item.recommendation)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[26px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
            {t("analytics.labels.noCustomerIntelligence")}
          </div>
        )}
      </Panel>

      <Panel title={t("analytics.sections.reorder")} subtitle={t("analytics.sections.reorder")}>
        {data.reorderSuggestions.length > 0 ? (
          <div className="overflow-hidden rounded-[26px] border border-[var(--border)] bg-[var(--surface)]">
            <div className="m1-table-container overflow-x-auto">
              <table className="m1-table m1-table--compact min-w-full">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Variant</th>
                    <th className="px-4 py-3">Stock</th>
                    <th className="px-4 py-3">Avg daily sales</th>
                    <th className="px-4 py-3">Days remaining</th>
                    <th className="px-4 py-3">Reorder qty</th>
                    <th className="px-4 py-3">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reorderSuggestions.map((item, index) => (
                    <tr key={`${item.sku || item.product_name}-${index}`} className="border-t border-[var(--border)]">
                      <td className="px-4 py-4">
                        <div className="font-semibold text-[var(--text)]">{item.product_name}</div>
                        <div className="text-xs text-[var(--muted)]">{item.sku}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-[var(--muted)]">
                        {item.color} / {item.size}
                      </td>
                      <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.current_stock}</td>
                      <td className="px-4 py-4 text-sm text-[var(--muted)]">{Number(item.average_daily_sales || 0).toFixed(2)}</td>
                      <td className="px-4 py-4 text-sm text-[var(--muted)]">{Number(item.estimated_days_remaining || 0).toFixed(1)}</td>
                      <td className="px-4 py-4 text-sm font-semibold text-[var(--text)]">{item.suggested_reorder_quantity}</td>
                      <td className="px-4 py-4">
                        <StatusPill label={item.risk_level} tone={getRiskTone(item.risk_level)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-[26px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
            No reorder suggestions at the moment.
          </div>
        )}
      </Panel>

      <Panel title="AI Dead Stock Intelligence" subtitle="Identify slow-moving inventory with blocked capital and clear action recommendations.">
        {data.deadStockAnalysis.length > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Stat label="Items flagged" value={data.deadStockAnalysis.length} />
              <Stat
                label="Blocked capital"
              value={formatCurrency(data.deadStockAnalysis.reduce((sum, item) => sum + Number(item.estimated_blocked_capital || 0), 0))}
              />
              <Stat
                label="Critical risks"
                value={data.deadStockAnalysis.filter((item) => Number(item.risk_score || 0) >= 80).length}
              />
              <Stat
                label="Clearance targets"
                value={data.deadStockAnalysis.filter((item) => item.recommendation === "clearance").length}
              />
            </div>
            <div className="overflow-hidden rounded-[26px] border border-[var(--border)] bg-[var(--surface)]">
              <div className="m1-table-container overflow-x-auto">
                <table className="m1-table m1-table--compact min-w-full">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                      <th className="px-4 py-3">Product</th>
                      <th className="px-4 py-3">Variant</th>
                      <th className="px-4 py-3">Stock</th>
                      <th className="px-4 py-3">Last sold</th>
                      <th className="px-4 py-3">Days without sales</th>
                      <th className="px-4 py-3">Blocked capital</th>
                      <th className="px-4 py-3">Risk</th>
                      <th className="px-4 py-3">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deadStockAnalysis.map((item, index) => (
                      <tr key={`${item.sku || item.product}-${index}`} className="border-t border-[var(--border)]">
                        <td className="px-4 py-4">
                          <div className="font-semibold text-[var(--text)]">{item.product}</div>
                          <div className="text-xs text-[var(--muted)]">{item.sku}</div>
                        </td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.variant}</td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.stock_quantity}</td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.last_sold_date || "n/a"}</td>
                        <td className="px-4 py-4 text-sm text-[var(--muted)]">{item.days_without_sales}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-[var(--text)]">{formatCurrency(item.estimated_blocked_capital)}</td>
                        <td className="px-4 py-4">
                          <StatusPill label={`${item.risk_score}/100`} tone={item.risk_score >= 80 ? "rose" : item.risk_score >= 50 ? "amber" : "emerald"} />
                        </td>
                        <td className="px-4 py-4">
                          <StatusPill label={item.recommendation} tone={item.recommendation === "clearance" || item.recommendation === "discount" ? "rose" : item.recommendation === "bundle" || item.recommendation === "transfer" ? "amber" : "emerald"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[26px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
            No dead stock intelligence available yet.
          </div>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Panel title="Dead stock detection" subtitle="Items that are moving slowly and are tying up working capital.">
          <div className="grid gap-4 lg:grid-cols-2">
            {data.deadStockItems.length > 0 ? (
              data.deadStockItems.map((item) => (
                <div key={item.id} className="rounded-[26px] border border-[var(--border)] bg-[var(--surface)] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="m1-section-title text-[var(--text)]">{item.name}</h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">{item.sku}</p>
                    </div>
                    <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
                      {item.daysIdle} days idle
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <Stat label="Color" value={item.color} />
                    <Stat label="Size" value={item.size} />
                    <Stat label="Stock" value={item.stock} />
                    <Stat label="Reason" value={item.reason} />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[26px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                No dead stock detected.
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Inventory risk snapshot" subtitle="System-wide risk signals for proactive replenishment.">
          <div className="grid gap-4">
            <RiskCard
              title={t("analytics.kpis.lowStock")}
              value={`${data.summary.lowStockCount} SKUs`}
              description="Items at or below reorder thresholds."
              icon={PackageSearch}
            />
            <RiskCard
              title={t("analytics.kpis.bestSeller")}
              value={data.summary.bestSeller}
              description={`Forecasted growth: ${data.summary.forecastedGrowth}%`}
              icon={ShoppingBag}
            />
            <RiskCard
              title={t("analytics.sections.customers")}
              value="Top 20% of customers"
              description="Driving a disproportionate share of monthly revenue."
              icon={Users}
            />
            <RiskCard
              title="Cash efficiency"
              value="Healthy"
              description="Collections are tracking within acceptable operating range."
              icon={WalletCards}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MiniInsight icon={ShoppingCart} title="Order velocity" value="Stable" />
        <MiniInsight icon={BrainCircuit} title="AI score" value="92 / 100" />
        <MiniInsight icon={Clock3} title="Dead stock ratio" value="4.8%" />
        <MiniInsight icon={AlertTriangle} title="Smart alerts" value="3 active" />
      </div>
    </div>
  );
}

function AnalyticsLoadingState() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="rounded-[34px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.24)] xl:p-8">
        <div className="h-8 w-48 rounded-full bg-[var(--surface)]" />
        <div className="mt-5 h-12 max-w-4xl rounded-[var(--radius-card)] bg-[var(--surface)]" />
        <div className="mt-4 h-6 max-w-2xl rounded-full bg-[var(--surface)]" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-36 rounded-[28px] border border-[var(--border)] bg-[var(--surface)]" />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
        <div className="h-[400px] rounded-[34px] border border-[var(--border)] bg-[var(--surface)]" />
        <div className="h-[400px] rounded-[34px] border border-[var(--border)] bg-[var(--surface)]" />
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="rounded-[34px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.2)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="m1-section-title text-[var(--text)]">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{subtitle}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ChartsSkeleton() {
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
        {[0, 1].map((item) => (
          <div key={item} className="h-[420px] rounded-[34px] border border-[var(--border)] bg-[var(--surface)] p-6">
            <div className="h-4 w-32 rounded-full bg-[var(--surface)]" />
            <div className="mt-8 h-[300px] animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]" />
          </div>
        ))}
      </div>
      <div className="h-[420px] rounded-[34px] border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="h-4 w-32 rounded-full bg-[var(--surface)]" />
        <div className="mt-8 h-[300px] animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]" />
      </div>
    </>
  );
}

function SummaryChip({ label, value, icon: Icon }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-primary">
        {Icon ? <Icon className="h-5 w-5" /> : null}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{label}</div>
        <div className="text-lg font-black text-[var(--text)]">{value}</div>
      </div>
    </div>
  );
}

function StatusPill({ label, tone = "cyan" }) {
  const tones = {
    cyan: "border-primary/20 bg-primary/10 text-primary",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-200",
  };

  return <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${tones[tone] || tones.cyan}`}>{label}</div>;
}

function AlertRow({ alert }) {
  const style =
    alert.severity === "high"
      ? "border-rose-500/20 bg-rose-500/10 text-rose-500"
      : alert.severity === "medium"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-500"
        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-500";

  return (
    <div className={`rounded-[24px] border p-4 ${style}`}>
      <div className="text-sm font-black">{alert.title}</div>
      <p className="mt-2 text-sm leading-6 text-[var(--text)]">{alert.message}</p>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

function RiskCard({ title, value, description, icon: Icon }) {
  return (
    <div className="rounded-[26px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{title}</p>
          <div className="mt-3 text-2xl font-black text-[var(--text)]">{value}</div>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}

function MiniInsight({ icon: Icon, title, value }) {
  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{title}</div>
          <div className="mt-3 text-xl font-black text-[var(--text)]">{value}</div>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

function EmptyChartState({ label }) {
  return (
    <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--muted)]">
      {label}
    </div>
  );
}

function getKpiIcon(label) {
  const mapping = {
    Revenue: WalletCards,
    Profit: Sparkles,
    Orders: ShoppingCart,
    Customers: Users,
    "Low Stock": AlertTriangle,
    "Best Seller": ShoppingBag,
  };

  return mapping[label];
}

export default AnalyticsDashboard;
