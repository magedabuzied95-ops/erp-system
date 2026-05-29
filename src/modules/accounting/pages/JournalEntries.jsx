import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  BookOpenText,
  ChevronRight,
  Filter,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency, formatDateTime } from "../lib/financeStore";

function JournalEntries() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [referenceType, setReferenceType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0 });

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (referenceType) params.set("referenceType", referenceType);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      params.set("limit", "100");

      const result = await api.get(`/accounting/journal-entries?${params.toString()}`);
      setEntries(result?.entries || []);
      setPagination(result?.pagination || { total: 0, limit: 100, offset: 0 });
    } catch (err) {
      console.log(err);
      setError(t("accounting.journal.errors.loadFailedWithPeriod"));
      toast.error(t("accounting.journal.errors.loadFailed"));
      setEntries([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateFrom, dateTo, referenceType, search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEntries();
    }, 250);

    return () => clearTimeout(timer);
  }, [fetchEntries]);

  const loadDetail = async (entryId) => {
    try {
      setDrawerLoading(true);
      setSelectedEntry({
        id: entryId,
        entry_number: t("accounting.common.labels.loading"),
        lines: [],
      });
      const result = await api.get(`/accounting/journal-entries/${entryId}`);
      setSelectedEntry(result?.entry || null);
    } catch (err) {
      console.log(err);
      toast.error(t("accounting.journal.errors.detailFailed"));
      setSelectedEntry(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await fetchEntries();
  };

  const metrics = useMemo(() => {
    const totals = entries.reduce(
      (acc, entry) => {
        const debit = Number(entry.total_debit || 0);
        const credit = Number(entry.total_credit || 0);
        acc.debit += debit;
        acc.credit += credit;
        if (Math.abs(debit - credit) < 0.01) acc.balanced += 1;
        return acc;
      },
      { debit: 0, credit: 0, balanced: 0 }
    );

    return {
      total: entries.length,
      debit: totals.debit,
      credit: totals.credit,
      balanced: totals.balanced,
    };
  }, [entries]);

  return (
    <AccountingShell
      title={t("accounting.journal.title")}
      subtitle={t("accounting.journal.subtitle")}
      actions={
        <>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("accounting.common.actions.refresh")}
          </button>
          <Link
            to="/accounting"
            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400"
          >
            <BookOpenText className="h-4 w-4" />
            {t("accounting.tabs.dashboard")}
          </Link>
        </>
      }
      tabs={[
        { to: "/accounting", label: t("accounting.tabs.dashboard") },
        { to: "/accounting/journal-entries", label: t("accounting.tabs.journal"), end: true },
        { to: "/accounting/accounts", label: t("accounting.tabs.accounts") },
        { to: "/accounting/reports", label: t("accounting.tabs.reports") },
        { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={t("accounting.journal.metrics.entries")} value={metrics.total} tone="cyan" icon={<BookOpenText className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.journal.metrics.balanced")} value={metrics.balanced} tone="emerald" icon={<ChevronRight className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.journal.metrics.debits")} value={formatCurrency(metrics.debit)} tone="rose" icon={<ArrowLabel className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.journal.metrics.credits")} value={formatCurrency(metrics.credit)} tone="amber" icon={<ArrowLabel flip className="h-5 w-5" />} />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 className="text-xl font-black text-white">{t("accounting.journal.ledgerTitle")}</h3>
            <p className="mt-1 text-sm text-zinc-400">{t("accounting.journal.ledgerSubtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterChip value={referenceType} onChange={setReferenceType} options={movementTypes(t)} />
            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
              <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t("accounting.common.labels.from")}</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-transparent text-sm outline-none" />
            </label>
            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
              <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t("accounting.common.labels.to")}</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-transparent text-sm outline-none" />
            </label>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setReferenceType("");
                setDateFrom("");
                setDateTo("");
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10"
            >
              <X className="h-4 w-4" />
              {t("accounting.common.actions.clear")}
            </button>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-zinc-300">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("accounting.journal.placeholders.search")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
          />
        </label>

        <div className="mt-5 overflow-hidden rounded-3xl border border-white/10">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-left text-sm">
              <thead className="bg-white/5 text-zinc-400">
                <tr>
                  <Th>{t("accounting.common.labels.reference")}</Th>
                  <Th>{t("accounting.common.labels.type")}</Th>
                  <Th>{t("accounting.common.labels.description")}</Th>
                  <Th>{t("accounting.common.labels.date")}</Th>
                  <Th className="text-right">{t("accounting.common.labels.debit")}</Th>
                  <Th className="text-right">{t("accounting.common.labels.credit")}</Th>
                  <Th className="text-right">{t("accounting.journal.labels.lines")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-zinc-950/70">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-zinc-400">
                      {t("accounting.journal.states.loadingRows")}
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-zinc-400">
                      {t("accounting.journal.states.emptyRows")}
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="cursor-pointer hover:bg-white/5"
                      onClick={() => loadDetail(entry.id)}
                    >
                      <Td>
                        <div className="font-semibold text-white">{entry.entry_number}</div>
                        <div className="mt-1 text-xs text-zinc-500">#{entry.id}</div>
                      </Td>
                      <Td>{entry.reference_type || "manual"}</Td>
                      <Td>
                        <div className="max-w-[340px] truncate text-zinc-200">{entry.description || t("accounting.journal.fallbacks.journalEntry")}</div>
                        <div className="mt-1 text-xs text-zinc-500">{entry.notes || t("accounting.common.labels.noNotes")}</div>
                      </Td>
                      <Td>{formatDateTime(entry.created_at)}</Td>
                      <Td className="text-right font-semibold text-emerald-300">{formatCurrency(entry.total_debit || 0)}</Td>
                      <Td className="text-right font-semibold text-rose-300">{formatCurrency(entry.total_credit || 0)}</Td>
                      <Td className="text-right text-zinc-400">{entry.line_count || 0}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
          <div>
            {t("accounting.journal.showingEntries", { shown: entries.length, total: pagination.total || entries.length })}
          </div>
          <div>
            {t("accounting.journal.balanceHint")}
          </div>
        </div>
      </div>

      {selectedEntry ? (
        <EntryDrawer
          entry={selectedEntry}
          loading={drawerLoading}
          onClose={() => setSelectedEntry(null)}
          t={t}
        />
      ) : null}
    </AccountingShell>
  );
}

function EntryDrawer({ entry, loading, onClose, t }) {
  const debitTotal = Number(entry.total_debit || 0);
  const creditTotal = Number(entry.total_credit || 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <button type="button" aria-label={t("accounting.journal.actions.closeDrawer")} onClick={onClose} className="absolute inset-0 cursor-default" />
      <div className="relative z-10 h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/70">{t("accounting.journal.detailTitle")}</div>
            <h3 className="mt-2 text-2xl font-black text-white">{entry.entry_number}</h3>
            <p className="mt-1 text-sm text-zinc-400">{entry.description || t("accounting.journal.fallbacks.journalEntry")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 p-2 text-zinc-200 transition hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{t("accounting.journal.states.loadingDetail")}</div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <DetailStat label={t("accounting.journal.labels.debitTotal")} value={formatCurrency(debitTotal)} tone="emerald" />
              <DetailStat label={t("accounting.journal.labels.creditTotal")} value={formatCurrency(creditTotal)} tone="rose" />
              <DetailStat label={t("accounting.common.labels.reference")} value={`${entry.reference_type || "manual"} #${entry.reference_id || "-"}`} tone="cyan" />
            </div>

            <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
                <div>
                  <span className="text-zinc-500">{t("accounting.common.labels.createdAt")}:</span> {formatDateTime(entry.created_at)}
                </div>
                <div>
                  <span className="text-zinc-500">{t("accounting.common.labels.createdBy")}:</span> {entry.created_by_name || entry.created_by || t("accounting.auditTrail.fallbacks.system")}
                </div>
                <div>
                  <span className="text-zinc-500">{t("accounting.common.labels.notes")}:</span> {entry.notes || t("accounting.common.labels.noNotes")}
                </div>
                <div>
                  <span className="text-zinc-500">{t("accounting.common.labels.status")}:</span> {entry.status || "posted"}
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-3xl border border-white/10">
              <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <Th>{t("accounting.common.labels.account")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.debit")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.credit")}</Th>
                    <Th>{t("accounting.common.labels.branch")}</Th>
                    <Th>{t("accounting.common.labels.notes")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 bg-zinc-950/70">
                  {(entry.lines || []).map((line) => (
                    <tr key={line.id}>
                      <Td>
                        <div className="font-semibold text-white">
                          {line.account_code ? `${line.account_code} - ` : ""}
                          {line.account_name || t("accounting.common.labels.account")}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">{line.account_type || ""}</div>
                      </Td>
                      <Td className="text-right font-semibold text-emerald-300">{formatCurrency(line.debit || 0)}</Td>
                      <Td className="text-right font-semibold text-rose-300">{formatCurrency(line.credit || 0)}</Td>
                      <Td>{line.branch_id || "-"}</Td>
                      <Td>{line.notes || "-"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FilterChip({ value, onChange, options }) {
  return (
    <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
      <Filter className="h-4 w-4 text-zinc-500" />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent text-sm outline-none">
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-zinc-950 text-white">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function movementTypes(t) {
  return [
    { value: "", label: t("accounting.journal.referenceTypes.all") },
    { value: "purchase", label: t("accounting.journal.referenceTypes.purchase") },
    { value: "order", label: t("accounting.journal.referenceTypes.order") },
    { value: "return", label: t("accounting.journal.referenceTypes.return") },
    { value: "manual_adjustment", label: t("accounting.journal.referenceTypes.manualAdjustment") },
    { value: "inventory", label: t("accounting.journal.referenceTypes.inventory") },
  ];
}

function DetailStat({ label, value, tone = "zinc" }) {
  const tones = {
    zinc: "border-white/10 bg-white/5 text-white",
    cyan: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  };

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-xl font-black">{value}</div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] ${className}`}>{children}</th>;
}

function Td({ children, className = "" }) {
  return <td className={`px-4 py-4 align-top text-zinc-300 ${className}`}>{children}</td>;
}

function ArrowLabel({ flip = false, className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`${className} ${flip ? "rotate-180" : ""}`}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 7h10" />
      <path d="M13 3l4 4-4 4" />
    </svg>
  );
}

export default JournalEntries;
