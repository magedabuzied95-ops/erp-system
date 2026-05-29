import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, BarChart3, Calculator, Download, FileSpreadsheet, FileText, Loader2, ReceiptText, RefreshCcw, Search, TrendingUp } from "lucide-react";
import toast from "react-hot-toast";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { exportAccountingCsv, exportAccountingExcel, exportAccountingPdf } from "../lib/financialReportExport";
import { formatCurrency } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";
import { getCurrentUser, isAdminUser } from "../../../shared/auth/authStorage";

const emptySummary = {
  revenue_report: { total_revenue: 0, orders_count: 0 },
  expense_report: { total_expenses: 0 },
  profit: 0,
  inventory_valuation: 0,
  top_customers: [],
  top_products: [],
};

const emptyProfitLoss = {
  revenue: {
    gross_sales: 0,
    discounts: 0,
    returns: 0,
    net_sales: 0,
  },
  cogs: { total_cogs: 0 },
  gross_profit: 0,
  expenses: [],
  total_expenses: 0,
  net_profit: 0,
};

const emptyTrialBalance = {
  rows: [],
  totals: { debit: 0, credit: 0, difference: 0 },
};

const emptyBalanceSheet = {
  assets: [],
  liabilities: [],
  equity: [],
  totals: {
    assets: 0,
    liabilities: 0,
    equity: 0,
    liabilities_and_equity: 0,
    difference: 0,
  },
};

