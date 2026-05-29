import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  ArrowUpRight,
  BarChart3,
  BookOpenText,
  CircleDollarSign,
  Layers3,
  RefreshCw,
  Wallet,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency } from "../lib/financeStore";

function Accounting() {
  const { t } = useTranslation();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      try {
        setLoading(true);
        const result = await api.get("/accounting/dashboard");
        if (!active) return;
        setDashboard(result?.dashboard || result?.summary || null);
      } catch (error) {
        if (!active) return;
        console.log(error);
        setDashboard(null);
        toast.error(t("accounting.toasts.loadFailed"));
      } finally {
        if (active) setLoading(false);
      }
    };

    loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  const summary = dashboard || {
    revenue: 0,
    expenses: 0,
    inventoryValue: 0,
    cogs: 0,
    grossProfit: 0,
    salesTotal: 0,
    purchasesTotal: 0,
    totalJournalEntries: 0,
  };

  return (
    <AccountingShell
      title={t("accounting.title")}
      subtitle={t("accounting.subtitle")}
      actions={
        <>
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {dashboard ? t("accounting.liveData") : t("accounting.awaitingData")}
          </div>
          <Link
            to="/accounting/journal-entries"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <BookOpenText className="h-4 w-4" />
            {t("accounting.journalEntries")}
          </Link>
        </>
      }
      tabs={[
        { to: "/accounting", label: t("accounting.tabs.dashboard"), end: true },
        { to: "/accounting/treasury", label: "Treasury" },
        { to: "/accounting/journal-entries", label: t("accounting.tabs.journal") },
        { to: "/accounting/accounts", label: t("accounting.tabs.accounts") },
        { to: "/accounting/financial-accounts", label: t("accounting.tabs.financialAccounts") },
        { to: "/accounting/payment-method-mappings", label: t("accounting.tabs.paymentMappings") },
        { to: "/accounting/reports", label: t("accounting.tabs.reports") },
        { to: "/accounting/profit-loss", label: t("accounting.tabs.profitLoss") },
        { to: "/accounting/taxes", label: t("accounting.tabs.taxes") },
        { to: "/accounting/cost-fix", label: t("accounting.tabs.costFix") },
        { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <FinanceMetricCard
          label={t("accounting.kpis.revenue")}
          value={formatCurrency(summary.revenue)}
          hint={t("accounting.hints.revenue")}
          tone="emerald"
          icon={<CircleDollarSign className="h-5 w-5" />}
        />
        <FinanceMetricCard
          label={t("accounting.kpis.expenses")}
          value={formatCurrency(summary.expenses)}
          hint={t("accounting.hints.expenses")}
          tone="rose"
          icon={<ArrowUpRight className="h-5 w-5" />}
        />
        <FinanceMetricCard
          label={t("accounting.kpis.inventoryValue")}
          value={formatCurrency(summary.inventoryValue)}
          hint={t("accounting.hints.inventoryValue")}
          tone="cyan"
          icon={<Layers3 className="h-5 w-5" />}
        />
        <FinanceMetricCard
          label={t("accounting.kpis.cogs")}
          value={formatCurrency(summary.cogs)}
          hint={t("accounting.hints.cogs")}
          tone="amber"
          icon={<Wallet className="h-5 w-5" />}
        />
        <FinanceMetricCard
          label={t("accounting.kpis.grossProfit")}
          value={formatCurrency(summary.grossProfit)}
          hint={t("accounting.hints.grossProfit")}
          tone="violet"
          icon={<BarChart3 className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-white">{t("accounting.snapshotTitle")}</h3>
              <p className="mt-1 text-sm text-zinc-400">
                {t("accounting.snapshotSubtitle")}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <InfoTile label={t("accounting.tiles.salesTotal")} value={formatCurrency(summary.salesTotal)} />
            <InfoTile label={t("accounting.tiles.purchasesTotal")} value={formatCurrency(summary.purchasesTotal)} />
            <InfoTile label={t("accounting.tiles.journalEntries")} value={String(summary.totalJournalEntries || 0)} />
            <InfoTile label={t("accounting.tiles.margin")} value={summary.revenue ? `${Math.round((Number(summary.grossProfit || 0) / Number(summary.revenue || 1)) * 100)}%` : "0%"} />
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <BookOpenText className="h-4 w-4 text-cyan-300" />
            {t("accounting.quickLinks")}
          </div>
          <div className="mt-4 space-y-3">
            <Link className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/10" to="/accounting/journal-entries">
              {t("accounting.links.journal")}
            </Link>
            <Link className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/10" to="/inventory/history">
              {t("accounting.links.inventory")}
            </Link>
            <Link className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/10" to="/products">
              {t("accounting.links.products")}
            </Link>
            <Link className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/10" to="/accounting/cost-fix">
              {t("accounting.links.costFix")}
            </Link>
            <Link className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/10" to="/accounting/financial-accounts">
              {t("accounting.links.financialAccounts")}
            </Link>
            <Link className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/10" to="/accounting/payment-method-mappings">
              {t("accounting.links.paymentMappings")}
            </Link>
            <Link className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/10" to="/accounting/audit-trail">
              {t("accounting.links.auditTrail")}
            </Link>
          </div>
        </div>
      </div>
    </AccountingShell>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

export default Accounting;
