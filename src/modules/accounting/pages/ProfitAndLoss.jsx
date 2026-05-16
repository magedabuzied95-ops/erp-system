import { useMemo } from "react";
import { Link } from "react-router-dom";

import { Calculator, Landmark, TrendingUp } from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import {
  buildFinancialSnapshot,
  formatCurrency,
  getAccountingSources,
} from "../lib/financeStore";

function ProfitAndLoss() {
  const snapshot = useMemo(() => buildFinancialSnapshot(getAccountingSources(), "all"), []);
  const grossProfit = snapshot.revenue - snapshot.purchaseSpend;
  const operatingProfit = grossProfit - snapshot.manualExpenses;

  return (
    <AccountingShell
      title="Profit & Loss"
      subtitle="A detailed statement with revenue, cost of goods, operating expenses, and net profit."
      actions={
        <Link to="/accounting/reports" className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black">
          <Calculator className="h-4 w-4" />
          Reports
        </Link>
      }
      tabs={[
        { to: "/accounting", label: "Dashboard" },
        { to: "/accounting/reports", label: "Reports" },
        { to: "/accounting/profit-loss", label: "P&L", end: true },
        { to: "/accounting/ledgers", label: "Ledgers" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label="Revenue" value={formatCurrency(snapshot.revenue)} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} />
        <FinanceMetricCard label="Cost of goods" value={formatCurrency(snapshot.purchaseSpend)} tone="rose" icon={<Calculator className="h-5 w-5" />} />
        <FinanceMetricCard label="Operating expenses" value={formatCurrency(snapshot.manualExpenses)} tone="amber" icon={<Landmark className="h-5 w-5" />} />
        <FinanceMetricCard label="Net profit" value={formatCurrency(snapshot.profit)} tone="cyan" icon={<TrendingUp className="h-5 w-5" />} />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Line label="Gross profit" value={formatCurrency(grossProfit)} />
          <Line label="Operating profit" value={formatCurrency(operatingProfit)} />
          <Line label="Other income" value={formatCurrency(snapshot.otherIncome)} />
          <Line label="Other adjustments" value={formatCurrency(0)} />
        </div>
      </div>
    </AccountingShell>
  );
}

function Line({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

export default ProfitAndLoss;