function FinancialReports() {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState("overview");
  const [summary, setSummary] = useState(emptySummary);
  const [profitLoss, setProfitLoss] = useState(emptyProfitLoss);
  const [trialBalance, setTrialBalance] = useState(emptyTrialBalance);
  const [balanceSheet, setBalanceSheet] = useState(emptyBalanceSheet);
  const [filters, setFilters] = useState({
    from_date: "",
    to_date: "",
    branch_id: "",
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncingEntries, setSyncingEntries] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  const canSyncAccounting = isAdminUser(getCurrentUser());

  const loadReports = async (params = filters) => {
    setLoading(true);
    setError("");
    try {
      const [summaryResult, profitLossResult, trialBalanceResult, balanceSheetResult] = await Promise.all([
        accountingApi.getFinancialReportsSummary(params),
        accountingApi.getProfitLossReport(params),
        accountingApi.getTrialBalanceReport(params),
        accountingApi.getBalanceSheetReport(params),
      ]);
      setSummary({ ...emptySummary, ...summaryResult });
      setProfitLoss({ ...emptyProfitLoss, ...profitLossResult });
      setTrialBalance({ ...emptyTrialBalance, ...trialBalanceResult, totals: { ...emptyTrialBalance.totals, ...(trialBalanceResult?.totals || {}) } });
      setBalanceSheet({ ...emptyBalanceSheet, ...balanceSheetResult, totals: { ...emptyBalanceSheet.totals, ...(balanceSheetResult?.totals || {}) } });
      setAppliedFilters(params);
    } catch (requestError) {
      setError(requestError?.message || t("accounting.reports.errors.loadFailed"));
      setSummary(emptySummary);
      setProfitLoss(emptyProfitLoss);
      setTrialBalance(emptyTrialBalance);
      setBalanceSheet(emptyBalanceSheet);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = (event) => {
    event.preventDefault();
    loadReports(filters);
  };

  const exportPayload = {
    reportType: activeTab,
    summary,
    profitLoss,
    trialBalance,
    balanceSheet,
    filters: appliedFilters,
    language: i18n.language,
  };

  const logExport = async (format) => {
    await accountingApi.logExportGenerated({
      report_type: activeTab,
      format,
      filters: appliedFilters,
    }).catch(() => {});
  };

  const exportReport = async (format, exporter) => {
    await logExport(format);
    exporter(exportPayload);
  };

  const revenue = Number(summary.revenue_report?.total_revenue || 0);
  const expenses = Number(summary.expense_report?.total_expenses || 0);
  const profit = Number(summary.profit || 0);
  const inventoryValuation = Number(summary.inventory_valuation || 0);
  const topCustomers = Array.isArray(summary.top_customers) ? summary.top_customers : [];
  const topProducts = Array.isArray(summary.top_products) ? summary.top_products : [];
  const grossProfit = Number(profitLoss.gross_profit || 0);
  const netProfit = Number(profitLoss.net_profit || 0);

  const runAccountingSync = async () => {
    setSyncingEntries(true);
    try {
      const result = await accountingApi.rebuildLedgerEntries();
      setShowSyncModal(false);
      await loadReports(appliedFilters);
      const warningText = Array.isArray(result?.warnings) && result.warnings.length ? ` ${t("accounting.reports.toasts.syncWarnings", { warnings: result.warnings.join(" ") })}` : "";
      toast.success(`${t("accounting.reports.toasts.syncSuccess", {
        created: Number(result?.created || 0),
        deleted: Number(result?.deleted_old_generated_entries || 0),
        skipped: Number(result?.skipped || 0),
      })}${warningText}`);
    } catch (syncError) {
      toast.error(syncError?.message || t("accounting.reports.errors.syncFailed"));
    } finally {
      setSyncingEntries(false);
    }
  };

  return (
    <AccountingShell
      title={t("accounting.reports.title")}
      subtitle={t("accounting.reports.subtitle")}
      actions={
        <>
          {canSyncAccounting ? (
            <button type="button" onClick={() => setShowSyncModal(true)} disabled={syncingEntries} className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-black text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-60">
              {syncingEntries ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              {t("accounting.reports.actions.syncEntries")}
            </button>
          ) : null}
          <button type="button" onClick={() => exportReport("pdf", exportAccountingPdf)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
            <FileText className="h-4 w-4" />
            {t("accounting.common.actions.exportPdf")}
          </button>
          <button type="button" onClick={() => exportReport("excel", exportAccountingExcel)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
            <FileSpreadsheet className="h-4 w-4" />
            {t("accounting.common.actions.exportExcel")}
          </button>
          <button type="button" onClick={() => exportReport("csv", exportAccountingCsv)} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black">
            <Download className="h-4 w-4" />
            {t("accounting.common.actions.exportCsv")}
          </button>
        </>
      }
      tabs={[
        { to: "/accounting", label: t("accounting.tabs.dashboard") },
        { to: "/accounting/reports", label: t("accounting.tabs.reports"), end: true },
        { to: "/accounting/profit-loss", label: t("accounting.tabs.profitLoss") },
        { to: "/accounting/ledgers", label: t("accounting.tabs.ledgers") },
        { to: "/accounting/cost-fix", label: t("accounting.tabs.costFix") },
        { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
      ]}
    >
      {showSyncModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl shadow-black">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-3 text-amber-200">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white">{t("accounting.reports.syncModal.title")}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {t("accounting.reports.syncModal.body")}
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowSyncModal(false)} disabled={syncingEntries} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-60">
                {t("accounting.common.actions.cancel")}
              </button>
              <button type="button" onClick={runAccountingSync} disabled={syncingEntries} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 py-2 text-sm font-black text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60">
                {syncingEntries ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                {t("accounting.reports.actions.rebuildEntries")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <form onSubmit={applyFilters} className="grid gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10 md:grid-cols-4">
        <FilterField label={t("accounting.common.labels.from")}>
          <input type="date" value={filters.from_date} onChange={(event) => updateFilter("from_date", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/60" />
        </FilterField>
        <FilterField label={t("accounting.common.labels.to")}>
          <input type="date" value={filters.to_date} onChange={(event) => updateFilter("to_date", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/60" />
        </FilterField>
        <FilterField label={t("accounting.common.labels.branch")}>
          <input type="number" min="1" placeholder={t("accounting.common.placeholders.branchId")} value={filters.branch_id} onChange={(event) => updateFilter("branch_id", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-400/60" />
        </FilterField>
        <div className="flex items-end">
          <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400">
            <Search className="h-4 w-4" />
            {t("accounting.common.actions.apply")}
          </button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2 rounded-3xl border border-white/10 bg-zinc-950/90 p-2 shadow-xl shadow-black/10">
        <ReportTab label={t("accounting.reports.tabs.overview")} active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
        <ReportTab label={t("accounting.reports.tabs.profitLoss")} active={activeTab === "profit-loss"} onClick={() => setActiveTab("profit-loss")} />
        <ReportTab label={t("accounting.reports.tabs.trialBalance")} active={activeTab === "trial-balance"} onClick={() => setActiveTab("trial-balance")} />
        <ReportTab label={t("accounting.reports.tabs.balanceSheet")} active={activeTab === "balance-sheet"} onClick={() => setActiveTab("balance-sheet")} />
      </div>

      {loading ? (
        <StateBanner icon={<Loader2 className="h-5 w-5 animate-spin" />} title={t("accounting.reports.states.loadingTitle")} text={t("accounting.reports.states.loadingText")} />
      ) : null}

      {error ? (
        <StateBanner
          icon={<AlertTriangle className="h-5 w-5" />}
          title={t("accounting.reports.states.errorTitle")}
          text={error}
          action={
            <button type="button" onClick={loadReports} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
              <RefreshCcw className="h-4 w-4" />
              {t("accounting.common.actions.retry")}
            </button>
          }
        />
      ) : null}

      {activeTab === "overview" ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FinanceMetricCard label={t("accounting.reports.metrics.revenueReport")} value={formatCurrency(revenue)} hint={t("accounting.reports.hints.paidOrders", { count: Number(summary.revenue_report?.orders_count || 0) })} tone="emerald" icon={<BarChart3 className="h-5 w-5" />} />
            <FinanceMetricCard label={t("accounting.reports.metrics.expenseReport")} value={formatCurrency(expenses)} tone="rose" icon={<ReceiptText className="h-5 w-5" />} />
            <FinanceMetricCard label={t("accounting.reports.metrics.profit")} value={formatCurrency(profit)} tone={profit >= 0 ? "emerald" : "rose"} icon={<TrendingUp className="h-5 w-5" />} />
            <FinanceMetricCard label={t("accounting.reports.metrics.inventoryValuation")} value={formatCurrency(inventoryValuation)} hint={t("accounting.reports.hints.inventoryValuation")} tone="amber" icon={<BarChart3 className="h-5 w-5" />} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ReportCard title={t("accounting.reports.cards.topCustomers")} emptyText={t("accounting.reports.empty.noRows")} rows={topCustomers.map((item) => ({ label: item.name || t("accounting.reports.fallbacks.walkInCustomer"), value: formatCurrency(item.total_revenue), hint: t("accounting.reports.hints.orders", { count: Number(item.orders_count || 0) }) }))} />
            <ReportCard title={t("accounting.reports.cards.topProducts")} emptyText={t("accounting.reports.empty.noRows")} rows={topProducts.map((item) => ({ label: item.name || t("accounting.reports.fallbacks.unknownProduct"), value: formatCurrency(item.total_revenue), hint: t("accounting.reports.hints.units", { count: Number(item.units_sold || 0) }) }))} />
          </div>
        </>
      ) : null}

      {activeTab === "profit-loss" ? (
        <ProfitLossReport report={profitLoss} grossProfit={grossProfit} netProfit={netProfit} t={t} />
      ) : null}

      {activeTab === "trial-balance" ? <TrialBalanceReport report={trialBalance} t={t} /> : null}

      {activeTab === "balance-sheet" ? <BalanceSheetReport report={balanceSheet} t={t} /> : null}
    </AccountingShell>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function ReportTab({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-2xl px-4 py-2 text-sm font-black transition",
        active ? "bg-cyan-500 text-black" : "text-zinc-400 hover:bg-white/5 hover:text-white",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ProfitLossReport({ report, grossProfit, netProfit, t }) {
  const expenses = Array.isArray(report.expenses) ? report.expenses : [];
  const hasActivity = [
    report.revenue?.gross_sales,
    report.revenue?.discounts,
    report.revenue?.returns,
    report.revenue?.net_sales,
    report.cogs?.total_cogs,
    report.gross_profit,
    report.total_expenses,
    report.net_profit,
  ].some((value) => Number(value || 0) !== 0) || expenses.length > 0;

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={t("accounting.reports.metrics.grossSales")} value={formatCurrency(report.revenue?.gross_sales || 0)} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.reports.metrics.netSales")} value={formatCurrency(report.revenue?.net_sales || 0)} tone="cyan" icon={<BarChart3 className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.reports.metrics.cogs")} value={formatCurrency(report.cogs?.total_cogs || 0)} tone="rose" icon={<Calculator className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.reports.metrics.netProfit")} value={formatCurrency(netProfit)} tone={netProfit >= 0 ? "emerald" : "rose"} icon={<TrendingUp className="h-5 w-5" />} />
      </div>

      {!hasActivity ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/90 p-8 text-sm text-zinc-400 shadow-2xl shadow-black/10">
          {t("accounting.reports.empty.noProfitLossActivity")}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="text-xl font-black text-white">{t("accounting.reports.cards.profitLossStatement")}</h3>
          <div className="mt-4 space-y-2">
            <StatementLine label={t("accounting.reports.metrics.grossSales")} value={report.revenue?.gross_sales || 0} />
            <StatementLine label={t("accounting.reports.metrics.discounts")} value={report.revenue?.discounts || 0} muted />
            <StatementLine label={t("accounting.reports.metrics.returns")} value={report.revenue?.returns || 0} muted />
            <StatementLine label={t("accounting.reports.metrics.netSales")} value={report.revenue?.net_sales || 0} strong />
            <StatementLine label={t("accounting.reports.metrics.cogs")} value={report.cogs?.total_cogs || 0} muted />
            <StatementLine label={t("accounting.reports.metrics.grossProfit")} value={grossProfit} strong tone={grossProfit >= 0 ? "emerald" : "rose"} />
            <StatementLine label={t("accounting.reports.metrics.totalExpenses")} value={report.total_expenses || 0} muted />
            <StatementLine label={t("accounting.reports.metrics.netProfit")} value={netProfit} strong tone={netProfit >= 0 ? "emerald" : "rose"} />
          </div>
        </div>

        <ReportCard title={t("accounting.reports.cards.expensesByCategory")} emptyText={t("accounting.reports.empty.noRows")} rows={expenses.map((item) => ({ label: item.category || t("accounting.reports.fallbacks.uncategorized"), value: formatCurrency(item.amount), hint: t("accounting.reports.hints.operatingExpense") }))} />
      </div>
    </>
  );
}

function TrialBalanceReport({ report, t }) {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const totals = report.totals || {};
  const difference = Number(totals.difference || 0);

  return (
    <>
      {Math.abs(difference) > 0.01 ? (
        <StateBanner icon={<AlertTriangle className="h-5 w-5" />} title={t("accounting.reports.states.trialBalanceUnbalanced")} text={t("accounting.reports.states.trialBalanceDifference", { amount: formatCurrency(difference) })} />
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <FinanceMetricCard label={t("accounting.common.metrics.totalDebit")} value={formatCurrency(totals.debit || 0)} tone="emerald" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.common.metrics.totalCredit")} value={formatCurrency(totals.credit || 0)} tone="rose" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.reports.metrics.difference")} value={formatCurrency(difference)} tone={Math.abs(difference) > 0.01 ? "rose" : "cyan"} icon={<BarChart3 className="h-5 w-5" />} />
      </div>

      <ReportTable
        title={t("accounting.reports.tabs.trialBalance")}
        emptyText={t("accounting.reports.empty.noTrialBalanceRows")}
        rowCountLabel={t("accounting.common.rows.rows", { count: rows.length })}
        columns={[t("accounting.common.labels.account"), t("accounting.common.labels.type"), t("accounting.common.labels.debit"), t("accounting.common.labels.credit"), t("accounting.common.labels.balance")]}
        rows={rows.map((row) => [
          row.account_name || "-",
          row.account_type || "-",
          formatCurrency(row.debit || 0),
          formatCurrency(row.credit || 0),
          formatCurrency(row.balance || 0),
        ])}
      />
    </>
  );
}

function BalanceSheetReport({ report, t }) {
  const totals = report.totals || {};
  const difference = Number(totals.difference || 0);
  const sections = [
    [t("accounting.reports.metrics.assets"), report.assets || []],
    [t("accounting.reports.metrics.liabilities"), report.liabilities || []],
    [t("accounting.reports.metrics.equity"), report.equity || []],
  ];

  return (
    <>
      {Math.abs(difference) > 0.01 ? (
        <StateBanner icon={<AlertTriangle className="h-5 w-5" />} title={t("accounting.reports.states.balanceSheetUnbalanced")} text={t("accounting.reports.states.balanceSheetDifference", { amount: formatCurrency(difference) })} />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={t("accounting.reports.metrics.assets")} value={formatCurrency(totals.assets || 0)} tone="emerald" icon={<BarChart3 className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.reports.metrics.liabilities")} value={formatCurrency(totals.liabilities || 0)} tone="rose" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.reports.metrics.equity")} value={formatCurrency(totals.equity || 0)} tone="cyan" icon={<TrendingUp className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.reports.metrics.difference")} value={formatCurrency(difference)} tone={Math.abs(difference) > 0.01 ? "rose" : "cyan"} icon={<Calculator className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {sections.map(([title, rows]) => (
          <ReportCard
            key={title}
            title={title}
            emptyText={t("accounting.reports.empty.noRows")}
            rows={(rows || []).map((item) => ({
              label: item.name || title,
              value: formatCurrency(item.amount || 0),
              hint: title,
            }))}
          />
        ))}
      </div>
    </>
  );
}

function ReportTable({ title, columns, rows, emptyText, rowCountLabel }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/10">
      <div className="border-b border-white/10 p-5">
        <h3 className="text-xl font-black text-white">{title}</h3>
        <p className="mt-1 text-sm text-zinc-400">{rowCountLabel}</p>
      </div>
      {rows.length === 0 ? (
        <div className="m-5 rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              <tr>{columns.map((column) => <th key={column} className="px-4 py-3 font-black">{column}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((row, index) => (
                <tr key={`${row[0]}-${index}`} className="transition hover:bg-white/[0.03]">
                  {row.map((cell, cellIndex) => (
                    <td key={`${cell}-${cellIndex}`} className={["px-4 py-4 align-top", cellIndex >= 2 ? "text-right font-black text-white" : "text-zinc-300"].join(" ")}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StateBanner({ icon, title, text, action }) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 text-white shadow-xl shadow-black/10 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-cyan-300">{icon}</div>
        <div>
          <div className="font-black">{title}</div>
          <div className="mt-1 text-sm text-zinc-400">{text}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

function StatementLine({ label, value, strong = false, muted = false, tone = "" }) {
  const toneClass = tone === "emerald" ? "text-emerald-300" : tone === "rose" ? "text-rose-300" : "text-white";
  return (
    <div className={["flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3", strong ? "border-cyan-400/20 bg-cyan-400/5" : ""].join(" ")}>
      <div className={["text-sm font-semibold", muted ? "text-zinc-400" : "text-white"].join(" ")}>{label}</div>
      <div className={["text-right font-black", strong ? `text-lg ${toneClass}` : "text-white"].join(" ")}>{formatCurrency(value)}</div>
    </div>
  );
}

function ReportCard({ title, rows, emptyText }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <h3 className="text-xl font-black text-white">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{emptyText}</div>
        ) : (
          rows.map((row) => (
            <div key={row.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{row.label}</div>
                  <div className="mt-1 text-xs text-zinc-500">{row.hint}</div>
                </div>
                <div className="font-black text-white">{row.value}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default FinancialReports;
