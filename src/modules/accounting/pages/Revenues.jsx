import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { BadgeDollarSign, CirclePlus, ReceiptText } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import {
  buildCategoryBreakdown,
  formatCurrency,
  formatDateTime,
  generateCode,
  getIncomeEntries,
  saveIncomeEntries,
} from "../lib/financeStore";

const CATEGORIES = ["Service income", "Delivery income", "Interest", "Other income"];
const METHODS = ["Cash", "Card", "Bank transfer", "Wallet"];

function Revenues() {
  const { t } = useTranslation();
  const [incomeEntries, setIncomeEntries] = useState(getIncomeEntries());
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [method, setMethod] = useState(METHODS[0]);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const categoryOptions = CATEGORIES.map((value) => ({ value, label: t(`accounting.revenues.categories.${value}`) }));
  const methodOptions = METHODS.map((value) => ({ value, label: t(`accounting.revenues.methods.${value}`) }));

  const analytics = useMemo(() => {
    const total = incomeEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const breakdown = buildCategoryBreakdown(incomeEntries);
    return { total, breakdown };
  }, [incomeEntries]);

  const submitIncome = async () => {
    if (!title.trim() || !Number(amount)) {
      toast.error(t("accounting.revenues.toasts.required"));
      return;
    }

    const record = {
      id: generateCode("INC"),
      title,
      category,
      method,
      amount: Number(amount),
      note,
      created_at: new Date().toISOString(),
    };

    const next = [record, ...incomeEntries];

    try {
      await api.post("/income", record);
      saveIncomeEntries(next);
      setIncomeEntries(next);
      toast.success(t("accounting.revenues.toasts.saved"));
    } catch (err) {
      console.log(err);
      saveIncomeEntries(next);
      setIncomeEntries(next);
      toast.error(t("accounting.revenues.toasts.fallback"));
    } finally {
      setTitle("");
      setAmount(0);
      setNote("");
    }
  };

  return (
    <AccountingShell
      title={t("accounting.revenues.title")}
      subtitle={t("accounting.revenues.subtitle")}
      actions={
        <Link to="/accounting/reports" className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
          <ReceiptText className="h-4 w-4" />
          {t("accounting.tabs.reports")}
        </Link>
      }
      tabs={[
        { to: "/accounting", label: t("accounting.tabs.dashboard") },
        { to: "/accounting/cashbox", label: t("accounting.tabs.cashDrawer") },
        { to: "/accounting/expenses", label: t("accounting.tabs.expenses") },
        { to: "/accounting/income", label: t("accounting.tabs.income"), end: true },
        { to: "/accounting/ledgers", label: t("accounting.tabs.ledgers") },
        { to: "/accounting/reports", label: t("accounting.tabs.reports") },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={t("accounting.revenues.metrics.incomeTotal")} value={formatCurrency(analytics.total)} tone="emerald" icon={<BadgeDollarSign className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.revenues.metrics.entries")} value={incomeEntries.length} tone="cyan" icon={<CirclePlus className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.revenues.metrics.categories")} value={analytics.breakdown.length} tone="amber" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.revenues.metrics.otherIncome")} value={incomeEntries.filter((entry) => entry.category === "Other income").length} tone="violet" icon={<BadgeDollarSign className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="m1-section-title text-white">{t("accounting.revenues.createTitle")}</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label={t("accounting.common.labels.title")} value={title} onChange={setTitle} placeholder={t("accounting.revenues.placeholders.title")} />
            <Field label={t("accounting.common.labels.amount")} type="number" value={amount} onChange={setAmount} />
            <Select label={t("accounting.common.labels.category")} value={category} onChange={setCategory} options={categoryOptions} />
            <Select label={t("accounting.revenues.labels.paymentMethod")} value={method} onChange={setMethod} options={methodOptions} />
          </div>
          <label className="mt-4 block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("accounting.common.labels.notes")}</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500" placeholder={t("accounting.revenues.placeholders.notes")} />
          </label>
          <button type="button" onClick={submitIncome} className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-emerald-500 px-4 py-3 text-sm font-black text-black">
            <CirclePlus className="h-4 w-4" />
            {t("accounting.revenues.createTitle")}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("accounting.revenues.categoriesTitle")}</h3>
            <div className="mt-4 space-y-3">
              {analytics.breakdown.length === 0 ? <Empty label={t("accounting.revenues.empty.noAnalytics")} /> : analytics.breakdown.map((item) => <Row key={item.label} label={item.label} value={formatCurrency(item.value)} />)}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("accounting.revenues.historyTitle")}</h3>
            <div className="mt-4 space-y-3">
              {incomeEntries.length === 0 ? (
                <Empty label={t("accounting.revenues.empty.noEntries")} />
              ) : (
                incomeEntries.map((entry) => (
                  <div key={entry.id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{entry.title}</div>
                        <div className="mt-1 text-xs text-zinc-500">{entry.category} - {entry.method}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-white">{formatCurrency(entry.amount)}</div>
                        <div className="text-xs text-zinc-500">{formatDateTime(entry.created_at)}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">{entry.note || t("accounting.common.labels.noNotes")}</div>
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
      <input type={type} value={value} onChange={(e) => onChange(type === "number" ? Number(e.target.value || 0) : e.target.value)} placeholder={placeholder} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
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
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="text-sm font-black text-white">{value}</div>
    </div>
  );
}

function Empty({ label }) {
  return <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{label}</div>;
}

export default Revenues;
