import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AlertTriangle, Paperclip, Plus, ReceiptText, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import {
  buildCategoryBreakdown,
  formatCurrency,
  formatDateTime,
  generateCode,
  getExpenses,
  saveExpenses,
} from "../lib/financeStore";

function Expenses() {
  const { t } = useTranslation();
  const CATEGORIES = [
    { value: "Rent", label: t("expenses.options.rent") },
    { value: "Payroll", label: t("expenses.options.payroll") },
    { value: "Logistics", label: t("expenses.options.logistics") },
    { value: "Marketing", label: t("expenses.options.marketing") },
    { value: "Software", label: t("expenses.options.software") },
    { value: "Office", label: t("expenses.options.office") },
    { value: "Utilities", label: t("expenses.options.utilities") },
    { value: "General", label: t("expenses.options.general") },
  ];
  const METHODS = [
    { value: "Cash", label: t("expenses.options.cash") },
    { value: "Card", label: t("expenses.options.card") },
    { value: "Bank transfer", label: t("expenses.options.bankTransfer") },
    { value: "Wallet", label: t("expenses.options.wallet") },
  ];
  const STATUSES = [
    { value: "Pending", label: t("expenses.options.pending") },
    { value: "Approved", label: t("expenses.options.approved") },
    { value: "Rejected", label: t("expenses.options.rejected") },
  ];
  const [expenses, setExpenses] = useState(getExpenses());
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [method, setMethod] = useState(METHODS[0]);
  const [status, setStatus] = useState(STATUSES[0]);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [attachment, setAttachment] = useState("");
  const [saving, setSaving] = useState(false);

  const analytics = useMemo(() => {
    const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const pending = expenses.filter((expense) => expense.status === "Pending").length;
    const approved = expenses.filter((expense) => expense.status === "Approved").length;
    const breakdown = buildCategoryBreakdown(expenses);
    return { total, pending, approved, breakdown };
  }, [expenses]);

  const submitExpense = async () => {
    if (!title.trim() || !Number(amount)) {
      toast.error(t("expenses.toasts.required"));
      return;
    }

    setSaving(true);
    const record = {
      id: generateCode("EXP"),
      title,
      category,
      method,
      status,
      amount: Number(amount),
      note,
      attachment,
      created_at: new Date().toISOString(),
    };

    const next = [record, ...expenses];

    try {
      await api.post("/expenses", record);
      saveExpenses(next);
      setExpenses(next);
      toast.success(t("expenses.toasts.saved"));
    } catch (err) {
      console.log(err);
      saveExpenses(next);
      setExpenses(next);
      toast.error(t("expenses.toasts.fallback"));
    } finally {
      setSaving(false);
      setTitle("");
      setAmount(0);
      setNote("");
      setAttachment("");
      setStatus("Pending");
    }
  };

  return (
    <AccountingShell
      title={t("expenses.title")}
      subtitle={t("expenses.subtitle")}
      actions={
        <Link to="/accounting/reports" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
          <ReceiptText className="h-4 w-4" />
          {t("expenses.reports")}
        </Link>
      }
      tabs={[
        { to: "/accounting", label: t("expenses.tabs.dashboard") },
        { to: "/accounting/cashbox", label: t("expenses.tabs.cashbox") },
        { to: "/accounting/expenses", label: t("expenses.tabs.expenses"), end: true },
        { to: "/accounting/income", label: t("expenses.tabs.income") },
        { to: "/accounting/ledgers", label: t("expenses.tabs.ledgers") },
        { to: "/accounting/reports", label: t("expenses.tabs.reports") },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={t("expenses.kpis.total")} value={formatCurrency(analytics.total)} tone="rose" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label={t("expenses.kpis.pending")} value={analytics.pending} tone="amber" icon={<AlertTriangle className="h-5 w-5" />} />
        <FinanceMetricCard label={t("expenses.kpis.approved")} value={analytics.approved} tone="emerald" icon={<ShieldCheck className="h-5 w-5" />} />
        <FinanceMetricCard label={t("expenses.kpis.categories")} value={analytics.breakdown.length} tone="cyan" icon={<Plus className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="text-xl font-black text-white">{t("expenses.createExpense")}</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label={t("expenses.fields.title")} value={title} onChange={setTitle} placeholder={t("expenses.placeholders.title")} />
            <Field label={t("expenses.fields.amount")} type="number" value={amount} onChange={setAmount} />
          <Select label={t("expenses.fields.category")} value={category} onChange={setCategory} options={CATEGORIES} />
            <Select label={t("expenses.fields.method")} value={method} onChange={setMethod} options={METHODS} />
            <Select label={t("expenses.fields.status")} value={status} onChange={setStatus} options={STATUSES} />
            <Field label={t("expenses.fields.attachment")} value={attachment} onChange={setAttachment} placeholder={t("expenses.placeholders.attachment")} />
          </div>
          <label className="mt-4 block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("expenses.fields.notes")}</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500" placeholder={t("expenses.placeholders.notes")} />
          </label>
          <button type="button" disabled={saving} onClick={submitExpense} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-rose-500 px-4 py-3 text-sm font-black text-black disabled:opacity-40">
            <Plus className="h-4 w-4" />
            {saving ? t("expenses.buttons.saving") : t("expenses.buttons.create")}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">{t("expenses.analytics.title")}</h3>
            <div className="mt-4 space-y-3">
              {analytics.breakdown.length === 0 ? (
                <Empty label={t("expenses.analytics.empty")} />
              ) : (
                analytics.breakdown.slice(0, 6).map((item) => <Row key={item.label} label={item.label} value={formatCurrency(item.value)} />)
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">{t("expenses.history.title")}</h3>
            <div className="mt-4 space-y-3">
              {expenses.length === 0 ? (
                <Empty label={t("expenses.history.empty")} />
              ) : (
                expenses.map((expense) => (
                  <div key={expense.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{expense.title}</div>
                        <div className="mt-1 text-xs text-zinc-500">{expense.category} - {expense.method}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-white">{formatCurrency(expense.amount)}</div>
                        <div className="text-xs text-zinc-500">{expense.status}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">{expense.note || t("expenses.history.noNotes")}</div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      <span>{formatDateTime(expense.created_at)}</span>
                      <span className="inline-flex items-center gap-2">
                        <Paperclip className="h-3.5 w-3.5" />
                        {expense.attachment || t("expenses.history.attachment")}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AccountingShell>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(type === "number" ? Number(e.target.value || 0) : e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-zinc-950 text-white">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="text-sm font-black text-white">{value}</div>
    </div>
  );
}

function Empty({ label }) {
  return <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{label}</div>;
}

export default Expenses;
