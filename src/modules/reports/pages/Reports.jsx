import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CalendarDays,
  Columns3,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  LineChart as LineChartIcon,
  Pin,
  Printer,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Star,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Pagination } from "../../../shared/ui";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

/** Module scope: resolve through i18n at CALL time, never eagerly at import. */
const tt = (key, options) => i18n.t(key, options);
import "./Reports.m1.css";

import {
  getCustomerReports,
  getAiInsights,
  getEmployeeReports,
  getFinancialReports,
  getInventoryReports,
  getReportsDashboard,
  getSalesReports,
} from "../services/reportsApi";

/* `key` selects the endpoint and drives activeTab; only the label is display. */
const REPORT_TABS = [
  { key: "insights", get label() { return tt("reports.center.tabs.insights"); }, endpoint: getAiInsights },
  { key: "sales", get label() { return tt("reports.center.tabs.sales"); }, endpoint: getSalesReports },
  { key: "employees", get label() { return tt("reports.center.tabs.employees"); }, endpoint: getEmployeeReports },
  { key: "inventory", get label() { return tt("reports.center.tabs.inventory"); }, endpoint: getInventoryReports },
  { key: "customers", get label() { return tt("reports.center.tabs.customers"); }, endpoint: getCustomerReports },
  { key: "financial", get label() { return tt("reports.center.tabs.financial"); }, endpoint: getFinancialReports },
];

const KPI_META = [
  ["totalSales", "Total Sales"],
  ["netProfit", "Net Profit"],
  ["ordersCount", "Orders Count"],
  ["averageOrderValue", "Average Order Value"],
  ["expenses", "Expenses"],
  ["inventoryValue", "Inventory Value"],
  ["customersCount", "Customers Count"],
  ["employeeProductivity", "Employee Productivity"],
  ["loyaltyRedemptions", "Loyalty Redemptions"],
];

const CHART_COLORS = ["#b8860b", "#64748b", "#4f6f8f", "#198754", "#a19e96", "#c47a08"];
const KPI_LABELS_AR = { totalSales:"إجمالي المبيعات",netProfit:"صافي الربح",ordersCount:"عدد الطلبات",averageOrderValue:"متوسط قيمة الطلب",expenses:"المصروفات",inventoryValue:"قيمة المخزون",customersCount:"عدد العملاء",employeeProductivity:"إنتاجية الموظفين",loyaltyRedemptions:"استبدالات الولاء" };
const PRESETS_KEY = "erp.reports.presets.v1";

const severityStyles = {
  critical: {
    icon: AlertTriangle,
    border: "border-rose-400/40",
    bg: "bg-rose-500/10",
    text: "text-rose-100",
    badge: "bg-rose-400 text-rose-950",
  },
  warning: {
    icon: AlertTriangle,
    border: "border-amber-400/40",
    bg: "bg-amber-500/10",
    text: "text-amber-100",
    badge: "bg-amber-300 text-amber-950",
  },
  success: {
    icon: ShieldCheck,
    border: "border-emerald-400/40",
    bg: "bg-emerald-500/10",
    text: "text-emerald-100",
    badge: "bg-emerald-300 text-emerald-950",
  },
  info: {
    icon: Brain,
    border: "border-primary/40",
    bg: "bg-primary/10",
    text: "text-primary",
    badge: "bg-primary-subtle text-primary",
  },
};

const defaultFilters = {
  preset: "month",
  startDate: "",
  endDate: "",
  branchId: "",
  warehouseId: "",
  employeeId: "",
  productId: "",
  categoryId: "",
  paymentMethod: "",
  customerId: "",
  shiftId: "",
  salespersonId: "",
  search: "",
  limit: 25,
  page: 1,
};

const formatMoney = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatNumber = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number(value || 0));

const numericValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeChartRows = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    label: String(row.label ?? row.name ?? ""),
    value: numericValue(row.value ?? row.revenue ?? row.orders_count ?? row.quantity),
  }));

const getRowsFromReport = (report) => (Array.isArray(report?.rows) ? report.rows : []);

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const rowsToCsv = (rows = []) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.map(csvEscape).join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
};

