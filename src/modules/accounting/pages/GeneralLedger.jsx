import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpenText, Filter, RefreshCw, Search } from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency, formatDateTime } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";

function GeneralLedger() {
  const [accounts, setAccounts] = useState([]);
  const [payload, setPayload] = useState({
    account: null,
    rows: [],
    totals: {
      opening_balance: 0,
      total_debit: 0,
      total_credit: 0,
      closing_balance: 0,
    },
  });
  const [filters, setFilters] = useState({
    account_id: "",
    from_date: "",
    to_date: "",
    branch_id: "",
  });
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadAccounts = async () => {
      try {
        setLoadingAccounts(true);
        const result = await accountingApi.getGeneralLedgerAccounts();
        if (!active) return;
        setAccounts(Array.isArray(result?.accounts) ? result.accounts : []);
      } catch (requestError) {
        if (!active) return;
        setAccounts([]);
        setError(requestError?.message || "تعذر تحميل الحسابات المتاحة.");
      } finally {
        if (active) setLoadingAccounts(false);
      }
    };
    loadAccounts();
    return () => {
      active = false;
    };
  }, []);

  const loadLedger = async (event) => {
    event?.preventDefault?.();
    if (!filters.account_id) {
      setError("اختر حسابًا أولاً لعرض دفتر الأستاذ.");
      setPayload({
        account: null,
        rows: [],
        totals: {
          opening_balance: 0,
          total_debit: 0,
          total_credit: 0,
          closing_balance: 0,
        },
      });
      return;
    }

    try {
      setLoading(true);
      setError("");
      const result = await accountingApi.getGeneralLedger(filters);
      setPayload({
        account: result?.account || null,
        rows: Array.isArray(result?.rows) ? result.rows : [],
        totals: {
          opening_balance: Number(result?.totals?.opening_balance || 0),
          total_debit: Number(result?.totals?.total_debit || 0),
          total_credit: Number(result?.totals?.total_credit || 0),
          closing_balance: Number(result?.totals?.closing_balance || 0),
        },
      });
    } catch (requestError) {
      setPayload({
        account: null,
        rows: [],
        totals: {
          opening_balance: 0,
          total_debit: 0,
          total_credit: 0,
          closing_balance: 0,
        },
      });
      setError(requestError?.message || "تعذر تحميل دفتر الأستاذ.");
    } finally {
      setLoading(false);
    }
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const headline = useMemo(() => {
    if (!payload.account) return "دفتر الأستاذ العام";
    return `${payload.account.account_code} - ${payload.account.account_name}`;
  }, [payload.account]);

  return (
    <AccountingShell
      title="دفتر الأستاذ"
      subtitle="دفتر الأستاذ العام مبني مباشرة على الحسابات والقيود اليومية وسطور القيود"
      actions={
        <>
          <button
            type="button"
            onClick={loadLedger}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </button>
          <Link
            to="/accounting"
            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400"
          >
            <BookOpenText className="h-4 w-4" />
            لوحة المحاسبة
          </Link>
        </>
      }
      tabs={[
        { to: "/accounting", label: "لوحة التحكم" },
        { to: "/accounting/journal-entries", label: "القيود اليومية" },
        { to: "/accounting/accounts", label: "دليل الحسابات" },
        { to: "/accounting/general-ledger", label: "دفتر الأستاذ", end: true },
        { to: "/accounting/trial-balance", label: "ميزان المراجعة" },
        { to: "/accounting/reports", label: "التقارير" },
      ]}
    >
      <form onSubmit={loadLedger} className="grid gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10 md:grid-cols-4">
        <Field label="الحساب">
          <select
            value={filters.account_id}
            onChange={(event) => updateFilter("account_id", event.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none"
            disabled={loadingAccounts}
          >
            <option value="">{loadingAccounts ? "جارٍ تحميل الحسابات..." : "اختر الحساب"}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.account_code} - {account.account_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="من تاريخ">
          <input type="date" value={filters.from_date} onChange={(event) => updateFilter("from_date", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
        </Field>
        <Field label="إلى تاريخ">
          <input type="date" value={filters.to_date} onChange={(event) => updateFilter("to_date", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
        </Field>
        <Field label="الفرع">
          <input type="number" min="1" value={filters.branch_id} onChange={(event) => updateFilter("branch_id", event.target.value)} placeholder="اختياري" className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500" />
        </Field>
        <div className="md:col-span-4">
          <button type="submit" className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400">
            <Search className="h-4 w-4" />
            عرض دفتر الأستاذ
          </button>
        </div>
      </form>

      {error ? <Banner text={error} tone="amber" /> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label="الرصيد الافتتاحي" value={formatCurrency(payload.totals.opening_balance)} tone="cyan" icon={<BookOpenText className="h-5 w-5" />} />
        <FinanceMetricCard label="إجمالي المدين" value={formatCurrency(payload.totals.total_debit)} tone="emerald" icon={<BookOpenText className="h-5 w-5" />} />
        <FinanceMetricCard label="إجمالي الدائن" value={formatCurrency(payload.totals.total_credit)} tone="rose" icon={<BookOpenText className="h-5 w-5" />} />
        <FinanceMetricCard label="الرصيد الختامي" value={formatCurrency(payload.totals.closing_balance)} tone="amber" icon={<BookOpenText className="h-5 w-5" />} />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Filter className="h-4 w-4 text-cyan-300" />
          {headline}
        </div>

        {loading ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-8 text-sm text-zinc-400">جارٍ تحميل الحركات...</div>
        ) : !filters.account_id ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">اختر حسابًا لعرض دفتر الأستاذ العام.</div>
        ) : payload.rows.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">لا توجد حركات ضمن الفلاتر الحالية.</div>
        ) : (
          <div className="m1-table-container mt-5 overflow-x-auto">
            <table className="m1-table m1-table--compact min-w-[1080px] w-full text-right text-sm" dir="rtl">
              <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <Th>التاريخ</Th>
                  <Th>القيد</Th>
                  <Th>المرجع</Th>
                  <Th>الوصف</Th>
                  <Th align="right">مدين</Th>
                  <Th align="right">دائن</Th>
                  <Th align="right">الرصيد الجاري</Th>
                </tr>
              </thead>
              <tbody>
                {payload.rows.map((row, index) => (
                  <tr key={`${row.journal_entry_id}-${index}`} className="transition hover:bg-white/[0.03]">
                    <Td>{formatDateTime(row.date)}</Td>
                    <Td className="font-semibold text-white">#{row.journal_entry_id}</Td>
                    <Td>{row.reference || translateSourceType(row.source_type) || "-"}</Td>
                    <Td className="max-w-[340px] text-zinc-300">{row.description || "-"}</Td>
                    <Td align="right" className="font-black text-emerald-300">{row.debit ? formatCurrency(row.debit) : "-"}</Td>
                    <Td align="right" className="font-black text-rose-300">{row.credit ? formatCurrency(row.credit) : "-"}</Td>
                    <Td align="right" className="font-black text-white">{formatCurrency(row.running_balance || 0)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AccountingShell>
  );
}

function Field({ label, children }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function Banner({ text, tone = "amber" }) {
  const styles = {
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-100",
  };
  return <div className={`rounded-3xl border p-4 text-sm ${styles[tone] || styles.amber}`}>{text}</div>;
}

function translateSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "sale") return "بيع";
  if (normalized === "purchase") return "شراء";
  if (normalized === "return") return "مرتجع";
  if (normalized === "manual") return "يدوي";
  if (normalized === "expense") return "مصروف";
  if (normalized === "inventory") return "مخزون";
  if (normalized === "payment") return "سداد";
  if (normalized === "transfer") return "تحويل";
  if (normalized === "journal") return "قيد يومي";
  return "غير معروف";
}

function Th({ children, align = "left" }) {
  return <th className={["px-4 py-3 font-black", align === "right" ? "text-right" : ""].join(" ")}>{children}</th>;
}

function Td({ children, align = "left", className = "" }) {
  return <td className={["px-4 py-4 align-top", align === "right" ? "text-right" : "", className].join(" ")}>{children}</td>;
}

export default GeneralLedger;
