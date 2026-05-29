import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Banknote, RefreshCw, Repeat2, SlidersHorizontal, Wallet } from "lucide-react";
import toast from "react-hot-toast";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";

const tabs = [
  { to: "/accounting", label: "Dashboard" },
  { to: "/accounting/treasury", label: "Treasury", end: true },
  { to: "/accounting/financial-accounts", label: "Financial Accounts" },
  { to: "/accounting/payment-method-mappings", label: "Payment Mappings" },
  { to: "/accounting/reports", label: "Reports" },
  { to: "/accounting/audit-trail", label: "Audit Trail" },
];

const emptyFilters = {
  account_id: "",
  transaction_type: "",
  reference_type: "",
  branch_id: "",
  from_date: "",
  to_date: "",
};

const inputClass = "w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/70";

const accountLabel = (account) => `${account.name}${account.provider ? ` · ${account.provider}` : ""}`;

const balanceTone = (balance = 0) => {
  const value = Number(balance || 0);
  if (value < 0) return { label: "Negative", classes: "border-rose-300/25 bg-rose-400/10 text-rose-100", valueClass: "text-rose-200" };
  if (value < 1000) return { label: "Low", classes: "border-amber-300/25 bg-amber-400/10 text-amber-100", valueClass: "text-amber-200" };
  return { label: "Healthy", classes: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100", valueClass: "text-emerald-200" };
};

export default function Treasury() {
  const [dashboard, setDashboard] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [transfer, setTransfer] = useState({ from_account_id: "", to_account_id: "", amount: "", notes: "" });
  const [adjustment, setAdjustment] = useState({ account_id: "", direction: "in", amount: "", notes: "" });

  const accounts = dashboard?.accounts || [];
  const totals = dashboard?.totals || {};

  const transactionTypes = useMemo(() => {
    const values = new Set((dashboard?.transactions || []).map((row) => row.transaction_type).filter(Boolean));
    return Array.from(values).sort();
  }, [dashboard]);

  const loadTreasury = async (nextFilters = filters) => {
    try {
      setLoading(true);
      const [summaryResult, txResult, reconciliationResult] = await Promise.all([
        accountingApi.getTreasuryDashboard({ limit: 100 }),
        accountingApi.getMoneyTransactions({ ...nextFilters, limit: 200 }),
        accountingApi.getMoneyReconciliation(),
      ]);
      setDashboard(summaryResult?.dashboard || null);
      setTransactions(txResult?.transactions || []);
      setReconciliation(reconciliationResult?.reconciliation || null);
    } catch (error) {
      console.error(error);
      toast.error(error?.message || "Failed to load treasury data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTreasury(emptyFilters);
  }, []);

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  const submitTransfer = async (event) => {
    event.preventDefault();
    if (!transfer.from_account_id || !transfer.to_account_id || Number(transfer.amount) <= 0) {
      toast.error("Choose source, destination, and a positive amount");
      return;
    }
    try {
      setSaving(true);
      await accountingApi.transferMoneyAccounts(transfer);
      setTransfer({ from_account_id: "", to_account_id: "", amount: "", notes: "" });
      toast.success("Transfer recorded");
      await loadTreasury(filters);
    } catch (error) {
      toast.error(error?.message || "Failed to record transfer");
    } finally {
      setSaving(false);
    }
  };

  const submitAdjustment = async (event) => {
    event.preventDefault();
    if (!adjustment.account_id || Number(adjustment.amount) <= 0) {
      toast.error("Choose an account and a positive amount");
      return;
    }
    try {
      setSaving(true);
      await accountingApi.createManualMoneyAdjustment(adjustment);
      setAdjustment({ account_id: "", direction: "in", amount: "", notes: "" });
      toast.success("Adjustment recorded");
      await loadTreasury(filters);
    } catch (error) {
      toast.error(error?.message || "Failed to record adjustment");
    } finally {
      setSaving(false);
    }
  };

  const quickRecharge = (account) => {
    setAdjustment({ account_id: account.id, direction: "in", amount: "", notes: `Recharge ${account.name}` });
  };

  const quickOpeningBalance = (account) => {
    setAdjustment({ account_id: account.id, direction: "in", amount: "", notes: `Opening balance correction for ${account.name}` });
  };

  const quickTransferInto = (account) => {
    setTransfer((current) => ({ ...current, to_account_id: account.id, amount: "", notes: `Transfer into ${account.name}` }));
  };

  return (
    <AccountingShell
      title="Treasury"
      subtitle="Real cash, bank, card, wallet, and settlement balances backed by linked money transactions."
      actions={
        <button type="button" onClick={() => loadTreasury(filters)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      }
      tabs={tabs}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        <FinanceMetricCard label="Total Cash" value={formatCurrency(totals.cash || 0)} tone="emerald" icon={<Banknote className="h-5 w-5" />} />
        <FinanceMetricCard label="Total Bank" value={formatCurrency(totals.bank || 0)} tone="cyan" icon={<Wallet className="h-5 w-5" />} />
        <FinanceMetricCard label="Wallets" value={formatCurrency(totals.wallets || 0)} tone="violet" icon={<Wallet className="h-5 w-5" />} />
        <FinanceMetricCard label="Card Settlements" value={formatCurrency(totals.card_settlements || 0)} tone="amber" icon={<Banknote className="h-5 w-5" />} />
        <FinanceMetricCard label="Today In" value={formatCurrency(totals.today_money_in || 0)} tone="emerald" icon={<ArrowDownLeft className="h-5 w-5" />} />
        <FinanceMetricCard label="Today Out" value={formatCurrency(totals.today_money_out || 0)} tone="rose" icon={<ArrowUpRight className="h-5 w-5" />} />
        <FinanceMetricCard label="Net Movement" value={formatCurrency(totals.net_movement || 0)} tone={(totals.net_movement || 0) >= 0 ? "emerald" : "rose"} icon={<Repeat2 className="h-5 w-5" />} />
      </div>

      {reconciliation ? (
        <div className={`rounded-3xl border px-5 py-4 text-sm shadow-2xl shadow-black/20 ${reconciliation.balanced ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50" : "border-rose-300/30 bg-rose-300/10 text-rose-50"}`}>
          <div className="font-black">{reconciliation.balanced ? "Money account reconciliation is balanced" : `${reconciliation.out_of_balance_count} money account balance issue(s) found`}</div>
          {!reconciliation.balanced ? (
            <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {reconciliation.accounts.filter((account) => !account.balanced).map((account) => (
                <div key={account.id} className="rounded-2xl border border-white/10 bg-black/15 p-3">
                  <div className="font-bold text-white">{account.name}</div>
                  <div className="mt-1 text-xs opacity-80">Stored {formatCurrency(account.current_balance)} · Calculated {formatCurrency(account.calculated_balance)} · Diff {formatCurrency(account.difference)}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-white">Account Balances</h2>
              <p className="mt-1 text-sm text-zinc-400">Operational money accounts used by POS, purchases, expenses, refunds, and payroll.</p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-zinc-300">{accounts.length} accounts</span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {accounts.map((account) => {
              const tone = balanceTone(account.current_balance);
              return (
              <article key={account.id} className={`rounded-2xl border p-4 ${tone.classes}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-white">{account.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">{account.type.replaceAll("_", " ")}{account.provider ? ` - ${account.provider}` : ""}</div>
                    <div className="mt-2 inline-flex rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-black">{tone.label}</div>
                  </div>
                  <div className={`text-right text-lg font-black ${tone.valueClass}`}>{formatCurrency(account.current_balance || 0)}</div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-1.5">
                  <button type="button" onClick={() => quickRecharge(account)} className="rounded-xl border border-current/15 bg-black/15 px-2 py-1.5 text-[10px] font-black transition hover:bg-black/25">Recharge</button>
                  <button type="button" onClick={() => quickOpeningBalance(account)} className="rounded-xl border border-current/15 bg-black/15 px-2 py-1.5 text-[10px] font-black transition hover:bg-black/25">Opening</button>
                  <button type="button" onClick={() => quickTransferInto(account)} className="rounded-xl border border-current/15 bg-black/15 px-2 py-1.5 text-[10px] font-black transition hover:bg-black/25">Transfer in</button>
                </div>
              </article>
            );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <form onSubmit={submitTransfer} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <div className="flex items-center gap-2 text-lg font-black text-white"><Repeat2 className="h-5 w-5 text-emerald-200" /> Transfer Money</div>
            <div className="mt-4 grid gap-3">
              <Select value={transfer.from_account_id} onChange={(value) => setTransfer((current) => ({ ...current, from_account_id: value }))} accounts={accounts} placeholder="From account" />
              <Select value={transfer.to_account_id} onChange={(value) => setTransfer((current) => ({ ...current, to_account_id: value }))} accounts={accounts} placeholder="To account" />
              <input className={inputClass} type="number" min="0" step="0.01" value={transfer.amount} onChange={(event) => setTransfer((current) => ({ ...current, amount: event.target.value }))} placeholder="Amount" />
              <input className={inputClass} value={transfer.notes} onChange={(event) => setTransfer((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" />
              <button type="submit" disabled={saving} className="rounded-2xl bg-emerald-300 px-4 py-2 text-sm font-black text-emerald-950 transition hover:bg-emerald-200 active:scale-[0.99] disabled:opacity-60">Record Transfer</button>
            </div>
          </form>

          <form onSubmit={submitAdjustment} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <div className="flex items-center gap-2 text-lg font-black text-white"><SlidersHorizontal className="h-5 w-5 text-violet-200" /> Manual Adjustment</div>
            <div className="mt-4 grid gap-3">
              <Select value={adjustment.account_id} onChange={(value) => setAdjustment((current) => ({ ...current, account_id: value }))} accounts={accounts} placeholder="Account" />
              <select className={inputClass} value={adjustment.direction} onChange={(event) => setAdjustment((current) => ({ ...current, direction: event.target.value }))}>
                <option value="in">Money in</option>
                <option value="out">Money out</option>
              </select>
              <input className={inputClass} type="number" min="0" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} placeholder="Amount" />
              <input className={inputClass} value={adjustment.notes} onChange={(event) => setAdjustment((current) => ({ ...current, notes: event.target.value }))} placeholder="Audit note" />
              <button type="submit" disabled={saving} className="rounded-2xl border border-violet-200/30 bg-violet-300/10 px-4 py-2 text-sm font-black text-violet-100 transition hover:bg-violet-300/20 active:scale-[0.99] disabled:opacity-60">Record Adjustment</button>
            </div>
          </form>
        </aside>
      </div>

      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-black text-white">Money Transactions</h2>
            <p className="mt-1 text-sm text-zinc-400">Immutable account movements from sales, purchases, expenses, advances, refunds, transfers, and adjustments.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <Select compact value={filters.account_id} onChange={(value) => updateFilter("account_id", value)} accounts={accounts} placeholder="All accounts" />
            <input className={inputClass} value={filters.transaction_type} onChange={(event) => updateFilter("transaction_type", event.target.value)} list="money-transaction-types" placeholder="Type" />
            <input className={inputClass} value={filters.reference_type} onChange={(event) => updateFilter("reference_type", event.target.value)} placeholder="Reference" />
            <input className={inputClass} value={filters.branch_id} onChange={(event) => updateFilter("branch_id", event.target.value)} placeholder="Branch" />
            <input className={inputClass} type="date" value={filters.from_date} onChange={(event) => updateFilter("from_date", event.target.value)} />
            <button type="button" onClick={() => loadTreasury(filters)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10">Filter</button>
          </div>
          <datalist id="money-transaction-types">
            {transactionTypes.map((type) => <option key={type} value={type} />)}
          </datalist>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3 text-right">In</th>
                <th className="px-4 py-3 text-right">Out</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {transactions.map((tx) => (
                <tr key={tx.id} className="text-zinc-200">
                  <td className="px-4 py-3 text-zinc-400">{tx.created_at ? new Date(tx.created_at).toLocaleString() : "-"}</td>
                  <td className="px-4 py-3 font-semibold text-white">{tx.account_name}</td>
                  <td className="px-4 py-3">{tx.transaction_type?.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3 text-zinc-400">{tx.reference_type || "manual"} {tx.reference_id ? `#${tx.reference_id}` : ""}</td>
                  <td className="px-4 py-3 text-right font-black text-emerald-200">{tx.direction === "in" ? formatCurrency(tx.amount) : "-"}</td>
                  <td className="px-4 py-3 text-right font-black text-rose-200">{tx.direction === "out" ? formatCurrency(tx.amount) : "-"}</td>
                  <td className="px-4 py-3 text-right font-black text-white">{formatCurrency(tx.balance_after || 0)}</td>
                </tr>
              ))}
              {!transactions.length ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-500">{loading ? "Loading treasury movements..." : "No money transactions found."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AccountingShell>
  );
}

function Select({ value, onChange, accounts, placeholder, compact = false }) {
  return (
    <select className={`${inputClass} ${compact ? "min-w-40" : ""}`} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>{accountLabel(account)}</option>
      ))}
    </select>
  );
}
