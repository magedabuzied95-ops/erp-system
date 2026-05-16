import { useEffect, useMemo, useState } from "react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Building2, CalendarDays, Clock3, Crown, Loader2, ShieldCheck, Users } from "lucide-react";
import toast from "react-hot-toast";

import { formatCurrency } from "../../../shared/lib/currency";
import EmployeeMetricCard from "./EmployeeMetricCard";
import EmployeeAnalyticsShell from "./EmployeeAnalyticsShell";
import {
  downloadEmployeeCsv,
  downloadEmployeePdf,
  printEmployeeReport,
} from "../lib/employeeAnalyticsExport";
import {
  employeeCommissionMock,
  employeePerformanceMock,
  employeeRuleMock,
  employeeSummaryMock,
} from "../lib/employeeAnalyticsMockData";
import {
  createCommissionRule,
  getCommissionRules,
  getCommissions,
  getSalesPerformance,
  getTopPerformers,
} from "../services/employeeAnalyticsApi";

const safeArray = (value) => (Array.isArray(value) ? value : []);

const PRESET_OPTIONS = [
  { value: "30_days", label: "30 Days" },
  { value: "7_days", label: "7 Days" },
  { value: "this_month", label: "This Month" },
  { value: "this_year", label: "This Year" },
  { value: "custom", label: "Custom" },
];

const formatDate = (date) => {
  const next = new Date(date);
  const year = next.getFullYear();
  const month = `${next.getMonth() + 1}`.padStart(2, "0");
  const day = `${next.getDate()}`.padStart(2, "0");
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
    case "7_days":
      return { startDate: formatDate(shiftDate(today, -6)), endDate };
    case "this_month":
      return { startDate: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)), endDate };
    case "this_year":
      return { startDate: formatDate(new Date(today.getFullYear(), 0, 1)), endDate };
    case "custom":
      return { startDate: "", endDate: "" };
    default:
      return { startDate: formatDate(shiftDate(today, -29)), endDate };
  }
};

const getTone = (value, compare = 0) => (Number(value || 0) >= compare ? "emerald" : "amber");

