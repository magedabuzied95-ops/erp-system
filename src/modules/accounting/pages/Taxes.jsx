import { useMemo } from "react";
import { Link } from "react-router-dom";

import { Building2, Calculator, ShieldCheck } from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { buildFinancialSnapshot, formatCurrency, getAccountingSources } from "../lib/financeStore";

function Taxes() {
  const snapshot = useMemo(() => buildFinancialSnapshot(getAccountingSources(), "all"), []);

  return (
    <AccountingShell
      title="Compliance"
      subtitle="Finance overview placeholder with enterprise reporting hooks and future compliance integration."
      actions={
        <Link to="/accounting/reports" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
          <ShieldCheck className="h-4 w-4" />
          Compliance reports
        </Link>
      }
      tabs={[
        { to: "/accounting", label: "Dashboard" },
        { to: "/accounting/taxes", label: "Compliance", end: true },
        { to: "/accounting/reports", label: "Reports" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label="Revenue base" value={formatCurrency(snapshot.revenue)} tone="emerald" icon={<Calculator className="h-5 w-5" />} />
        <FinanceMetricCard label="Expense base" value={formatCurrency(snapshot.expensesTotal)} tone="rose" icon={<Building2 className="h-5 w-5" />} />
        <FinanceMetricCard label="Compliance status" value="Placeholder" tone="cyan" icon={<ShieldCheck className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Compliance settings" text="Configure reporting, withholding, and jurisdiction-specific rules once the backend compliance service is available." />
        <Card title="Compliance notes" text="This screen is intentionally read-only until live compliance endpoints are added." />
      </div>
    </AccountingShell>
  );
}

function Card({ title, text }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <h3 className="text-xl font-black text-white">{title}</h3>
      <p className="mt-2 text-sm text-zinc-400">{text}</p>
    </div>
  );
}

export default Taxes;
