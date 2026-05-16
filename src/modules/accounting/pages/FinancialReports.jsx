import { useMemo } from "react";
import { Link } from "react-router-dom";

import { BarChart3, ReceiptText, TrendingUp } from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import {
  buildFinancialSnapshot,
  formatCurrency,
  getAccountingSources,
} from "../lib/financeStore";

function FinancialReports() {
  const snapshot = useMemo(() => buildFinancialSnapshot(getAccountingSources(), "all"), []);

  return (
    <AccountingShell
      title="Financial Reports"
      subtitle="Profit and loss, revenue report, expense report, top customers, top products, and inventory valuation placeholders."
      actions={
        <Link to="/accounting/profit-loss" className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black">
          <TrendingUp className="h-4 w-4" />
          Profit & loss
        </Link>
      }
      tabs={[
        { to: "/accounting", label: "Dashboard" },
        { to: "/accounting/reports", label: "Reports", end: true },
        { to: "/accounting/profit-loss", label: "P&L" },
        { to: "/accounting/ledgers", label: "Ledgers" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label="Revenue report" value={formatCurrency(snapshot.revenue)} tone="emerald" icon={<BarChart3 className="h-5 w-5" />} />
        <FinanceMetricCard label="Expense report" value={formatCurrency(snapshot.expensesTotal)} tone="rose" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label="Profit" value={formatCurrency(snapshot.profit)} tone="cyan" icon={<TrendingUp className="h-5 w-5" />} />
        <FinanceMetricCard label="Inventory valuation" value={formatCurrency(snapshot.inventoryValuation)} tone="amber" icon={<BarChart3 className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReportCard title="Top customers" rows={snapshot.topCustomers.map((item) => ({ label: item.name, value: formatCurrency(item.total), hint: `${item.count} orders` }))} />
        <ReportCard title="Top products" rows={snapshot.topProducts.map((item) => ({ label: item.name, value: formatCurrency(item.revenue), hint: `${item.qty} units` }))} />
      </div>
    </AccountingShell>
  );
}

function ReportCard({ title, rows }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <h3 className="text-xl font-black text-white">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">No report rows.</div>
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