export default function EmployeeAnalyticsWorkspace({ defaultTab = "overview" }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState("live");
  const [salesPerformance, setSalesPerformance] = useState([]);
  const [shiftPerformance, setShiftPerformance] = useState([]);
  const [branchPerformance, setBranchPerformance] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [rules, setRules] = useState([]);
  const [topPerformers, setTopPerformers] = useState([]);
  const [summary, setSummary] = useState(employeeSummaryMock);
  const [ruleDraft, setRuleDraft] = useState({
    name: "",
    scope_type: "global",
    scope_id: "",
    rule_type: "percentage",
    value: 3,
    apply_to: "sale",
    priority: 10,
    is_active: true,
  });
  const [filters, setFilters] = useState(() => {
    const preset = "30_days";
    return {
      datePreset: preset,
      ...getPresetRange(preset),
    };
  });

  const requestParams = useMemo(() => {
    const range = filters.datePreset === "custom" ? filters : getPresetRange(filters.datePreset);
    return {
      startDate: range.startDate || undefined,
      endDate: range.endDate || undefined,
    };
  }, [filters]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        if (loading) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        setError("");

        const [sales, commissionRes, topRes, rulesRes] = await Promise.all([
          getSalesPerformance(requestParams),
          getCommissions(requestParams),
          getTopPerformers(requestParams),
          getCommissionRules(requestParams),
        ]);

        if (!active) return;

        const salesRows = safeArray(sales?.salesPerformance || sales?.items || []);
        const commissionsRows = safeArray(commissionRes?.commissions || commissionRes?.items || []);
        const topRows = safeArray(topRes?.topPerformers || topRes?.items || []);
        const rulesRows = safeArray(rulesRes?.rules || []);

        setSalesPerformance(salesRows);
        setShiftPerformance(safeArray(sales?.shiftPerformance || []));
        setBranchPerformance(safeArray(sales?.branchPerformance || []));
        setCommissions(commissionsRows);
        setRules(rulesRows.length ? rulesRows : employeeRuleMock);
        setTopPerformers(topRows.length ? topRows : salesRows.slice(0, 10));
        setSummary({
          totalSales: sales?.summary?.totalSales ?? salesRows.reduce((acc, row) => acc + Number(row.total_sales || 0), 0) ?? employeeSummaryMock.totalSales,
          totalOrders: sales?.summary?.totalOrders ?? salesRows.reduce((acc, row) => acc + Number(row.total_orders || 0), 0) ?? employeeSummaryMock.totalOrders,
          totalCommission: sales?.summary?.totalCommission ?? commissionsRows.reduce((acc, row) => acc + Number(row.commission_amount || 0), 0) ?? employeeSummaryMock.totalCommission,
          bestCashier: sales?.summary?.bestCashier || salesRows[0]?.employee_name || employeeSummaryMock.bestCashier,
          highestAverageOrder: sales?.summary?.highestAverageOrder || employeeSummaryMock.highestAverageOrder,
        });
        setSource("live");
      } catch (loadError) {
        if (!active) return;

        console.warn("Employee analytics fallback activated because the backend response was unavailable.", loadError);
        setSalesPerformance(employeePerformanceMock);
        setShiftPerformance(
          employeePerformanceMock.map((item) => ({
            shift_name: item.shift_name,
            total_sales: item.total_sales,
            total_orders: item.total_orders,
            average_order_value: item.average_order_value,
          }))
        );
        setBranchPerformance(
          employeePerformanceMock.map((item) => ({
            branch_name: item.branch_name,
            total_sales: item.total_sales,
            total_orders: item.total_orders,
            average_order_value: item.average_order_value,
          }))
        );
        setCommissions(employeeCommissionMock);
        setRules(employeeRuleMock);
        setTopPerformers(employeePerformanceMock);
        setSummary(employeeSummaryMock);
        setSource("fallback");
        setError("Showing local employee analytics fallback data.");
        toast.error("Using employee analytics fallback data");
      } finally {
        if (active) setLoading(false);
        if (active) setRefreshing(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [requestParams]);

  const exportPayload = useMemo(
    () => ({
      summary,
      salesPerformance,
      commissions,
      topPerformers,
      shiftPerformance,
      branchPerformance,
      rules,
      filters,
      meta: {
        companyName: "ERP System",
        title: "Employee Analytics Report",
        subtitle: "Sales performance, commissions, and shift analytics",
      },
    }),
    [summary, salesPerformance, commissions, topPerformers, shiftPerformance, branchPerformance, rules, filters]
  );

  const handleExportPdf = async () => {
    try {
      await downloadEmployeePdf(exportPayload);
    } catch (err) {
      console.warn("Employee analytics PDF export failed", err);
      toast.error("Unable to export PDF");
    }
  };

  const handleExportCsv = () => {
    try {
      downloadEmployeeCsv(exportPayload);
    } catch (err) {
      console.warn("Employee analytics CSV export failed", err);
      toast.error("Unable to export CSV");
    }
  };

  const handlePrint = () => {
    try {
      printEmployeeReport(exportPayload);
    } catch (err) {
      console.warn("Employee analytics print failed", err);
      toast.error("Unable to print report");
    }
  };

  const handleCreateRule = async () => {
    if (!ruleDraft.name.trim()) {
      toast.error("Rule name is required");
      return;
    }

    try {
      const response = await createCommissionRule({
        ...ruleDraft,
        scope_id: ruleDraft.scope_id || null,
        value: Number(ruleDraft.value || 0),
        priority: Number(ruleDraft.priority || 0),
      });
      const created = response?.rule || response?.data?.rule;
      if (created) {
        setRules((prev) => [created, ...prev]);
      }
      setRuleDraft({
        name: "",
        scope_type: "global",
        scope_id: "",
        rule_type: "percentage",
        value: 3,
        apply_to: "sale",
        priority: 10,
        is_active: true,
      });
      toast.success("Commission rule created");
    } catch (err) {
      console.warn("Commission rule creation failed", err);
      toast.error("Unable to create commission rule");
    }
  };

  const refresh = () => {
    setFilters((prev) => ({ ...prev }));
  };

  const chartData = salesPerformance.slice(0, 8).map((item) => ({
    name: item.employee_name,
    sales: Number(item.total_sales || 0),
    commission: Number(item.commission_earned || 0),
  }));

  const shiftChartData = shiftPerformance.slice(0, 8).map((item) => ({
    name: item.shift_name,
    sales: Number(item.total_sales || 0),
  }));

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "sales", label: "Sales Performance" },
    { key: "commissions", label: "Commissions" },
    { key: "top", label: "Top Performers" },
    { key: "shifts", label: "Shift Analytics" },
  ];

  const selectedTab = activeTab || "overview";

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center rounded-[32px] border border-white/10 bg-zinc-950/80">
        <div className="inline-flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-zinc-200">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
          Loading employee analytics...
        </div>
      </div>
    );
  }

  return (
    <EmployeeAnalyticsShell
      title="Sales performance and commissions"
      subtitle="Track cashier performance, commissions, top performers, and shift analytics in one premium workspace."
      activeTab={selectedTab}
      onTabChange={setActiveTab}
      onRefresh={refresh}
      onExportPdf={handleExportPdf}
      onExportCsv={handleExportCsv}
      onPrint={handlePrint}
      tabs={tabs}
    >
      <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.16)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <CalendarDays className="h-4 w-4 text-cyan-300" />
              Analytics filters
            </div>
            <p className="mt-1 text-xs text-zinc-500">Date filters refetch the employee analytics backend automatically.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Range
              <select
                value={filters.datePreset}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    datePreset: event.target.value,
                    ...(event.target.value === "custom" ? {} : getPresetRange(event.target.value)),
                  }))
                }
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-cyan-400/40"
              >
                {PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
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
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
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
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${source === "fallback" ? "bg-amber-500/10 text-amber-200" : "bg-emerald-500/10 text-emerald-200"}`}>
            {source === "fallback" ? "Fallback active" : "Live data loaded"}
          </span>
          {error ? <span className="rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200">{error}</span> : null}
          {refreshing ? <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">Refreshing</span> : null}
        </div>
      </div>

      {selectedTab === "overview" ? (
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-4">
            <EmployeeMetricCard label="Best cashier" value={summary.bestCashier || "n/a"} hint="Highest overall sales" tone="emerald" />
            <EmployeeMetricCard label="Highest revenue" value={formatCurrency(summary.totalSales)} hint={`Orders: ${summary.totalOrders || 0}`} tone="cyan" />
            <EmployeeMetricCard label="Highest average order" value={formatCurrency(summary.highestAverageOrder?.average_order_value || 0)} hint={summary.highestAverageOrder?.employee_name || "n/a"} tone="amber" />
            <EmployeeMetricCard label="Commission leaderboard" value={formatCurrency(summary.totalCommission)} hint="Total earned commission" tone="rose" />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">Revenue by employee</div>
                  <h2 className="mt-2 text-xl font-black text-white">Sales and commission mix</h2>
                </div>
                <ShieldCheck className="h-5 w-5 text-cyan-300" />
              </div>
              <div className="mt-5 h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="name" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                    <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", border: "1px solid #27272a", borderRadius: 16, color: "#fff" }}
                    />
                    <Bar dataKey="sales" fill="#34d399" radius={[10, 10, 0, 0]} />
                    <Bar dataKey="commission" fill="#22d3ee" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">Shift analytics</div>
                  <h2 className="mt-2 text-xl font-black text-white">Shift revenue trend</h2>
                </div>
                <Clock3 className="h-5 w-5 text-cyan-300" />
              </div>
              <div className="mt-5 h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={shiftChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="name" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                    <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", border: "1px solid #27272a", borderRadius: 16, color: "#fff" }}
                    />
                    <Line type="monotone" dataKey="sales" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedTab === "sales" ? (
        <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Users className="h-4 w-4 text-emerald-300" />
            Sales performance
          </div>
          <div className="overflow-hidden rounded-3xl border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/5 text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Sales</th>
                  <th className="px-4 py-3">Orders</th>
                  <th className="px-4 py-3">Avg Order</th>
                  <th className="px-4 py-3">Commission</th>
                  <th className="px-4 py-3">Refunds</th>
                </tr>
              </thead>
              <tbody>
                {salesPerformance.map((row) => (
                  <tr key={String(row.employee_id || row.employee_name)} className="border-t border-white/5">
                    <td className="px-4 py-3 text-white">{row.employee_name}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.role_name || "Staff"}</td>
                    <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.total_sales)}</td>
                    <td className="px-4 py-3 text-zinc-200">{row.total_orders || 0}</td>
                    <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.average_order_value)}</td>
                    <td className="px-4 py-3 text-cyan-200">{formatCurrency(row.commission_earned)}</td>
                    <td className="px-4 py-3 text-rose-200">{formatCurrency(row.refunds_impact)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {selectedTab === "commissions" ? (
        <section className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            <EmployeeMetricCard label="Commission rows" value={commissions.length} hint="Recorded earnings" tone="cyan" />
            <EmployeeMetricCard label="Rule count" value={rules.length} hint="Active and inactive rules" tone="amber" />
            <EmployeeMetricCard label="Total commission" value={formatCurrency(summary.totalCommission)} hint="From commission rows" tone="emerald" />
          </div>

          <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">Commission rules</div>
                <h2 className="mt-2 text-xl font-black text-white">Configurable rules</h2>
              </div>
            </div>
            <div className="mb-5 grid gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4 xl:grid-cols-4">
              <input
                value={ruleDraft.name}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Rule name"
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <select
                value={ruleDraft.scope_type}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, scope_type: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="global">Global</option>
                <option value="product">Product</option>
                <option value="category">Category</option>
                <option value="employee">Employee</option>
              </select>
              <select
                value={ruleDraft.rule_type}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, rule_type: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed</option>
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={ruleDraft.value}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, value: event.target.value }))}
                placeholder="Value"
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <input
                value={ruleDraft.scope_id}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, scope_id: event.target.value }))}
                placeholder="Scope ID (optional)"
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <input
                type="number"
                min="0"
                step="1"
                value={ruleDraft.priority}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, priority: event.target.value }))}
                placeholder="Priority"
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <select
                value={ruleDraft.apply_to}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, apply_to: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="sale">Sale</option>
                <option value="item">Item</option>
              </select>
              <button
                type="button"
                onClick={handleCreateRule}
                className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400"
              >
                Add rule
              </button>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {rules.map((rule) => (
                <div key={String(rule.id)} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-bold text-white">{rule.name}</div>
                      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{rule.scope_type} / {rule.rule_type}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${rule.is_active ? "bg-emerald-500/10 text-emerald-200" : "bg-rose-500/10 text-rose-200"}`}>
                      {rule.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                    <div>Value: <span className="font-semibold text-white">{Number(rule.value || 0)}{rule.rule_type === "percentage" ? "%" : ""}</span></div>
                    <div>Priority: <span className="font-semibold text-white">{rule.priority || 0}</span></div>
                    <div>Applies to: <span className="font-semibold text-white">{rule.apply_to || "sale"}</span></div>
                    <div>Scope ID: <span className="font-semibold text-white">{rule.scope_id || "global"}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
            <div className="mb-4 text-xs uppercase tracking-[0.22em] text-cyan-300">Commission transactions</div>
            <div className="overflow-hidden rounded-3xl border border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Sale</th>
                    <th className="px-4 py-3">Commission</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((row) => (
                    <tr key={String(row.id)} className="border-t border-white/5">
                      <td className="px-4 py-3 text-white">{row.employee_name}</td>
                      <td className="px-4 py-3 text-zinc-300">{row.invoice_number || "n/a"}</td>
                      <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.sale_amount)}</td>
                      <td className="px-4 py-3 text-emerald-200">{formatCurrency(row.commission_amount)}</td>
                      <td className="px-4 py-3 text-cyan-200">{row.status || "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {selectedTab === "top" ? (
        <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Crown className="h-4 w-4 text-amber-300" />
            Top performers
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {topPerformers.map((row, index) => (
              <div key={String(row.employee_id || row.employee_name)} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between">
                  <div className="text-white font-bold">{index + 1}. {row.employee_name}</div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getTone(row.total_sales, 100000) === "emerald" ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`}>
                    {formatCurrency(row.total_sales)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                  <div>Orders: <span className="font-semibold text-white">{row.total_orders || 0}</span></div>
                  <div>Avg order: <span className="font-semibold text-white">{formatCurrency(row.average_order_value)}</span></div>
                  <div>Commission: <span className="font-semibold text-cyan-200">{formatCurrency(row.commission_earned)}</span></div>
                  <div>Shift: <span className="font-semibold text-white">{row.shift_name || "n/a"}</span></div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {selectedTab === "shifts" ? (
        <section className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Building2 className="h-4 w-4 text-cyan-300" />
            Shift analytics
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {shiftPerformance.map((row) => (
              <div key={String(row.shift_id || row.shift_name)} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-white font-bold">{row.shift_name}</div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-zinc-300">
                  <div>Sales<br /><span className="font-semibold text-white">{formatCurrency(row.total_sales)}</span></div>
                  <div>Orders<br /><span className="font-semibold text-white">{row.total_orders || 0}</span></div>
                  <div>Avg order<br /><span className="font-semibold text-white">{formatCurrency(row.average_order_value)}</span></div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={shiftPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="shift_name" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <Tooltip contentStyle={{ backgroundColor: "#09090b", border: "1px solid #27272a", borderRadius: 16, color: "#fff" }} />
                  <Bar dataKey="total_sales" radius={[10, 10, 0, 0]}>
                    {shiftPerformance.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index % 2 === 0 ? "#34d399" : "#22d3ee"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 text-xs uppercase tracking-[0.22em] text-cyan-300">Branch performance</div>
            <div className="overflow-hidden rounded-3xl border border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">Sales</th>
                    <th className="px-4 py-3">Orders</th>
                    <th className="px-4 py-3">Avg Order</th>
                  </tr>
                </thead>
                <tbody>
                  {branchPerformance.map((row) => (
                    <tr key={String(row.branch_id || row.branch_name)} className="border-t border-white/5">
                      <td className="px-4 py-3 text-white">{row.branch_name}</td>
                      <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.total_sales)}</td>
                      <td className="px-4 py-3 text-zinc-200">{row.total_orders || 0}</td>
                      <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.average_order_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </EmployeeAnalyticsShell>
  );
}
