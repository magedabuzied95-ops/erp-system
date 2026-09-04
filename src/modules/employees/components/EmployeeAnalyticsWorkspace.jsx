import { nowAsAppWallClock } from "../../../shared/lib/appTimezone";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
  createCommissionRule,
  getCommissionRules,
  getCommissions,
  getSalesPerformance,
  getTopPerformers,
} from "../services/employeeAnalyticsApi";

const safeArray = (value) => (Array.isArray(value) ? value : []);

const PRESET_OPTIONS = [
  { value: "30_days", labelKey: "last30Days" },
  { value: "7_days", labelKey: "last7Days" },
  { value: "this_month", labelKey: "thisMonth" },
  { value: "this_year", labelKey: "thisYear" },
  { value: "custom", labelKey: "custom" },
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
  const today = nowAsAppWallClock();
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
const localizedRuleValue = (t, group, value) => t(`common.employeeHub.analytics.commissions.${group}.${value || "global"}`);
const EMPTY_SUMMARY = {
  totalSales: 0,
  totalOrders: 0,
  totalCommission: 0,
  bestCashier: "",
  highestAverageOrder: null,
};

export default function EmployeeAnalyticsWorkspace() {
  const { t, i18n } = useTranslation();
  const isRtl = String(i18n.language || "").toLowerCase().startsWith("ar");
  const direction = isRtl ? "rtl" : "ltr";
  const unlinkedEmployeeLabel = t("common.employeeHub.analytics.labels.unlinkedEmployee", isRtl ? "موظف غير مرتبط" : "Unlinked employee");
  const noShiftLabel = t("common.employeeHub.analytics.labels.noShiftAssigned", isRtl ? "بدون شيفت" : "No shift assigned");
  const displayEmployeeName = (value) => {
    const text = String(value || "").trim();
    return !text || text === "Unknown Employee" || text === "Unlinked employee" ? unlinkedEmployeeLabel : text;
  };
  const displayShiftName = (value) => {
    const text = String(value || "").trim();
    return !text || text === "Unassigned Shift" || text === "No shift assigned" ? noShiftLabel : text;
  };
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
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
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
        setRules(rulesRows);
        setTopPerformers(topRows.length ? topRows : salesRows.slice(0, 10));
        setSummary({
          totalSales: sales?.summary?.totalSales ?? salesRows.reduce((acc, row) => acc + Number(row.total_sales || 0), 0) ?? 0,
          totalOrders: sales?.summary?.totalOrders ?? salesRows.reduce((acc, row) => acc + Number(row.total_orders || 0), 0) ?? 0,
          totalCommission: sales?.summary?.totalCommission ?? commissionsRows.reduce((acc, row) => acc + Number(row.commission_amount || 0), 0) ?? 0,
          bestCashier: sales?.summary?.bestCashier || salesRows[0]?.employee_name || "",
          highestAverageOrder: sales?.summary?.highestAverageOrder || null,
        });
        setSource("live");
      } catch (loadError) {
        if (!active) return;

        console.warn("Employee analytics failed to load live data.", loadError);
        setSalesPerformance([]);
        setShiftPerformance([]);
        setBranchPerformance([]);
        setCommissions([]);
        setRules([]);
        setTopPerformers([]);
        setSummary(EMPTY_SUMMARY);
        setSource("error");
        setError(t("common.employeeHub.analytics.status.unavailableMessage", "Employee analytics are unavailable. No placeholder data is shown."));
        toast.error(t("common.employeeHub.analytics.toasts.unavailableData", "Unable to load employee analytics"));
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
        companyName: t("common.employeeHub.analytics.export.companyName"),
        title: t("common.employeeHub.analytics.export.title"),
        subtitle: t("common.employeeHub.analytics.export.subtitle"),
      },
    }),
    [summary, salesPerformance, commissions, topPerformers, shiftPerformance, branchPerformance, rules, filters, t]
  );

  const handleExportPdf = async () => {
    try {
      await downloadEmployeePdf(exportPayload);
    } catch (err) {
      console.warn("Employee analytics PDF export failed", err);
      toast.error(t("common.employeeHub.analytics.toasts.exportPdfFailed"));
    }
  };

  const handleExportCsv = () => {
    try {
      downloadEmployeeCsv(exportPayload);
    } catch (err) {
      console.warn("Employee analytics CSV export failed", err);
      toast.error(t("common.employeeHub.analytics.toasts.exportCsvFailed"));
    }
  };

  const handlePrint = () => {
    try {
      printEmployeeReport(exportPayload);
    } catch (err) {
      console.warn("Employee analytics print failed", err);
      toast.error(t("common.employeeHub.analytics.toasts.printFailed"));
    }
  };

  const handleCreateRule = async () => {
    if (!ruleDraft.name.trim()) {
      toast.error(t("common.employeeHub.analytics.toasts.ruleNameRequired"));
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
      toast.success(t("common.employeeHub.analytics.toasts.ruleCreated"));
    } catch (err) {
      console.warn("Commission rule creation failed", err);
      toast.error(t("common.employeeHub.analytics.toasts.ruleCreateFailed"));
    }
  };

  const refresh = () => {
    setFilters((prev) => ({ ...prev }));
  };

  const chartData = salesPerformance.slice(0, 8).map((item) => ({
    name: displayEmployeeName(item.employee_name),
    sales: Number(item.total_sales || 0),
    commission: Number(item.commission_earned || 0),
  }));

  const shiftChartData = shiftPerformance.slice(0, 8).map((item) => ({
    name: displayShiftName(item.shift_name),
    sales: Number(item.total_sales || 0),
  }));

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center rounded-[32px] border border-white/10 bg-zinc-950/80">
        <div className="inline-flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-5 py-4 text-zinc-200">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          {t("common.employeeHub.analytics.loading")}
        </div>
      </div>
    );
  }

  return (
    <EmployeeAnalyticsShell
      title={t("common.employeeHub.analytics.title")}
      subtitle={t("common.employeeHub.analytics.subtitle")}
      eyebrow={t("common.employeeHub.analytics.eyebrow")}
      actionLabels={{
        refresh: t("common.refresh"),
        exportPdf: t("common.employeeHub.analytics.actions.exportPdf"),
        exportCsv: t("common.employeeHub.analytics.actions.exportCsv"),
        print: t("common.print"),
      }}
      isRtl={isRtl}
      onRefresh={refresh}
      onExportPdf={handleExportPdf}
      onExportCsv={handleExportCsv}
      onPrint={handlePrint}
    >
      <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.16)]" dir={direction}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <CalendarDays className="h-4 w-4 text-primary" />
              {t("common.employeeHub.analytics.filters.title")}
            </div>
            <p className="mt-1 text-xs text-zinc-500">{t("common.employeeHub.analytics.filters.subtitle")}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {t("common.employeeHub.analytics.filters.range")}
              <select
                value={filters.datePreset}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    datePreset: event.target.value,
                    ...(event.target.value === "custom" ? {} : getPresetRange(event.target.value)),
                  }))
                }
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-primary/40"
              >
                {PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(`common.employeeHub.analytics.presets.${option.labelKey}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {t("common.employeeHub.analytics.filters.startDate")}
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
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {t("common.employeeHub.analytics.filters.endDate")}
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
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${source === "error" ? "bg-rose-500/10 text-rose-200" : "bg-emerald-500/10 text-emerald-200"}`}>
            {source === "error" ? t("common.employeeHub.analytics.status.unavailable", "Unavailable") : t("common.employeeHub.analytics.status.liveData")}
          </span>
          {error ? <span className="rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200">{error}</span> : null}
          {refreshing ? <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{t("common.employeeHub.analytics.status.refreshing")}</span> : null}
        </div>
      </div>

      <div className="space-y-6" id="analytics-overview">
          <div className="grid gap-4 xl:grid-cols-4">
            <EmployeeMetricCard label={t("common.employeeHub.analytics.metrics.bestCashier")} value={summary.bestCashier || t("common.notAvailable")} hint={t("common.employeeHub.analytics.metrics.highestSales")} tone="emerald" isRtl={isRtl} />
            <EmployeeMetricCard label={t("common.employeeHub.analytics.metrics.highestRevenue")} value={formatCurrency(summary.totalSales)} hint={t("common.employeeHub.analytics.metrics.orders", { count: summary.totalOrders || 0 })} tone="cyan" isRtl={isRtl} />
            <EmployeeMetricCard label={t("common.employeeHub.analytics.metrics.highestAverageOrder")} value={formatCurrency(summary.highestAverageOrder?.average_order_value || 0)} hint={summary.highestAverageOrder?.employee_name || t("common.notAvailable")} tone="amber" isRtl={isRtl} />
            <EmployeeMetricCard label={t("common.employeeHub.analytics.metrics.commissionLeaderboard")} value={formatCurrency(summary.totalCommission)} hint={t("common.employeeHub.analytics.metrics.totalEarnedCommission")} tone="rose" isRtl={isRtl} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className={isRtl ? "text-xs font-bold text-primary" : "text-xs uppercase tracking-[0.22em] text-primary"}>{t("common.employeeHub.analytics.charts.revenueByEmployee")}</div>
                  <h2 className="m1-section-title mt-2 text-white">{t("common.employeeHub.analytics.charts.salesCommissionMix")}</h2>
                </div>
                <ShieldCheck className="h-5 w-5 text-primary" />
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
                    <Bar dataKey="sales" fill="var(--primary)" radius={[10, 10, 0, 0]} />
                    <Bar dataKey="commission" fill="var(--chart-secondary, #77736a)" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className={isRtl ? "text-xs font-bold text-primary" : "text-xs uppercase tracking-[0.22em] text-primary"}>{t("common.employeeHub.analytics.charts.shiftAnalytics")}</div>
                  <h2 className="m1-section-title mt-2 text-white">{t("common.employeeHub.analytics.charts.shiftRevenueTrend")}</h2>
                </div>
                <Clock3 className="h-5 w-5 text-primary" />
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
                    <Line type="monotone" dataKey="sales" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4, fill: "var(--primary)" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
      </div>

      <section id="analytics-sales" className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Users className="h-4 w-4 text-emerald-300" />
            {t("common.employeeHub.analytics.sections.salesPerformance")}
          </div>
          <div className="overflow-x-auto rounded-3xl border border-white/10">
            <table className={`m1-table m1-table--compact min-w-full ${isRtl ? "text-right" : "text-left"}`}>
              <thead className="bg-white/5 text-zinc-400">
                <tr>
                  <th className="px-4 py-3">{t("common.employeeHub.analytics.table.employee")}</th>
                  <th className="px-4 py-3">{t("common.employeeHub.analytics.table.role")}</th>
                  <th className="px-4 py-3">{t("common.employeeHub.analytics.table.sales")}</th>
                  <th className="px-4 py-3">{t("common.employeeHub.analytics.table.orders")}</th>
                  <th className="px-4 py-3">{t("common.employeeHub.analytics.table.avgOrder")}</th>
                  <th className="px-4 py-3">{t("common.employeeHub.analytics.table.commission")}</th>
                  <th className="px-4 py-3">{t("common.employeeHub.analytics.table.refunds")}</th>
                </tr>
              </thead>
              <tbody>
                {salesPerformance.map((row) => (
                  <tr key={String(row.employee_id || row.employee_name)} className="border-t border-white/5">
                    <td className="px-4 py-3 text-white">{displayEmployeeName(row.employee_name)}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.role_name || t("common.employeeHub.analytics.roles.staff")}</td>
                    <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.total_sales)}</td>
                    <td className="px-4 py-3 text-zinc-200">{row.total_orders || 0}</td>
                    <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.average_order_value)}</td>
                    <td className="px-4 py-3 text-primary">{formatCurrency(row.commission_earned)}</td>
                    <td className="px-4 py-3 text-rose-200">{formatCurrency(row.refunds_impact)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </section>

      <section id="analytics-commissions" className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            <EmployeeMetricCard label={t("common.employeeHub.analytics.metrics.commissionRows")} value={commissions.length} hint={t("common.employeeHub.analytics.metrics.recordedEarnings")} tone="cyan" isRtl={isRtl} />
            <EmployeeMetricCard label={t("common.employeeHub.analytics.metrics.ruleCount")} value={rules.length} hint={t("common.employeeHub.analytics.metrics.activeInactiveRules")} tone="amber" isRtl={isRtl} />
            <EmployeeMetricCard label={t("common.employeeHub.analytics.metrics.totalCommission")} value={formatCurrency(summary.totalCommission)} hint={t("common.employeeHub.analytics.metrics.fromCommissionRows")} tone="emerald" isRtl={isRtl} />
          </div>

          <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className={isRtl ? "text-xs font-bold text-primary" : "text-xs uppercase tracking-[0.22em] text-primary"}>{t("common.employeeHub.analytics.commissions.rules")}</div>
                <h2 className="m1-section-title mt-2 text-white">{t("common.employeeHub.analytics.commissions.configurableRules")}</h2>
              </div>
            </div>
            <div className="mb-5 grid gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4 xl:grid-cols-4">
              <input
                value={ruleDraft.name}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder={t("common.employeeHub.analytics.commissions.ruleName")}
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <select
                value={ruleDraft.scope_type}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, scope_type: event.target.value }))}
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="global">{t("common.employeeHub.analytics.commissions.scope.global")}</option>
                <option value="product">{t("common.employeeHub.analytics.commissions.scope.product")}</option>
                <option value="category">{t("common.employeeHub.analytics.commissions.scope.category")}</option>
                <option value="employee">{t("common.employeeHub.analytics.commissions.scope.employee")}</option>
              </select>
              <select
                value={ruleDraft.rule_type}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, rule_type: event.target.value }))}
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="percentage">{t("common.employeeHub.analytics.commissions.ruleType.percentage")}</option>
                <option value="fixed">{t("common.employeeHub.analytics.commissions.ruleType.fixed")}</option>
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={ruleDraft.value}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, value: event.target.value }))}
                placeholder={t("common.employeeHub.analytics.commissions.value")}
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <input
                value={ruleDraft.scope_id}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, scope_id: event.target.value }))}
                placeholder={t("common.employeeHub.analytics.commissions.scopeId")}
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <input
                type="number"
                min="0"
                step="1"
                value={ruleDraft.priority}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, priority: event.target.value }))}
                placeholder={t("common.employeeHub.analytics.commissions.priority")}
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <select
                value={ruleDraft.apply_to}
                onChange={(event) => setRuleDraft((prev) => ({ ...prev, apply_to: event.target.value }))}
                className="rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="sale">{t("common.employeeHub.analytics.commissions.apply.sale")}</option>
                <option value="item">{t("common.employeeHub.analytics.commissions.apply.item")}</option>
              </select>
              <button
                type="button"
                onClick={handleCreateRule}
                className="rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-black transition hover:bg-primary"
              >
                {t("common.employeeHub.analytics.commissions.addRule")}
              </button>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {rules.map((rule) => (
                <div key={String(rule.id)} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-bold text-white">{rule.name}</div>
                      <div className={isRtl ? "text-xs font-bold text-zinc-500" : "text-xs uppercase tracking-[0.18em] text-zinc-500"}>{localizedRuleValue(t, "scope", rule.scope_type)} / {localizedRuleValue(t, "ruleType", rule.rule_type)}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${rule.is_active ? "bg-emerald-500/10 text-emerald-200" : "bg-rose-500/10 text-rose-200"}`}>
                      {rule.is_active ? t("common.employeeHub.analytics.status.active") : t("common.employeeHub.analytics.status.inactive")}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                    <div>{t("common.employeeHub.analytics.commissions.value")}: <span className="font-semibold text-white">{Number(rule.value || 0)}{rule.rule_type === "percentage" ? "%" : ""}</span></div>
                    <div>{t("common.employeeHub.analytics.commissions.priority")}: <span className="font-semibold text-white">{rule.priority || 0}</span></div>
                    <div>{t("common.employeeHub.analytics.commissions.appliesTo")}: <span className="font-semibold text-white">{localizedRuleValue(t, "apply", rule.apply_to || "sale")}</span></div>
                    <div>{t("common.employeeHub.analytics.commissions.scopeIdLabel")}: <span className="font-semibold text-white">{rule.scope_id || t("common.employeeHub.analytics.commissions.scope.global")}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
            <div className={isRtl ? "mb-4 text-xs font-bold text-primary" : "mb-4 text-xs uppercase tracking-[0.22em] text-primary"}>{t("common.employeeHub.analytics.commissions.transactions")}</div>
            <div className="overflow-x-auto rounded-3xl border border-white/10">
              <table className={`m1-table m1-table--compact min-w-full ${isRtl ? "text-right" : "text-left"}`}>
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">{t("common.employeeHub.analytics.table.employee")}</th>
                    <th className="px-4 py-3">{t("common.employeeHub.analytics.table.invoice")}</th>
                    <th className="px-4 py-3">{t("common.employeeHub.analytics.table.sale")}</th>
                    <th className="px-4 py-3">{t("common.employeeHub.analytics.table.commission")}</th>
                    <th className="px-4 py-3">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((row) => (
                    <tr key={String(row.id)} className="border-t border-white/5">
                      <td className="px-4 py-3 text-white">{displayEmployeeName(row.employee_name)}</td>
                      <td className="px-4 py-3 text-zinc-300">{row.invoice_number || t("common.notAvailable")}</td>
                      <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.sale_amount)}</td>
                      <td className="px-4 py-3 text-emerald-200">{formatCurrency(row.commission_amount)}</td>
                      <td className="px-4 py-3 text-primary">{row.status || t("common.notAvailable")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
      </section>

      <section id="analytics-top" className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Crown className="h-4 w-4 text-amber-300" />
            {t("common.employeeHub.analytics.sections.topPerformers")}
          </div>
          {chartData.length === 0 && shiftChartData.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-white/10 bg-zinc-950/70 p-8 text-sm font-semibold text-zinc-400">
              {t("common.employeeHub.analytics.empty.noSalesData", "No sales data")}
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            {topPerformers.map((row, index) => (
              <div key={String(row.employee_id || row.employee_name)} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between">
                  <div className="text-white font-bold">{index + 1}. {displayEmployeeName(row.employee_name)}</div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getTone(row.total_sales, 100000) === "emerald" ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`}>
                    {formatCurrency(row.total_sales)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                  <div>{t("common.employeeHub.analytics.table.orders")}: <span className="font-semibold text-white">{row.total_orders || 0}</span></div>
                  <div>{t("common.employeeHub.analytics.table.avgOrder")}: <span className="font-semibold text-white">{formatCurrency(row.average_order_value)}</span></div>
                  <div>{t("common.employeeHub.analytics.table.commission")}: <span className="font-semibold text-primary">{formatCurrency(row.commission_earned)}</span></div>
                  <div>{t("common.employeeHub.analytics.table.shift")}: <span className="font-semibold text-white">{displayShiftName(row.shift_name)}</span></div>
                </div>
              </div>
            ))}
          </div>
      </section>

      <section id="analytics-shifts" className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Building2 className="h-4 w-4 text-primary" />
            {t("common.employeeHub.analytics.sections.shiftAnalytics")}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {shiftPerformance.map((row) => (
              <div key={String(row.shift_id || row.shift_name)} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
                <div className="text-white font-bold">{displayShiftName(row.shift_name)}</div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-zinc-300">
                  <div>{t("common.employeeHub.analytics.table.sales")}<br /><span className="font-semibold text-white">{formatCurrency(row.total_sales)}</span></div>
                  <div>{t("common.employeeHub.analytics.table.orders")}<br /><span className="font-semibold text-white">{row.total_orders || 0}</span></div>
                  <div>{t("common.employeeHub.analytics.table.avgOrder")}<br /><span className="font-semibold text-white">{formatCurrency(row.average_order_value)}</span></div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={shiftPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="shift_name" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <Tooltip contentStyle={{ backgroundColor: "#09090b", border: "1px solid #27272a", borderRadius: 16, color: "#fff" }} />
                  <Bar dataKey="total_sales" radius={[10, 10, 0, 0]}>
                    {shiftPerformance.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index % 2 === 0 ? "var(--primary)" : "var(--chart-secondary, #77736a)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-6 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
            <div className={isRtl ? "mb-3 text-xs font-bold text-primary" : "mb-3 text-xs uppercase tracking-[0.22em] text-primary"}>{t("common.employeeHub.analytics.sections.branchPerformance")}</div>
            <div className="overflow-x-auto rounded-3xl border border-white/10">
              <table className={`m1-table m1-table--compact min-w-full ${isRtl ? "text-right" : "text-left"}`}>
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">{t("common.employeeHub.analytics.table.branch")}</th>
                    <th className="px-4 py-3">{t("common.employeeHub.analytics.table.sales")}</th>
                    <th className="px-4 py-3">{t("common.employeeHub.analytics.table.orders")}</th>
                    <th className="px-4 py-3">{t("common.employeeHub.analytics.table.avgOrder")}</th>
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
    </EmployeeAnalyticsShell>
  );
}
