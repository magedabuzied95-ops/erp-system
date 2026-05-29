import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Building2, Calculator, ShieldCheck } from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { buildFinancialSnapshot, formatCurrency, getAccountingSources } from "../lib/financeStore";

function Taxes() {
  const { t } = useTranslation();
  const snapshot = useMemo(() => buildFinancialSnapshot(getAccountingSources(), "all"), []);

  return (
    <AccountingShell
      title={t("accounting.compliance.title")}
      subtitle={t("accounting.compliance.subtitle")}
      actions={
        <Link to="/accounting/reports" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
          <ShieldCheck className="h-4 w-4" />
          {t("accounting.compliance.actions.reports")}
        </Link>
      }
      tabs={[
        { to: "/accounting", label: t("accounting.tabs.dashboard") },
        { to: "/accounting/taxes", label: t("accounting.tabs.compliance"), end: true },
        { to: "/accounting/reports", label: t("accounting.tabs.reports") },
        { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={t("accounting.compliance.metrics.revenueBase")} value={formatCurrency(snapshot.revenue)} tone="emerald" icon={<Calculator className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.compliance.metrics.expenseBase")} value={formatCurrency(snapshot.expensesTotal)} tone="rose" icon={<Building2 className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.compliance.metrics.status")} value={t("accounting.compliance.status.placeholder")} tone="cyan" icon={<ShieldCheck className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={t("accounting.compliance.cards.settingsTitle")} text={t("accounting.compliance.cards.settingsText")} />
        <Card title={t("accounting.compliance.cards.notesTitle")} text={t("accounting.compliance.cards.notesText")} />
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
