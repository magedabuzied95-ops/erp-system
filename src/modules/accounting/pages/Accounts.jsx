import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookCopy,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Loader2,
  RefreshCcw,
  Search,
  Wallet,
} from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { exportAccountingCsv, exportAccountingExcel, exportAccountingPdf } from "../lib/financialReportExport";
import { formatCurrency, formatDateTime } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";

const emptyReport = {
  rows: [],
  totals: {
    debit: 0,
    credit: 0,
    ending_balance: 0,
  },
};

function Accounts() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const initialView = location.pathname.includes("/ledgers") ? "ledgers" : "chart";

  const [view, setView] = useState(initialView);
  const [accountsData, setAccountsData] = useState({ accounts: [], summary: { total: 0, active: 0, by_type: {} } });
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [accountSearch, setAccountSearch] = useState("");

  const [report, setReport] = useState(emptyReport);
  const [filters, setFilters] = useState({
    from_date: "",
    to_date: "",
    branch_id: "",
    account_type: "",
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const accountTypeOptions = [
    { value: "", label: "كل الحسابات" },
    { value: "asset", label: "أصول" },
    { value: "liability", label: "التزامات" },
    { value: "equity", label: "حقوق ملكية" },
    { value: "revenue", label: "إيرادات" },
    { value: "expense", label: "مصروفات" },
  ];

  const loadAccounts = async () => {
    setAccountsLoading(true);
    setAccountsError("");
    try {
      const result = await accountingApi.getAccounts();
      setAccountsData({
        accounts: Array.isArray(result?.accounts) ? result.accounts : [],
        summary: result?.summary || { total: 0, active: 0, by_type: {} },
      });
    } catch (requestError) {
      setAccountsError(requestError?.message || "تعذر تحميل شجرة الحسابات");
      setAccountsData({ accounts: [], summary: { total: 0, active: 0, by_type: {} } });
    } finally {
      setAccountsLoading(false);
    }
  };

  const loadReport = async (params = filters) => {
    setLoading(true);
    setError("");
    try {
      const result = await accountingApi.getLedgersReport(params);
      setReport({
        ...emptyReport,
        ...result,
        totals: { ...emptyReport.totals, ...(result?.totals || {}) },
      });
      setAppliedFilters(params);
    } catch (requestError) {
      setError(requestError?.message || "تعذر تحميل دفتر الأستاذ");
      setReport(emptyReport);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
    loadReport();
  }, []);

  useEffect(() => {
    setView(location.pathname.includes("/ledgers") ? "ledgers" : "chart");
  }, [location.pathname]);

  const applyFilters = (event) => {
    event.preventDefault();
    loadReport(filters);
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const exportPayload = {
    reportType: "ledgers",
    ledger: report,
    filters: appliedFilters,
    language: i18n.language,
  };

  const logExport = async (format) => {
    await accountingApi
      .logExportGenerated({
        report_type: "ledgers",
        format,
        filters: appliedFilters,
      })
      .catch(() => {});
  };

  const exportReport = async (format, exporter) => {
    await logExport(format);
    exporter(exportPayload);
  };

  const filteredAccounts = useMemo(() => {
    const search = accountSearch.trim().toLowerCase();
    if (!search) return accountsData.accounts;
    return accountsData.accounts.filter((account) =>
      [account.account_code, account.account_name, account.account_type, account.parent_account_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [accountSearch, accountsData.accounts]);

  const rows = Array.isArray(report.rows) ? report.rows : [];
  const totals = report.totals || emptyReport.totals;

  return (
    <AccountingShell
      title="دليل الحسابات"
      subtitle="أساس محاسبي أولي مبني على دليل الحسابات مع الإبقاء على دفتر الأستاذ الحالي"
      actions={
        <>
          <Link to="/accounting/reports" className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <Landmark className="h-4 w-4" />
            {t("accounting.reports.title")}
          </Link>
          <button type="button" onClick={() => exportReport("pdf", exportAccountingPdf)} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
            <FileText className="h-4 w-4" />
            PDF
          </button>
          <button type="button" onClick={() => exportReport("excel", exportAccountingExcel)} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
            <FileSpreadsheet className="h-4 w-4" />
            Excel
          </button>
          <button type="button" onClick={() => exportReport("csv", exportAccountingCsv)} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-black">
            <Download className="h-4 w-4" />
            CSV
          </button>
        </>
      }
      tabs={[
        { to: "/accounting", label: t("accounting.tabs.dashboard") },
        { to: "/accounting/journal-entries", label: t("accounting.tabs.journal") },
        { to: "/accounting/accounts", label: t("accounting.tabs.accounts"), end: true },
        { to: "/accounting/general-ledger", label: "دفتر الأستاذ" },
        { to: "/accounting/trial-balance", label: "ميزان المراجعة" },
        { to: "/accounting/reports", label: t("accounting.tabs.reports") },
        { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
      ]}
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setView("chart")}
          className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-black transition ${view === "chart" ? "bg-primary text-black" : "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"}`}
        >
          دليل الحسابات
        </button>
        <button
          type="button"
          onClick={() => setView("ledgers")}
          className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-black transition ${view === "ledgers" ? "bg-primary text-black" : "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"}`}
        >
          عرض دفتر الأستاذ
        </button>
      </div>

      {view === "chart" ? (
        <>
          {accountsError ? (
            <StateBanner
              icon={<AlertTriangle className="h-5 w-5" />}
              title="تعذر تحميل الحسابات"
              text={accountsError}
              action={
                <button type="button" onClick={loadAccounts} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
                  <RefreshCcw className="h-4 w-4" />
                  إعادة المحاولة
                </button>
              }
            />
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FinanceMetricCard label="إجمالي الحسابات" value={accountsData.summary.total || 0} tone="cyan" icon={<BookCopy className="h-5 w-5" />} />
            <FinanceMetricCard label="الحسابات النشطة" value={accountsData.summary.active || 0} tone="emerald" icon={<Wallet className="h-5 w-5" />} />
            <FinanceMetricCard label="حسابات الأصول" value={accountsData.summary.by_type?.asset || 0} tone="amber" icon={<ArrowDownLeft className="h-5 w-5" />} />
            <FinanceMetricCard label="حسابات المصروفات" value={accountsData.summary.by_type?.expense || 0} tone="rose" icon={<ArrowUpRight className="h-5 w-5" />} />
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="m1-section-title text-white">شجرة الحسابات</h3>
                <p className="mt-1 text-sm text-zinc-400">الحسابات الافتراضية تُنشأ مرة واحدة فقط لكل مستأجر بدون تكرار.</p>
              </div>
              <div className="flex gap-2">
                <label className="flex min-w-[260px] items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-3 text-zinc-300">
                  <Search className="h-4 w-4 text-zinc-500" />
                  <input
                    value={accountSearch}
                    onChange={(event) => setAccountSearch(event.target.value)}
                    placeholder="ابحث بالكود أو الاسم"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
                  />
                </label>
                <button type="button" onClick={loadAccounts} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
                  <RefreshCcw className={`h-4 w-4 ${accountsLoading ? "animate-spin" : ""}`} />
                  تحديث
                </button>
              </div>
            </div>

            {accountsLoading ? (
              <div className="mt-5 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-8 text-sm text-zinc-400">جارٍ تحميل الحسابات...</div>
            ) : filteredAccounts.length === 0 ? (
              <div className="mt-5 rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">لا توجد حسابات مطابقة للبحث.</div>
            ) : (
              <div className="m1-table-container mt-5 overflow-x-auto">
                <table className="m1-table m1-table--compact min-w-[860px] w-full text-right text-sm" dir="rtl">
                  <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    <tr>
                      <Th align="right">الكود</Th>
                      <Th align="right">اسم الحساب</Th>
                      <Th align="right">النوع</Th>
                      <Th align="right">الحساب الأب</Th>
                      <Th align="right">الحالة</Th>
                      <Th align="right">تاريخ الإنشاء</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.map((account) => (
                      <tr key={account.id} className="transition hover:bg-white/[0.03]">
                        <Td align="right" className="font-black text-primary">{account.account_code || "-"}</Td>
                        <Td align="right" className="text-white">{account.account_name || "-"}</Td>
                        <Td align="right">{translateAccountType(account.account_type)}</Td>
                        <Td align="right">{account.parent_account_name || "-"}</Td>
                        <Td align="right">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${account.is_active ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-300"}`}>
                            {account.is_active ? "نشط" : "موقوف"}
                          </span>
                        </Td>
                        <Td align="right">{formatDateTime(account.created_at)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <form onSubmit={applyFilters} className="grid gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10 md:grid-cols-5">
            <FilterField label={t("accounting.common.labels.from")}>
              <input type="date" value={filters.from_date} onChange={(event) => updateFilter("from_date", event.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-primary/60" />
            </FilterField>
            <FilterField label={t("accounting.common.labels.to")}>
              <input type="date" value={filters.to_date} onChange={(event) => updateFilter("to_date", event.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-primary/60" />
            </FilterField>
            <FilterField label={t("accounting.common.labels.branch")}>
              <input type="number" min="1" placeholder={t("accounting.common.placeholders.branchId")} value={filters.branch_id} onChange={(event) => updateFilter("branch_id", event.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-primary/60" />
            </FilterField>
            <FilterField label={t("accounting.common.labels.account")}>
              <select value={filters.account_type} onChange={(event) => updateFilter("account_type", event.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none transition focus:border-primary/60">
                {accountTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>
            <div className="flex items-end gap-2">
              <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-black transition hover:bg-primary">
                <Search className="h-4 w-4" />
                تطبيق
              </button>
            </div>
          </form>

          {loading ? <StateBanner icon={<Loader2 className="h-5 w-5 animate-spin" />} title="جارٍ تحميل دفتر الأستاذ" text="يتم الآن جلب الحركات المحاسبية الحالية." /> : null}

          {error ? (
            <StateBanner
              icon={<AlertTriangle className="h-5 w-5" />}
              title="تعذر تحميل دفتر الأستاذ"
              text={error}
              action={
                <button type="button" onClick={() => loadReport()} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
                  <RefreshCcw className="h-4 w-4" />
                  إعادة المحاولة
                </button>
              }
            />
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <FinanceMetricCard label={t("accounting.common.metrics.totalDebit")} value={formatCurrency(totals.debit || 0)} tone="emerald" icon={<ArrowDownLeft className="h-5 w-5" />} />
            <FinanceMetricCard label={t("accounting.common.metrics.totalCredit")} value={formatCurrency(totals.credit || 0)} tone="rose" icon={<ArrowUpRight className="h-5 w-5" />} />
            <FinanceMetricCard label={t("accounting.common.metrics.endingBalance")} value={formatCurrency(totals.ending_balance || 0)} tone={Number(totals.ending_balance || 0) >= 0 ? "cyan" : "rose"} icon={<Wallet className="h-5 w-5" />} />
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/10">
            <div className="flex flex-col gap-1 border-b border-white/10 p-5 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="m1-section-title text-white">دفتر الأستاذ</h3>
                <p className="mt-1 text-sm text-zinc-400">{t("accounting.common.rows.liveRows", { count: rows.length })}</p>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="m-5 rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">لا توجد حركات ضمن الفلاتر الحالية.</div>
            ) : (
              <div className="m1-table-container overflow-x-auto">
                <table className="m1-table m1-table--compact min-w-[980px] w-full text-right text-sm" dir="rtl">
                  <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    <tr>
                      <Th align="right">{t("accounting.common.labels.date")}</Th>
                      <Th align="right">{t("accounting.common.labels.reference")}</Th>
                      <Th align="right">{t("accounting.common.labels.source")}</Th>
                      <Th align="right">{t("accounting.common.labels.account")}</Th>
                      <Th align="right">{t("accounting.common.labels.description")}</Th>
                      <Th align="right">{t("accounting.common.labels.debit")}</Th>
                      <Th align="right">{t("accounting.common.labels.credit")}</Th>
                      <Th align="right">{t("accounting.common.labels.balance")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${row.reference}-${row.source_type}-${index}`} className="transition hover:bg-white/[0.03]">
                        <Td align="right">{formatDateTime(row.date)}</Td>
                        <Td align="right" className="font-semibold text-white">{row.reference || "-"}</Td>
                        <Td align="right"><SourceBadge label={row.source_type} /></Td>
                        <Td align="right" className="text-white">{row.account_name || "-"}</Td>
                        <Td align="right" className="max-w-[280px] text-zinc-400">{row.description || "-"}</Td>
                        <Td align="right" className="font-black text-emerald-300">{Number(row.debit || 0) ? formatCurrency(row.debit) : "-"}</Td>
                        <Td align="right" className="font-black text-rose-300">{Number(row.credit || 0) ? formatCurrency(row.credit) : "-"}</Td>
                        <Td align="right" className="font-black text-white">{formatCurrency(row.balance || 0)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </AccountingShell>
  );
}

function translateAccountType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "asset") return "أصل";
  if (normalized === "liability") return "التزام";
  if (normalized === "equity") return "حقوق ملكية";
  if (normalized === "revenue") return "إيراد";
  if (normalized === "expense") return "مصروف";
  return normalized || "-";
}

function FilterField({ label, children }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function StateBanner({ icon, title, text, action }) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 text-white shadow-xl shadow-black/10 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3 text-primary">{icon}</div>
        <div>
          <div className="font-black">{title}</div>
          <div className="mt-1 text-sm text-zinc-400">{text}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

function SourceBadge({ label }) {
  const translated = translateSourceType(label);
  return (
    <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-black text-primary">
      {translated}
    </span>
  );
}

function translateSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ledger") return "دفتر";
  if (normalized === "purchase") return "شراء";
  if (normalized === "order") return "طلب";
  if (normalized === "return") return "مرتجع";
  if (normalized === "manual") return "يدوي";
  if (normalized === "expense") return "مصروف";
  if (normalized === "inventory") return "مخزون";
  if (normalized === "payment") return "سداد";
  if (normalized === "transfer") return "تحويل";
  if (normalized === "cash") return "نقدية";
  return "غير معروف";
}

function Th({ children, align = "left" }) {
  return <th className={["px-4 py-3 font-black", align === "right" ? "text-right" : ""].join(" ")}>{children}</th>;
}

function Td({ children, align = "left", className = "" }) {
  return <td className={["px-4 py-4 align-top", align === "right" ? "text-right" : "", className].join(" ")}>{children}</td>;
}

export default Accounts;
