import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Download, FileSpreadsheet, FileText, Landmark, Loader2, RefreshCcw, Search, Wallet } from "lucide-react";

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
    { value: "", label: t("accounting.ledgers.filters.allAccounts") },
    { value: "asset", label: t("accounting.accountTypes.asset") },
    { value: "revenue", label: t("accounting.accountTypes.revenue") },
    { value: "expense", label: t("accounting.accountTypes.expense") },
    { value: "ledger", label: t("accounting.accountTypes.ledger") },
  ];

  const loadReport = async (params = filters) => {
    setLoading(true);
    setError("");
    try {
      const result = await accountingApi.getLedgersReport(params);
      setReport({ ...emptyReport, ...result, totals: { ...emptyReport.totals, ...(result?.totals || {}) } });
      setAppliedFilters(params);
    } catch (requestError) {
      setError(requestError?.message || t("accounting.ledgers.errors.loadFailed"));
      setReport(emptyReport);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, []);

  const applyFilters = (event) => {
    event.preventDefault();
    loadReport(filters);
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const rows = Array.isArray(report.rows) ? report.rows : [];
  const totals = report.totals || emptyReport.totals;
  const exportPayload = {
    reportType: "ledgers",
    ledger: report,
    filters: appliedFilters,
    language: i18n.language,
  };

  const logExport = async (format) => {
    await accountingApi.logExportGenerated({
      report_type: "ledgers",
      format,
      filters: appliedFilters,
    }).catch(() => {});
  };

  const exportReport = async (format, exporter) => {
    await logExport(format);
    exporter(exportPayload);
  };

  return (
    <AccountingShell
      title={t("accounting.ledgers.title")}
      subtitle={t("accounting.ledgers.subtitle")}
      actions={
        <>
          <Link to="/accounting/reports" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <Landmark className="h-4 w-4" />
            {t("accounting.reports.title")}
          </Link>
          <button type="button" onClick={() => exportReport("pdf", exportAccountingPdf)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
            <FileText className="h-4 w-4" />
            {t("accounting.common.actions.exportPdf")}
          </button>
          <button type="button" onClick={() => exportReport("excel", exportAccountingExcel)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
            <FileSpreadsheet className="h-4 w-4" />
            {t("accounting.common.actions.exportExcel")}
          </button>
          <button type="button" onClick={() => exportReport("csv", exportAccountingCsv)} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black">
            <Download className="h-4 w-4" />
            {t("accounting.common.actions.exportCsv")}
          </button>
        </>
      }
      tabs={[
        { to: "/accounting", label: t("accounting.tabs.dashboard") },
        { to: "/accounting/ledgers", label: t("accounting.tabs.ledgers"), end: true },
        { to: "/accounting/reports", label: t("accounting.tabs.reports") },
        { to: "/accounting/profit-loss", label: t("accounting.tabs.profitLoss") },
        { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
      ]}
    >
      <form onSubmit={applyFilters} className="grid gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10 md:grid-cols-5">
        <FilterField label={t("accounting.common.labels.from")}>
          <input type="date" value={filters.from_date} onChange={(event) => updateFilter("from_date", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/60" />
        </FilterField>
        <FilterField label={t("accounting.common.labels.to")}>
          <input type="date" value={filters.to_date} onChange={(event) => updateFilter("to_date", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/60" />
        </FilterField>
        <FilterField label={t("accounting.common.labels.branch")}>
          <input type="number" min="1" placeholder={t("accounting.common.placeholders.branchId")} value={filters.branch_id} onChange={(event) => updateFilter("branch_id", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-400/60" />
        </FilterField>
        <FilterField label={t("accounting.common.labels.account")}>
          <select value={filters.account_type} onChange={(event) => updateFilter("account_type", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/60">
            {accountTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FilterField>
        <div className="flex items-end gap-2">
          <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400">
            <Search className="h-4 w-4" />
            {t("accounting.common.actions.apply")}
          </button>
        </div>
      </form>

      {loading ? <StateBanner icon={<Loader2 className="h-5 w-5 animate-spin" />} title={t("accounting.ledgers.states.loadingTitle")} text={t("accounting.ledgers.states.loadingText")} /> : null}

      {error ? (
        <StateBanner
          icon={<AlertTriangle className="h-5 w-5" />}
          title={t("accounting.ledgers.states.errorTitle")}
          text={error}
          action={
            <button type="button" onClick={() => loadReport()} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
              <RefreshCcw className="h-4 w-4" />
              {t("accounting.common.actions.retry")}
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
            <h3 className="text-xl font-black text-white">{t("accounting.ledgers.table.title")}</h3>
            <p className="mt-1 text-sm text-zinc-400">{t("accounting.common.rows.liveRows", { count: rows.length })}</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="m-5 rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">{t("accounting.ledgers.table.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <Th>{t("accounting.common.labels.date")}</Th>
                  <Th>{t("accounting.common.labels.reference")}</Th>
                  <Th>{t("accounting.common.labels.source")}</Th>
                  <Th>{t("accounting.common.labels.account")}</Th>
                  <Th>{t("accounting.common.labels.description")}</Th>
                  <Th align="right">{t("accounting.common.labels.debit")}</Th>
                  <Th align="right">{t("accounting.common.labels.credit")}</Th>
                  <Th align="right">{t("accounting.common.labels.balance")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {rows.map((row, index) => (
                  <tr key={`${row.reference}-${row.source_type}-${index}`} className="transition hover:bg-white/[0.03]">
                    <Td>{formatDateTime(row.date)}</Td>
                    <Td className="font-semibold text-white">{row.reference || "-"}</Td>
                    <Td><SourceBadge label={row.source_type} /></Td>
                    <Td className="text-white">{row.account_name || "-"}</Td>
                    <Td className="max-w-[280px] text-zinc-400">{row.description || "-"}</Td>
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
    </AccountingShell>
  );
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
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-cyan-300">{icon}</div>
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
  return (
    <span className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs font-black text-cyan-200">
      {String(label || "ledger").replaceAll("_", " ")}
    </span>
  );
}

function Th({ children, align = "left" }) {
  return <th className={["px-4 py-3 font-black", align === "right" ? "text-right" : ""].join(" ")}>{children}</th>;
}

function Td({ children, align = "left", className = "" }) {
  return <td className={["px-4 py-4 align-top", align === "right" ? "text-right" : "", className].join(" ")}>{children}</td>;
}

export default Accounts;
