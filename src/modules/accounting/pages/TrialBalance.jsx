import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Scale, Search } from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";

function TrialBalance() {
  const [filters, setFilters] = useState({
    from_date: "",
    to_date: "",
    branch_id: "",
  });
  const [report, setReport] = useState({
    rows: [],
    totals: {
      total_debits: 0,
      total_credits: 0,
      is_balanced: true,
    },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = async (params = filters) => {
    try {
      setLoading(true);
      setError("");
      const result = await accountingApi.getTrialBalanceV1(params);
      setReport({
        rows: Array.isArray(result?.rows) ? result.rows : [],
        totals: {
          total_debits: Number(result?.totals?.total_debits || 0),
          total_credits: Number(result?.totals?.total_credits || 0),
          is_balanced: Boolean(result?.totals?.is_balanced),
        },
      });
    } catch (requestError) {
      setReport({
        rows: [],
        totals: {
          total_debits: 0,
          total_credits: 0,
          is_balanced: true,
        },
      });
      setError(requestError?.message || "تعذر تحميل ميزان المراجعة.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, []);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = (event) => {
    event.preventDefault();
    loadReport(filters);
  };

  const nonZeroRows = useMemo(
    () => report.rows.filter((row) => Number(row.total_debit || 0) !== 0 || Number(row.total_credit || 0) !== 0),
    [report.rows]
  );

  return (
    <AccountingShell
      title="ميزان المراجعة"
      subtitle="ميزان مراجعة مبني فقط على الحسابات والقيود اليومية وسطور القيود"
      actions={
        <>
          <button
            type="button"
            onClick={() => loadReport(filters)}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </button>
          <Link
            to="/accounting"
            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400"
          >
            <Scale className="h-4 w-4" />
            لوحة المحاسبة
          </Link>
        </>
      }
      tabs={[
        { to: "/accounting", label: "لوحة التحكم" },
        { to: "/accounting/journal-entries", label: "القيود اليومية" },
        { to: "/accounting/accounts", label: "دليل الحسابات" },
        { to: "/accounting/general-ledger", label: "دفتر الأستاذ" },
        { to: "/accounting/trial-balance", label: "ميزان المراجعة", end: true },
        { to: "/accounting/reports", label: "التقارير" },
      ]}
    >
      <form onSubmit={applyFilters} className="grid gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10 md:grid-cols-4">
        <Field label="من تاريخ">
          <input type="date" value={filters.from_date} onChange={(event) => updateFilter("from_date", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
        </Field>
        <Field label="إلى تاريخ">
          <input type="date" value={filters.to_date} onChange={(event) => updateFilter("to_date", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
        </Field>
        <Field label="الفرع">
          <input type="number" min="1" value={filters.branch_id} onChange={(event) => updateFilter("branch_id", event.target.value)} placeholder="اختياري" className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500" />
        </Field>
        <div className="flex items-end">
          <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400">
            <Search className="h-4 w-4" />
            عرض الميزان
          </button>
        </div>
      </form>

      {error ? <Banner text={error} /> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <FinanceMetricCard label="إجمالي المدين" value={formatCurrency(report.totals.total_debits)} tone="emerald" icon={<Scale className="h-5 w-5" />} />
        <FinanceMetricCard label="إجمالي الدائن" value={formatCurrency(report.totals.total_credits)} tone="rose" icon={<Scale className="h-5 w-5" />} />
        <FinanceMetricCard label="الحالة" value={report.totals.is_balanced ? "متوازن" : "غير متوازن"} tone={report.totals.is_balanced ? "cyan" : "amber"} icon={<Scale className="h-5 w-5" />} />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
        <div className="flex items-center gap-3">
          <div className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${report.totals.is_balanced ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
            {report.totals.is_balanced ? "متوازن" : "غير متوازن"}
          </div>
          <div className="text-sm text-zinc-400">يعتمد هذا التقرير فقط على `journal_entry_lines` المربوطة بقيود اليومية.</div>
        </div>

        {loading ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-8 text-sm text-zinc-400">جارٍ تحميل ميزان المراجعة...</div>
        ) : nonZeroRows.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">لا توجد أرصدة ضمن الفترة الحالية.</div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-[980px] w-full text-right text-sm" dir="rtl">
              <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <Th>كود الحساب</Th>
                  <Th>اسم الحساب</Th>
                  <Th>نوع الحساب</Th>
                  <Th align="right">إجمالي المدين</Th>
                  <Th align="right">إجمالي الدائن</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {nonZeroRows.map((row) => (
                  <tr key={row.account_id} className="transition hover:bg-white/[0.03]">
                    <Td className="font-black text-cyan-200">{row.account_code || "-"}</Td>
                    <Td className="text-white">{row.account_name || "-"}</Td>
                    <Td>{translateType(row.account_type)}</Td>
                    <Td align="right" className="font-black text-emerald-300">{formatCurrency(row.total_debit || 0)}</Td>
                    <Td align="right" className="font-black text-rose-300">{formatCurrency(row.total_credit || 0)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-white/5">
                <tr>
                  <Th>الإجمالي</Th>
                  <Th />
                  <Th />
                  <Th align="right" className="text-emerald-300">{formatCurrency(report.totals.total_debits || 0)}</Th>
                  <Th align="right" className="text-rose-300">{formatCurrency(report.totals.total_credits || 0)}</Th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </AccountingShell>
  );
}

function translateType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "asset") return "أصل";
  if (normalized === "liability") return "التزام";
  if (normalized === "equity") return "حقوق ملكية";
  if (normalized === "revenue") return "إيراد";
  if (normalized === "expense") return "مصروف";
  return normalized || "-";
}

function Field({ label, children }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function Banner({ text }) {
  return <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">{text}</div>;
}

function Th({ children, align = "left", className = "" }) {
  return <th className={["px-4 py-3 font-black", align === "right" ? "text-right" : "", className].join(" ")}>{children}</th>;
}

function Td({ children, align = "left", className = "" }) {
  return <td className={["px-4 py-4 align-top", align === "right" ? "text-right" : "", className].join(" ")}>{children}</td>;
}

export default TrialBalance;
