import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AlertTriangle, BarChart3, Calculator, Loader2, RefreshCcw, TrendingUp } from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";

const emptyReport = {
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

function ProfitAndLoss() {
  const { t } = useTranslation();
  const [report, setReport] = useState(emptyReport);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await accountingApi.getProfitLossReport();
      setReport({ ...emptyReport, ...result });
    } catch (requestError) {
      setError(requestError?.message || t("accounting.profitLoss.errors.loadFailed"));
      setReport(emptyReport);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, []);

  const grossProfit = Number(report.gross_profit || 0);
  const netProfit = Number(report.net_profit || 0);
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
    <AccountingShell
      title={t("accounting.profitLoss.title")}
      subtitle={t("accounting.profitLoss.subtitle")}
      actions={
        <Link to="/accounting/reports" className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-black">
          <Calculator className="h-4 w-4" />
          {t("accounting.tabs.reports")}
        </Link>
      }
      tabs={[
        { to: "/accounting", label: t("accounting.tabs.dashboard") },
        { to: "/accounting/reports", label: t("accounting.tabs.reports") },
        { to: "/accounting/profit-loss", label: t("accounting.tabs.profitLoss"), end: true },
        { to: "/accounting/ledgers", label: t("accounting.tabs.ledgers") },
        { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
      ]}
    >
      {loading ? <StateBanner icon={<Loader2 className="h-5 w-5 animate-spin" />} title={t("accounting.profitLoss.states.loadingTitle")} text={t("accounting.profitLoss.states.loadingText")} /> : null}

      {error ? (
        <StateBanner
          icon={<AlertTriangle className="h-5 w-5" />}
          title={t("accounting.profitLoss.states.errorTitle")}
          text={error}
          action={
            <button type="button" onClick={loadReport} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
              <RefreshCcw className="h-4 w-4" />
              {t("accounting.common.actions.retry")}
            </button>
          }
        />
      ) : null}

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
          <h3 className="m1-section-title text-white">{t("accounting.reports.cards.profitLossStatement")}</h3>
          <div className="mt-4 space-y-2">
            <Line label={t("accounting.reports.metrics.grossSales")} value={report.revenue?.gross_sales || 0} />
            <Line label={t("accounting.reports.metrics.discounts")} value={report.revenue?.discounts || 0} muted />
            <Line label={t("accounting.reports.metrics.returns")} value={report.revenue?.returns || 0} muted />
            <Line label={t("accounting.reports.metrics.netSales")} value={report.revenue?.net_sales || 0} strong />
            <Line label={t("accounting.reports.metrics.cogs")} value={report.cogs?.total_cogs || 0} muted />
            <Line label={t("accounting.reports.metrics.grossProfit")} value={grossProfit} strong tone={grossProfit >= 0 ? "emerald" : "rose"} />
            <Line label={t("accounting.reports.metrics.totalExpenses")} value={report.total_expenses || 0} muted />
            <Line label={t("accounting.reports.metrics.netProfit")} value={netProfit} strong tone={netProfit >= 0 ? "emerald" : "rose"} />
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="m1-section-title text-white">{t("accounting.reports.cards.expensesByCategory")}</h3>
          <div className="mt-4 space-y-3">
            {expenses.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{t("accounting.profitLoss.empty.noExpenseRows")}</div>
            ) : (
              expenses.map((item) => (
                <div key={item.category} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="font-semibold text-white">{item.category || t("accounting.reports.fallbacks.uncategorized")}</div>
                  <div className="font-black text-white">{formatCurrency(item.amount)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AccountingShell>
  );
}

function StateBanner({ icon, title, text, action }) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 text-white shadow-xl shadow-black/10 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-primary">{icon}</div>
        <div>
          <div className="font-black">{title}</div>
          <div className="mt-1 text-sm text-zinc-400">{text}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

function Line({ label, value, strong = false, muted = false, tone = "" }) {
  const toneClass = tone === "emerald" ? "text-emerald-300" : tone === "rose" ? "text-rose-300" : "text-white";
  return (
    <div className={["flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3", strong ? "border-primary/20 bg-primary/5" : ""].join(" ")}>
      <div className={["text-sm font-semibold", muted ? "text-zinc-400" : "text-white"].join(" ")}>{label}</div>
      <div className={["text-right font-black", strong ? `text-lg ${toneClass}` : "text-white"].join(" ")}>{formatCurrency(value)}</div>
    </div>
  );
}

export default ProfitAndLoss;