function Reports() {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const [filters, setFilters] = useState(defaultFilters);
  const [activeTab, setActiveTab] = useState("sales");
  const [dashboard, setDashboard] = useState(null);
  const [reports, setReports] = useState({});
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [sort, setSort] = useState({ key: "", direction: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [visibleColumns, setVisibleColumns] = useState({});
  const [presets, setPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]");
    } catch {
      return [];
    }
  });

  // The tab labels are getters resolved per read; isArabic still drives the
  // memo so the list re-maps on a language switch.
  const reportTabs = useMemo(() => REPORT_TABS.map((tab) => ({ ...tab, label: tab.label })), [isArabic]);
  const activeDefinition = reportTabs.find((tab) => tab.key === activeTab) || reportTabs[0];
  const activeReport = reports[activeTab] || {};
  const activeRows = getRowsFromReport(activeReport);
  const allColumns = useMemo(() => Object.keys(activeRows[0] || {}), [activeRows]);
  const enabledColumns = useMemo(
    () => allColumns.filter((column) => visibleColumns[column] !== false),
    [allColumns, visibleColumns]
  );

  const requestFilters = useMemo(
    () => ({
      ...filters,
      page: 1,
      limit: 100,
    }),
    [filters]
  );

  const loadReports = async () => {
    try {
      setLoading(true);
      setError("");
      const [dashboardPayload, insightsPayload, sales, employees, inventory, customers, financial] = await Promise.all([
        getReportsDashboard(requestFilters),
        getAiInsights(requestFilters),
        getSalesReports({ ...requestFilters, groupBy: "summary" }),
        getEmployeeReports(requestFilters),
        getInventoryReports(requestFilters),
        getCustomerReports(requestFilters),
        getFinancialReports(requestFilters),
      ]);
      setDashboard(dashboardPayload);
      setInsights(insightsPayload);
      setReports({
        insights: { rows: insightsPayload?.insights || [] },
        sales,
        employees,
        inventory,
        customers,
        financial,
      });
    } catch (err) {
      console.error("[reports] load failed:", err);
      setError(err?.message || "Failed to load reports");
      toast.error(err?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [requestFilters]);

  useEffect(() => {
    setPage(1);
    setTableSearch("");
    setSort({ key: "", direction: "desc" });
  }, [activeTab]);

  useEffect(() => {
    if (!allColumns.length) return;
    setVisibleColumns((current) => {
      const next = { ...current };
      allColumns.forEach((column) => {
        if (!(column in next)) next[column] = true;
      });
      return next;
    });
  }, [allColumns]);

  const filteredRows = useMemo(() => {
    const search = tableSearch.trim().toLowerCase();
    let rows = activeRows;
    if (search) {
      rows = rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(search)));
    }
    if (sort.key) {
      rows = [...rows].sort((a, b) => {
        const left = a[sort.key];
        const right = b[sort.key];
        const leftNum = Number(left);
        const rightNum = Number(right);
        const result = Number.isFinite(leftNum) && Number.isFinite(rightNum)
          ? leftNum - rightNum
          : String(left ?? "").localeCompare(String(right ?? ""));
        return sort.direction === "asc" ? result : -result;
      });
    }
    return rows;
  }, [activeRows, sort, tableSearch]);

  const totalPages = Math.max(Math.ceil(filteredRows.length / pageSize), 1);
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const kpis = dashboard?.kpis || {};
  const charts = dashboard?.charts || {};

  const updateFilter = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "preset" && value !== "custom" ? { startDate: "", endDate: "" } : {}),
    }));
  };

  const savePreset = () => {
    const name = window.prompt(t("reports.center.presetPrompt"), t("reports.center.presetDefaultName", { report: activeDefinition.label }));
    if (!name) return;
    const next = [{ id: Date.now(), name, activeTab, filters, pinned: false }, ...presets].slice(0, 12);
    setPresets(next);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    toast.success(t("reports.center.presetSaved"));
  };

  const togglePresetPin = (id) => {
    const next = presets.map((preset) => (preset.id === id ? { ...preset, pinned: !preset.pinned } : preset));
    setPresets(next);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
  };

  const openPreset = (preset) => {
    setActiveTab(preset.activeTab || "sales");
    setFilters({ ...defaultFilters, ...(preset.filters || {}) });
  };

  const exportRows = filteredRows.length ? filteredRows : activeRows;

  const exportCsv = async () => {
    const { saveAs } = await import("file-saver");
    const blob = new Blob([rowsToCsv(exportRows)], { type: "text/csv;charset=utf-8" });
    saveAs(blob, `${activeTab}-report.csv`);
  };

  const exportExcel = async () => {
    const [XLSX, { saveAs }] = await Promise.all([
      import("xlsx"),
      import("file-saver"),
    ]);
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, activeDefinition.label.slice(0, 31));
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([buffer], { type: "application/octet-stream" }), `${activeTab}-report.xlsx`);
  };

  const exportPdf = async () => {
    const [jspdfModule, autoTableModule] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const JsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    const doc = new JsPDF({ orientation: "landscape" });
    doc.text("Analytics & Reports", 14, 14);
    doc.text(`${activeDefinition.label} | ${filters.preset} | ${filters.startDate || "auto"} - ${filters.endDate || "auto"}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [enabledColumns],
      body: exportRows.map((row) => enabledColumns.map((column) => String(row[column] ?? ""))),
      styles: { fontSize: 8 },
    });
    doc.save(`${activeTab}-report.pdf`);
  };

  const printReport = () => {
    const html = `
      <html><head><title>Analytics & Reports</title>
      <style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;font-size:12px}th{background:#111;color:#fff}</style>
      </head><body><h1>Analytics & Reports</h1><h2>${activeDefinition.label}</h2>
      <table><thead><tr>${enabledColumns.map((column) => `<th>${column}</th>`).join("")}</tr></thead>
      <tbody>${exportRows.map((row) => `<tr>${enabledColumns.map((column) => `<td>${row[column] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>
      <script>window.print()</script></body></html>`;
    const win = window.open("", "_blank", "width=1200,height=800");
    win?.document.write(html);
    win?.document.close();
  };

  return (
    <div className="m1-reports-page min-h-screen bg-[#080b10] px-3 py-4 text-white sm:px-5 lg:px-7" dir={isArabic ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(6,78,59,0.72))] p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-emerald-200">
                <BarChart3 className="h-4 w-4" />
                {isArabic ? "التحليلات والتقارير" : "Analytics & Reports"}
              </div>
              <h1 className="m1-display mt-3">{isArabic ? "مركز التقارير المؤسسية" : "Enterprise Reports Center"}</h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold text-zinc-300">
                {isArabic ? "عرض مركزي لأداء المبيعات والطلبات والمخزون والموظفين والولاء والحسابات والفروع والمخازن." : "Centralized performance intelligence across POS, orders, inventory, attendance, shifts, loyalty, accounting, branches, and warehouses."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton icon={RefreshCw} label={t("reports.center.actions.refresh")} onClick={loadReports} disabled={loading} />
              <ActionButton icon={Save} label={t("reports.center.actions.savePreset")} onClick={savePreset} />
              <ActionButton icon={FileText} label="PDF" onClick={exportPdf} />
              <ActionButton icon={FileSpreadsheet} label="Excel" onClick={exportExcel} />
              <ActionButton icon={Download} label="CSV" onClick={exportCsv} />
              <ActionButton icon={Printer} label={t("reports.center.actions.print")} onClick={printReport} />
            </div>
          </div>
        </header>

        <FiltersBar filters={filters} updateFilter={updateFilter} loading={loading} />

        {presets.length ? (
          <section className="flex gap-2 overflow-x-auto pb-1">
            {[...presets].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => openPreset(preset)}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200 transition hover:border-emerald-300/40 hover:text-white"
              >
                <Star className={`h-3.5 w-3.5 ${preset.pinned ? "fill-amber-300 text-amber-300" : "text-zinc-500"}`} onClick={(event) => { event.stopPropagation(); togglePresetPin(preset.id); }} />
                {preset.name}
              </button>
            ))}
          </section>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm font-bold text-rose-100">{error}</div>
        ) : null}

        <AiInsightsCenter insights={insights} loading={loading} />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {KPI_META.map(([key, label]) => (
            <KpiCard key={key} label={isArabic ? KPI_LABELS_AR[key] : label} value={kpis[key]} loading={loading} money={!["ordersCount", "customersCount", "loyaltyRedemptions"].includes(key)} />
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <ChartPanel title={isArabic ? "المبيعات اليومية" : "Daily Sales"} icon={TrendingUp} loading={loading}>
            <AreaMetric rows={normalizeChartRows(charts.dailySales)} />
          </ChartPanel>
          <ChartPanel title={isArabic ? "الإيراد والربح الشهري" : "Monthly Revenue / Profit"} icon={LineChartIcon} loading={loading}>
            <LineMetric rows={normalizeChartRows(charts.monthlyRevenue)} secondaryRows={normalizeChartRows(charts.profitTrend)} />
          </ChartPanel>
          <ChartPanel title={isArabic ? "الطلبات حسب الساعة" : "Orders by Hour"} loading={loading}>
            <BarMetric rows={normalizeChartRows(charts.ordersByHour)} />
          </ChartPanel>
          <ChartPanel title={isArabic ? "طرق الدفع" : "Payment Methods"} loading={loading}>
            <PieMetric rows={normalizeChartRows(charts.paymentMethods)} />
          </ChartPanel>
          <ChartPanel title={isArabic ? "المبيعات حسب الفرع" : "Sales by Branch"} loading={loading}>
            <BarMetric rows={normalizeChartRows(charts.salesByBranch)} />
          </ChartPanel>
          <ChartPanel title={isArabic ? "اتجاه الحضور" : "Attendance Trend"} loading={loading}>
            <AreaMetric rows={normalizeChartRows(charts.attendanceTrend)} />
          </ChartPanel>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-4 shadow-xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {reportTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-black transition ${ activeTab === tab.key ? "border-emerald-300 bg-primary text-emerald-950" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-emerald-300/40 hover:text-[var(--primary-contrast)]" }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto] lg:min-w-[460px]">
              <label className="flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-300">
                <Search className="h-4 w-4" />
                <input value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder={t("reports.center.searchRows")} className="min-w-0 flex-1 bg-transparent outline-none" />
              </label>
              <details className="relative">
                <summary className="flex h-11 cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm font-black text-zinc-200">
                  <Columns3 className="h-4 w-4" />
                  Columns
                </summary>
                <div className="absolute right-0 z-30 mt-2 max-h-80 w-64 overflow-auto rounded-2xl border border-white/10 bg-zinc-950 p-3 shadow-2xl">
                  {allColumns.map((column) => (
                    <label key={column} className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm text-zinc-200 hover:bg-white/[0.04]">
                      <input type="checkbox" checked={visibleColumns[column] !== false} onChange={(event) => setVisibleColumns((current) => ({ ...current, [column]: event.target.checked }))} />
                      {column}
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>

          <ReportTable columns={enabledColumns} rows={pageRows} sort={sort} setSort={setSort} loading={loading} />

          <Pagination
            className="mt-4 border-t border-white/10 pt-4"
            page={page}
            pages={totalPages}
            total={filteredRows.length}
            pageSize={pageSize}
            visible={pageRows.length}
            disabled={loading}
            onChange={setPage}
            onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
          />
        </section>
      </div>
    </div>
  );
}

function FiltersBar({ filters, updateFilter, loading }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-4 shadow-xl shadow-black/20">
      <div className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
        <Filter className="h-4 w-4" />
        Global filters
        {loading ? <RefreshCw className="h-4 w-4 animate-spin text-emerald-300" /> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        <SelectFilter label={t("reports.center.filters.range")} value={filters.preset} onChange={(value) => updateFilter("preset", value)} options={[["today", t("reports.center.filters.today")], ["week", t("reports.center.filters.week")], ["month", t("reports.center.filters.month")], ["custom", t("reports.center.filters.custom")]]} />
        <TextFilter label={t("reports.center.filters.start")} type="date" value={filters.startDate} onChange={(value) => updateFilter("startDate", value)} />
        <TextFilter label={t("reports.center.filters.end")} type="date" value={filters.endDate} onChange={(value) => updateFilter("endDate", value)} />
        <TextFilter label={t("reports.center.filters.warehouseId")} value={filters.warehouseId} onChange={(value) => updateFilter("warehouseId", value)} />
        <TextFilter label={t("reports.center.filters.employeeId")} value={filters.employeeId} onChange={(value) => updateFilter("employeeId", value)} />
        <TextFilter label={t("reports.center.filters.productId")} value={filters.productId} onChange={(value) => updateFilter("productId", value)} />
        <TextFilter label={t("reports.center.filters.categoryId")} value={filters.categoryId} onChange={(value) => updateFilter("categoryId", value)} />
        <TextFilter label={t("reports.center.filters.paymentMethod")} value={filters.paymentMethod} onChange={(value) => updateFilter("paymentMethod", value)} />
        <TextFilter label={t("reports.center.filters.customerId")} value={filters.customerId} onChange={(value) => updateFilter("customerId", value)} />
        <TextFilter label={t("reports.center.filters.shiftId")} value={filters.shiftId} onChange={(value) => updateFilter("shiftId", value)} />
        <TextFilter label={t("reports.center.filters.salespersonId")} value={filters.salespersonId} onChange={(value) => updateFilter("salespersonId", value)} />
      </div>
    </section>
  );
}

function TextFilter({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">
        {type === "date" ? <CalendarDays className="h-3.5 w-3.5" /> : null}
        {label}
      </span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none transition focus:border-emerald-300/50" />
    </label>
  );
}

function SelectFilter({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none transition focus:border-emerald-300/50">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.06] px-3 text-xs font-black text-zinc-100 transition hover:border-emerald-300/40 hover:bg-emerald-400/10 disabled:opacity-50">
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function AiInsightsCenter({ insights, loading }) {
  const { t } = useTranslation();
  const items = Array.isArray(insights?.insights) ? insights.insights : [];
  const recommendations = Array.isArray(insights?.recommendations) ? insights.recommendations : [];
  const restock = Array.isArray(insights?.restock_predictions) ? insights.restock_predictions : [];
  const employees = Array.isArray(insights?.employee_intelligence) ? insights.employee_intelligence : [];
  const vipCustomers = Array.isArray(insights?.customer_intelligence?.vip_customers) ? insights.customer_intelligence.vip_customers : [];
  const summary = insights?.summary || {};

  return (
    <section className="rounded-[28px] border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(6,78,59,0.55),rgba(9,9,11,0.9))] p-4 shadow-2xl shadow-black/25">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-emerald-200">
            <Brain className="h-4 w-4" />
            AI Insights Center
          </div>
          <h2 className="m1-section-title mt-2 text-white">{t("reports.center.insights.heading")}</h2>
          <p className="mt-1 max-w-3xl text-sm font-semibold text-zinc-300">
            Automated analysis for sales, stock, people, customers, loyalty, shifts, expenses, and profit movement.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:min-w-[420px]">
          {["critical", "warning", "success", "info"].map((key) => (
            <div key={key} className={`rounded-2xl border ${severityStyles[key].border} ${severityStyles[key].bg} p-3 text-center`}>
              <div className="text-xl font-black text-white">{Number(summary[key] || 0)}</div>
              <div className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">{key}</div>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {[1, 2, 3].map((item) => <div key={item} className="h-44 animate-pulse rounded-2xl bg-white/[0.06]" />)}
        </div>
      ) : items.length ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {items.slice(0, 6).map((item, index) => <InsightCard key={`${item.title}-${index}`} insight={item} />)}
        </div>
      ) : (
        <div className="mt-5 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-6 text-sm font-semibold text-zinc-300">
          No major anomalies detected for the selected filters. Expand the date range for richer insights.
        </div>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <IntelligenceList
          title={t("reports.center.insights.recommendations")}
          icon={Zap}
          rows={recommendations}
          render={(item) => (
            <>
              <div className="font-black text-white">{item.title}</div>
              <div className="mt-1 line-clamp-2 text-xs font-semibold text-zinc-400">{item.description}</div>
            </>
          )}
        />
        <IntelligenceList
          title={t("reports.center.insights.restock")}
          icon={Activity}
          rows={restock.slice(0, 6)}
          render={(item) => (
            <>
              <div className="font-black text-white">{item.name}</div>
              <div className="mt-1 text-xs font-semibold text-zinc-400">
                {item.estimated_days_remaining ? `${item.estimated_days_remaining} days left` : "No current risk"} · {item.daily_velocity || 0}/day
              </div>
            </>
          )}
        />
        <IntelligenceList
          title={t("reports.center.insights.people")}
          icon={Pin}
          rows={[...employees.slice(0, 3), ...vipCustomers.slice(0, 3)]}
          render={(item) => (
            <>
              <div className="font-black text-white">{item.name}</div>
              <div className="mt-1 text-xs font-semibold text-zinc-400">
                {item.productivity_score !== undefined
                  ? `Productivity ${item.productivity_score} · openings ${item.total_openings || 0}`
                  : `CLV ${formatMoney(item.lifetime_value)} · points ${item.loyalty_points || 0}`}
              </div>
            </>
          )}
        />
      </div>
    </section>
  );
}

function InsightCard({ insight }) {
  const style = severityStyles[insight.severity] || severityStyles.info;
  const Icon = style.icon;
  return (
    <article className={`rounded-2xl border ${style.border} ${style.bg} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-xl bg-black/25 p-2 ${style.text}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${style.badge}`}>
          {insight.severity}
        </span>
      </div>
      <div className="mt-4 text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{insight.category} · {insight.type}</div>
      <h3 className="m1-section-title mt-2 text-white">{insight.title}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">{insight.description}</p>
    </article>
  );
}

function IntelligenceList({ title, icon: Icon, rows, render }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
        <Icon className="h-4 w-4 text-emerald-300" />
        {title}
      </div>
      <div className="space-y-2">
        {rows.length ? rows.map((row, index) => (
          <div key={row.id || row.title || index} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3">
            {render(row)}
          </div>
        )) : (
          <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm font-semibold text-zinc-500">No items for the selected filters.</div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, loading, money }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-zinc-950/80 p-4 shadow-xl shadow-black/20">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{label}</p>
        <TrendingUp className="h-4 w-4 text-emerald-300" />
      </div>
      {loading ? <div className="mt-4 h-9 animate-pulse rounded-xl bg-white/[0.08]" /> : <div className="mt-3 text-2xl font-black text-white">{money ? formatMoney(value) : formatNumber(value)}</div>}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full w-2/3 rounded-full bg-emerald-400" />
      </div>
    </div>
  );
}

function ChartPanel({ title, icon: Icon = BarChart3, loading, children }) {
  return (
    <section className="min-h-80 rounded-[28px] border border-white/10 bg-zinc-950/80 p-4 shadow-xl shadow-black/20">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-black text-white">
          <Icon className="h-4 w-4 text-emerald-300" />
          {title}
        </div>
      </div>
      {loading ? <div className="h-64 animate-pulse rounded-2xl bg-white/[0.06]" /> : children}
    </section>
  );
}

function AreaMetric({ rows }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="label" stroke="#a1a1aa" fontSize={11} />
          <YAxis stroke="#a1a1aa" fontSize={11} />
          <Tooltip contentStyle={{ background: "#09090b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12 }} />
          <Area type="monotone" dataKey="value" stroke="#b8860b" fill="rgba(184,134,11,.16)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function LineMetric({ rows, secondaryRows }) {
  const merged = rows.map((row, index) => ({ ...row, profit: secondaryRows[index]?.value || 0 }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={merged}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="label" stroke="#a1a1aa" fontSize={11} />
          <YAxis stroke="#a1a1aa" fontSize={11} />
          <Tooltip contentStyle={{ background: "#09090b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12 }} />
          <Line type="monotone" dataKey="value" stroke="#b8860b" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="profit" stroke="#4f6f8f" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarMetric({ rows }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="label" stroke="#a1a1aa" fontSize={11} />
          <YAxis stroke="#a1a1aa" fontSize={11} />
          <Tooltip contentStyle={{ background: "#09090b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12 }} />
          <Bar dataKey="value" fill="#b8860b" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieMetric({ rows }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="label" innerRadius={54} outerRadius={92} paddingAngle={4}>
            {rows.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ background: "#09090b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReportTable({ columns, rows, sort, setSort, loading }) {
  const { t } = useTranslation();
  if (loading) {
    return <div className="mt-4 h-80 animate-pulse rounded-2xl bg-white/[0.06]" />;
  }
  if (!rows.length) {
    return <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm font-semibold text-zinc-400">{t("reports.center.emptyRows")}</div>;
  }
  return (
    <div className="m1-table-container m1-table-container--plain mt-4 overflow-x-auto rounded-2xl border border-white/10">
      <table className="m1-table m1-table--compact min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-zinc-900 text-xs uppercase tracking-[0.14em] text-zinc-400">
          <tr>
            {columns.map((column) => (
              <th key={column} className="whitespace-nowrap px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSort((current) => ({ key: column, direction: current.key === column && current.direction === "desc" ? "asc" : "desc" }))}
                  className="inline-flex items-center gap-1 font-black"
                >
                  {column.replaceAll("_", " ")}
                  {sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id || rowIndex} className="bg-zinc-950/40 transition hover:bg-white/[0.04]">
              {columns.map((column) => (
                <td key={column} className="max-w-[260px] truncate px-4 py-3 font-semibold text-zinc-200">
                  {String(row[column] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Reports;
