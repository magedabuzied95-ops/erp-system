import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BookOpenText,
  ChevronRight,
  Filter,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency, formatDateTime } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";
import { Pagination } from "../../../shared/ui";

const emptyLine = () => ({
  account_code: "",
  debit: "",
  credit: "",
  notes: "",
});

function JournalEntries() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [referenceType, setReferenceType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, limit: 25, offset: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [activeTab, setActiveTab] = useState("list");

  const [formState, setFormState] = useState({
    description: "",
    notes: "",
    entry_date: "",
    branch_id: "",
    lines: [emptyLine(), emptyLine()],
  });
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [previewState, setPreviewState] = useState({
    source_type: "",
    from_date: "",
    to_date: "",
    limit: 20,
  });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewResult, setPreviewResult] = useState({ items: [], summary: { total: 0, ready: 0, skipped: 0, already_posted: 0 } });

  const loadAccounts = useCallback(async () => {
    try {
      const result = await accountingApi.getAccounts();
      setAccounts(Array.isArray(result?.accounts) ? result.accounts : []);
    } catch (err) {
      console.log(err);
      setAccounts([]);
    }
  }, []);

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await accountingApi.getJournalEntries({
        search: search.trim() || undefined,
        referenceType: referenceType || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setEntries(result?.entries || []);
      setPagination(result?.pagination || { total: 0, limit: pageSize, offset: (page - 1) * pageSize });
    } catch (err) {
      console.log(err);
      setError("تعذر تحميل القيود اليومية ضمن الفترة الحالية.");
      toast.error("فشل تحميل القيود اليومية");
      setEntries([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateFrom, dateTo, page, pageSize, referenceType, search]);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, referenceType, search]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

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
        entry_number: "جارٍ التحميل...",
        lines: [],
      });
      const result = await accountingApi.getJournalEntryDetail(entryId);
      setSelectedEntry(result?.entry || null);
    } catch (err) {
      console.log(err);
      toast.error("تعذر تحميل تفاصيل القيد");
      setSelectedEntry(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchEntries(), loadAccounts()]);
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

  const updateLine = (lineIndex, key, value) => {
    setFormState((current) => ({
      ...current,
      lines: current.lines.map((line, index) => (index === lineIndex ? { ...line, [key]: value } : line)),
    }));
  };

  const addLine = () => {
    setFormState((current) => ({
      ...current,
      lines: [...current.lines, emptyLine()],
    }));
  };

  const removeLine = (lineIndex) => {
    setFormState((current) => ({
      ...current,
      lines: current.lines.filter((_, index) => index !== lineIndex),
    }));
  };

  const submitJournalEntry = async (event) => {
    event.preventDefault();
    setFormSubmitting(true);
    try {
      const payload = {
        source_type: "manual",
        description: formState.description,
        notes: formState.notes,
        entry_date: formState.entry_date || undefined,
        branch_id: formState.branch_id || undefined,
        lines: formState.lines
          .map((line) => ({
            account_code: line.account_code,
            debit: line.debit === "" ? 0 : Number(line.debit),
            credit: line.credit === "" ? 0 : Number(line.credit),
            notes: line.notes,
          }))
          .filter((line) => line.account_code),
      };
      const result = await accountingApi.createJournalEntry(payload);
      toast.success("تم إنشاء القيد بنجاح");
      setFormState({
        description: "",
        notes: "",
        entry_date: "",
        branch_id: "",
        lines: [emptyLine(), emptyLine()],
      });
      setActiveTab("list");
      await fetchEntries();
      if (result?.entry?.id) {
        await loadDetail(result.entry.id);
      }
    } catch (err) {
      console.log(err);
      toast.error(err?.message || "تعذر إنشاء القيد");
    } finally {
      setFormSubmitting(false);
    }
  };

  const loadBackfillPreview = async (event) => {
    event?.preventDefault?.();
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const result = await accountingApi.getJournalBackfillPreview(previewState);
      setPreviewResult({
        items: Array.isArray(result?.items) ? result.items : [],
        summary: result?.summary || { total: 0, ready: 0, skipped: 0, already_posted: 0 },
      });
    } catch (err) {
      console.log(err);
      setPreviewError(err?.message || "تعذر تجهيز المعاينة");
      setPreviewResult({ items: [], summary: { total: 0, ready: 0, skipped: 0, already_posted: 0 } });
    } finally {
      setPreviewLoading(false);
    }
  };

  const debitPreview = formState.lines.reduce((sum, line) => sum + (Number(line.debit || 0) || 0), 0);
  const creditPreview = formState.lines.reduce((sum, line) => sum + (Number(line.credit || 0) || 0), 0);

  return (
    <AccountingShell
      title={t("accounting.journal.title")}
      subtitle="قيود اليومية مع إدخال يدوي ومعاينة Backfill فقط بدون تشغيل تلقائي"
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
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:bg-primary"
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
        { to: "/accounting/general-ledger", label: "دفتر الأستاذ" },
        { to: "/accounting/trial-balance", label: "ميزان المراجعة" },
        { to: "/accounting/reports", label: t("accounting.tabs.reports") },
        { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("list")}
          className={`rounded-2xl px-4 py-2 text-sm font-black transition ${activeTab === "list" ? "bg-primary text-black" : "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"}`}
        >
          القيود اليومية
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("manual")}
          className={`rounded-2xl px-4 py-2 text-sm font-black transition ${activeTab === "manual" ? "bg-primary text-black" : "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"}`}
        >
          إدخال يدوي
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("preview")}
          className={`rounded-2xl px-4 py-2 text-sm font-black transition ${activeTab === "preview" ? "bg-primary text-black" : "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"}`}
        >
          معاينة الترحيل
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={t("accounting.journal.metrics.entries")} value={metrics.total} tone="cyan" icon={<BookOpenText className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.journal.metrics.balanced")} value={metrics.balanced} tone="emerald" icon={<ChevronRight className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.journal.metrics.debits")} value={formatCurrency(metrics.debit)} tone="rose" icon={<ArrowLabel className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.journal.metrics.credits")} value={formatCurrency(metrics.credit)} tone="amber" icon={<ArrowLabel flip className="h-5 w-5" />} />
      </div>

      {activeTab === "list" ? (
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h3 className="m1-section-title text-white">{t("accounting.journal.ledgerTitle")}</h3>
              <p className="mt-1 text-sm text-zinc-400">{t("accounting.journal.ledgerSubtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterChip value={referenceType} onChange={setReferenceType} options={movementTypes()} />
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
            <div className="m1-table-container overflow-x-auto">
              <table className="m1-table m1-table--compact min-w-full text-right text-sm" dir="rtl">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <Th className="text-right">{t("accounting.common.labels.reference")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.type")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.description")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.date")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.debit")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.credit")}</Th>
                    <Th className="text-right">{t("accounting.journal.labels.lines")}</Th>
                  </tr>
                </thead>
                <tbody className="bg-zinc-950/70">
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
                        <Td className="text-right">
                          <div className="font-semibold text-white">{entry.entry_number}</div>
                          <div className="mt-1 text-xs text-zinc-500">#{entry.id}</div>
                        </Td>
                        <Td className="text-right">{translateReferenceType(entry.reference_type || "manual")}</Td>
                        <Td className="text-right">
                          <div className="max-w-[340px] truncate text-zinc-200">{entry.description || t("accounting.journal.fallbacks.journalEntry")}</div>
                          <div className="mt-1 text-xs text-zinc-500">{entry.notes || t("accounting.common.labels.noNotes")}</div>
                        </Td>
                        <Td className="text-right">{formatDateTime(entry.created_at)}</Td>
                        <Td className="text-right font-semibold text-emerald-300">{formatCurrency(entry.total_debit || 0)}</Td>
                        <Td className="text-right font-semibold text-rose-300">{formatCurrency(entry.total_credit || 0)}</Td>
                        <Td className="text-right text-zinc-400">{entry.line_count || 0}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              className="px-4 pb-4"
              page={page}
              pages={Math.max(1, Math.ceil(Number(pagination.total || 0) / pageSize))}
              total={Number(pagination.total || 0)}
              pageSize={pageSize}
              visible={entries.length}
              disabled={loading}
              onChange={setPage}
              onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
            />
          </div>
        </div>
      ) : null}

      {activeTab === "manual" ? (
        <form onSubmit={submitJournalEntry} className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="m1-section-title text-white">قيد يومي يدوي</h3>
              <p className="mt-1 text-sm text-zinc-400">القيد غير المتوازن سيرفض من الباك إند قبل الحفظ.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <MiniStat label="إجمالي المدين" value={formatCurrency(debitPreview)} tone="emerald" />
              <MiniStat label="إجمالي الدائن" value={formatCurrency(creditPreview)} tone="rose" />
              <MiniStat label="الحالة" value={Math.abs(debitPreview - creditPreview) < 0.01 && debitPreview > 0 ? "متوازن" : "غير متوازن"} tone={Math.abs(debitPreview - creditPreview) < 0.01 && debitPreview > 0 ? "cyan" : "amber"} />
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <Field label="الوصف">
              <input value={formState.description} onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
            </Field>
            <Field label="التاريخ">
              <input type="date" value={formState.entry_date} onChange={(event) => setFormState((current) => ({ ...current, entry_date: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
            </Field>
            <Field label="الفرع">
              <input type="number" min="1" value={formState.branch_id} onChange={(event) => setFormState((current) => ({ ...current, branch_id: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
            </Field>
          </div>

          <Field className="mt-3" label="ملاحظات">
            <textarea value={formState.notes} onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))} rows={2} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
          </Field>

          <div className="m1-table-container mt-5 overflow-x-auto">
            <table className="m1-table m1-table--compact min-w-[980px] w-full text-right text-sm" dir="rtl">
              <thead className="bg-white/5 text-zinc-400">
                <tr>
                  <Th className="text-right">الحساب</Th>
                  <Th className="text-right">مدين</Th>
                  <Th className="text-right">دائن</Th>
                  <Th className="text-right">ملاحظات</Th>
                  <Th className="text-right">حذف</Th>
                </tr>
              </thead>
              <tbody>
                {formState.lines.map((line, index) => (
                  <tr key={index}>
                    <Td className="text-right">
                      <select value={line.account_code} onChange={(event) => updateLine(index, "account_code", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none">
                        <option value="">اختر الحساب</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.account_code}>
                            {account.account_code} - {account.account_name}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td className="text-right">
                      <input type="number" min="0" step="0.01" value={line.debit} onChange={(event) => updateLine(index, "debit", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
                    </Td>
                    <Td className="text-right">
                      <input type="number" min="0" step="0.01" value={line.credit} onChange={(event) => updateLine(index, "credit", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
                    </Td>
                    <Td className="text-right">
                      <input value={line.notes} onChange={(event) => updateLine(index, "notes", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
                    </Td>
                    <Td className="text-right">
                      <button type="button" onClick={() => removeLine(index)} disabled={formState.lines.length <= 2} className="rounded-2xl border border-white/10 bg-white/5 p-2 text-zinc-300 transition hover:bg-white/10 disabled:opacity-40">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={addLine} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
              <Plus className="h-4 w-4" />
              إضافة سطر
            </button>
            <button type="submit" disabled={formSubmitting} className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:bg-primary disabled:opacity-60">
              <BookOpenText className="h-4 w-4" />
              {formSubmitting ? "جارٍ الحفظ..." : "إنشاء القيد"}
            </button>
          </div>
        </form>
      ) : null}

      {activeTab === "preview" ? (
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div>
            <h3 className="m1-section-title text-white">معاينة الترحيل</h3>
            <p className="mt-1 text-sm text-zinc-400">هذه الشاشة تعرض القيود المقترحة فقط ولا تنفذ أي posting فعلي.</p>
          </div>

          <form onSubmit={loadBackfillPreview} className="mt-5 grid gap-3 md:grid-cols-4">
            <Field label="المصدر">
              <select value={previewState.source_type} onChange={(event) => setPreviewState((current) => ({ ...current, source_type: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none">
                <option value="">الكل</option>
                <option value="order">الطلبات</option>
                <option value="purchase">المشتريات</option>
                <option value="expense">المصروفات</option>
              </select>
            </Field>
            <Field label="من تاريخ">
              <input type="date" value={previewState.from_date} onChange={(event) => setPreviewState((current) => ({ ...current, from_date: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
            </Field>
            <Field label="إلى تاريخ">
              <input type="date" value={previewState.to_date} onChange={(event) => setPreviewState((current) => ({ ...current, to_date: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
            </Field>
            <Field label="الحد الأقصى">
              <input type="number" min="1" max="100" value={previewState.limit} onChange={(event) => setPreviewState((current) => ({ ...current, limit: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
            </Field>
            <div className="md:col-span-4">
              <button type="submit" disabled={previewLoading} className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:bg-primary disabled:opacity-60">
                <WandSparkles className="h-4 w-4" />
                {previewLoading ? "جارٍ تجهيز المعاينة..." : "تحميل المعاينة"}
              </button>
            </div>
          </form>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MiniStat label="إجمالي العناصر" value={previewResult.summary.total || 0} tone="zinc" />
            <MiniStat label="جاهزة" value={previewResult.summary.ready || 0} tone="emerald" />
            <MiniStat label="متخطاة" value={previewResult.summary.skipped || 0} tone="amber" />
            <MiniStat label="منشورة مسبقًا" value={previewResult.summary.already_posted || 0} tone="rose" />
          </div>

          {previewError ? (
            <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">{previewError}</div>
          ) : null}

          {previewResult.items.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">لا توجد نتائج معاينة حتى الآن.</div>
          ) : (
            <div className="m1-table-container mt-5 overflow-x-auto">
              <table className="m1-table m1-table--compact min-w-[1120px] w-full text-right text-sm" dir="rtl">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <Th className="text-right">المصدر</Th>
                    <Th className="text-right">الوصف</Th>
                    <Th className="text-right">التاريخ</Th>
                    <Th className="text-right">المدين</Th>
                    <Th className="text-right">الدائن</Th>
                    <Th className="text-right">الحالة</Th>
                    <Th className="text-right">السبب</Th>
                  </tr>
                </thead>
                <tbody>
                  {previewResult.items.map((item, index) => (
                    <tr key={`${item.source_type}-${item.source_id}-${index}`}>
                      <Td className="text-right font-semibold text-white">{translateReferenceType(item.source_type)} #{item.source_id}</Td>
                      <Td className="text-right text-zinc-300">{item.description || "-"}</Td>
                      <Td className="text-right">{item.entry_date ? formatDateTime(item.entry_date) : "-"}</Td>
                      <Td className="text-right font-semibold text-emerald-300">{formatCurrency(item.totals?.debit || 0)}</Td>
                      <Td className="text-right font-semibold text-rose-300">{formatCurrency(item.totals?.credit || 0)}</Td>
                      <Td className="text-right"><PreviewStatusBadge status={item.status} /></Td>
                      <Td className="text-right text-zinc-400">{item.reason || "-"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

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
            <div className="text-[11px] uppercase tracking-[0.18em] text-primary/70">{t("accounting.journal.detailTitle")}</div>
            <h3 className="m1-section-title mt-2 text-white">{entry.entry_number}</h3>
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
              <DetailStat label={t("accounting.common.labels.reference")} value={`${translateReferenceType(entry.reference_type || "manual")} #${entry.reference_id || "-"}`} tone="cyan" />
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
                  <span className="text-zinc-500">{t("accounting.common.labels.status")}:</span> {translateStatus(entry.status || "posted")}
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-3xl border border-white/10">
              <table className="m1-table m1-table--compact min-w-full text-right text-sm" dir="rtl">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <Th className="text-right">{t("accounting.common.labels.account")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.debit")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.credit")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.branch")}</Th>
                    <Th className="text-right">{t("accounting.common.labels.notes")}</Th>
                  </tr>
                </thead>
                <tbody className="bg-zinc-950/70">
                  {(entry.lines || []).map((line) => (
                    <tr key={line.id}>
                      <Td className="text-right">
                        <div className="font-semibold text-white">
                          {line.account_code ? `${line.account_code} - ` : ""}
                          {line.account_name || t("accounting.common.labels.account")}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">{line.account_type || ""}</div>
                      </Td>
                      <Td className="text-right font-semibold text-emerald-300">{formatCurrency(line.debit || 0)}</Td>
                      <Td className="text-right font-semibold text-rose-300">{formatCurrency(line.credit || 0)}</Td>
                      <Td className="text-right">{line.branch_id || "-"}</Td>
                      <Td className="text-right">{line.notes || "-"}</Td>
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

function Field({ label, children, className = "" }) {
  return (
    <label className={`space-y-2 ${className}`}>
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
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

function movementTypes() {
  return [
    { value: "", label: "الكل" },
    { value: "purchase", label: "شراء" },
    { value: "order", label: "طلب" },
    { value: "return", label: "مرتجع" },
    { value: "manual", label: "يدوي" },
    { value: "expense", label: "مصروف" },
  ];
}

function translateReferenceType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "purchase") return "شراء";
  if (normalized === "order") return "طلب";
  if (normalized === "return") return "مرتجع";
  if (normalized === "manual") return "يدوي";
  if (normalized === "expense") return "مصروف";
  if (normalized === "inventory") return "مخزون";
  return "غير معروف";
}

function translateStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "posted") return "مرحّل";
  if (normalized === "draft") return "مسودة";
  if (normalized === "void") return "ملغي";
  return "غير معروف";
}

function MiniStat({ label, value, tone = "zinc" }) {
  const tones = {
    zinc: "border-white/10 bg-white/5 text-white",
    cyan: "border-primary/20 bg-primary/10 text-primary",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  };

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.zinc}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-xl font-black">{value}</div>
    </div>
  );
}

function PreviewStatusBadge({ status }) {
  const normalized = String(status || "").trim().toLowerCase();
  const tone =
    normalized === "ready"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : normalized === "already_posted"
        ? "border-rose-500/20 bg-rose-500/10 text-rose-300"
        : "border-amber-500/20 bg-amber-500/10 text-amber-300";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tone}`}>
      {normalized || "unknown"}
    </span>
  );
}

function DetailStat({ label, value, tone = "zinc" }) {
  const tones = {
    zinc: "border-white/10 bg-white/5 text-white",
    cyan: "border-primary/20 bg-primary/10 text-primary",
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
      <path d="M17 7 7 17" />
      <path d="M11 17H7v-4" />
    </svg>
  );
}

export default JournalEntries;
