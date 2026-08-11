import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Banknote, RefreshCw, Repeat2, SlidersHorizontal, Wallet } from "lucide-react";
import toast from "react-hot-toast";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";

const tabs = [
  { to: "/accounting", label: "لوحة التحكم" },
  { to: "/accounting/treasury", label: "الخزينة", end: true },
  { to: "/accounting/financial-accounts", label: "الحسابات المالية" },
  { to: "/accounting/payment-method-mappings", label: "ربط طرق الدفع" },
  { to: "/accounting/reports", label: "التقارير" },
  { to: "/accounting/audit-trail", label: "سجل التدقيق" },
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

const translateMoneyType = (type) => {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "cash_drawer") return "درج النقدية";
  if (normalized === "safe") return "خزنة";
  if (normalized === "bank") return "بنك";
  if (normalized === "wallet") return "محفظة";
  if (normalized === "digital_wallet") return "محفظة رقمية";
  if (normalized === "card_settlement") return "تسويات البطاقات";
  if (normalized === "transfer") return "تحويل";
  if (normalized === "adjustment") return "تسوية";
  if (normalized === "manual") return "يدوي";
  if (normalized === "cash_in") return "داخل";
  if (normalized === "cash_out") return "خارج";
  return "غير معروف";
};

const balanceTone = (balance = 0) => {
  const value = Number(balance || 0);
  if (value < 0) return { label: "سالب", classes: "border-rose-300/25 bg-rose-400/10 text-rose-100", valueClass: "text-rose-200" };
  if (value < 1000) return { label: "منخفض", classes: "border-amber-300/25 bg-amber-400/10 text-amber-100", valueClass: "text-amber-200" };
  return { label: "سليم", classes: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100", valueClass: "text-emerald-200" };
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
      toast.error(error?.message || "تعذر تحميل بيانات الخزينة");
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
      toast.error("اختر حساب المصدر وحساب الوجهة ومبلغًا أكبر من صفر");
      return;
    }
    try {
      setSaving(true);
      await accountingApi.transferMoneyAccounts(transfer);
      setTransfer({ from_account_id: "", to_account_id: "", amount: "", notes: "" });
      toast.success("تم تسجيل التحويل");
      await loadTreasury(filters);
    } catch (error) {
      toast.error(error?.message || "تعذر تسجيل التحويل");
    } finally {
      setSaving(false);
    }
  };

  const submitAdjustment = async (event) => {
    event.preventDefault();
    if (!adjustment.account_id || Number(adjustment.amount) <= 0) {
      toast.error("اختر حسابًا ومبلغًا أكبر من صفر");
      return;
    }
    try {
      setSaving(true);
      await accountingApi.createManualMoneyAdjustment(adjustment);
      setAdjustment({ account_id: "", direction: "in", amount: "", notes: "" });
      toast.success("تم تسجيل التسوية");
      await loadTreasury(filters);
    } catch (error) {
      toast.error(error?.message || "تعذر تسجيل التسوية");
    } finally {
      setSaving(false);
    }
  };

  const quickRecharge = (account) => {
    setAdjustment({ account_id: account.id, direction: "in", amount: "", notes: `تعزيز ${account.name}` });
  };

  const quickOpeningBalance = (account) => {
    setAdjustment({ account_id: account.id, direction: "in", amount: "", notes: `تسوية رصيد افتتاحي لـ ${account.name}` });
  };

  const quickTransferInto = (account) => {
    setTransfer((current) => ({ ...current, to_account_id: account.id, amount: "", notes: `تحويل إلى ${account.name}` }));
  };

  return (
    <AccountingShell
      title="الخزينة"
      subtitle="الأرصدة الفعلية للنقدية والبنوك والبطاقات والمحافظ وتسويات البطاقات، معززة بحركات مالية مرتبطة."
      actions={
        <button type="button" onClick={() => loadTreasury(filters)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          تحديث
        </button>
      }
      tabs={tabs}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        <FinanceMetricCard label="إجمالي النقدية" value={formatCurrency(totals.cash || 0)} tone="emerald" icon={<Banknote className="h-5 w-5" />} />
        <FinanceMetricCard label="إجمالي البنوك" value={formatCurrency(totals.bank || 0)} tone="cyan" icon={<Wallet className="h-5 w-5" />} />
        <FinanceMetricCard label="إجمالي المحافظ" value={formatCurrency(totals.wallets || 0)} tone="violet" icon={<Wallet className="h-5 w-5" />} />
        <FinanceMetricCard label="تسويات البطاقات" value={formatCurrency(totals.card_settlements || 0)} tone="amber" icon={<Banknote className="h-5 w-5" />} />
        <FinanceMetricCard label="الداخل اليوم" value={formatCurrency(totals.today_money_in || 0)} tone="emerald" icon={<ArrowDownLeft className="h-5 w-5" />} />
        <FinanceMetricCard label="الخارج اليوم" value={formatCurrency(totals.today_money_out || 0)} tone="rose" icon={<ArrowUpRight className="h-5 w-5" />} />
        <FinanceMetricCard label="صافي الحركة" value={formatCurrency(totals.net_movement || 0)} tone={(totals.net_movement || 0) >= 0 ? "emerald" : "rose"} icon={<Repeat2 className="h-5 w-5" />} />
      </div>

      {reconciliation ? (
        <div className={`rounded-3xl border px-5 py-4 text-sm shadow-2xl shadow-black/20 ${reconciliation.balanced ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50" : "border-rose-300/30 bg-rose-300/10 text-rose-50"}`}>
          <div className="font-black">{reconciliation.balanced ? "مطابقة حسابات النقدية متوازنة" : `تم العثور على ${reconciliation.out_of_balance_count} مشكلة في أرصدة حسابات النقدية`}</div>
          {!reconciliation.balanced ? (
            <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {reconciliation.accounts.filter((account) => !account.balanced).map((account) => (
                <div key={account.id} className="rounded-2xl border border-white/10 bg-black/15 p-3">
                  <div className="font-bold text-white">{account.name}</div>
                  <div className="mt-1 text-xs opacity-80">المسجل {formatCurrency(account.current_balance)} · المحسوب {formatCurrency(account.calculated_balance)} · الفرق {formatCurrency(account.difference)}</div>
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
              <h2 className="text-xl font-black text-white">أرصدة الحسابات</h2>
              <p className="mt-1 text-sm text-zinc-400">الحسابات النقدية والتشغيلية المستخدمة في نقاط البيع والمشتريات والمصروفات والاستردادات والرواتب.</p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-zinc-300">{accounts.length} حساب</span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {accounts.map((account) => {
              const tone = balanceTone(account.current_balance);
              return (
              <article key={account.id} className={`rounded-2xl border p-4 ${tone.classes}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-white">{account.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">{translateMoneyType(account.type)}{account.provider ? ` - ${account.provider}` : ""}</div>
                    <div className="mt-2 inline-flex rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-black">{tone.label}</div>
                  </div>
                  <div className={`text-right text-lg font-black ${tone.valueClass}`}>{formatCurrency(account.current_balance || 0)}</div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-1.5">
                  <button type="button" onClick={() => quickRecharge(account)} className="rounded-xl border border-current/15 bg-black/15 px-2 py-1.5 text-[10px] font-black transition hover:bg-black/25">تعزيز</button>
                  <button type="button" onClick={() => quickOpeningBalance(account)} className="rounded-xl border border-current/15 bg-black/15 px-2 py-1.5 text-[10px] font-black transition hover:bg-black/25">افتتاحي</button>
                  <button type="button" onClick={() => quickTransferInto(account)} className="rounded-xl border border-current/15 bg-black/15 px-2 py-1.5 text-[10px] font-black transition hover:bg-black/25">تحويل</button>
                </div>
              </article>
            );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <form onSubmit={submitTransfer} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <div className="flex items-center gap-2 text-lg font-black text-white"><Repeat2 className="h-5 w-5 text-emerald-200" /> تحويل نقدية</div>
            <div className="mt-4 grid gap-3">
              <Select value={transfer.from_account_id} onChange={(value) => setTransfer((current) => ({ ...current, from_account_id: value }))} accounts={accounts} placeholder="من حساب" />
              <Select value={transfer.to_account_id} onChange={(value) => setTransfer((current) => ({ ...current, to_account_id: value }))} accounts={accounts} placeholder="إلى حساب" />
              <input className={inputClass} type="number" min="0" step="0.01" value={transfer.amount} onChange={(event) => setTransfer((current) => ({ ...current, amount: event.target.value }))} placeholder="المبلغ" />
              <input className={inputClass} value={transfer.notes} onChange={(event) => setTransfer((current) => ({ ...current, notes: event.target.value }))} placeholder="ملاحظات" />
              <button type="submit" disabled={saving} className="rounded-2xl bg-emerald-300 px-4 py-2 text-sm font-black text-emerald-950 transition hover:bg-emerald-200 active:scale-[0.99] disabled:opacity-60">تسجيل التحويل</button>
            </div>
          </form>

          <form onSubmit={submitAdjustment} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <div className="flex items-center gap-2 text-lg font-black text-white"><SlidersHorizontal className="h-5 w-5 text-violet-200" /> تسوية يدوية</div>
            <div className="mt-4 grid gap-3">
              <Select value={adjustment.account_id} onChange={(value) => setAdjustment((current) => ({ ...current, account_id: value }))} accounts={accounts} placeholder="الحساب" />
              <select className={inputClass} value={adjustment.direction} onChange={(event) => setAdjustment((current) => ({ ...current, direction: event.target.value }))}>
                <option value="in">داخل</option>
                <option value="out">خارج</option>
              </select>
              <input className={inputClass} type="number" min="0" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} placeholder="المبلغ" />
              <input className={inputClass} value={adjustment.notes} onChange={(event) => setAdjustment((current) => ({ ...current, notes: event.target.value }))} placeholder="ملاحظة تدقيقية" />
              <button type="submit" disabled={saving} className="rounded-2xl border border-violet-200/30 bg-violet-300/10 px-4 py-2 text-sm font-black text-violet-100 transition hover:bg-violet-300/20 active:scale-[0.99] disabled:opacity-60">تسجيل التسوية</button>
            </div>
          </form>
        </aside>
      </div>

      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-black text-white">حركات النقدية</h2>
            <p className="mt-1 text-sm text-zinc-400">حركات حسابات غير قابلة للتعديل من المبيعات والمشتريات والمصروفات والسلف والاستردادات والتحويلات والتسويات.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <Select compact value={filters.account_id} onChange={(value) => updateFilter("account_id", value)} accounts={accounts} placeholder="كل الحسابات" />
            <input className={inputClass} value={filters.transaction_type} onChange={(event) => updateFilter("transaction_type", event.target.value)} list="money-transaction-types" placeholder="النوع" />
            <input className={inputClass} value={filters.reference_type} onChange={(event) => updateFilter("reference_type", event.target.value)} placeholder="المرجع" />
            <input className={inputClass} value={filters.branch_id} onChange={(event) => updateFilter("branch_id", event.target.value)} placeholder="الفرع" />
            <input className={inputClass} type="date" value={filters.from_date} onChange={(event) => updateFilter("from_date", event.target.value)} />
            <button type="button" onClick={() => loadTreasury(filters)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10">تصفية</button>
          </div>
          <datalist id="money-transaction-types">
            {transactionTypes.map((type) => <option key={type} value={type} />)}
          </datalist>
        </div>

        <div className="m1-table-container mt-5 overflow-x-auto">
          <table className="m1-table m1-table--compact min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-4 py-3">التاريخ</th>
                <th className="px-4 py-3">الحساب</th>
                <th className="px-4 py-3">النوع</th>
                <th className="px-4 py-3">المرجع</th>
                <th className="px-4 py-3 text-right">داخل</th>
                <th className="px-4 py-3 text-right">خارج</th>
                <th className="px-4 py-3 text-right">الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className="text-zinc-200">
                  <td className="px-4 py-3 text-zinc-400">{tx.created_at ? new Date(tx.created_at).toLocaleString() : "-"}</td>
                  <td className="px-4 py-3 font-semibold text-white">{tx.account_name}</td>
                  <td className="px-4 py-3">{translateMoneyType(tx.transaction_type)}</td>
                  <td className="px-4 py-3 text-zinc-400">{translateMoneyType(tx.reference_type || "manual")} {tx.reference_id ? `#${tx.reference_id}` : ""}</td>
                  <td className="px-4 py-3 text-right font-black text-emerald-200">{tx.direction === "in" ? formatCurrency(tx.amount) : "-"}</td>
                  <td className="px-4 py-3 text-right font-black text-rose-200">{tx.direction === "out" ? formatCurrency(tx.amount) : "-"}</td>
                  <td className="px-4 py-3 text-right font-black text-white">{formatCurrency(tx.balance_after || 0)}</td>
                </tr>
              ))}
              {!transactions.length ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-500">{loading ? "جارٍ تحميل حركات النقدية..." : "لا توجد حركات نقدية."}</td></tr>
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
